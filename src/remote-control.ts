import { loadSetting, saveSetting } from './storage';
import { remoteCommandHandler } from './remote-command-handler';
import { state } from './state';

const DEFAULT_IP = '127.0.0.1';
const DEFAULT_PORT = 8170;
const DEFAULT_API_KEY = '';
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30000;
const HEARTBEAT_GRACE_MS = 5000;
const GDOC_REMEMBER_KEY = 'voiceprompter_gdoc_remember';
const GDOC_REMEMBER_DAYS = 7;
const STATUS_BAR_POSITION_KEY = 'statusBarPosition';

let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let heartbeatTimer: number | null = null;
let heartbeatTimeoutTimer: number | null = null;
let heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS;
let lastPeerActivityAt = 0;
let pendingPingId: string | null = null;
let statusBarClockTimer: number | null = null;

type JsonObject = Record<string, unknown>;
type RemoteStatus = 'disabled' | 'error' | 'bridge-only' | 'connected';
type StatusBarPosition = 'off' | 'top' | 'bottom';
type StatusBarAlign = 'left' | 'center' | 'right';

interface StatusBarZone {
    text: string;
    align: StatusBarAlign;
}

interface RemoteStatusPresentation {
    icon: string;
    color: string;
    title: string;
}

const REMOTE_STATUS_PRESENTATION: Record<RemoteStatus, RemoteStatusPresentation> = {
    disabled: {
        icon: '○',
        color: '#737373',
        title: 'Remote Control is disabled'
    },
    error: {
        icon: '▲',
        color: '#ef4444',
        title: 'Connection error: VPBridge is unavailable'
    },
    'bridge-only': {
        icon: '▲',
        color: '#facc15',
        title: 'Connected to VPBridge, but Bitfocus Companion is not connected'
    },
    connected: {
        icon: '✓',
        color: '#22c55e',
        title: 'Connected: VPBridge and Bitfocus Companion are available'
    }
};

let remoteStatus: RemoteStatus = 'disabled';
let statusBarPosition: StatusBarPosition = loadSetting(STATUS_BAR_POSITION_KEY, 'off') as StatusBarPosition;
let statusBarZones: StatusBarZone[] | null = null;

function normalizeStatusBarPosition(value: unknown): StatusBarPosition {
    return value === 'top' || value === 'bottom' ? value : 'off';
}

statusBarPosition = normalizeStatusBarPosition(statusBarPosition);

function getStatusBarEnabled(): boolean {
    return statusBarPosition !== 'off' && getEnabled() && socket?.readyState === WebSocket.OPEN;
}

function setRemoteStatus(status: RemoteStatus): void {
    remoteStatus = status;

    const el = document.getElementById('remoteControlStatus');
    if (el) {
        const current = REMOTE_STATUS_PRESENTATION[status];
        el.textContent = current.icon;
        el.style.color = current.color;
        el.title = current.title;
        el.setAttribute('aria-label', current.title);
    }

    const toggleTrack = document.getElementById('remoteControlToggleTrack');
    if (toggleTrack) {
        toggleTrack.style.backgroundColor =
            status === 'connected'
                ? '#22c55e'
                : status === 'disabled'
                    ? '#404040'
                    : '#FFBB00';
    }

    updateStatusBarVisibility();
}

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

function getEnabled(): boolean {
    return loadSetting('remoteControlEnabled', false);
}

function setEnabled(enabled: boolean): void {
    saveSetting('remoteControlEnabled', enabled);
}

function getConnectionSettings() {
    return {
        ip: loadSetting('remoteControlIp', DEFAULT_IP),
        port: loadSetting('remoteControlPort', DEFAULT_PORT),
        apiKey: loadSetting('remoteControlApiKey', DEFAULT_API_KEY)
    };
}

function clearReconnectTimer(): void {
    if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
}

function clearHeartbeatTimers(): void {
    if (heartbeatTimer !== null) {
        window.clearTimeout(heartbeatTimer);
        heartbeatTimer = null;
    }

    if (heartbeatTimeoutTimer !== null) {
        window.clearTimeout(heartbeatTimeoutTimer);
        heartbeatTimeoutTimer = null;
    }
}

function resetHeartbeatSession(): void {
    clearHeartbeatTimers();
    heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS;
    lastPeerActivityAt = 0;
    pendingPingId = null;
}

function sendRaw(message: JsonObject): boolean {
    if (socket?.readyState !== WebSocket.OPEN) return false;

    socket.send(JSON.stringify(message));
    return true;
}

function scheduleHeartbeatCheck(): void {
    if (heartbeatTimer !== null) {
        window.clearTimeout(heartbeatTimer);
    }

    const elapsed = Math.max(0, Date.now() - lastPeerActivityAt);
    heartbeatTimer = window.setTimeout(
        checkHeartbeat,
        Math.max(0, heartbeatIntervalMs - elapsed)
    );
}

function sendServerPing(): void {
    if (socket?.readyState !== WebSocket.OPEN || pendingPingId) return;

    const id = crypto.randomUUID();
    pendingPingId = id;

    const sent = sendRaw({
        protocolVersion: 1,
        id,
        type: 'call',
        from: 'vp',
        recipient: 'server',
        method: 'ping',
        args: {},
        expectsResponse: true,
        source: {
            app: 'VoicePrompter',
            version: 'devel'
        },
        timestamp: new Date().toISOString()
    });

    if (!sent) {
        pendingPingId = null;
        return;
    }

    if (heartbeatTimeoutTimer !== null) {
        window.clearTimeout(heartbeatTimeoutTimer);
    }

    heartbeatTimeoutTimer = window.setTimeout(() => {
        if (!pendingPingId) return;

        console.warn('[RemoteControl] VPBridge heartbeat ping timed out; reconnecting');
        setRemoteStatus('error');
        reconnectNow();
    }, HEARTBEAT_GRACE_MS);
}

function checkHeartbeat(): void {
    heartbeatTimer = null;

    if (socket?.readyState !== WebSocket.OPEN || pendingPingId) return;

    if (Date.now() - lastPeerActivityAt >= heartbeatIntervalMs) {
        sendServerPing();
    } else {
        scheduleHeartbeatCheck();
    }
}

function handleServerPingResponse(message: JsonObject): boolean {
    if (
        !pendingPingId ||
        message.from !== 'server' ||
        message.recipient !== 'vp' ||
        message.correlationId !== pendingPingId
    ) {
        return false;
    }

    if (message.type !== 'response' && message.type !== 'error') {
        return false;
    }

    pendingPingId = null;

    if (heartbeatTimeoutTimer !== null) {
        window.clearTimeout(heartbeatTimeoutTimer);
        heartbeatTimeoutTimer = null;
    }

    if (message.type === 'error') {
        console.warn('[RemoteControl] VPBridge ping returned protocol error', message);
        setRemoteStatus('error');
        reconnectNow();
        return true;
    }

    let bcConnected = false;
    const result = message.result;

    if (result && typeof result === 'object' && !Array.isArray(result)) {
        const heartbeat = (result as JsonObject).heartbeat;

        if (heartbeat && typeof heartbeat === 'object' && !Array.isArray(heartbeat)) {
            const interval = (heartbeat as JsonObject).intervalMs;

            if (
                typeof interval === 'number' &&
                Number.isFinite(interval) &&
                interval > 0
            ) {
                heartbeatIntervalMs = interval;
            }
        }

        const mailboxes = (result as JsonObject).mailboxes;

        if (mailboxes && typeof mailboxes === 'object' && !Array.isArray(mailboxes)) {
            const bc = (mailboxes as JsonObject).bc;
            bcConnected = !!(
                bc &&
                typeof bc === 'object' &&
                !Array.isArray(bc) &&
                (bc as JsonObject).connected === true
            );
        }
    }

    setRemoteStatus(bcConnected ? 'connected' : 'bridge-only');

    console.info(
        `[RemoteControl] VPBridge heartbeat ok; BC ${
            bcConnected ? 'connected' : 'not connected'
        }, interval=${heartbeatIntervalMs}ms`
    );

    lastPeerActivityAt = Date.now();
    scheduleHeartbeatCheck();

    return true;
}

function reconnectNow(): void {
    resetHeartbeatSession();
    remoteCommandHandler.setSender(null);

    if (socket) {
        const current = socket;
        socket = null;
        current.onclose = null;

        try {
            current.close();
        } catch {
            // Ignore close failures.
        }
    }

    if (!getEnabled()) {
        setRemoteStatus('disabled');
        return;
    }

    setRemoteStatus('error');
    clearReconnectTimer();
    reconnectTimer = window.setTimeout(connect, 0);
}

function disconnect(): void {
    clearReconnectTimer();
    resetHeartbeatSession();
    remoteCommandHandler.setSender(null);

    if (socket) {
        socket.onclose = null;
        socket.close();
        socket = null;
    }

    setRemoteStatus('disabled');
    updateStatusBarVisibility();
}

function connect(): void {
    disconnect();

    if (!getEnabled()) return;

    setRemoteStatus('error');

    const { ip, port, apiKey } = getConnectionSettings();
    const auth = apiKey ? `?apiKey=${encodeURIComponent(apiKey)}` : '';
    const url = `ws://${ip}:${port}/vp${auth}`;

    try {
        socket = new WebSocket(url);

        remoteCommandHandler.setSender(message => {
            if (!sendRaw(message)) {
                console.warn(
                    '[RemoteControl] Cannot send VPP message: WebSocket is not open',
                    message
                );
            }
        });

        socket.onopen = () => {
            clearReconnectTimer();
            lastPeerActivityAt = Date.now();

            console.info(`[RemoteControl] Connected to ${url}`);

            updateStatusBarVisibility();
            sendServerPing();
        };

        socket.onmessage = event => {
            const parsed = remoteCommandHandler.handle(event.data);
            if (!parsed) return;

            if (handleServerPingResponse(parsed)) return;

            if (parsed.from === 'bc') {
                lastPeerActivityAt = Date.now();
                setRemoteStatus('connected');
                scheduleHeartbeatCheck();
            }
        };

        socket.onerror = () => {
            console.warn(`[RemoteControl] WebSocket connection failed: ${url}`);
            setRemoteStatus('error');
        };

        socket.onclose = () => {
            socket = null;
            resetHeartbeatSession();
            remoteCommandHandler.setSender(null);
            updateStatusBarVisibility();

            if (!getEnabled()) {
                setRemoteStatus('disabled');
                return;
            }

            setRemoteStatus('error');
            reconnectTimer = window.setTimeout(connect, 2000);
        };
    } catch (error) {
        console.warn('[RemoteControl] Failed to create WebSocket connection:', error);
        setRemoteStatus('error');
        reconnectTimer = window.setTimeout(connect, 2000);
    }
}

function ensureStatusBarStyles(): void {
    if (document.getElementById('voicePrompterStatusBarStyles')) return;

    const style = document.createElement('style');
    style.id = 'voicePrompterStatusBarStyles';
    style.textContent = `
        @keyframes vp-status-spin {
            to { transform: rotate(360deg); }
        }

        #voicePrompterStatusBar {
            box-sizing: border-box;
        }

        #voicePrompterStatusBar .vp-status-zone {
            min-width: 0;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
        }

        #voicePrompterStatusBar .vp-status-connection {
            pointer-events: auto;
            cursor: help;
        }
    `;

    document.head.appendChild(style);
}

function createStatusBar(): HTMLElement {
    let bar = document.getElementById('voicePrompterStatusBar');

    if (bar) return bar;

    ensureStatusBarStyles();

    bar = document.createElement('div');
    bar.id = 'voicePrompterStatusBar';
    bar.className =
        'hidden fixed left-0 right-0 h-8 px-4 bg-neutral-900/95 border-neutral-700 text-neutral-200 text-xs font-mono items-center pointer-events-none select-none';

    // Keep SR above the teleprompter text, but safely below controls/settings/modals.
    bar.style.zIndex = '100';

    document.body.appendChild(bar);

    return bar;
}

function formatClock(): string {
    const now = new Date();

    return `${String(now.getHours()).padStart(2, '0')}:${String(
        now.getMinutes()
    ).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
}

function placeholderZones(): StatusBarZone[] {
    return [
        { text: 'WAITING', align: 'left' },
        { text: formatClock(), align: 'right' }
    ];
}

function escapeHtml(value: string): string {
    return value.replace(
        /[&<>"']/g,
        ch =>
            ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            })[ch] || ch
    );
}

function renderConnectionStatusIcon(): string {
    // SR is hidden when Remote Control / WebSocket is unavailable,
    // so "disabled" is normally never visible here.
    const presentation = REMOTE_STATUS_PRESENTATION[remoteStatus];

    return `<span
        class="vp-status-connection"
        title="${escapeHtml(presentation.title)}"
        aria-label="${escapeHtml(presentation.title)}"
        style="color:${presentation.color};font-weight:bold;margin-right:8px"
    >${escapeHtml(presentation.icon)}</span>`;
}

function renderStatusBar(): void {
    const bar = createStatusBar();
    const enabled = getStatusBarEnabled();

    bar.style.display = enabled ? 'grid' : 'none';

    if (!enabled) return;

    const zones = statusBarZones?.length
        ? statusBarZones.slice(0, 6)
        : placeholderZones();

    bar.style.top = statusBarPosition === 'top' ? '0' : '';
    bar.style.bottom = statusBarPosition === 'bottom' ? '0' : '';
    bar.style.borderTopWidth = statusBarPosition === 'bottom' ? '1px' : '0';
    bar.style.borderBottomWidth = statusBarPosition === 'top' ? '1px' : '0';

    bar.style.opacity = Math.max(
        0,
        Math.min(1, state.config.dockOpacity / 100)
    ).toString();

    bar.style.gridTemplateColumns = zones
        .map(zone => `${Math.max(1, Math.min(4, Math.ceil(zone.text.length / 8)))}fr`)
        .join(' ');

    bar.innerHTML = zones
        .map((zone, index) => {
            const isWaiting = !statusBarZones && index === 0;
            const isPlaceholderClock = !statusBarZones && index === zones.length - 1;

            const justify =
                zone.align === 'center'
                    ? 'center'
                    : zone.align === 'right'
                        ? 'end'
                        : 'start';

            const waiting = isWaiting
                ? `<span style="display:inline-block;width:10px;height:10px;margin-right:7px;border:2px solid #737373;border-top-color:#facc15;border-radius:999px;animation:vp-status-spin .8s linear infinite;vertical-align:-1px"></span>`
                : '';

            const content = isPlaceholderClock
                ? `${renderConnectionStatusIcon()}${escapeHtml(zone.text)}`
                : escapeHtml(zone.text);

            return `<div
                class="vp-status-zone"
                style="text-align:${zone.align};justify-self:${justify};width:100%"
            >${waiting}${content}</div>`;
        })
        .join('');
}

function updateStatusBarVisibility(): void {
    renderStatusBar();

    if (statusBarClockTimer !== null) {
        window.clearInterval(statusBarClockTimer);
        statusBarClockTimer = null;
    }

    if (getStatusBarEnabled() && !statusBarZones) {
        statusBarClockTimer = window.setInterval(renderStatusBar, 1000);
    }
}

function setStatusBarPosition(
    position: StatusBarPosition,
    persist = true
): void {
    statusBarPosition = normalizeStatusBarPosition(position);

    if (persist) {
        saveSetting(STATUS_BAR_POSITION_KEY, statusBarPosition);
    }

    updateStatusBarVisibility();
}

export function setStatusBarZones(zones: StatusBarZone[]): void {
    if (!getStatusBarEnabled()) return;

    statusBarZones = zones.slice(0, 6).map(zone => ({
        text: String(zone.text ?? ''),
        align:
            zone.align === 'center' || zone.align === 'right'
                ? zone.align
                : 'left'
    }));

    updateStatusBarVisibility();
}

export function clearStatusBarData(): void {
    statusBarZones = null;
    updateStatusBarVisibility();
}

function updateStatusPositionButtons(position: StatusBarPosition): void {
    document
        .querySelectorAll<HTMLButtonElement>('[data-status-bar-position]')
        .forEach(button => {
            const active = button.dataset.statusBarPosition === position;

            button.style.backgroundColor = active ? '#FFBB00' : '';
            button.style.color = active ? '#000000' : '';
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
}

function createModal(): HTMLElement {
    const modal = document.createElement('div');

    modal.id = 'remoteControlModal';
    modal.className =
        'hidden fixed inset-0 z-[10002] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4';

    modal.innerHTML = `
        <div class="relative bg-neutral-900 border border-neutral-700 rounded-xl p-6 max-w-md w-full shadow-2xl shadow-black/50">
            <div class="flex items-center justify-between mb-5">
                <h2 class="text-xl font-bold text-white">Remote Control</h2>
                <span
                    id="remoteControlStatus"
                    class="text-2xl font-bold leading-none cursor-help select-none"
                    role="status"
                    aria-live="polite"
                ></span>
            </div>

            <div class="space-y-4">
                <div>
                    <label
                        for="remoteControlIpInput"
                        class="block text-xs font-bold text-neutral-400 uppercase tracking-wider mb-2"
                    >IP Address</label>

                    <input
                        id="remoteControlIpInput"
                        type="text"
                        inputmode="decimal"
                        autocomplete="off"
                        class="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-base text-white focus:ring-2 focus:ring-[#FFBB00] focus:border-transparent outline-none transition-all"
                        placeholder="127.0.0.1"
                    >
                </div>

                <div>
                    <label
                        for="remoteControlPortInput"
                        class="block text-xs font-bold text-neutral-400 uppercase tracking-wider mb-2"
                    >Port</label>

                    <input
                        id="remoteControlPortInput"
                        type="number"
                        min="1"
                        max="65535"
                        step="1"
                        class="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-base text-white focus:ring-2 focus:ring-[#FFBB00] focus:border-transparent outline-none transition-all"
                        placeholder="8170"
                    >
                </div>

                <div>
                    <label
                        for="remoteControlApiKeyInput"
                        class="block text-xs font-bold text-neutral-400 uppercase tracking-wider mb-2"
                    >API Key</label>

                    <input
                        id="remoteControlApiKeyInput"
                        type="password"
                        autocomplete="off"
                        class="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-base text-white focus:ring-2 focus:ring-[#FFBB00] focus:border-transparent outline-none transition-all"
                        placeholder="Optional"
                    >

                    <p class="text-[10px] text-neutral-500 mt-1.5">
                        Leave empty if authentication is disabled.
                    </p>
                </div>

                <div class="pt-1">
                    <div class="flex items-center justify-between">
                        <span class="text-xs font-bold text-neutral-400 uppercase tracking-wider">
                            Status Bar
                        </span>

                        <div class="flex bg-neutral-800 border border-neutral-700 rounded-lg p-1 gap-1">
                            <button
                                type="button"
                                data-status-bar-position="off"
                                title="Status Bar Off"
                                class="w-9 h-7 rounded text-xs text-neutral-300 hover:bg-neutral-700"
                            >○</button>

                            <button
                                type="button"
                                data-status-bar-position="top"
                                title="Status Bar Top"
                                class="w-9 h-7 rounded text-sm text-neutral-300 hover:bg-neutral-700"
                            >↑</button>

                            <button
                                type="button"
                                data-status-bar-position="bottom"
                                title="Status Bar Bottom"
                                class="w-9 h-7 rounded text-sm text-neutral-300 hover:bg-neutral-700"
                            >↓</button>
                        </div>
                    </div>

                    <p class="text-[10px] text-neutral-500 mt-1.5">
                        Shown only while the WebSocket connection is active.
                    </p>
                </div>

                <p
                    id="remoteControlValidationError"
                    class="hidden text-xs text-red-400"
                ></p>
            </div>

            <div class="flex gap-3 mt-6">
                <button
                    id="remoteControlResetBtn"
                    type="button"
                    title="Reset Remote Control to defaults"
                    class="w-11 px-3 py-2.5 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-neutral-300 transition-colors border border-neutral-700"
                    aria-label="Reset Remote Control to defaults"
                >↺</button>

                <button
                    id="remoteControlCancelBtn"
                    type="button"
                    class="flex-1 px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-sm font-medium text-white transition-colors border border-neutral-700"
                >Cancel</button>

                <button
                    id="remoteControlSaveBtn"
                    type="button"
                    class="flex-1 px-4 py-2.5 bg-[#FFBB00] hover:bg-[#D9A000] rounded-lg text-sm font-semibold text-black transition-colors"
                >Save</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    setRemoteStatus(remoteStatus);

    return modal;
}

function createSettingsRow(): HTMLElement | null {
    const highlightToggle = document.getElementById('highlightActiveWordToggle');
    const highlightRow = highlightToggle?.closest(
        '.flex.items-center.justify-between'
    );

    if (!highlightRow?.parentElement) return null;

    const row = document.createElement('div');

    row.id = 'remoteControlSettingsRow';
    row.className = 'flex items-center justify-between';

    row.innerHTML = `
        <div class="flex flex-col min-w-0 pr-3">
            <span class="text-sm text-neutral-300">Remote Control</span>
            <span class="text-xs text-neutral-500">Connect to WebSocket</span>
        </div>

        <div class="flex items-center gap-2 flex-shrink-0">
            <button
                id="remoteControlSettingsBtn"
                type="button"
                title="VPBridge connection settings"
                class="h-8 min-w-9 px-2 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-xs font-bold text-neutral-300 hover:text-white transition-colors"
            >&gt;&gt;</button>

            <label class="relative inline-flex items-center cursor-pointer">
                <input
                    id="remoteControlToggle"
                    type="checkbox"
                    class="sr-only peer"
                >

                <div
                    id="remoteControlToggleTrack"
                    class="w-11 h-6 bg-neutral-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all"
                ></div>
            </label>
        </div>
    `;

    highlightRow.insertAdjacentElement('afterend', row);

    return row;
}

interface RememberedGDoc {
    url: string;
    expiresAt: number;
}

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
    } catch {
        localStorage.removeItem(GDOC_REMEMBER_KEY);
        return null;
    }
}

function saveRememberedGDoc(url: string): void {
    localStorage.setItem(
        GDOC_REMEMBER_KEY,
        JSON.stringify({
            url,
            expiresAt:
                Date.now() +
                GDOC_REMEMBER_DAYS * 24 * 60 * 60 * 1000
        })
    );
}

function initGoogleDocRemember(): void {
    const modal = document.getElementById('googleDocModal');
    const input = document.getElementById(
        'googleDocUrlInput'
    ) as HTMLInputElement | null;
    const importBtn = document.getElementById(
        'confirmGoogleDocImportBtn'
    );
    const label = input?.previousElementSibling;

    if (
        !modal ||
        !input ||
        !importBtn ||
        !label ||
        document.getElementById('rememberGoogleDocUrlToggle')
    ) {
        return;
    }

    const remembered = readRememberedGDoc();
    const row = document.createElement('div');

    row.className = 'flex items-center justify-end gap-2 mt-2';

    row.innerHTML = `
        <span class="text-[10px] text-neutral-500">Remember last URL</span>

        <label
            class="relative inline-flex items-center cursor-pointer"
            title="Remember the last successfully imported Google Doc URL for 7 days"
        >
            <input
                id="rememberGoogleDocUrlToggle"
                type="checkbox"
                class="sr-only peer"
            >

            <div
                class="w-9 h-5 bg-neutral-700 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#FFBB00]"
            ></div>
        </label>
    `;

    input.insertAdjacentElement('afterend', row);

    const toggle = document.getElementById(
        'rememberGoogleDocUrlToggle'
    ) as HTMLInputElement;

    toggle.checked = !!remembered;

    toggle.addEventListener('change', () => {
        if (!toggle.checked) {
            localStorage.removeItem(GDOC_REMEMBER_KEY);
        }
    });

    document
        .getElementById('importGoogleDocBtn')
        ?.addEventListener('click', () => {
            const current = readRememberedGDoc();

            toggle.checked = !!current;

            if (current) {
                queueMicrotask(() => {
                    input.value = current.url;
                });
            }
        });

    let pendingUrl = '';

    importBtn.addEventListener(
        'click',
        () => {
            pendingUrl = input.value.trim();
        },
        true
    );

    new MutationObserver(() => {
        if (modal.classList.contains('hidden') && pendingUrl) {
            if (toggle.checked) {
                saveRememberedGDoc(pendingUrl);
            }

            pendingUrl = '';
        }
    }).observe(modal, {
        attributes: true,
        attributeFilter: ['class']
    });
}

window.addEventListener('DOMContentLoaded', () => {
    initGoogleDocRemember();

    if (document.getElementById('remoteControlSettingsRow')) {
        return;
    }

    const row = createSettingsRow();
    if (!row) return;

    const modal = createModal();
    createStatusBar();

    const toggle = document.getElementById(
        'remoteControlToggle'
    ) as HTMLInputElement;
    const settingsBtn = document.getElementById(
        'remoteControlSettingsBtn'
    ) as HTMLButtonElement;
    const ipInput = document.getElementById(
        'remoteControlIpInput'
    ) as HTMLInputElement;
    const portInput = document.getElementById(
        'remoteControlPortInput'
    ) as HTMLInputElement;
    const apiKeyInput = document.getElementById(
        'remoteControlApiKeyInput'
    ) as HTMLInputElement;
    const saveBtn = document.getElementById(
        'remoteControlSaveBtn'
    ) as HTMLButtonElement;
    const cancelBtn = document.getElementById(
        'remoteControlCancelBtn'
    ) as HTMLButtonElement;
    const resetBtn = document.getElementById(
        'remoteControlResetBtn'
    ) as HTMLButtonElement;
    const validationError = document.getElementById(
        'remoteControlValidationError'
    ) as HTMLParagraphElement;

    let pendingStatusBarPosition = statusBarPosition;

    toggle.checked = getEnabled();
    setRemoteStatus(toggle.checked ? 'error' : 'disabled');

    const closeModal = () => {
        modal.classList.add('hidden');
    };

    const openModal = () => {
        const settings = getConnectionSettings();

        ipInput.value = settings.ip;
        portInput.value = String(settings.port);
        apiKeyInput.value = settings.apiKey;

        pendingStatusBarPosition = statusBarPosition;
        updateStatusPositionButtons(pendingStatusBarPosition);

        validationError.classList.add('hidden');
        validationError.textContent = '';

        setRemoteStatus(remoteStatus);

        modal.classList.remove('hidden');
        ipInput.focus();
    };

    settingsBtn.addEventListener('click', openModal);
    cancelBtn.addEventListener('click', closeModal);

    modal.addEventListener('click', event => {
        if (event.target === modal) {
            closeModal();
        }
    });

    document
        .querySelectorAll<HTMLButtonElement>('[data-status-bar-position]')
        .forEach(button =>
            button.addEventListener('click', () => {
                pendingStatusBarPosition =
                    normalizeStatusBarPosition(
                        button.dataset.statusBarPosition
                    );

                updateStatusPositionButtons(
                    pendingStatusBarPosition
                );
            })
        );

    resetBtn.addEventListener('click', () => {
        ipInput.value = DEFAULT_IP;
        portInput.value = String(DEFAULT_PORT);
        apiKeyInput.value = '';

        pendingStatusBarPosition = 'off';
        updateStatusPositionButtons('off');
    });

    toggle.addEventListener('change', () => {
        setEnabled(toggle.checked);

        if (toggle.checked) {
            connect();
        } else {
            disconnect();
        }

        updateStatusBarVisibility();
    });

    saveBtn.addEventListener('click', () => {
        const ip = ipInput.value.trim();
        const port = Number(portInput.value);
        const apiKey = apiKeyInput.value.trim();

        if (!isValidIPv4(ip)) {
            validationError.textContent =
                'Enter a valid IPv4 address, for example 127.0.0.1.';
            validationError.classList.remove('hidden');
            ipInput.focus();
            return;
        }

        if (
            !Number.isInteger(port) ||
            port < 1 ||
            port > 65535
        ) {
            validationError.textContent =
                'Port must be a number from 1 to 65535.';
            validationError.classList.remove('hidden');
            portInput.focus();
            return;
        }

        saveSetting('remoteControlIp', ip);
        saveSetting('remoteControlPort', port);
        saveSetting('remoteControlApiKey', apiKey);

        setStatusBarPosition(pendingStatusBarPosition);

        if (pendingStatusBarPosition === 'off') {
            clearStatusBarData();
        }

        closeModal();

        if (getEnabled()) {
            connect();
        } else {
            updateStatusBarVisibility();
        }
    });

    const dockOpacityInput =
        document.getElementById('dockOpacityInput');

    dockOpacityInput?.addEventListener(
        'input',
        renderStatusBar
    );

    window.addEventListener(
        'voiceprompter:reset-defaults',
        () => {
            setStatusBarPosition('off');
            clearStatusBarData();
        }
    );

    updateStatusBarVisibility();

    if (getEnabled()) {
        connect();
    }
});
