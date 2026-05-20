import * as SecureStore from 'expo-secure-store';

const KEY = 'xzz_zenmux_api_key';

export async function getZenMuxApiKey(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY);
  } catch {
    return null;
  }
}

export async function setZenMuxApiKey(value: string): Promise<void> {
  await SecureStore.setItemAsync(KEY, value.trim());
}

export async function clearZenMuxApiKey(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}

export function maskZenMuxApiKey(key: string): string {
  if (key.length <= 8) return '已设置';
  return `${key.slice(0, 4)}····${key.slice(-4)}`;
}
