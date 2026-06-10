import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../integrations/magi.js', () => ({
  searchAgentMemory: vi.fn(),
  magiSystemEnabled: vi.fn(() => true),
}));

import * as magi from '../../integrations/magi.js';
import { recallMemoryTool, registerRecallMemory } from '../tools/recallMemory.js';
import { toolRegistry } from '../toolRegistry.js';

const searchAgentMemory = vi.mocked(magi.searchAgentMemory);
const magiSystemEnabled = vi.mocked(magi.magiSystemEnabled);

const ctx = {
  runId: 'r',
  stepId: 's',
  ownerId: 'userA',
  channel: 'private' as const,
  signal: new AbortController().signal,
};

describe('recall_memory tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    magiSystemEnabled.mockReturnValue(true);
  });

  it('registers idempotently', () => {
    registerRecallMemory();
    registerRecallMemory();
    expect(toolRegistry.get('recall_memory')).toBeDefined();
  });

  it('returns hits from MAGI agent-memory search', async () => {
    searchAgentMemory.mockResolvedValue([
      {
        id: 1,
        text: '用户在做 X 项目',
        sourceRunId: null,
        sourceSessionId: null,
        topicId: null,
        createdAt: '2026-06-05T00:00:00+00:00',
        score: 0.91,
      },
    ]);
    const out = await recallMemoryTool.handler({ query: 'X 项目' }, ctx);
    expect(out.ok).toBe(true);
    // 输出形状匹配 'list' 摘要契约:results[].title
    expect(out.results.map((r) => r.title)).toContain('用户在做 X 项目');
  });

  it("output shape matches replyGen 'list' summarizer (results[].title)", async () => {
    searchAgentMemory.mockResolvedValue([
      {
        id: 7,
        text: '用户偏好简洁回答',
        sourceRunId: 'run-1',
        sourceSessionId: null,
        topicId: null,
        createdAt: '2026-06-05T00:00:00+00:00',
        score: 0.8,
      },
    ]);
    const out = await recallMemoryTool.handler({ query: 'x' }, ctx);
    // summarizeStepOutput('list') 取 output.results / .items + 每项 .title
    expect(Array.isArray(out.results)).toBe(true);
    expect(out.results[0].title).toBe('用户偏好简洁回答');
  });

  it('locks owner to ctx.ownerId (never cross-user/group-member)', async () => {
    searchAgentMemory.mockResolvedValue([]);
    await recallMemoryTool.handler({ query: 'x' }, ctx);
    expect(searchAgentMemory).toHaveBeenCalledWith('userA', 'x', 12, ctx.signal, false, undefined);
  });

  it('fail-open: MAGI disabled → empty results, no throw', async () => {
    magiSystemEnabled.mockReturnValue(false);
    searchAgentMemory.mockResolvedValue([]);
    const out = await recallMemoryTool.handler({ query: 'x' }, ctx);
    expect(out.enabled).toBe(false);
    expect(out.results).toEqual([]);
  });

  it('fail-open: search error → ok=false + empty, no throw', async () => {
    searchAgentMemory.mockRejectedValue(new Error('magi 503'));
    const out = await recallMemoryTool.handler({ query: 'x' }, ctx);
    expect(out.ok).toBe(false);
    expect(out.results).toEqual([]);
    expect(out.error).toMatch(/magi 503/);
  });

  it('AbortError re-thrown so runtime sees cancel', async () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    searchAgentMemory.mockRejectedValue(err);
    await expect(
      recallMemoryTool.handler({ query: 'x' }, ctx),
    ).rejects.toThrow(/aborted/);
  });
});

// ───────────── K6:来源渲染 / 真伪标 / 群聊双池 ─────────────

const findingHit = (id: number, score: number, over?: Record<string, unknown>) => ({
  id,
  text: '损失厌恶系数约 2.25',
  sourceRunId: 'run-9',
  sourceSessionId: null,
  topicId: null,
  createdAt: '2026-06-10T00:00:00+00:00',
  score,
  kind: 'finding' as const,
  sources: [{ url: 'https://doi.org/10.1/tk', title: 'Prospect Theory', year: 1992 }],
  truthStatus: 'unverified' as const,
  truthNote: null,
  counterSources: null,
  ...over,
});

describe('recall_memory · K6', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    magiSystemEnabled.mockReturnValue(true);
  });

  it('finding:title 短(claim),来源走结构化 sources 字段(review#15:避免 60 字截断丢 URL)', async () => {
    searchAgentMemory.mockResolvedValue([findingHit(9, 0.9)] as never);
    const out = await recallMemoryTool.handler({ query: '损失厌恶' }, ctx);
    expect(out.results[0]!.title).toBe('损失厌恶系数约 2.25');
    expect(out.results[0]!.sources).toEqual([
      { url: 'https://doi.org/10.1/tk', title: 'Prospect Theory', year: 1992 },
    ]);
  });

  it('refuted 条目 title 带【已证伪】前缀,反证走结构化字段', async () => {
    searchAgentMemory.mockResolvedValue([
      findingHit(9, 0.9, {
        truthStatus: 'refuted',
        truthNote: '系统综述未能复现',
        counterSources: [{ url: 'https://doi.org/10.1/pashler' }],
      }),
    ] as never);
    const out = await recallMemoryTool.handler({ query: '损失厌恶' }, ctx);
    expect(out.results[0]!.title).toMatch(/^【已证伪】/);
    expect(out.results[0]!.truthStatus).toBe('refuted');
    expect(out.results[0]!.truthNote).toBe('系统综述未能复现');
    expect(out.results[0]!.counterSources).toEqual([{ url: 'https://doi.org/10.1/pashler' }]);
  });

  it('disputed 条目带【有争议】前缀', async () => {
    searchAgentMemory.mockResolvedValue([
      findingHit(9, 0.9, { truthStatus: 'disputed' }),
    ] as never);
    const out = await recallMemoryTool.handler({ query: 'x' }, ctx);
    expect(out.results[0]!.title).toMatch(/^【有争议】/);
  });

  it('群聊 run:双池查询(个人 + group:{gid})按 score 归并去重', async () => {
    const groupCtx = { ...ctx, channel: 'group' as const, groupId: 'g1' };
    searchAgentMemory
      .mockResolvedValueOnce([findingHit(1, 0.7)] as never) // 个人池
      .mockResolvedValueOnce([
        findingHit(2, 0.9, { text: '群里查过的结论' }),
      ] as never); // 群池
    const out = await recallMemoryTool.handler({ query: 'x' }, groupCtx);
    expect(searchAgentMemory).toHaveBeenCalledTimes(2);
    expect(searchAgentMemory.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining(['userA', 'group:g1']),
    );
    // 群池 0.9 排在个人池 0.7 前
    expect(out.results[0]!.id).toBe(2);
    expect(out.results[1]!.id).toBe(1);
  });

  it('私聊 run:单池(不查任何群池)', async () => {
    searchAgentMemory.mockResolvedValue([] as never);
    await recallMemoryTool.handler({ query: 'x' }, ctx);
    expect(searchAgentMemory).toHaveBeenCalledTimes(1);
    expect(searchAgentMemory.mock.calls[0]![0]).toBe('userA');
  });
});
