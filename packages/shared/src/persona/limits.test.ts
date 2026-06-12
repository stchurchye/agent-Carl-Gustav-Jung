import { describe, expect, it } from 'vitest';
import { personaAssistantDisplayName } from './limits';

describe('personaAssistantDisplayName 兜底名', () => {
  it('未设置助手名时兜底为 Bow Wow(与 mobile brand.ts 的 ASSISTANT_FALLBACK_NAME 一致)', () => {
    expect(personaAssistantDisplayName(undefined)).toBe('Bow Wow');
    expect(personaAssistantDisplayName({})).toBe('Bow Wow');
    expect(personaAssistantDisplayName({ identity: { assistantName: '  ' } })).toBe('Bow Wow');
  });

  it('用户起过名则用用户起的名', () => {
    expect(personaAssistantDisplayName({ identity: { assistantName: '旺财' } })).toBe('旺财');
  });

  it('显式 fallback 优先于内置兜底', () => {
    expect(personaAssistantDisplayName(undefined, '小白')).toBe('小白');
  });
});
