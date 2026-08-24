import { els } from './elements';
import { state } from './state';
import { syncGoogleDocNow, setGoogleDocSourceUrl } from './google-doc-sync';

type ToggleState = 'on' | 'off' | 'toggle';
type Alignment = 'left' | 'center' | 'right';

function targetBoolean(current: boolean, requested: ToggleState): boolean {
    if (requested === 'toggle') return !current;
    return requested === 'on';
}

function dispatchInput(input: HTMLInputElement, value: number): void {
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

function dispatchCheckbox(input: HTMLInputElement, checked: boolean): void {
    if (input.checked === checked) return;
    input.checked = checked;
    input.dispatchEvent(new Event('change', { bubbles: true }));
}

export function setMicrophoneState(requested: ToggleState): void {
    const desired = targetBoolean(state.isListening, requested);
    if (desired === state.isListening) return;

    // Use the same button path as the local user operation. This preserves the
    // author's handling for voice, sound and constant scrolling modes and does
    // not introduce a second microphone implementation.
    els.micButton.click();
}

export function setFontSizePx(size: number): void {
    dispatchInput(els.fontSizeInput, size);
}

export function adjustFontSizePx(delta: number): void {
    const next = Math.max(20, Math.min(100, state.config.fontSize + delta));
    dispatchInput(els.fontSizeInput, next);
}

export function setVoiceCommandsState(requested: ToggleState): void {
    const desired = targetBoolean(state.config.voiceCommandsEnabled, requested);
    dispatchCheckbox(els.voiceCommandToggle, desired);
}

export function setRotateScreenState(requested: ToggleState): void {
    const desired = targetBoolean(state.isScreenRotated, requested);
    dispatchCheckbox(els.screenRotationToggle, desired);
}

export function setAlignment(align: Alignment): void {
    if (state.config.textAlign === align) return;
    els.alignBtns[align].click();
}

export function setMirrorModeState(requested: ToggleState): void {
    const desired = targetBoolean(state.isMirrored, requested);
    dispatchCheckbox(els.mirrorToggle, desired);
}

export function setRecordingDockOpacity(opacity: number): void {
    dispatchInput(els.dockOpacityInput, opacity);
}

export function adjustRecordingDockOpacity(delta: number): void {
    const next = Math.max(30, Math.min(100, state.config.dockOpacity + delta));
    dispatchInput(els.dockOpacityInput, next);
}

export async function syncGoogleDoc(): Promise<void> {
    await syncGoogleDocNow();
}

export async function setGoogleDocUrl(url: string): Promise<void> {
    setGoogleDocSourceUrl(url);
    await syncGoogleDocNow();
}
