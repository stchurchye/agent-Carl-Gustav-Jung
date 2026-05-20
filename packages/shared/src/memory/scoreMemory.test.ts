import { describe, expect, it } from 'vitest';
import { scoreMemoryRelevance } from './scoreMemory.js';

describe('scoreMemoryRelevance', () => {
  it('scores high when query matches content', () => {
    expect(
      scoreMemoryRelevance('说话温柔', '说话风格', '用户希望助手说话温柔一点'),
    ).toBeGreaterThan(0.3);
  });

  it('scores low for unrelated chat', () => {
    expect(scoreMemoryRelevance('今天天气', '项目', '使用 React Native')).toBeLessThan(0.4);
  });
});
