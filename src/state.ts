import { AppConfig, AppState } from './types';
import { DEFAULT_APP_CONFIG, DEFAULT_USER_SETTINGS } from './default-settings';
import { loadSetting, saveSetting } from './storage';

const restoredConfig = Object.fromEntries(
    Object.entries(DEFAULT_APP_CONFIG).map(([key, defaultValue]) => [
        key,
        loadSetting(key, defaultValue)
    ])
) as unknown as AppConfig;

const persistentConfig = new Proxy(restoredConfig, {
    set(target, property, value) {
        Reflect.set(target, property, value);
        if (typeof property === 'string') saveSetting(property, value);
        return true;
    }
});

const initialState: AppState = {
    scriptWords: [],
    currentIndex: 0,
    recognition: null,
    isListening: false,
    isMirrored: loadSetting('isMirrored', DEFAULT_USER_SETTINGS.isMirrored),
    isMirroredH: loadSetting('isMirroredH', DEFAULT_USER_SETTINGS.isMirroredH),
    isScreenRotated: loadSetting('isScreenRotated', DEFAULT_USER_SETTINGS.isScreenRotated),
    selectedLanguage: 'en-US',
    languageSetting: DEFAULT_USER_SETTINGS.dictationLanguage,
    detectedLanguage: null,
    config: persistentConfig,
    isVideoMode: false,
    videoLayoutMode: 'split',
    facingMode: 'user',
    isRecording: false,
    mediaRecorder: null,
    mediaStream: null,
    recordedChunks: [],
    googleDocUrl: null,
    selectedVideoDeviceId: loadSetting('selectedVideoDeviceId', DEFAULT_USER_SETTINGS.selectedVideoDeviceId),
    selectedAudioDeviceId: loadSetting('selectedAudioDeviceId', DEFAULT_USER_SETTINGS.selectedAudioDeviceId)
};

const persistentStateKeys = new Set<keyof AppState>([
    'isMirrored',
    'isMirroredH',
    'isScreenRotated',
    'selectedVideoDeviceId',
    'selectedAudioDeviceId'
]);

export const state = new Proxy(initialState, {
    set(target, property, value) {
        Reflect.set(target, property, value);
        if (persistentStateKeys.has(property as keyof AppState)) {
            saveSetting(String(property), value);
        }
        return true;
    }
});
