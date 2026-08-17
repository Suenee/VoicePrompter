import { remoteCommandHandler } from './remote-command-handler';
import { state } from './state';

type MarkerArg = number | string;

interface ParsedMarker {
    command: string;
    args: MarkerArg[];
}

interface MarkerHookArgs {
    marker?: string;
    text?: string;
}

export class RemoteEventHooks {
    public HookMarker(args: MarkerHookArgs): void {
        const marker = String(args?.marker ?? args?.text ?? '').trim();
        if (!marker) return;

        const parsed = this.parseMarker(marker);
        if (!parsed) {
            console.warn('[VPP] Marker ignored - invalid marker syntax:', marker);
            return;
        }

        remoteCommandHandler.sendProtocolMessage({
            protocolVersion: 1,
            id: crypto.randomUUID(),
            type: 'event',
            from: 'vp',
            recipient: 'bc',
            event: 'marker',
            command: parsed.command,
            args: parsed.args,
            expectsResponse: true,
            source: { app: 'VoicePrompter', version: 'devel' },
            timestamp: new Date().toISOString()
        });
    }

    public SyncCurrentMarker(): void {
        const marker = this.findCurrentMarker();
        if (!marker) return;
        this.HookMarker({ marker });
    }

    private findCurrentMarker(): string | null {
        if (state.scriptWords.length === 0) return null;

        let currentMarker: string | null = null;
        const maxIndex = Math.min(state.currentIndex, state.scriptWords.length - 1);

        for (let i = 0; i <= maxIndex; i++) {
            if (!state.scriptWords[i].word.startsWith('[')) continue;

            let end = i;
            while (end < state.scriptWords.length && !state.scriptWords[end].word.includes(']')) {
                if (end > i && (state.scriptWords[end].isBreak || state.scriptWords[end].isStop)) break;
                end++;
            }

            if (end >= state.scriptWords.length || !state.scriptWords[end].word.includes(']')) continue;

            currentMarker = state.scriptWords
                .slice(i, end + 1)
                .map(word => word.word)
                .join(' ');

            i = end;
        }

        return currentMarker;
    }

    private parseMarker(rawMarker: string): ParsedMarker | null {
        const body = rawMarker.startsWith('[') && rawMarker.endsWith(']')
            ? rawMarker.slice(1, -1).trim()
            : rawMarker.trim();

        if (!body) return null;

        const firstArg = this.findFirstArgument(body);
        if (!firstArg) {
            const command = this.normalizeCommand(body);
            return command ? { command, args: [] } : null;
        }

        const command = this.normalizeCommand(body.slice(0, firstArg.index));
        if (!command) return null;

        const argsText = body.slice(firstArg.index).trim();
        const parsedArgs = this.parseArguments(argsText);
        if (!parsedArgs) return null;

        return { command, args: parsedArgs };
    }

    private findFirstArgument(body: string): { index: number } | null {
        let inQuote = false;
        let escaped = false;

        for (let i = 0; i < body.length; i++) {
            const ch = body[i];

            if (inQuote) {
                if (escaped) escaped = false;
                else if (ch === '\\') escaped = true;
                else if (ch === '"') inQuote = false;
                continue;
            }

            if (ch === '"') {
                if (i === 0 || /\s/.test(body[i - 1])) return { index: i };
                inQuote = true;
                continue;
            }

            if ((i === 0 || /\s/.test(body[i - 1])) && this.numberStartsAt(body, i)) {
                return { index: i };
            }
        }

        return null;
    }

    private numberStartsAt(text: string, index: number): boolean {
        const rest = text.slice(index);
        return /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?=\s|,|$)/.test(rest);
    }

    private parseArguments(input: string): MarkerArg[] | null {
        const args: MarkerArg[] = [];
        let i = 0;
        let expectArgument = true;

        while (i < input.length) {
            while (i < input.length && /\s/.test(input[i])) i++;
            if (i >= input.length) break;

            if (!expectArgument) {
                if (input[i] !== ',') return null;
                i++;
                expectArgument = true;
                continue;
            }

            if (input[i] === '"') {
                const quoted = this.readQuotedArgument(input, i);
                if (!quoted) return null;
                args.push(quoted.value);
                i = quoted.nextIndex;
                expectArgument = false;
                continue;
            }

            const numberMatch = input.slice(i).match(/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)/);
            if (!numberMatch) return null;

            const token = numberMatch[0];
            const next = i + token.length;
            if (next < input.length && !/[\s,]/.test(input[next])) return null;

            args.push(Number(token));
            i = next;
            expectArgument = false;
        }

        return expectArgument && args.length > 0 ? null : args;
    }

    private readQuotedArgument(input: string, start: number): { value: string; nextIndex: number } | null {
        let value = '';
        let escaped = false;

        for (let i = start + 1; i < input.length; i++) {
            const ch = input[i];
            if (escaped) {
                value += ch;
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === '"') {
                return { value, nextIndex: i + 1 };
            } else {
                value += ch;
            }
        }

        return null;
    }

    private normalizeCommand(command: string): string {
        return command.trim().replace(/\s+/g, ' ');
    }
}

export const remoteEventHooks = new RemoteEventHooks();

window.addEventListener('vp-resync-current-marker', () => {
    remoteEventHooks.SyncCurrentMarker();
});
