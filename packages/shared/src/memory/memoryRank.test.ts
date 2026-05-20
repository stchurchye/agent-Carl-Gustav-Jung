import { describe, expect, it } from 'vitest';
import { rankMemoryFragments, trimMemoryLines } from './memoryRank.js';

describe('trimMemoryLines', () => {
  it('stops adding lines when char budget exceeded', () => {
    const lines = [
      { title: 'A', content: 'x'.repeat(100) },
      { title: 'B', content: 'y'.repeat(100) },
      { title: 'C', content: 'z'.repeat(100) },
    ];
    const trimmed = trimMemoryLines(lines, 150);
    expect(trimmed.length).toBeGreaterThanOrEqual(1);
    expect(trimmed.length).toBeLessThan(lines.length);
  });

  it('keeps first line even if it alone exceeds budget', () => {
    const lines = [{ title: '长', content: 'x'.repeat(500) }];
    expect(trimMemoryLines(lines, 50)).toHaveLength(1);
  });
});

describe('rankMemoryFragments', () => {
  const base = [
    {
      title: '天气',
      content: '今天下雨',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      title: '语气',
      content: '用户希望说话温柔',
      updatedAt: '2026-01-02T00:00:00.000Z',
    },
  ];

  it('sorts by updatedAt when query empty', () => {
    const ranked = rankMemoryFragments(base, undefined);
    expect(ranked[0]?.title).toBe('语气');
  });

  it('boosts fragments matching query', () => {
    const ranked = rankMemoryFragments(base, '说话温柔');
    expect(ranked[0]?.title).toBe('语气');
  });
});
