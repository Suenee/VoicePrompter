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
let waitingBarObserver: MutationObserver | null = null;
let waitingBarVisible = false;
let renderingWaitingBar = false;

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

function updateDisconnectedStatus(): void {
    const status = document.getElementById('remoteControlStatus');
    if (status) {
        const title = 'Remote Control is disconnected in this VoicePrompter window';
        status.textContent = '○';
        status.style.color = '#737373';
        status.title = title;
        status.setAttribute('aria-label', title);
    }

    const track = document.getElementById('remoteControlToggleTrack');
    if (track) {
        track.style.backgroundColor = '#404040';
    }
}

function removeTakeoverNotice(): void {
    document.getElementById(TAKEOVER_NOTICE_ID)?.remove();
}

function formatClock(): string {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
}

function renderWaitingBar(): void {
    const bar = document.getElementById('voicePrompterStatusBar');
    if (!bar || !waitingBarVisible || renderingWaitingBar) return;

    renderingWaitingBar = true;
    try {
        bar.style.setProperty('display', 'grid', 'important');
        bar.style.gridTemplateColumns = '1fr 1fr';

        const waitingZone = document.createElement('div');
        waitingZone.className = 'vp-status-zone';
        waitingZone.style.textAlign = 'left';
        waitingZone.style.justifySelf = 'start';
        waitingZone.style.width = '100%';

        const spinner = document.createElement('span');
        spinner.style.display = 'inline-block';
        spinner.style.width = '10px';
        spinner.style.height = '10px';
        spinner.style.marginRight = '7px';
        spinner.style.border = '2px solid #737373';
        spinner.style.borderTopColor = '#facc15';
        spinner.style.borderRadius = '999px';
        spinner.style.animation = 'vp-status-spin .8s linear infinite';
        spinner.style.verticalAlign = '-1px';
        waitingZone.append(spinner, document.createTextNode('WAITING'));

        const clockZone = document.createElement('div');
        clockZone.className = 'vp-status-zone';
        clockZone.style.textAlign = 'right';
        clockZone.style.justifySelf = 'end';
        clockZone.style.width = '100%';
        clockZone.textContent = formatClock();

        bar.replaceChildren(waitingZone, clockZone);
    } finally {
        renderingWaitingBar = false;
    }
}

function startWaitingBar(): void {
    const bar = document.getElementById('voicePrompterStatusBar');
    if (!bar) return;

    waitingBarVisible = window.getComputedStyle(bar).display !== 'none';
    if (!waitingBarVisible) return;

    renderWaitingBar();
    waitingBarObserver?.disconnect();
    waitingBarObserver = new MutationObserver(() => {
        queueMicrotask(renderWaitingBar);
    });
    waitingBarObserver.observe(bar, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style']
    });
}

function stopWaitingBar(hide = false): void {
    waitingBarObserver?.disconnect();
    waitingBarObserver = null;

    const bar = document.getElementById('voicePrompterStatusBar');
    if (bar) {
        bar.style.removeProperty('display');
        if (hide) bar.style.display = 'none';
    }

    waitingBarVisible = false;
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

function requestReconnect(): void {
    takenOver = false;
    stopWaitingBar(false);
    removeTakeoverNotice();

    const toggle = document.getElementById('remoteControlToggle') as HTMLInputElement | null;
    if (!toggle) return;

    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
}

function confirmDisconnect(): void {
    removeTakeoverNotice();
    stopWaitingBar(true);

    const toggle = document.getElementById('remoteControlToggle') as HTMLInputElement | null;
    if (toggle) toggle.checked = false;

    updateDisconnectedStatus();
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
    startWaitingBar();

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
    playTakeoverBeep();
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
        stopWaitingBar(false);
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
