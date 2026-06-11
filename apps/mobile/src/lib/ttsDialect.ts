import * as SecureStore from 'expo-secure-store';

/**
 * 方言偏好的叶子模块:api.ts(请求头)与 tts.ts(选音色)都要读,
 * 独立成叶避免 api → tts → qwenTtsPlayer → api 的 require 环。
 */
const DIALECT_KEY = 'xzz_tts_dialect';

export type TtsDialect = 'mandarin' | 'cantonese';

export async function getStoredDialect(): Promise<TtsDialect> {
  return 'mandarin';
}

export async function setStoredDialect(_dialect: TtsDialect): Promise<void> {
  await SecureStore.setItemAsync(DIALECT_KEY, 'mandarin');
}
