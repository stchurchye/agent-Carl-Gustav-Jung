import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deepResearchTool, registerDeepResearch } from '../tools/deepResearch.js';
import { toolRegistry } from '../toolRegistry.js';

vi.mock('../store.js', async (importActual) => {
  const actual = await importActual<typeof import('../store.js')>();
  return {
    ...actual,
    getAgentRun: vi.fn(),
    listSteps: vi.fn(async () => []),
    updateAgentRun: vi.fn(async () => {}),
  };
});

vi.mock('../runLifecycle.js', () => ({
  createAgentRun: vi.fn(),
  resumeAgentRun: vi.fn(),
}));

vi.mock('../childExecutor.js', () => ({
  dispatchChildRun: vi.fn(async () => {}),
}));

import * as store from '../store.js';
import { createAgentRun } from '../runLifecycle.js';
import { dispatchChildRun } from '../childExecutor.js';

const PARENT_RUN = {
  id: 'parent-1',
  ownerId: 'u',
  channel: 'private' as const,
  parentRunId: null,
  pendingUserPrompt: null,
  pendingUserStepIdx: null,
  status: 'running' as const,
  inputText: 'top level',
  plan: null,
  todos: [],
  budget: { maxSteps: 10, maxSeconds: 60, maxTokens: 10000 },
  usage: { steps: 0, elapsedSeconds: 0, tokens: 0, costCny: 0 },
  apiKeyOwnerId: null,
  apiKeySource: 'server' as const,
  providerId: 'deepseek' as const,
  modelId: 'deepseek-v4-pro',
  sandboxId: null,
  userApiKeysEnc: {},
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
  sessionId: 'sess1',
  groupId: null,
  topicId: null,
  intentTurnId: null,
  role: 'generalist' as const,
};

const CHILD_RUN_COMPLETED = {
  ...PARENT_RUN,
  id: 'child-1',
  parentRunId: 'parent-1',
  status: 'completed' as const,
  usage: { steps: 3, elapsedSeconds: 5, tokens: 100, costCny: 0 },
};

const fakeCtx = {
  runId: 'parent-1',
  stepId: 's',
  ownerId: 'u',
  channel: 'private' as const,
  signal: new AbortController().signal,
};

describe('deep_research tool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('registers idempotently', () => {
    registerDeepResearch();
    registerDeepResearch();
    expect(toolRegistry.get('deep_research')).toBeDefined();
  });

  it('happy path: dispatches child run and returns report', async () => {
    vi.mocked(store.getAgentRun)
      .mockResolvedValueOnce(PARENT_RUN)
      .mockResolvedValueOnce(CHILD_RUN_COMPLETED);
    vi.mocked(createAgentRun).mockResolvedValueOnce({
      run: { ...CHILD_RUN_COMPLETED, status: 'running' as const },
      userMessageId: null,
      placeholderMessageId: null,
      llmJobId: null,
    });
    vi.mocked(store.listSteps).mockResolvedValueOnce([
      {
        id: 's1',
        runId: 'child-1',
        kind: 'reply',
        toolName: null,
        toolCallKey: null,
        input: null,
        output: { content: '## 报告\n内容...' },
        idx: 0,
        tokens: 0,
        durationMs: null,
        error: null,
        status: 'succeeded',
        createdAt: new Date(),
      } as unknown as import('../store.js').AgentStep,
    ]);

    const out = await deepResearchTool.handler({ question: '什么是禀赋效应？' }, fakeCtx);
    expect(out.ok).toBe(true);
    expect(out.childRunId).toBe('child-1');
    expect(out.report).toContain('报告');
    expect(dispatchChildRun).toHaveBeenCalledWith('child-1');
  });

  it('rejects nested deep_research (parent is sub-agent)', async () => {
    vi.mocked(store.getAgentRun).mockResolvedValueOnce({
      ...PARENT_RUN,
      parentRunId: 'grandparent',
    });
    const out = await deepResearchTool.handler({ question: '啥' }, fakeCtx);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/nested/);
  });

  it('child run failed → ok:false with error', async () => {
    const failedChild = { ...CHILD_RUN_COMPLETED, status: 'failed' as const };
    vi.mocked(store.getAgentRun)
      .mockResolvedValueOnce(PARENT_RUN)
      .mockResolvedValueOnce(failedChild);
    vi.mocked(createAgentRun).mockResolvedValueOnce({
      run: { ...failedChild, status: 'running' as const },
      userMessageId: null,
      placeholderMessageId: null,
      llmJobId: null,
    });
    const out = await deepResearchTool.handler({ question: 'test?' }, fakeCtx);
    expect(out.ok).toBe(false);
    expect(out.error).toContain('failed');
  });

  it('maxSteps clamped to [1, 8]', async () => {
    vi.mocked(store.getAgentRun)
      .mockResolvedValueOnce(PARENT_RUN)
      .mockResolvedValueOnce(CHILD_RUN_COMPLETED);
    vi.mocked(createAgentRun).mockResolvedValueOnce({
      run: { ...CHILD_RUN_COMPLETED, status: 'running' as const },
      userMessageId: null,
      placeholderMessageId: null,
      llmJobId: null,
    });
    vi.mocked(store.listSteps).mockResolvedValueOnce([]);
    await deepResearchTool.handler({ question: 'test?', maxSteps: 999 }, fakeCtx);
    const callArgs = vi.mocked(createAgentRun).mock.calls[0]![0] as {
      budget: { maxSteps: number };
    };
    expect(callArgs.budget.maxSteps).toBe(8);
  });

  it('AbortError re-throws when signal aborted', async () => {
    const ac = new AbortController();
    vi.mocked(store.getAgentRun).mockResolvedValue(PARENT_RUN);
    vi.mocked(createAgentRun).mockResolvedValueOnce({
      run: { ...PARENT_RUN, id: 'child-99', status: 'running' as const },
      userMessageId: null,
      placeholderMessageId: null,
      llmJobId: null,
    });
    vi.mocked(dispatchChildRun).mockImplementationOnce(async () => {
      ac.abort();
    });
    const p = deepResearchTool.handler({ question: 'test?' }, { ...fakeCtx, signal: ac.signal });
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('parent run not found → ok:false', async () => {
    vi.mocked(store.getAgentRun).mockResolvedValueOnce(null);
    const out = await deepResearchTool.handler({ question: 'test question' }, fakeCtx);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/not found/);
  });
});
