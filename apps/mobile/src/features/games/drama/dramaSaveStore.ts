/** 犬朝后宫存档的本地持久化:走项目统一的 expo-secure-store(失败静默,不崩游戏)。 */
import * as SecureStore from 'expo-secure-store';

const KEY = 'drama_save_v1';

export async function loadDramaSaveRaw(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY);
  } catch {
    return null;
  }
}

export async function saveDramaRaw(raw: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, raw);
  } catch {
    /* 存储不可用 → 静默,纯内存继续 */
  }
}

export async function clearDramaSave(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    /* ignore */
  }
}
