import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../deepseek.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../deepseek.js')>('../../deepseek.js');
  return {
    ...actual,
    chatCompletionRaw: vi.fn(),
  };
});

import * as deepseek from '../../deepseek.js';
import { buildReplyMessages, generateFinalReply } from '../replyGen.js';
import type { AgentRun, AgentStep, Plan } from '../types.js';

const chatCompletionRaw = vi.mocked(deepseek.chatCompletionRaw);

const baseRun: AgentRun = {
  id: 'r',
  ownerId: 'u',
  channel: 'private',
  sessionId: 's',
  groupId: null,
  topicId: null,
  intentTurnId: null,
  role: 'generalist',
  status: 'completed',
  inputText: '帮我研究家族信托并存档',
  plan: null,
  todos: [],
  budget: { maxSteps: 20, maxSeconds: 600, maxTokens: 100_000 },
  usage: { steps: 0, elapsedSeconds: 0, tokens: 0, costCny: 0 },
  apiKeyOwnerId: null,
  apiKeySource: 'server',
  resultMessageId: null,
  invokeMessageId: null,
  lastHeartbeatAt: null,
  awaitingApprovalUntil: null,
  awaitingApprovalStepIdx: null,
  pendingApprovalToolName: null,
  cancelledByUserId: null,
  cancelReason: null,
  createdAt: new Date(),
  startedAt: null,
  endedAt: null,
};

const plan: Plan = {
  intentSummary: '研究家族信托',
  steps: [],
  todos: [],
  finalReplyHint: '简明总结 + 文档链接',
  reasoning: null,
  version: 1,
};

function stepBase(overrides: Partial<AgentStep>): AgentStep {
  return {
    id: 'sid',
    runId: 'r',
    idx: 0,
    kind: 'tool_call',
    toolName: null,
    toolCallKey: null,
    input: null,
    output: null,
    tokens: 0,
    durationMs: 0,
    error: null,
    byUserId: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('buildReplyMessages', () => {
  it('formats user prompt with intent + recent tool digests + exported doc hint', () => {
    const steps: AgentStep[] = [
      stepBase({
        idx: 0,
        toolName: 'web_search',
        output: { result: { results: [{ title: 'A', url: 'u', snippet: 's' }] } },
      }),
      stepBase({
        idx: 1,
        toolName: 'doc_export_markdown',
        output: { result: { documentId: 'doc-1', title: '家族信托研究' } },
      }),
    ];
    const msgs = buildReplyMessages({ run: baseRun, plan, steps });
    expect(msgs[0].role).toBe('system');
    expect(msgs[1].content).toContain('研究家族信托');
    expect(msgs[1].content).toContain('web_search');
    expect(msgs[1].content).toContain('doc_export_markdown');
    expect(msgs[1].content).toContain('家族信托研究');
    expect(msgs[1].content).toContain('doc-1');
  });

  it('handles zero tool steps gracefully', () => {
    const msgs = buildReplyMessages({ run: baseRun, plan, steps: [] });
    expect(msgs[1].content).toContain('（无工具调用）');
  });
});

describe('generateFinalReply', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns LLM response on success', async () => {
    chatCompletionRaw.mockResolvedValue('已为你研究家族信托，结果如下…');
    const out = await generateFinalReply({
      run: baseRun,
      plan,
      steps: [],
      apiKey: 'k',
    });
    expect(out).toContain('家族信托');
  });

  it('falls back when LLM fails, mentions exported docs', async () => {
    chatCompletionRaw.mockRejectedValue(new Error('down'));
    const steps: AgentStep[] = [
      stepBase({
        idx: 0,
        toolName: 'doc_export_markdown',
        output: { result: { documentId: 'd1', title: 'TITLE' } },
      }),
    ];
    const out = await generateFinalReply({
      run: baseRun,
      plan,
      steps,
      apiKey: 'k',
    });
    expect(out).toContain('TITLE');
    expect(out).toContain('研究家族信托');
  });
});
