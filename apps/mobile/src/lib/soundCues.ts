import * as SecureStore from 'expo-secure-store';

/**
 * 提示音(取代原 TTS 朗读):
 * - 私聊/群聊里「狗」出结果 → 汪一声(按说话那只狗的身份哈希取一种,与性格无关)
 * - 群聊里真人成员说话 → 叮一下
 * 由聊天框的语音开关统一控制(持久化于本机)。
 */

// 6 段合成狗叫(scripts/generate-bark-sounds.mjs 生成);新增/替换后同步这里
/* eslint-disable @typescript-eslint/no-require-imports */
const BARKS = [
  require('../../assets/sounds/bark-0.wav'),
  require('../../assets/sounds/bark-1.wav'),
  require('../../assets/sounds/bark-2.wav'),
  require('../../assets/sounds/bark-3.wav'),
  require('../../assets/sounds/bark-4.wav'),
  require('../../assets/sounds/bark-5.wav'),
];
const DING = require('../../assets/sounds/assistant-ready.wav');
/* eslint-enable @typescript-eslint/no-require-imports */

const ENABLED_KEY = 'xzz_sound_cues_enabled';

type ExpoAv = typeof import('expo-av');
let currentSound: import('expo-av').Audio.Sound | null = null;

// 同步缓存:play 时不能 await(要尽快出声),开关值先读缓存,启动时 loadCuesEnabled 拉一次
let enabledCache = true;

export async function loadCuesEnabled(): Promise<boolean> {
  try {
    const raw = await SecureStore.getItemAsync(ENABLED_KEY);
    if (raw === '0') enabledCache = false;
    else if (raw === '1') enabledCache = true;
  } catch {
    // 读不到就用默认(开)
  }
  return enabledCache;
}

export function getCuesEnabled(): boolean {
  return enabledCache;
}

export async function setCuesEnabled(on: boolean): Promise<void> {
  enabledCache = on;
  if (!on) void stopCues();
  try {
    await SecureStore.setItemAsync(ENABLED_KEY, on ? '1' : '0');
  } catch {
    // 持久化失败不影响本次会话内的开关状态
  }
}

/** 稳定字符串 → [0, mod) 索引(djb2);与性格无关,仅取决于狗的身份键 */
function hashIndex(key: string, mod: number): number {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) | 0;
  return Math.abs(h) % mod;
}

async function getAv(): Promise<ExpoAv | null> {
  try {
    return await import('expo-av');
  } catch {
    return null;
  }
}

function playAsset(mod: number | object, volume: number): void {
  void (async () => {
    const av = await getAv();
    if (!av) return;
    try {
      await av.Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false });
      if (currentSound) {
        try {
          await currentSound.unloadAsync();
        } catch {
          // ignore
        }
        currentSound = null;
      }
      const { sound } = await av.Audio.Sound.createAsync(mod as number, {
        shouldPlay: true,
        volume,
      });
      currentSound = sound;
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          void sound.unloadAsync();
          if (currentSound === sound) currentSound = null;
        }
      });
    } catch {
      // ignore(静音环境/无音频设备等)
    }
  })();
}

/** 狗出结果:按狗身份(dogKey,如 user.id / 成员 id)选一种狗叫;与性格无关 */
export function playReplyBark(dogKey: string): void {
  if (!enabledCache) return;
  playAsset(BARKS[hashIndex(dogKey || 'bowwow', BARKS.length)], 0.8);
}

/** 群聊真人成员说话:叮一下 */
export function playMemberDing(): void {
  if (!enabledCache) return;
  playAsset(DING, 0.6);
}

export async function stopCues(): Promise<void> {
  if (!currentSound) return;
  try {
    await currentSound.stopAsync();
    await currentSound.unloadAsync();
  } catch {
    // ignore
  }
  currentSound = null;
}

// 模块加载即水合一次开关,任何入口(私聊/群聊/冷启动直达)都尊重持久化偏好,
// 不依赖某个屏记得调 loadCuesEnabled。屏内仍可再调以同步自己的开关 UI 状态。
void loadCuesEnabled();
