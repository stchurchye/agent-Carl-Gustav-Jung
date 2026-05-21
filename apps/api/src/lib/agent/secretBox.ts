import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * Per-user DeepSeek key 的对称加密信封。
 *
 * 历史：
 * - M1d Task 6 (v0)：base64(iv(12B) ‖ tag(16B) ‖ ct)，单 secret = env $AGENT_KEY_SECRET
 * - M1e Task 9 (v1)：base64(versionTag(1B=0x01) ‖ iv(12B) ‖ tag(16B) ‖ ct)，
 *   支持 AGENT_KEY_SECRET_PREV 做 secret 轮换；写入永远 v1，读取 try-v1 → fallback v0。
 *
 * 算法：AES-256-GCM；密钥派生：SHA-256(secret)。
 * 不打算抵御内网读 DB 的攻击者，只防 backup 文件外泄裸 key。
 *
 * Rotation 流程（README §AGENT_KEY_SECRET 也有）：
 *   1. cp $AGENT_KEY_SECRET → $AGENT_KEY_SECRET_PREV
 *   2. 生成新 secret 写 $AGENT_KEY_SECRET
 *   3. 重启 API；老 sealed key 走 PREV 解开，新写入走新 SECRET（v1 格式）
 *   4. 一段时间后（确认所有用户都 re-save 过 key），删 $AGENT_KEY_SECRET_PREV
 */

const VERSION_TAG_V1 = 0x01;
const IV_LEN = 12;
const TAG_LEN = 16;
const MIN_LEN_V0 = IV_LEN + TAG_LEN + 1; // 29B
const MIN_LEN_V1 = 1 + MIN_LEN_V0; // 30B
const SECRET_MIN_LEN = 16;

function deriveKeyFromSecret(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

function activeSecret(): string {
  const secret = process.env.AGENT_KEY_SECRET;
  if (!secret || secret.trim().length < SECRET_MIN_LEN) {
    throw new Error(
      `AGENT_KEY_SECRET missing or shorter than ${SECRET_MIN_LEN} chars`,
    );
  }
  return secret;
}

/**
 * 候选 secret 列表（按尝试顺序）：当前 > PREV（如果配了的话）。
 * @internal exported for tests.
 */
export function _candidateSecrets(): string[] {
  const result: string[] = [];
  const cur = process.env.AGENT_KEY_SECRET;
  if (cur && cur.trim().length >= SECRET_MIN_LEN) result.push(cur);
  const prev = process.env.AGENT_KEY_SECRET_PREV;
  if (prev && prev.trim().length >= SECRET_MIN_LEN) result.push(prev);
  return result;
}

export function isSecretBoxAvailable(): boolean {
  const s = process.env.AGENT_KEY_SECRET;
  return !!s && s.trim().length >= SECRET_MIN_LEN;
}

/**
 * Seal 永远走 v1 格式（带 versionTag）。空字符串提前返回 ''（沿用 M1d 行为）。
 */
export function sealUserApiKey(plain: string): string {
  if (!plain) return '';
  const key = deriveKeyFromSecret(activeSecret());
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const tagByte = Buffer.from([VERSION_TAG_V1]);
  return Buffer.concat([tagByte, iv, tag, ct]).toString('base64');
}

/**
 * 内部：用给定 secret 尝试按 v0 / v1 解开 buf。命中 ok，失败 throw。
 */
function tryOpenV1(buf: Buffer, secret: string): string {
  if (buf.length < MIN_LEN_V1) throw new Error('v1 buf too short');
  if (buf[0] !== VERSION_TAG_V1) throw new Error('v1 tag mismatch');
  const key = deriveKeyFromSecret(secret);
  const iv = buf.subarray(1, 1 + IV_LEN);
  const tag = buf.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
  const ct = buf.subarray(1 + IV_LEN + TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

function tryOpenV0(buf: Buffer, secret: string): string {
  if (buf.length < MIN_LEN_V0) throw new Error('v0 buf too short');
  const key = deriveKeyFromSecret(secret);
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

/**
 * Open dispatch：对每个候选 secret，先 try v1，失败 try v0；任一组合命中即返回。
 * 全部失败抛 Error，由 caller (resolveEffectiveApiKey) catch 后 emit
 * USER_KEY_DECRYPT_FAILED notice。
 */
export function openUserApiKey(sealed: string): string {
  if (!sealed) return '';
  const buf = Buffer.from(sealed, 'base64');
  if (buf.length < MIN_LEN_V0) throw new Error('sealed key too short');
  const secrets = _candidateSecrets();
  if (secrets.length === 0) {
    throw new Error('no usable AGENT_KEY_SECRET configured');
  }
  const errs: string[] = [];
  for (const secret of secrets) {
    try {
      return tryOpenV1(buf, secret);
    } catch (e) {
      errs.push(`v1+${secretLabel(secret)}: ${(e as Error).message}`);
    }
    try {
      return tryOpenV0(buf, secret);
    } catch (e) {
      errs.push(`v0+${secretLabel(secret)}: ${(e as Error).message}`);
    }
  }
  throw new Error(`secretBox open failed: ${errs.join(' | ')}`);
}

function secretLabel(secret: string): string {
  // 不暴露 secret 内容；用是否等于 PREV 当标识。
  const prev = process.env.AGENT_KEY_SECRET_PREV;
  return secret === prev ? 'PREV' : 'CURRENT';
}
