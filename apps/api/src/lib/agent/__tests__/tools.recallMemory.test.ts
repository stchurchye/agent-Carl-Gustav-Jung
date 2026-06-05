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
    expect(out.hits.map((h) => h.text)).toContain('用户在做 X 项目');
  });

  it('locks owner to ctx.ownerId (never cross-user/group-member)', async () => {
    searchAgentMemory.mockResolvedValue([]);
    await recallMemoryTool.handler({ query: 'x' }, ctx);
    expect(searchAgentMemory).toHaveBeenCalledWith('userA', 'x', 12, ctx.signal);
  });

  it('fail-open: MAGI disabled → empty hits, no throw', async () => {
    magiSystemEnabled.mockReturnValue(false);
    searchAgentMemory.mockResolvedValue([]);
    const out = await recallMemoryTool.handler({ query: 'x' }, ctx);
    expect(out.enabled).toBe(false);
    expect(out.hits).toEqual([]);
  });

  it('fail-open: search error → ok=false + empty, no throw', async () => {
    searchAgentMemory.mockRejectedValue(new Error('magi 503'));
    const out = await recallMemoryTool.handler({ query: 'x' }, ctx);
    expect(out.ok).toBe(false);
    expect(out.hits).toEqual([]);
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
