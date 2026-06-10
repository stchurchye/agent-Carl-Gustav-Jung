import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./memoryEpisodicDistill.js', () => ({ distillEpisodicMemories: vi.fn() }));
vi.mock('./memoryReconcile.js', () => ({ reconcileMemoryWrite: vi.fn() }));
vi.mock('./memoryReflect.js', () => ({ runReflection: vi.fn() }));
vi.mock('./integrations/magi.js', () => ({ magiSystemEnabled: vi.fn(() => true) }));

import { distillEpisodicMemories } from './memoryEpisodicDistill.js';
import { reconcileMemoryWrite } from './memoryReconcile.js';
import { runReflection } from './memoryReflect.js';
import { magiSystemEnabled } from './integrations/magi.js';
import type { LlmChatClient } from './llm/types.js';
import { runEpisodicMemory } from './memoryEpisodicWire.js';

const distill = vi.mocked(distillEpisodicMemories);
const reconcile = vi.mocked(reconcileMemoryWrite);
const reflect = vi.mocked(runReflection);
const enabled = vi.mocked(magiSystemEnabled);

const llm = { chat: vi.fn() } as unknown as LlmChatClient;
const signal = new AbortController().signal;

function params(overrides?: Partial<Parameters<typeof runEpisodicMemory>[0]>) {
  return {
    ownerId: 'userA',
    runId: 'run-1',
    sessionId: 'sess-1',
    topicId: null,
    transcript: '用户: 帮我把 X 项目的死锁查清楚\n助手: 已定位到 Y 模块的锁顺序问题',
    llm,
    signal,
    ...overrides,
  };
}

describe('runEpisodicMemory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enabled.mockReturnValue(true);
    reflect.mockResolvedValue({ reflected: false, written: 0, newFactCount: 0 });
  });

  it('distills transcript then reconciles each fact with run-owner + provenance', async () => {
    distill.mockResolvedValue([
      { text: 'Y 模块锁顺序有问题', confidence: 0.9 },
      { text: '用户在查 X 项目死锁', confidence: 0.6 },
    ]);
    reconcile.mockResolvedValue({ action: 'new', invalidatedIds: [] });
    await runEpisodicMemory(params());
    expect(distill).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(reconcile).toHaveBeenCalledWith(
      llm,
      'userA',
      { text: 'Y 模块锁顺序有问题', confidence: 0.9 },
      expect.objectContaining({ sourceRunId: 'run-1', sourceSessionId: 'sess-1' }),
    );
  });

  it('M4f: runs reflection after reconcile (run-owner + provenance)', async () => {
    distill.mockResolvedValue([{ text: 'f', confidence: 0.9 }]);
    reconcile.mockResolvedValue({ action: 'new', invalidatedIds: [] });
    await runEpisodicMemory(params());
    expect(reflect).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'userA', sourceRunId: 'run-1', sourceSessionId: 'sess-1' }),
    );
  });

  it('M4f fail-open: reflection throws → runEpisodicMemory still resolves', async () => {
    distill.mockResolvedValue([]);
    reflect.mockRejectedValue(new Error('reflect boom'));
    await expect(runEpisodicMemory(params())).resolves.toBeUndefined();
  });

  it('skips entirely when MAGI disabled (no distill LLM call)', async () => {
    enabled.mockReturnValue(false);
    await runEpisodicMemory(params());
    expect(distill).not.toHaveBeenCalled();
  });

  it('skips trivial/short transcript (no wasted LLM call)', async () => {
    await runEpisodicMemory(params({ transcript: '在' }));
    expect(distill).not.toHaveBeenCalled();
  });

  it('fail-open: distill throws → no throw, no reconcile', async () => {
    distill.mockRejectedValue(new Error('llm 503'));
    await expect(runEpisodicMemory(params())).resolves.toBeUndefined();
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('#11: propagates cancellation when distill LLM re-wraps abort (signal.aborted)', async () => {
    const ac = new AbortController();
    distill.mockImplementation(async () => {
      ac.abort();
      const e = new Error('已取消');
      e.name = 'LlmProviderError'; // provider 重包,非 AbortError
      throw e;
    });
    await expect(runEpisodicMemory(params({ signal: ac.signal }))).rejects.toThrow(/取消/);
  });

  it('#11: propagates cancellation when reconcile re-wraps abort (signal.aborted)', async () => {
    const ac = new AbortController();
    distill.mockResolvedValue([{ text: 'f', confidence: 0.9 }]);
    reconcile.mockImplementation(async () => {
      ac.abort();
      const e = new Error('已取消');
      e.name = 'LlmProviderError';
      throw e;
    });
    await expect(runEpisodicMemory(params({ signal: ac.signal }))).rejects.toThrow(/取消/);
  });

  it('fail-open: one reconcile throws → others still attempted, no throw', async () => {
    distill.mockResolvedValue([
      { text: 'fact1', confidence: 0.9 },
      { text: 'fact2', confidence: 0.9 },
    ]);
    reconcile
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ action: 'new', invalidatedIds: [] });
    await expect(runEpisodicMemory(params())).resolves.toBeUndefined();
    expect(reconcile).toHaveBeenCalledTimes(2);
  });
});

// ───────────── K5:研究蒸馏接线(refs→findings,群池归属,fail-open) ─────────────

vi.mock('./memoryResearchDistill.js', () => ({
  distillResearchFindings: vi.fn(async () => []),
  persistResearchFindings: vi.fn(async () => ({ written: 0, deduped: 0, disputed: 0 })),
}));

import {
  distillResearchFindings,
  persistResearchFindings,
} from './memoryResearchDistill.js';

const distillResearch = vi.mocked(distillResearchFindings);
const persistResearch = vi.mocked(persistResearchFindings);

const URL_REF = { kind: 'url' as const, id: 'https://doi.org/10.1/x', label: 'P (2020)' };
const A_FINDING = { text: '结论', confidence: 0.9, sources: [{ url: 'https://doi.org/10.1/x' }] };

describe('runEpisodicMemory · K5 研究蒸馏', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enabled.mockReturnValue(true);
    distill.mockResolvedValue([]);
    reflect.mockResolvedValue({ reflected: false, written: 0, newFactCount: 0 } as never);
    distillResearch.mockResolvedValue([A_FINDING]);
    persistResearch.mockResolvedValue({ written: 1, deduped: 0, disputed: 0 });
  });

  it('未传 research / refs 为空 → 零研究蒸馏调用(不多花 LLM)', async () => {
    await runEpisodicMemory(params());
    await runEpisodicMemory(params({
      research: { refs: [], finalContent: '正文', channel: 'private' as const },
    } as never));
    expect(distillResearch).not.toHaveBeenCalled();
    expect(persistResearch).not.toHaveBeenCalled();
  });

  it('refs 非空(私聊)→ 蒸馏 + persist,owner = run owner', async () => {
    await runEpisodicMemory(params({
      research: { refs: [URL_REF], finalContent: '研究终稿 [1]', channel: 'private' as const },
    } as never));
    expect(distillResearch).toHaveBeenCalledOnce();
    expect(persistResearch).toHaveBeenCalledWith(
      llm, 'userA', [A_FINDING],
      expect.objectContaining({ sourceRunId: 'run-1' }),
    );
  });

  it('群聊 run → findings 落群共享池 group:{gid}', async () => {
    await runEpisodicMemory(params({
      research: { refs: [URL_REF], finalContent: '终稿', channel: 'group' as const, groupId: 'g1' },
    } as never));
    expect(persistResearch.mock.calls[0]![1]).toBe('group:g1');
  });

  it('研究蒸馏抛错 → fact 链路与 reflection 不受影响(fail-open)', async () => {
    distill.mockResolvedValue([{ text: '一条 fact', confidence: 0.9 }]);
    reconcile.mockResolvedValue({ action: 'new', invalidatedIds: [] } as never);
    distillResearch.mockRejectedValue(new Error('boom'));
    await runEpisodicMemory(params({
      research: { refs: [URL_REF], finalContent: '终稿', channel: 'private' as const },
    } as never));
    expect(reconcile).toHaveBeenCalledOnce(); // fact 照写
    expect(reflect).toHaveBeenCalledOnce();   // 反思照跑
  });
});
