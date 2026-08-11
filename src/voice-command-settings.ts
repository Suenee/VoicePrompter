import { loadSetting, saveSetting } from './storage';

export type VoiceCommandAction =
    | 'goStart'
    | 'cueBack'
    | 'goBack'
    | 'goCurrent'
    | 'goNext'
    | 'cueNext'
    | 'goFinish';

export type VoiceCommandPhrases = Record<VoiceCommandAction, string>;

const STORAGE_KEY = 'voiceCommandPhrases';

export const DEFAULT_VOICE_COMMAND_PHRASES: VoiceCommandPhrases = {
    goStart: 'go start', cueBack: 'cue back', goBack: 'go back', goCurrent: 'go current', goNext: 'go next', cueNext: 'cue next', goFinish: 'go finish'
};

const LABELS: Record<VoiceCommandAction, string> = {
    goStart: 'Go Start', cueBack: 'Cue Back', goBack: 'Go Back', goCurrent: 'Go Current', goNext: 'Go Next', cueNext: 'Cue Next', goFinish: 'Go Finish'
};
const ICONS: Record<VoiceCommandAction, string> = {
    goStart: '|<', cueBack: '[<', goBack: '<<', goCurrent: '<|', goNext: '>>', cueNext: '>]', goFinish: '>|'
};
const ACTIONS = Object.keys(DEFAULT_VOICE_COMMAND_PHRASES) as VoiceCommandAction[];

let currentPhrases: VoiceCommandPhrases = { ...DEFAULT_VOICE_COMMAND_PHRASES, ...loadSetting<Partial<VoiceCommandPhrases>>(STORAGE_KEY, {}) };
export function getVoiceCommandPhrases(): VoiceCommandPhrases { return currentPhrases; }
export function getVoiceCommandAliases(): Array<{ action: VoiceCommandAction; phrase: string }> {
    const aliases: Array<{ action: VoiceCommandAction; phrase: string }> = [];
    for (const action of ACTIONS) {
        for (const phrase of currentPhrases[action].split(',').map(v => v.trim().toLowerCase()).filter(Boolean)) aliases.push({ action, phrase });
    }
    return aliases.sort((a, b) => b.phrase.split(/\s+/).length - a.phrase.split(/\s+/).length);
}
function saveVoiceCommandPhrases(phrases: VoiceCommandPhrases): void { currentPhrases = { ...phrases }; saveSetting(STORAGE_KEY, currentPhrases); }

export function reportVoiceCommandRecognition(heard: string, action: VoiceCommandAction | null): void {
    const modal = document.getElementById('voiceCommandsModal');
    if (!modal || modal.classList.contains('hidden')) return;
    const heardEl = document.getElementById('voiceCommandsHeard');
    const matchedEl = document.getElementById('voiceCommandsMatched');
    if (heardEl) heardEl.textContent = heard.trim() || '—';
    if (matchedEl) matchedEl.textContent = action ? LABELS[action] : '—';
}

function createModal(): HTMLElement {
    const modal = document.createElement('div');
    modal.id = 'voiceCommandsModal';
    modal.className = 'hidden fixed inset-0 z-[10003] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4';
    const rows = ACTIONS.map(action => `
        <div class="grid grid-cols-[34px_96px_1fr] gap-2 items-center">
            <span class="h-8 min-w-8 px-1 flex items-center justify-center rounded bg-neutral-800 border border-neutral-700 font-mono text-xs text-neutral-300">${ICONS[action].replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>
            <label for="voicePhrase-${action}" class="text-xs text-neutral-300">${LABELS[action]}</label>
            <input id="voicePhrase-${action}" data-voice-action="${action}" type="text" autocomplete="off" class="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-[#FFBB00] focus:border-transparent outline-none" placeholder="${DEFAULT_VOICE_COMMAND_PHRASES[action]}">
        </div>`).join('');
    modal.innerHTML = `
        <div class="relative bg-neutral-900 border border-neutral-700 rounded-xl p-6 max-w-lg w-full shadow-2xl shadow-black/50">
            <h2 class="text-xl font-bold text-white mb-2">Voice Commands</h2>
            <p class="text-xs text-neutral-500 mb-3">Say the command words while the microphone is enabled and listening. “Heard” shows what the computer understood, so you can tune the phrases below. Separate alternatives with commas.</p>
            <div class="grid grid-cols-[1fr_auto_1fr] gap-4 mb-5 px-3 py-2.5 rounded-lg bg-neutral-950/60 border border-neutral-800 font-mono text-xs items-center">
                <div class="min-w-0 whitespace-nowrap overflow-hidden text-ellipsis"><span class="text-neutral-500">Heard:</span> <span id="voiceCommandsHeard" class="text-white">—</span></div>
                <div class="min-w-[150px] text-center"><span class="text-neutral-500">Matched:</span> <span id="voiceCommandsMatched" class="text-[#FFBB00]">—</span></div>
                <div></div>
            </div>
            <div class="space-y-3">${rows}</div>
            <div class="flex items-center justify-end gap-3 mt-6">
                <button id="voiceCommandsResetBtn" type="button" title="Reset to English defaults" class="h-10 w-10 flex items-center justify-center bg-neutral-800 hover:bg-neutral-700 rounded-lg text-neutral-300 hover:text-white border border-neutral-700 transition-colors" aria-label="Reset to English defaults"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg></button>
                <button id="voiceCommandsCancelBtn" type="button" class="px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-sm font-medium text-white border border-neutral-700 transition-colors">Cancel</button>
                <button id="voiceCommandsSaveBtn" type="button" class="px-4 py-2.5 bg-[#FFBB00] hover:bg-[#D9A000] rounded-lg text-sm font-semibold text-black transition-colors">Save</button>
            </div>
        </div>`;
    document.body.appendChild(modal); return modal;
}

function initVoiceCommandSettings(): void {
    const toggle = document.getElementById('voiceCommandToggle');
    const row = toggle?.closest('.flex.items-center.justify-between');
    if (!toggle || !row || document.getElementById('voiceCommandsSettingsBtn')) return;
    const rightSide = toggle.parentElement; if (!rightSide) return;
    const button = document.createElement('button');
    button.id = 'voiceCommandsSettingsBtn'; button.type = 'button'; button.title = 'Edit voice command phrases';
    button.className = 'h-8 min-w-9 px-2 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-xs font-bold text-neutral-300 hover:text-white transition-colors'; button.textContent = '>>';
    rightSide.insertBefore(button, toggle.parentElement === rightSide ? toggle : null);
    if (rightSide.tagName === 'LABEL' && rightSide.parentElement) { rightSide.parentElement.insertBefore(button, rightSide); rightSide.parentElement.classList.add('flex', 'items-center', 'gap-2'); }
    const modal = createModal();
    const inputs = new Map<VoiceCommandAction, HTMLInputElement>();
    modal.querySelectorAll<HTMLInputElement>('[data-voice-action]').forEach(input => inputs.set(input.dataset.voiceAction as VoiceCommandAction, input));
    const fill = (phrases: VoiceCommandPhrases) => { for (const action of ACTIONS) { const input = inputs.get(action); if (input) input.value = phrases[action]; } };
    const close = () => modal.classList.add('hidden');
    button.addEventListener('click', () => { fill(currentPhrases); reportVoiceCommandRecognition('', null); modal.classList.remove('hidden'); inputs.get('goStart')?.focus(); });
    document.getElementById('voiceCommandsCancelBtn')?.addEventListener('click', close);
    document.getElementById('voiceCommandsResetBtn')?.addEventListener('click', () => fill(DEFAULT_VOICE_COMMAND_PHRASES));
    document.getElementById('voiceCommandsSaveBtn')?.addEventListener('click', () => { const next = {} as VoiceCommandPhrases; for (const action of ACTIONS) { const raw = inputs.get(action)?.value.trim() || ''; next[action] = raw || DEFAULT_VOICE_COMMAND_PHRASES[action]; } saveVoiceCommandPhrases(next); close(); });
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
}
if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', initVoiceCommandSettings); else initVoiceCommandSettings();
