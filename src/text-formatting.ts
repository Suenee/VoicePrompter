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
                    parent.appendChild(marker);
                } else {
                    parent.appendChild(output.createTextNode(part));
                }
            }
            return;
        }
        if (!(node instanceof Element)) return;

        const tag = node.tagName.toLowerCase();
        if (tag === 'br') {
            parent.appendChild(state.config.preserveFormatting ? output.createElement('br') : output.createTextNode(' '));
            return;
        }

        const keepStyleTag = state.config.sourceStylesEnabled && ['b', 'strong', 'i', 'em'].includes(tag);
        const keepStructuralTag = tag === 'span';
        const target = (keepStyleTag || keepStructuralTag) && ALLOWED_TAGS.has(tag) ? output.createElement(tag) : parent;
        if (target !== parent) {
            const styles = allowedStyle(node, classStyles);
            if (state.config.sourceColorsEnabled) styles.forEach((value, property) => target.style.setProperty(property, value));
            parent.appendChild(target);
        }

        for (const child of Array.from(node.childNodes)) append(child, target);
        if (BLOCK_TAGS.test(tag)) {
            if (state.config.preserveFormatting) root.appendChild(output.createElement('br'));
            else root.appendChild(output.createTextNode(' '));
        }
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
    if (!state.config.sourceColorsEnabled && !state.config.sourceStylesEnabled) return null;
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


type ModalDraft = {
    paragraphs: boolean;
    colors: boolean;
    styles: boolean;
    textColor: string;
    bgColor: string;
    direction: 'ltr' | 'rtl';
    fontFamily: string;
};

const toggleHtml = (id: string, label: string, subtitle: string) => `
<div class="flex items-center justify-between gap-4">
  <div class="flex flex-col"><span class="text-sm text-neutral-300">${label}</span><span class="text-xs text-neutral-500">${subtitle}</span></div>
  <label class="relative inline-flex items-center cursor-pointer"><input id="${id}" type="checkbox" class="sr-only peer"><div class="w-11 h-6 bg-neutral-700 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#FFBB00]"></div></label>
</div>`;

function currentDraft(): ModalDraft {
    return {
        paragraphs: state.config.preserveFormatting,
        colors: state.config.sourceColorsEnabled,
        styles: state.config.sourceStylesEnabled,
        textColor: state.config.textColor,
        bgColor: state.config.bgColor,
        direction: state.config.textDirection,
        fontFamily: state.config.fontFamily
    };
}

function installFormattingModal(): void {
    if (document.getElementById('textFormattingSettingsBtn')) return;
    const preserve = document.getElementById('preserveFormattingToggle');
    const preserveRow = preserve?.closest('.flex.items-center.justify-between');
    if (!preserveRow?.parentElement) return;

    // Keep legacy controls in the DOM for the existing application listeners,
    // but remove their duplicate presentation from the Settings panel.
    preserveRow.classList.add('hidden');
    const textColor = document.getElementById('textColorInput') as HTMLInputElement | null;
    const bgColor = document.getElementById('bgColorInput') as HTMLInputElement | null;
    const colorsSection = textColor?.closest('.grid.grid-cols-2');
    const directionSection = document.getElementById('dirLtrBtn')?.closest('.mt-4.pt-4');
    const fontSection = document.getElementById('fontFamilyMonoBtn')?.closest('.mt-4.pt-4');
    colorsSection?.classList.add('hidden');
    directionSection?.classList.add('hidden');
    fontSection?.classList.add('hidden');

    const row = document.createElement('div');
    row.className = 'flex items-center justify-between';
    row.innerHTML = `<div class="flex flex-col"><span class="text-sm text-neutral-300">Text Formatting</span><span class="text-xs text-neutral-500">Source text appearance and layout</span></div><button id="textFormattingSettingsBtn" type="button" title="Text Formatting settings" class="h-8 min-w-9 px-2 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-xs font-bold text-neutral-300 hover:text-white transition-colors">&gt;&gt;</button>`;
    preserveRow.insertAdjacentElement('afterend', row);

    const modal = document.createElement('div');
    modal.id = 'textFormattingModal';
    modal.className = 'hidden fixed inset-0 z-[10003] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4';
    modal.innerHTML = `
      <div class="relative bg-neutral-900 border border-neutral-700 rounded-xl p-6 max-w-md w-full shadow-2xl shadow-black/50 max-h-[90vh] overflow-y-auto">
        <h2 class="text-xl font-bold text-white mb-5">Text Formatting</h2>
        <div class="space-y-4">
          ${toggleHtml('formatParagraphsDraft', 'Paragraphs', 'Preserve source paragraphs and line breaks')}
          ${toggleHtml('formatColorsDraft', 'Colors', 'Preserve source text colors')}
          ${toggleHtml('formatStylesDraft', 'Style', 'Preserve bold and italic')}
        </div>
        <div class="grid grid-cols-2 gap-4 mt-5 pt-4 border-t border-neutral-800">
          <div><label class="block text-xs text-neutral-400 mb-1">Text Color</label><div class="flex items-center bg-neutral-800 rounded p-1 border border-neutral-700"><input id="formatTextColorDraft" type="color" class="w-8 h-8 rounded cursor-pointer bg-transparent border-none p-0 mr-2"><span id="formatTextColorValue" class="text-xs text-neutral-300 font-mono"></span></div></div>
          <div><label class="block text-xs text-neutral-400 mb-1">Background</label><div class="flex items-center bg-neutral-800 rounded p-1 border border-neutral-700"><input id="formatBgColorDraft" type="color" class="w-8 h-8 rounded cursor-pointer bg-transparent border-none p-0 mr-2"><span id="formatBgColorValue" class="text-xs text-neutral-300 font-mono"></span></div></div>
        </div>
        <div class="mt-4 pt-4 border-t border-neutral-800">
          <label class="block text-xs text-neutral-400 mb-2">Text Direction</label>
          <div class="grid grid-cols-2 gap-2"><button data-format-dir="ltr" class="px-3 py-2 rounded text-xs border">Left to Right</button><button data-format-dir="rtl" class="px-3 py-2 rounded text-xs border">Right to Left</button></div>
        </div>
        <div class="mt-4 pt-4 border-t border-neutral-800">
          <label class="block text-xs text-neutral-400 mb-2">Font Style</label>
          <div class="grid grid-cols-2 gap-2">
            <button data-format-font="mono" class="px-3 py-2 rounded text-xs border font-mono">Mono</button>
            <button data-format-font="sans" class="px-3 py-2 rounded text-xs border" style="font-family:Arial,sans-serif">Sans</button>
            <button data-format-font="serif" class="px-3 py-2 rounded text-xs border" style="font-family:Georgia,serif">Serif</button>
            <button data-format-font="comicSans" class="px-3 py-2 rounded text-xs border" style="font-family:'Comic Sans MS',cursive">Comic Sans</button>
            <button data-format-font="openDyslexic" class="px-3 py-2 rounded text-xs border col-span-2" style="font-family:'OpenDyslexic',cursive">OpenDyslexic</button>
          </div>
        </div>
        <div class="flex items-center justify-end gap-3 mt-6">
          <button id="textFormattingResetBtn" type="button" title="Reset to defaults" aria-label="Reset to defaults" class="h-10 w-10 flex items-center justify-center bg-neutral-800 hover:bg-neutral-700 rounded-lg text-neutral-300 hover:text-white border border-neutral-700 transition-colors text-xl">↻</button>
          <button id="textFormattingSaveBtn" type="button" class="px-4 py-2.5 bg-[#FFBB00] hover:bg-[#D9A000] rounded-lg text-sm font-semibold text-black transition-colors">Save</button>
          <button id="textFormattingCancelBtn" type="button" class="px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-sm font-medium text-white border border-neutral-700 transition-colors">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    let draft = currentDraft();
    const checkbox = (id: string) => document.getElementById(id) as HTMLInputElement;
    const colorInput = (id: string) => document.getElementById(id) as HTMLInputElement;
    const paintChoice = (selector: string, active: string) => {
        modal.querySelectorAll<HTMLButtonElement>(selector).forEach(button => {
            const selected = button.dataset.formatDir === active || button.dataset.formatFont === active;
            button.className = button.className.replace(/bg-neutral-(700|800)|border-\[#FFBB00\]|border-neutral-700|text-white|text-neutral-300/g, '').replace(/\s+/g, ' ').trim();
            button.classList.add(selected ? 'bg-neutral-700' : 'bg-neutral-800', selected ? 'border-[#FFBB00]' : 'border-neutral-700', selected ? 'text-white' : 'text-neutral-300');
        });
    };
    const paint = () => {
        checkbox('formatParagraphsDraft').checked = draft.paragraphs;
        checkbox('formatColorsDraft').checked = draft.colors;
        checkbox('formatStylesDraft').checked = draft.styles;
        colorInput('formatTextColorDraft').value = draft.textColor;
        colorInput('formatBgColorDraft').value = draft.bgColor;
        document.getElementById('formatTextColorValue')!.textContent = draft.textColor;
        document.getElementById('formatBgColorValue')!.textContent = draft.bgColor;
        paintChoice('[data-format-dir]', draft.direction);
        paintChoice('[data-format-font]', draft.fontFamily);
    };
    const readChecks = () => {
        draft.paragraphs = checkbox('formatParagraphsDraft').checked;
        draft.colors = checkbox('formatColorsDraft').checked;
        draft.styles = checkbox('formatStylesDraft').checked;
    };
    checkbox('formatParagraphsDraft').addEventListener('change', readChecks);
    checkbox('formatColorsDraft').addEventListener('change', readChecks);
    checkbox('formatStylesDraft').addEventListener('change', readChecks);
    colorInput('formatTextColorDraft').addEventListener('input', e => { draft.textColor = (e.target as HTMLInputElement).value; paint(); });
    colorInput('formatBgColorDraft').addEventListener('input', e => { draft.bgColor = (e.target as HTMLInputElement).value; paint(); });
    modal.querySelectorAll<HTMLButtonElement>('[data-format-dir]').forEach(button => button.addEventListener('click', () => { draft.direction = button.dataset.formatDir as 'ltr' | 'rtl'; paint(); }));
    modal.querySelectorAll<HTMLButtonElement>('[data-format-font]').forEach(button => button.addEventListener('click', () => { draft.fontFamily = button.dataset.formatFont || 'mono'; paint(); }));

    const close = () => modal.classList.add('hidden');
    document.getElementById('textFormattingSettingsBtn')!.addEventListener('click', () => { draft = currentDraft(); paint(); modal.classList.remove('hidden'); });
    document.getElementById('textFormattingCancelBtn')!.addEventListener('click', close);
    document.getElementById('textFormattingResetBtn')!.addEventListener('click', () => {
        draft = { paragraphs: true, colors: false, styles: false, textColor: '#ffffff', bgColor: '#000000', direction: 'ltr', fontFamily: 'mono' };
        paint();
    });
    document.getElementById('textFormattingSaveBtn')!.addEventListener('click', () => {
        state.config.preserveFormatting = draft.paragraphs;
        state.config.sourceColorsEnabled = draft.colors;
        state.config.sourceStylesEnabled = draft.styles;
        state.config.textFormattingEnabled = draft.colors || draft.styles;
        state.config.textColor = draft.textColor;
        state.config.bgColor = draft.bgColor;
        state.config.textDirection = draft.direction;
        state.config.fontFamily = draft.fontFamily;

        if (textColor) { textColor.value = draft.textColor; textColor.dispatchEvent(new Event('input', { bubbles: true })); }
        if (bgColor) { bgColor.value = draft.bgColor; bgColor.dispatchEvent(new Event('input', { bubbles: true })); }
        const dir = document.getElementById(draft.direction === 'ltr' ? 'dirLtrBtn' : 'dirRtlBtn'); dir?.click();
        const fontIds: Record<string, string> = { mono:'fontFamilyMonoBtn', sans:'fontFamilySansBtn', serif:'fontFamilySerifBtn', comicSans:'fontFamilyComicSansBtn', openDyslexic:'fontFamilyOpenDyslexicBtn' };
        document.getElementById(fontIds[draft.fontFamily] || fontIds.mono)?.click();
        window.dispatchEvent(new CustomEvent('vp-text-formatting-changed'));
        close();
    });
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
}

function installPasteCapture(input: HTMLTextAreaElement): void {
    input.addEventListener('paste', event => { pastedHtml = event.clipboardData?.getData('text/html') || null; }, true);
    input.addEventListener('input', event => {
        if ((event as InputEvent).isTrusted && !(event as InputEvent).inputType?.startsWith('insertFromPaste')) pastedHtml = null;
    });
}

function install(): void {
    installFormattingModal();
    const input = document.getElementById('inputScript') as HTMLTextAreaElement | null;
    if (input) installPasteCapture(input);
}

if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', install, { once: true }); else install();
