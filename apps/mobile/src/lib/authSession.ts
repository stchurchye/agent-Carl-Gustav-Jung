import * as SecureStore from 'expo-secure-store';
import type { User } from '@xzz/shared';

const TOKEN_KEY = 'xzz_access_token';
const USER_KEY = 'xzz_user';

export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function saveAuthSession(
  accessToken: string,
  user: User,
): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, accessToken);
  await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
}

export async function clearAuthSession(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(USER_KEY);
}

export async function getStoredUser(): Promise<User | null> {
  const raw = await SecureStore.getItemAsync(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}
