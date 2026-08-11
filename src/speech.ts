import { state } from './state';
import { els } from './elements';
import { updateMicUI, updateHighlight, scrollToCurrent, advancePastSkipped, restartScript, navigateParagraphs } from './render';
import { goCurrentParagraph, goNextCue, goPreviousCue } from './navigation';
import { getVoiceCommandAliases, VoiceCommandAction } from './voice-command-settings';

let lastMatchedWord = '';
let speechBlocked = false;
let commandArmed = true;
let isFirstStart = true;
let gotResultOnFirstStart = false;
const voiceDebugEnabled = new URLSearchParams(window.location.search).get('debug') === 'voice';

function showBrowserWarning() { els.browserWarning.classList.remove('hidden'); }

function runVoiceCommand(action: VoiceCommandAction): void {
    if (action === 'goStart') restartScript();
    else if (action === 'goFinish') {
        state.currentIndex = Math.max(0, state.scriptWords.length - 1);
        updateHighlight();
        scrollToCurrent();
    } else if (action === 'goNext') navigateParagraphs('forward', 1);
    else if (action === 'goBack') navigateParagraphs('back', 1);
    else if (action === 'goCurrent') goCurrentParagraph();
    else if (action === 'cueNext') goNextCue();
    else if (action === 'cueBack') goPreviousCue();
}

export function initSpeech(): void {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { showBrowserWarning(); return; }

    state.recognition = new SpeechRecognition();
    state.recognition.continuous = true;
    state.recognition.interimResults = true;
    state.recognition.lang = state.selectedLanguage;

    state.recognition.onresult = (event: any) => {
        if (isFirstStart) gotResultOnFirstStart = true;
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) transcript += event.results[i][0].transcript;

        if (state.config.voiceCommandsEnabled) {
            const normalizedTranscript = transcript.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
            const cleanTokens = normalizedTranscript.split(/\s+/).filter(t => t.length > 0);
            const aliases = getVoiceCommandAliases();
            const matched = aliases.find(alias => {
                const tokens = alias.phrase.split(/\s+/).filter(Boolean);
                return cleanTokens.length >= tokens.length && cleanTokens.slice(-tokens.length).join(' ') === alias.phrase;
            }) || null;

            if (voiceDebugEnabled) {
                console.log(`[VoiceDebug] Heard: "${transcript.trim()}"`);
                console.log(`[VoiceDebug] Normalized: "${normalizedTranscript}"`);
                console.log(`[VoiceDebug] Command: ${matched ? `${matched.action} <= "${matched.phrase}"` : 'none'}`);
            }

            if (matched) {
                const commandTokens = matched.phrase.split(/\s+/).filter(Boolean);
                const startIdx = Math.max(0, state.currentIndex - 4);
                const endIdx = Math.min(state.scriptWords.length, state.currentIndex + 10);
                const windowScript = state.scriptWords.slice(startIdx, endIdx).map(w => w.word.toLowerCase().replace(/[^\w\s]/g, ''));
                let conflict = false;
                for (let j = 0; j <= windowScript.length - commandTokens.length; j++) {
                    if (commandTokens.every((token, offset) => windowScript[j + offset] === token)) { conflict = true; break; }
                }

                if (voiceDebugEnabled) console.log(`[VoiceDebug] Armed: ${commandArmed}, conflict: ${conflict}`);

                if (!conflict && commandArmed) {
                    commandArmed = false;
                    console.log(`[VoiceCommand] TRIGGER: ${matched.action} <= "${matched.phrase}"`);
                    runVoiceCommand(matched.action);
                    lastMatchedWord = '';
                    return;
                }
                if (conflict) commandArmed = true;
            } else {
                commandArmed = true;
            }
        }

        const spokenWords = transcript.trim().toLowerCase().split(/\s+/);
        matchWords(spokenWords.slice(-5));
    };

    state.recognition.onerror = (e: any) => {
        console.log('error:', e.error, e.message);

        // Silence is normal while using a teleprompter. Some browser SpeechRecognition
        // implementations end the current recognition session with "no-speech" after
        // a period of silence. Keep the VP listening state active; onend will restart
        // recognition automatically. Mark the first start as completed so the generic
        // first-start failure guard below does not turn listening off.
        if (e.error === 'no-speech') {
            isFirstStart = false;
            if (voiceDebugEnabled) console.log('[VoiceDebug] no-speech: keeping listening active; recognition will restart on end');
            return;
        }

        if (isFirstStart && !gotResultOnFirstStart) { isFirstStart = false; state.isListening = false; updateMicUI(false); }
        if (e.error === 'aborted') {
            speechBlocked = true;
            const isIPad = navigator.userAgent.includes('iPad') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 2);
            const isPWA = (window.navigator as any).standalone === true || window.matchMedia('(display-mode: standalone)').matches;
            if (isIPad && isPWA) els.ipadPwaWarning.classList.remove('hidden');
            state.isListening = false; updateMicUI(false); return;
        }
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture' || e.error === 'network' || e.error === 'language-not-supported') {
            state.isListening = false; updateMicUI(false);
        }
    };

    state.recognition.onend = () => {
        console.log('ended');
        if (isFirstStart && !gotResultOnFirstStart) { isFirstStart = false; state.isListening = false; updateMicUI(false); return; }
        isFirstStart = false;
        if (speechBlocked) return;
        if (state.isListening) {
            try { state.recognition.start(); } catch (error) { console.error('Failed to restart speech recognition:', error); }
        } else updateMicUI(false);
    };
}

export function startListening(): void {
    if (!state.recognition) return;
    state.isListening = true; lastMatchedWord = ''; speechBlocked = false;
    try { state.recognition.start(); updateMicUI(true); }
    catch (error) { console.error('Failed to start speech recognition:', error); state.isListening = false; updateMicUI(false); }
}

export function stopListening(): void {
    if (!state.recognition) return;
    state.isListening = false; lastMatchedWord = '';
    try { state.recognition.stop(); updateMicUI(false); }
    catch (error) { console.error('Failed to stop speech recognition:', error); }
}

function matchWords(spokenWords: string[]) {
    if (state.currentIndex >= state.scriptWords.length || spokenWords.length === 0) return;
    const LOOKAHEAD = state.config.lookaheadWords;
    const spokenSet = new Set(spokenWords.map(w => w.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()).filter(w => w.length > 0));
    if (spokenSet.size === 0) return;
    let scriptPtr = state.currentIndex;
    let validWordsChecked = 0;
    while (scriptPtr < state.scriptWords.length && validWordsChecked < LOOKAHEAD) {
        const scriptWordObj = state.scriptWords[scriptPtr];
        if (scriptWordObj.skip) { scriptPtr++; continue; }
        if (spokenSet.has(scriptWordObj.clean)) {
            if (scriptWordObj.clean === lastMatchedWord && validWordsChecked > 0) { scriptPtr++; validWordsChecked++; continue; }
            lastMatchedWord = scriptWordObj.clean;
            state.currentIndex = scriptPtr + 1;
            advancePastSkipped(); updateHighlight(); scrollToCurrent(); return;
        }
        scriptPtr++; validWordsChecked++;
    }
}
