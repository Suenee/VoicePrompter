import './style.css';
import './cursor-autohide';
import { registerSW } from 'virtual:pwa-register';
import { initElements, els } from './elements';
import { state } from './state';
import './remote-control';
import { renderScript, updateHighlight, scrollToCurrent, applySettings, renderHistoryList, restartScript, updateMicUI } from './render';
import { initSpeech, startListening, stopListening } from './speech';
import { autoScrollManager } from './autoscroll';
import { saveToHistory, getHistory, loadSetting, saveSetting } from './storage';
import { ScriptWord, ScrollingMode } from './types';
import { enterVideoMode, exitVideoMode, toggleVideoLayout, startRecording, stopRecording, flipCamera } from './video';
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
                    menu.style.bottom = '100%'; menu.style.top = 'auto'; menu.style.marginBottom = '0.5rem';
                } else {
                    menu.style.bottom = 'auto'; menu.style.top = '100%'; menu.style.marginBottom = '0';
                }
            }
        });

        menu.querySelectorAll('.lang-option').forEach(opt => {
            opt.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                handleLanguageChange((opt as HTMLButtonElement).dataset.value!);
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
        const mappedLang = LANG_MAP[detection] || 'en-US';
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
        const cleanWord = word.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
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
window.addEventListener('orientationchange', () => setTimeout(keepScrollZeroWhileLocked, 100));

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
        if (state.config.scrollingMode === 'voice') stopListening();
        else { autoScrollManager.stop(); state.isListening = false; updateMicUI(false); }
        return;
    }
    if (state.config.scrollingMode === 'voice') { startListening(); return; }
    isAutoScrollStarting = true;
    try {
        const started = await autoScrollManager.start();
        if (started) { state.isListening = true; updateMicUI(true); }
    } finally { isAutoScrollStarting = false; }
});

els.resetAppBtn.addEventListener('click', resetApp);
els.restartScriptBtn.addEventListener('click', restartScript);

let promoTimeout: number | null = null;
let promoIndex = 0;
const promoPairs = [
    { static: 'Record video in sync with your script.', options: ['Switch cameras.', 'Monitor audio.', 'Save locally.'] },
    { static: 'No cloud. No tracking.', options: ['100% Offline.', 'Your data stays on device.', 'Privacy by design.'] },
    { static: 'Designed for creators who move.', options: ['Mobile ready.', 'Tablet optimized.', 'Desktop powerful.'] }
];
let currentPromoPairStatic = promoPairs[0].static;
let currentPromoWord = promoPairs[0].options[0];
const visitorPlatform = detectVisitorPlatform();
const nativePromo = getNativePromo(visitorPlatform);
function startPromoAnimation() { if (promoTimeout) return; const tick = () => { promoIndex = (promoIndex + 1) % promoPairs.length; const pair = promoPairs[promoIndex]; currentPromoPairStatic = pair.static; currentPromoWord = pair.options[Math.floor(Math.random() * pair.options.length)]; els.nativePromoTitle.textContent = pair.static; els.nativePromoSubtitle.textContent = currentPromoWord; promoTimeout = window.setTimeout(tick, 3500); }; promoTimeout = window.setTimeout(tick, 3500); }
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
els.scrollSpeedInput.addEventListener('input', (e) => { const val = parseFloat((e.target as HTMLInputElement).value); state.config.scrollSpeed = val; els.scrollSpeedVal.textContent = `${val.toFixed(1)} w/s`; });
els.soundSensitivityInput.addEventListener('input', (e) => { const val = parseFloat((e.target as HTMLInputElement).value); state.config.soundSensitivity = val; els.soundSensitivityVal.textContent = `${Math.round(val * 100)}%`; });
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
els.highlightActiveWordToggle.addEventListener('change', (e) => { state.config.highlightActiveWord = (e.target as HTMLInputElement).checked; applySettings(); });

function updateAlignmentButtons() { (['left', 'center', 'right'] as const).forEach(align => { const active = state.config.textAlign === align; els.alignBtns[align].classList.toggle('bg-[#FFBB00]', active); els.alignBtns[align].classList.toggle('text-black', active); els.alignBtns[align].classList.toggle('bg-neutral-800', !active); els.alignBtns[align].classList.toggle('text-neutral-300', !active); }); }
function updateDirectionButtons() { (['ltr', 'rtl'] as const).forEach(dir => { const active = state.config.textDirection === dir; els.dirBtns[dir].classList.toggle('bg-[#FFBB00]', active); els.dirBtns[dir].classList.toggle('text-black', active); els.dirBtns[dir].classList.toggle('bg-neutral-800', !active); els.dirBtns[dir].classList.toggle('text-neutral-300', !active); }); }

let dockVisualViewportRaf: number | null = null;
function pinDockToVisualViewport() { if (dockVisualViewportRaf !== null) return; dockVisualViewportRaf = requestAnimationFrame(() => { dockVisualViewportRaf = null; const dock = document.getElementById('mainControlsDock'); if (!dock) return; const vv = window.visualViewport; if (!vv) { dock.style.removeProperty('transform'); return; } const centeredOffset = (vv.width / 2) - (window.innerWidth / 2); dock.style.transform = `translateX(calc(-50% + ${centeredOffset}px))`; }); }
if (window.visualViewport) { window.visualViewport.addEventListener('resize', pinDockToVisualViewport); window.visualViewport.addEventListener('scroll', pinDockToVisualViewport); }
window.addEventListener('orientationchange', () => setTimeout(pinDockToVisualViewport, 100));

els.fontFamilyBtns.mono.addEventListener('click', () => { state.config.fontFamily = 'mono'; applySettings(); });
els.fontFamilyBtns.sans.addEventListener('click', () => { state.config.fontFamily = 'sans'; applySettings(); });
els.fontFamilyBtns.serif.addEventListener('click', () => { state.config.fontFamily = 'serif'; applySettings(); });
els.fontFamilyBtns.comicSans.addEventListener('click', () => { state.config.fontFamily = 'comicSans'; applySettings(); });
els.fontFamilyBtns.openDyslexic.addEventListener('click', () => { state.config.fontFamily = 'openDyslexic'; applySettings(); });

els.scrollingModeSelect.addEventListener('change', (e) => {
    const mode = (e.target as HTMLSelectElement).value as ScrollingMode;
    if (state.isListening) {
        if (state.config.scrollingMode === 'voice') stopListening();
        else { autoScrollManager.stop(); state.isListening = false; updateMicUI(false); }
    }
    state.config.scrollingMode = mode;
    els.scrollSpeedContainer.classList.toggle('hidden', mode !== 'constant');
    els.soundSensitivityContainer.classList.toggle('hidden', mode !== 'sound');
    const descriptions: Record<ScrollingMode, string> = {
        voice: 'Scrolls as you speak, matching words in real-time.',
        constant: 'Scrolls automatically at a constant speed.',
        sound: 'Scrolls when sound is detected from the microphone.'
    };
    els.scrollingModeDescription.textContent = descriptions[mode];
    updateMicUI(false);
});

els.dismissWarningBtn.addEventListener('click', () => els.browserWarning.classList.add('hidden'));
els.dismissIpadWarningBtn.addEventListener('click', () => els.ipadPwaWarning.classList.add('hidden'));
els.dismissLangWarningBtn.addEventListener('click', () => els.langDetectionWarning.classList.add('hidden'));
els.dismissAndroidVideoWarningBtn.addEventListener('click', () => els.androidVideoWarning.classList.add('hidden'));

els.videoModeBtn.addEventListener('click', () => { if (!state.isVideoMode) enterVideoMode(); else exitVideoMode(); });
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
    els.scrollSpeedVal.textContent = `${state.config.scrollSpeed.toFixed(1)} w/s`; els.scrollSpeedInput.value = state.config.scrollSpeed.toString();
    els.soundSensitivityVal.textContent = `${Math.round(state.config.soundSensitivity * 100)}%`; els.soundSensitivityInput.value = state.config.soundSensitivity.toString();
    els.textColorInput.value = state.config.textColor; els.bgColorInput.value = state.config.bgColor;
    els.scriptContent.style.fontSize = `${state.config.fontSize}px`; els.scriptContent.style.paddingLeft = `${state.config.margin}%`; els.scriptContent.style.paddingRight = `${state.config.margin}%`;
    els.scrollingModeSelect.value = state.config.scrollingMode;
    els.scrollSpeedContainer.classList.toggle('hidden', state.config.scrollingMode !== 'constant');
    els.soundSensitivityContainer.classList.toggle('hidden', state.config.scrollingMode !== 'sound');
    els.voiceCommandToggle.checked = state.config.voiceCommandsEnabled; els.stopSignToggle.checked = state.config.showStopIcon;
    els.screenRotationToggle.checked = state.isScreenRotated; document.body.classList.toggle('screen-rotated', state.isScreenRotated);
    els.mirrorToggle.checked = state.isMirrored; els.scrollContainer.classList.toggle('mirror-mode', state.isMirrored);
    els.hMirrorToggle.checked = state.isMirroredH; els.scrollContainer.classList.toggle('mirror-mode-h', state.isMirroredH);
    els.preserveFormattingToggle.checked = state.config.preserveFormatting; els.smoothAnimationsToggle.checked = state.config.smoothAnimations; els.highlightActiveWordToggle.checked = state.config.highlightActiveWord;
    applySettings(); updateAlignmentButtons(); updateDirectionButtons(); updateAutoDetectText(state.detectedLanguage); pinDockToVisualViewport();
}

renderHistoryList(getHistory(), loadScript);
initializeUI();
