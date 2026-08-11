import { goStart, goPreviousParagraph, goCurrentParagraph, goPreviousCue, goNextCue, goNextParagraph, goFinish } from './navigation';

export function initNavigationControls(): void {
    if (document.getElementById('navigationControlsDock')) return;

    const mainDock = document.getElementById('mainControlsDock');
    if (!mainDock?.parentElement) return;

    const dock = document.createElement('div');
    dock.id = 'navigationControlsDock';
    dock.className = 'fixed bottom-[7.25rem] left-0 right-0 z-[9998] flex justify-center pointer-events-none';
    dock.innerHTML = `
        <div class="pointer-events-auto flex items-center gap-1 px-2 py-1.5 rounded-lg bg-neutral-900/80 backdrop-blur border border-neutral-700/70 shadow-lg font-mono text-sm text-neutral-300">
            <button type="button" data-nav="start" title="Go Start" class="min-w-9 h-8 px-2 rounded hover:bg-neutral-700 hover:text-white transition-colors">|&lt;</button>
            <button type="button" data-nav="previous-paragraph" title="Previous Paragraph" class="min-w-9 h-8 px-2 rounded hover:bg-neutral-700 hover:text-white transition-colors">&lt;&lt;</button>
            <button type="button" data-nav="current-paragraph" title="Current Paragraph Start" class="min-w-9 h-8 px-2 rounded hover:bg-neutral-700 hover:text-white transition-colors">&lt;|</button>
            <span class="w-px h-5 bg-neutral-700 mx-0.5"></span>
            <button type="button" data-nav="previous-cue" title="Previous Cue" class="min-w-9 h-8 px-2 rounded hover:bg-neutral-700 hover:text-[#FFBB00] transition-colors">[&lt;</button>
            <button type="button" data-nav="next-cue" title="Next Cue" class="min-w-9 h-8 px-2 rounded hover:bg-neutral-700 hover:text-[#FFBB00] transition-colors">&gt;]</button>
            <span class="w-px h-5 bg-neutral-700 mx-0.5"></span>
            <button type="button" data-nav="next-paragraph" title="Next Paragraph" class="min-w-9 h-8 px-2 rounded hover:bg-neutral-700 hover:text-white transition-colors">&gt;&gt;</button>
            <button type="button" data-nav="finish" title="Go Finish" class="min-w-9 h-8 px-2 rounded hover:bg-neutral-700 hover:text-white transition-colors">&gt;|</button>
        </div>`;

    mainDock.parentElement.insertBefore(dock, mainDock);

    const actions: Record<string, () => void> = {
        'start': goStart,
        'previous-paragraph': goPreviousParagraph,
        'current-paragraph': goCurrentParagraph,
        'previous-cue': goPreviousCue,
        'next-cue': goNextCue,
        'next-paragraph': goNextParagraph,
        'finish': goFinish
    };

    dock.querySelectorAll<HTMLButtonElement>('button[data-nav]').forEach(button => {
        button.addEventListener('click', () => actions[button.dataset.nav || '']?.());
    });
}
