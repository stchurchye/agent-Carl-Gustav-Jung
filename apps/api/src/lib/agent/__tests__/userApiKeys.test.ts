import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  sealUserApiKeys,
  unsealUserApiKey,
  type UserApiKeysPlain,
} from '../userApiKeys.js';

describe('user_api_keys_enc helpers', () => {
  const ENV_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  beforeAll(() => {
    process.env.AGENT_KEY_SECRET = ENV_KEY;
  });
  afterAll(() => {
    delete process.env.AGENT_KEY_SECRET;
  });

  it('seal + unseal roundtrip per service', () => {
    const plain: UserApiKeysPlain = { e2b: 'sk-e2b-xxx', fred: 'fred-yyy' };
    const sealed = sealUserApiKeys(plain);
    expect(typeof sealed.e2b).toBe('string');
    expect(sealed.e2b).not.toBe('sk-e2b-xxx');
    expect(unsealUserApiKey(sealed, 'e2b')).toBe('sk-e2b-xxx');
    expect(unsealUserApiKey(sealed, 'fred')).toBe('fred-yyy');
    expect(unsealUserApiKey(sealed, 'unknown')).toBeNull();
  });

  it('returns empty when AGENT_KEY_SECRET missing', () => {
    const oldEnv = process.env.AGENT_KEY_SECRET;
    delete process.env.AGENT_KEY_SECRET;
    const sealed = sealUserApiKeys({ e2b: 'x' });
    expect(sealed).toEqual({});
    process.env.AGENT_KEY_SECRET = oldEnv;
  });

  it('drops empty values', () => {
    const sealed = sealUserApiKeys({ e2b: 'x', fred: '   ', jina: '' });
    expect(sealed.e2b).toBeDefined();
    expect(sealed.fred).toBeUndefined();
    expect(sealed.jina).toBeUndefined();
  });
});
