import type { SpeechOptions } from 'expo-speech';
import {
  QWEN_TTS_MAX_CHARS,
  resolveQwenVoiceForDialect,
  type QwenTtsDialect,
} from '@xzz/shared';
import { api } from './api';
import { clientLog } from './clientLog';
import { deleteFileQuietly, writeBase64ToCacheFile } from './fsLegacy';

type Callbacks = Pick<SpeechOptions, 'onDone' | 'onStopped' | 'onError' | 'onStart'>;

type ExpoAv = typeof import('expo-av');
type Sound = InstanceType<ExpoAv['Audio']['Sound']>;

let avModule: ExpoAv | null = null;
let avLoadError: Error | null = null;
let currentSound: Sound | null = null;
let aborted = false;
let playing = false;

async function getAv(): Promise<ExpoAv> {
  if (avModule) return avModule;
  if (avLoadError) throw avLoadError;
  try {
    avModule = await import('expo-av');
    return avModule;
  } catch (e) {
    avLoadError =
      e instanceof Error
        ? e
        : new Error(
            '朗读播放需要重新编译 App（expo-av 未安装）。请在 apps/mobile 执行：npx pod-install && npm run ios:ipad',
          );
    throw avLoadError;
  }
}

/** 按句号/换行切分，单段不超过 Qwen3-TTS 上限 */
export function splitTextForQwenTts(text: string, maxLen = QWEN_TTS_MAX_CHARS - 20): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxLen) return [trimmed];

  const chunks: string[] = [];
  let rest = trimmed;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf('\n\n', maxLen);
    if (cut < maxLen * 0.4) cut = rest.lastIndexOf('\n', maxLen);
    if (cut < maxLen * 0.4) cut = rest.lastIndexOf('。', maxLen);
    if (cut < maxLen * 0.4) cut = rest.lastIndexOf('！', maxLen);
    if (cut < maxLen * 0.4) cut = rest.lastIndexOf('？', maxLen);
    if (cut < maxLen * 0.4) cut = rest.lastIndexOf('，', maxLen);
    if (cut < maxLen * 0.4) cut = rest.lastIndexOf('；', maxLen);
    if (cut < maxLen * 0.4) cut = maxLen;
    const piece = rest.slice(0, cut + 1).trim();
    if (piece) chunks.push(piece);
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

async function playLocalUri(uri: string, onStartOnce: () => void): Promise<void> {
  const { Audio } = await getAv();
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    shouldDuckAndroid: true,
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    let started = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new Error('播放超时，请稍后再试')));
    }, 180_000);

    void Audio.Sound.createAsync({ uri }, { shouldPlay: true }, (status) => {
      if (!status.isLoaded) return;
      if ('error' in status && status.error) {
        finish(() => reject(new Error(String(status.error))));
        return;
      }
      if (!started && status.isPlaying) {
        started = true;
        onStartOnce();
      }
      if (status.didJustFinish) {
        finish(resolve);
      }
    })
      .then(({ sound }) => {
        currentSound = sound;
      })
      .catch((e) => finish(() => reject(e instanceof Error ? e : new Error(String(e)))));
  });
}

export function isQwenPlaying(): boolean {
  return playing;
}

export async function stopQwenPlayback(): Promise<void> {
  aborted = true;
  playing = false;
  if (currentSound) {
    try {
      await currentSound.stopAsync();
      await currentSound.unloadAsync();
    } catch {
      // ignore
    }
    currentSound = null;
  }
}

export async function playQwenSpeech(
  text: string,
  voice: string,
  dialect: QwenTtsDialect,
  callbacks?: Callbacks,
): Promise<void> {
  await stopQwenPlayback();
  aborted = false;
  playing = true;

  const lockedDialect = dialect;
  const lockedVoice = resolveQwenVoiceForDialect(lockedDialect, voice);

  const chunks = splitTextForQwenTts(text);
  if (chunks.length === 0) {
    playing = false;
    throw new Error('没有可朗读的内容');
  }

  let onStartFired = false;
  const fireStart = () => {
    if (onStartFired) return;
    onStartFired = true;
    callbacks?.onStart?.();
  };

  try {
    for (const chunk of chunks) {
      if (aborted) break;

      clientLog('tts.synthesize.request', {
        chars: chunk.length,
        voice: lockedVoice,
        dialect: lockedDialect,
      });
      const res = await api.synthesizeSpeech({
        text: chunk,
        voice: lockedVoice,
        dialect: lockedDialect,
      });
      clientLog('tts.synthesize.ok', { hasBase64: Boolean(res.data.audioBase64?.length) });

      const localUri = await writeBase64ToCacheFile(res.data.audioBase64);
      try {
        await playLocalUri(localUri, fireStart);
      } finally {
        await deleteFileQuietly(localUri);
      }

      if (currentSound) {
        try {
          await currentSound.unloadAsync();
        } catch {
          // ignore
        }
        currentSound = null;
      }
    }

    if (aborted) {
      callbacks?.onStopped?.();
    } else {
      callbacks?.onDone?.();
    }
  } catch (e) {
    clientLog('tts.play.fail', { error: String(e) });
    if (!aborted) callbacks?.onError?.(e as Error);
    throw e;
  } finally {
    playing = false;
  }
}
