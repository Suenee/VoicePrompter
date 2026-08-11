import { els } from './elements';
import { state } from './state';
import { HistoryItem } from './types';
import { remoteEventHooks } from './remote-event-hooks';

export function renderScript(): void {
    els.scriptContent.innerHTML = '';
    state.scriptWords.forEach((obj, index) => {
        const span = document.createElement('span');
        span.textContent = obj.word;
        span.id = `word-${index}`;
        let classList = "script-word transition-opacity duration-300 ";
        if (obj.isStop) classList += "stop-marker ";
        else if (obj.isBreak) { classList += "line-break "; span.style.display = 'block'; span.style.width = '100%'; }
        else if (obj.skip) classList += "skipped-word ";
        else classList += "text-future ";
        span.className = classList;
        span.onclick = () => { if (!obj.skip) { state.currentIndex = index; updateHighlight(); scrollToCurrent(); } };
        els.scriptContent.appendChild(span);
        obj.element = span;
    });
    wrapCueMarkers();
    if (state.config.showStopIcon) els.scriptContent.classList.add('show-stops');
    else els.scriptContent.classList.remove('show-stops');
    els.setupScreen.classList.add('hidden');
    els.prompterContainer.classList.remove('hidden');
    if (state.googleDocUrl) els.refreshGoogleDocContainer.classList.remove('hidden');
    else els.refreshGoogleDocContainer.classList.add('hidden');
    state.currentIndex = 0;
    advancePastSkipped();
    updateHighlight();
    setTimeout(() => scrollToCurrent(), 50);
}

/** Turns any [ ... ] cue directive into a full-width visual separator row. */
function wrapCueMarkers(): void {
    for (let i = 0; i < state.scriptWords.length; i++) {
        const first = state.scriptWords[i];
        if (!first.word.startsWith('[')) continue;
        let end = i;
        while (end < state.scriptWords.length && !state.scriptWords[end].word.includes(']')) {
            if (state.scriptWords[end].isBreak || state.scriptWords[end].isStop) break;
            end++;
        }
        if (end >= state.scriptWords.length || !state.scriptWords[end].word.includes(']')) continue;
        const firstElement = state.scriptWords[i].element;
        if (!firstElement || !firstElement.parentElement) continue;
        const row = document.createElement('div');
        row.className = 'slide-marker-row';
        firstElement.parentElement.insertBefore(row, firstElement);
        for (let j = i; j <= end; j++) { const element = state.scriptWords[j].element; if (element) row.appendChild(element); }
        i = end;
    }
}

export function updateHighlight(): void {
    state.scriptWords.forEach((obj, idx) => {
        if (obj.skip) return;
        if (idx < state.currentIndex) { if (obj.element) { obj.element.classList.remove('current-word', 'text-future'); obj.element.classList.add('text-neutral-500'); } }
        else if (idx === state.currentIndex) { if (obj.element) { obj.element.classList.remove('text-neutral-500', 'text-future'); obj.element.classList.add('current-word'); } }
        else { if (obj.element) { obj.element.classList.remove('current-word', 'text-neutral-500'); obj.element.classList.add('text-future'); } }
    });
}

export function scrollToCurrent(): void {
    if (state.currentIndex < state.scriptWords.length) {
        const currentWordObj = state.scriptWords[state.currentIndex];
        if (currentWordObj?.element) {
            const containerHeight = els.scrollContainer.clientHeight;
            const positionRatio = state.config.activeLinePosition / 100;
            const targetPosition = currentWordObj.element.offsetTop - (containerHeight * positionRatio);
            if (state.config.smoothAnimations) smoothScrollTo(els.scrollContainer, targetPosition, 600);
            else els.scrollContainer.scrollTo({ top: targetPosition, behavior: 'auto' });
        }
    }
}

function smoothScrollTo(element: HTMLElement, target: number, duration: number): void {
    const start = element.scrollTop, change = target - start, startTime = performance.now();
    function animateScroll(currentTime: number) {
        const timeElapsed = currentTime - startTime;
        const progress = Math.min(timeElapsed / duration, 1);
        const ease = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
        element.scrollTop = start + change * ease;
        if (timeElapsed < duration) requestAnimationFrame(animateScroll);
    }
    requestAnimationFrame(animateScroll);
}

export function advancePastSkipped(): void {
    while (state.currentIndex < state.scriptWords.length && state.scriptWords[state.currentIndex].skip) {
        const first = state.scriptWords[state.currentIndex];
        if (first.word.startsWith('[')) {
            const markerWords: string[] = [];
            let i = state.currentIndex;
            while (i < state.scriptWords.length && state.scriptWords[i].skip) {
                markerWords.push(state.scriptWords[i].word);
                const closesMarker = state.scriptWords[i].word.includes(']');
                i++;
                if (closesMarker) {
                    remoteEventHooks.HookMarker({ text: markerWords.join(' ') });
                    state.currentIndex = i;
                    break;
                }
            }
            if (state.currentIndex === i) continue;
        }
        state.currentIndex++;
    }
}

export function restartScript(): void {
    state.currentIndex = 0; advancePastSkipped(); updateHighlight(); scrollToCurrent();
}

export function navigateParagraphs(direction: 'back' | 'forward', paragraphCount: number): void {
    if (state.scriptWords.length === 0) return;
    const paragraphEnds: number[] = [];
    let lastWasBreak = false;
    state.scriptWords.forEach((w, i) => {
        if (w.isStop || w.isBreak) {
            if (!lastWasBreak) { paragraphEnds.push(i); lastWasBreak = true; }
            else paragraphEnds[paragraphEnds.length - 1] = i;
        } else if (!w.skip) lastWasBreak = false;
    });
    if (paragraphEnds.length === 0) state.scriptWords.forEach((w, i) => { if (!w.skip && /[.!?]$/.test(w.word)) paragraphEnds.push(i); });
    if (direction === 'back') {
        let target = 0, boundariesBefore = 0;
        for (let i = paragraphEnds.length - 1; i >= 0; i--) {
            if (paragraphEnds[i] < state.currentIndex) {
                boundariesBefore++;
                if (boundariesBefore >= paragraphCount) { target = i > 0 ? paragraphEnds[i - 1] + 1 : 0; break; }
            }
        }
        if (boundariesBefore < paragraphCount) target = 0;
        state.currentIndex = target;
    } else {
        let boundariesAfter = 0, target = state.scriptWords.length - 1;
        for (let i = 0; i < paragraphEnds.length; i++) {
            if (paragraphEnds[i] >= state.currentIndex) {
                boundariesAfter++;
                if (boundariesAfter >= paragraphCount) { target = paragraphEnds[i] + 1; break; }
            }
        }
        state.currentIndex = Math.min(target, state.scriptWords.length - 1);
    }
    advancePastSkipped(); updateHighlight(); scrollToCurrent();
}

export function applySettings(): void {
    els.appBody.style.backgroundColor = state.config.bgColor;
    els.appBody.style.color = state.config.textColor;
    els.appBody.style.setProperty('--base-color', state.config.textColor);
    const hex = state.config.bgColor.replace('#', '');
    if (/^[0-9a-f]{6}$/i.test(hex)) {
        const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
        const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        els.scriptContent.style.setProperty('--slide-marker-bg', luminance > 0.55 ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.06)');
    }
    els.prompterContainer.style.backgroundColor = state.config.bgColor;
    if (!(state.isVideoMode && state.videoLayoutMode === 'overlay')) els.scrollContainer.style.backgroundColor = state.config.bgColor;
    els.scriptContent.style.setProperty('--paragraph-spacing', `${state.config.paragraphSpacing}em`);
    els.scriptContent.style.lineHeight = `${state.config.lineHeight}`;
    els.scriptContent.style.textAlign = state.config.textAlign;
    els.scriptContent.style.direction = state.config.textDirection;
    if (state.config.smoothAnimations) els.scriptContent.classList.add('smooth-animations'); else els.scriptContent.classList.remove('smooth-animations');
    if (state.config.highlightActiveWord) els.scriptContent.classList.add('highlight-active-word'); else els.scriptContent.classList.remove('highlight-active-word');
    const fontMap: Record<string, string> = {
        mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        sans: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Arial, sans-serif',
        serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
        comicSans: '"Comic Sans MS", "Chalkboard SE", "Trebuchet MS", cursive',
        openDyslexic: '"OpenDyslexic", cursive'
    };
    els.scriptContent.style.fontFamily = fontMap[state.config.fontFamily] ?? fontMap['mono'];
}

export function updateMicUI(isListening: boolean): void {
    const isVoice = state.config.scrollingMode === 'voice';
    const pathEl = els.micButton.querySelector('path');
    if (isListening) {
        els.micButton.classList.remove('bg-neutral-800', 'hover:bg-neutral-700');
        els.micButton.classList.add('bg-red-600', 'hover:bg-red-700', 'animate-pulse');
        els.micIcon.classList.add('text-white');
        els.statusIndicator.textContent = isVoice ? "Listening..." : "Scrolling...";
        els.statusIndicator.classList.remove('text-neutral-500'); els.statusIndicator.classList.add('text-red-500');
        if (!isVoice && pathEl) pathEl.setAttribute('d', 'M6 19h4V5H6v14zm8-14v14h4V5h-4z');
    } else {
        els.micButton.classList.add('bg-neutral-800', 'hover:bg-neutral-700');
        els.micButton.classList.remove('bg-red-600', 'hover:bg-red-700', 'animate-pulse');
        els.micIcon.classList.remove('text-white');
        els.statusIndicator.textContent = isVoice ? "Tap mic to start" : "Tap play to start";
        els.statusIndicator.classList.add('text-neutral-500'); els.statusIndicator.classList.remove('text-red-500');
        if (!isVoice && pathEl) pathEl.setAttribute('d', 'M8 5v14l11-7z');
    }
}

export function renderHistoryList(history: HistoryItem[], onLoad: (text: string, googleDocUrl?: string | null) => void): void {
    els.historyList.innerHTML = '';
    if (history.length === 0) {
        els.historyList.innerHTML = `<div class="text-center py-8 border border-dashed border-neutral-800 rounded-lg text-neutral-600 text-sm">No previous scripts found</div>`;
        els.clearHistoryBtn.classList.add('hidden'); return;
    }
    els.clearHistoryBtn.classList.remove('hidden');
    history.forEach(item => {
        const div = document.createElement('div');
        div.className = "bg-neutral-800 p-3 rounded border border-neutral-700 hover:border-blue-500 cursor-pointer transition group flex justify-between items-center shadow-sm min-w-[85%] md:min-w-0 snap-center";
        div.onclick = () => { els.inputScript.value = item.text; onLoad(item.text, item.googleDocUrl || null); };
        div.innerHTML = `<div class="flex flex-col text-left overflow-hidden mr-2"><span class="text-gray-300 text-sm font-medium truncate font-mono">${item.preview}</span><div class="flex items-center gap-2"><span class="text-gray-500 text-xs">${item.date}</span>${item.tag ? `<span class="text-[9px] font-bold bg-[#FFBB00]/10 text-[#FFBB00] px-1.5 py-0.5 rounded-full uppercase tracking-wider">${item.tag}</span>` : ''}${item.googleDocUrl ? `<span class="text-[9px] font-bold bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded-full uppercase tracking-wider">Google Doc</span>` : ''}</div></div><div class="flex-shrink-0"><svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-blue-500 opacity-0 group-hover:opacity-100 transition" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg></div>`;
        els.historyList.appendChild(div);
    });
}
