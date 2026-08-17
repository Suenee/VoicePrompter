import { state } from './state';

let activeGoogleDocUrl: string | null = null;
let restartButtonOriginalHtml = '';
let restartButtonOriginalClass = '';
let restartButtonOriginalTitle = '';
let restartButtonCaptured = false;
let remoteConnected = false;

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

function syncIconHtml(syncing: boolean): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6${syncing ? ' animate-spin' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>`;
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

    button.className = restartButtonOriginalClass;
    button.classList.remove('text-neutral-400');
    button.classList.add('text-[#FFBB00]');
    button.title = 'Resync Google Doc';
    button.setAttribute('aria-label', button.title);
    button.disabled = syncing;
    button.innerHTML = syncIconHtml(syncing);
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

function isRemoteControlConnected(): boolean {
    const status = document.getElementById('remoteControlStatus');
    if (!status) return false;
    return status.textContent?.trim() === '✓' && status.title.startsWith('Connected:');
}

function reconcileRemoteConnection(): void {
    const connectedNow = isRemoteControlConnected();

    if (connectedNow && !remoteConnected) {
        window.dispatchEvent(new CustomEvent('vp-resync-current-marker'));
    }

    remoteConnected = connectedNow;
}

document.addEventListener('click', event => {
    const target = event.target as Element | null;
    const restartButton = target?.closest('#restartScriptBtn');
    if (!restartButton || !state.googleDocUrl) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    runGoogleDocResync();
}, true);

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

    const uiObserver = new MutationObserver(reconcileGoogleDocSource);
    ['setupScreen', 'prompterContainer', 'refreshGoogleDocContainer'].forEach(id => {
        const element = document.getElementById(id);
        if (element) uiObserver.observe(element, { attributes: true, attributeFilter: ['class'] });
    });

    const remoteStatus = document.getElementById('remoteControlStatus');
    if (remoteStatus) {
        remoteConnected = isRemoteControlConnected();
        const remoteObserver = new MutationObserver(reconcileRemoteConnection);
        remoteObserver.observe(remoteStatus, {
            attributes: true,
            attributeFilter: ['title'],
            childList: true,
            characterData: true,
            subtree: true
        });
    }
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initializeGoogleDocSyncUi, { once: true });
} else {
    initializeGoogleDocSyncUi();
}
