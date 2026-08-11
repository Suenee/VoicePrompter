import { state } from './state';
import { els } from './elements';
import { updateMicUI, updateHighlight, scrollToCurrent, advancePastSkipped, restartScript, navigateParagraphs } from './render';

// Track the last matched word to prevent matching the same word twice in a row
let lastMatchedWord = '';

let speechBlocked = false;
let commandArmed = true;

// Track the first recognition attempt for diagnostics only. A first-run runtime
// failure must never be confused with a browser that lacks SpeechRecognition.
let isFirstStart = true;
let gotResultOnFirstStart = false;

function showBrowserWarning() {
    els.browserWarning.classList.remove('hidden');
}

export function initSpeech(): void {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    // This warning is reserved strictly for browsers where the API does not exist.
    if (!SpeechRecognition) {
        showBrowserWarning();
        return;
    }

    state.recognition = new SpeechRecognition();
    state.recognition.continuous = true;
    state.recognition.interimResults = true;
    state.recognition.lang = state.selectedLanguage;

    state.recognition.onresult = (event: any) => {
        if (isFirstStart) {
            gotResultOnFirstStart = true;
        }

        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            transcript += event.results[i][0].transcript;
        }

        // --- Voice Commands (Mac-Style) ---
        if (state.config.voiceCommandsEnabled) {
            const cleanTokens = transcript.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(t => t.length > 0);
            if (cleanTokens.length >= 2) {
                const lastTwoWords = cleanTokens.slice(-2).join(' ');
                let commandMatched: string | null = null;

                if (lastTwoWords === 'go start') commandMatched = 'go start';
                else if (lastTwoWords === 'go finish') commandMatched = 'go finish';
                else if (lastTwoWords === 'go next') commandMatched = 'go next';
                else if (lastTwoWords === 'go back') commandMatched = 'go back';

                if (commandMatched) {
                    const commandTokens = commandMatched.split(' ');
                    const startIdx = Math.max(0, state.currentIndex - 4);
                    const endIdx = Math.min(state.scriptWords.length, state.currentIndex + 10);
                    const windowScript = state.scriptWords.slice(startIdx, endIdx).map(w => w.word.toLowerCase().replace(/[^\w\s]/g, ''));

                    let conflict = false;
                    for (let j = 0; j < Math.max(0, windowScript.length - 1); j++) {
                        if (windowScript[j] === commandTokens[0] && windowScript[j + 1] === commandTokens[1]) {
                            conflict = true;
                            break;
                        }
                    }

                    if (!conflict) {
                        if (commandArmed) {
                            commandArmed = false;
                            console.log(`[VoiceCommand] TRIGGER: ${commandMatched}`);
                            if (commandMatched === 'go start') {
                                restartScript();
                            } else if (commandMatched === 'go finish') {
                                state.currentIndex = Math.max(0, state.scriptWords.length - 1);
                                updateHighlight();
                                scrollToCurrent();
                            } else if (commandMatched === 'go next') {
                                navigateParagraphs('forward', 1);
                            } else if (commandMatched === 'go back') {
                                navigateParagraphs('back', 1);
                            }
                            lastMatchedWord = '';
                            return;
                        }
                    } else {
                        commandArmed = true;
                    }
                } else {
                    commandArmed = true;
                }
            } else {
                commandArmed = true;
            }
        }

        const spokenWords = transcript.trim().toLowerCase().split(/\s+/);
        matchWords(spokenWords.slice(-5));
    };

    state.recognition.onerror = (e: any) => {
        console.log('error:', e.error, e.message);

        // Runtime recognition errors prove that the API exists. Never show the
        // "browser unsupported" dialog for them. Stop the current attempt cleanly.
        if (isFirstStart && !gotResultOnFirstStart) {
            isFirstStart = false;
            state.isListening = false;
            updateMicUI(false);
        }

        if (e.error === 'aborted') {
            speechBlocked = true;

            const isIPad = navigator.userAgent.includes('iPad') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 2);
            const isPWA = (window.navigator as any).standalone === true || window.matchMedia('(display-mode: standalone)').matches;

            if (isIPad && isPWA) {
                els.ipadPwaWarning.classList.remove('hidden');
            }

            state.isListening = false;
            updateMicUI(false);
            return;
        }

        // Permission, missing microphone, network/service and no-speech errors are
        // operational failures, not lack of browser support. Leave diagnostics in
        // the console and return the mic UI to idle without a misleading modal.
        if (
            e.error === 'not-allowed' ||
            e.error === 'service-not-allowed' ||
            e.error === 'audio-capture' ||
            e.error === 'network' ||
            e.error === 'no-speech' ||
            e.error === 'language-not-supported'
        ) {
            state.isListening = false;
            updateMicUI(false);
        }
    };

    state.recognition.onend = () => {
        console.log('ended');

        // Ending without a result can happen for many runtime reasons and is not
        // evidence that SpeechRecognition is unsupported.
        if (isFirstStart && !gotResultOnFirstStart) {
            isFirstStart = false;
            state.isListening = false;
            updateMicUI(false);
            return;
        }
        isFirstStart = false;

        if (speechBlocked) return;
        if (state.isListening) {
            try {
                state.recognition.start();
            } catch (error) {
                console.error('Failed to restart speech recognition:', error);
            }
        } else {
            updateMicUI(false);
        }
    };
}

export function startListening(): void {
    if (!state.recognition) return;
    state.isListening = true;
    lastMatchedWord = '';

    speechBlocked = false;
    try {
        state.recognition.start();
        updateMicUI(true);
    } catch (error) {
        console.error('Failed to start speech recognition:', error);
        state.isListening = false;
        updateMicUI(false);
    }
}

export function stopListening(): void {
    if (!state.recognition) return;
    state.isListening = false;
    lastMatchedWord = '';

    try {
        state.recognition.stop();
        updateMicUI(false);
    } catch (error) {
        console.error('Failed to stop speech recognition:', error);
    }
}

function matchWords(spokenWords: string[]) {
    if (state.currentIndex >= state.scriptWords.length) return;
    if (spokenWords.length === 0) return;

    const LOOKAHEAD = state.config.lookaheadWords;

    const spokenSet = new Set(
        spokenWords
            .map(w => w.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase())
            .filter(w => w.length > 0)
    );

    if (spokenSet.size === 0) return;

    let scriptPtr = state.currentIndex;
    let validWordsChecked = 0;

    while (scriptPtr < state.scriptWords.length && validWordsChecked < LOOKAHEAD) {
        const scriptWordObj = state.scriptWords[scriptPtr];

        if (scriptWordObj.skip) {
            scriptPtr++;
            continue;
        }

        if (spokenSet.has(scriptWordObj.clean)) {
            if (scriptWordObj.clean === lastMatchedWord && validWordsChecked > 0) {
                scriptPtr++;
                validWordsChecked++;
                continue;
            }

            lastMatchedWord = scriptWordObj.clean;
            state.currentIndex = scriptPtr + 1;
            advancePastSkipped();
            updateHighlight();
            scrollToCurrent();
            return;
        }

        scriptPtr++;
        validWordsChecked++;
    }
}
