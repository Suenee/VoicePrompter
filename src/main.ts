import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { initElements, els } from './elements';
import { state } from './state';
import './remote-control';
import { renderScript, updateHighlight, scrollToCurrent, applySettings, renderHistoryList, restartScript } from './render';
import { initSpeech, startListening, stopListening } from './speech';
import { autoScrollManager } from './autoscroll';
import { saveToHistory, getHistory, clearAllHistory, loadSetting, saveSetting } from './storage';
import { ScriptWord, ScrollingMode } from './types';
import { enterVideoMode, exitVideoMode, toggleVideoLayout, startRecording, stopRecording, flipCamera, getMediaConstraints } from './video';
import { detectAll } from 'tinyld/light';
import { fetchGoogleDocText } from './gdoc';
import { enumerateAndPopulateDevices } from './devices';
import { detectVisitorPlatform, getNativePromo } from './platform-promo';

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

interface LangItem { id: string; name: string }

const AUTO_LANGS: LangItem[] = [
    { id: 'en-US', name: 'English' },
    { id: 'es-ES', name: 'Spanish' },
    { id: 'fr-FR', name: 'French' },
    { id: 'de-DE', name: 'German' },
    { id: 'it-IT', name: 'Italian' },
    { id: 'pt-PT', name: 'Portuguese' },
    { id: 'ru-RU', name: 'Russian' },
    { id: 'ja-JP', name: 'Japanese' },
    { id: 'zh-CN', name: 'Chinese' },
    { id: 'ko-KR', name: 'Korean' },
    { id: 'ar-SA', name: 'Arabic' },
    { id: 'nl-NL', name: 'Dutch' },
    { id: 'pl-PL', name: 'Polish' },
    { id: 'uk-UA', name: 'Ukrainian' },
    { id: 'hi-IN', name: 'Hindi' },
    { id: 'tr-TR', name: 'Turkish' },
    { id: 'sv-SE', name: 'Swedish' },
    { id: 'da-DK', name: 'Danish' },
    { id: 'fi-FI', name: 'Finnish' },
    { id: 'no-NO', name: 'Norwegian' }
].sort((a, b) => a.name.localeCompare(b.name));

const MANUAL_LANGS: LangItem[] = [
    { id: 'id-ID', name: 'Indonesian' },
    { id: 'ms-MY', name: 'Malay' },
    { id: 'ca-ES', name: 'Catalan' },
    { id: 'cs-CZ', name: 'Czech' },
    { id: 'el-GR', name: 'Greek' },
    { id: 'he-IL', name: 'Hebrew' },
    { id: 'hu-HU', name: 'Hungarian' },
    { id: 'ro-RO', name: 'Romanian' },
    { id: 'sk-SK', name: 'Slovak' },
    { id: 'th-TH', name: 'Thai' },
    { id: 'vi-VN', name: 'Vietnamese' },
    { id: 'bg-BG', name: 'Bulgarian' },
    { id: 'hr-HR', name: 'Croatian' },
    { id: 'sr-RS', name: 'Serbian' },
].sort((a, b) => a.name.localeCompare(b.name));

const LANG_MAP: Record<string, string> = {
    'en': 'en-US', 'es': 'es-ES', 'fr': 'fr-FR', 'de': 'de-DE',
    'it': 'it-IT', 'pt': 'pt-PT', 'ru': 'ru-RU', 'ja': 'ja-JP',
    'zh': 'zh-CN', 'ko': 'ko-KR', 'ar': 'ar-SA', 'nl': 'nl-NL',
    'pl': 'pl-PL', 'uk': 'uk-UA', 'hi': 'hi-IN', 'tr': 'tr-TR',
    'sv': 'sv-SE', 'da': 'da-DK', 'fi': 'fi-FI', 'no': 'no-NO'
};

function renderLanguageDropdowns() {
    [els.languageSelectContainer, els.languageSelectSettingsContainer].forEach(container => {
        container.innerHTML = `
            <button class="w-full flex items-center justify-between text-left bg-neutral-800 border border-neutral-700 rounded px-3 h-[38px] text-sm text-neutral-300 focus:ring-2 focus:ring-[#FFBB00] focus:border-transparent outline-none transition-colors hover:bg-neutral-700 min-w-[200px]" data-dropdown-toggle>
                <div class="flex flex-col flex-1 truncate">
                    <span class="font-medium dropdown-title">Auto-detect</span>
                    <span class="text-[10px] text-neutral-400 dropdown-subtitle truncate h-3 mt-0.5" style="display: none;"></span>
                </div>
                <svg class="w-4 h-4 ml-2 flex-shrink-0 text-neutral-400 transition-transform duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            <div class="absolute z-50 w-full mt-1 bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl opacity-0 scale-95 pointer-events-none transition-all duration-200 origin-top dropdown-menu overflow-hidden flex flex-col max-h-[60vh] sm:max-h-[300px]">
                <div class="overflow-y-auto no-scrollbar py-2">
                    <button class="w-full text-left px-3 py-2 hover:bg-neutral-800 transition-colors flex flex-col lang-option" data-value="auto">
                        <div class="flex items-center justify-between w-full">
                            <span class="font-medium text-white">Automatic</span>
                            <span class="text-[10px] text-neutral-500 auto-detected-label ml-2 truncate"></span>
                        </div>
                    </button>
                    
                    <div class="px-3 py-1 mt-1 flex items-center justify-between">
                        <span class="text-[10px] uppercase font-bold text-neutral-500 tracking-wider">With Auto-Detection</span>
                    </div>
                    
                    ${AUTO_LANGS.map(lang => `
                        <button class="w-full text-left px-3 py-1.5 hover:bg-neutral-800 transition-colors flex items-center justify-between lang-option" data-value="${lang.id}">
                            <span class="text-sm text-neutral-300">${lang.name}</span>
                            <span class="text-[9px] font-bold bg-[#FFBB00]/10 text-[#FFBB00] px-1.5 py-0.5 rounded-full tracking-wider">AUTO</span>
                        </button>
                    `).join('')}

                    <div class="px-3 py-1 mt-2 flex items-center justify-between border-t border-neutral-800 pt-2">
                        <span class="text-[10px] uppercase font-bold text-neutral-500 tracking-wider">Manual Selection</span>
                    </div>

                    ${MANUAL_LANGS.map(lang => `
                        <button class="w-full text-left px-3 py-1.5 hover:bg-neutral-800 transition-colors flex items-center justify-between lang-option" data-value="${lang.id}">
                            <span class="text-sm text-neutral-300">${lang.name}</span>
                        </button>
                    `).join('')}
                </div>
            </div>
        `;

        const toggle = container.querySelector('[data-dropdown-toggle]') as HTMLButtonElement;
        const menu = container.querySelector('.dropdown-menu') as HTMLDivElement;
        const svg = toggle.querySelector('svg') as SVGElement;

        toggle.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const isOpen = !menu.classList.contains('opacity-0');

            document.querySelectorAll('.dropdown-menu').forEach(m => {
                m.classList.add('opacity-0', 'scale-95', 'pointer-events-none');
                const btn = m.previousElementSibling as HTMLButtonElement;
                if (btn) btn.querySelector('svg')?.classList.remove('rotate-180');
            });

            if (!isOpen) {
                menu.classList.remove('opacity-0', 'scale-95', 'pointer-events-none');
                svg.classList.add('rotate-180');
                const rect = menu.getBoundingClientRect();
                if (rect.bottom > window.innerHeight) {
                    menu.style.bottom = '100%';
                    menu.style.top = 'auto';
                    menu.style.marginBottom = '0.5rem';
                } else {
                    menu.style.bottom = 'auto';
                    menu.style.top = '100%';
                    menu.style.marginBottom = '0';
                }
            }
        });

        const options = menu.querySelectorAll('.lang-option');
        options.forEach(opt => {
            opt.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const val = (opt as HTMLButtonElement).dataset.value!;
                handleLanguageChange(val);
                menu.classList.add('opacity-0', 'scale-95', 'pointer-events-none');
                svg.classList.remove('rotate-180');
            });
        });
    });

    window.addEventListener('click', () => {
        document.querySelectorAll('.dropdown-menu').forEach(menu => {
            menu.classList.add('opacity-0', 'scale-95', 'pointer-events-none');
            const btn = menu.previousElementSibling as HTMLButtonElement;
            if (btn) btn.querySelector('svg')?.classList.remove('rotate-180');
        });
    });
}

function updateAutoDetectText(detectedVal: string | null) {
    let detectedName = '';
    const allLangs = [...AUTO_LANGS, ...MANUAL_LANGS];
    if (detectedVal) {
        const found = allLangs.find(l => l.id === detectedVal);
        detectedName = found ? found.name : detectedVal;
    }
    [els.languageSelectContainer, els.languageSelectSettingsContainer].forEach(container => {
        const toggleTitle = container.querySelector('.dropdown-title') as HTMLElement;
        const toggleSub = container.querySelector('.dropdown-subtitle') as HTMLElement;
        const autoOptLabel = container.querySelector('.auto-detected-label') as HTMLElement;
        if (!toggleTitle) return;
        if (toggleSub) toggleSub.style.display = 'none';
        if (state.languageSetting === 'auto') {
            if (detectedName) {
                toggleTitle.textContent = `Automatic (${detectedName})`;
                if (autoOptLabel) autoOptLabel.textContent = `${detectedName} detected`;
            } else {
                toggleTitle.textContent = 'Auto-detect';
                if (autoOptLabel) autoOptLabel.textContent = '';
            }
            toggleTitle.classList.add('text-white');
            toggleTitle.classList.remove('text-neutral-300');
        } else {
            const found = allLangs.find(l => l.id === state.languageSetting);
            toggleTitle.textContent = found ? found.name : state.languageSetting;
            toggleTitle.classList.remove('text-white');
            toggleTitle.classList.add('text-neutral-300');
            if (autoOptLabel) autoOptLabel.textContent = detectedName ? `${detectedName} detected` : '';
        }
    });
}

registerSW({ immediate: true });
initElements();
state.languageSetting = loadSetting('dictationLanguage', state.languageSetting);
if (state.languageSetting !== 'auto') state.selectedLanguage = state.languageSetting;
state.config.voiceCommandsEnabled = loadSetting('voiceCommandsEnabled', state.config.voiceCommandsEnabled);
state.config.showStopIcon = loadSetting('showStopIcon', state.config.showStopIcon);
initSpeech();
renderLanguageDropdowns();

let langWarningTimer: ReturnType<typeof setTimeout> | null = null;
function showLangDetectionWarning() {
    const toast = els.langDetectionWarning;
    toast.classList.remove('hidden');
    if (langWarningTimer) clearTimeout(langWarningTimer);
    langWarningTimer = setTimeout(() => toast.classList.add('hidden'), 6000);
}

function loadScript(text: string, googleDocUrl: string | null = null): void {
    if (!text) return;
    const scriptText = text.trim();
    if (!scriptText) return;
    state.googleDocUrl = googleDocUrl;
    saveToHistory(scriptText, googleDocUrl);
    let targetLang = state.languageSetting;
    if (targetLang === 'auto') {
        const results = detectAll(scriptText);
        const top = results[0];
        const confidence = top?.accuracy ?? 0;
        const detection = top?.lang ?? '';
        let mappedLang = LANG_MAP[detection] || 'en-US';
        state.detectedLanguage = mappedLang;
        targetLang = mappedLang;
        updateAutoDetectText(mappedLang);
        if (confidence < 0.5) showLangDetectionWarning();
    } else {
        state.detectedLanguage = null;
        updateAutoDetectText(null);
    }
    state.selectedLanguage = targetLang;
    if (state.recognition) state.recognition.lang = targetLang;
    let processedText = scriptText;
    if (state.config.preserveFormatting) processedText = processedText.replace(/\n/g, ' ||BR|| ');
    else processedText = processedText.replace(/\n+/g, ' ||LB|| ');
    const rawWords = processedText.split(/\s+/);
    let inBracket = false;
    state.scriptWords = rawWords.map(word => {
        if (word === '||LB||') return { word: '🛑', clean: '', element: null, skip: true, isStop: true } as ScriptWord;
        if (word === '||BR||') return { word: '', clean: '', element: null, skip: true, isBreak: true, isStop: false } as ScriptWord;
        if (word.includes('[')) inBracket = true;
        const shouldSkip = inBracket || /[\u{1F300}-\u{1F9FF}]/u.test(word);
        if (word.includes(']')) inBracket = false;
        const cleanWord = word.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
        return { word, clean: cleanWord, element: null, skip: shouldSkip, isStop: false } as ScriptWord;
    });
    renderScript();
    applySettings();
    lockBodyScroll();
}

function resetApp(): void {
    stopListening();
    autoScrollManager.stop();
    isAutoScrollStarting = false;
    unlockBodyScroll();
    els.prompterContainer.classList.add('hidden');
    els.setupScreen.classList.remove('hidden');
    renderHistoryList(getHistory(), loadScript);
}

let bodyScrollLocked = false;
function lockBodyScroll(): void {
    if (bodyScrollLocked) return;
    bodyScrollLocked = true;
    const b = document.body, h = document.documentElement;
    h.style.overflow = 'hidden';
    b.style.position = 'fixed'; b.style.top = '0'; b.style.left = '0'; b.style.right = '0'; b.style.bottom = '0'; b.style.width = '100%'; b.style.height = '100%'; b.style.overflow = 'hidden'; b.style.overscrollBehavior = 'none';
    window.scrollTo(0, 0);
}
function unlockBodyScroll(): void {
    if (!bodyScrollLocked) return;
    bodyScrollLocked = false;
    const b = document.body, h = document.documentElement;
    h.style.overflow = ''; b.style.position = ''; b.style.top = ''; b.style.left = ''; b.style.right = ''; b.style.bottom = ''; b.style.width = ''; b.style.height = ''; b.style.overflow = ''; b.style.overscrollBehavior = '';
    window.scrollTo(0, 0);
}
function keepScrollZeroWhileLocked(): void { if (bodyScrollLocked && Math.round(window.scrollY) !== 0) window.scrollTo(0, 0); }
if (window.visualViewport) { window.visualViewport.addEventListener('resize', keepScrollZeroWhileLocked); window.visualViewport.addEventListener('scroll', keepScrollZeroWhileLocked); }
window.addEventListener('orientationchange', () => setTimeout(keepScrollZeroWhileLocked, 60));

function clearHistory(): void { if (confirm('Clear all recent scripts?')) { clearAllHistory(); renderHistoryList(getHistory(), loadScript); } }

els.loadScriptBtn.addEventListener('click', () => { (window as any).umami?.track('start-teleprompter'); loadScript(els.inputScript.value); });
els.clearScriptBtn.addEventListener('click', () => { (window as any).umami?.track('clear-script'); els.inputScript.value = ''; els.inputScript.focus(); });
els.copyScriptBtn.addEventListener('click', async () => { const text = els.inputScript.value; if (!text) return; (window as any).umami?.track('copy-script'); try { await navigator.clipboard.writeText(text); const originalText = els.copyScriptBtn.textContent; els.copyScriptBtn.textContent = 'Copied!'; setTimeout(() => els.copyScriptBtn.textContent = originalText, 1500); } catch {} });
els.pasteScriptBtn.addEventListener('click', async () => { (window as any).umami?.track('paste-script'); try { const text = await navigator.clipboard.readText(); els.inputScript.value = text; els.inputScript.focus(); } catch (err) { console.error('Failed to paste!', err); } });

els.importGoogleDocBtn.addEventListener('click', () => { (window as any).umami?.track('open-google-doc-modal'); els.googleDocUrlInput.value = ''; els.googleDocModal.classList.remove('hidden'); els.googleDocUrlInput.focus(); });
els.closeGoogleDocModalBtn.addEventListener('click', () => els.googleDocModal.classList.add('hidden'));
els.pasteGoogleDocUrlBtn.addEventListener('click', async () => { (window as any).umami?.track('paste-google-doc-url'); try { const text = await navigator.clipboard.readText(); els.googleDocUrlInput.value = text.trim(); els.googleDocUrlInput.focus(); } catch (err) { console.error('Failed to paste Google Doc URL!', err); } });
els.confirmGoogleDocImportBtn.addEventListener('click', async () => { const url = els.googleDocUrlInput.value.trim(); if (!url) { alert('Please enter a Google Doc URL.'); return; } const btn = els.confirmGoogleDocImportBtn as HTMLButtonElement; const originalText = btn.textContent; btn.disabled = true; btn.textContent = 'Importing...'; try { const text = await fetchGoogleDocText(url); (window as any).umami?.track('import-google-doc-success'); els.inputScript.value = text; els.googleDocModal.classList.add('hidden'); loadScript(text, url); } catch (err: any) { (window as any).umami?.track('import-google-doc-error', { error: err.message }); alert(err.message || 'Failed to import document.'); } finally { btn.disabled = false; btn.textContent = originalText; } });
els.refreshGoogleDocBtn.addEventListener('click', async () => { const url = state.googleDocUrl; if (!url) return; (window as any).umami?.track('refresh-google-doc-click'); const btn = els.refreshGoogleDocBtn as HTMLButtonElement; const originalText = btn.innerHTML; btn.disabled = true; btn.textContent = 'Syncing...'; try { const text = await fetchGoogleDocText(url); (window as any).umami?.track('refresh-google-doc-success'); els.inputScript.value = text; const prevIndex = state.currentIndex; loadScript(text, url); if (prevIndex < state.scriptWords.length) { state.currentIndex = prevIndex; updateHighlight(); scrollToCurrent(); } btn.textContent = 'Synced!'; setTimeout(() => { btn.disabled = false; btn.innerHTML = originalText; }, 1500); } catch (err: any) { (window as any).umami?.track('refresh-google-doc-error', { error: err.message }); alert(err.message || 'Failed to refresh document.'); btn.disabled = false; btn.innerHTML = originalText; } });
els.copyGoogleDocUrlBtn.addEventListener('click', async () => { const url = state.googleDocUrl; if (!url) return; (window as any).umami?.track('copy-google-doc-url-click'); try { await navigator.clipboard.writeText(url); const originalHTML = els.copyGoogleDocUrlBtn.innerHTML; els.copyGoogleDocUrlBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>`; alert('Google Doc link copied to clipboard!'); els.copyGoogleDocUrlBtn.innerHTML = originalHTML; } catch (err) { console.error('Failed to copy Google Doc link:', err); alert('Failed to copy link. Please manually copy it from the browser address bar.'); } });

let isAutoScrollStarting = false;
els.micButton.addEventListener('click', async () => {
    if (isAutoScrollStarting) { autoScrollManager.stop(); isAutoScrollStarting = false; return; }
    if (state.isListening) {
        if (state.config.scrollingMode === 'voice') { (window as any).umami?.track('mic-stop'); stopListening(); }
        else { autoScrollManager.stop(); state.isListening = false; import('./render').then(({ updateMicUI }) => updateMicUI(false)); }
        const dock = document.getElementById('mainControlsDock'); if (dock) dock.style.opacity = '';
    } else {
        if (state.config.scrollingMode === 'voice') { (window as any).umami?.track('mic-start'); startListening(); }
        else { isAutoScrollStarting = true; const started = await autoScrollManager.start(); isAutoScrollStarting = false; if (!started) { if (state.config.scrollingMode === 'sound') alert('Sound Scrolling needs microphone access. Please allow microphone permission and try again.'); return; } state.isListening = true; const { updateMicUI } = await import('./render'); updateMicUI(true); }
        const dock = document.getElementById('mainControlsDock'); if (dock) dock.style.opacity = (state.config.dockOpacity / 100).toString();
    }
});

els.resetAppBtn.addEventListener('click', resetApp);
els.restartScriptBtn.addEventListener('click', restartScript);

const visitorPlatform = detectVisitorPlatform();
const nativePromo = getNativePromo(visitorPlatform);
els.nativePromoTitle.textContent = nativePromo.title;
let promoTimeout: number | null = null;
let currentPromoPairIndex = 0;
let currentPromoPairStatic = '';
let currentPromoWord = '';
function startPromoAnimation() {
    if (promoTimeout) { window.clearTimeout(promoTimeout); promoTimeout = null; }
    const subtitleEl = els.nativePromoSubtitle;
    const pair = nativePromo.pairs[currentPromoPairIndex]; currentPromoPairIndex = (currentPromoPairIndex + 1) % nativePromo.pairs.length; currentPromoPairStatic = pair.line1;
    if (pair.rotating.length === 0) { currentPromoWord = ''; subtitleEl.innerHTML = `<div>${pair.line1}</div><div>${pair.line2}</div>`; return; }
    let currentIndex = 0; currentPromoWord = pair.rotating[currentIndex];
    subtitleEl.innerHTML = `<div>${pair.line1}</div><div class="flex items-center">${pair.line2}<span class="promo-rotating-word inline-block transition-all duration-500 opacity-100 translate-y-0 text-[#FFBB00] font-medium whitespace-nowrap ml-1">${pair.rotating[currentIndex]}</span></div>`;
    const rotatingEl = subtitleEl.querySelector('.promo-rotating-word') as HTMLElement;
    function animateNextWord() { promoTimeout = window.setTimeout(() => { if (!document.body.contains(rotatingEl)) return; rotatingEl.classList.remove('opacity-100', 'translate-y-0'); rotatingEl.classList.add('opacity-0', '-translate-y-2'); promoTimeout = window.setTimeout(() => { if (!document.body.contains(rotatingEl)) return; currentIndex = (currentIndex + 1) % pair.rotating.length; currentPromoWord = pair.rotating[currentIndex]; rotatingEl.textContent = pair.rotating[currentIndex]; rotatingEl.classList.remove('-translate-y-2', 'transition-all', 'duration-500'); rotatingEl.classList.add('translate-y-2'); void rotatingEl.offsetWidth; rotatingEl.classList.add('transition-all', 'duration-500'); rotatingEl.classList.remove('opacity-0', 'translate-y-2'); rotatingEl.classList.add('opacity-100', 'translate-y-0'); animateNextWord(); }, 500); }, 1500); }
    animateNextWord();
}
function stopPromoAnimation() { if (promoTimeout) { window.clearTimeout(promoTimeout); promoTimeout = null; } }
els.toggleSettingsBtn.addEventListener('click', () => { (window as any).umami?.track('settings-toggle'); const isHidden = els.settingsPanel.classList.toggle('hidden'); if (!isHidden) { startPromoAnimation(); if (!isIOS) enumerateAndPopulateDevices(false); } else stopPromoAnimation(); });
els.closeSettingsBtn.addEventListener('click', () => { els.settingsPanel.classList.add('hidden'); stopPromoAnimation(); });
els.settingsNativeAppBanner.addEventListener('click', () => { const promoData = currentPromoWord ? `${currentPromoPairStatic} - ${currentPromoWord}` : currentPromoPairStatic; (window as any).umami?.track(nativePromo.analyticsEvent, { destination: nativePromo.href, sourcePlatform: visitorPlatform, variant: promoData }); window.location.href = nativePromo.href; });

els.fontSizeInput.addEventListener('input', (e) => { const val = parseInt((e.target as HTMLInputElement).value); state.config.fontSize = val; els.fontSizeVal.textContent = `${val}px`; els.scriptContent.style.fontSize = `${val}px`; });
els.lineHeightInput.addEventListener('input', (e) => { const val = parseFloat((e.target as HTMLInputElement).value); state.config.lineHeight = val; els.lineHeightVal.textContent = `${val}x`; els.scriptContent.style.lineHeight = `${val}`; });
els.paragraphSpacingInput.addEventListener('input', (e) => { const val = parseFloat((e.target as HTMLInputElement).value); state.config.paragraphSpacing = val; els.paragraphSpacingVal.textContent = `${val}em`; applySettings(); });
els.marginInput.addEventListener('input', (e) => { const val = parseInt((e.target as HTMLInputElement).value); state.config.margin = val; els.marginVal.textContent = `${val}%`; els.scriptContent.style.paddingLeft = `${val}%`; els.scriptContent.style.paddingRight = `${val}%`; });
els.dockOpacityInput.addEventListener('input', (e) => { const val = parseInt((e.target as HTMLInputElement).value); state.config.dockOpacity = val; els.dockOpacityVal.textContent = `${val}%`; if (state.isListening || state.isRecording) { const dock = document.getElementById('mainControlsDock'); if (dock) dock.style.opacity = (val / 100).toString(); } });
els.activeLinePositionInput.addEventListener('input', (e) => { const val = parseInt((e.target as HTMLInputElement).value); state.config.activeLinePosition = val; els.activeLinePositionVal.textContent = `${val}%`; scrollToCurrent(); });
els.lookaheadWordsInput.addEventListener('input', (e) => { const val = parseInt((e.target as HTMLInputElement).value); state.config.lookaheadWords = val; els.lookaheadWordsVal.textContent = `${val}`; });
els.textColorInput.addEventListener('input', (e) => { state.config.textColor = (e.target as HTMLInputElement).value; applySettings(); });
els.bgColorInput.addEventListener('input', (e) => { state.config.bgColor = (e.target as HTMLInputElement).value; applySettings(); });
(['left', 'center', 'right'] as const).forEach(align => els.alignBtns[align].addEventListener('click', () => { state.config.textAlign = align; els.scriptContent.style.textAlign = align; updateAlignmentButtons(); }));
(['ltr', 'rtl'] as const).forEach(dir => els.dirBtns[dir].addEventListener('click', () => { state.config.textDirection = dir as 'ltr' | 'rtl'; applySettings(); updateDirectionButtons(); }));
els.themeDarkBtn.addEventListener('click', () => { state.config.bgColor = '#000000'; state.config.textColor = '#ffffff'; els.bgColorInput.value = '#000000'; els.textColorInput.value = '#ffffff'; applySettings(); });
els.themeLightBtn.addEventListener('click', () => { state.config.bgColor = '#ffffff'; state.config.textColor = '#000000'; els.bgColorInput.value = '#ffffff'; els.textColorInput.value = '#000000'; applySettings(); });
els.mirrorToggle.addEventListener('change', (e) => { state.isMirrored = (e.target as HTMLInputElement).checked; els.scrollContainer.classList.toggle('mirror-mode', state.isMirrored); });
els.hMirrorToggle.addEventListener('change', (e) => { state.isMirroredH = (e.target as HTMLInputElement).checked; els.scrollContainer.classList.toggle('mirror-mode-h', state.isMirroredH); });
els.stopSignToggle.addEventListener('change', (e) => { const enabled = (e.target as HTMLInputElement).checked; state.config.showStopIcon = enabled; saveSetting('showStopIcon', enabled); els.scriptContent.classList.toggle('show-stops', enabled); });
function handleLanguageChange(lang: string) { (window as any).umami?.track('language-select', { language: lang }); state.languageSetting = lang; saveSetting('dictationLanguage', lang); if (lang === 'auto') { if (els.inputScript.value.trim()) { const results = detectAll(els.inputScript.value.trim()); const top = results[0]; const confidence = top?.accuracy ?? 0; const detection = top?.lang ?? ''; const mappedLang = LANG_MAP[detection] || 'en-US'; state.detectedLanguage = mappedLang; state.selectedLanguage = mappedLang; updateAutoDetectText(mappedLang); if (confidence < 0.5) showLangDetectionWarning(); } else { state.selectedLanguage = 'en-US'; updateAutoDetectText(null); } } else { state.selectedLanguage = lang; state.detectedLanguage = null; updateAutoDetectText(null); } if (state.recognition) state.recognition.lang = state.selectedLanguage; }
els.preserveFormattingToggle.addEventListener('change', (e) => { state.config.preserveFormatting = (e.target as HTMLInputElement).checked; const text = els.inputScript.value.trim(); if (text) { const currentIndex = state.currentIndex; loadScript(text); if (currentIndex < state.scriptWords.length) { state.currentIndex = currentIndex; updateHighlight(); scrollToCurrent(); } } });
els.voiceCommandToggle.addEventListener('change', (e) => { const enabled = (e.target as HTMLInputElement).checked; state.config.voiceCommandsEnabled = enabled; saveSetting('voiceCommandsEnabled', enabled); });
els.screenRotationToggle.addEventListener('change', (e) => { state.isScreenRotated = (e.target as HTMLInputElement).checked; document.body.classList.toggle('screen-rotated', state.isScreenRotated); pinDockToVisualViewport(); });
els.smoothAnimationsToggle.addEventListener('change', (e) => { state.config.smoothAnimations = (e.target as HTMLInputElement).checked; applySettings(); });
els.highlightActiveWordToggle.addEventListener('change', (e) => { state.config.highlightActiveWord = (e.target as HTMLInputElement).checked; applySettings(); updateHighlight(); });
(['mono', 'sans', 'serif', 'comicSans', 'openDyslexic'] as const).forEach(font => els.fontFamilyBtns[font].addEventListener('click', () => { state.config.fontFamily = font; applySettings(); updateFontFamilyButtons(); }));
els.clearHistoryBtn.addEventListener('click', clearHistory);
els.dismissWarningBtn.addEventListener('click', () => els.browserWarning.classList.add('hidden'));
els.dismissIpadWarningBtn.addEventListener('click', () => els.ipadPwaWarning.classList.add('hidden'));
els.dismissLangWarningBtn.addEventListener('click', () => { els.langDetectionWarning.classList.add('hidden'); if (langWarningTimer) clearTimeout(langWarningTimer); });
els.dismissAndroidVideoWarningBtn.addEventListener('click', () => els.androidVideoWarning.classList.add('hidden'));
els.videoModeBtn.addEventListener('click', async () => { if (state.isVideoMode) exitVideoMode(); else { const originalContent = els.videoModeBtn.innerHTML; (els.videoModeBtn as HTMLButtonElement).disabled = true; els.videoModeBtn.innerHTML = `<svg class="animate-spin h-6 w-6 text-neutral-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>`; await enterVideoMode(); (els.videoModeBtn as HTMLButtonElement).disabled = false; els.videoModeBtn.innerHTML = originalContent; } });
els.videoLayoutToggleBtn.addEventListener('click', toggleVideoLayout);
els.videoFlipCameraBtn.addEventListener('click', flipCamera);
els.videoRecordBtn.addEventListener('click', startRecording);
els.videoStopBtn.addEventListener('click', stopRecording);

function initializeUI(): void {
    if (new URLSearchParams(window.location.search).get('beta') === 'hmirror') localStorage.setItem('beta-hmirror', '1');
    if (localStorage.getItem('beta-hmirror') === '1') { els.hMirrorRow.classList.remove('hidden'); els.hMirrorRow.classList.add('flex'); els.mirrorModeLabel.textContent = 'Mirror Mode (vertical)'; }
    els.fontSizeVal.textContent = `${state.config.fontSize}px`; els.fontSizeInput.value = state.config.fontSize.toString();
    els.lineHeightVal.textContent = `${state.config.lineHeight}x`; els.lineHeightInput.value = state.config.lineHeight.toString(); els.scriptContent.style.lineHeight = `${state.config.lineHeight}`;
    els.paragraphSpacingVal.textContent = `${state.config.paragraphSpacing}em`; els.paragraphSpacingInput.value = state.config.paragraphSpacing.toString();
    els.marginVal.textContent = `${state.config.margin}%`; els.marginInput.value = state.config.margin.toString();
    els.dockOpacityVal.textContent = `${state.config.dockOpacity}%`; els.dockOpacityInput.value = state.config.dockOpacity.toString();
    els.activeLinePositionVal.textContent = `${state.config.activeLinePosition}%`; els.activeLinePositionInput.value = state.config.activeLinePosition.toString();
    els.lookaheadWordsVal.textContent = `${state.config.lookaheadWords}`; els.lookaheadWordsInput.value = state.config.lookaheadWords.toString();
    updateAlignmentButtons(); updateDirectionButtons();
    els.smoothAnimationsToggle.checked = state.config.smoothAnimations; els.highlightActiveWordToggle.checked = state.config.highlightActiveWord; els.voiceCommandToggle.checked = state.config.voiceCommandsEnabled; els.stopSignToggle.checked = state.config.showStopIcon;
    const history = getHistory();
    if (history.length === 0) {
        const demoText = `Welcome to VoicePrompter - a completely free teleprompter that works right in the browser.\nThis text is scrolling automatically as you speak following your voice.\nSee the highlighted word? That's where you are in the script right now.\nIf you want to jump to a different part, just tap any word and it syncs instantly.\nYou can also use voice commands like go back, go next, go start, or go finish.\nThe app can also record video with the script overlaid, so you don't need any extra software.\nIn the settings you can adjust font size, margins, line and paragraph spacing, pick a color theme and more - I encourage you to explore the settings on your own and find the best ones for you.\nThe app supports 34 languages and detects them automatically.\nOne more thing - text in square brackets gets skipped automatically [like this]. Useful for notes or reminders to yourself.\nEverything runs on your device. Nothing is sent to any server. You can even save it to your home screen and use it completely offline.\n\nNow go make something great ;)`;
        const demoItem = { id: Date.now(), text: demoText, preview: demoText.substring(0, 40) + '...', date: new Date().toLocaleDateString(), tag: 'demo' };
        localStorage.setItem('teleprompter_history', JSON.stringify([demoItem])); els.inputScript.value = demoText; renderHistoryList(getHistory(), loadScript);
    } else renderHistoryList(history, loadScript);
    updateAutoDetectText(null); applySettings(); updateFontFamilyButtons();
    if (isIOS) { if (els.devicesSelectionContainer) els.devicesSelectionContainer.classList.add('hidden'); } else enumerateAndPopulateDevices(false);
}
function updateAlignmentButtons(): void { (['left', 'center', 'right'] as const).forEach(a => { const btn = els.alignBtns[a]; const isActive = a === state.config.textAlign; btn.classList.toggle('bg-neutral-500', isActive); btn.classList.toggle('text-white', isActive); btn.classList.toggle('hover:bg-neutral-600', !isActive); }); }
function updateDirectionButtons(): void { (['ltr', 'rtl'] as const).forEach(dir => { const btn = els.dirBtns[dir]; const isActive = state.config.textDirection === dir; btn.classList.toggle('bg-neutral-700', isActive); btn.classList.toggle('text-white', isActive); btn.classList.toggle('border-[#FFBB00]', isActive); btn.classList.toggle('bg-neutral-800', !isActive); btn.classList.toggle('text-neutral-300', !isActive); btn.classList.toggle('border-neutral-700', !isActive); }); }
function updateFontFamilyButtons(): void { (['mono', 'sans', 'serif', 'comicSans', 'openDyslexic'] as const).forEach(font => { const btn = els.fontFamilyBtns[font]; const isActive = state.config.fontFamily === font; btn.classList.toggle('bg-neutral-700', isActive); btn.classList.toggle('text-white', isActive); btn.classList.toggle('border-[#FFBB00]', isActive); btn.classList.toggle('bg-neutral-800', !isActive); btn.classList.toggle('text-neutral-300', !isActive); btn.classList.toggle('border-neutral-700', !isActive); }); }
async function handleDeviceChange(): Promise<void> { state.selectedVideoDeviceId = els.videoDeviceSelect.value || null; state.selectedAudioDeviceId = els.audioDeviceSelect.value || null; if (state.isVideoMode && !state.isRecording) { try { const stream = await navigator.mediaDevices.getUserMedia(getMediaConstraints()); if (state.mediaStream) state.mediaStream.getTracks().forEach(track => track.stop()); state.mediaStream = stream; els.videoPreview.srcObject = stream; els.videoPreview.muted = true; els.videoPreview.style.transform = state.selectedVideoDeviceId ? 'none' : (state.facingMode === 'user' ? 'scaleX(-1)' : 'none'); await els.videoPreview.play(); } catch (err) { console.error('Failed to switch media device sources:', err); alert('Failed to switch to the selected device.'); } } if (state.isListening) { if (state.config.scrollingMode === 'sound') { autoScrollManager.stop(); const started = await autoScrollManager.start(); if (!started) { state.isListening = false; const { updateMicUI } = await import('./render'); updateMicUI(false); } } else if (state.config.scrollingMode === 'voice') { stopListening(); setTimeout(() => startListening(), 400); } } }
if (!isIOS) { els.videoDeviceSelect.addEventListener('change', handleDeviceChange); els.audioDeviceSelect.addEventListener('change', handleDeviceChange); }
const permissionRequested = { video: false, audio: false };
async function requestPermissionsOnSelectFocus(kind: 'video' | 'audio') { if (permissionRequested[kind]) return; const devices = await navigator.mediaDevices.enumerateDevices(); const needsPermission = devices.some(d => kind === 'video' ? d.kind === 'videoinput' && !d.label : d.kind === 'audioinput' && !d.label); if (needsPermission) { permissionRequested[kind] = true; await enumerateAndPopulateDevices(true, kind); } }
if (!isIOS) { els.videoDeviceSelect.addEventListener('focus', () => requestPermissionsOnSelectFocus('video')); els.audioDeviceSelect.addEventListener('focus', () => requestPermissionsOnSelectFocus('audio')); els.videoDeviceSelect.addEventListener('mousedown', () => requestPermissionsOnSelectFocus('video')); els.audioDeviceSelect.addEventListener('mousedown', () => requestPermissionsOnSelectFocus('audio')); navigator.mediaDevices.addEventListener('devicechange', () => enumerateAndPopulateDevices(false)); }
function updateScrollingUI() { els.scrollingModeSelect.value = state.config.scrollingMode; els.scrollSpeedInput.value = state.config.scrollSpeed.toString(); els.scrollSpeedVal.textContent = `${state.config.scrollSpeed.toFixed(1)} w/s`; els.soundSensitivityInput.value = state.config.soundSensitivity.toString(); els.soundSensitivityVal.textContent = `${Math.round(state.config.soundSensitivity * 100)}%`; els.scrollSpeedContainer.classList.toggle('hidden', state.config.scrollingMode === 'voice'); els.soundSensitivityContainer.classList.toggle('hidden', state.config.scrollingMode !== 'sound'); const descriptions: Record<ScrollingMode, string> = { voice: 'Follows the words you say and pauses when you pause.', sound: 'Scrolls while microphone sound is detected and pauses during silence.', constant: 'Scrolls continuously at the speed you choose.' }; els.scrollingModeDescription.textContent = descriptions[state.config.scrollingMode]; const path = els.micButton.querySelector('path'); if (path) { if (state.config.scrollingMode === 'voice') path.setAttribute('d', 'M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z'); else path.setAttribute('d', 'M8 5v14l11-7z'); } }
els.scrollingModeSelect.addEventListener('change', (e) => { state.config.scrollingMode = (e.target as HTMLSelectElement).value as ScrollingMode; autoScrollManager.stop(); isAutoScrollStarting = false; updateScrollingUI(); if (state.isListening) { stopListening(); autoScrollManager.stop(); state.isListening = false; import('./render').then(({ updateMicUI }) => updateMicUI(false)); } });
els.scrollSpeedInput.addEventListener('input', (e) => { state.config.scrollSpeed = parseFloat((e.target as HTMLInputElement).value); els.scrollSpeedVal.textContent = `${state.config.scrollSpeed.toFixed(1)} w/s`; });
els.soundSensitivityInput.addEventListener('input', (e) => { state.config.soundSensitivity = parseFloat((e.target as HTMLInputElement).value); els.soundSensitivityVal.textContent = `${Math.round(state.config.soundSensitivity * 100)}%`; });
function boot(): void { updateScrollingUI(); initializeUI(); pinDockToVisualViewport(); setTimeout(() => renderHistoryList(getHistory(), loadScript), 500); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
window.addEventListener('pageshow', () => { renderHistoryList(getHistory(), loadScript); pinDockToVisualViewport(); });
let dockPinned = false;
function pinDockToVisualViewport(): void { const dock = document.getElementById('mainControlsDock'); const vv = window.visualViewport; if (!dock || !vv) return; const update = () => { if (document.body.classList.contains('screen-rotated')) { dock.style.top = ''; dock.style.bottom = ''; return; } if (dock.offsetHeight === 0) return; const visualBottomInLayout = vv.offsetTop + vv.height; const margin = 32; dock.style.bottom = 'auto'; dock.style.top = `${visualBottomInLayout - dock.offsetHeight - margin}px`; }; if (dockPinned) { requestAnimationFrame(update); return; } dockPinned = true; vv.addEventListener('resize', update); vv.addEventListener('scroll', update); window.addEventListener('orientationchange', () => { requestAnimationFrame(update); setTimeout(update, 300); }); requestAnimationFrame(update); const prompterContainer = document.getElementById('prompterContainer'); if (prompterContainer) { const observer = new MutationObserver((mutations) => { for (const mutation of mutations) if (mutation.attributeName === 'class') { const target = mutation.target as HTMLElement; if (!target.classList.contains('hidden')) requestAnimationFrame(update); } }); observer.observe(prompterContainer, { attributes: true, attributeFilter: ['class'] }); } }
pinDockToVisualViewport();
