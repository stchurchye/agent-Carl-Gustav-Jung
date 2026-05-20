import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * M1d Task 6：最简对称加密信封，存 per-user DeepSeek key 用。
 * - 密钥派生：SHA-256(env $AGENT_KEY_SECRET)，没配则 throw。
 * - 算法：AES-256-GCM；输出 base64(iv ‖ tag ‖ ciphertext)。
 * - 不打算抵御内网读 DB 的攻击者，只防 backup 文件外泄裸 key。
 */

function deriveKey(): Buffer {
  const secret = process.env.AGENT_KEY_SECRET;
  if (!secret || secret.trim().length < 16) {
    throw new Error('AGENT_KEY_SECRET missing or shorter than 16 chars');
  }
  return createHash('sha256').update(secret).digest();
}

export function isSecretBoxAvailable(): boolean {
  const s = process.env.AGENT_KEY_SECRET;
  return !!s && s.trim().length >= 16;
}

export function sealUserApiKey(plain: string): string {
  if (!plain) return '';
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function openUserApiKey(sealed: string): string {
  if (!sealed) return '';
  const key = deriveKey();
  const buf = Buffer.from(sealed, 'base64');
  if (buf.length < 28) throw new Error('sealed key too short');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}
