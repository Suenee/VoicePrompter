import { loadSetting } from './storage';

const CHANNEL_NAME = 'voiceprompter-remote-control-owner';
const TAKEOVER_NOTICE_ID = 'remoteControlTakeoverNotice';

function createUuid(): string {
    if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

const windowId = createUuid();
const NativeWebSocket = window.WebSocket;

interface TakeoverMessage {
    type: 'takeover';
    ownerId: string;
}

interface DisconnectingDetail {
    from: 'bc' | 'server';
    reason: string;
}

type JsonObject = Record<string, unknown>;

let managedSocket: WebSocket | null = null;
let takenOver = false;

const channel =
    'BroadcastChannel' in window
        ? new BroadcastChannel(CHANNEL_NAME)
        : null;

function isVpBridgeSocket(url: string | URL): boolean {
    try {
        const parsed = new URL(String(url), window.location.href);
        return parsed.pathname === '/vp';
    } catch {
        return false;
    }
}

function updateStatusBarControlAvailability(): void {
    const connected = managedSocket?.readyState === NativeWebSocket.OPEN;

    document
        .querySelectorAll<HTMLButtonElement>('[data-status-bar-position]')
        .forEach(button => {
            button.disabled = !connected;
            button.style.opacity = connected ? '' : '0.45';
            button.style.cursor = connected ? '' : 'not-allowed';
        });
}

function watchStatusBarControlAvailability(socket: WebSocket): void {
    const refresh = () => {
        if (managedSocket !== socket) return;

        updateStatusBarControlAvailability();

        if (socket.readyState === NativeWebSocket.CONNECTING) {
            window.setTimeout(refresh, 50);
        }
    };

    refresh();
}

function updateRemoteControlStatus(
    icon: string,
    color: string,
    title: string,
    trackColor: string
): void {
    const status = document.getElementById('remoteControlStatus');
    if (status) {
        status.textContent = icon;
        status.style.color = color;
        status.title = title;
        status.setAttribute('aria-label', title);
    }

    const track = document.getElementById('remoteControlToggleTrack');
    if (track) track.style.backgroundColor = trackColor;

    updateStatusBarControlAvailability();
}

function updateTakenOverStatus(): void {
    updateRemoteControlStatus(
        '▲',
        '#ef4444',
        'Remote Control was taken over by another VoicePrompter window',
        '#ef4444'
    );
}

function updateDisconnectedStatus(): void {
    updateRemoteControlStatus(
        '○',
        '#737373',
        'Remote Control is disconnected in this VoicePrompter window',
        '#404040'
    );
}

function updatePeerDisconnectedStatus(): void {
    updateRemoteControlStatus(
        '▲',
        '#facc15',
        'Connected to VPBridge, but Bitfocus Companion intentionally disconnected',
        '#FFBB00'
    );
}

function updateServerDisconnectedStatus(reason: string): void {
    updateRemoteControlStatus(
        '▲',
        '#ef4444',
        `VPBridge is intentionally unavailable (${reason})`,
        '#FFBB00'
    );
}

function removeTakeoverNotice(): void {
    document.getElementById(TAKEOVER_NOTICE_ID)?.remove();
}

function requestReconnect(): void {
    takenOver = false;
    removeTakeoverNotice();

    const toggle = document.getElementById('remoteControlToggle') as HTMLInputElement | null;
    if (!toggle) return;

    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
}

function confirmDisconnect(): void {
    removeTakeoverNotice();

    const toggle = document.getElementById('remoteControlToggle') as HTMLInputElement | null;
    if (toggle) toggle.checked = false;

    updateDisconnectedStatus();
}

function playTakeoverBeep(): void {
    try {
        const AudioContextCtor = window.AudioContext ||
            (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextCtor) return;

        const context = new AudioContextCtor();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const now = context.currentTime;

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(740, now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.08, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(now);
        oscillator.stop(now + 0.17);
        oscillator.addEventListener('ended', () => void context.close(), { once: true });
    } catch {
        // Browsers may block audio until the page has received user interaction.
    }
}

function showTakeoverNotice(): void {
    const render = () => {
        updateTakenOverStatus();

        if (document.getElementById(TAKEOVER_NOTICE_ID) || !document.body) return;

        const overlay = document.createElement('div');
        overlay.id = TAKEOVER_NOTICE_ID;
        overlay.className =
            'fixed inset-0 z-[10003] flex items-center justify-center bg-black/45 p-4';

        const notice = document.createElement('div');
        notice.className =
            'w-full max-w-md rounded-xl border border-red-500/50 bg-neutral-900 p-6 text-sm text-neutral-200 shadow-2xl';
        notice.setAttribute('role', 'alertdialog');
        notice.setAttribute('aria-modal', 'true');

        const text = document.createElement('div');
        text.className = 'mb-5 text-center leading-relaxed';
        text.textContent =
            'Remote Control was taken over by another VoicePrompter window.';

        const buttons = document.createElement('div');
        buttons.className = 'flex items-center justify-center gap-3';

        const reconnect = document.createElement('button');
        reconnect.type = 'button';
        reconnect.className =
            'rounded-lg bg-[#FFBB00] px-4 py-2 text-sm font-semibold text-black hover:bg-[#D9A000]';
        reconnect.textContent = 'Reconnect';
        reconnect.addEventListener('click', requestReconnect);

        const disconnect = document.createElement('button');
        disconnect.type = 'button';
        disconnect.className =
            'rounded-lg border border-neutral-600 bg-neutral-800 px-4 py-2 text-sm font-semibold text-neutral-100 hover:bg-neutral-700';
        disconnect.textContent = 'Disconnect';
        disconnect.addEventListener('click', confirmDisconnect);

        buttons.append(reconnect, disconnect);
        notice.append(text, buttons);
        overlay.appendChild(notice);
        document.body.appendChild(overlay);
        reconnect.focus();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', render, { once: true });
    } else {
        render();
    }
}

function relinquishRemoteControl(): void {
    takenOver = true;

    if (managedSocket) {
        const current = managedSocket;
        managedSocket = null;

        // A browser-window takeover is NOT a VPP disconnect. VPM must continue
        // to regard VoicePrompter as available while the new owner connects.
        current.onclose = null;
        current.onerror = null;

        try {
            current.close(4001, 'Remote Control taken over by another VoicePrompter window');
        } catch {
            // The socket may already be closing/closed.
        }
    }

    updateStatusBarControlAvailability();
    showTakeoverNotice();
    playTakeoverBeep();
}

function createDisconnectingEvent(reason: 'user'): JsonObject {
    return {
        protocolVersion: 1,
        id: createUuid(),
        type: 'event',
        from: 'vp',
        recipient: 'bc',
        event: 'disconnecting',
        args: { reason },
        expectsResponse: false,
        source: {
            app: 'VoicePrompter',
            version: 'devel'
        },
        timestamp: new Date().toISOString()
    };
}

function shouldAnnounceUserDisconnect(socket: WebSocket): boolean {
    return (
        socket === managedSocket &&
        !takenOver &&
        socket.readyState === NativeWebSocket.OPEN &&
        loadSetting('remoteControlEnabled', false) === false
    );
}

window.addEventListener('vp-vpp-disconnecting', event => {
    const detail = (event as CustomEvent<DisconnectingDetail>).detail;
    if (!detail) return;

    if (detail.from === 'bc' && detail.reason === 'user') {
        updatePeerDisconnectedStatus();
        return;
    }

    if (
        detail.from === 'server' &&
        (detail.reason === 'shutdown' || detail.reason === 'restart' || detail.reason === 'exit')
    ) {
        updateServerDisconnectedStatus(detail.reason);
    }
});

channel?.addEventListener('message', event => {
    const message = event.data as Partial<TakeoverMessage> | null;

    if (
        !message ||
        message.type !== 'takeover' ||
        typeof message.ownerId !== 'string' ||
        message.ownerId === windowId
    ) {
        return;
    }

    // Tabs without an active/connecting VPBridge socket are outside the
    // arbitration entirely. They neither disconnect nor show a warning.
    if (!managedSocket) return;

    relinquishRemoteControl();
});

class CoordinatedWebSocket extends NativeWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
        if (protocols === undefined) {
            super(url);
        } else {
            super(url, protocols);
        }

        if (!isVpBridgeSocket(url)) return;

        // Creating a new VPBridge connection is an explicit takeover.
        takenOver = false;
        removeTakeoverNotice();
        channel?.postMessage({ type: 'takeover', ownerId: windowId } satisfies TakeoverMessage);

        managedSocket = this;
        watchStatusBarControlAvailability(this);

        this.addEventListener('close', () => {
            if (managedSocket === this) managedSocket = null;
            updateStatusBarControlAvailability();
        });
    }

    close(code?: number, reason?: string): void {
        if (shouldAnnounceUserDisconnect(this)) {
            try {
                this.send(JSON.stringify(createDisconnectingEvent('user')));
            } catch {
                // Graceful disconnect is best-effort and must never block close.
            }
        }

        super.close(code, reason);
    }
}

if (channel) {
    window.WebSocket = CoordinatedWebSocket as typeof WebSocket;
}

window.addEventListener('DOMContentLoaded', updateStatusBarControlAvailability);

export function isRemoteControlTakenOver(): boolean {
    return takenOver;
}
