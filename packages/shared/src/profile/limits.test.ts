import { describe, expect, it } from 'vitest';
import {
  PROFILE_DISPLAY_NAME_MAX,
  profileDisplayNameLength,
  validateProfileDisplayName,
} from './limits.js';

describe('validateProfileDisplayName', () => {
  it('accepts 1–20 code points', () => {
    expect(validateProfileDisplayName('小明')).toEqual({ ok: true, value: '小明' });
    expect(validateProfileDisplayName('a'.repeat(PROFILE_DISPLAY_NAME_MAX))).toEqual({
      ok: true,
      value: 'a'.repeat(PROFILE_DISPLAY_NAME_MAX),
    });
  });

  it('rejects empty and too long', () => {
    expect(validateProfileDisplayName('   ')).toEqual({ ok: false, error: 'empty' });
    expect(validateProfileDisplayName('a'.repeat(PROFILE_DISPLAY_NAME_MAX + 1))).toEqual({
      ok: false,
      error: 'too_long',
    });
  });

  it('counts emoji as one character', () => {
    expect(profileDisplayNameLength('😀')).toBe(1);
  });
});
