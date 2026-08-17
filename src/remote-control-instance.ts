import { loadSetting } from './storage';

const CHANNEL_NAME = 'voiceprompter-remote-control-owner';
const TAKEOVER_NOTICE_ID = 'remoteControlTakeoverNotice';
const windowId = crypto.randomUUID();
const NativeWebSocket = window.WebSocket;

interface TakeoverMessage {
    type: 'takeover';
    ownerId: string;
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

    showTakeoverNotice();
    playTakeoverBeep();
}

function createDisconnectingEvent(reason: 'user'): JsonObject {
    return {
        protocolVersion: 1,
        id: crypto.randomUUID(),
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
        this.addEventListener('close', () => {
            if (managedSocket === this) managedSocket = null;
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

export function isRemoteControlTakenOver(): boolean {
    return takenOver;
}
