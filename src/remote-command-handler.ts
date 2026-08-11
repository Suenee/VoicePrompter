import {
    goStart as navigateGoStart,
    goPreviousParagraph,
    goCurrentParagraph,
    goNextParagraph,
    goPreviousCue,
    goNextCue,
    goFinish as navigateGoFinish
} from './navigation';

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

    private readonly publicMethods: Record<PublicMethod, (args: JsonObject) => void> = {
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
            // VPBridge should already reject this at transport level. Keep the receiver defensive.
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
            this.handleCall(message as CallMessage);
            return;
        }

        console.log(`[VPP] ${message.type} received (no handler yet):`, message);
    }

    private validateEnvelope(message: JsonObject): string | null {
        if (typeof message.protocolVersion !== 'number' || !Number.isInteger(message.protocolVersion)) {
            return 'protocolVersion must be an integer';
        }
        if (typeof message.id !== 'string' || message.id.trim() === '') {
            return 'id must be a non-empty string';
        }
        if (typeof message.type !== 'string' || !this.messageTypes.has(message.type as MessageType)) {
            return 'type must be one of: call, event, progress, response, error';
        }
        if (message.source !== undefined && (!message.source || typeof message.source !== 'object' || Array.isArray(message.source))) {
            return 'source must be an object when present';
        }
        if (message.timestamp !== undefined && (typeof message.timestamp !== 'string' || message.timestamp.trim() === '')) {
            return 'timestamp must be a non-empty string when present';
        }
        if (message.correlationId !== undefined && (typeof message.correlationId !== 'string' || message.correlationId.trim() === '')) {
            return 'correlationId must be a non-empty string when present';
        }
        return null;
    }

    private validateCall(message: JsonObject): string | null {
        if (typeof message.method !== 'string' || message.method.trim() === '') {
            return 'call.method must be a non-empty string';
        }
        if (!message.args || typeof message.args !== 'object' || Array.isArray(message.args)) {
            return 'call.args must be a JSON object';
        }
        if (message.expectsResponse !== undefined && typeof message.expectsResponse !== 'boolean') {
            return 'call.expectsResponse must be boolean when present';
        }
        return null;
    }

    private rejectInvalidMessage(message: JsonObject, reason: string): void {
        console.warn(`[VPP] DROPPED - INVALID VPP MESSAGE: ${reason}`, message);

        if (typeof message.id === 'string' && message.id.trim() !== '') {
            this.sendError(message, 'INVALID_MESSAGE', 'Message does not conform to VoicePrompter Protocol', { reason });
        }
    }

    private handleCall(call: CallMessage): void {
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
            handler(call.args);
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

    public goStart(args: JsonObject): void {
        console.log('[VPP] goStart()', args);
        navigateGoStart();
    }

    public markerBack(args: JsonObject): void {
        console.log('[VPP] markerBack()', args);
        goPreviousCue();
    }

    public goBack(args: JsonObject): void {
        console.log('[VPP] goBack()', args);
        goPreviousParagraph();
    }

    public goCurrent(args: JsonObject): void {
        console.log('[VPP] goCurrent()', args);
        goCurrentParagraph();
    }

    public goNext(args: JsonObject): void {
        console.log('[VPP] goNext()', args);
        goNextParagraph();
    }

    public markerNext(args: JsonObject): void {
        console.log('[VPP] markerNext()', args);
        goNextCue();
    }

    public goFinish(args: JsonObject): void {
        console.log('[VPP] goFinish()', args);
        navigateGoFinish();
    }
}

export const remoteCommandHandler = new RemoteCommandHandler();
