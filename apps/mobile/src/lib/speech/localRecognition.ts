import Constants from 'expo-constants';
import { Platform } from 'react-native';
import {
  AVAudioSessionCategory,
  AVAudioSessionCategoryOptions,
  AVAudioSessionMode,
  ExpoSpeechRecognitionModule,
  type ExpoSpeechRecognitionOptions,
} from 'expo-speech-recognition';

const CHINESE_LOCALE_CANDIDATES = ['zh-CN', 'zh-Hans-CN', 'zh-Hans', 'zh-TW', 'zh-HK'];

let resolvedLocale = 'zh-CN';
let startProfileIndex = 0;

const IOS_AUDIO_CATEGORY = {
  category: AVAudioSessionCategory.playAndRecord,
  categoryOptions: [
    AVAudioSessionCategoryOptions.defaultToSpeaker,
    AVAudioSessionCategoryOptions.allowBluetooth,
  ],
  mode: AVAudioSessionMode.measurement,
};

const START_PROFILES: Partial<ExpoSpeechRecognitionOptions>[] = [
  {
    continuous: true,
    requiresOnDeviceRecognition: false,
    iosVoiceProcessingEnabled: false,
  },
  {
    continuous: false,
    requiresOnDeviceRecognition: false,
    iosVoiceProcessingEnabled: false,
  },
];

export function isIosSimulator(): boolean {
  if (Platform.OS !== 'ios') return false;
  const model = Constants.platform?.ios?.model ?? '';
  return /simulator/i.test(model);
}

export async function ensureSpeechPermissions(): Promise<boolean> {
  try {
    const mic = await ExpoSpeechRecognitionModule.getMicrophonePermissionsAsync();
    if (!mic.granted) {
      const req = await ExpoSpeechRecognitionModule.requestMicrophonePermissionsAsync();
      if (!req.granted) return false;
    }

    const speech = await ExpoSpeechRecognitionModule.getSpeechRecognizerPermissionsAsync();
    if (!speech.granted) {
      const req = await ExpoSpeechRecognitionModule.requestSpeechRecognizerPermissionsAsync();
      if (!req.granted) return false;
      if (speech.restricted || req.restricted) return false;
    }

    const status = await ExpoSpeechRecognitionModule.getPermissionsAsync();
    if (!status.granted) {
      const req = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!req.granted) return false;
      if (req.restricted) return false;
    }

    return true;
  } catch {
    return false;
  }
}

async function pickChineseLocale(): Promise<string> {
  try {
    const supported = await ExpoSpeechRecognitionModule.getSupportedLocales({});
    const all = [...supported.installedLocales, ...supported.locales];
    for (const candidate of CHINESE_LOCALE_CANDIDATES) {
      if (all.includes(candidate)) return candidate;
    }
    const zh = all.find((l) => l.startsWith('zh'));
    if (zh) return zh;
  } catch {
    // 忽略，使用默认 zh-CN
  }
  return 'zh-CN';
}

export async function prepareSpeechEngine(): Promise<{
  ok: boolean;
  simulator: boolean;
}> {
  if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
    return { ok: false, simulator: isIosSimulator() };
  }

  if (Platform.OS === 'ios') {
    try {
      ExpoSpeechRecognitionModule.setCategoryIOS(IOS_AUDIO_CATEGORY);
    } catch {
      // 忽略
    }
  }

  resolvedLocale = await pickChineseLocale();

  try {
    const state = await ExpoSpeechRecognitionModule.getStateAsync();
    if (state !== 'inactive') {
      ExpoSpeechRecognitionModule.abort();
    }
  } catch {
    // 忽略
  }

  return { ok: true, simulator: isIosSimulator() };
}

export function resetStartProfile(): void {
  startProfileIndex = 0;
}

export function rotateStartProfile(): boolean {
  if (startProfileIndex >= START_PROFILES.length - 1) return false;
  startProfileIndex += 1;
  return true;
}

export function startListening(options?: Partial<ExpoSpeechRecognitionOptions>): void {
  const profile = START_PROFILES[startProfileIndex] ?? START_PROFILES[0]!;

  ExpoSpeechRecognitionModule.start({
    lang: resolvedLocale,
    interimResults: true,
    addsPunctuation: true,
    iosTaskHint: 'dictation',
    iosCategory: IOS_AUDIO_CATEGORY,
    ...profile,
    ...options,
  });
}

export function stopListening(): void {
  ExpoSpeechRecognitionModule.stop();
}

export function abortListening(): void {
  ExpoSpeechRecognitionModule.abort();
}

export function isRecognitionAvailable(): boolean {
  return ExpoSpeechRecognitionModule.isRecognitionAvailable();
}

/** Android：尝试触发系统离线中文包下载（不阻塞） */
export async function prepareAndroidOfflinePack(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await ExpoSpeechRecognitionModule.androidTriggerOfflineModelDownload({
      locale: resolvedLocale,
    });
  } catch {
    // 部分机型已安装或不需要
  }
}

export function getResolvedSpeechLocale(): string {
  return resolvedLocale;
}
