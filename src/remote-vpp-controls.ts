import { state } from './state';
import { syncGoogleDocNow, setGoogleDocSourceUrl } from './google-doc-sync';
import {
    adjustRecordingDockOpacitySetting,
    setRecordingDockOpacitySetting
} from './dock-opacity-auto';

type ToggleState = 'on' | 'off' | 'toggle';
type Alignment = 'left' | 'center' | 'right';

function element<T extends HTMLElement>(id: string): T {
    const value = document.getElementById(id);
    if (!value) throw new Error(`VoicePrompter control is unavailable: #${id}`);
    return value as T;
}

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
    element<HTMLElement>('micButton').click();
}

export function setFontSizePx(size: number): void {
    dispatchInput(element<HTMLInputElement>('fontSizeInput'), size);
}

export function adjustFontSizePx(delta: number): void {
    const next = Math.max(20, Math.min(100, state.config.fontSize + delta));
    dispatchInput(element<HTMLInputElement>('fontSizeInput'), next);
}

export function setVoiceCommandsState(requested: ToggleState): void {
    const desired = targetBoolean(state.config.voiceCommandsEnabled, requested);
    dispatchCheckbox(element<HTMLInputElement>('voiceCommandToggle'), desired);
}

export function setRotateScreenState(requested: ToggleState): void {
    const desired = targetBoolean(state.isScreenRotated, requested);
    dispatchCheckbox(element<HTMLInputElement>('screenRotationToggle'), desired);
}

export function setAlignment(align: Alignment): void {
    if (state.config.textAlign === align) return;
    element<HTMLElement>(align === 'left' ? 'alignLeftBtn' : align === 'center' ? 'alignCenterBtn' : 'alignRightBtn').click();
}

export function setMirrorModeState(requested: ToggleState): void {
    const desired = targetBoolean(state.isMirrored, requested);
    dispatchCheckbox(element<HTMLInputElement>('mirrorToggle'), desired);
}

export function setRecordingDockOpacity(opacity: number): void {
    setRecordingDockOpacitySetting(opacity);
}

export function adjustRecordingDockOpacity(delta: number): void {
    adjustRecordingDockOpacitySetting(delta);
}

export async function syncGoogleDoc(): Promise<void> {
    await syncGoogleDocNow();
}

export async function setGoogleDocUrl(url: string): Promise<void> {
    const previousUrl = state.googleDocUrl;
    setGoogleDocSourceUrl(url);

    try {
        await syncGoogleDocNow();
    } catch (error) {
        // setGoogleDocUrl is atomic from the protocol point of view: a failed
        // source must not replace the last known-good Google Doc setting.
        setGoogleDocSourceUrl(previousUrl ?? '');
        if (!previousUrl) {
            document.getElementById('refreshGoogleDocContainer')?.classList.add('hidden');
        }
        throw error;
    }
}
