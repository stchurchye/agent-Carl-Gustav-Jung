import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./deepseek.js', () => ({ chatCompletionRaw: vi.fn() }));
vi.mock('./integrations/magi.js', () => ({
  searchAgentMemory: vi.fn(),
  writeAgentMemory: vi.fn(),
  invalidateAgentMemory: vi.fn(),
}));

import { chatCompletionRaw } from './deepseek.js';
import {
  searchAgentMemory,
  writeAgentMemory,
  invalidateAgentMemory,
} from './integrations/magi.js';
import { reconcileMemoryWrite } from './memoryReconcile.js';

const judge = vi.mocked(chatCompletionRaw);
const search = vi.mocked(searchAgentMemory);
const write = vi.mocked(writeAgentMemory);
const invalidate = vi.mocked(invalidateAgentMemory);

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
    const r = await reconcileMemoryWrite('k', 'userA', { text: '我用 Python', confidence: 0.9 }, {});
    expect(r.action).toBe('new');
    expect(write).toHaveBeenCalledOnce();
    expect(judge).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('supersede: 改主意 → 写新 + 失效旧(头条"会更新")', async () => {
    search.mockResolvedValue([hit(1, '用户用 Python')]);
    judge.mockResolvedValue('{"supersededIds":[1],"duplicate":false}');
    write.mockResolvedValue({ id: 200 });
    const r = await reconcileMemoryWrite('k', 'userA', { text: '用户改用 Rust', confidence: 0.9 }, {});
    expect(r.action).toBe('supersede');
    expect(r.writtenId).toBe(200);
    expect(r.invalidatedIds).toEqual([1]);
    expect(invalidate).toHaveBeenCalledWith('userA', 1, undefined);
  });

  it('duplicate: 近义重述 → 跳过写入(防累积,洞C)', async () => {
    search.mockResolvedValue([hit(1, '用户在做 X 项目')]);
    judge.mockResolvedValue('{"supersededIds":[],"duplicate":true}');
    const r = await reconcileMemoryWrite('k', 'userA', { text: '用户正在搞 X 项目', confidence: 0.9 }, {});
    expect(r.action).toBe('duplicate');
    expect(write).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('invalidate 逐条 fail-open:失效失败仍写新、不抛', async () => {
    search.mockResolvedValue([hit(1, '用户用 Python')]);
    judge.mockResolvedValue('{"supersededIds":[1],"duplicate":false}');
    write.mockResolvedValue({ id: 201 });
    invalidate.mockRejectedValue(new Error('magi 503'));
    const r = await reconcileMemoryWrite('k', 'userA', { text: '用户改用 Go', confidence: 0.9 }, {});
    expect(r.writtenId).toBe(201);
    expect(r.invalidatedIds).toEqual([]); // 失效失败,新 fact 已写
    expect(r.action).toBe('new'); // 没成功失效任何旧条
  });
});
