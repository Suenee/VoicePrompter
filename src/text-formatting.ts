import { state } from './state';
import { extractDocId } from './gdoc';

type ColoredToken = { text: string; color?: string };

let pastedTokens: ColoredToken[] | null = null;
let renderGeneration = 0;

function cssColorFromElement(element: Element | null, classColors: Map<string, string>): string | undefined {
    let current: Element | null = element;
    while (current) {
        const inline = (current as HTMLElement).style?.color;
        if (inline) return inline;
        for (const className of Array.from(current.classList)) {
            const color = classColors.get(className);
            if (color) return color;
        }
        current = current.parentElement;
    }
    return undefined;
}

function parseHtmlTokens(html: string): ColoredToken[] {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const classColors = new Map<string, string>();

    for (const style of Array.from(doc.querySelectorAll('style'))) {
        const css = style.textContent || '';
        const rule = /\.([\w-]+)\s*\{([^}]*)\}/g;
        let match: RegExpExecArray | null;
        while ((match = rule.exec(css))) {
            const color = match[2].match(/(?:^|;)\s*color\s*:\s*([^;!]+)(?:\s*!important)?/i)?.[1]?.trim();
            if (color) classColors.set(match[1], color);
        }
    }

    const tokens: ColoredToken[] = [];
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
        const text = node.textContent || '';
        const color = cssColorFromElement(node.parentElement, classColors);
        for (const match of text.matchAll(/\S+/g)) tokens.push({ text: match[0], color });
    }
    return tokens;
}

function normalizeToken(value: string): string {
    return value.replace(/\u00a0/g, ' ').trim();
}

function applyTokens(tokens: ColoredToken[] | null): void {
    let tokenIndex = 0;
    for (const word of state.scriptWords) {
        if (!word.element || word.isBreak || word.isStop) continue;
        word.element.style.removeProperty('color');
        word.sourceColor = undefined;
        if (!state.config.textFormattingEnabled || !tokens) continue;

        const wanted = normalizeToken(word.word);
        while (tokenIndex < tokens.length && normalizeToken(tokens[tokenIndex].text) !== wanted) tokenIndex++;
        if (tokenIndex >= tokens.length) continue;

        const token = tokens[tokenIndex++];
        // Markers deliberately remain controlled by VoicePrompter styling.
        if (word.skip || word.element.closest('.slide-marker-row')) continue;
        if (!token.color) continue;
        word.sourceColor = token.color;
        word.element.style.color = token.color;
    }
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

async function fetchGoogleDocTokens(url: string): Promise<ColoredToken[] | null> {
    const docId = extractDocId(url);
    if (!docId) return null;
    const localProxy = window.location.port === '5173' || window.location.port === '4173';
    const proxyUrl = localProxy
        ? `/gdoc-proxy?id=${encodeURIComponent(docId)}&format=html`
        : `https://gdoc-proxy.kosuvorov.workers.dev/?id=${encodeURIComponent(docId)}&format=html`;

    try {
        const response = await fetch(proxyUrl, { cache: 'no-store' });
        if (!response.ok) return null;
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('text/html')) return parseHtmlTokens(await response.text());
        if (contentType.includes('zip') || contentType.includes('octet-stream')) {
            const html = await unzipFirstHtml(await response.arrayBuffer());
            return html ? parseHtmlTokens(html) : null;
        }
        return null;
    } catch (error) {
        console.warn('[Text Formatting] Could not retrieve Google Doc formatting:', error);
        return null;
    }
}

async function refreshFormatting(): Promise<void> {
    const generation = ++renderGeneration;
    if (!state.config.textFormattingEnabled) { applyTokens(null); return; }

    if (state.googleDocUrl) {
        const tokens = await fetchGoogleDocTokens(state.googleDocUrl);
        if (generation !== renderGeneration) return;
        applyTokens(tokens);
        return;
    }
    applyTokens(pastedTokens);
}

function insertSettingsToggle(): HTMLInputElement | null {
    const existing = document.getElementById('textFormattingToggle') as HTMLInputElement | null;
    if (existing) return existing;
    const preserve = document.getElementById('preserveFormattingToggle');
    const preserveRow = preserve?.closest('.flex.items-center.justify-between');
    if (!preserveRow?.parentElement) return null;

    const row = document.createElement('div');
    row.className = 'flex items-center justify-between';
    row.innerHTML = `
        <div class="flex flex-col">
            <span class="text-sm text-neutral-300">Text Formatting</span>
            <span class="text-xs text-neutral-500">Use supported formatting from source text</span>
        </div>
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
        const plain = event.clipboardData?.getData('text/plain') || '';
        if (!html || !plain) { pastedTokens = null; return; }

        const before = input.value.slice(0, input.selectionStart);
        const after = input.value.slice(input.selectionEnd);
        event.preventDefault();
        input.setRangeText(plain, input.selectionStart, input.selectionEnd, 'end');

        const beforeTokens = Array.from(before.matchAll(/\S+/g), match => ({ text: match[0] } as ColoredToken));
        const insertedTokens = parseHtmlTokens(html);
        const afterTokens = Array.from(after.matchAll(/\S+/g), match => ({ text: match[0] } as ColoredToken));
        pastedTokens = [...beforeTokens, ...insertedTokens, ...afterTokens];
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }, true);

    input.addEventListener('input', event => {
        if (!(event as InputEvent).inputType?.startsWith('insertFromPaste')) {
            // Keep the captured map for our own synthetic paste event; ordinary edits invalidate it.
            if ((event as InputEvent).isTrusted) pastedTokens = null;
        }
    });
}

function install(): void {
    const toggle = insertSettingsToggle();
    if (toggle) {
        toggle.checked = state.config.textFormattingEnabled;
        toggle.addEventListener('change', () => {
            state.config.textFormattingEnabled = toggle.checked;
            void refreshFormatting();
        });
    }

    const input = document.getElementById('inputScript') as HTMLTextAreaElement | null;
    if (input) installPasteCapture(input);

    const script = document.getElementById('scriptContent');
    if (script) {
        const observer = new MutationObserver(() => { void refreshFormatting(); });
        observer.observe(script, { childList: true, subtree: true });
    }

    window.addEventListener('vp-text-formatting-refresh', () => { void refreshFormatting(); });
}

if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', install, { once: true });
else install();
