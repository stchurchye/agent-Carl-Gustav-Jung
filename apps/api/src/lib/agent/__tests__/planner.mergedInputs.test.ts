/**
 * M7 T5b：planner prompt 包含追问段（TB13 后半段）。
 *
 * 验证：mergedInputs 非空时，buildPlannerUserPrompt 渲染 "# 后续追问" 段。
 */
import { describe, it, expect, vi } from 'vitest';
import { generatePlanWithLlm } from '../planner.js';
import type { LlmChatClient, LlmChatMessage } from '../../llm/types.js';

const baseSnapshot = {
  systemPrompt: '',
  history: [],
  shortSummary: '',
  usage: {
    usedTokens: 0,
    limitTokens: 0,
    ratio: 0,
    breakdown: { system: 0, summary: 0, history: 0, document: 0, pendingUser: 0, outputReserve: 0 },
    compacted: false,
    droppedVerbatimTurns: 0,
  },
  source: { channel: 'private' as const },
};

describe('planner buildPlannerUserPrompt with mergedInputs (M7 T5b)', () => {
  it('includes merged input section when mergedInputs provided', async () => {
    let capturedUser = '';
    const llm: LlmChatClient = {
      chat: vi.fn(async (msgs: LlmChatMessage[]) => {
        capturedUser = msgs[msgs.length - 1].content;
        return {
          content: JSON.stringify({
            intentSummary: '总结',
            steps: [{ toolName: 'echo_after_sleep', input: { text: 'x', sleepMs: 1 }, reason: 'r', todoId: 't1' }],
            todos: [{ id: 't1', text: 't1', status: 'pending', stepRefs: [] }],
            finalReplyHint: 'ok',
          }),
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        };
      }),
    } as unknown as LlmChatClient;

    // 只关心 prompt 构造；parse 阶段抛错（mock JSON 不一定过 tool 校验）无所谓，
    // capturedUser 在 chat() 内、parse 之前已被赋值。
    await generatePlanWithLlm({
      inputText: '主请求',
      snapshot: baseSnapshot,
      llm,
      signal: new AbortController().signal,
      mergedInputs: [
        { text: '追问 A', byUserId: 'u1', byUsername: '小张', at: '2026-05-22T10:00:00Z' },
        { text: '追问 B', byUserId: 'u2', byUsername: '小李', at: '2026-05-22T10:00:30Z' },
      ],
    } as Parameters<typeof generatePlanWithLlm>[0]).catch(() => undefined);

    expect(capturedUser).toContain('# 后续追问');
    expect(capturedUser).toContain('@小张');
    expect(capturedUser).toContain('追问 A');
    expect(capturedUser).toContain('@小李');
    expect(capturedUser).toContain('追问 B');
  });

  it('omits section when mergedInputs empty or undefined', async () => {
    let capturedUser = '';
    const llm: LlmChatClient = {
      chat: vi.fn(async (msgs: LlmChatMessage[]) => {
        capturedUser = msgs[msgs.length - 1].content;
        return {
          content:
            '{"intentSummary":"x","steps":[{"toolName":"echo_after_sleep","input":{"text":"x","sleepMs":1},"reason":"r","todoId":"t1"}],"todos":[{"id":"t1","text":"t1","status":"pending","stepRefs":[]}],"finalReplyHint":""}',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        };
      }),
    } as unknown as LlmChatClient;

    await generatePlanWithLlm({
      inputText: '主请求',
      snapshot: baseSnapshot,
      llm,
      signal: new AbortController().signal,
    } as Parameters<typeof generatePlanWithLlm>[0]).catch(() => undefined);
    expect(capturedUser).not.toContain('# 后续追问');
  });
});
