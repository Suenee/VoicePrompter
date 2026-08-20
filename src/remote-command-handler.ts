import './debug';
import './google-doc-sync';
import './remote-control-instance';

type JsonObject = Record<string, unknown>;
type Sender = (message: JsonObject) => void;
type PublicHandler = (args: JsonObject) => Promise<JsonObject | void>;

type PublicMethod =
    | 'goStart'
    | 'markerBack'
    | 'goBack'
    | 'goCurrent'
    | 'goNext'
    | 'markerNext'
    | 'goFinish'
    | 'setMicrophone'
    | 'setFontSize'
    | 'adjustFontSize'
    | 'setVoiceCommands'
    | 'setRotateScreen'
    | 'setAlignment'
    | 'setMirrorMode'
    | 'setRecordingDockOpacity'
    | 'adjustRecordingDockOpacity'
    | 'syncGoogleDoc'
    | 'setGoogleDocUrl'
    | 'setStatusBarMode'
    | 'setStatusBarZoneCount'
    | 'setStatusBarZone'
    | 'clearStatusBar';

type MessageType = 'call' | 'event' | 'progress' | 'response' | 'error';
type RoutingName = 'vp' | 'bc' | 'server';
type StatusBarMode = 'off' | 'top' | 'bottom';
type StatusBarAlign = 'left' | 'center' | 'right';
type ToggleState = 'on' | 'off' | 'toggle';

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
        goFinish: args => this.goFinish(args),
        setMicrophone: args => this.setMicrophone(args),
        setFontSize: args => this.setFontSize(args),
        adjustFontSize: args => this.adjustFontSize(args),
        setVoiceCommands: args => this.setVoiceCommands(args),
        setRotateScreen: args => this.setRotateScreen(args),
        setAlignment: args => this.setAlignment(args),
        setMirrorMode: args => this.setMirrorMode(args),
        setRecordingDockOpacity: args => this.setRecordingDockOpacity(args),
        adjustRecordingDockOpacity: args => this.adjustRecordingDockOpacity(args),
        syncGoogleDoc: args => this.syncGoogleDoc(args),
        setGoogleDocUrl: args => this.setGoogleDocUrl(args),
        setStatusBarMode: args => this.setStatusBarMode(args),
        setStatusBarZoneCount: args => this.setStatusBarZoneCount(args),
        setStatusBarZone: args => this.setStatusBarZone(args),
        clearStatusBar: args => this.clearStatusBar(args)
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
        } else if (message.type === 'event' && message.event === 'disconnecting') {
            this.handleDisconnectingEvent(message);
            // The central transport must not interpret an announced departure as
            // proof that the peer is still connected. The UI warning is handled
            // through the internal CustomEvent below, without a second WS listener.
            return null;
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

    private validateToggleState(args: JsonObject, method: string): string | null {
        const keys = Object.keys(args);
        if (keys.length !== 1 || keys[0] !== 'state') return `${method} accepts exactly the state argument`;
        if (args.state !== 'on' && args.state !== 'off' && args.state !== 'toggle') return `${method}.state must be on, off or toggle`;
        return null;
    }

    private isGoogleDocUrl(value: string): boolean {
        try {
            const url = new URL(value);
            return url.protocol === 'https:' && url.hostname === 'docs.google.com' && url.pathname.startsWith('/document/');
        } catch {
            return false;
        }
    }

    private handleDisconnectingEvent(message: JsonObject): void {
        const args = message.args;
        if (!args || typeof args !== 'object' || Array.isArray(args)) {
            this.rejectInvalidMessage(message, 'disconnecting.args must be an object');
            return;
        }

        const eventArgs = args as JsonObject;
        if (Object.keys(eventArgs).length !== 1 || typeof eventArgs.reason !== 'string') {
            this.rejectInvalidMessage(message, 'disconnecting accepts exactly the reason argument');
            return;
        }

        const reason = eventArgs.reason;
        const valid =
            (message.from === 'bc' && reason === 'user') ||
            (message.from === 'server' && (reason === 'shutdown' || reason === 'restart' || reason === 'exit'));

        if (!valid) {
            this.rejectInvalidMessage(message, 'invalid disconnecting sender/reason combination');
            return;
        }

        window.dispatchEvent(new CustomEvent('vp-vpp-disconnecting', {
            detail: { from: message.from, reason }
        }));
    }

    private validateCall(message: JsonObject): string | null {
        if (message.from !== 'bc') return 'application calls to vp must come from bc';
        if (typeof message.method !== 'string' || message.method.trim() === '') return 'call.method must be a non-empty string';
        if (!message.args || typeof message.args !== 'object' || Array.isArray(message.args)) return 'call.args must be a JSON object';

        const method = message.method as PublicMethod;
        if (!this.publicMethods[method]) return `unknown method: ${message.method}`;

        const args = message.args as JsonObject;
        const keys = Object.keys(args);

        if (
            method === 'goStart' ||
            method === 'goFinish' ||
            method === 'syncGoogleDoc' ||
            method === 'clearStatusBar'
        ) {
            if (keys.length !== 0) return `${method} does not accept arguments`;
            return null;
        }

        if (
            method === 'setMicrophone' ||
            method === 'setVoiceCommands' ||
            method === 'setRotateScreen' ||
            method === 'setMirrorMode'
        ) {
            return this.validateToggleState(args, method);
        }

        if (method === 'setFontSize') {
            if (keys.length !== 1 || keys[0] !== 'size') return 'setFontSize accepts exactly the size argument';
            if (typeof args.size !== 'number' || !Number.isInteger(args.size) || args.size < 20 || args.size > 100) return 'setFontSize.size must be an integer from 20 through 100';
            return null;
        }

        if (method === 'adjustFontSize') {
            if (keys.length !== 1 || keys[0] !== 'delta') return 'adjustFontSize accepts exactly the delta argument';
            if (typeof args.delta !== 'number' || !Number.isFinite(args.delta) || !Number.isInteger(args.delta)) return 'adjustFontSize.delta must be a finite integer';
            return null;
        }

        if (method === 'setAlignment') {
            if (keys.length !== 1 || keys[0] !== 'align') return 'setAlignment accepts exactly the align argument';
            if (args.align !== 'left' && args.align !== 'center' && args.align !== 'right') return 'setAlignment.align must be left, center or right';
            return null;
        }

        if (method === 'setRecordingDockOpacity') {
            if (keys.length !== 1 || keys[0] !== 'opacity') return 'setRecordingDockOpacity accepts exactly the opacity argument';
            if (typeof args.opacity !== 'number' || !Number.isInteger(args.opacity) || args.opacity < 30 || args.opacity > 100) return 'setRecordingDockOpacity.opacity must be an integer from 30 through 100';
            return null;
        }

        if (method === 'adjustRecordingDockOpacity') {
            if (keys.length !== 1 || keys[0] !== 'delta') return 'adjustRecordingDockOpacity accepts exactly the delta argument';
            if (typeof args.delta !== 'number' || !Number.isFinite(args.delta) || !Number.isInteger(args.delta)) return 'adjustRecordingDockOpacity.delta must be a finite integer';
            return null;
        }

        if (method === 'setGoogleDocUrl') {
            if (keys.length !== 1 || keys[0] !== 'url') return 'setGoogleDocUrl accepts exactly the url argument';
            if (typeof args.url !== 'string' || args.url.trim() === '') return 'setGoogleDocUrl.url must be a non-empty string';
            if (!this.isGoogleDocUrl(args.url)) return 'setGoogleDocUrl.url must be an absolute HTTPS docs.google.com/document/... URL';
            return null;
        }

        if (method === 'setStatusBarMode') {
            if (keys.length !== 1 || keys[0] !== 'mode') return 'setStatusBarMode accepts exactly the mode argument';
            if (args.mode !== 'off' && args.mode !== 'top' && args.mode !== 'bottom') return 'setStatusBarMode.mode must be off, top or bottom';
            return null;
        }

        if (method === 'setStatusBarZoneCount') {
            if (keys.length !== 1 || keys[0] !== 'count') return 'setStatusBarZoneCount accepts exactly the count argument';
            if (typeof args.count !== 'number' || !Number.isInteger(args.count) || args.count < 1) {
                return 'setStatusBarZoneCount.count must be a positive integer';
            }
            return null;
        }

        if (method === 'setStatusBarZone') {
            if (
                keys.length !== 3 ||
                !keys.includes('index') ||
                !keys.includes('text') ||
                !keys.includes('align')
            ) {
                return 'setStatusBarZone accepts exactly index, text and align';
            }

            if (typeof args.index !== 'number' || !Number.isInteger(args.index) || args.index < 1) {
                return 'setStatusBarZone.index must be a positive integer';
            }
            if (typeof args.text !== 'string') return 'setStatusBarZone.text must be a string';
            if ([...args.text].length > 1024) return 'setStatusBarZone.text must not exceed 1024 Unicode characters';
            if (args.align !== 'left' && args.align !== 'center' && args.align !== 'right') {
                return 'setStatusBarZone.align must be left, center or right';
            }
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
            const result = await handler(call.args);
            if (call.expectsResponse) {
                this.send({
                    protocolVersion: 1,
                    id: crypto.randomUUID(),
                    correlationId: call.id,
                    type: 'response',
                    from: 'vp',
                    recipient: 'bc',
                    result: result ?? { success: true },
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
        const navigation = await import('./navigation');

        if (offset >= 0) {
            navigation.goMarkerBack(offset);
            return;
        }

        // Preserve the established negative-offset compatibility behavior.
        for (let i = 0; i < Math.abs(offset); i++) navigation.goNextCue();
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

    public async setMicrophone(args: JsonObject): Promise<void> {
        const controls = await import('./remote-vpp-controls');
        controls.setMicrophoneState(args.state as ToggleState);
    }

    public async setFontSize(args: JsonObject): Promise<void> {
        const controls = await import('./remote-vpp-controls');
        controls.setFontSizePx(args.size as number);
    }

    public async adjustFontSize(args: JsonObject): Promise<void> {
        const controls = await import('./remote-vpp-controls');
        controls.adjustFontSizePx(args.delta as number);
    }

    public async setVoiceCommands(args: JsonObject): Promise<void> {
        const controls = await import('./remote-vpp-controls');
        controls.setVoiceCommandsState(args.state as ToggleState);
    }

    public async setRotateScreen(args: JsonObject): Promise<void> {
        const controls = await import('./remote-vpp-controls');
        controls.setRotateScreenState(args.state as ToggleState);
    }

    public async setAlignment(args: JsonObject): Promise<void> {
        const controls = await import('./remote-vpp-controls');
        controls.setAlignment(args.align as StatusBarAlign);
    }

    public async setMirrorMode(args: JsonObject): Promise<void> {
        const controls = await import('./remote-vpp-controls');
        controls.setMirrorModeState(args.state as ToggleState);
    }

    public async setRecordingDockOpacity(args: JsonObject): Promise<void> {
        const controls = await import('./remote-vpp-controls');
        controls.setRecordingDockOpacity(args.opacity as number);
    }

    public async adjustRecordingDockOpacity(args: JsonObject): Promise<void> {
        const controls = await import('./remote-vpp-controls');
        controls.adjustRecordingDockOpacity(args.delta as number);
    }

    public async syncGoogleDoc(_args: JsonObject): Promise<void> {
        const controls = await import('./remote-vpp-controls');
        await controls.syncGoogleDoc();
    }

    public async setGoogleDocUrl(args: JsonObject): Promise<void> {
        const controls = await import('./remote-vpp-controls');
        controls.setGoogleDocUrl((args.url as string).trim());
    }

    public async setStatusBarMode(args: JsonObject): Promise<void> {
        const { setStatusBarMode } = await import('./remote-control');
        setStatusBarMode(args.mode as StatusBarMode);
    }

    public async setStatusBarZoneCount(args: JsonObject): Promise<void> {
        const { setStatusBarZoneCount } = await import('./remote-control');
        setStatusBarZoneCount(args.count as number);
    }

    public async setStatusBarZone(args: JsonObject): Promise<void> {
        const { setStatusBarZone } = await import('./remote-control');
        setStatusBarZone(
            args.index as number,
            args.text as string,
            args.align as StatusBarAlign
        );
    }

    public async clearStatusBar(_args: JsonObject): Promise<void> {
        const { clearStatusBarData } = await import('./remote-control');
        clearStatusBarData();
    }
}

export const remoteCommandHandler = new RemoteCommandHandler();