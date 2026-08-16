const CHANNEL_NAME = 'voiceprompter-remote-control-owner';
const TAKEOVER_NOTICE_ID = 'remoteControlTakeoverNotice';
const windowId = crypto.randomUUID();
const NativeWebSocket = window.WebSocket;

interface TakeoverMessage {
    type: 'takeover';
    ownerId: string;
}

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

function updateTakenOverStatus(): void {
    const status = document.getElementById('remoteControlStatus');
    if (status) {
        const title = 'Remote Control was taken over by another VoicePrompter window';
        status.textContent = '▲';
        status.style.color = '#ef4444';
        status.title = title;
        status.setAttribute('aria-label', title);
    }

    const track = document.getElementById('remoteControlToggleTrack');
    if (track) {
        track.style.backgroundColor = '#ef4444';
    }
}

function removeTakeoverNotice(): void {
    document.getElementById(TAKEOVER_NOTICE_ID)?.remove();
}

function showTakeoverNotice(): void {
    const render = () => {
        updateTakenOverStatus();

        if (document.getElementById(TAKEOVER_NOTICE_ID) || !document.body) return;

        const notice = document.createElement('div');
        notice.id = TAKEOVER_NOTICE_ID;
        notice.className =
            'fixed right-4 top-4 z-[10003] max-w-sm rounded-lg border border-red-500/50 bg-neutral-900 p-4 text-sm text-neutral-200 shadow-2xl';

        const text = document.createElement('div');
        text.className = 'mb-3 leading-relaxed';
        text.textContent =
            'Remote Control was taken over by another VoicePrompter window.';

        const reconnect = document.createElement('button');
        reconnect.type = 'button';
        reconnect.className =
            'rounded-lg bg-[#FFBB00] px-3 py-2 text-sm font-semibold text-black hover:bg-[#D9A000]';
        reconnect.textContent = 'Reconnect';
        reconnect.addEventListener('click', () => {
            takenOver = false;
            removeTakeoverNotice();
            window.location.reload();
        });

        notice.append(text, reconnect);
        document.body.appendChild(notice);
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

        // Prevent remote-control.ts from treating this intentional takeover as
        // a network failure and starting its automatic reconnect loop.
        current.onclose = null;
        current.onerror = null;

        try {
            current.close(4001, 'Remote Control taken over by another VoicePrompter window');
        } catch {
            // The socket may already be closing/closed.
        }
    }

    showTakeoverNotice();
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

        // Creating a new VPBridge connection is an explicit takeover. This is
        // also what happens when a newly opened VP window starts with Remote
        // Control enabled or when the user presses Reconnect in a displaced tab.
        takenOver = false;
        removeTakeoverNotice();
        channel?.postMessage({ type: 'takeover', ownerId: windowId } satisfies TakeoverMessage);

        managedSocket = this;
        this.addEventListener('close', () => {
            if (managedSocket === this) managedSocket = null;
        });
    }
}

if (channel) {
    window.WebSocket = CoordinatedWebSocket as typeof WebSocket;
}

export function isRemoteControlTakenOver(): boolean {
    return takenOver;
}
