import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isSecretBoxAvailable, openUserApiKey, sealUserApiKey } from '../secretBox.js';

describe('secretBox (M1d Task 6)', () => {
  const ORIGINAL = process.env.AGENT_KEY_SECRET;
  beforeEach(() => {
    process.env.AGENT_KEY_SECRET = 'test-secret-must-be-16+chars-long';
  });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.AGENT_KEY_SECRET;
    else process.env.AGENT_KEY_SECRET = ORIGINAL;
  });

  it('isSecretBoxAvailable reflects env presence', () => {
    expect(isSecretBoxAvailable()).toBe(true);
    delete process.env.AGENT_KEY_SECRET;
    expect(isSecretBoxAvailable()).toBe(false);
    process.env.AGENT_KEY_SECRET = 'short';
    expect(isSecretBoxAvailable()).toBe(false);
  });

  it('seal then open round-trips', () => {
    const plain = 'sk-deepseek-FAKE-1234567890';
    const sealed = sealUserApiKey(plain);
    expect(sealed).not.toBe(plain);
    expect(sealed.length).toBeGreaterThan(plain.length);
    expect(openUserApiKey(sealed)).toBe(plain);
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
});
