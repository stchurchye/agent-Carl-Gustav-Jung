import { describe, expect, it } from 'vitest';
import { matchOralIntentExamples, oralExamplesSuggestAction } from './oralExamples.js';

describe('oral intent examples', () => {
  it('matches colloquial persona style', () => {
    expect(matchOralIntentExamples('说话能不能别那么冲')).toContain('persona_style');
  });

  it('matches colloquial memory remember', () => {
    expect(matchOralIntentExamples('帮我记一下这个')).toContain('memory_remember');
  });

  it('does not match plain chat', () => {
    expect(oralExamplesSuggestAction('今天天气不错')).toBe(false);
  });
});
