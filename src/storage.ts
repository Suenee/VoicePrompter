import { HistoryItem } from './types';

const HISTORY_KEY = 'teleprompter_history';
const SETTINGS_KEY = 'teleprompter_settings';

type StoredSettings = Record<string, unknown>;

/**
 * Loads the complete settings object from localStorage.
 * Returns an empty object if no settings have been stored yet
 * or if the stored data cannot be parsed.
 */
function getStoredSettings(): StoredSettings {
    try {
        const stored = localStorage.getItem(SETTINGS_KEY);

        if (!stored) {
            return {};
        }

        return JSON.parse(stored) as StoredSettings;
    } catch {
        return {};
    }
}

/**
 * Returns a stored setting.
 * If the requested setting does not exist,
 * the provided default value is returned instead.
 */
export function loadSetting<T>(key: string, defaultValue: T): T {
    const settings = getStoredSettings();
    const value = settings[key];

    return value === undefined
        ? defaultValue
        : (value as T);
}

/**
 * Saves or updates a single setting while preserving
 * all other previously stored settings.
 */
export function saveSetting<T>(key: string, value: T): void {
    const settings = getStoredSettings();

    settings[key] = value;

    localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify(settings)
    );
}

export function getHistory(): HistoryItem[] {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
}

export function saveToHistory(text: string, googleDocUrl?: string | null): void {
    let history = getHistory();
    if (history.length > 0 && history[0].text === text) return;

    const item: HistoryItem = {
        id: Date.now(),
        text: text,
        preview: text.substring(0, 40) + (text.length > 40 ? '...' : ''),
        date: new Date().toLocaleDateString(),
        ...(googleDocUrl ? { googleDocUrl } : {})
    };

    history.unshift(item);
    if (history.length > 10) history.pop();
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

export function clearAllHistory(): void {
    localStorage.removeItem(HISTORY_KEY);
}
