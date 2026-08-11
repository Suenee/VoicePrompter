import { state } from './state';
import { advancePastSkipped, updateHighlight, scrollToCurrent, restartScript, navigateParagraphs } from './render';

function applyTarget(target: number): void {
    if (state.scriptWords.length === 0) return;
    state.currentIndex = Math.max(0, Math.min(target, state.scriptWords.length - 1));
    advancePastSkipped();
    updateHighlight();
    scrollToCurrent();
}

export function goStart(): void { restartScript(); }
export function goPreviousParagraph(): void { navigateParagraphs('back', 1); }

/** Jump to the first readable word of the paragraph containing currentIndex. */
export function goCurrentParagraph(): void {
    if (state.scriptWords.length === 0) return;
    let target = 0;
    for (let i = Math.min(state.currentIndex - 1, state.scriptWords.length - 1); i >= 0; i--) {
        if (state.scriptWords[i].isBreak || state.scriptWords[i].isStop) {
            target = i + 1;
            break;
        }
    }
    applyTarget(target);
}

function isCueStart(index: number): boolean {
    return index >= 0 && index < state.scriptWords.length && state.scriptWords[index].word.startsWith('[');
}

function cueEnd(start: number): number {
    for (let i = start; i < state.scriptWords.length; i++) {
        if (state.scriptWords[i].word.includes(']')) return i;
        if (i > start && (state.scriptWords[i].isBreak || state.scriptWords[i].isStop)) break;
    }
    return start;
}

export function goNextCue(): void {
    if (state.scriptWords.length === 0) return;
    for (let i = state.currentIndex + 1; i < state.scriptWords.length; i++) {
        if (isCueStart(i)) {
            applyTarget(cueEnd(i) + 1);
            return;
        }
    }
}

export function goPreviousCue(): void {
    if (state.scriptWords.length === 0) return;
    let previousCue = -1;
    for (let i = 0; i < state.currentIndex; i++) {
        if (isCueStart(i)) {
            previousCue = i;
            i = cueEnd(i);
        }
    }
    if (previousCue >= 0) applyTarget(cueEnd(previousCue) + 1);
}

export function goNextParagraph(): void { navigateParagraphs('forward', 1); }
export function goFinish(): void {
    if (state.scriptWords.length === 0) return;
    applyTarget(state.scriptWords.length - 1);
}

function initNavigationControls(): void {
    if (document.getElementById('navigationControlsDock')) return;
    const mainDock = document.getElementById('mainControlsDock');
    if (!mainDock?.parentElement) return;

    const dock = document.createElement('div');
    dock.id = 'navigationControlsDock';
    dock.className = 'fixed bottom-[7.25rem] left-0 right-0 z-[9998] flex justify-center pointer-events-none';
    dock.innerHTML = `
        <div class="pointer-events-auto flex items-center gap-1 px-2 py-1.5 rounded-lg bg-neutral-900/80 backdrop-blur border border-neutral-700/70 shadow-lg font-mono text-sm text-neutral-300">
            <button data-nav="start" title="Go Start" class="min-w-9 h-8 px-2 rounded hover:bg-neutral-700 hover:text-white">|&lt;</button>
            <button data-nav="previous-paragraph" title="Previous Paragraph" class="min-w-9 h-8 px-2 rounded hover:bg-neutral-700 hover:text-white">&lt;&lt;</button>
            <button data-nav="current-paragraph" title="Current Paragraph Start" class="min-w-9 h-8 px-2 rounded hover:bg-neutral-700 hover:text-white">&lt;|</button>
            <span class="w-px h-5 bg-neutral-700 mx-0.5"></span>
            <button data-nav="previous-cue" title="Previous Cue" class="min-w-9 h-8 px-2 rounded hover:bg-neutral-700 hover:text-[#FFBB00]">[&lt;</button>
            <button data-nav="next-cue" title="Next Cue" class="min-w-9 h-8 px-2 rounded hover:bg-neutral-700 hover:text-[#FFBB00]">&gt;]</button>
            <span class="w-px h-5 bg-neutral-700 mx-0.5"></span>
            <button data-nav="next-paragraph" title="Next Paragraph" class="min-w-9 h-8 px-2 rounded hover:bg-neutral-700 hover:text-white">&gt;&gt;</button>
            <button data-nav="finish" title="Go Finish" class="min-w-9 h-8 px-2 rounded hover:bg-neutral-700 hover:text-white">&gt;|</button>
        </div>`;
    mainDock.parentElement.insertBefore(dock, mainDock);

    const actions: Record<string, () => void> = {
        start: goStart,
        'previous-paragraph': goPreviousParagraph,
        'current-paragraph': goCurrentParagraph,
        'previous-cue': goPreviousCue,
        'next-cue': goNextCue,
        'next-paragraph': goNextParagraph,
        finish: goFinish
    };
    dock.querySelectorAll<HTMLButtonElement>('button[data-nav]').forEach(button => {
        button.type = 'button';
        button.addEventListener('click', () => actions[button.dataset.nav || '']?.());
    });
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initNavigationControls);
} else {
    initNavigationControls();
}
