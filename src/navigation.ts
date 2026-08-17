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

/** Jump to the first readable word of the current paragraph.
 * If already there, fall back to the previous paragraph.
 */
export function goCurrentParagraph(): void {
    if (state.scriptWords.length === 0) return;

    let target = 0;
    for (let i = Math.min(state.currentIndex - 1, state.scriptWords.length - 1); i >= 0; i--) {
        if (state.scriptWords[i].isBreak || state.scriptWords[i].isStop) {
            target = i + 1;
            break;
        }
    }

    let readableTarget = target;
    while (readableTarget < state.scriptWords.length && state.scriptWords[readableTarget].skip) {
        readableTarget++;
    }

    if (state.currentIndex === readableTarget) {
        goPreviousParagraph();
        return;
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

function readableAfterCue(start: number): number {
    let target = cueEnd(start) + 1;
    while (target < state.scriptWords.length && state.scriptWords[target].skip) target++;
    return target;
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
        if (!isCueStart(i)) continue;
        if (readableAfterCue(i) < state.currentIndex) previousCue = i;
        i = cueEnd(i);
    }

    if (previousCue >= 0) applyTarget(cueEnd(previousCue) + 1);
}

/**
 * VPP markerBack semantics.
 * offset 0 targets the current marker (the latest marker preceding or
 * containing the current reading position); positive offsets walk farther
 * backward from that marker. The target is always the first readable content
 * after the selected marker.
 */
export function goMarkerBack(offset: number): void {
    if (state.scriptWords.length === 0 || !Number.isInteger(offset) || offset < 0) return;

    const cues: number[] = [];
    for (let i = 0; i <= state.currentIndex && i < state.scriptWords.length; i++) {
        if (!isCueStart(i)) continue;
        cues.push(i);
        i = cueEnd(i);
    }

    const targetCueIndex = cues.length - 1 - offset;
    if (targetCueIndex < 0) return;

    applyTarget(cueEnd(cues[targetCueIndex]) + 1);
}

export function goNextParagraph(): void { navigateParagraphs('forward', 1); }
export function goFinish(): void {
    if (state.scriptWords.length === 0) return;
    applyTarget(state.scriptWords.length - 1);
}

function applyConfiguredDockOpacity(): void {
    const dock = document.getElementById('mainControlsDock');
    if (!dock) return;
    dock.style.opacity = (state.config.dockOpacity / 100).toString();
}

function updateNavigationVisibility(): void {
    const group = document.getElementById('navigationControlsGroup');
    if (!group) return;
    group.classList.toggle('hidden', !state.config.navigationControlsEnabled);
}

function createNavigationSettingsToggle(): void {
    if (document.getElementById('navigationControlsToggle')) return;

    const voiceToggle = document.getElementById('voiceCommandToggle');
    const voiceRow = voiceToggle?.closest('.flex.items-center.justify-between');
    if (!voiceRow) return;

    const row = document.createElement('div');
    row.id = 'navigationControlsSettingsRow';
    row.className = 'flex items-center justify-between';
    row.innerHTML = `
        <div class="flex flex-col min-w-0 pr-3">
            <span class="text-sm text-neutral-300">Navigation Controls</span>
            <span class="text-xs text-neutral-500">Show navigation buttons</span>
        </div>
        <label class="relative inline-flex items-center cursor-pointer flex-shrink-0">
            <input id="navigationControlsToggle" type="checkbox" class="sr-only peer">
            <div class="w-11 h-6 bg-neutral-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#FFBB00]"></div>
        </label>`;

    voiceRow.insertAdjacentElement('afterend', row);

    const toggle = document.getElementById('navigationControlsToggle') as HTMLInputElement;
    toggle.checked = state.config.navigationControlsEnabled;
    toggle.addEventListener('change', () => {
        state.config.navigationControlsEnabled = toggle.checked;
        updateNavigationVisibility();
    });
}

function initNavigationControls(): void {
    if (document.getElementById('navigationControlsGroup')) return;
    const mainDock = document.getElementById('mainControlsDock');
    if (!mainDock) return;

    const group = document.createElement('div');
    group.id = 'navigationControlsGroup';
    group.className = 'pointer-events-auto flex items-center gap-1 px-2 py-1.5 rounded-lg bg-neutral-900/80 backdrop-blur border border-neutral-700/70 shadow-lg font-mono text-sm text-neutral-300 flex-shrink-0';
    group.innerHTML = `
        <button data-nav="start" title="Go Start" class="min-w-8 h-8 px-1.5 rounded hover:bg-neutral-700 hover:text-white transition-colors">|&lt;</button>
        <button data-nav="previous-cue" title="Marker Back" class="min-w-8 h-8 px-1.5 rounded hover:bg-neutral-700 hover:text-[#FFBB00] transition-colors">[&lt;</button>
        <button data-nav="previous-paragraph" title="Go Back" class="min-w-8 h-8 px-1.5 rounded hover:bg-neutral-700 hover:text-white transition-colors">&lt;&lt;</button>
        <button data-nav="current-paragraph" title="Go Current" class="min-w-8 h-8 px-1.5 rounded hover:bg-neutral-700 hover:text-white transition-colors">&lt;|</button>
        <button data-nav="next-paragraph" title="Go Next" class="min-w-8 h-8 px-1.5 rounded hover:bg-neutral-700 hover:text-white transition-colors">&gt;&gt;</button>
        <button data-nav="next-cue" title="Marker Next" class="min-w-8 h-8 px-1.5 rounded hover:bg-neutral-700 hover:text-[#FFBB00] transition-colors">&gt;]</button>
        <button data-nav="finish" title="Go Finish" class="min-w-8 h-8 px-1.5 rounded hover:bg-neutral-700 hover:text-white transition-colors">&gt;|</button>`;

    mainDock.appendChild(group);
    mainDock.classList.remove('gap-6');
    mainDock.classList.add('gap-3', 'px-3', 'flex-wrap');

    const actions: Record<string, () => void> = {
        start: goStart,
        'previous-cue': goPreviousCue,
        'previous-paragraph': goPreviousParagraph,
        'current-paragraph': goCurrentParagraph,
        'next-paragraph': goNextParagraph,
        'next-cue': goNextCue,
        finish: goFinish
    };

    group.querySelectorAll<HTMLButtonElement>('button[data-nav]').forEach(button => {
        button.type = 'button';
        button.addEventListener('click', () => actions[button.dataset.nav || '']?.());
    });

    createNavigationSettingsToggle();
    updateNavigationVisibility();

    const opacityInput = document.getElementById('dockOpacityInput') as HTMLInputElement | null;
    opacityInput?.addEventListener('input', () => {
        requestAnimationFrame(applyConfiguredDockOpacity);
    });

    ['micButton', 'videoRecordBtn', 'videoStopBtn', 'videoModeBtn'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', () => {
            window.setTimeout(applyConfiguredDockOpacity, 0);
        });
    });

    applyConfiguredDockOpacity();
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initNavigationControls);
} else {
    initNavigationControls();
}
