import { state } from './state';

let activeGoogleDocUrl: string | null = null;
let restartButtonOriginalHtml = '';
let restartButtonOriginalClass = '';
let restartButtonOriginalTitle = '';
let restartButtonCaptured = false;

function getRestartButton(): HTMLButtonElement | null {
    return document.getElementById('restartScriptBtn') as HTMLButtonElement | null;
}

function isPrompterActive(): boolean {
    const prompter = document.getElementById('prompterContainer');
    return !!prompter && !prompter.classList.contains('hidden');
}

function isSetupVisible(): boolean {
    const setup = document.getElementById('setupScreen');
    return !!setup && !setup.classList.contains('hidden');
}

function captureRestartButton(): HTMLButtonElement | null {
    const button = getRestartButton();
    if (!button) return null;

    if (!restartButtonCaptured) {
        restartButtonCaptured = true;
        restartButtonOriginalHtml = button.innerHTML;
        restartButtonOriginalClass = button.className;
        restartButtonOriginalTitle = button.title;
    }

    return button;
}

function renderRestartButton(syncing = false): void {
    const button = captureRestartButton();
    if (!button) return;

    const isGoogleDoc = !!state.googleDocUrl;
    if (!isGoogleDoc) {
        button.className = restartButtonOriginalClass;
        button.innerHTML = restartButtonOriginalHtml;
        button.title = restartButtonOriginalTitle || 'Restart Script';
        button.setAttribute('aria-label', button.title);
        button.disabled = false;
        return;
    }

    button.className = 'pointer-events-auto h-11 px-3 rounded-full bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/40 text-blue-300 hover:text-blue-200 transition-all flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-60 disabled:cursor-wait';
    button.title = 'Resync Google Doc';
    button.setAttribute('aria-label', button.title);
    button.disabled = syncing;
    button.innerHTML = syncing
        ? `<svg class="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9" /></svg><span class="text-[10px] font-bold tracking-wide">SYNC</span>`
        : `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg><span class="text-[10px] font-bold tracking-wide">SYNC</span>`;
}

function reconcileGoogleDocSource(): void {
    if (state.googleDocUrl) {
        activeGoogleDocUrl = state.googleDocUrl;
        renderRestartButton();
        return;
    }

    if (isSetupVisible()) {
        activeGoogleDocUrl = null;
        renderRestartButton();
        return;
    }

    // Internal reprocessing of the current script must never clear source metadata.
    if (activeGoogleDocUrl && isPrompterActive()) {
        state.googleDocUrl = activeGoogleDocUrl;
        document.getElementById('refreshGoogleDocContainer')?.classList.remove('hidden');
    }

    renderRestartButton();
}

function runGoogleDocResync(): void {
    if (!state.googleDocUrl) return;

    const settingsSync = document.getElementById('refreshGoogleDocBtn') as HTMLButtonElement | null;
    if (!settingsSync) {
        console.warn('[GoogleDoc] Resync button is unavailable');
        return;
    }

    renderRestartButton(true);
    settingsSync.click();

    const startedAt = Date.now();
    const timer = window.setInterval(() => {
        if (!settingsSync.disabled || Date.now() - startedAt > 15000) {
            window.clearInterval(timer);
            reconcileGoogleDocSource();
        }
    }, 100);
}

// Capture phase wins over the original restart click handler without changing
// goStart/restartScript semantics used elsewhere in the app and VPP.
document.addEventListener('click', event => {
    const target = event.target as Element | null;
    const restartButton = target?.closest('#restartScriptBtn');
    if (!restartButton || !state.googleDocUrl) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    runGoogleDocResync();
}, true);

// Preserve the Google Doc source across current internal reprocessing paths
// (for example Preserve Formatting), even though legacy loadScript(text)
// currently assigns null to state.googleDocUrl.
document.addEventListener('change', event => {
    const target = event.target as HTMLElement | null;
    if (target?.id !== 'preserveFormattingToggle' || !state.googleDocUrl) return;

    const sourceUrl = state.googleDocUrl;
    queueMicrotask(() => {
        if (!state.googleDocUrl && isPrompterActive()) {
            state.googleDocUrl = sourceUrl;
            activeGoogleDocUrl = sourceUrl;
            document.getElementById('refreshGoogleDocContainer')?.classList.remove('hidden');
            renderRestartButton();
        }
    });
}, true);

function initializeGoogleDocSyncUi(): void {
    captureRestartButton();
    reconcileGoogleDocSource();

    const observer = new MutationObserver(reconcileGoogleDocSource);
    ['setupScreen', 'prompterContainer', 'refreshGoogleDocContainer'].forEach(id => {
        const element = document.getElementById(id);
        if (element) observer.observe(element, { attributes: true, attributeFilter: ['class'] });
    });
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initializeGoogleDocSyncUi, { once: true });
} else {
    initializeGoogleDocSyncUi();
}
