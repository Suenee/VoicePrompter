type JsonObject = Record<string, unknown>;
type Sender = (message: JsonObject) => void;
type PublicHandler = (args: JsonObject) => Promise<void>;

type PublicMethod =
    | 'goStart'
    | 'markerBack'
    | 'goBack'
    | 'goCurrent'
    | 'goNext'
    | 'markerNext'
    | 'goFinish';

type MessageType = 'call' | 'event' | 'progress' | 'response' | 'error';
type RoutingName = 'vp' | 'bc' | 'server';

interface CallMessage extends JsonObject {
    protocolVersion: number;
    id: string;
    type: 'call';
    from: RoutingName;
    recipient: RoutingName;
    method: string;
    args: JsonObject;
    expectsResponse?: boolean;
}

export class RemoteCommandHandler {
    private sender: Sender | null = null;

    private readonly publicMethods: Record<PublicMethod, PublicHandler> = {
        goStart: args => this.goStart(args),
        markerBack: args => this.markerBack(args),
        goBack: args => this.goBack(args),
        goCurrent: args => this.goCurrent(args),
        goNext: args => this.goNext(args),
        markerNext: args => this.markerNext(args),
        goFinish: args => this.goFinish(args)
    };

    private readonly messageTypes = new Set<MessageType>(['call', 'event', 'progress', 'response', 'error']);
    private readonly routingNames = new Set<RoutingName>(['vp', 'bc', 'server']);

    setSender(sender: Sender | null): void {
        this.sender = sender;
    }

    public sendProtocolMessage(message: JsonObject): void {
        this.send(message);
    }

    handle(rawMessage: unknown): JsonObject | null {
        const text = typeof rawMessage === 'string' ? rawMessage : String(rawMessage ?? '');
        let message: JsonObject;

        try {
            const parsed = JSON.parse(text);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                console.warn('[VPP] DROPPED - INVALID VPP MESSAGE: top-level JSON value must be an object', parsed);
                return null;
            }
            message = parsed as JsonObject;
        } catch {
            console.warn('[VPP] DROPPED - INVALID JSON:', text);
            return null;
        }

        const envelopeError = this.validateEnvelope(message);
        if (envelopeError) {
            this.rejectInvalidMessage(message, envelopeError);
            return null;
        }

        if (message.protocolVersion !== 1) {
            this.sendError(message, 'UNSUPPORTED_PROTOCOL', 'Unsupported protocol version', {
                received: message.protocolVersion,
                supported: 1
            });
            return null;
        }

        if (message.recipient !== 'vp') {
            console.warn('[VPP] DROPPED - INVALID ROUTING: message is not addressed to vp', message);
            return null;
        }

        console.log('[VPP] Message received:', message);

        if (message.type === 'call') {
            const callError = this.validateCall(message);
            if (callError) {
                this.rejectInvalidMessage(message, callError);
                return null;
            }
            void this.handleCall(message as CallMessage);
        } else {
            console.log(`[VPP] ${message.type} received:`, message);
        }

        return message;
    }

    private validateEnvelope(message: JsonObject): string | null {
        if (typeof message.protocolVersion !== 'number' || !Number.isInteger(message.protocolVersion)) return 'protocolVersion must be an integer';
        if (typeof message.id !== 'string' || message.id.trim() === '') return 'id must be a non-empty string';
        if (typeof message.type !== 'string' || !this.messageTypes.has(message.type as MessageType)) return 'type must be one of: call, event, progress, response, error';
        if (typeof message.from !== 'string' || !this.routingNames.has(message.from as RoutingName)) return 'from must be one of: vp, bc, server';
        if (typeof message.recipient !== 'string' || !this.routingNames.has(message.recipient as RoutingName)) return 'recipient must be one of: vp, bc, server';
        if (!message.source || typeof message.source !== 'object' || Array.isArray(message.source)) return 'source must be an object';
        if (typeof message.timestamp !== 'string' || message.timestamp.trim() === '') return 'timestamp must be a non-empty string';
        if (message.correlationId !== undefined && (typeof message.correlationId !== 'string' || message.correlationId.trim() === '')) return 'correlationId must be a non-empty string when present';
        if (message.expectsResponse !== undefined && typeof message.expectsResponse !== 'boolean') return 'expectsResponse must be boolean when present';
        return null;
    }

    private validateCall(message: JsonObject): string | null {
        if (message.from !== 'bc') return 'application calls to vp must come from bc';
        if (typeof message.method !== 'string' || message.method.trim() === '') return 'call.method must be a non-empty string';
        if (!message.args || typeof message.args !== 'object' || Array.isArray(message.args)) return 'call.args must be a JSON object';

        const method = message.method as PublicMethod;
        if (!this.publicMethods[method]) return `unknown method: ${message.method}`;

        const args = message.args as JsonObject;
        const keys = Object.keys(args);
        if (method === 'goStart' || method === 'goFinish') {
            if (keys.length !== 0) return `${method} does not accept arguments`;
            return null;
        }

        if (keys.some(key => key !== 'offset')) return `${method} accepts only the offset argument`;
        if (args.offset === undefined) return `${method}.offset is required`;
        if (typeof args.offset !== 'number' || !Number.isFinite(args.offset) || !Number.isInteger(args.offset)) return `${method}.offset must be a finite integer`;
        return null;
    }

    private rejectInvalidMessage(message: JsonObject, reason: string): void {
        console.warn(`[VPP] DROPPED - INVALID VPP MESSAGE: ${reason}`, message);
        if (message.expectsResponse === true && typeof message.id === 'string' && message.id.trim() !== '') {
            this.sendError(message, 'INVALID_MESSAGE', 'Message does not conform to VoicePrompter Protocol', { reason });
        }
    }

    private async handleCall(call: CallMessage): Promise<void> {
        const method = call.method as PublicMethod;
        const handler = this.publicMethods[method];

        if (!handler) {
            if (call.expectsResponse) this.sendError(call, 'UNKNOWN_METHOD', 'Requested method does not exist or is not public', { method: call.method });
            return;
        }

        try {
            await handler(call.args);
            if (call.expectsResponse) {
                this.send({
                    protocolVersion: 1,
                    id: crypto.randomUUID(),
                    correlationId: call.id,
                    type: 'response',
                    from: 'vp',
                    recipient: 'bc',
                    result: { success: true },
                    source: { app: 'VoicePrompter', version: 'devel' },
                    timestamp: new Date().toISOString()
                });
            }
        } catch (error) {
            console.error(`[VPP] Method failed: ${call.method}`, error);
            if (call.expectsResponse) {
                this.sendError(call, 'COMMAND_FAILED', 'Unable to execute requested operation', {
                    method: call.method,
                    reason: error instanceof Error ? error.message : String(error)
                });
            }
        }
    }

    private sendError(original: JsonObject, code: string, message: string, details?: JsonObject): void {
        const recipient = original.from === 'server' ? 'server' : 'bc';
        this.send({
            protocolVersion: 1,
            id: crypto.randomUUID(),
            ...(typeof original.id === 'string' ? { correlationId: original.id } : {}),
            type: 'error',
            from: 'vp',
            recipient,
            error: { code, message, ...(details ? { details } : {}) },
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

    private offset(args: JsonObject): number {
        return args.offset as number;
    }

    private relativeDirection(offset: number, defaultDirection: 1 | -1): 1 | -1 {
        if (offset < 0) return defaultDirection === 1 ? -1 : 1;
        return defaultDirection;
    }

    public async goStart(args: JsonObject): Promise<void> {
        console.log('[VPP] goStart()', args);
        const { goStart } = await import('./navigation');
        goStart();
    }

    public async markerBack(args: JsonObject): Promise<void> {
        console.log('[VPP] markerBack()', args);
        const offset = this.offset(args);
        const count = Math.abs(offset);
        if (count === 0) return;
        const direction = this.relativeDirection(offset, -1);
        const navigation = await import('./navigation');
        const step = direction < 0 ? navigation.goPreviousCue : navigation.goNextCue;
        for (let i = 0; i < count; i++) step();
    }

    public async goBack(args: JsonObject): Promise<void> {
        console.log('[VPP] goBack()', args);
        const offset = this.offset(args);
        const count = Math.abs(offset);
        if (count === 0) return;
        const direction = this.relativeDirection(offset, -1);
        const { navigateParagraphs } = await import('./render');
        navigateParagraphs(direction < 0 ? 'back' : 'forward', count);
    }

    public async goCurrent(args: JsonObject): Promise<void> {
        console.log('[VPP] goCurrent()', args);
        const count = Math.abs(this.offset(args));
        if (count === 0) return;

        const { goCurrentParagraph } = await import('./navigation');
        goCurrentParagraph();

        if (count > 1) {
            const { navigateParagraphs } = await import('./render');
            navigateParagraphs('back', count - 1);
        }
    }

    public async goNext(args: JsonObject): Promise<void> {
        console.log('[VPP] goNext()', args);
        const offset = this.offset(args);
        const count = Math.abs(offset);
        if (count === 0) return;
        const direction = this.relativeDirection(offset, 1);
        const { navigateParagraphs } = await import('./render');
        navigateParagraphs(direction < 0 ? 'back' : 'forward', count);
    }

    public async markerNext(args: JsonObject): Promise<void> {
        console.log('[VPP] markerNext()', args);
        const offset = this.offset(args);
        const count = Math.abs(offset);
        if (count === 0) return;
        const direction = this.relativeDirection(offset, 1);
        const navigation = await import('./navigation');
        const step = direction < 0 ? navigation.goPreviousCue : navigation.goNextCue;
        for (let i = 0; i < count; i++) step();
    }

    public async goFinish(args: JsonObject): Promise<void> {
        console.log('[VPP] goFinish()', args);
        const { goFinish } = await import('./navigation');
        goFinish();
    }
}

export const remoteCommandHandler = new RemoteCommandHandler();
