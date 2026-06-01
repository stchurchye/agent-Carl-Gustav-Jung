/**
 * M7 TB14：buildReplyMessages 包含追问段。
 */
import { describe, it, expect } from 'vitest';
import { buildReplyMessages } from '../replyGen.js';
import type { AgentRun, Plan } from '../types.js';

describe('buildReplyMessages with mergedInputs (M7 TB14)', () => {
  const fakePlan: Plan = {
    intentSummary: '一步 echo',
    steps: [],
    todos: [],
    finalReplyHint: '',
    reasoning: null,
    version: 1,
  };

  const baseRun: AgentRun = {
    id: 'r1', ownerId: 'u1', channel: 'group',
    sessionId: null, groupId: 'g', topicId: 't', intentTurnId: null,
    role: 'generalist', status: 'running', inputText: '主请求',
    plan: fakePlan, todos: [],
    budget: { maxSteps: 5, maxSeconds: 60, maxTokens: 1000 },
    usage: { steps: 0, elapsedSeconds: 0, tokens: 0, costCny: 0 },
    apiKeyOwnerId: null, apiKeySource: 'server',
    providerId: 'deepseek', modelId: 'deepseek-v4-pro',
    sandboxId: null, userApiKeysEnc: {},
    parentRunId: null, pendingUserPrompt: null, pendingUserStepIdx: null,
    pendingUserInputExpiresAt: null, summary: null, artifact: null,
    resultMessageId: null, invokeMessageId: null, lastHeartbeatAt: null,
    awaitingApprovalUntil: null, awaitingApprovalStepIdx: null,
    pendingApprovalToolName: null, cancelledByUserId: null, cancelReason: null,
    mergedInputs: [], mergedInputsConsumedCount: 0, queuePosition: null,
    askUserTargetUserId: null, askUserStartedAt: null, askUserOpenedForAllAt: null,
    createdAt: new Date(), startedAt: null, endedAt: null,
  };

  it('renders 后续追问 section in user message when mergedInputs non-empty', () => {
    const run = {
      ...baseRun,
      mergedInputs: [
        { text: '追问甲', byUserId: 'u2', byUsername: '老王', at: '2026-05-22T10:00:00Z' },
      ],
    };
    const msgs = buildReplyMessages({ run, plan: fakePlan, steps: [] });
    const user = msgs.find((m) => m.role === 'user')!;
    expect(user.content).toContain('# 后续追问列表');
    expect(user.content).toContain('@老王');
    expect(user.content).toContain('追问甲');
  });

  it('omits section when mergedInputs empty', () => {
    const msgs = buildReplyMessages({ run: baseRun, plan: fakePlan, steps: [] });
    const user = msgs.find((m) => m.role === 'user')!;
    expect(user.content).not.toContain('# 后续追问列表');
  });
});
