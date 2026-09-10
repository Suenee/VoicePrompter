import { remoteCommandHandler } from './remote-command-handler';
import { state } from './state';

type JsonObject = Record<string, unknown>;
type PublicHandler = (args: JsonObject) => Promise<JsonObject | void>;
type SearchFrom = 'cursorForward' | 'cursorBackward' | 'start' | 'end';
type MatchMode = 'substring' | 'exact';
type CaseSensitiveMode = boolean | 'no' | 'yes';

interface InternalRemoteCommandHandler {
    publicMethods: Record<string, PublicHandler>;
    validateCall: (message: JsonObject) => string | null;
}

interface MarkerRange {
    start: number;
    end: number;
    after: number;
    text: string;
}

const installKey = '__voicePrompterSearchMarkerInstalled';
const installState = window as unknown as Record<string, unknown>;

function cueEnd(start: number): number {
    for (let i = start; i < state.scriptWords.length; i++) {
        if (state.scriptWords[i].word.includes(']')) return i;
        if (i > start && (state.scriptWords[i].isBreak || state.scriptWords[i].isStop)) break;
    }
    return start;
}

function readableAfterCue(start: number): number {
    let target = cueEnd(start) + 1;
    while (target < state.scriptWords.length && state.scriptWords[target].skip) target++;
    return target;
}

function getMarkers(): MarkerRange[] {
    const markers: MarkerRange[] = [];

    for (let i = 0; i < state.scriptWords.length; i++) {
        if (!state.scriptWords[i].word.startsWith('[')) continue;

        const end = cueEnd(i);
        const text = state.scriptWords
            .slice(i, end + 1)
            .map(word => word.word)
            .join(' ');

        markers.push({
            start: i,
            end,
            after: readableAfterCue(i),
            text
        });
        i = end;
    }

    return markers;
}

function normalizeMarkerText(value: string): string {
    let normalized = value.trim();
    if (normalized.startsWith('[') && normalized.endsWith(']')) {
        normalized = normalized.slice(1, -1).trim();
    }
    return normalized;
}

function markerMatches(marker: MarkerRange, search: string, match: MatchMode, caseSensitive: boolean): boolean {
    let markerText = normalizeMarkerText(marker.text);
    let searchText = normalizeMarkerText(search);

    if (!caseSensitive) {
        markerText = markerText.toLowerCase();
        searchText = searchText.toLowerCase();
    }

    return match === 'exact'
        ? markerText === searchText
        : markerText.includes(searchText);
}

function currentMarker(markers: MarkerRange[]): MarkerRange | null {
    return markers.find(marker =>
        state.currentIndex >= marker.start &&
        state.currentIndex <= Math.max(marker.end, marker.after)
    ) ?? null;
}

async function applyMarker(marker: MarkerRange): Promise<void> {
    if (state.scriptWords.length === 0) return;

    state.currentIndex = Math.max(0, Math.min(marker.end + 1, state.scriptWords.length - 1));
    const { advancePastSkipped, updateHighlight, scrollToCurrent } = await import('./render');
    advancePastSkipped();
    updateHighlight();
    scrollToCurrent();
}

function resolveCaseSensitive(value: CaseSensitiveMode | undefined): boolean {
    return value === true || value === 'yes';
}

async function searchMarker(args: JsonObject): Promise<void> {
    if (state.scriptWords.length === 0) return;

    const search = String(args.search ?? '');
    const from = (args.from ?? 'cursorForward') as SearchFrom;
    const match = (args.match ?? 'substring') as MatchMode;
    const caseSensitive = resolveCaseSensitive(args.caseSensitive as CaseSensitiveMode | undefined);
    const markers = getMarkers();
    const active = currentMarker(markers);
    const matches = (marker: MarkerRange): boolean =>
        marker !== active && markerMatches(marker, search, match, caseSensitive);

    let target: MarkerRange | undefined;

    switch (from) {
        case 'cursorForward':
            target = markers.find(marker => marker.start > state.currentIndex && matches(marker));
            break;
        case 'cursorBackward':
            target = [...markers]
                .reverse()
                .find(marker => marker.start < state.currentIndex && matches(marker));
            break;
        case 'start':
            target = markers.find(matches);
            break;
        case 'end':
            target = [...markers].reverse().find(matches);
            break;
    }

    if (!target) {
        console.info('[VPP][searchMarker] no matching marker', {
            search,
            from,
            match,
            caseSensitive,
            currentIndex: state.currentIndex
        });
        return;
    }

    const previousIndex = state.currentIndex;
    await applyMarker(target);
    console.info('[VPP][searchMarker] marker found', {
        search,
        from,
        match,
        caseSensitive,
        marker: target.text,
        markerStart: target.start,
        previousIndex,
        resultIndex: state.currentIndex
    });
}

function validateSearchMarkerCall(message: JsonObject): string | null {
    if (message.from !== 'bc') return 'application calls to vp must come from bc';
    if (message.method !== 'searchMarker') return 'call.method must be searchMarker';
    if (!message.args || typeof message.args !== 'object' || Array.isArray(message.args)) {
        return 'call.args must be a JSON object';
    }

    const args = message.args as JsonObject;
    const allowedKeys = new Set(['search', 'from', 'match', 'caseSensitive']);
    const keys = Object.keys(args);
    if (keys.some(key => !allowedKeys.has(key))) {
        return 'searchMarker accepts only search, from, match and caseSensitive arguments';
    }

    if (typeof args.search !== 'string' || normalizeMarkerText(args.search) === '') {
        return 'searchMarker.search must be a non-empty string';
    }

    if (
        args.from !== undefined &&
        args.from !== 'cursorForward' &&
        args.from !== 'cursorBackward' &&
        args.from !== 'start' &&
        args.from !== 'end'
    ) {
        return 'searchMarker.from must be cursorForward, cursorBackward, start or end';
    }

    if (args.match !== undefined && args.match !== 'substring' && args.match !== 'exact') {
        return 'searchMarker.match must be substring or exact';
    }

    if (
        args.caseSensitive !== undefined &&
        args.caseSensitive !== true &&
        args.caseSensitive !== false &&
        args.caseSensitive !== 'no' &&
        args.caseSensitive !== 'yes'
    ) {
        return 'searchMarker.caseSensitive must be no, yes or boolean';
    }

    return null;
}

function install(): void {
    if (installState[installKey]) return;

    const internal = remoteCommandHandler as unknown as InternalRemoteCommandHandler;
    installState[installKey] = true;
    internal.publicMethods.searchMarker = searchMarker;

    const originalValidateCall = internal.validateCall.bind(remoteCommandHandler);
    internal.validateCall = (message: JsonObject): string | null => {
        if (message.method === 'searchMarker') return validateSearchMarkerCall(message);
        return originalValidateCall(message);
    };
}

// remote-event-hooks is part of a pre-existing module cycle through
// remote-command-handler/google-doc-sync. Delay registration until the current
// module graph has finished evaluating so remoteCommandHandler is initialized.
window.setTimeout(install, 0);
