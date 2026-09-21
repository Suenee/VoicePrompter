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

const ALLOWED_FORMAT_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 'span']);

function isMarkerText(text: string): boolean {
    return /^\\s*\\[[^\\]]*\\]\\s*$/.test(text);
}

/**
 * HTML allowlist. Unsupported elements/attributes are removed, while their
 * text content survives. Supported formatting is preserved as HTML.
 */
export function sanitizeSourceHtml(html: string): string {
    const source = new DOMParser().parseFromString(html, 'text/html');
    const colors = classColorMap(source);
    const output = document.implementation.createHTMLDocument('');
    const root = output.createElement('div');

    const append = (node: Node, parent: HTMLElement): void => {
        if (node.nodeType === Node.TEXT_NODE) {
            parent.appendChild(output.createTextNode(node.textContent || ''));
            return;
        }
        if (!(node instanceof Element)) return;

        const tag = node.tagName.toLowerCase();
        if (tag === 'br') {
            parent.appendChild(output.createElement('br'));
            return;
        }

        const marker = isMarkerText(node.textContent || '');
        let target = parent;
        if (!marker && ALLOWED_FORMAT_TAGS.has(tag)) {
            const allowed = output.createElement(tag);
            const color = inheritedColor(node, colors);
            if (color) allowed.style.color = color;
            parent.appendChild(allowed);
            target = allowed;
        } else if (!marker) {
            const color = inheritedColor(node, colors);
            if (color) {
                const span = output.createElement('span');
                span.style.color = color;
                parent.appendChild(span);
                target = span;
            }
        }

        for (const child of Array.from(node.childNodes)) append(child, target);
        if (/^(p|div|li|h[1-6]|tr)$/.test(tag)) parent.appendChild(output.createElement('br'));
    };

    for (const child of Array.from(source.body.childNodes)) append(child, root);
    return root.innerHTML.replace(/(?:<br>\\s*)+$/i, '');
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

interface SourceFormatToken {
    color: string | null;
    bold: boolean;
    italic: boolean;
    underline: boolean;
}

function sourceFormatTokens(html: string): SourceFormatToken[] {
    const doc = new DOMParser().parseFromString(`<div id="vp-source">${sanitizeSourceHtml(html)}</div>`, 'text/html');
    const root = doc.getElementById('vp-source');
    if (!root) return [];

    const tokens: SourceFormatToken[] = [];
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
        const parent = node.parentElement;
        const color = (parent as HTMLElement | null)?.style?.color || null;
        const bold = !!parent?.closest('b,strong');
        const italic = !!parent?.closest('i,em');
        const underline = !!parent?.closest('u');
        for (const _ of (node.textContent || '').matchAll(/\\S+/g)) {
            tokens.push({ color, bold, italic, underline });
        }
    }
    return tokens;
}

function clearAllowedFormatting(): void {
    for (const word of state.scriptWords) {
        const element = word.element;
        if (!element) continue;
        element.style.removeProperty('color');
        element.style.removeProperty('font-weight');
        element.style.removeProperty('font-style');
        element.style.removeProperty('text-decoration');
    }
}

async function applyCurrentSourceFormatting(): Promise<void> {
    if (applying) return;
    applying = true;
    try {
        clearAllowedFormatting();
        if (!state.config.textFormattingEnabled) return;

        let sourceHtml = state.googleDocUrl ? googleDocHtml : pastedHtml;
        if (state.googleDocUrl && (!sourceHtml || googleDocHtmlUrl !== state.googleDocUrl)) sourceHtml = await fetchGoogleDocSourceHtml(state.googleDocUrl);
        if (!sourceHtml) return;

        /*
         * The sanitizer is the formatting authority. It strips everything that
         * is not explicitly allowed. This pass only projects the surviving HTML
         * formatting onto VP's mandatory per-word navigation spans, strictly in
         * source DOM order. It never searches for text or guesses formatting.
         */
        const tokens = sourceFormatTokens(sourceHtml);
        let sourceIndex = 0;
        for (const word of state.scriptWords) {
            if (word.isBreak || word.isStop) continue;
            const token = tokens[sourceIndex++];
            if (!token) break;
            if (word.skip || word.element?.closest('.slide-marker-row')) continue;
            const element = word.element;
            if (!element) continue;
            if (token.color) element.style.color = token.color;
            if (token.bold) element.style.fontWeight = 'bold';
            if (token.italic) element.style.fontStyle = 'italic';
            if (token.underline) element.style.textDecoration = 'underline';
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
