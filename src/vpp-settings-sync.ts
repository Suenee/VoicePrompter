import { remoteCommandHandler } from './remote-command-handler';
import { state, SYNCHRONIZED_SETTING_CHANGED_EVENT } from './state';

type JsonObject = Record<string, unknown>;
type PublicHandler = (args: JsonObject) => Promise<JsonObject | void>;
type ToggleState = 'on' | 'off' | 'toggle';
type SettingValue = string | number;

type SynchronizedSettingName =
    | 'microphone'
    | 'voiceCommands'
    | 'navigationControls'
    | 'fontSize'
    | 'textAlignment'
    | 'mirrorMode'
    | 'rotateScreen'
    | 'recordingDockOpacity'
    | 'googleDocUrl';

interface InternalRemoteCommandHandler {
    publicMethods: Record<string, PublicHandler>;
    validateCall: (message: JsonObject) => string | null;
    sender: unknown;
}

interface SynchronizedSettingChangedDetail {
    setting: SynchronizedSettingName;
    value: SettingValue;
}

const internal = remoteCommandHandler as unknown as InternalRemoteCommandHandler;
const installKey = '__voicePrompterVppSettingsSyncInstalled';
const installState = window as unknown as Record<string, unknown>;
const GDOC_REMEMBER_KEY = 'voiceprompter_gdoc_remember';
const GDOC_REMEMBER_DAYS = 7;

let remoteMutationDepth = 0;

function onOff(value: boolean): 'on' | 'off' {
    return value ? 'on' : 'off';
}

function getSettingValue(setting: SynchronizedSettingName): SettingValue {
    switch (setting) {
        case 'microphone': return onOff(state.isListening);
        case 'voiceCommands': return onOff(state.config.voiceCommandsEnabled);
        case 'navigationControls': return onOff(state.config.navigationControlsEnabled);
        case 'fontSize': return state.config.fontSize;
        case 'textAlignment': return state.config.textAlign;
        case 'mirrorMode': return onOff(state.isMirrored);
        case 'rotateScreen': return onOff(state.isScreenRotated);
        case 'recordingDockOpacity': return state.config.dockOpacity;
        case 'googleDocUrl': return state.googleDocUrl ?? '';
    }
}

function settingResult(setting: SynchronizedSettingName): JsonObject {
    return { setting, value: getSettingValue(setting) };
}

function getSettingsSnapshot(): JsonObject {
    return {
        microphone: getSettingValue('microphone'),
        voiceCommands: getSettingValue('voiceCommands'),
        navigationControls: getSettingValue('navigationControls'),
        fontSize: getSettingValue('fontSize'),
        textAlignment: getSettingValue('textAlignment'),
        mirrorMode: getSettingValue('mirrorMode'),
        rotateScreen: getSettingValue('rotateScreen'),
        recordingDockOpacity: getSettingValue('recordingDockOpacity'),
        googleDocUrl: getSettingValue('googleDocUrl')
    };
}

function targetBoolean(current: boolean, requested: ToggleState): boolean {
    if (requested === 'toggle') return !current;
    return requested === 'on';
}

async function runRemoteMutation<T>(operation: () => Promise<T> | T): Promise<T> {
    remoteMutationDepth++;
    try {
        return await operation();
    } finally {
        remoteMutationDepth--;
    }
}

async function waitForBoolean(
    read: () => boolean,
    expected: boolean,
    timeoutMs = 2500
): Promise<void> {
    if (read() === expected) return;

    const started = Date.now();
    await new Promise<void>((resolve, reject) => {
        const timer = window.setInterval(() => {
            if (read() === expected) {
                window.clearInterval(timer);
                resolve();
                return;
            }

            if (Date.now() - started >= timeoutMs) {
                window.clearInterval(timer);
                reject(new Error('Requested setting did not reach the expected state'));
            }
        }, 25);
    });
}

function rememberGoogleDocUrlIfEnabled(url: string): void {
    const toggle = document.getElementById('rememberGoogleDocUrlToggle') as HTMLInputElement | null;
    if (!toggle?.checked) return;

    localStorage.setItem(
        GDOC_REMEMBER_KEY,
        JSON.stringify({
            url,
            expiresAt: Date.now() + GDOC_REMEMBER_DAYS * 24 * 60 * 60 * 1000
        })
    );
}

function setNavigationControls(requested: ToggleState): void {
    const desired = targetBoolean(state.config.navigationControlsEnabled, requested);
    const toggle = document.getElementById('navigationControlsToggle') as HTMLInputElement | null;

    if (toggle) {
        if (toggle.checked === desired) return;
        toggle.checked = desired;
        toggle.dispatchEvent(new Event('change', { bubbles: true }));
        return;
    }

    state.config.navigationControlsEnabled = desired;
    document.getElementById('navigationControlsGroup')?.classList.toggle('hidden', !desired);
}

function wrapSimpleSettingMethod(
    method: string,
    setting: SynchronizedSettingName
): void {
    const original = internal.publicMethods[method];
    if (!original) return;

    internal.publicMethods[method] = async args => runRemoteMutation(async () => {
        await original(args);
        return settingResult(setting);
    });
}

function validateExtensionCall(message: JsonObject, method: string): string | null {
    if (message.from !== 'bc') return 'application calls to vp must come from bc';
    if (message.method !== method) return `call.method must be ${method}`;
    if (!message.args || typeof message.args !== 'object' || Array.isArray(message.args)) return 'call.args must be a JSON object';
    return null;
}

function install(): void {
    if (installState[installKey]) return;
    installState[installKey] = true;

    const originalValidateCall = internal.validateCall.bind(remoteCommandHandler);
    internal.validateCall = (message: JsonObject): string | null => {
        if (message.method === 'getSettingsSnapshot') {
            const commonError = validateExtensionCall(message, 'getSettingsSnapshot');
            if (commonError) return commonError;
            if (message.expectsResponse !== true) return 'getSettingsSnapshot requires expectsResponse: true';
            if (Object.keys(message.args as JsonObject).length !== 0) return 'getSettingsSnapshot does not accept arguments';
            return null;
        }

        if (message.method === 'setNavigationControls') {
            const commonError = validateExtensionCall(message, 'setNavigationControls');
            if (commonError) return commonError;
            const args = message.args as JsonObject;
            const keys = Object.keys(args);
            if (keys.length !== 1 || keys[0] !== 'state') return 'setNavigationControls accepts exactly the state argument';
            const requested = args.state;
            if (requested !== 'on' && requested !== 'off' && requested !== 'toggle') return 'setNavigationControls.state must be on, off or toggle';
            return null;
        }

        return originalValidateCall(message);
    };

    internal.publicMethods.getSettingsSnapshot = async () => ({ settings: getSettingsSnapshot() });
    internal.publicMethods.setNavigationControls = async args => runRemoteMutation(async () => {
        setNavigationControls(args.state as ToggleState);
        return settingResult('navigationControls');
    });

    const originalMicrophone = internal.publicMethods.setMicrophone;
    if (originalMicrophone) {
        internal.publicMethods.setMicrophone = async args => runRemoteMutation(async () => {
            const desired = targetBoolean(state.isListening, args.state as ToggleState);
            await originalMicrophone(args);
            await waitForBoolean(() => state.isListening, desired);
            return settingResult('microphone');
        });
    }

    wrapSimpleSettingMethod('setVoiceCommands', 'voiceCommands');
    wrapSimpleSettingMethod('setFontSize', 'fontSize');
    wrapSimpleSettingMethod('adjustFontSize', 'fontSize');
    wrapSimpleSettingMethod('setAlignment', 'textAlignment');
    wrapSimpleSettingMethod('setMirrorMode', 'mirrorMode');
    wrapSimpleSettingMethod('setRotateScreen', 'rotateScreen');
    wrapSimpleSettingMethod('setRecordingDockOpacity', 'recordingDockOpacity');
    wrapSimpleSettingMethod('adjustRecordingDockOpacity', 'recordingDockOpacity');

    const originalSetGoogleDocUrl = internal.publicMethods.setGoogleDocUrl;
    if (originalSetGoogleDocUrl) {
        internal.publicMethods.setGoogleDocUrl = async args => runRemoteMutation(async () => {
            await originalSetGoogleDocUrl(args);
            const url = state.googleDocUrl ?? '';
            if (url) rememberGoogleDocUrlIfEnabled(url);
            return settingResult('googleDocUrl');
        });
    }

    window.addEventListener(SYNCHRONIZED_SETTING_CHANGED_EVENT, event => {
        if (remoteMutationDepth > 0 || !internal.sender) return;

        const detail = (event as CustomEvent<SynchronizedSettingChangedDetail>).detail;
        if (!detail) return;

        remoteCommandHandler.sendProtocolMessage({
            protocolVersion: 1,
            id: crypto.randomUUID(),
            type: 'event',
            from: 'vp',
            recipient: 'bc',
            event: 'settingChanged',
            args: {
                setting: detail.setting,
                value: detail.value
            },
            expectsResponse: false,
            source: { app: 'VoicePrompter', version: 'devel' },
            timestamp: new Date().toISOString()
        });
    });
}

install();
