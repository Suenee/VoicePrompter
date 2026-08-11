import { state } from './state';
import { advancePastSkipped, updateHighlight, scrollToCurrent } from './render';

function applyTarget(target: number): void {
    if (state.scriptWords.length === 0) return;
    state.currentIndex = Math.max(0, Math.min(target, state.scriptWords.length - 1));
    advancePastSkipped();
    updateHighlight();
    scrollToCurrent();
}

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

/** Jump to the first readable word immediately after the next cue [ ... ]. */
export function goNextCue(): void {
    if (state.scriptWords.length === 0) return;
    for (let i = state.currentIndex + 1; i < state.scriptWords.length; i++) {
        if (isCueStart(i)) {
            applyTarget(cueEnd(i) + 1);
            return;
        }
    }
}

/** Jump to the first readable word immediately after the previous cue [ ... ]. */
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
