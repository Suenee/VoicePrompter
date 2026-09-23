import { state } from './state';
import { extractDocId } from './gdoc';
import { ScriptWord } from './types';

let pastedHtml: string | null = null;
let googleDocHtml: string | null = null;
let googleDocHtmlUrl: string | null = null;

const ALLOWED_TAGS = new Set(['span', 'b', 'strong', 'i', 'em', 'u']);
const ALLOWED_STYLES = new Set(['color']);
const BLOCK_TAGS = /^(p|div|li|h[1-6]|tr)$/i;

function classStyleMap(doc: Document): Map<string, Map<string, string>> {
    const styles = new Map<string, Map<string, string>>();
    for (const style of Array.from(doc.querySelectorAll('style'))) {
        const css = style.textContent || '';
        const rule = /([^{}]+)\{([^}]*)\}/g;
        let match: RegExpExecArray | null;
        while ((match = rule.exec(css))) {
            const declarations = new Map<string, string>();
            for (const declaration of match[2].split(';')) {
                const colon = declaration.indexOf(':');
                if (colon < 0) continue;
                const property = declaration.slice(0, colon).trim().toLowerCase();
                if (!ALLOWED_STYLES.has(property)) continue;
                const value = declaration.slice(colon + 1).replace(/!important\s*$/i, '').trim();
                if (value) declarations.set(property, value);
            }
            if (!declarations.size) continue;
            for (const selector of match[1].split(',')) {
                const classMatch = selector.trim().match(/^\.([\w-]+)$/);
                if (classMatch) styles.set(classMatch[1], new Map(declarations));
            }
        }
    }
    return styles;
}

function allowedStyle(element: Element, classStyles: Map<string, Map<string, string>>): Map<string, string> {
    const result = new Map<string, string>();
    for (const className of Array.from(element.classList)) {
        const declarations = classStyles.get(className);
        declarations?.forEach((value, property) => result.set(property, value));
    }
    const inline = (element as HTMLElement).style;
    for (const property of ALLOWED_STYLES) {
        const value = inline.getPropertyValue(property).trim();
        if (value) result.set(property, value);
    }
    return result;
}

function isMarkerText(text: string): boolean {
    return /^\s*\[[^\]]*\]\s*$/.test(text);
}

/** Sanitizes source HTML structurally. Formatting survives as HTML/CSS, never as word metadata. */
export function sanitizeSourceHtml(html: string): string {
    const source = new DOMParser().parseFromString(html, 'text/html');
    const classStyles = classStyleMap(source);
    const output = document.implementation.createHTMLDocument('');
    const root = output.createElement('div');

    const append = (node: Node, parent: HTMLElement): void => {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent || '';
            if (!text) return;
            // Markers are deliberately split out of source formatting.
            for (const part of text.split(/(\[[^\]]*\])/g)) {
                if (!part) continue;
                if (/^\[[^\]]*\]$/.test(part)) {
                    const marker = output.createElement('span');
                    marker.setAttribute('data-vp-marker', '');
                    marker.textContent = part;
                    root.appendChild(marker);
                } else {
                    parent.appendChild(output.createTextNode(part));
                }
            }
            return;
        }
        if (!(node instanceof Element)) return;

        const tag = node.tagName.toLowerCase();
        if (tag === 'br') {
            parent.appendChild(output.createElement('br'));
            return;
        }

        const target = ALLOWED_TAGS.has(tag) ? output.createElement(tag) : parent;
        if (target !== parent) {
            const styles = allowedStyle(node, classStyles);
            styles.forEach((value, property) => target.style.setProperty(property, value));
            parent.appendChild(target);
        }

        for (const child of Array.from(node.childNodes)) append(child, target);
        if (BLOCK_TAGS.test(tag)) root.appendChild(output.createElement('br'));
    };

    for (const child of Array.from(source.body.childNodes)) append(child, root);
    while (root.lastElementChild?.tagName === 'BR') root.lastElementChild.remove();
    return root.innerHTML;
}

async function unzipFirstHtml(buffer: ArrayBuffer): Promise<string | null> {
    const bytes = new Uint8Array(buffer), view = new DataView(buffer);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) return null;
    const entries = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);
    const decoder = new TextDecoder();
    for (let entry = 0; entry < entries && offset + 46 <= bytes.length; entry++) {
        if (view.getUint32(offset, true) !== 0x02014b50) return null;
        const method = view.getUint16(offset + 10, true), compressedSize = view.getUint32(offset + 20, true);
        const nameLength = view.getUint16(offset + 28, true), extraLength = view.getUint16(offset + 30, true), commentLength = view.getUint16(offset + 32, true);
        const localOffset = view.getUint32(offset + 42, true), name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));
        if (/\.html?$/i.test(name) && localOffset + 30 <= bytes.length && view.getUint32(localOffset, true) === 0x04034b50) {
            const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
            const compressed = bytes.slice(dataStart, dataStart + compressedSize);
            if (method === 0) return decoder.decode(compressed);
            if (method === 8 && typeof DecompressionStream !== 'undefined') return await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
            return null;
        }
        offset += 46 + nameLength + extraLength + commentLength;
    }
    return null;
}

export async function fetchGoogleDocSourceHtml(url: string, force = false): Promise<string | null> {
    const docId = extractDocId(url);
    if (!docId) return null;
    if (!force && googleDocHtml && googleDocHtmlUrl === url) return googleDocHtml;
    const local = window.location.port === '5173' || window.location.port === '4173';
    const proxy = local ? `/gdoc-proxy?id=${encodeURIComponent(docId)}&format=html` : `https://gdoc-proxy.kosuvorov.workers.dev/?id=${encodeURIComponent(docId)}&format=html`;
    try {
        const response = await fetch(proxy, { cache: 'no-store' });
        if (!response.ok) return null;
        const type = response.headers.get('content-type') || '';
        const html = type.includes('text/html') ? await response.text() : await unzipFirstHtml(await response.arrayBuffer());
        if (html) { googleDocHtml = html; googleDocHtmlUrl = url; }
        return html;
    } catch (error) {
        console.warn('[Text Formatting] Could not retrieve source HTML:', error);
        return null;
    }
}

function makeWord(word: string, element: HTMLElement, inMarker: boolean): ScriptWord {
    const clean = word.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
    return {
        word,
        clean,
        element,
        skip: inMarker || /[\u{1F300}-\u{1F9FF}]/u.test(word),
        isStop: false
    };
}

/**
 * Renders directly from sanitized source HTML. Word spans are inserted into the
 * surviving DOM text nodes, so formatting is inherited from the real source DOM.
 */
export function renderFormattedSource(container: HTMLElement): ScriptWord[] | null {
    if (!state.config.textFormattingEnabled) return null;
    const sourceHtml = state.googleDocUrl && googleDocHtmlUrl === state.googleDocUrl ? googleDocHtml : pastedHtml;
    if (!sourceHtml) return null;

    const template = document.createElement('template');
    template.innerHTML = sanitizeSourceHtml(sourceHtml);
    const words: ScriptWord[] = [];
    let inMarker = false;

    const processText = (node: Text): void => {
        const parent = node.parentElement;
        if (!parent) return;
        const markerNode = !!parent.closest('[data-vp-marker]');
        const fragment = document.createDocumentFragment();
        const parts = (node.textContent || '').split(/(\s+)/);
        for (const part of parts) {
            if (!part) continue;
            if (/^\s+$/.test(part)) {
                fragment.appendChild(document.createTextNode(part));
                continue;
            }
            if (part.includes('[')) inMarker = true;
            const span = document.createElement('span');
            span.textContent = part;
            span.className = 'script-word transition-opacity duration-300';
            fragment.appendChild(span);
            words.push(makeWord(part, span, markerNode || inMarker));
            if (part.includes(']')) inMarker = false;
        }
        node.replaceWith(fragment);
    };

    const walk = (parent: ParentNode): void => {
        for (const child of Array.from(parent.childNodes)) {
            if (child.nodeType === Node.TEXT_NODE) processText(child as Text);
            else if (child instanceof HTMLBRElement) {
                const span = document.createElement('span');
                const preserve = state.config.preserveFormatting;
                span.textContent = preserve ? '' : '🛑';
                span.className = preserve ? 'script-word line-break' : 'script-word stop-marker';
                span.style.display = preserve ? 'block' : '';
                if (preserve) { span.style.width = '100%'; span.classList.add('line-break'); }
                child.replaceWith(span);
                words.push({ word: preserve ? '' : '🛑', clean: '', element: span, skip: true, isStop: !preserve, isBreak: preserve });
            } else if (child instanceof Element) walk(child);
        }
    };
    walk(template.content);

    container.replaceChildren(template.content.cloneNode(true));
    // cloneNode invalidates element references; bind them once from the rendered DOM.
    const renderedWords = Array.from(container.querySelectorAll<HTMLElement>('.script-word'));
    words.forEach((word, index) => {
        word.element = renderedWords[index] || null;
        if (word.element) word.element.id = `word-${index}`;
    });
    return words;
}

function insertSettingsToggle(): HTMLInputElement | null {
    const existing = document.getElementById('textFormattingToggle') as HTMLInputElement | null;
    if (existing) return existing;
    const preserve = document.getElementById('preserveFormattingToggle');
    const preserveRow = preserve?.closest('.flex.items-center.justify-between');
    if (!preserveRow?.parentElement) return null;
    const row = document.createElement('div');
    row.className = 'flex items-center justify-between';
    row.innerHTML = `<div class="flex flex-col"><span class="text-sm text-neutral-300">Text Formatting</span><span class="text-xs text-neutral-500">Use supported formatting from source text</span></div><label class="relative inline-flex items-center cursor-pointer"><input id="textFormattingToggle" type="checkbox" class="sr-only peer"><div class="w-11 h-6 bg-neutral-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#FFBB00]"></div></label>`;
    preserveRow.insertAdjacentElement('afterend', row);
    return row.querySelector('#textFormattingToggle') as HTMLInputElement;
}

function installPasteCapture(input: HTMLTextAreaElement): void {
    input.addEventListener('paste', event => {
        pastedHtml = event.clipboardData?.getData('text/html') || null;
    }, true);
    input.addEventListener('input', event => {
        if ((event as InputEvent).isTrusted && !(event as InputEvent).inputType?.startsWith('insertFromPaste')) pastedHtml = null;
    });
}

function install(): void {
    const toggle = insertSettingsToggle();
    if (toggle) {
        toggle.checked = state.config.textFormattingEnabled;
        toggle.addEventListener('change', () => {
            state.config.textFormattingEnabled = toggle.checked;
            window.dispatchEvent(new CustomEvent('vp-text-formatting-changed'));
        });
    }
    const input = document.getElementById('inputScript') as HTMLTextAreaElement | null;
    if (input) installPasteCapture(input);
}

if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', install, { once: true }); else install();
