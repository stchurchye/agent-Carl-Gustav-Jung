import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generatePlanWithLlm } from '../planner.js';
import { toolRegistry } from '../toolRegistry.js';
import { registerEchoSleep } from '../tools/echoSleep.js';
import type { AgentCheckpoint } from '../types.js';
import type { LlmChatClient, LlmChatMessage } from '../../llm/types.js';

/**
 * P0-S5:checkpoint 注入 planner 的双框架。
 * - continuation(自动续跑):沿用「自动续跑中 + 不要问是否继续」框架
 * - 非 continuation(steer/deny/critique/merge 重规划):中性「已有任务进展(供参考)」框架,
 *   不得给用户新指令套上「不要问是否继续」的陈旧续跑话术。
 */

function cp(): AgentCheckpoint {
  return {
    version: 1,
    goal: '研究荣格',
    intent: '文献综述',
    completed: [{ text: 'search_web', finding: '已找到 3 篇关键文献', refs: [] }],
    remainingPlan: ['写综述'],
    openQuestions: [],
    nextStep: '写综述',
    successCount: 1,
    producedAtIdx: 3,
    digestTail: '',
  };
}

function validPlanJson(): string {
  return JSON.stringify({
    intentSummary: 'x',
    steps: [{ toolName: 'echo_after_sleep', input: {}, reason: 'r', todoId: 't1' }],
    todos: [{ id: 't1', text: 't' }],
    finalReplyHint: '',
  });
}

function capturingLlm(): LlmChatClient & { userPrompt: () => string } {
  let captured = '';
  return {
    providerId: 'deepseek' as const,
    modelId: 'test',
    userPrompt: () => captured,
    async chat(messages: LlmChatMessage[]) {
      if (!captured) captured = messages.filter((m) => m.role === 'user').at(-1)?.content ?? '';
      return {
        content: validPlanJson(),
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        providerId: 'deepseek',
        modelId: 'test',
      };
    },
  } as never;
}

const snapshot = () =>
  ({
    systemPrompt: '',
    history: [],
    shortSummary: '',
    usage: { usedTokens: 0, limitTokens: 0, breakdown: {} },
    source: { channel: 'private' },
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  registerEchoSleep();
  void toolRegistry;
});

describe('P0-S5:checkpoint 双框架渲染', () => {
  it('checkpointIsContinuation=true(或缺省)→ 沿用「自动续跑中 + 不要问是否继续」', async () => {
    const llm = capturingLlm();
    await generatePlanWithLlm({
      inputText: 'x',
      snapshot: snapshot(),
      llm,
      signal: new AbortController().signal,
      checkpoint: cp(),
      checkpointIsContinuation: true,
    });
    expect(llm.userPrompt()).toContain('自动续跑中');
    expect(llm.userPrompt()).toContain('不要问');
    expect(llm.userPrompt()).toContain('已找到 3 篇关键文献');
  });

  it('checkpointIsContinuation=false → 中性「已有任务进展」框架,无「不要问是否继续」话术', async () => {
    const llm = capturingLlm();
    await generatePlanWithLlm({
      inputText: 'x',
      snapshot: snapshot(),
      llm,
      signal: new AbortController().signal,
      checkpoint: cp(),
      checkpointIsContinuation: false,
    });
    expect(llm.userPrompt()).toContain('已有任务进展');
    expect(llm.userPrompt()).not.toContain('自动续跑');
    expect(llm.userPrompt()).not.toContain('不要问');
    // 发现仍要带给 planner(避免重复搜索),且声明新指令优先
    expect(llm.userPrompt()).toContain('已找到 3 篇关键文献');
    expect(llm.userPrompt()).toContain('新指令');
  });
});

describe('K6:prior_research 注入', () => {
  beforeEach(() => registerEchoSleep());

  it('priorResearch 非空 → planner user prompt 含 <prior_research> 块', async () => {
    const llm = capturingLlm();
    await generatePlanWithLlm({
      inputText: '研究禀赋效应',
      snapshot: { systemPrompt: '', shortSummary: '', recentMessages: [] } as never,
      llm,
      signal: new AbortController().signal,
      priorResearch: '<prior_research>\n- 已有结论 X (来源: P url)\n</prior_research>',
    });
    expect(llm.userPrompt()).toContain('<prior_research>');
    expect(llm.userPrompt()).toContain('已有结论 X');
  });

  it('priorResearch 空 → 不出现该块', async () => {
    const llm = capturingLlm();
    await generatePlanWithLlm({
      inputText: '研究禀赋效应',
      snapshot: { systemPrompt: '', shortSummary: '', recentMessages: [] } as never,
      llm,
      signal: new AbortController().signal,
    });
    expect(llm.userPrompt()).not.toContain('<prior_research>');
  });
});
