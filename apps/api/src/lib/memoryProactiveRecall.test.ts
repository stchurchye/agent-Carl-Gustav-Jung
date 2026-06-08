import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./integrations/magi.js', () => ({ searchAgentMemory: vi.fn() }));

import { searchAgentMemory } from './integrations/magi.js';
import { resolveProactiveRecall } from './memoryProactiveRecall.js';

const search = vi.mocked(searchAgentMemory);

const hit = (text: string, score: number) => ({
  id: 1,
  text,
  sourceRunId: null,
  sourceSessionId: null,
  topicId: null,
  createdAt: null,
  score,
});

describe('resolveProactiveRecall', () => {
  beforeEach(() => vi.clearAllMocks());

  it('formats a <proactive_memory> block from strong hits', async () => {
    search.mockResolvedValue([hit('用户在做编译器项目', 0.82), hit('用户喜欢 Rust', 0.7)]);
    const block = await resolveProactiveRecall('userA', '我的项目进度');
    expect(block).toContain('<proactive_memory>');
    expect(block).toContain('用户在做编译器项目');
    expect(block).toContain('用户喜欢 Rust');
    expect(block.trimEnd().endsWith('</proactive_memory>')).toBe(true);
  });

  it('filters out hits below the relevance threshold', async () => {
    search.mockResolvedValue([hit('强相关', 0.75), hit('弱相关噪声', 0.3)]);
    const block = await resolveProactiveRecall('userA', 'q');
    expect(block).toContain('强相关');
    expect(block).not.toContain('弱相关噪声');
  });

  it('returns empty when no hit clears the threshold', async () => {
    search.mockResolvedValue([hit('弱', 0.2)]);
    expect(await resolveProactiveRecall('userA', 'q')).toBe('');
  });

  it('blank query → empty, no search', async () => {
    expect(await resolveProactiveRecall('userA', '   ')).toBe('');
    expect(await resolveProactiveRecall('userA', undefined)).toBe('');
    expect(search).not.toHaveBeenCalled();
  });

  it('fail-open: search throws (MAGI down / timeout) → empty, never throws', async () => {
    search.mockRejectedValue(new Error('timeout'));
    expect(await resolveProactiveRecall('userA', 'q')).toBe('');
  });

  it('requests only top-3 (small pool, hot path)', async () => {
    search.mockResolvedValue([]);
    await resolveProactiveRecall('userA', 'q');
    expect(search).toHaveBeenCalledWith('userA', 'q', 3, expect.anything(), false);
  });
});
