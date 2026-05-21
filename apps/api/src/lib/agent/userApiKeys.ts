/**
 * M2 Task 7A: helpers to seal/unseal the per-run user_api_keys_enc JSONB column.
 *
 * Shape (plain): { e2b?: string; fred?: string; jina?: string; ... }
 * Shape (sealed): same keys, values AES-256-GCM encrypted with secretBox.
 *
 * Unlike M1d's per-column approach (user_deepseek_key_enc / user_zenmux_key_enc),
 * this single JSONB column scales to N future per-service keys without DB migrations.
 */
import { isSecretBoxAvailable, sealUserApiKey, openUserApiKey } from './secretBox.js';

export type UserApiKeysPlain = Partial<Record<string, string>>;
export type UserApiKeysSealed = Partial<Record<string, string>>;

export function sealUserApiKeys(plain: UserApiKeysPlain): UserApiKeysSealed {
  if (!isSecretBoxAvailable()) return {};
  const out: UserApiKeysSealed = {};
  for (const [service, value] of Object.entries(plain)) {
    const trimmed = (value ?? '').trim();
    if (!trimmed) continue;
    out[service] = sealUserApiKey(trimmed);
  }
  return out;
}

export function unsealUserApiKey(
  sealed: UserApiKeysSealed | null | undefined,
  service: string,
): string | null {
  if (!sealed || !isSecretBoxAvailable()) return null;
  const blob = sealed[service];
  if (!blob) return null;
  try {
    return openUserApiKey(blob);
  } catch {
    return null;
  }
}
