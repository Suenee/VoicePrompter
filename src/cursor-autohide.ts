const CURSOR_HIDE_DELAY_MS = 3000;

let hideTimer: number | null = null;
let cursorHidden = false;

function getPrompter(): HTMLElement | null {
    return document.getElementById('prompterContainer');
}

function isVisible(element: HTMLElement | null): boolean {
    return !!element && !element.classList.contains('hidden');
}

function hasVisibleModal(): boolean {
    const knownModalIds = ['googleDocModal'];
    if (knownModalIds.some(id => isVisible(document.getElementById(id)))) return true;

    return Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]'))
        .some(element => isVisible(element));
}

function canHideCursor(): boolean {
    const prompter = getPrompter();
    if (!isVisible(prompter)) return false;

    const setupScreen = document.getElementById('setupScreen');
    if (isVisible(setupScreen)) return false;

    const settingsPanel = document.getElementById('settingsPanel');
    if (isVisible(settingsPanel)) return false;

    if (hasVisibleModal()) return false;
    if (!document.hasFocus()) return false;

    return true;
}

function clearHideTimer(): void {
    if (hideTimer !== null) {
        window.clearTimeout(hideTimer);
        hideTimer = null;
    }
}

function showCursor(): void {
    clearHideTimer();
    const prompter = getPrompter();
    if (prompter && cursorHidden) prompter.style.cursor = '';
    cursorHidden = false;
}

function hideCursor(): void {
    hideTimer = null;
    if (!canHideCursor()) {
        showCursor();
        return;
    }

    const prompter = getPrompter();
    if (!prompter) return;
    prompter.style.cursor = 'none';
    cursorHidden = true;
}

function armHideTimer(): void {
    showCursor();
    if (!canHideCursor()) return;
    hideTimer = window.setTimeout(hideCursor, CURSOR_HIDE_DELAY_MS);
}

function handleActivity(): void {
    armHideTimer();
}

function handleWindowLeave(): void {
    // Never let a hidden VP cursor leak into another window or monitor.
    showCursor();
}

function initializeCursorAutoHide(): void {
    document.addEventListener('mousemove', handleActivity, { passive: true });
    document.addEventListener('mousedown', handleActivity, { passive: true });
    document.addEventListener('wheel', handleActivity, { passive: true });
    document.addEventListener('touchstart', handleActivity, { passive: true });
    document.addEventListener('keydown', handleActivity);

    // relatedTarget === null means the pointer left the browser document/window.
    document.addEventListener('mouseout', event => {
        if (event.relatedTarget === null) handleWindowLeave();
    });

    window.addEventListener('blur', handleWindowLeave);
    window.addEventListener('focus', armHideTimer);

    const observer = new MutationObserver(() => {
        if (!canHideCursor()) showCursor();
        else if (!cursorHidden && hideTimer === null) armHideTimer();
    });

    ['setupScreen', 'prompterContainer', 'settingsPanel', 'googleDocModal'].forEach(id => {
        const element = document.getElementById(id);
        if (element) observer.observe(element, { attributes: true, attributeFilter: ['class'] });
    });

    armHideTimer();
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initializeCursorAutoHide, { once: true });
} else {
    initializeCursorAutoHide();
}
