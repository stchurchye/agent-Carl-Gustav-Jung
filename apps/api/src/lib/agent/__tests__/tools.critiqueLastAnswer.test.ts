import { describe, it, expect, vi, beforeEach } from 'vitest';
import { critiqueLastAnswerTool, registerCritiqueLastAnswer } from '../tools/critiqueLastAnswer.js';
import { toolRegistry } from '../toolRegistry.js';

vi.mock('../runLlmClient.js', () => ({ resolveLlmClient: vi.fn() }));
vi.mock('../store.js', () => ({
  getAgentRun: vi.fn(),
  listSteps: vi.fn(),
}));

import { resolveLlmClient } from '../runLlmClient.js';
import { getAgentRun, listSteps } from '../store.js';

const fakeCtx = {
  runId: 'r1',
  stepId: 's_critic',
  ownerId: 'u',
  channel: 'private' as const,
  signal: new AbortController().signal,
};

const fakeRun = { id: 'r1', providerId: 'deepseek' as const, modelId: 'deepseek-v4-pro', apiKeySource: 'server' };

const fakeStep = {
  id: 's1',
  runId: 'r1',
  idx: 0,
  kind: 'tool_call' as const,
  toolName: 'search_papers',
  toolCallKey: null,
  input: null,
  output: { papers: [{ title: 'X' }] },
  tokens: 0,
  durationMs: 0,
  error: null,
  byUserId: null,
  createdAt: new Date(),
};

const critiqureResult = {
  criticisms: [{ severity: 'high' as const, category: 'unsupported_claim', description: '没引用' }],
  overallAssessment: '论断缺引用',
  shouldRevise: true,
};

describe('critique_last_answer tool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('registers idempotently', () => {
    registerCritiqueLastAnswer();
    registerCritiqueLastAnswer();
    expect(toolRegistry.get('critique_last_answer')).toBeDefined();
  });

  it('tool metadata is correct', () => {
    const tool = toolRegistry.get('critique_last_answer')!;
    expect(tool.idempotent).toBe(true);
    expect(tool.hasSideEffects).toBe(false);
    expect(tool.replyMeta?.summaryKind).toBe('silent');
  });

  it('strict JSON LLM response → criticisms parsed, shouldRevise=true', async () => {
    (getAgentRun as ReturnType<typeof vi.fn>).mockResolvedValue(fakeRun);
    (listSteps as ReturnType<typeof vi.fn>).mockResolvedValue([fakeStep]);
    (resolveLlmClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      chat: vi.fn().mockResolvedValue({ content: JSON.stringify(critiqureResult), usage: {} }),
    });

    const out = await critiqueLastAnswerTool.handler({}, fakeCtx);
    expect(out.ok).toBe(true);
    expect(out.criticisms).toHaveLength(1);
    expect(out.criticisms[0].severity).toBe('high');
    expect(out.shouldRevise).toBe(true);
    expect(out.overallAssessment).toBe('论断缺引用');
  });

  it('markdown-fenced JSON → extractJsonCandidate handles it', async () => {
    (getAgentRun as ReturnType<typeof vi.fn>).mockResolvedValue(fakeRun);
    (listSteps as ReturnType<typeof vi.fn>).mockResolvedValue([fakeStep]);
    (resolveLlmClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      chat: vi.fn().mockResolvedValue({
        content: '```json\n' + JSON.stringify(critiqureResult) + '\n```',
        usage: {},
      }),
    });

    const out = await critiqueLastAnswerTool.handler({}, fakeCtx);
    expect(out.ok).toBe(true);
    expect(out.criticisms).toHaveLength(1);
    expect(out.shouldRevise).toBe(true);
  });

  it('LLM network error → ok:false, does not throw', async () => {
    (getAgentRun as ReturnType<typeof vi.fn>).mockResolvedValue(fakeRun);
    (listSteps as ReturnType<typeof vi.fn>).mockResolvedValue([fakeStep]);
    (resolveLlmClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      chat: vi.fn().mockRejectedValue(new Error('network timeout')),
    });

    const out = await critiqueLastAnswerTool.handler({}, fakeCtx);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/network timeout/);
  });

  it('LLM returns garbage → ok:false with parse error', async () => {
    (getAgentRun as ReturnType<typeof vi.fn>).mockResolvedValue(fakeRun);
    (listSteps as ReturnType<typeof vi.fn>).mockResolvedValue([fakeStep]);
    (resolveLlmClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      chat: vi.fn().mockResolvedValue({ content: 'this is not json at all !!', usage: {} }),
    });

    const out = await critiqueLastAnswerTool.handler({}, fakeCtx);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/parse failed/);
  });

  it('no prior steps → ok:false with "no prior step" error', async () => {
    (getAgentRun as ReturnType<typeof vi.fn>).mockResolvedValue(fakeRun);
    (listSteps as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const out = await critiqueLastAnswerTool.handler({}, fakeCtx);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/no prior step/);
  });

  it('no matching step with only plan/reply steps → ok:false', async () => {
    const planStep = { ...fakeStep, idx: 0, kind: 'plan' as const };
    const replyStep = { ...fakeStep, idx: 1, kind: 'reply' as const };
    (getAgentRun as ReturnType<typeof vi.fn>).mockResolvedValue(fakeRun);
    (listSteps as ReturnType<typeof vi.fn>).mockResolvedValue([planStep, replyStep]);

    const out = await critiqueLastAnswerTool.handler({}, fakeCtx);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/no prior step/);
  });

  it('targetStepIdx selects specific step', async () => {
    const step0 = { ...fakeStep, idx: 0, kind: 'tool_call' as const, output: { result: 'step0' } };
    const step1 = { ...fakeStep, idx: 1, kind: 'tool_call' as const, output: { result: 'step1' } };
    (getAgentRun as ReturnType<typeof vi.fn>).mockResolvedValue(fakeRun);
    (listSteps as ReturnType<typeof vi.fn>).mockResolvedValue([step0, step1]);

    const mockChat = vi.fn().mockResolvedValue({
      content: JSON.stringify({ criticisms: [], overallAssessment: 'ok', shouldRevise: false }),
      usage: {},
    });
    (resolveLlmClient as ReturnType<typeof vi.fn>).mockResolvedValue({ chat: mockChat });

    await critiqueLastAnswerTool.handler({ targetStepIdx: 0 }, fakeCtx);
    const chatArgs = mockChat.mock.calls[0];
    const userMsg = (chatArgs[0] as Array<{ role: string; content: string }>).find((m) => m.role === 'user')!;
    expect(userMsg.content).toContain('step[0]');
  });

  it('observe step is also critiqueable', async () => {
    const observeStep = { ...fakeStep, idx: 2, kind: 'observe' as const };
    (getAgentRun as ReturnType<typeof vi.fn>).mockResolvedValue(fakeRun);
    (listSteps as ReturnType<typeof vi.fn>).mockResolvedValue([observeStep]);
    (resolveLlmClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({ criticisms: [], overallAssessment: 'clean', shouldRevise: false }),
        usage: {},
      }),
    });

    const out = await critiqueLastAnswerTool.handler({}, fakeCtx);
    expect(out.ok).toBe(true);
    expect(out.shouldRevise).toBe(false);
  });

  it('AbortError → re-throws', async () => {
    (getAgentRun as ReturnType<typeof vi.fn>).mockResolvedValue(fakeRun);
    (listSteps as ReturnType<typeof vi.fn>).mockResolvedValue([fakeStep]);
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    (resolveLlmClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      chat: vi.fn().mockRejectedValue(abortErr),
    });

    await expect(critiqueLastAnswerTool.handler({}, fakeCtx)).rejects.toThrow('aborted');
  });

  it('passes signal to llm.chat', async () => {
    const ac = new AbortController();
    const ctxWithSignal = { ...fakeCtx, signal: ac.signal };
    (getAgentRun as ReturnType<typeof vi.fn>).mockResolvedValue(fakeRun);
    (listSteps as ReturnType<typeof vi.fn>).mockResolvedValue([fakeStep]);
    const mockChat = vi.fn().mockResolvedValue({
      content: JSON.stringify(critiqureResult),
      usage: {},
    });
    (resolveLlmClient as ReturnType<typeof vi.fn>).mockResolvedValue({ chat: mockChat });

    await critiqueLastAnswerTool.handler({}, ctxWithSignal);
    const opts = mockChat.mock.calls[0][1] as { signal: AbortSignal };
    expect(opts.signal).toBe(ac.signal);
  });

  it('focusAreas appended to user prompt', async () => {
    (getAgentRun as ReturnType<typeof vi.fn>).mockResolvedValue(fakeRun);
    (listSteps as ReturnType<typeof vi.fn>).mockResolvedValue([fakeStep]);
    const mockChat = vi.fn().mockResolvedValue({
      content: JSON.stringify({ criticisms: [], overallAssessment: 'ok', shouldRevise: false }),
      usage: {},
    });
    (resolveLlmClient as ReturnType<typeof vi.fn>).mockResolvedValue({ chat: mockChat });

    await critiqueLastAnswerTool.handler({ focusAreas: ['过度自信', '缺引用'] }, fakeCtx);
    const messages = mockChat.mock.calls[0][0] as Array<{ role: string; content: string }>;
    const userMsg = messages.find((m) => m.role === 'user')!;
    expect(userMsg.content).toContain('过度自信');
    expect(userMsg.content).toContain('缺引用');
  });
});
