import { AppConfig } from './types';

export const DEFAULT_APP_CONFIG: AppConfig = {
    fontSize: 40,
    lineHeight: 1.0,
    margin: 0,
    textColor: '#ffffff',
    bgColor: '#000000',
    textAlign: 'left',
    textDirection: 'ltr',
    showStopIcon: false,
    preserveFormatting: true,
    voiceCommandsEnabled: false,
    paragraphSpacing: 0.5,
    smoothAnimations: false,
    highlightActiveWord: true,
    activeLinePosition: 35,
    lookaheadWords: 5,
    dockOpacity: 50,
    fontFamily: 'mono',
    scrollingMode: 'voice',
    scrollSpeed: 3.5,
    soundSensitivity: 0.75
};

export const DEFAULT_USER_SETTINGS = {
    dictationLanguage: 'auto',
    isMirrored: false,
    isMirroredH: false,
    isScreenRotated: false,
    selectedVideoDeviceId: null as string | null,
    selectedAudioDeviceId: null as string | null
};
