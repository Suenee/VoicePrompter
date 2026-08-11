export class RemoteCommandHandler {
    handle(rawMessage: unknown): void {
        const text = typeof rawMessage === 'string' ? rawMessage : String(rawMessage ?? '');
        let parsed: unknown = null;

        try {
            parsed = JSON.parse(text);
        } catch {
            // Plain-text commands are valid input for diagnostics too.
        }

        if (parsed !== null) {
            console.log('[VPB] Command received:', parsed);
        } else {
            console.log('[VPB] Command received:', text);
        }
    }
}

export const remoteCommandHandler = new RemoteCommandHandler();
