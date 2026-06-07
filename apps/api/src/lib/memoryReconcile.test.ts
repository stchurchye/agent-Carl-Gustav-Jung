import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./integrations/magi.js', () => ({
  searchAgentMemory: vi.fn(),
  writeAgentMemory: vi.fn(),
  invalidateAgentMemory: vi.fn(),
}));

import {
  searchAgentMemory,
  writeAgentMemory,
  invalidateAgentMemory,
} from './integrations/magi.js';
import type { LlmChatClient } from './llm/types.js';
import { reconcileMemoryWrite } from './memoryReconcile.js';

const search = vi.mocked(searchAgentMemory);
const write = vi.mocked(writeAgentMemory);
const invalidate = vi.mocked(invalidateAgentMemory);

/** LlmChatClient 桩,judge 返回给定 JSON;chat mock 暴露出来便于断言调用。 */
function fakeLlm(judgmentJson: string) {
  const chat = vi.fn().mockResolvedValue({ content: judgmentJson });
  const llm = { chat } as unknown as LlmChatClient;
  return { llm, chat };
}

const hit = (id: number, text: string) => ({
  id,
  text,
  sourceRunId: null,
  sourceSessionId: null,
  topicId: null,
  createdAt: null,
  score: 0.9,
});

describe('reconcileMemoryWrite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    write.mockResolvedValue({ id: 100 });
    invalidate.mockResolvedValue({ invalidated: 1 });
  });

  it('no near hits → writes new, never calls judge', async () => {
    search.mockResolvedValue([]);
    const { llm, chat } = fakeLlm('{}');
    const r = await reconcileMemoryWrite(llm, 'userA', { text: '我用 Python', confidence: 0.9 }, {});
    expect(r.action).toBe('new');
    expect(write).toHaveBeenCalledOnce();
    expect(chat).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('supersede: 改主意 → 写新 + 失效旧(头条"会更新")', async () => {
    search.mockResolvedValue([hit(1, '用户用 Python')]);
    write.mockResolvedValue({ id: 200 });
    const { llm } = fakeLlm('{"supersededIds":[1],"duplicate":false}');
    const r = await reconcileMemoryWrite(llm, 'userA', { text: '用户改用 Rust', confidence: 0.9 }, {});
    expect(r.action).toBe('supersede');
    expect(r.writtenId).toBe(200);
    expect(r.invalidatedIds).toEqual([1]);
    expect(invalidate).toHaveBeenCalledWith('userA', 1, undefined);
  });

  it('近邻搜带 include_pending=true(洞D:也能失效未审 pending 旧 fact)', async () => {
    search.mockResolvedValue([]);
    const { llm } = fakeLlm('{}');
    await reconcileMemoryWrite(llm, 'userA', { text: '新事实', confidence: 0.9 }, {});
    // searchAgentMemory(ownerId, query, topK, signal, includePending)
    expect(search).toHaveBeenCalledWith('userA', '新事实', 5, undefined, true);
  });

  it('duplicate: 近义重述 → 跳过写入(防累积,洞C)', async () => {
    search.mockResolvedValue([hit(1, '用户在做 X 项目')]);
    const { llm } = fakeLlm('{"supersededIds":[],"duplicate":true}');
    const r = await reconcileMemoryWrite(llm, 'userA', { text: '用户正在搞 X 项目', confidence: 0.9 }, {});
    expect(r.action).toBe('duplicate');
    expect(write).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('invalidate 逐条 fail-open:失效失败仍写新、不抛', async () => {
    search.mockResolvedValue([hit(1, '用户用 Python')]);
    write.mockResolvedValue({ id: 201 });
    invalidate.mockRejectedValue(new Error('magi 503'));
    const { llm } = fakeLlm('{"supersededIds":[1],"duplicate":false}');
    const r = await reconcileMemoryWrite(llm, 'userA', { text: '用户改用 Go', confidence: 0.9 }, {});
    expect(r.writtenId).toBe(201);
    expect(r.invalidatedIds).toEqual([]);
    expect(r.action).toBe('new');
  });
});
