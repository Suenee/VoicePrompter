import { state } from './state';
import { remoteEventHooks } from './remote-event-hooks';

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

    // Preserve the original round button design. Only the icon color indicates
    // that the button now performs Google Doc synchronization.
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

    // Internal reprocessing of the active script must not silently forget
    // that the source is a Google Doc.
    if (activeGoogleDocUrl && isPrompterActive()) {
        state.googleDocUrl = activeGoogleDocUrl;
        document.getElementById('refreshGoogleDocContainer')?.classList.remove('hidden');
    }

    renderRestartButton();
}

export function setGoogleDocSourceUrl(url: string): void {
    state.googleDocUrl = url;
    activeGoogleDocUrl = url;

    const input = document.getElementById('googleDocUrlInput') as HTMLInputElement | null;
    if (input) input.value = url;

    if (isPrompterActive()) {
        document.getElementById('refreshGoogleDocContainer')?.classList.remove('hidden');
    }

    renderRestartButton();
}

export async function syncGoogleDocNow(): Promise<void> {
    if (!state.googleDocUrl) throw new Error('No Google Docs source is configured');

    const settingsSync = document.getElementById('refreshGoogleDocBtn') as HTMLButtonElement | null;
    if (!settingsSync) throw new Error('Google Docs synchronization control is unavailable');
    if (settingsSync.disabled) throw new Error('Google Docs synchronization is already running');

    renderRestartButton(true);
    const startedAt = Date.now();
    settingsSync.click();

    try {
        await new Promise<void>((resolve, reject) => {
            const timer = window.setInterval(() => {
                const elapsed = Date.now() - startedAt;
                const label = settingsSync.textContent?.trim() ?? '';

                if (label === 'Synced!') {
                    window.clearInterval(timer);
                    resolve();
                    return;
                }

                if (!settingsSync.disabled && elapsed > 100) {
                    window.clearInterval(timer);
                    reject(new Error('Google Docs synchronization failed'));
                    return;
                }

                if (elapsed > 20000) {
                    window.clearInterval(timer);
                    reject(new Error('Google Docs synchronization timed out'));
                }
            }, 50);
        });
    } finally {
        reconcileGoogleDocSource();
    }
}

function isRemoteControlConnected(): boolean {
    const status = document.getElementById('remoteControlStatus');
    if (!status) return false;
    return status.textContent?.trim() === '✓' && status.title.startsWith('Connected:');
}

/**
 * Returns the latest complete cue marker at or before the current reading
 * position. This deliberately works from state.scriptWords rather than the
 * rendered DOM so it also covers a marker placed at absolute document start.
 */
function findCurrentMarker(): string | null {
    if (state.scriptWords.length === 0) return null;

    const limit = Math.min(state.currentIndex, state.scriptWords.length - 1);
    let currentMarker: string | null = null;

    for (let i = 0; i <= limit; i++) {
        const first = state.scriptWords[i];
        if (!first.word.startsWith('[')) continue;

        const markerWords: string[] = [];
        let end = i;
        let closed = false;

        while (end < state.scriptWords.length) {
            const word = state.scriptWords[end];
            if (end > i && (word.isBreak || word.isStop)) break;

            markerWords.push(word.word);
            if (word.word.includes(']')) {
                closed = true;
                break;
            }
            end++;
        }

        if (closed) {
            currentMarker = markerWords.join(' ');
            i = end;
        }
    }

    return currentMarker;
}

function resyncCurrentMarker(): void {
    const marker = findCurrentMarker();
    if (!marker) return;

    remoteEventHooks.HookMarker({ marker });
    console.info('[VPP] Current marker resynced after BC connection:', marker);
}

function reconcileRemoteConnection(): void {
    const connectedNow = isRemoteControlConnected();

    // A marker may have been reached while VPB/BC was not ready yet. As soon
    // as the complete chain becomes connected, send the current marker once.
    if (connectedNow && !remoteConnected) {
        resyncCurrentMarker();
    }

    remoteConnected = connectedNow;
}

// Capture phase wins over the original restart click handler without changing
// goStart/restartScript semantics used elsewhere in the app and VPP.
document.addEventListener('click', event => {
    const target = event.target as Element | null;
    const restartButton = target?.closest('#restartScriptBtn');
    if (!restartButton || !state.googleDocUrl) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    void syncGoogleDocNow().catch(() => {
        // The existing local refresh handler already presents the failure.
    });
}, true);

// Preserve the Google Doc source across current internal reprocessing paths
// such as Preserve Formatting.
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
