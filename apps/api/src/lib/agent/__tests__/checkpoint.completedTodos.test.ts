import { describe, expect, it } from 'vitest';
import { buildCheckpoint } from '../checkpoint.js';
import { generatePlanWithLlm } from '../planner.js';
import { registerEchoSleep } from '../tools/echoSleep.js';
import type { AgentCheckpoint, TodoItem } from '../types.js';
import type { LlmChatClient, LlmChatMessage } from '../../llm/types.js';

/**
 * P0-S6(issue 0001 #2b 的轻解):checkpoint 累积 completedTodos —— 续跑 round2 重建时
 * round1 已完成 todo 不再丢(buildProgressSummary 只见当前轮 todos 的 KNOWN-LIMITATION)。
 */

const OPTS = {
  goal: 'g',
  intent: 'i',
  successCount: 0,
  toolMap: new Map(),
};

function todo(text: string, status: TodoItem['status']): TodoItem {
  return { id: text, text, status, stepRefs: [] };
}

describe('P0-S6:buildCheckpoint 累积 completedTodos(纯逻辑)', () => {
  it('首轮:当前轮已完成 todo 进 completedTodos', () => {
    const cp = buildCheckpoint(null, [], [todo('搜文献', 'completed'), todo('写综述', 'pending')], OPTS);
    expect(cp.completedTodos).toEqual(['搜文献']);
    expect(cp.remainingPlan).toEqual(['写综述']);
  });

  it('跨轮并集去重:prior 的 completedTodos 不丢,同文案不重复', () => {
    const prior = buildCheckpoint(null, [], [todo('搜文献', 'completed')], OPTS);
    // round2:todos 被 applyReplanningIfNeeded 清空重建,只剩新一轮的
    const cp2 = buildCheckpoint(prior, [], [todo('搜文献', 'completed'), todo('做对比', 'completed')], OPTS);
    expect(cp2.completedTodos).toEqual(['搜文献', '做对比']);
  });

  it('旧 checkpoint 行无 completedTodos 字段 → 容忍(可选字段零迁移)', () => {
    const legacy: AgentCheckpoint = {
      ...buildCheckpoint(null, [], [], OPTS),
      completedTodos: undefined,
    };
    const cp = buildCheckpoint(legacy, [], [todo('新活', 'completed')], OPTS);
    expect(cp.completedTodos).toEqual(['新活']);
  });

  it('文案 trim 去重:首尾空白差异不产生重复项', () => {
    const prior = buildCheckpoint(null, [], [todo('搜文献', 'completed')], OPTS);
    const cp = buildCheckpoint(prior, [], [todo(' 搜文献 ', 'completed')], OPTS);
    expect(cp.completedTodos).toEqual(['搜文献']);
  });

  it('compactCheckpointViaLlm 压缩后 completedTodos 原样保留(不送 LLM,不被覆盖)', async () => {
    const { compactCheckpointViaLlm } = await import('../checkpoint.js');
    const cp: AgentCheckpoint = {
      ...buildCheckpoint(null, [], [todo('搜文献', 'completed')], OPTS),
      completedTodos: ['搜文献', '做对比'],
    };
    const llm = {
      providerId: 'deepseek',
      modelId: 't',
      async chat() {
        return {
          content: JSON.stringify({
            completed: [],
            remainingPlan: [],
            openQuestions: [],
            nextStep: 'FINALIZE',
            // 即便 LLM 幻造该字段也不得污染跨轮累积
            completedTodos: ['LLM 幻造的'],
          }),
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      },
    } as unknown as LlmChatClient;
    const out = await compactCheckpointViaLlm({
      checkpoint: cp,
      llm,
      signal: new AbortController().signal,
    });
    expect(out.completedTodos).toEqual(['搜文献', '做对比']);
  });
});

describe('P0-S6:planner 渲染「已完成的 todo(不要重做)」段', () => {
  it('completedTodos 非空 → prompt 含该段', async () => {
    registerEchoSleep();
    let captured = '';
    const llm = {
      providerId: 'deepseek',
      modelId: 't',
      async chat(messages: LlmChatMessage[]) {
        if (!captured) captured = messages.filter((m) => m.role === 'user').at(-1)?.content ?? '';
        return {
          content: JSON.stringify({
            intentSummary: 'x',
            steps: [{ toolName: 'echo_after_sleep', input: {}, reason: 'r', todoId: 't1' }],
            todos: [{ id: 't1', text: 't' }],
            finalReplyHint: '',
          }),
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      },
    } as unknown as LlmChatClient;
    const cp: AgentCheckpoint = {
      version: 1,
      goal: 'g',
      intent: 'i',
      completed: [{ text: 'search_web', finding: 'f', refs: [] }],
      remainingPlan: ['写综述'],
      openQuestions: [],
      nextStep: '',
      successCount: 1,
      producedAtIdx: 1,
      digestTail: '',
      completedTodos: ['搜文献', '做对比'],
    };
    await generatePlanWithLlm({
      inputText: 'x',
      snapshot: {
        systemPrompt: '',
        history: [],
        shortSummary: '',
        usage: { usedTokens: 0, limitTokens: 0, breakdown: {} },
        source: { channel: 'private' },
      } as never,
      llm,
      signal: new AbortController().signal,
      checkpoint: cp,
      checkpointIsContinuation: true,
    });
    expect(captured).toContain('已完成的 todo');
    expect(captured).toContain('搜文献');
    expect(captured).toContain('做对比');
  });
});
