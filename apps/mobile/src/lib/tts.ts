import { appAlert } from './appAlert';
import * as Speech from 'expo-speech';
import { VoiceQuality, type SpeechOptions, type Voice } from 'expo-speech';
import * as SecureStore from 'expo-secure-store';
import { zh } from '../locales/zh-CN';
import {
  resolveQwenVoiceForDialect,
  qwenVoicesForDialect,
  type QwenTtsVoice,
} from '@xzz/shared';
import { getDashScopeApiKey } from './dashscopeKey';
import { isQwenPlaying, playQwenSpeech, stopQwenPlayback } from './qwenTtsPlayer';

/** 旧版共用音色键，迁移后删除 */
const LEGACY_VOICE_ID_KEY = 'xzz_tts_voice_id';

const voiceStorageKey = (d: TtsDialect) => `xzz_tts_voice_${d}`;

let legacyVoiceMigrated = false;

export type ChineseVoice = Voice;
export { getStoredDialect, setStoredDialect, type TtsDialect } from './ttsDialect';
import { getStoredDialect, type TtsDialect } from './ttsDialect';

/** Qwen3-TTS（阿里云百炼） */
export const TTS_ENGINE_QWEN = 'Qwen3-TTS';
/** 系统 TTS（expo-speech / iOS·Android 自带朗读引擎） */
export const TTS_ENGINE_SYSTEM = '系统朗读';

export function dialectLanguage(dialect: TtsDialect): string {
  return dialect === 'cantonese' ? 'zh-HK' : 'zh-CN';
}

export function dialectLabel(dialect: TtsDialect): string {
  return dialect === 'cantonese' ? '粤语' : '普通话';
}

export function isCantoneseVoice(v: Voice): boolean {
  const lang = v.language.toLowerCase().replace('_', '-');
  const name = v.name.toLowerCase();
  if (lang.startsWith('zh-hk') || lang.includes('yue')) return true;
  if (
    name.includes('cantonese') ||
    name.includes('粤语') ||
    name.includes('廣東') ||
    name.includes('广东') ||
    name.includes('香港')
  ) {
    return true;
  }
  return false;
}

export function isMandarinVoice(v: Voice): boolean {
  const lang = v.language.toLowerCase();
  if (!lang.startsWith('zh')) return false;
  return !isCantoneseVoice(v);
}

function sortVoices(voices: ChineseVoice[]): ChineseVoice[] {
  return [...voices].sort((a, b) => {
    const aEnhanced = a.quality === VoiceQuality.Enhanced;
    const bEnhanced = b.quality === VoiceQuality.Enhanced;
    if (aEnhanced !== bEnhanced) return aEnhanced ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh');
  });
}

async function migrateLegacyVoiceIfNeeded(): Promise<void> {
  if (legacyVoiceMigrated) return;
  legacyVoiceMigrated = true;
  try {
    const legacy = await SecureStore.getItemAsync(LEGACY_VOICE_ID_KEY);
    if (!legacy?.trim()) return;
    const dialect = await getStoredDialect();
    const resolved = resolveQwenVoiceForDialect(dialect, legacy);
    if (resolved === legacy) {
      await SecureStore.setItemAsync(voiceStorageKey(dialect), legacy);
    }
    await SecureStore.deleteItemAsync(LEGACY_VOICE_ID_KEY);
  } catch {
    // ignore
  }
}

export async function hasQwenTts(): Promise<boolean> {
  return Boolean(await getDashScopeApiKey());
}

/** 当前朗读引擎名称（用于设置页展示） */
export async function getTtsEngineName(dialect?: TtsDialect): Promise<string> {
  void dialect;
  if (await hasQwenTts()) return TTS_ENGINE_QWEN;
  return TTS_ENGINE_SYSTEM;
}

export type TtsVoiceOption =
  | { engine: 'qwen'; id: string; label: string }
  | { engine: 'system'; voice: ChineseVoice };

function qwenVoiceToOption(v: QwenTtsVoice): TtsVoiceOption {
  return { engine: 'qwen', id: v.id, label: v.label };
}

/** 列出当前方言下可选的朗读声音 */
export async function listVoicesForDialect(dialect: TtsDialect): Promise<TtsVoiceOption[]> {
  if (await hasQwenTts()) {
    return qwenVoicesForDialect(dialect).map(qwenVoiceToOption);
  }
  const all = await Speech.getAvailableVoicesAsync();
  const filtered = all.filter(dialect === 'cantonese' ? isCantoneseVoice : isMandarinVoice);
  return sortVoices(filtered).map((voice) => ({ engine: 'system', voice }));
}

/** @deprecated 使用 listVoicesForDialect */
export async function listChineseVoices(): Promise<ChineseVoice[]> {
  const all = await Speech.getAvailableVoicesAsync();
  return sortVoices(all.filter(isMandarinVoice));
}

/** 普通话 / 粤语各自记住音色，互不覆盖 */
export async function getStoredVoiceId(dialect?: TtsDialect): Promise<string | null> {
  await migrateLegacyVoiceIfNeeded();
  const d = dialect ?? (await getStoredDialect());
  try {
    return await SecureStore.getItemAsync(voiceStorageKey(d));
  } catch {
    return null;
  }
}

export async function setStoredVoiceId(
  dialect: TtsDialect,
  voiceId: string | null,
): Promise<void> {
  const key = voiceStorageKey(dialect);
  if (voiceId) {
    await SecureStore.setItemAsync(key, voiceId);
  } else {
    await SecureStore.deleteItemAsync(key);
  }
}

export async function resolveQwenVoiceId(
  dialect?: TtsDialect,
  voiceOverride?: string | null,
): Promise<string> {
  const d = dialect ?? (await getStoredDialect());
  const stored = await getStoredVoiceId(d);
  const candidate = voiceOverride != null && voiceOverride !== '' ? voiceOverride : stored;
  return resolveQwenVoiceForDialect(d, candidate);
}

export async function resolveVoiceId(dialect?: TtsDialect): Promise<string | undefined> {
  const d = dialect ?? (await getStoredDialect());
  if (await hasQwenTts()) {
    return resolveQwenVoiceId(d);
  }
  const voices = await listVoicesForDialect(d);
  const systemVoices = voices.filter(
    (v): v is Extract<TtsVoiceOption, { engine: 'system' }> => v.engine === 'system',
  );
  const stored = await getStoredVoiceId(d);
  if (stored && systemVoices.some((v) => v.voice.identifier === stored)) {
    return stored;
  }
  const enhanced = systemVoices.find((v) => v.voice.quality === VoiceQuality.Enhanced);
  return (enhanced ?? systemVoices[0])?.voice.identifier;
}

export function voiceLabel(voice: ChineseVoice): string {
  const tag = voice.quality === VoiceQuality.Enhanced ? ' · 增强' : '';
  return `${voice.name}${tag}`;
}

export function ttsVoiceOptionLabel(option: TtsVoiceOption): string {
  return option.engine === 'qwen' ? option.label : voiceLabel(option.voice);
}

export function ttsVoiceOptionId(option: TtsVoiceOption): string {
  return option.engine === 'qwen' ? option.id : option.voice.identifier;
}

function alertTtsFailure(e: unknown): void {
  const err = e as Error & { hint?: string; code?: string };
  const lines = [err.message, err.hint].filter(Boolean);
  if (err.code === 'DASHSCOPE_KEY_MISSING') {
    lines.push(zh.me.dashscopeNotConfigured);
  }
  if (lines.length === 0 || lines[0]?.includes('连不上小助手服务')) {
    lines.push('请确认本机已运行：npm run dev:api');
  }
  appAlert('朗读没成功', lines.join('\n'));
}

async function speakWithSystem(
  text: string,
  callbacks?: Pick<SpeechOptions, 'onDone' | 'onStopped' | 'onError' | 'onStart'>,
  options?: { voiceId?: string; dialect?: TtsDialect },
): Promise<void> {
  const dialect = options?.dialect ?? (await getStoredDialect());
  const language = dialectLanguage(dialect);
  const override =
    options?.voiceId != null && options.voiceId !== ''
      ? options.voiceId
      : undefined;
  const voice = override ?? (await resolveVoiceId(dialect));

  Speech.speak(text, {
    language,
    voice,
    rate: dialect === 'cantonese' ? 0.9 : 0.92,
    pitch: 1.0,
    ...callbacks,
  });
}

export async function speakText(
  text: string,
  callbacks?: Pick<SpeechOptions, 'onDone' | 'onStopped' | 'onError' | 'onStart'>,
  options?: { voiceId?: string; dialect?: TtsDialect },
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  const dialect = options?.dialect ?? (await getStoredDialect());
  try {
    if (await hasQwenTts()) {
      const voice = await resolveQwenVoiceId(dialect, options?.voiceId);
      await playQwenSpeech(trimmed, voice, dialect, callbacks);
      return;
    }

    await speakWithSystem(trimmed, callbacks, { ...options, dialect });
  } catch (e) {
    callbacks?.onError?.(e as Error);
    alertTtsFailure(e);
    throw e;
  }
}

/** 兼容旧调用 */
export async function speakChinese(
  text: string,
  callbacks?: Pick<SpeechOptions, 'onDone' | 'onStopped' | 'onError' | 'onStart'>,
  voiceIdOverride?: string,
): Promise<void> {
  await speakText(text, callbacks, { voiceId: voiceIdOverride });
}

export async function stopSpeaking(): Promise<void> {
  await stopQwenPlayback();
  await Speech.stop();
}

export async function isSpeaking(): Promise<boolean> {
  if (isQwenPlaying()) return true;
  return Speech.isSpeakingAsync();
}
