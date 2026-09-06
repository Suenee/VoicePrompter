import { loadSetting } from './storage';
import { createUuid } from './browser-compat';

const CHANNEL_NAME = 'voiceprompter-remote-control-owner';
const TAKEOVER_NOTICE_ID = 'remoteControlTakeoverNotice';
const NEGOTIATION_NOTICE_ID = 'remoteControlNegotiationNotice';
const windowId = createUuid();
const NativeWebSocket = window.WebSocket;
type JsonObject = Record<string, unknown>;
interface TakeoverMessage { type: 'takeover'; ownerId: string; }
interface ConnectionInfo { connectionId: string; hostName?: string; ip: string; service?: string; }
let managedSocket: CoordinatedWebSocket | null = null;
let takenOver = false;
const channel = 'BroadcastChannel' in window ? new BroadcastChannel(CHANNEL_NAME) : null;

function isVpBridgeSocket(url: string | URL): boolean {
    try { return new URL(String(url), window.location.href).pathname === '/vp'; } catch { return false; }
}
function updateStatusBarControlAvailability(): void {
    const connected = managedSocket?.readyState === NativeWebSocket.OPEN && managedSocket.isAdmitted();
    document.querySelectorAll<HTMLButtonElement>('[data-status-bar-position]').forEach(button => {
        button.disabled = !connected;
        button.style.opacity = connected ? '' : '0.45';
        button.style.cursor = connected ? '' : 'not-allowed';
    });
}
function updateRemoteControlStatus(icon: string, color: string, title: string, trackColor: string): void {
    const status = document.getElementById('remoteControlStatus');
    if (status) { status.textContent = icon; status.style.color = color; status.title = title; status.setAttribute('aria-label', title); }
    const track = document.getElementById('remoteControlToggleTrack');
    if (track) track.style.backgroundColor = trackColor;
    updateStatusBarControlAvailability();
}
function removeNotices(): void {
    document.getElementById(TAKEOVER_NOTICE_ID)?.remove();
    document.getElementById(NEGOTIATION_NOTICE_ID)?.remove();
}
function requestReconnect(): void {
    takenOver = false;
    removeNotices();
    const toggle = document.getElementById('remoteControlToggle') as HTMLInputElement | null;
    if (!toggle) return;
    if (toggle.checked) { toggle.checked = false; toggle.dispatchEvent(new Event('change', { bubbles: true })); }
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
}
function confirmDisconnect(): void {
    removeNotices();
    const toggle = document.getElementById('remoteControlToggle') as HTMLInputElement | null;
    if (toggle?.checked) { toggle.checked = false; toggle.dispatchEvent(new Event('change', { bubbles: true })); }
    updateRemoteControlStatus('○', '#737373', 'Remote Control is disconnected in this VoicePrompter window', '#404040');
}
function playTakeoverBeep(): void {
    try {
        const Ctor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        const context = new Ctor(), oscillator = context.createOscillator(), gain = context.createGain(), now = context.currentTime;
        oscillator.frequency.setValueAtTime(740, now); gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.08, now + 0.01); gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
        oscillator.connect(gain); gain.connect(context.destination); oscillator.start(now); oscillator.stop(now + 0.17);
        oscillator.addEventListener('ended', () => void context.close(), { once: true });
    } catch { /* best effort */ }
}
function showTakeoverNotice(textValue = 'Remote Control was taken over by another VoicePrompter.'): void {
    const render = () => {
        updateRemoteControlStatus('▲', '#ef4444', textValue, '#ef4444');
        document.getElementById(NEGOTIATION_NOTICE_ID)?.remove();
        if (document.getElementById(TAKEOVER_NOTICE_ID) || !document.body) return;
        const overlay = document.createElement('div'); overlay.id = TAKEOVER_NOTICE_ID; overlay.className = 'fixed inset-0 z-[10003] flex items-center justify-center bg-black/45 p-4';
        const notice = document.createElement('div'); notice.className = 'w-full max-w-md rounded-xl border border-red-500/50 bg-neutral-900 p-6 text-sm text-neutral-200 shadow-2xl'; notice.setAttribute('role', 'alertdialog'); notice.setAttribute('aria-modal', 'true');
        const text = document.createElement('div'); text.className = 'mb-5 text-center leading-relaxed'; text.textContent = textValue;
        const buttons = document.createElement('div'); buttons.className = 'flex items-center justify-center gap-3';
        const reconnect = document.createElement('button'); reconnect.type = 'button'; reconnect.className = 'rounded-lg bg-[#FFBB00] px-4 py-2 text-sm font-semibold text-black hover:bg-[#D9A000]'; reconnect.textContent = 'Reconnect'; reconnect.addEventListener('click', requestReconnect);
        const disconnect = document.createElement('button'); disconnect.type = 'button'; disconnect.className = 'rounded-lg border border-neutral-600 bg-neutral-800 px-4 py-2 text-sm font-semibold text-neutral-100 hover:bg-neutral-700'; disconnect.textContent = 'Disconnect'; disconnect.addEventListener('click', confirmDisconnect);
        buttons.append(reconnect, disconnect); notice.append(text, buttons); overlay.appendChild(notice); document.body.appendChild(overlay); reconnect.focus();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render, { once: true }); else render();
}
function connectionLabel(c: ConnectionInfo): string {
    return `${c.hostName?.trim() || c.ip}${c.hostName?.trim() ? ` (${c.ip})` : ''}${c.service?.trim() ? ` — ${c.service}` : ''}`;
}
function showNegotiationNotice(socket: CoordinatedWebSocket, connections: ConnectionInfo[], expiresAt?: string): void {
    const render = () => {
        removeNotices(); updateRemoteControlStatus('▲', '#facc15', 'SUB connection replacement is waiting for your selection', '#FFBB00');
        if (!document.body) return;
        const overlay = document.createElement('div'); overlay.id = NEGOTIATION_NOTICE_ID; overlay.className = 'fixed inset-0 z-[10003] flex items-center justify-center bg-black/45 p-4';
        const notice = document.createElement('div'); notice.className = 'w-full max-w-lg rounded-xl border border-yellow-500/50 bg-neutral-900 p-6 text-sm text-neutral-200 shadow-2xl'; notice.setAttribute('role', 'dialog'); notice.setAttribute('aria-modal', 'true');
        const title = document.createElement('div'); title.className = 'mb-2 text-center text-base font-semibold'; title.textContent = 'VoicePrompter connection already in use';
        const text = document.createElement('div'); text.className = 'mb-4 text-center leading-relaxed text-neutral-300'; text.textContent = 'Select the existing connection that this VoicePrompter should replace.';
        const list = document.createElement('div'); list.className = 'mb-5 flex flex-col gap-2';
        connections.forEach(c => { const b = document.createElement('button'); b.type = 'button'; b.className = 'rounded-lg border border-neutral-600 bg-neutral-800 px-4 py-3 text-left hover:bg-neutral-700'; b.textContent = connectionLabel(c); b.addEventListener('click', () => { b.disabled = true; socket.requestReplacement(c.connectionId); }); list.appendChild(b); });
        const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'mx-auto block rounded-lg border border-neutral-600 bg-neutral-800 px-4 py-2 font-semibold hover:bg-neutral-700'; cancel.textContent = 'Cancel'; cancel.addEventListener('click', () => socket.cancelNegotiation());
        notice.append(title, text, list, cancel);
        if (expiresAt) { const expiry = document.createElement('div'); expiry.className = 'mt-3 text-center text-xs text-neutral-500'; expiry.textContent = `Negotiation expires: ${new Date(expiresAt).toLocaleTimeString()}`; notice.appendChild(expiry); }
        overlay.appendChild(notice); document.body.appendChild(overlay); (list.querySelector('button') as HTMLButtonElement | null)?.focus();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render, { once: true }); else render();
}
function relinquishRemoteControl(): void {
    takenOver = true;
    if (managedSocket) { const current = managedSocket; managedSocket = null; current.onclose = null; current.onerror = null; try { current.close(4001, 'Remote Control taken over by another VoicePrompter window'); } catch { /* noop */ } }
    updateStatusBarControlAvailability(); showTakeoverNotice(); playTakeoverBeep();
}
function createDisconnectingEvent(): JsonObject {
    return { protocolVersion: 1, id: createUuid(), type: 'event', from: 'vp', recipient: 'bc', event: 'disconnecting', args: { reason: 'user' }, expectsResponse: false, source: { app: 'VoicePrompter', version: 'devel' }, timestamp: new Date().toISOString() };
}
function shouldAnnounceUserDisconnect(socket: WebSocket): boolean {
    return socket === managedSocket && !takenOver && socket.readyState === NativeWebSocket.OPEN && loadSetting('remoteControlEnabled', false) === false;
}
channel?.addEventListener('message', event => {
    const m = event.data as Partial<TakeoverMessage> | null;
    if (!m || m.type !== 'takeover' || typeof m.ownerId !== 'string' || m.ownerId === windowId || !managedSocket) return;
    relinquishRemoteControl();
});

class CoordinatedWebSocket extends NativeWebSocket {
    private admitted = false;
    private registerId: string | null = null;
    private negotiationRequestId: string | null = null;
    private suppressApplicationClose = false;
    constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols ?? []);
        if (!isVpBridgeSocket(url)) return;
        takenOver = false; removeNotices(); channel?.postMessage({ type: 'takeover', ownerId: windowId } satisfies TakeoverMessage); managedSocket = this;
        this.addEventListener('open', () => this.registerConnection());
        this.addEventListener('message', event => this.inspectServerMessage(event.data));
        this.addEventListener('close', () => { if (managedSocket === this) managedSocket = null; updateStatusBarControlAvailability(); if (this.suppressApplicationClose) window.setTimeout(() => showTakeoverNotice(), 0); });
    }
    isAdmitted(): boolean { return this.admitted; }
    private serverCall(method: string, args: JsonObject): string {
        const id = createUuid(); super.send(JSON.stringify({ protocolVersion: 1, id, type: 'call', from: 'vp', recipient: 'server', method, args, expectsResponse: true, source: { app: 'VoicePrompter', version: 'devel' }, timestamp: new Date().toISOString() })); return id;
    }
    private registerConnection(): void { this.admitted = false; this.registerId = this.serverCall('registerConnection', {}); }
    requestReplacement(connectionId: string): void { if (connectionId && this.readyState === NativeWebSocket.OPEN) this.negotiationRequestId = this.serverCall('replaceConnection', { connectionId }); }
    cancelNegotiation(): void { if (this.readyState === NativeWebSocket.OPEN) this.negotiationRequestId = this.serverCall('cancelConnectionNegotiation', {}); }
    private parseConnections(value: unknown): ConnectionInfo[] {
        if (!Array.isArray(value)) return [];
        return value.flatMap(item => { if (!item || typeof item !== 'object' || Array.isArray(item)) return []; const v = item as JsonObject; if (typeof v.connectionId !== 'string' || typeof v.ip !== 'string') return []; return [{ connectionId: v.connectionId, ip: v.ip, ...(typeof v.hostName === 'string' ? { hostName: v.hostName } : {}), ...(typeof v.service === 'string' ? { service: v.service } : {}) }]; });
    }
    private inspectServerMessage(raw: unknown): void {
        if (typeof raw !== 'string') return; let message: JsonObject; try { message = JSON.parse(raw) as JsonObject; } catch { return; } if (!message || message.from !== 'server') return;
        if (message.type === 'event' && message.event === 'disconnecting') {
            const reason = (message.args as JsonObject | undefined)?.reason;
            if (reason === 'replaced' || reason === 'negotiationTimeout') { this.suppressApplicationClose = true; this.onclose = null; takenOver = reason === 'replaced'; showTakeoverNotice(reason === 'replaced' ? undefined : 'Connection replacement negotiation timed out.'); if (reason === 'replaced') playTakeoverBeep(); }
            return;
        }
        if (message.type === 'error' && message.error && typeof message.error === 'object' && (message.error as JsonObject).code === 'CONNECTION_NEGOTIATION_IN_PROGRESS') {
            this.suppressApplicationClose = true; this.onclose = null; showTakeoverNotice('Another VoicePrompter is already negotiating a connection replacement.'); return;
        }
        if (message.type !== 'response' || typeof message.correlationId !== 'string' || (message.correlationId !== this.registerId && message.correlationId !== this.negotiationRequestId)) return;
        const result = message.result; if (!result || typeof result !== 'object' || Array.isArray(result)) return; const data = result as JsonObject;
        if (data.status === 'admitted') {
            this.admitted = true; this.registerId = null; this.negotiationRequestId = null; removeNotices(); updateStatusBarControlAvailability(); console.info('[RemoteControl] SUB admitted this VP connection');
            // remote-control.ts may already have completed its initial ping while this socket was negotiating.
            // Re-run only its onopen callback so it immediately refreshes SUB/BC state and Status Bar sync.
            if (this.onopen) this.onopen.call(this, new Event('open'));
            return;
        }
        if (data.status === 'replacementNegotiation') { this.admitted = false; showNegotiationNotice(this, this.parseConnections(data.connections), typeof data.expiresAt === 'string' ? data.expiresAt : undefined); updateStatusBarControlAvailability(); return; }
        if (data.status === 'cancelled') { this.suppressApplicationClose = true; this.onclose = null; removeNotices(); updateRemoteControlStatus('○', '#737373', 'Remote Control connection replacement was cancelled', '#404040'); }
    }
    send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
        if (isVpBridgeSocket(this.url) && !this.admitted && typeof data === 'string') {
            try { const message = JSON.parse(data) as JsonObject; if (message.recipient !== 'server') { console.warn('[RemoteControl] Application VPP message suppressed until SUB admits this connection', message); return; } } catch { /* SUB validates malformed traffic */ }
        }
        super.send(data);
    }
    close(code?: number, reason?: string): void {
        if (shouldAnnounceUserDisconnect(this)) { try { super.send(JSON.stringify(createDisconnectingEvent())); } catch { /* best effort */ } }
        super.close(code, reason);
    }
}

window.WebSocket = CoordinatedWebSocket as typeof WebSocket;
window.addEventListener('DOMContentLoaded', updateStatusBarControlAvailability);
export function isRemoteControlTakenOver(): boolean { return takenOver; }
