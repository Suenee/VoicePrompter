import { AppState } from './types';
import { DEFAULT_APP_CONFIG, DEFAULT_USER_SETTINGS } from './default-settings';

export const state: AppState = {
    scriptWords: [],
    currentIndex: 0,
    recognition: null,
    isListening: false,
    isMirrored: DEFAULT_USER_SETTINGS.isMirrored,
    isMirroredH: DEFAULT_USER_SETTINGS.isMirroredH,
    isScreenRotated: DEFAULT_USER_SETTINGS.isScreenRotated,
    selectedLanguage: 'en-US', // Target language for SpeechRecognition
    languageSetting: DEFAULT_USER_SETTINGS.dictationLanguage, // User's dropdown preference
    detectedLanguage: null,
    config: { ...DEFAULT_APP_CONFIG },
    // Video recording state
    isVideoMode: false,
    videoLayoutMode: 'split',
    facingMode: 'user',
    isRecording: false,
    mediaRecorder: null,
    mediaStream: null,
    recordedChunks: [],
    googleDocUrl: null,
    selectedVideoDeviceId: DEFAULT_USER_SETTINGS.selectedVideoDeviceId,
    selectedAudioDeviceId: DEFAULT_USER_SETTINGS.selectedAudioDeviceId
};
