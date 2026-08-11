type JsonObject = Record<string, unknown>;
type Sender = (message: JsonObject) => void;

export class RemoteEventHooks {
    private sender: Sender | null = null;

    setSender(sender: Sender | null): void {
        this.sender = sender;
    }

    public HookMarker(args: { text: string }): void {
        const text = String(args?.text ?? '');
        if (!text) return;

        this.send({
            protocolVersion: 1,
            id: crypto.randomUUID(),
            type: 'event',
            event: 'marker',
            data: { text },
            source: { app: 'VoicePrompter', version: 'devel' },
            timestamp: new Date().toISOString()
        });
    }

    private send(message: JsonObject): void {
        if (!this.sender) {
            console.warn('[VPP] Cannot send event: transport sender is not available', message);
            return;
        }
        this.sender(message);
    }
}

export const remoteEventHooks = new RemoteEventHooks();
