import { state, SYNCHRONIZED_SETTING_CHANGED_EVENT } from './state';

const CURSOR_VISIBILITY_CHANGED_EVENT = 'vp-cursor-visibility-changed';
const AUTO_SLIDER_VALUE = 29;
const FIXED_MIN = 30;
const FIXED_MAX = 100;
const AUTO_HIDDEN_OPACITY = 30;
const AUTO_VISIBLE_OPACITY = 100;
const STORAGE_KEY = 'voiceprompter_dock_opacity_auto';

let autoEnabled = localStorage.getItem(STORAGE_KEY) === 'true';
let cursorHidden = false;
let initialized = false;
let observerInstalled = false;

function input(): HTMLInputElement | null {
    return document.getElementById('dockOpacityInput') as HTMLInputElement | null;
}

function label(): HTMLElement | null {
    return document.getElementById('dockOpacityVal');
}

function dock(): HTMLElement | null {
    return document.getElementById('mainControlsDock');
}

function clampFixed(value: number): number {
    return Math.max(FIXED_MIN, Math.min(FIXED_MAX, Math.round(value)));
}

function emitSettingChanged(): void {
    window.dispatchEvent(new CustomEvent(SYNCHRONIZED_SETTING_CHANGED_EVENT, {
        detail: { setting: 'recordingDockOpacity', value: getRecordingDockOpacitySetting() }
    }));
}

function updateControl(): void {
    const control = input();
    const valueLabel = label();
    if (control) control.value = String(autoEnabled ? AUTO_SLIDER_VALUE : clampFixed(state.config.dockOpacity));
    if (valueLabel) valueLabel.textContent = autoEnabled ? 'Auto' : `${clampFixed(state.config.dockOpacity)}%`;
}

export function applyRecordingDockVisual(): void {
    const element = dock();
    if (!element) return;

    if (autoEnabled) {
        element.style.opacity = String((cursorHidden ? AUTO_HIDDEN_OPACITY : AUTO_VISIBLE_OPACITY) / 100);
        return;
    }

    element.style.opacity = state.isListening || state.isRecording
        ? String(clampFixed(state.config.dockOpacity) / 100)
        : '';
}

export function getRecordingDockOpacitySetting(): number {
    return autoEnabled ? 0 : clampFixed(state.config.dockOpacity);
}

export function setRecordingDockOpacitySetting(value: number): number {
    const nextAuto = Number.isFinite(value) && value < FIXED_MIN;
    const previousSetting = getRecordingDockOpacitySetting();

    if (nextAuto) {
        autoEnabled = true;
        localStorage.setItem(STORAGE_KEY, 'true');
    } else {
        autoEnabled = false;
        localStorage.removeItem(STORAGE_KEY);
        const fixed = clampFixed(value);
        if (state.config.dockOpacity !== fixed) state.config.dockOpacity = fixed;
    }

    updateControl();
    applyRecordingDockVisual();
    if (previousSetting !== getRecordingDockOpacitySetting()) emitSettingChanged();
    return getRecordingDockOpacitySetting();
}

export function adjustRecordingDockOpacitySetting(delta: number): number {
    if (!Number.isFinite(delta) || delta === 0) return getRecordingDockOpacitySetting();
    if (autoEnabled) {
        if (delta <= 0) return 0;
        return setRecordingDockOpacitySetting(FIXED_MIN + Math.round(delta) - 1);
    }
    return setRecordingDockOpacitySetting(state.config.dockOpacity + delta);
}

function installObserver(): void {
    if (observerInstalled) return;
    const element = dock();
    if (!element) return;
    observerInstalled = true;
    new MutationObserver(() => {
        if (autoEnabled) applyRecordingDockVisual();
    }).observe(element, { attributes: true, attributeFilter: ['style'] });
}

function initialize(): void {
    if (initialized) return;
    const control = input();
    if (!control) return;
    initialized = true;

    // Migrate the previous broken implementation, which persisted Auto as 0
    // in the ordinary percentage setting. Keep Auto, but restore a valid fixed
    // percentage underneath so legacy VP code can never make the dock invisible.
    if (!Number.isFinite(state.config.dockOpacity) || state.config.dockOpacity < FIXED_MIN) {
        autoEnabled = true;
        localStorage.setItem(STORAGE_KEY, 'true');
        state.config.dockOpacity = FIXED_MIN;
    }

    // Keep the original percentage scale intact. 29 is the one extra slider
    // position immediately left of the original 30% minimum and means Auto.
    control.min = String(AUTO_SLIDER_VALUE);
    control.max = String(FIXED_MAX);
    control.step = '1';
    const tooltip = 'Auto: controls are 100% visible while the mouse is active and fade to 30% when the cursor hides.';
    control.title = tooltip;
    control.closest('.mb-4')?.setAttribute('title', tooltip);

    // Only the special Auto position bypasses the original percentage handler.
    // Every normal value 30..100 continues through the original VP handler.
    control.addEventListener('input', event => {
        if (Number.parseInt(control.value, 10) !== AUTO_SLIDER_VALUE) return;
        event.stopImmediatePropagation();
        setRecordingDockOpacitySetting(0);
    }, { capture: true });

    // For normal slider values the original handler remains authoritative;
    // this listener only records that Auto has been left and refreshes visuals.
    control.addEventListener('input', () => {
        const value = Number.parseInt(control.value, 10);
        if (value < FIXED_MIN) return;
        const wasAuto = autoEnabled;
        autoEnabled = false;
        localStorage.removeItem(STORAGE_KEY);
        if (wasAuto) emitSettingChanged();
        updateControl();
        applyRecordingDockVisual();
    });

    updateControl();
    installObserver();
    applyRecordingDockVisual();
}

window.addEventListener(CURSOR_VISIBILITY_CHANGED_EVENT, event => {
    const detail = (event as CustomEvent<{ hidden: boolean }>).detail;
    if (!detail) return;
    cursorHidden = detail.hidden;
    if (autoEnabled) applyRecordingDockVisual();
});

window.addEventListener(SYNCHRONIZED_SETTING_CHANGED_EVENT, event => {
    const detail = (event as CustomEvent<{ setting?: string }>).detail;
    if (!detail || detail.setting !== 'microphone') return;
    applyRecordingDockVisual();
});

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => window.setTimeout(initialize, 0), { once: true });
} else {
    window.setTimeout(initialize, 0);
}

window.addEventListener('pageshow', () => {
    initialize();
    updateControl();
    installObserver();
    applyRecordingDockVisual();
});
