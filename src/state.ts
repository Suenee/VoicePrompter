import { AppConfig, AppState } from './types';
import { DEFAULT_APP_CONFIG, DEFAULT_USER_SETTINGS } from './default-settings';
import { loadSetting, resetSettings, saveSetting } from './storage';

const restoredConfig = Object.fromEntries(
    Object.entries(DEFAULT_APP_CONFIG).map(([key, defaultValue]) => [key, loadSetting(key, defaultValue)])
) as unknown as AppConfig;

const persistentConfig = new Proxy(restoredConfig, {
    set(target, property, value) {
        Reflect.set(target, property, value);
        if (typeof property === 'string') saveSetting(property, value);
        return true;
    }
});

const initialState: AppState = {
    scriptWords: [], currentIndex: 0, recognition: null, isListening: false,
    isMirrored: loadSetting('isMirrored', DEFAULT_USER_SETTINGS.isMirrored),
    isMirroredH: loadSetting('isMirroredH', DEFAULT_USER_SETTINGS.isMirroredH),
    isScreenRotated: loadSetting('isScreenRotated', DEFAULT_USER_SETTINGS.isScreenRotated),
    selectedLanguage: 'en-US', languageSetting: DEFAULT_USER_SETTINGS.dictationLanguage, detectedLanguage: null,
    config: persistentConfig,
    isVideoMode: false, videoLayoutMode: 'split', facingMode: 'user', isRecording: false,
    mediaRecorder: null, mediaStream: null, recordedChunks: [], googleDocUrl: null,
    selectedVideoDeviceId: loadSetting('selectedVideoDeviceId', DEFAULT_USER_SETTINGS.selectedVideoDeviceId),
    selectedAudioDeviceId: loadSetting('selectedAudioDeviceId', DEFAULT_USER_SETTINGS.selectedAudioDeviceId)
};

const persistentStateKeys = new Set<keyof AppState>([
    'isMirrored', 'isMirroredH', 'isScreenRotated', 'selectedVideoDeviceId', 'selectedAudioDeviceId'
]);

export const state = new Proxy(initialState, {
    set(target, property, value) {
        Reflect.set(target, property, value);
        if (persistentStateKeys.has(property as keyof AppState)) saveSetting(String(property), value);
        return true;
    }
});

window.addEventListener('DOMContentLoaded', () => {
    const setCheckbox = (id: string, checked: boolean) => {
        const input = document.getElementById(id) as HTMLInputElement | null;
        if (input) input.checked = checked;
    };
    const setInput = (id: string, value: string) => {
        const input = document.getElementById(id) as HTMLInputElement | null;
        if (input) input.value = value;
    };
    const setText = (id: string, value: string) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };

    setCheckbox('mirrorToggle', state.isMirrored);
    setCheckbox('hMirrorToggle', state.isMirroredH);
    setCheckbox('screenRotationToggle', state.isScreenRotated);
    setCheckbox('stopSignToggle', state.config.showStopIcon);
    setCheckbox('voiceCommandToggle', state.config.voiceCommandsEnabled);
    setCheckbox('preserveFormattingToggle', state.config.preserveFormatting);
    setCheckbox('smoothAnimationsToggle', state.config.smoothAnimations);
    setCheckbox('highlightActiveWordToggle', state.config.highlightActiveWord);

    setInput('fontSizeInput', String(state.config.fontSize));
    setInput('lineHeightInput', String(state.config.lineHeight));
    setInput('paragraphSpacingInput', String(state.config.paragraphSpacing));
    setInput('marginInput', String(state.config.margin));
    setInput('dockOpacityInput', String(state.config.dockOpacity));
    setInput('activeLinePositionInput', String(state.config.activeLinePosition));
    setInput('lookaheadWordsInput', String(state.config.lookaheadWords));
    setInput('scrollSpeedInput', String(state.config.scrollSpeed));
    setInput('soundSensitivityInput', String(state.config.soundSensitivity));
    setInput('textColorInput', state.config.textColor);
    setInput('bgColorInput', state.config.bgColor);

    setText('fontSizeVal', `${state.config.fontSize}px`);
    setText('lineHeightVal', `${state.config.lineHeight}x`);
    setText('paragraphSpacingVal', `${state.config.paragraphSpacing}em`);
    setText('marginVal', `${state.config.margin}%`);
    setText('dockOpacityVal', `${state.config.dockOpacity}%`);
    setText('activeLinePositionVal', `${state.config.activeLinePosition}%`);
    setText('lookaheadWordsVal', String(state.config.lookaheadWords));
    setText('scrollSpeedVal', `${state.config.scrollSpeed} w/s`);
    setText('soundSensitivityVal', `${Math.round(state.config.soundSensitivity * 100)}%`);

    const scriptContent = document.getElementById('scriptContent');
    if (scriptContent) {
        scriptContent.style.fontSize = `${state.config.fontSize}px`;
        scriptContent.style.lineHeight = String(state.config.lineHeight);
        scriptContent.style.paddingLeft = `${state.config.margin}%`;
        scriptContent.style.paddingRight = `${state.config.margin}%`;
        scriptContent.style.setProperty('--paragraph-spacing', `${state.config.paragraphSpacing}em`);
    }

    document.getElementById('scrollContainer')?.classList.toggle('mirror-mode', state.isMirrored);
    document.getElementById('scrollContainer')?.classList.toggle('mirror-mode-h', state.isMirroredH);
    document.body.classList.toggle('screen-rotated', state.isScreenRotated);

    const scrollingMode = document.getElementById('scrollingModeSelect') as HTMLSelectElement | null;
    if (scrollingMode) {
        scrollingMode.value = state.config.scrollingMode;
        scrollingMode.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const settingsPanel = document.getElementById('settingsPanel');
    if (settingsPanel && !document.getElementById('resetSettingsDefaultsBtn')) {
        const resetSection = document.createElement('div');
        resetSection.className = 'mt-6 pt-4 border-t border-neutral-800';
        resetSection.innerHTML = `
            <button id="resetSettingsDefaultsBtn" type="button"
                title="Restores application settings only. Script history is preserved."
                class="w-full px-4 py-3 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-sm font-medium text-neutral-300 hover:text-white transition-colors border border-neutral-700">
                Reset Settings to Defaults
            </button>
        `;
        settingsPanel.appendChild(resetSection);

        document.getElementById('resetSettingsDefaultsBtn')?.addEventListener('click', () => {
            if (!window.confirm('Reset all VoicePrompter settings to their original defaults?\n\nYour script history will be preserved.')) return;
            resetSettings();
            window.location.reload();
        });
    }
});
