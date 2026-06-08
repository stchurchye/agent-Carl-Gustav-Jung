import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./integrations/magi.js', () => ({ writeAgentMemory: vi.fn() }));

import { writeAgentMemory } from './integrations/magi.js';
import type { LlmChatClient } from './llm/types.js';
import {
  distillEpisodicMemories,
  persistEpisodicMemories,
} from './memoryEpisodicDistill.js';

const writeMem = vi.mocked(writeAgentMemory);

/** 最小 LlmChatClient 桩:只关心 .content;cast 满足类型。 */
function fakeLlm(content: string): LlmChatClient {
  return {
    chat: vi.fn().mockResolvedValue({ content }),
  } as unknown as LlmChatClient;
}

describe('distillEpisodicMemories', () => {
  beforeEach(() => vi.clearAllMocks());

  it('parses facts with confidence from LLM output', async () => {
    const facts = await distillEpisodicMemories(
      fakeLlm('{"facts":[{"text":"用户在调试 X 模块的死锁","confidence":0.7}]}'),
      '用户: 帮我看死锁\n助手: 好',
    );
    expect(facts).toEqual([{ text: '用户在调试 X 模块的死锁', confidence: 0.7 }]);
  });

  it('filters invalid entries (blank text / out-of-range confidence)', async () => {
    const facts = await distillEpisodicMemories(
      fakeLlm(
        '{"facts":[{"text":"  ","confidence":0.9},{"text":"有效事实","confidence":1.5},{"text":"好事实","confidence":0.6}]}',
      ),
      't',
    );
    expect(facts).toEqual([{ text: '好事实', confidence: 0.6 }]);
  });

  it('returns [] on non-JSON / garbage LLM output (fail-safe)', async () => {
    expect(await distillEpisodicMemories(fakeLlm('抱歉我不能输出 JSON'), 't')).toEqual([]);
  });

  it('M4e: parses optional sentiment label per fact', async () => {
    const facts = await distillEpisodicMemories(
      fakeLlm('{"facts":[{"text":"用户搞定了上线","confidence":0.8,"sentiment":"positive"}]}'),
      't',
    );
    expect(facts).toEqual([
      { text: '用户搞定了上线', confidence: 0.8, sentiment: 'positive' },
    ]);
  });

  it('M4e: omits sentiment when missing or invalid (toEqual ignores undefined)', async () => {
    const facts = await distillEpisodicMemories(
      fakeLlm(
        '{"facts":[{"text":"无情感","confidence":0.6},{"text":"非法情感","confidence":0.6,"sentiment":"愤怒"}]}',
      ),
      't',
    );
    expect(facts).toEqual([
      { text: '无情感', confidence: 0.6 },
      { text: '非法情感', confidence: 0.6 },
    ]);
    expect(facts[0].sentiment).toBeUndefined();
    expect(facts[1].sentiment).toBeUndefined();
  });
});

describe('persistEpisodicMemories', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps confidence→status (≥0.85 approved, else pending) and writes each fact', async () => {
    writeMem.mockResolvedValue({ id: 1 });
    const n = await persistEpisodicMemories(
      'userA',
      [
        { text: '高置信事实', confidence: 0.9 },
        { text: '低置信事实', confidence: 0.5 },
      ],
      { sourceRunId: 'run-1' },
    );
    expect(n).toBe(2);
    expect(writeMem).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'userA',
        text: '高置信事实',
        status: 'approved',
        sourceRunId: 'run-1',
      }),
      undefined,
    );
    expect(writeMem).toHaveBeenCalledWith(
      expect.objectContaining({ text: '低置信事实', status: 'pending' }),
      undefined,
    );
  });

  it('M4e: forwards sentiment to writeAgentMemory', async () => {
    writeMem.mockResolvedValue({ id: 1 });
    await persistEpisodicMemories(
      'userA',
      [{ text: '上线成功', confidence: 0.9, sentiment: 'positive' }],
      { sourceRunId: 'run-1' },
    );
    expect(writeMem).toHaveBeenCalledWith(
      expect.objectContaining({ text: '上线成功', sentiment: 'positive' }),
      undefined,
    );
  });

  it('fail-open: one write throws → others still written, no throw', async () => {
    writeMem
      .mockRejectedValueOnce(new Error('magi 503'))
      .mockResolvedValueOnce({ id: 2 });
    const n = await persistEpisodicMemories(
      'userA',
      [
        { text: '失败的', confidence: 0.9 },
        { text: '成功的', confidence: 0.9 },
      ],
      {},
    );
    expect(n).toBe(1);
  });
});
