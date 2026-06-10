import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../integrations/magi.js', () => ({
  searchAgentMemory: vi.fn(async () => []),
}));

import { searchAgentMemory } from '../../integrations/magi.js';
import { resolvePriorResearch } from '../priorResearch.js';

const search = vi.mocked(searchAgentMemory);

const hit = (id: number, score: number, over?: Record<string, unknown>) => ({
  id,
  text: '禀赋效应在二手市场实验中稳健',
  sourceRunId: 'run-7',
  sourceSessionId: null,
  topicId: null,
  createdAt: '2026-06-09T00:00:00+00:00',
  score,
  kind: 'finding' as const,
  sources: [{ url: 'https://doi.org/10.1/kkt', title: 'Endowment Effect', year: 1990 }],
  truthStatus: 'unverified' as const,
  truthNote: null,
  counterSources: null,
  ...over,
});

describe('resolvePriorResearch (K6:开局预取,站在之前研究的肩膀上)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    search.mockResolvedValue([]);
  });

  it('命中 ≥0.6 → 渲染 <prior_research> 块:结论+来源+记录时间+复核指引;只查 finding', async () => {
    search.mockResolvedValue([hit(1, 0.8)] as never);
    const block = await resolvePriorResearch('userA', '禀赋效应', 'private', null);
    expect(block).toContain('<prior_research>');
    expect(block).toContain('禀赋效应在二手市场实验中稳健');
    expect(block).toContain('https://doi.org/10.1/kkt');
    expect(block).toContain('2026-06-09');
    expect(block).toContain('复核');
    // 只要 finding(预取不要个人 facts 污染研究上下文)
    expect(search.mock.calls[0]![5]).toEqual(['finding']);
  });

  it('低分(<0.55)/空结果 → 空串零注入;0.56(实测同主题正命中区间)→ 注入', async () => {
    // K9c 活体标定:同主题 finding 的 bge 分实测 0.56-0.61,0.6 门挡正命中 → 0.55
    search.mockResolvedValue([hit(1, 0.5)] as never);
    expect(await resolvePriorResearch('userA', 'x', 'private', null)).toBe('');
    search.mockResolvedValue([]);
    expect(await resolvePriorResearch('userA', 'x', 'private', null)).toBe('');
    search.mockResolvedValue([hit(1, 0.56)] as never);
    expect(await resolvePriorResearch('userA', 'x', 'private', null)).toContain('<prior_research>');
  });

  it('refuted 条目带【已证伪】警示渲染(知道这条路是错的正是价值)', async () => {
    search.mockResolvedValue([
      hit(1, 0.8, { truthStatus: 'refuted', truthNote: '未能复现' }),
    ] as never);
    const block = await resolvePriorResearch('userA', 'x', 'private', null);
    expect(block).toContain('【已证伪】');
    expect(block).toContain('未能复现');
  });

  it('群聊 run → 双池(个人 + group:{gid})归并', async () => {
    search
      .mockResolvedValueOnce([hit(1, 0.7)] as never)
      .mockResolvedValueOnce([hit(2, 0.9, { text: '群里查过的' })] as never);
    const block = await resolvePriorResearch('userA', 'x', 'group', 'g1');
    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining(['userA', 'group:g1']),
    );
    expect(block.indexOf('群里查过的')).toBeLessThan(block.indexOf('禀赋效应')); // score 序
  });

  it('MAGI 抛错/超时 → 空串(fail-open,不阻塞规划)', async () => {
    search.mockRejectedValue(new Error('magi down'));
    expect(await resolvePriorResearch('userA', 'x', 'private', null)).toBe('');
  });

  it('空 query → 空串(不浪费调用)', async () => {
    expect(await resolvePriorResearch('userA', '   ', 'private', null)).toBe('');
    expect(search).not.toHaveBeenCalled();
  });
});
