import { loadSetting, saveSetting } from './storage';
import { state } from './state';

const DEFAULT_IP = '127.0.0.1';
const DEFAULT_PORT = 8170;
const DEFAULT_API_KEY = '';
const GDOC_REMEMBER_KEY = 'voiceprompter_gdoc_remember';
const GDOC_REMEMBER_DAYS = 7;

const SUPPORTED_BROWSER_LANGS: Record<string, { id: string; name: string }> = {
    en: { id: 'en-US', name: 'English' },
    es: { id: 'es-ES', name: 'Spanish' },
    fr: { id: 'fr-FR', name: 'French' },
    de: { id: 'de-DE', name: 'German' },
    it: { id: 'it-IT', name: 'Italian' },
    pt: { id: 'pt-PT', name: 'Portuguese' },
    ru: { id: 'ru-RU', name: 'Russian' },
    ja: { id: 'ja-JP', name: 'Japanese' },
    zh: { id: 'zh-CN', name: 'Chinese' },
    ko: { id: 'ko-KR', name: 'Korean' },
    ar: { id: 'ar-SA', name: 'Arabic' },
    nl: { id: 'nl-NL', name: 'Dutch' },
    pl: { id: 'pl-PL', name: 'Polish' },
    uk: { id: 'uk-UA', name: 'Ukrainian' },
    hi: { id: 'hi-IN', name: 'Hindi' },
    tr: { id: 'tr-TR', name: 'Turkish' },
    sv: { id: 'sv-SE', name: 'Swedish' },
    da: { id: 'da-DK', name: 'Danish' },
    fi: { id: 'fi-FI', name: 'Finnish' },
    no: { id: 'no-NO', name: 'Norwegian' },
    id: { id: 'id-ID', name: 'Indonesian' },
    ms: { id: 'ms-MY', name: 'Malay' },
    ca: { id: 'ca-ES', name: 'Catalan' },
    cs: { id: 'cs-CZ', name: 'Czech' },
    el: { id: 'el-GR', name: 'Greek' },
    he: { id: 'he-IL', name: 'Hebrew' },
    hu: { id: 'hu-HU', name: 'Hungarian' },
    ro: { id: 'ro-RO', name: 'Romanian' },
    sk: { id: 'sk-SK', name: 'Slovak' },
    th: { id: 'th-TH', name: 'Thai' },
    vi: { id: 'vi-VN', name: 'Vietnamese' },
    bg: { id: 'bg-BG', name: 'Bulgarian' },
    hr: { id: 'hr-HR', name: 'Croatian' },
    sr: { id: 'sr-RS', name: 'Serbian' }
};

let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;

function isValidIPv4(value: string): boolean {
    const parts = value.trim().split('.');
    if (parts.length !== 4) return false;
    return parts.every(part => {
        if (!/^\d{1,3}$/.test(part)) return false;
        if (part.length > 1 && part.startsWith('0')) return false;
        const value = Number(part);
        return value >= 0 && value <= 255;
    });
}

function getEnabled(): boolean { return loadSetting('remoteControlEnabled', false); }
function setEnabled(enabled: boolean): void { saveSetting('remoteControlEnabled', enabled); }
function getConnectionSettings() {
    return {
        ip: loadSetting('remoteControlIp', DEFAULT_IP),
        port: loadSetting('remoteControlPort', DEFAULT_PORT),
        apiKey: loadSetting('remoteControlApiKey', DEFAULT_API_KEY)
    };
}
function clearReconnectTimer(): void {
    if (reconnectTimer !== null) { window.clearTimeout(reconnectTimer); reconnectTimer = null; }
}
function disconnect(): void {
    clearReconnectTimer();
    if (socket) { socket.onclose = null; socket.close(); socket = null; }
}
function connect(): void {
    disconnect();
    if (!getEnabled()) return;
    const { ip, port, apiKey } = getConnectionSettings();
    const auth = apiKey ? `?apiKey=${encodeURIComponent(apiKey)}` : '';
    const url = `ws://${ip}:${port}/vp${auth}`;
    try {
        socket = new WebSocket(url);
        socket.onopen = () => { clearReconnectTimer(); console.info(`[RemoteControl] Connected to ${url}`); };
        socket.onerror = () => console.warn(`[RemoteControl] WebSocket connection failed: ${url}`);
        socket.onclose = () => {
            socket = null;
            if (!getEnabled()) return;
            reconnectTimer = window.setTimeout(connect, 2000);
        };
    } catch (error) {
        console.warn('[RemoteControl] Failed to create WebSocket connection:', error);
        reconnectTimer = window.setTimeout(connect, 2000);
    }
}

function createModal(): HTMLElement {
    const modal = document.createElement('div');
    modal.id = 'remoteControlModal';
    modal.className = 'hidden fixed inset-0 z-[10002] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4';
    modal.innerHTML = `
        <div class="relative bg-neutral-900 border border-neutral-700 rounded-xl p-6 max-w-md w-full shadow-2xl shadow-black/50">
            <h2 class="text-xl font-bold text-white mb-5">Remote Control</h2>
            <div class="space-y-4">
                <div><label for="remoteControlIpInput" class="block text-xs font-bold text-neutral-400 uppercase tracking-wider mb-2">IP Address</label><input id="remoteControlIpInput" type="text" inputmode="decimal" autocomplete="off" class="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-base text-white focus:ring-2 focus:ring-[#FFBB00] focus:border-transparent outline-none transition-all" placeholder="127.0.0.1"></div>
                <div><label for="remoteControlPortInput" class="block text-xs font-bold text-neutral-400 uppercase tracking-wider mb-2">Port</label><input id="remoteControlPortInput" type="number" min="1" max="65535" step="1" class="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-base text-white focus:ring-2 focus:ring-[#FFBB00] focus:border-transparent outline-none transition-all" placeholder="8170"></div>
                <div><label for="remoteControlApiKeyInput" class="block text-xs font-bold text-neutral-400 uppercase tracking-wider mb-2">API Key</label><input id="remoteControlApiKeyInput" type="password" autocomplete="off" class="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-base text-white focus:ring-2 focus:ring-[#FFBB00] focus:border-transparent outline-none transition-all" placeholder="Optional"><p class="text-[10px] text-neutral-500 mt-1.5">Leave empty if authentication is disabled.</p></div>
                <p id="remoteControlValidationError" class="hidden text-xs text-red-400"></p>
            </div>
            <div class="flex gap-3 mt-6"><button id="remoteControlCancelBtn" type="button" class="flex-1 px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-sm font-medium text-white transition-colors border border-neutral-700">Cancel</button><button id="remoteControlSaveBtn" type="button" class="flex-1 px-4 py-2.5 bg-[#FFBB00] hover:bg-[#D9A000] rounded-lg text-sm font-semibold text-black transition-colors">Save</button></div>
        </div>`;
    document.body.appendChild(modal);
    return modal;
}

function createSettingsRow(): HTMLElement | null {
    const highlightToggle = document.getElementById('highlightActiveWordToggle');
    const highlightRow = highlightToggle?.closest('.flex.items-center.justify-between');
    if (!highlightRow?.parentElement) return null;
    const row = document.createElement('div');
    row.id = 'remoteControlSettingsRow';
    row.className = 'flex items-center justify-between';
    row.innerHTML = `<div class="flex flex-col min-w-0 pr-3"><span class="text-sm text-neutral-300">Remote Control</span><span class="text-xs text-neutral-500">Connect to WebSocket</span></div><div class="flex items-center gap-2 flex-shrink-0"><button id="remoteControlSettingsBtn" type="button" title="VPBridge connection settings" class="h-8 min-w-9 px-2 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-xs font-bold text-neutral-300 hover:text-white transition-colors">&gt;&gt;</button><label class="relative inline-flex items-center cursor-pointer"><input id="remoteControlToggle" type="checkbox" class="sr-only peer"><div class="w-11 h-6 bg-neutral-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#FFBB00]"></div></label></div>`;
    highlightRow.insertAdjacentElement('afterend', row);
    return row;
}

interface RememberedGDoc { url: string; expiresAt: number; }
function readRememberedGDoc(): RememberedGDoc | null {
    try {
        const raw = localStorage.getItem(GDOC_REMEMBER_KEY);
        if (!raw) return null;
        const saved = JSON.parse(raw) as RememberedGDoc;
        if (!saved.url || !saved.expiresAt || Date.now() >= saved.expiresAt) {
            localStorage.removeItem(GDOC_REMEMBER_KEY);
            return null;
        }
        return saved;
    } catch { localStorage.removeItem(GDOC_REMEMBER_KEY); return null; }
}
function saveRememberedGDoc(url: string): void {
    localStorage.setItem(GDOC_REMEMBER_KEY, JSON.stringify({ url, expiresAt: Date.now() + GDOC_REMEMBER_DAYS * 24 * 60 * 60 * 1000 }));
}
function initGoogleDocRemember(): void {
    const modal = document.getElementById('googleDocModal');
    const input = document.getElementById('googleDocUrlInput') as HTMLInputElement | null;
    const importBtn = document.getElementById('confirmGoogleDocImportBtn');
    const label = input?.previousElementSibling;
    if (!modal || !input || !importBtn || !label || document.getElementById('rememberGoogleDocUrlToggle')) return;

    const remembered = readRememberedGDoc();
    const row = document.createElement('div');
    row.className = 'flex items-center justify-end gap-2 mt-2';
    row.innerHTML = `<span class="text-[10px] text-neutral-500">Remember last URL</span><label class="relative inline-flex items-center cursor-pointer" title="Remember the last successfully imported Google Doc URL for 7 days"><input id="rememberGoogleDocUrlToggle" type="checkbox" class="sr-only peer"><div class="w-9 h-5 bg-neutral-700 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#FFBB00]"></div></label>`;
    input.insertAdjacentElement('afterend', row);
    const toggle = document.getElementById('rememberGoogleDocUrlToggle') as HTMLInputElement;
    toggle.checked = !!remembered;

    toggle.addEventListener('change', () => {
        if (!toggle.checked) localStorage.removeItem(GDOC_REMEMBER_KEY);
    });

    const openBtn = document.getElementById('importGoogleDocBtn');
    openBtn?.addEventListener('click', () => {
        const current = readRememberedGDoc();
        toggle.checked = !!current;
        if (current) queueMicrotask(() => { input.value = current.url; });
    });

    let pendingUrl = '';
    importBtn.addEventListener('click', () => { pendingUrl = input.value.trim(); }, true);
    const observer = new MutationObserver(() => {
        if (modal.classList.contains('hidden') && pendingUrl) {
            if (toggle.checked) saveRememberedGDoc(pendingUrl);
            pendingUrl = '';
        }
    });
    observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
}

function getSupportedBrowserLanguage(): { id: string; name: string } | null {
    const candidates = [...(navigator.languages || []), navigator.language].filter(Boolean);
    for (const candidate of candidates) {
        const base = candidate.toLowerCase().split('-')[0];
        const supported = SUPPORTED_BROWSER_LANGS[base];
        if (supported) return supported;
    }
    return null;
}

function showBrowserLanguageStatus(language: { id: string; name: string }): void {
    document.querySelectorAll<HTMLElement>('.dropdown-title').forEach(title => {
        title.textContent = `Automatic (${language.name} – browser)`;
        title.classList.add('text-white');
        title.classList.remove('text-neutral-300');
    });
    document.querySelectorAll<HTMLElement>('.auto-detected-label').forEach(label => {
        label.textContent = `${language.name} from browser`;
    });
}

function applyBrowserLanguageFallback(): boolean {
    if (state.languageSetting !== 'auto') return false;
    const browserLanguage = getSupportedBrowserLanguage();
    if (!browserLanguage) return false;

    state.selectedLanguage = browserLanguage.id;
    state.detectedLanguage = browserLanguage.id;
    if (state.recognition) state.recognition.lang = browserLanguage.id;
    showBrowserLanguageStatus(browserLanguage);

    const warning = document.getElementById('langDetectionWarning');
    warning?.classList.add('hidden');
    return true;
}

function initBrowserLanguageFallback(): void {
    const warning = document.getElementById('langDetectionWarning');
    if (!warning) return;

    const observer = new MutationObserver(() => {
        if (!warning.classList.contains('hidden')) applyBrowserLanguageFallback();
    });
    observer.observe(warning, { attributes: true, attributeFilter: ['class'] });

    if (!warning.classList.contains('hidden')) applyBrowserLanguageFallback();
}

window.addEventListener('DOMContentLoaded', () => {
    initGoogleDocRemember();
    initBrowserLanguageFallback();
    if (document.getElementById('remoteControlSettingsRow')) return;
    const row = createSettingsRow();
    if (!row) return;
    const modal = createModal();
    const toggle = document.getElementById('remoteControlToggle') as HTMLInputElement;
    const settingsBtn = document.getElementById('remoteControlSettingsBtn') as HTMLButtonElement;
    const ipInput = document.getElementById('remoteControlIpInput') as HTMLInputElement;
    const portInput = document.getElementById('remoteControlPortInput') as HTMLInputElement;
    const apiKeyInput = document.getElementById('remoteControlApiKeyInput') as HTMLInputElement;
    const saveBtn = document.getElementById('remoteControlSaveBtn') as HTMLButtonElement;
    const cancelBtn = document.getElementById('remoteControlCancelBtn') as HTMLButtonElement;
    const validationError = document.getElementById('remoteControlValidationError') as HTMLParagraphElement;
    toggle.checked = getEnabled();
    const closeModal = () => modal.classList.add('hidden');
    const openModal = () => { const settings = getConnectionSettings(); ipInput.value = settings.ip; portInput.value = String(settings.port); apiKeyInput.value = settings.apiKey; validationError.classList.add('hidden'); validationError.textContent = ''; modal.classList.remove('hidden'); ipInput.focus(); };
    settingsBtn.addEventListener('click', openModal);
    cancelBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });
    toggle.addEventListener('change', () => { setEnabled(toggle.checked); if (toggle.checked) connect(); else disconnect(); });
    saveBtn.addEventListener('click', () => {
        const ip = ipInput.value.trim(), port = Number(portInput.value), apiKey = apiKeyInput.value.trim();
        if (!isValidIPv4(ip)) { validationError.textContent = 'Enter a valid IPv4 address, for example 127.0.0.1.'; validationError.classList.remove('hidden'); ipInput.focus(); return; }
        if (!Number.isInteger(port) || port < 1 || port > 65535) { validationError.textContent = 'Port must be a number from 1 to 65535.'; validationError.classList.remove('hidden'); portInput.focus(); return; }
        saveSetting('remoteControlIp', ip); saveSetting('remoteControlPort', port); saveSetting('remoteControlApiKey', apiKey); closeModal(); if (getEnabled()) connect();
    });
    if (getEnabled()) connect();
});
