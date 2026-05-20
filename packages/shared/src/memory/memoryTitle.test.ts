import { describe, expect, it } from 'vitest';
import { memoryTitleFromContent } from './memoryTitle.js';

describe('memoryTitleFromContent', () => {
  it('truncates long content with ellipsis', () => {
    const title = memoryTitleFromContent('这是一段很长的记忆内容需要截断', 10);
    expect([...title].length).toBeLessThanOrEqual(10);
    expect(title.endsWith('…')).toBe(true);
  });

  it('returns fallback for empty content', () => {
    expect(memoryTitleFromContent('   ')).toBe('记忆');
  });
});
