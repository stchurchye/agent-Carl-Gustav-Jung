import * as SecureStore from 'expo-secure-store';

const KEY = 'studio_search_history_v1';
const MAX_ITEMS = 24;

export async function getStudioSearchHistory(): Promise<string[]> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  } catch {
    return [];
  }
}

export async function addStudioSearchHistory(query: string): Promise<void> {
  const q = query.trim();
  if (!q) return;
  const prev = await getStudioSearchHistory();
  const next = [q, ...prev.filter((x) => x !== q)].slice(0, MAX_ITEMS);
  await SecureStore.setItemAsync(KEY, JSON.stringify(next));
}

export async function clearStudioSearchHistory(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
