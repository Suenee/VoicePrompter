function fallbackUuidV4(): string {
    const bytes = new Uint8Array(16);

    if (globalThis.crypto?.getRandomValues) {
        globalThis.crypto.getRandomValues(bytes);
    } else {
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = Math.floor(Math.random() * 256);
        }
    }

    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

export function createUuid(): string {
    const randomUuid = globalThis.crypto?.randomUUID;
    return typeof randomUuid === 'function'
        ? randomUuid.call(globalThis.crypto)
        : fallbackUuidV4();
}

// crypto.randomUUID() is available only in secure contexts in some browsers.
// VoicePrompter is also intentionally used over plain HTTP on trusted LANs,
// so install one compatibility implementation before the VPP/network modules
// are initialized. Existing code can then keep using crypto.randomUUID().
if (globalThis.crypto && typeof globalThis.crypto.randomUUID !== 'function') {
    try {
        Object.defineProperty(globalThis.crypto, 'randomUUID', {
            configurable: true,
            value: fallbackUuidV4
        });
    } catch {
        // Callers that import createUuid() still have a safe fallback.
    }
}

// Chromium can hide navigator.mediaDevices completely on plain HTTP when the
// page is opened through a LAN IP. The original VP code expects the object to
// exist during module initialization, so provide a non-capturing compatibility
// object instead of letting the whole application crash. Actual camera/mic
// access still fails explicitly until the page is served from a secure context.
if (!navigator.mediaDevices) {
    const events = new EventTarget();
    const unavailable = () => Promise.reject(
        new DOMException(
            'Camera and microphone access requires HTTPS or localhost.',
            'NotAllowedError'
        )
    );

    const mediaDevicesFallback = {
        enumerateDevices: async (): Promise<MediaDeviceInfo[]> => [],
        getUserMedia: unavailable,
        getSupportedConstraints: (): MediaTrackSupportedConstraints => ({}),
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
        dispatchEvent: events.dispatchEvent.bind(events)
    } as unknown as MediaDevices;

    try {
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: mediaDevicesFallback
        });
    } catch {
        // If the browser refuses the shim, guarded callers still remain safe.
    }
}
