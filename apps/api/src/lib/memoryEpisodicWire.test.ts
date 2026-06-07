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
