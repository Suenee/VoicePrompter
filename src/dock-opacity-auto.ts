import { state } from './state';

export const CURSOR_VISIBILITY_CHANGED_EVENT = 'vp-cursor-visibility-changed';

const DOCK_OPACITY_AUTO = 0;
const DOCK_OPACITY_MIN = 30;
const DOCK_OPACITY_MAX = 100;
const AUTO_HIDDEN_OPACITY = 30;
const AUTO_VISIBLE_OPACITY = 100;
const SLIDER_FIXED_OFFSET = DOCK_OPACITY_MIN - 1;

let cursorHidden = false;
let controlInitialized = false;
let dockObserverInstalled = false;

function clampFixedOpacity(value: number): number {
    return Math.max(DOCK_OPACITY_MIN, Math.min(DOCK_OPACITY_MAX, Math.round(value)));
}

export function normalizeRecordingDockOpacity(value: number): number {
    if (!Number.isFinite(value)) return state.config.dockOpacity;
    if (value < DOCK_OPACITY_MIN) return DOCK_OPACITY_AUTO;
    return clampFixedOpacity(value);
}

function getDock(): HTMLElement | null {
    return document.getElementById('mainControlsDock');
}

function getInput(): HTMLInputElement | null {
    return document.getElementById('dockOpacityInput') as HTMLInputElement | null;
}

function getValueLabel(): HTMLElement | null {
    return document.getElementById('dockOpacityVal');
}

function sliderValueFromSetting(value: number): number {
    return value === DOCK_OPACITY_AUTO ? 0 : value - SLIDER_FIXED_OFFSET;
}

function settingFromSliderValue(value: number): number {
    return value <= 0 ? DOCK_OPACITY_AUTO : clampFixedOpacity(value + SLIDER_FIXED_OFFSET);
}

function updateControl(): void {
    const input = getInput();
    const label = getValueLabel();
    const value = normalizeRecordingDockOpacity(state.config.dockOpacity);

    if (input) input.value = String(sliderValueFromSetting(value));
    if (label) label.textContent = value === DOCK_OPACITY_AUTO ? 'Auto' : `${value}%`;
}

function getAutoVisualOpacity(): string {
    return String((cursorHidden ? AUTO_HIDDEN_OPACITY : AUTO_VISIBLE_OPACITY) / 100);
}

function applyVisualOpacity(): void {
    const dock = getDock();
    if (!dock) return;

    const value = normalizeRecordingDockOpacity(state.config.dockOpacity);
    if (value === DOCK_OPACITY_AUTO) {
        const desired = getAutoVisualOpacity();
        if (dock.style.opacity !== desired) dock.style.opacity = desired;
        return;
    }

    // Preserve the original meaning of the fixed setting: it applies while
    // the microphone/scrolling or recording state is active.
    const desired = state.isListening || state.isRecording ? String(value / 100) : '';
    if (dock.style.opacity !== desired) dock.style.opacity = desired;
}

function installDockObserver(): void {
    if (dockObserverInstalled) return;
    const dock = getDock();
    if (!dock) return;
    dockObserverInstalled = true;

    // Existing VP code also writes the dock opacity when the microphone state
    // changes. In Auto mode, immediately translate such writes back to the
    // cursor-driven 100%/30% visual value without adding a second activity timer.
    const observer = new MutationObserver(() => {
        if (normalizeRecordingDockOpacity(state.config.dockOpacity) === DOCK_OPACITY_AUTO) {
            applyVisualOpacity();
        }
    });
    observer.observe(dock, { attributes: true, attributeFilter: ['style'] });
}

export function setRecordingDockOpacityValue(value: number): number {
    const normalized = normalizeRecordingDockOpacity(value);
    state.config.dockOpacity = normalized;
    updateControl();
    applyVisualOpacity();
    return normalized;
}

export function adjustRecordingDockOpacityValue(delta: number): number {
    const current = normalizeRecordingDockOpacity(state.config.dockOpacity);
    let next: number;

    if (current === DOCK_OPACITY_AUTO) {
        next = delta > 0 ? normalizeRecordingDockOpacity(SLIDER_FIXED_OFFSET + delta) : DOCK_OPACITY_AUTO;
    } else {
        next = normalizeRecordingDockOpacity(current + delta);
    }

    return setRecordingDockOpacityValue(next);
}

function initializeControl(): void {
    if (controlInitialized) return;
    const input = getInput();
    if (!input) return;
    controlInitialized = true;

    // Slider positions are intentionally discrete: 0 = Auto, 1 = 30%,
    // 2 = 31%, ... 71 = 100%. Thus Auto is exactly one step left of 30%.
    input.min = '0';
    input.max = String(DOCK_OPACITY_MAX - SLIDER_FIXED_OFFSET);
    input.step = '1';
    const tooltip = 'Auto: controls stay at 100% while the mouse is active and fade to 30% when the cursor automatically hides.';
    input.title = tooltip;
    input.closest('.mb-4')?.setAttribute('title', tooltip);

    input.addEventListener('input', event => {
        // The original input handler assumes the slider value is the actual
        // percentage. Auto mode uses a mapped slider scale, so this handler is
        // authoritative and prevents the legacy handler from seeing raw values.
        event.stopImmediatePropagation();
        const raw = Number.parseInt(input.value, 10);
        setRecordingDockOpacityValue(settingFromSliderValue(raw));
    }, { capture: true });

    const normalized = normalizeRecordingDockOpacity(state.config.dockOpacity);
    if (normalized !== state.config.dockOpacity) state.config.dockOpacity = normalized;
    updateControl();
    installDockObserver();
    applyVisualOpacity();
}

window.addEventListener(CURSOR_VISIBILITY_CHANGED_EVENT, event => {
    const detail = (event as CustomEvent<{ hidden: boolean }>).detail;
    if (!detail) return;
    cursorHidden = detail.hidden;
    if (normalizeRecordingDockOpacity(state.config.dockOpacity) === DOCK_OPACITY_AUTO) {
        applyVisualOpacity();
    }
});

window.addEventListener('vp-synchronized-setting-changed', event => {
    const detail = (event as CustomEvent<{ setting?: string }>).detail;
    if (!detail) return;
    if (detail.setting === 'microphone' || detail.setting === 'recordingDockOpacity') {
        updateControl();
        applyVisualOpacity();
    }
});

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => window.setTimeout(initializeControl, 0), { once: true });
} else {
    window.setTimeout(initializeControl, 0);
}

window.addEventListener('pageshow', () => {
    initializeControl();
    updateControl();
    installDockObserver();
    applyVisualOpacity();
});
