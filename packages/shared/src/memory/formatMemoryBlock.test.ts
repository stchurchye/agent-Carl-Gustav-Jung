import { describe, expect, it } from 'vitest';
import {
  formatMemoryContextBlock,
  formatMemoryContextSections,
} from './formatMemoryBlock.js';

describe('formatMemoryContextSections', () => {
  it('returns empty string when all sections empty', () => {
    expect(
      formatMemoryContextSections({
        userProfile: [],
        projectNotes: [],
        shortTerm: [],
      }),
    ).toBe('');
  });

  it('formats user profile and project notes with section headers', () => {
    const block = formatMemoryContextSections({
      userProfile: [{ title: '称呼', content: '叫我小王' }],
      projectNotes: [{ title: '技术栈', content: 'React Native + Hono' }],
      shortTerm: [{ title: '本轮', content: '正在改记忆模块' }],
    });
    expect(block).toContain('【关于你】');
    expect(block).toContain('- 称呼：叫我小王');
    expect(block).toContain('【项目与习惯】');
    expect(block).toContain('- 技术栈：React Native + Hono');
    expect(block).toContain('【当前会话/话题记忆】');
    expect(block).toContain('- 本轮：正在改记忆模块');
    expect(block.endsWith('\n\n')).toBe(true);
  });

  it('legacy formatMemoryContextBlock maps longTerm to userProfile only', () => {
    const block = formatMemoryContextBlock(
      [{ title: '偏好', content: '语气平和' }],
      [{ title: '临时', content: '先写测试' }],
    );
    expect(block).toContain('【关于你】');
    expect(block).toContain('- 偏好：语气平和');
    expect(block).toContain('【当前会话/话题记忆】');
    expect(block).not.toContain('【项目与习惯】');
  });
});
