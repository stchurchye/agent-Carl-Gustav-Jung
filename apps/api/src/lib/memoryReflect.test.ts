import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./integrations/magi.js', () => ({
  listAgentMemory: vi.fn(),
  writeAgentMemory: vi.fn(),
}));

import { listAgentMemory, writeAgentMemory } from './integrations/magi.js';
import type { LlmChatClient } from './llm/types.js';
import { runReflection } from './memoryReflect.js';

const list = vi.mocked(listAgentMemory);
const write = vi.mocked(writeAgentMemory);
const signal = new AbortController().signal;

function fakeLlm(content: string) {
  const chat = vi.fn().mockResolvedValue({ content });
  return { llm: { chat } as unknown as LlmChatClient, chat };
}

const item = (
  id: number,
  text: string,
  kind: string,
  createdAt: string | null = null,
  status = 'approved',
) => ({
  id,
  text,
  status,
  confidence: 0.9,
  createdAt,
  validUntil: null,
  sourceRunId: null,
  kind,
  sentiment: null,
  sourceFragmentIds: null,
  promotedAt: null,
});

describe('runReflection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    write.mockResolvedValue({ id: 50 });
  });

  it('tracer: synthesizes insight from accumulated facts → writes kind=insight w/ provenance', async () => {
    list.mockResolvedValue([
      item(1, '用户在学 Rust', 'fact'),
      item(2, '用户在写一个编译器', 'fact'),
      item(3, '用户偏好系统编程', 'fact'),
    ]);
    const { llm } = fakeLlm(
      '{"insights":[{"text":"用户专注系统编程方向","confidence":0.9,"source_fragment_ids":[1,2,3]}]}',
    );
    const r = await runReflection({ ownerId: 'userA', llm, signal, minNewFacts: 3 });
    expect(r.reflected).toBe(true);
    expect(r.written).toBe(1);
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'userA',
        kind: 'insight',
        text: '用户专注系统编程方向',
        sourceFragmentIds: [1, 2, 3],
        status: 'approved',
      }),
      signal,
    );
  });

  it('throttle: below minNewFacts → no synthesis, no write', async () => {
    list.mockResolvedValue([item(1, 'a', 'fact'), item(2, 'b', 'fact')]);
    const { llm, chat } = fakeLlm('{"insights":[]}');
    const r = await runReflection({ ownerId: 'userA', llm, signal, minNewFacts: 5 });
    expect(r.reflected).toBe(false);
    expect(chat).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('throttle: counts only facts newer than the last insight', async () => {
    // 列表按 created_at DESC:最新事实 T3、洞见 T2、旧事实 T1 → 只有 1 条事实晚于洞见
    list.mockResolvedValue([
      item(3, '新事实', 'fact', '2026-06-07T03:00:00Z'),
      item(2, '旧洞见', 'insight', '2026-06-07T02:00:00Z'),
      item(1, '旧事实', 'fact', '2026-06-07T01:00:00Z'),
    ]);
    const { llm } = fakeLlm('{"insights":[]}');
    const r = await runReflection({ ownerId: 'userA', llm, signal, minNewFacts: 2 });
    expect(r.reflected).toBe(false);
    expect(r.newFactCount).toBe(1);
  });

  it('drops source_fragment_ids not in the synthesis window (hallucination guard)', async () => {
    list.mockResolvedValue([item(1, 'a', 'fact'), item(2, 'b', 'fact')]);
    const { llm } = fakeLlm(
      '{"insights":[{"text":"合成","confidence":0.9,"source_fragment_ids":[1,999]}]}',
    );
    await runReflection({ ownerId: 'userA', llm, signal, minNewFacts: 1 });
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ sourceFragmentIds: [1] }),
      signal,
    );
  });

  it('fail-open: list throws → no throw, reflected false', async () => {
    list.mockRejectedValue(new Error('magi down'));
    const { llm } = fakeLlm('{}');
    const r = await runReflection({ ownerId: 'userA', llm, signal, minNewFacts: 1 });
    expect(r.reflected).toBe(false);
    expect(r.written).toBe(0);
  });

  it('propagates cancellation even when provider re-wraps abort as non-AbortError', async () => {
    // provider 把 abort 重包成 LlmProviderError(name!='AbortError'),但 signal.aborted=true → 必须透传
    const ac = new AbortController();
    list.mockResolvedValue([item(1, 'a', 'fact'), item(2, 'b', 'fact')]);
    const chat = vi.fn().mockImplementation(async () => {
      ac.abort();
      const e = new Error('请求已取消');
      e.name = 'LlmProviderError';
      throw e;
    });
    const llm = { chat } as unknown as LlmChatClient;
    await expect(
      runReflection({ ownerId: 'userA', llm, signal: ac.signal, minNewFacts: 1 }),
    ).rejects.toThrow(/取消/);
  });
});
