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

    setSender(sender: Sender | null): void {
        this.sender = sender;
    }

    handle(rawMessage: unknown): void {
        const text = typeof rawMessage === 'string' ? rawMessage : String(rawMessage ?? '');
        let message: JsonObject;

        try {
            const parsed = JSON.parse(text);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                console.warn('[VPP] DROPPED - INVALID VPP MESSAGE: top-level JSON value must be an object', parsed);
                return;
            }
            message = parsed as JsonObject;
        } catch {
            console.warn('[VPP] DROPPED - INVALID JSON:', text);
            return;
        }

        const envelopeError = this.validateEnvelope(message);
        if (envelopeError) {
            this.rejectInvalidMessage(message, envelopeError);
            return;
        }

        if (message.protocolVersion !== 1) {
            this.sendError(message, 'UNSUPPORTED_PROTOCOL_VERSION', 'Unsupported protocol version', {
                received: message.protocolVersion,
                supported: 1
            });
            return;
        }

        console.log('[VPP] Message received:', message);

        if (message.type === 'call') {
            const callError = this.validateCall(message);
            if (callError) {
                this.rejectInvalidMessage(message, callError);
                return;
            }
            void this.handleCall(message as CallMessage);
            return;
        }

        console.log(`[VPP] ${message.type} received (no handler yet):`, message);
    }

    private validateEnvelope(message: JsonObject): string | null {
        if (typeof message.protocolVersion !== 'number' || !Number.isInteger(message.protocolVersion)) return 'protocolVersion must be an integer';
        if (typeof message.id !== 'string' || message.id.trim() === '') return 'id must be a non-empty string';
        if (typeof message.type !== 'string' || !this.messageTypes.has(message.type as MessageType)) return 'type must be one of: call, event, progress, response, error';
        if (message.source !== undefined && (!message.source || typeof message.source !== 'object' || Array.isArray(message.source))) return 'source must be an object when present';
        if (message.timestamp !== undefined && (typeof message.timestamp !== 'string' || message.timestamp.trim() === '')) return 'timestamp must be a non-empty string when present';
        if (message.correlationId !== undefined && (typeof message.correlationId !== 'string' || message.correlationId.trim() === '')) return 'correlationId must be a non-empty string when present';
        return null;
    }

    private validateCall(message: JsonObject): string | null {
        if (typeof message.method !== 'string' || message.method.trim() === '') return 'call.method must be a non-empty string';
        if (!message.args || typeof message.args !== 'object' || Array.isArray(message.args)) return 'call.args must be a JSON object';
        if (message.expectsResponse !== undefined && typeof message.expectsResponse !== 'boolean') return 'call.expectsResponse must be boolean when present';

        const args = message.args as JsonObject;
        if (args.offset !== undefined && (typeof args.offset !== 'number' || !Number.isFinite(args.offset) || !Number.isInteger(args.offset))) {
            return 'call.args.offset must be a finite integer when present';
        }
        return null;
    }

    private rejectInvalidMessage(message: JsonObject, reason: string): void {
        console.warn(`[VPP] DROPPED - INVALID VPP MESSAGE: ${reason}`, message);
        if (typeof message.id === 'string' && message.id.trim() !== '') {
            this.sendError(message, 'INVALID_MESSAGE', 'Message does not conform to VoicePrompter Protocol', { reason });
        }
    }

    private async handleCall(call: CallMessage): Promise<void> {
        const method = call.method as PublicMethod;
        const handler = this.publicMethods[method];

        if (!handler) {
            console.warn(`[VPP] Method not allowed or unknown: ${String(call.method)}`);
            this.sendError(call, 'METHOD_NOT_FOUND', 'Requested method does not exist or is not public', { method: call.method });
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
        return args.offset === undefined ? 0 : args.offset as number;
    }

    private relativeDirection(offset: number, defaultDirection: 1 | -1): 1 | -1 {
        if (offset < 0) return defaultDirection === 1 ? -1 : 1;
        return defaultDirection;
    }

    private async jumpToEdgeWithOffset(edge: 'start' | 'finish', offset: number): Promise<void> {
        const navigation = await import('./navigation');
        if (offset === 0) {
            if (edge === 'start') navigation.goStart();
            else navigation.goFinish();
            return;
        }

        const { state } = await import('./state');
        const smoothAnimations = state.config.smoothAnimations;
        state.config.smoothAnimations = false;
        try {
            if (edge === 'start') navigation.goStart();
            else navigation.goFinish();
        } finally {
            state.config.smoothAnimations = smoothAnimations;
        }

        const { navigateParagraphs } = await import('./render');
        navigateParagraphs(edge === 'start' ? 'forward' : 'back', offset);
    }

    public async goStart(args: JsonObject): Promise<void> {
        console.log('[VPP] goStart()', args);
        await this.jumpToEdgeWithOffset('start', Math.abs(this.offset(args)));
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
        await this.jumpToEdgeWithOffset('finish', Math.abs(this.offset(args)));
    }
}

export const remoteCommandHandler = new RemoteCommandHandler();
