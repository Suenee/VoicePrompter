import { state } from './state';
import { extractDocId } from './gdoc';

let pastedHtml: string | null = null;
let googleDocHtml: string | null = null;
let googleDocHtmlUrl: string | null = null;
let applying = false;

function classColorMap(doc: Document): Map<string, string> {
    const colors = new Map<string, string>();
    for (const style of Array.from(doc.querySelectorAll('style'))) {
        const css = style.textContent || '';
        const rule = /\.([\w-]+)\s*\{([^}]*)\}/g;
        let match: RegExpExecArray | null;
        while ((match = rule.exec(css))) {
            const color = match[2].match(/(?:^|;)\s*color\s*:\s*([^;!]+)(?:\s*!important)?/i)?.[1]?.trim();
            if (color) colors.set(match[1], color);
        }
    }
    return colors;
}

function inheritedColor(element: Element | null, colors: Map<string, string>): string | null {
    let current = element;
    while (current) {
        const inline = (current as HTMLElement).style?.color;
        if (inline) return inline;
        for (const className of Array.from(current.classList)) {
            const color = colors.get(className);
            if (color) return color;
        }
        current = current.parentElement;
    }
    return null;
}

/** PHP strip_tags()-style allowlist. Currently only foreground colour survives. */
export function sanitizeSourceHtml(html: string): string {
    const source = new DOMParser().parseFromString(html, 'text/html');
    const colors = classColorMap(source);
    const output = document.implementation.createHTMLDocument('');
    const root = output.createElement('div');

    const append = (node: Node, parent: HTMLElement): void => {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent || '';
            if (!text) return;
            const parts = text.split(/(\[[^\]]*\])/g);
            for (const part of parts) {
                if (!part) continue;
                const marker = /^\[[^\]]*\]$/.test(part);
                const color = marker ? null : inheritedColor(node.parentElement, colors);
                if (color) {
                    const span = output.createElement('span');
                    span.style.color = color;
                    span.textContent = part;
                    parent.appendChild(span);
                } else parent.appendChild(output.createTextNode(part));
            }
            return;
        }
        if (!(node instanceof Element)) return;
        const tag = node.tagName.toLowerCase();
        if (tag === 'br') { parent.appendChild(output.createElement('br')); return; }
        for (const child of Array.from(node.childNodes)) append(child, parent);
        if (/^(p|div|li|h[1-6]|tr)$/.test(tag)) parent.appendChild(output.createElement('br'));
    };

    for (const child of Array.from(source.body.childNodes)) append(child, root);
    return root.innerHTML.replace(/(?:<br>\s*)+$/i, '');
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

async function fetchGoogleDocSourceHtml(url: string): Promise<string | null> {
    const docId = extractDocId(url);
    if (!docId) return null;
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

function colorsFromSanitizedHtml(html: string): Array<string | null> {
    const doc = new DOMParser().parseFromString(`<div id="vp-source">${html}</div>`, 'text/html');
    const root = doc.getElementById('vp-source');
    if (!root) return [];
    const colors: Array<string | null> = [];
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
        const color = (node.parentElement as HTMLElement | null)?.style?.color || null;
        for (const _ of (node.textContent || '').matchAll(/\S+/g)) colors.push(color);
    }
    return colors;
}

async function applyCurrentSourceFormatting(): Promise<void> {
    if (applying) return;
    applying = true;
    try {
        for (const word of state.scriptWords) word.element?.style.removeProperty('color');
        if (!state.config.textFormattingEnabled) return;

        let sourceHtml = state.googleDocUrl ? googleDocHtml : pastedHtml;
        if (state.googleDocUrl && (!sourceHtml || googleDocHtmlUrl !== state.googleDocUrl)) sourceHtml = await fetchGoogleDocSourceHtml(state.googleDocUrl);
        if (!sourceHtml) return;

        // The source is filtered once. Rendering then consumes the surviving
        // formatting in source order; there is no word search/rematching pass.
        const colors = colorsFromSanitizedHtml(sanitizeSourceHtml(sourceHtml));
        let sourceIndex = 0;
        for (const word of state.scriptWords) {
            if (word.isBreak || word.isStop) continue;
            const color = colors[sourceIndex++] || null;
            if (word.skip || word.element?.closest('.slide-marker-row')) continue;
            if (color && word.element) word.element.style.color = color;
        }
    } finally { applying = false; }
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
    input.addEventListener('paste', event => { const html = event.clipboardData?.getData('text/html'); pastedHtml = html || null; }, true);
    input.addEventListener('input', event => { if ((event as InputEvent).isTrusted && !(event as InputEvent).inputType?.startsWith('insertFromPaste')) pastedHtml = null; });
}

function install(): void {
    const toggle = insertSettingsToggle();
    if (toggle) {
        toggle.checked = state.config.textFormattingEnabled;
        toggle.addEventListener('change', () => { state.config.textFormattingEnabled = toggle.checked; void applyCurrentSourceFormatting(); });
    }
    const input = document.getElementById('inputScript') as HTMLTextAreaElement | null;
    if (input) installPasteCapture(input);
    const script = document.getElementById('scriptContent');
    if (script) {
        const observer = new MutationObserver(() => { if (!applying) void applyCurrentSourceFormatting(); });
        observer.observe(script, { childList: true, subtree: true });
    }
    window.addEventListener('vp-text-formatting-refresh', () => { void applyCurrentSourceFormatting(); });
}

if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', install, { once: true }); else install();
