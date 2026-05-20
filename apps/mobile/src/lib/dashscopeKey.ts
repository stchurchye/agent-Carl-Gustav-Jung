import * as SecureStore from 'expo-secure-store';

const KEY = 'xzz_dashscope_api_key';

export async function getDashScopeApiKey(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY);
  } catch {
    return null;
  }
}

export async function setDashScopeApiKey(value: string): Promise<void> {
  await SecureStore.setItemAsync(KEY, value.trim());
}

export async function clearDashScopeApiKey(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}

export function maskDashScopeApiKey(key: string): string {
  if (key.length <= 8) return '已设置';
  return `${key.slice(0, 4)}····${key.slice(-4)}`;
}
