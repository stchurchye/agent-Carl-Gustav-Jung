import { describe, expect, it } from 'vitest';
import {
  MEMORY_PROJECT_NOTE_CHAR_LIMIT,
  MEMORY_USER_PROFILE_CHAR_LIMIT,
  MEMORY_USER_SCOPE_CHAR_BUDGET,
} from './limits.js';

describe('memory limits (Hermes-aligned)', () => {
  it('matches Hermes USER.md / MEMORY.md caps', () => {
    expect(MEMORY_USER_PROFILE_CHAR_LIMIT).toBe(1375);
    expect(MEMORY_PROJECT_NOTE_CHAR_LIMIT).toBe(2200);
    expect(MEMORY_USER_SCOPE_CHAR_BUDGET).toBe(3575);
  });
});
