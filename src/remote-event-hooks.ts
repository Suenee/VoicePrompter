import { remoteCommandHandler } from './remote-command-handler';

export class RemoteEventHooks {
    public HookMarker(args: { text: string }): void {
        const text = String(args?.text ?? '');
        if (!text) return;

        remoteCommandHandler.sendProtocolMessage({
            protocolVersion: 1,
            id: crypto.randomUUID(),
            type: 'event',
            event: 'marker',
            data: { text },
            source: { app: 'VoicePrompter', version: 'devel' },
            timestamp: new Date().toISOString()
        });
    }
}

export const remoteEventHooks = new RemoteEventHooks();
