import { describe, expect, it } from 'vitest';
import { EXECUTABLE_INTENT_KINDS, isExecutableIntentKind } from '../executable.js';

describe('EXECUTABLE_INTENT_KINDS', () => {
  it('includes agent_run', () => {
    expect(EXECUTABLE_INTENT_KINDS).toContain('agent_run');
    expect(isExecutableIntentKind('agent_run')).toBe(true);
  });
});
