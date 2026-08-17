import { state } from './state';
import { els } from './elements';
import { updateMicUI, updateHighlight, scrollToCurrent, advancePastSkipped, restartScript, navigateParagraphs } from './render';
import { goCurrentParagraph, goNextCue, goPreviousCue } from './navigation';
import { getVoiceCommandAliases, reportVoiceCommandRecognition, VoiceCommandAction } from './voice-command-settings';

let lastMatchedWord = '';
let speechBlocked = false;
let commandArmed = true;
let isFirstStart = true;
let gotResultOnFirstStart = false;
let voiceSessionId = 0;
let voiceSessionStartedAt = 0;
let recognitionCycle = 0;
const voiceDebugEnabled = new URLSearchParams(window.location.search).get('debug') === 'voice';

function voiceElapsed(): string {
    if (!voiceSessionStartedAt) return '+00:00:00.000';
    const elapsed = Math.max(0, performance.now() - voiceSessionStartedAt);
    const hours = Math.floor(elapsed / 3600000);
    const minutes = Math.floor((elapsed % 3600000) / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);
    const millis = Math.floor(elapsed % 1000);
    return `+${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function voiceDebug(event: string, details = ''): void {
    if (!voiceDebugEnabled) return;
    const suffix = details ? ` ${details}` : '';
    console.log(`[VoiceDebug #${voiceSessionId} C${recognitionCycle}] ${voiceElapsed()} ${event}${suffix}`);
}

function voiceState(): string {
    return `isListening=${state.isListening} speechBlocked=${speechBlocked} firstStart=${isFirstStart} gotResult=${gotResultOnFirstStart} lang=${state.recognition?.lang || ''} selectedLanguage=${state.selectedLanguage}`;
}

function showBrowserWarning() { els.browserWarning.classList.remove('hidden'); }
function runVoiceCommand(action: VoiceCommandAction): void {
    if (action === 'goStart') restartScript();
    else if (action === 'goFinish') { state.currentIndex = Math.max(0, state.scriptWords.length - 1); updateHighlight(); scrollToCurrent(); }
    else if (action === 'goNext') navigateParagraphs('forward', 1);
    else if (action === 'goBack') navigateParagraphs('back', 1);
    else if (action === 'goCurrent') goCurrentParagraph();
    else if (action === 'cueNext') goNextCue();
    else if (action === 'cueBack') goPreviousCue();
}
function normalizeCommandText(value: string): string {
    return value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
}
export function initSpeech(): void {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { showBrowserWarning(); return; }
    state.recognition = new SpeechRecognition(); state.recognition.continuous = true; state.recognition.interimResults = true; state.recognition.lang = state.selectedLanguage;
    if (voiceDebugEnabled) {
        state.recognition.onstart = () => voiceDebug('onstart', voiceState());
        state.recognition.onaudiostart = () => voiceDebug('onaudiostart', voiceState());
        state.recognition.onsoundstart = () => voiceDebug('onsoundstart', voiceState());
        state.recognition.onspeechstart = () => voiceDebug('onspeechstart', voiceState());
        state.recognition.onspeechend = () => voiceDebug('onspeechend', voiceState());
        state.recognition.onsoundend = () => voiceDebug('onsoundend', voiceState());
        state.recognition.onaudioend = () => voiceDebug('onaudioend', voiceState());
    }
    state.recognition.onresult = (event: any) => {
        if (isFirstStart) gotResultOnFirstStart = true;
        let transcript = ''; for (let i = event.resultIndex; i < event.results.length; i++) transcript += event.results[i][0].transcript;
        voiceDebug('onresult', `resultIndex=${event.resultIndex} results=${event.results.length} raw="${transcript.trim()}" ${voiceState()}`);
        const normalizedTranscript = normalizeCommandText(transcript);
        const cleanTokens = normalizedTranscript.split(/\s+/).filter(t => t.length > 0);
        const aliases = getVoiceCommandAliases();
        const matched = aliases.find(alias => { const normalizedPhrase = normalizeCommandText(alias.phrase); const tokens = normalizedPhrase.split(/\s+/).filter(Boolean); return cleanTokens.length >= tokens.length && cleanTokens.slice(-tokens.length).join(' ') === normalizedPhrase; }) || null;
        reportVoiceCommandRecognition(transcript.trim(), matched?.action || null);
        if (state.config.voiceCommandsEnabled) {
            if (voiceDebugEnabled) { voiceDebug('heard', `"${transcript.trim()}"`); voiceDebug('normalized', `"${normalizedTranscript}"`); voiceDebug('command', matched ? `${matched.action} <= "${matched.phrase}"` : 'none'); }
            if (matched) {
                const commandTokens = normalizeCommandText(matched.phrase).split(/\s+/).filter(Boolean);
                const startIdx = Math.max(0, state.currentIndex - 4), endIdx = Math.min(state.scriptWords.length, state.currentIndex + 10);
                const windowScript = state.scriptWords.slice(startIdx, endIdx).map(w => normalizeCommandText(w.word));
                let conflict = false;
                for (let j = 0; j <= windowScript.length - commandTokens.length; j++) { if (commandTokens.every((token, offset) => windowScript[j + offset] === token)) { conflict = true; break; } }
                voiceDebug('command-check', `armed=${commandArmed} conflict=${conflict}`);
                if (!conflict && commandArmed) { commandArmed = false; console.log(`[VoiceCommand] TRIGGER: ${matched.action} <= "${matched.phrase}"`); runVoiceCommand(matched.action); lastMatchedWord = ''; return; }
                if (conflict) commandArmed = true;
            } else commandArmed = true;
        }
        const spokenWords = transcript.trim().toLowerCase().split(/\s+/); matchWords(spokenWords.slice(-5));
    };
    state.recognition.onerror = (e: any) => {
        console.log('error:', e.error, e.message);
        voiceDebug('onerror', `error=${e.error} message=${e.message || ''} ${voiceState()}`);
        if (e.error === 'no-speech') { isFirstStart = false; voiceDebug('decision', `no-speech -> keep listening; recognition should restart on end; ${voiceState()}`); return; }
        if (isFirstStart && !gotResultOnFirstStart) { isFirstStart = false; state.isListening = false; updateMicUI(false); voiceDebug('state-change', `first-start failure -> MIC OFF; ${voiceState()}`); }
        if (e.error === 'aborted') { speechBlocked = true; const isIPad = navigator.userAgent.includes('iPad') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 2); const isPWA = (window.navigator as any).standalone === true || window.matchMedia('(display-mode: standalone)').matches; if (isIPad && isPWA) els.ipadPwaWarning.classList.remove('hidden'); state.isListening = false; updateMicUI(false); voiceDebug('state-change', `aborted -> speechBlocked=true, MIC OFF; ${voiceState()}`); return; }
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture' || e.error === 'network' || e.error === 'language-not-supported') { state.isListening = false; updateMicUI(false); voiceDebug('state-change', `${e.error} -> MIC OFF; ${voiceState()}`); }
    };
    state.recognition.onend = () => {
        console.log('ended');
        voiceDebug('onend', voiceState());
        if (isFirstStart && !gotResultOnFirstStart) { isFirstStart = false; state.isListening = false; updateMicUI(false); voiceDebug('state-change', `onend before first result -> MIC OFF; ${voiceState()}`); return; }
        isFirstStart = false;
        if (speechBlocked) { voiceDebug('restart-skipped', `speechBlocked=true; ${voiceState()}`); return; }
        if (state.isListening) {
            try {
                recognitionCycle++;
                voiceDebug('restart-requested', voiceState());
                state.recognition.start();
            } catch (error) {
                voiceDebug('restart-failed', `error=${String(error)} ${voiceState()}`);
                console.error('Failed to restart speech recognition:', error);
            }
        } else {
            voiceDebug('restart-skipped', `isListening=false; ${voiceState()}`);
            updateMicUI(false);
        }
    };
}
export function startListening(): void {
    if (!state.recognition) return;
    voiceSessionId++;
    recognitionCycle = 1;
    voiceSessionStartedAt = performance.now();
    state.isListening = true;
    lastMatchedWord = '';
    speechBlocked = false;
    voiceDebug('START requested', voiceState());
    try {
        state.recognition.start();
        updateMicUI(true);
        voiceDebug('MIC UI ON', voiceState());
    } catch (error) {
        voiceDebug('START failed', `error=${String(error)} ${voiceState()}`);
        console.error('Failed to start speech recognition:', error);
        state.isListening = false;
        updateMicUI(false);
    }
}
export function stopListening(): void {
    if (!state.recognition) return;
    voiceDebug('STOP requested', voiceState());
    state.isListening = false;
    lastMatchedWord = '';
    try {
        state.recognition.stop();
        updateMicUI(false);
        voiceDebug('MIC UI OFF', voiceState());
    } catch (error) {
        voiceDebug('STOP failed', `error=${String(error)} ${voiceState()}`);
        console.error('Failed to stop speech recognition:', error);
    }
}
function matchWords(spokenWords: string[]) {
    if (state.currentIndex >= state.scriptWords.length || spokenWords.length === 0) return;
    const LOOKAHEAD = state.config.lookaheadWords;
    const spokenSet = new Set(spokenWords.map(w => w.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()).filter(w => w.length > 0)); if (spokenSet.size === 0) return;
    let scriptPtr = state.currentIndex, validWordsChecked = 0;
    while (scriptPtr < state.scriptWords.length && validWordsChecked < LOOKAHEAD) { const scriptWordObj = state.scriptWords[scriptPtr]; if (scriptWordObj.skip) { scriptPtr++; continue; } if (spokenSet.has(scriptWordObj.clean)) { if (scriptWordObj.clean === lastMatchedWord && validWordsChecked > 0) { scriptPtr++; validWordsChecked++; continue; } lastMatchedWord = scriptWordObj.clean; state.currentIndex = scriptPtr + 1; advancePastSkipped(); updateHighlight(); scrollToCurrent(); return; } scriptPtr++; validWordsChecked++; }
}
