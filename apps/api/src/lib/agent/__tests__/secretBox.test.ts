import { createCipheriv, createHash, randomBytes } from 'crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isSecretBoxAvailable, openUserApiKey, sealUserApiKey } from '../secretBox.js';

/**
 * Helper：手动按 M1d v0 格式 seal —— 用于验证新代码能 fallback open 老数据。
 */
function manualSealV0(plain: string, secret: string): string {
  const key = createHash('sha256').update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

describe('secretBox v0/v1 + rotation (M1d Task 6 + M1e Task 9)', () => {
  const ORIGINAL_SECRET = process.env.AGENT_KEY_SECRET;
  const ORIGINAL_PREV = process.env.AGENT_KEY_SECRET_PREV;
  beforeEach(() => {
    process.env.AGENT_KEY_SECRET = 'test-secret-must-be-16+chars-long';
    delete process.env.AGENT_KEY_SECRET_PREV;
  });
  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.AGENT_KEY_SECRET;
    else process.env.AGENT_KEY_SECRET = ORIGINAL_SECRET;
    if (ORIGINAL_PREV === undefined) delete process.env.AGENT_KEY_SECRET_PREV;
    else process.env.AGENT_KEY_SECRET_PREV = ORIGINAL_PREV;
  });

  it('isSecretBoxAvailable reflects env presence', () => {
    expect(isSecretBoxAvailable()).toBe(true);
    delete process.env.AGENT_KEY_SECRET;
    expect(isSecretBoxAvailable()).toBe(false);
    process.env.AGENT_KEY_SECRET = 'short';
    expect(isSecretBoxAvailable()).toBe(false);
  });

  it('v1: seal then open round-trips', () => {
    const plain = 'sk-deepseek-FAKE-1234567890';
    const sealed = sealUserApiKey(plain);
    expect(sealed).not.toBe(plain);
    expect(sealed.length).toBeGreaterThan(plain.length);
    expect(openUserApiKey(sealed)).toBe(plain);
  });

  it('v1: first byte of payload is versionTag 0x01 (binary contract)', () => {
    const sealed = sealUserApiKey('zzz');
    const buf = Buffer.from(sealed, 'base64');
    expect(buf[0]).toBe(0x01);
  });

  it('two seals of same key differ (iv random)', () => {
    const a = sealUserApiKey('x');
    const b = sealUserApiKey('x');
    expect(a).not.toBe(b);
  });

  it('seal throws when env missing', () => {
    delete process.env.AGENT_KEY_SECRET;
    expect(() => sealUserApiKey('x')).toThrow(/AGENT_KEY_SECRET/);
  });

  it('open throws on tampered ciphertext', () => {
    const sealed = sealUserApiKey('y');
    const buf = Buffer.from(sealed, 'base64');
    buf[buf.length - 1] ^= 0xff;
    const tampered = buf.toString('base64');
    expect(() => openUserApiKey(tampered)).toThrow();
  });

  // ========== M1e Task 9 ==========

  it('M1e: secret rotation — seal with secret A → move A to PREV + set new → open still works', () => {
    process.env.AGENT_KEY_SECRET = 'secret-A-must-be-16+chars-long-x';
    const plain = 'sk-rotation-A';
    const sealed = sealUserApiKey(plain);
    // 轮换：A → PREV，写新 SECRET
    process.env.AGENT_KEY_SECRET_PREV = process.env.AGENT_KEY_SECRET;
    process.env.AGENT_KEY_SECRET = 'secret-B-fresh-16+chars-long-yyyy';
    expect(openUserApiKey(sealed)).toBe(plain);
  });

  it('M1e: no PREV set + secret changed → open fails', () => {
    process.env.AGENT_KEY_SECRET = 'secret-X-must-be-16+chars-long-x';
    const sealed = sealUserApiKey('confidential');
    process.env.AGENT_KEY_SECRET = 'secret-Y-totally-different-16+ch';
    delete process.env.AGENT_KEY_SECRET_PREV;
    expect(() => openUserApiKey(sealed)).toThrow(/secretBox open failed/);
  });

  it('M1e: v0 backward compat — manually-sealed M1d payload (no version tag) opens fine', () => {
    process.env.AGENT_KEY_SECRET = 'v0-compat-secret-must-be-16+lng-';
    const v0Sealed = manualSealV0('sk-m1d-legacy', process.env.AGENT_KEY_SECRET);
    expect(openUserApiKey(v0Sealed)).toBe('sk-m1d-legacy');
  });

  it('M1e: v0 + rotated secret — legacy sealed with A, A moved to PREV, new SECRET=B → open works', () => {
    process.env.AGENT_KEY_SECRET = 'v0-rot-secret-A-16+chars-aaaaaaa';
    const v0Sealed = manualSealV0('sk-rotated-legacy', process.env.AGENT_KEY_SECRET);
    process.env.AGENT_KEY_SECRET_PREV = process.env.AGENT_KEY_SECRET;
    process.env.AGENT_KEY_SECRET = 'v0-rot-secret-B-fresh-16+bbbbbbb';
    expect(openUserApiKey(v0Sealed)).toBe('sk-rotated-legacy');
  });
});
