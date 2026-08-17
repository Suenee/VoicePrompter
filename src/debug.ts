type ConsoleMethod = (...args: unknown[]) => void;

const params = new URLSearchParams(window.location.search);
const rawDebug = (params.get('debug') || '').trim().toLowerCase();
const debugTokens = new Set(rawDebug.split(',').map(token => token.trim()).filter(Boolean));

const debugAll = ['1', 'true', 'yes', 'on', 'all', '*'].some(token => debugTokens.has(token));
const originalLog: ConsoleMethod = console.log.bind(console);
const originalInfo: ConsoleMethod = console.info.bind(console);

function isVppMessage(args: unknown[]): boolean {
    const first = args[0];
    return typeof first === 'string' && (
        first.includes('[VPP]') ||
        first.includes('[RemoteControl]') ||
        first.includes('[VPB]')
    );
}

function shouldEmit(args: unknown[]): boolean {
    if (debugAll) return true;
    if (debugTokens.has('vpp') && isVppMessage(args)) return true;
    return false;
}

console.log = (...args: unknown[]) => {
    if (shouldEmit(args)) originalLog(...args);
};

console.info = (...args: unknown[]) => {
    if (shouldEmit(args)) originalInfo(...args);
};

export function isDebugEnabled(scope?: string): boolean {
    if (debugAll) return true;
    if (!scope) return debugTokens.size > 0;
    return debugTokens.has(scope.toLowerCase());
}
