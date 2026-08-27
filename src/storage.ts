import { HistoryItem } from './types';

const HISTORY_KEY = 'teleprompter_history';
const SETTINGS_KEY = 'teleprompter_settings';
const GDOC_REMEMBER_KEY = 'voiceprompter_gdoc_remember';

type StoredSettings = Record<string, unknown>;

function getStoredSettings(): StoredSettings {
    try {
        const stored = localStorage.getItem(SETTINGS_KEY);
        if (!stored) return {};
        return JSON.parse(stored) as StoredSettings;
    } catch {
        return {};
    }
}

export function loadSetting<T>(key: string, defaultValue: T): T {
    const settings = getStoredSettings();
    const value = settings[key];
    return value === undefined ? defaultValue : (value as T);
}

export function saveSetting<T>(key: string, value: T): void {
    const settings = getStoredSettings();
    settings[key] = value;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadSettings<T extends Record<string, unknown>>(defaults: T): T {
    return { ...defaults, ...getStoredSettings() } as T;
}

export function saveSettings(settings: StoredSettings): void {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/**
 * Clears user preferences and temporary UI remembers only.
 * Script history is deliberately preserved.
 */
export function resetSettings(): void {
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(GDOC_REMEMBER_KEY);
}

export function getHistory(): HistoryItem[] {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
}

function getGoogleDocIdentity(url: string): string {
    try {
        const parsed = new URL(url);
        const match = parsed.pathname.match(/^\/document\/d\/([^/]+)/);
        return match?.[1] ?? url;
    } catch {
        return url;
    }
}

export function saveToHistory(text: string, googleDocUrl?: string | null): void {
    let history = getHistory();

    if (googleDocUrl) {
        const documentId = getGoogleDocIdentity(googleDocUrl);
        history = history.filter(item =>
            !item.googleDocUrl || getGoogleDocIdentity(item.googleDocUrl) !== documentId
        );
    } else {
        history = history.filter(item => item.googleDocUrl || item.text !== text);
    }

    const item: HistoryItem = {
        id: Date.now(),
        text,
        preview: text.substring(0, 40) + (text.length > 40 ? '...' : ''),
        date: new Date().toLocaleDateString(),
        ...(googleDocUrl ? { googleDocUrl } : {})
    };

    history.unshift(item);
    history = history.slice(0, 10);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

export function clearAllHistory(): void {
    localStorage.removeItem(HISTORY_KEY);
}
