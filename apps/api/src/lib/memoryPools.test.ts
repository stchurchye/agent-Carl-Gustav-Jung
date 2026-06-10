import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./integrations/magi.js', () => ({
  searchAgentMemory: vi.fn(async () => []),
}));

import { searchAgentMemory } from './integrations/magi.js';
import { searchMemoryPools, renderMemoryHit } from './memoryPools.js';

const search = vi.mocked(searchAgentMemory);

const hit = (id: number, score: number, over?: Record<string, unknown>) => ({
  id,
  text: '损失厌恶系数约 2.25',
  sourceRunId: null,
  sourceSessionId: null,
  topicId: null,
  createdAt: '2026-06-10T00:00:00+00:00',
  score,
  kind: 'finding' as const,
  sources: [{ url: 'https://doi.org/10.1/tk', title: 'PT', year: 1992 }],
  truthStatus: 'unverified' as const,
  truthNote: null,
  counterSources: null,
  ...over,
});

describe('searchMemoryPools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    search.mockResolvedValue([]);
  });

  it('私聊:单池(个人),kinds 透传', async () => {
    await searchMemoryPools('userA', 'private', null, 'q', { topK: 12, kinds: ['finding'] });
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0]![0]).toBe('userA');
    expect(search.mock.calls[0]![5]).toEqual(['finding']);
  });

  it('群聊:双池(个人 findings-only + group),个人池强制 findings 不泄漏 fact', async () => {
    await searchMemoryPools('userA', 'group', 'g1', 'q', { topK: 12 });
    expect(search).toHaveBeenCalledTimes(2);
    const owners = search.mock.calls.map((c) => c[0]);
    expect(owners).toEqual(expect.arrayContaining(['userA', 'group:g1']));
    // 关键隐私:即便 caller 没指定 kinds,群聊个人池也被强制为 findings-only
    for (const call of search.mock.calls) expect(call[5]).toEqual(['finding']);
  });

  it('跨池同一结论(不同 id)按 kind:text 去重(id 去重会漏)', async () => {
    search
      .mockResolvedValueOnce([hit(1, 0.7)] as never) // 个人
      .mockResolvedValueOnce([hit(2, 0.9)] as never); // 群池,同 text 不同 id
    const out = await searchMemoryPools('userA', 'group', 'g1', 'q', { topK: 12 });
    expect(out).toHaveLength(1); // 去重成功(id 去重则会是 2)
    expect(out[0]!.id).toBe(2); // 高分留存
  });

  it('minScore 过滤 + score 降序', async () => {
    search.mockResolvedValue([
      hit(1, 0.4, { text: 'A' }),
      hit(2, 0.8, { text: 'B' }),
    ] as never);
    const out = await searchMemoryPools('userA', 'private', null, 'q', { topK: 12, minScore: 0.6 });
    expect(out.map((h) => h.id)).toEqual([2]);
  });
});

describe('renderMemoryHit', () => {
  it('finding 带来源行', () => {
    expect(renderMemoryHit(hit(1, 0.9))).toBe(
      '损失厌恶系数约 2.25 —— 来源: PT (1992) https://doi.org/10.1/tk',
    );
  });

  it('refuted + withCounterSources:【已证伪】+ note + 反证 url', () => {
    const s = renderMemoryHit(
      hit(1, 0.9, {
        truthStatus: 'refuted',
        truthNote: '未能复现',
        counterSources: [{ url: 'https://x.com/c' }],
      }),
      { withCounterSources: true },
    );
    expect(s).toMatch(/^【已证伪】/);
    expect(s).toContain('未能复现');
    expect(s).toContain('https://x.com/c');
  });

  it('withDate:带记录日期', () => {
    expect(renderMemoryHit(hit(1, 0.9), { withDate: true })).toContain('[记录于 2026-06-10]');
  });
});
