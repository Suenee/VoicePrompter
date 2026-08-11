type JsonObject = Record<string, unknown>;
type Sender = (message: JsonObject) => void;

type PublicMethod =
    | 'goStart'
    | 'markerBack'
    | 'goBack'
    | 'goCurrent'
    | 'goNext'
    | 'markerNext'
    | 'goFinish';

interface CallMessage extends JsonObject {
    protocolVersion: number;
    id: string;
    type: 'call';
    method: string;
    args: JsonObject;
    expectsResponse?: boolean;
}

export class RemoteCommandHandler {
    private sender: Sender | null = null;

    private readonly publicMethods: Record<PublicMethod, (args: JsonObject) => void> = {
        goStart: args => this.goStart(args),
        markerBack: args => this.markerBack(args),
        goBack: args => this.goBack(args),
        goCurrent: args => this.goCurrent(args),
        goNext: args => this.goNext(args),
        markerNext: args => this.markerNext(args),
        goFinish: args => this.goFinish(args)
    };

    setSender(sender: Sender | null): void {
        this.sender = sender;
    }

    handle(rawMessage: unknown): void {
        const text = typeof rawMessage === 'string' ? rawMessage : String(rawMessage ?? '');
        let message: JsonObject;

        try {
            const parsed = JSON.parse(text);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                console.warn('[VPP] Ignored non-object JSON message:', parsed);
                return;
            }
            message = parsed as JsonObject;
        } catch {
            console.warn('[VPP] Ignored non-JSON message:', text);
            return;
        }

        console.log('[VPP] Message received:', message);

        if (message.protocolVersion !== 1) {
            this.sendError(message, 'UNSUPPORTED_PROTOCOL_VERSION', 'Unsupported protocol version', {
                received: message.protocolVersion,
                supported: 1
            });
            return;
        }

        if (message.type !== 'call') {
            console.log(`[VPP] ${String(message.type ?? 'unknown')} received (no handler yet):`, message);
            return;
        }

        this.handleCall(message as CallMessage);
    }

    private handleCall(call: CallMessage): void {
        const args = call.args && typeof call.args === 'object' && !Array.isArray(call.args)
            ? call.args
            : {};
        const method = call.method as PublicMethod;
        const handler = this.publicMethods[method];

        if (!handler) {
            console.warn(`[VPP] Method not allowed or unknown: ${String(call.method)}`);
            this.sendError(call, 'METHOD_NOT_FOUND', 'Requested method does not exist or is not public', {
                method: call.method
            });
            return;
        }

        try {
            handler(args);
            if (call.expectsResponse) {
                this.send({
                    protocolVersion: 1,
                    id: crypto.randomUUID(),
                    correlationId: call.id,
                    type: 'response',
                    result: { success: true },
                    source: { app: 'VoicePrompter', version: 'devel' },
                    timestamp: new Date().toISOString()
                });
            }
        } catch (error) {
            console.error(`[VPP] Method failed: ${call.method}`, error);
            this.sendError(call, 'METHOD_FAILED', 'Unable to execute requested operation', {
                method: call.method,
                reason: error instanceof Error ? error.message : String(error)
            });
        }
    }

    private sendError(original: JsonObject, code: string, message: string, details?: JsonObject): void {
        this.send({
            protocolVersion: 1,
            id: crypto.randomUUID(),
            ...(typeof original.id === 'string' ? { correlationId: original.id } : {}),
            type: 'error',
            error: {
                code,
                message,
                ...(details ? { details } : {})
            },
            source: { app: 'VoicePrompter', version: 'devel' },
            timestamp: new Date().toISOString()
        });
    }

    private send(message: JsonObject): void {
        if (!this.sender) {
            console.warn('[VPP] Cannot send protocol message: transport sender is not available', message);
            return;
        }
        this.sender(message);
    }

    public goStart(args: JsonObject): void { console.log('[VPP] goStart()', args); }
    public markerBack(args: JsonObject): void { console.log('[VPP] markerBack()', args); }
    public goBack(args: JsonObject): void { console.log('[VPP] goBack()', args); }
    public goCurrent(args: JsonObject): void { console.log('[VPP] goCurrent()', args); }
    public goNext(args: JsonObject): void { console.log('[VPP] goNext()', args); }
    public markerNext(args: JsonObject): void { console.log('[VPP] markerNext()', args); }
    public goFinish(args: JsonObject): void { console.log('[VPP] goFinish()', args); }
}

export const remoteCommandHandler = new RemoteCommandHandler();
