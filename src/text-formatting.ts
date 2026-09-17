import { state } from './state';
import { extractDocId } from './gdoc';

let pastedHtml: string | null = null;
let googleDocHtml: string | null = null;

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

/**
 * PHP strip_tags()-style allowlist for source formatting.
 * At present only foreground colour survives. Markers are deliberately plain.
 */
export function sanitizeSourceHtml(html: string): string {
    const source = new DOMParser().parseFromString(html, 'text/html');
    const colors = classColorMap(source);
    const output = document.implementation.createHTMLDocument('');
    const root = output.createElement('div');

    const append = (node: Node, parent: HTMLElement, inMarker = false): boolean => {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent || '';
            if (!text) return inMarker;
            const parts = text.split(/(\[[^\]]*\])/g);
            for (const part of parts) {
                if (!part) continue;
                const markerPart = /^\[[^\]]*\]$/.test(part);
                const textNode = output.createTextNode(part);
                const color = markerPart ? null : inheritedColor(node.parentElement, colors);
                if (color) {
                    const span = output.createElement('span');
                    span.style.color = color;
                    span.appendChild(textNode);
                    parent.appendChild(span);
                } else parent.appendChild(textNode);
            }
            return inMarker;
        }

        if (!(node instanceof Element)) return inMarker;
        const tag = node.tagName.toLowerCase();
        const block = /^(p|div|li|h[1-6]|tr)$/.test(tag);
        if (tag === 'br') { parent.appendChild(output.createElement('br')); return inMarker; }

        for (const child of Array.from(node.childNodes)) inMarker = append(child, parent, inMarker);
        if (block) parent.appendChild(output.createElement('br'));
        return inMarker;
    };

    for (const child of Array.from(source.body.childNodes)) append(child, root);
    return root.innerHTML.replace(/(?:<br>\s*)+$/i, '');
}

async function unzipFirstHtml(buffer: ArrayBuffer): Promise<string | null> {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
        if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return null;
    const entries = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);
    const decoder = new TextDecoder();
    for (let entry = 0; entry < entries && offset + 46 <= bytes.length; entry++) {
        if (view.getUint32(offset, true) !== 0x02014b50) return null;
        const method = view.getUint16(offset + 10, true);
        const compressedSize = view.getUint32(offset + 20, true);
        const nameLength = view.getUint16(offset + 28, true);
        const extraLength = view.getUint16(offset + 30, true);
        const commentLength = view.getUint16(offset + 32, true);
        const localOffset = view.getUint32(offset + 42, true);
        const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));
        if (/\.html?$/i.test(name) && localOffset + 30 <= bytes.length && view.getUint32(localOffset, true) === 0x04034b50) {
            const localNameLength = view.getUint16(localOffset + 26, true);
            const localExtraLength = view.getUint16(localOffset + 28, true);
            const dataStart = localOffset + 30 + localNameLength + localExtraLength;
            const compressed = bytes.slice(dataStart, dataStart + compressedSize);
            if (method === 0) return decoder.decode(compressed);
            if (method === 8 && typeof DecompressionStream !== 'undefined') {
                const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
                return await new Response(stream).text();
            }
            return null;
        }
        offset += 46 + nameLength + extraLength + commentLength;
    }
    return null;
}

export async function fetchGoogleDocSourceHtml(url: string): Promise<string | null> {
    const docId = extractDocId(url);
    if (!docId) return null;
    const local = window.location.port === '5173' || window.location.port === '4173';
    const proxy = local
        ? `/gdoc-proxy?id=${encodeURIComponent(docId)}&format=html`
        : `https://gdoc-proxy.kosuvorov.workers.dev/?id=${encodeURIComponent(docId)}&format=html`;
    try {
        const response = await fetch(proxy, { cache: 'no-store' });
        if (!response.ok) return null;
        const type = response.headers.get('content-type') || '';
        let html: string | null = null;
        if (type.includes('text/html')) html = await response.text();
        else html = await unzipFirstHtml(await response.arrayBuffer());
        googleDocHtml = html;
        return html;
    } catch (error) {
        console.warn('[Text Formatting] Could not retrieve source HTML:', error);
        return null;
    }
}

export function getCurrentSourceHtml(): string | null {
    return state.googleDocUrl ? googleDocHtml : pastedHtml;
}

export function clearGoogleDocSourceHtml(): void { googleDocHtml = null; }

function insertSettingsToggle(): HTMLInputElement | null {
    const existing = document.getElementById('textFormattingToggle') as HTMLInputElement | null;
    if (existing) return existing;
    const preserve = document.getElementById('preserveFormattingToggle');
    const preserveRow = preserve?.closest('.flex.items-center.justify-between');
    if (!preserveRow?.parentElement) return null;
    const row = document.createElement('div');
    row.className = 'flex items-center justify-between';
    row.innerHTML = `
        <div class="flex flex-col"><span class="text-sm text-neutral-300">Text Formatting</span><span class="text-xs text-neutral-500">Use supported formatting from source text</span></div>
        <label class="relative inline-flex items-center cursor-pointer">
            <input id="textFormattingToggle" type="checkbox" class="sr-only peer">
            <div class="w-11 h-6 bg-neutral-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#FFBB00]"></div>
        </label>`;
    preserveRow.insertAdjacentElement('afterend', row);
    return row.querySelector('#textFormattingToggle') as HTMLInputElement;
}

function installPasteCapture(input: HTMLTextAreaElement): void {
    input.addEventListener('paste', event => {
        const html = event.clipboardData?.getData('text/html');
        if (html) pastedHtml = html;
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
            window.dispatchEvent(new CustomEvent('vp-text-formatting-refresh'));
        });
    }
    const input = document.getElementById('inputScript') as HTMLTextAreaElement | null;
    if (input) installPasteCapture(input);
}

if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', install, { once: true });
else install();
