import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  generatePlanWithLlm,
  parsePlannerJson,
  PlannerJsonParseError,
} from '../planner.js';
import { toolRegistry } from '../toolRegistry.js';
import { registerEchoSleep } from '../tools/echoSleep.js';
import { registerWebSearch } from '../tools/webSearch.js';
import { registerFetchUrl } from '../tools/fetchUrl.js';
import { registerDocExportMarkdown } from '../tools/docExportMarkdown.js';
import type { AgentContextSnapshot } from '../contextAdapter.js';
import type { LlmChatClient, LlmChatMessage, LlmChatResult } from '../../llm/types.js';

/**
 * M1e Task 11d：planner 接 LlmChatClient 而非 raw apiKey。
 * 测试 mock 一个最小 LlmChatClient 即可（不再 mock deepseek wrapper）。
 */
function makeMockLlm(
  reply: () => Promise<string> | string,
): LlmChatClient & {
  calls: Array<{ messages: LlmChatMessage[]; signal: AbortSignal }>;
} {
  const calls: Array<{ messages: LlmChatMessage[]; signal: AbortSignal }> = [];
  return {
    providerId: 'deepseek' as const,
    modelId: 'deepseek-v4-pro',
    calls,
    async chat(messages, opts): Promise<LlmChatResult> {
      calls.push({ messages, signal: opts.signal });
      const content = await reply();
      return {
        content,
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        providerId: 'deepseek',
        modelId: 'deepseek-v4-pro',
      };
    },
  };
}

function snapshot(): AgentContextSnapshot {
  return {
    systemPrompt: 'system base prompt',
    history: [],
    shortSummary: '私聊会话，无历史',
    usage: {
      usedTokens: 0,
      limitTokens: 0,
      breakdown: { history: 0, system: 0, persona: 0 },
    } as never,
    source: { channel: 'private' },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // 注册所有 M1c 工具，让 parsePlannerJson 能识别
  registerEchoSleep();
  registerWebSearch();
  registerFetchUrl();
  registerDocExportMarkdown();
});

describe('parsePlannerJson', () => {
  it('parses a valid plan', () => {
    const raw = JSON.stringify({
      intentSummary: '研究家族信托',
      steps: [
        {
          toolName: 'search_web',
          input: { query: '家族信托' },
          reason: '先搜资料',
          todoId: 't1',
        },
        {
          toolName: 'doc_export_markdown',
          input: { title: '家族信托', markdown: '# todo' },
          reason: '产出文档',
          todoId: 't2',
        },
      ],
      todos: [
        { id: 't1', text: '搜资料' },
        { id: 't2', text: '写文档' },
      ],
      finalReplyHint: '简要回复 + 给文档链接',
    });
    const plan = parsePlannerJson(raw, toolRegistry.list());
    expect(plan).not.toBeNull();
    expect(plan!.steps.length).toBe(2);
    expect(plan!.todos.length).toBe(2);
    expect(plan!.todos.every((t) => t.status === 'pending')).toBe(true);
  });

  it('strips ```json fence', () => {
    const raw = '```json\n' +
      JSON.stringify({
        intentSummary: 'x',
        steps: [{ toolName: 'search_web', input: {}, reason: '', todoId: 't1' }],
        todos: [{ id: 't1', text: 't' }],
        finalReplyHint: '',
      }) +
      '\n```';
    expect(parsePlannerJson(raw, toolRegistry.list())).not.toBeNull();
  });

  it('rejects unknown toolName', () => {
    const raw = JSON.stringify({
      intentSummary: 'x',
      steps: [{ toolName: 'nonexistent_tool', input: {}, reason: '', todoId: 't1' }],
      todos: [{ id: 't1', text: 't' }],
      finalReplyHint: '',
    });
    expect(parsePlannerJson(raw, toolRegistry.list())).toBeNull();
  });

  it('rejects step.todoId not in todos', () => {
    const raw = JSON.stringify({
      intentSummary: 'x',
      steps: [{ toolName: 'search_web', input: {}, reason: '', todoId: 't9' }],
      todos: [{ id: 't1', text: 't' }],
      finalReplyHint: '',
    });
    expect(parsePlannerJson(raw, toolRegistry.list())).toBeNull();
  });

  it('rejects empty steps / non-object', () => {
    expect(parsePlannerJson('garbage', toolRegistry.list())).toBeNull();
    expect(
      parsePlannerJson(
        JSON.stringify({ intentSummary: 'x', steps: [], todos: [], finalReplyHint: '' }),
        toolRegistry.list(),
      ),
    ).toBeNull();
  });
});

describe('generatePlanWithLlm (LlmChatClient interface, M1e Task 11d)', () => {
  it('returns LLM-parsed plan on happy path', async () => {
    const llm = makeMockLlm(() =>
      JSON.stringify({
        intentSummary: '研究家族信托',
        steps: [
          {
            toolName: 'search_web',
            input: { query: '家族信托' },
            reason: 's',
            todoId: 't1',
          },
        ],
        todos: [{ id: 't1', text: 's' }],
        finalReplyHint: '',
      }),
    );
    const plan = await generatePlanWithLlm({
      inputText: '帮我研究家族信托',
      snapshot: snapshot(),
      llm,
      signal: new AbortController().signal,
    });
    expect(plan.steps[0].toolName).toBe('search_web');
    expect(plan.todos[0].id).toBe('t1');
    expect(llm.calls).toHaveLength(1);
    const { messages } = llm.calls[0]!;
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('search_web');
    expect(messages[1].content).toContain('帮我研究家族信托');
  });

  it('M1e review followup: LLM error propagates (caller handles fallback + notice)', async () => {
    const llm = makeMockLlm(() => {
      throw new Error('llm down');
    });
    // 之前是 silently fall back to echo plan，但那让 buildInitialPlan 的 emit-notice
    // 代码路径成了死代码。修复后：直接 throw，由 buildInitialPlan 决定 fallback + notice。
    await expect(
      generatePlanWithLlm({
        inputText: '跑两步 echo',
        snapshot: snapshot(),
        llm,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('llm down');
  });

  it('M1e review followup: invalid JSON throws PlannerJsonParseError (caller handles fallback)', async () => {
    const llm = makeMockLlm(() => 'not json at all');
    await expect(
      generatePlanWithLlm({
        inputText: '跑三步 echo',
        snapshot: snapshot(),
        llm,
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(PlannerJsonParseError);
  });

  it('propagates the caller-provided AbortSignal into llm.chat opts', async () => {
    const ctrl = new AbortController();
    const llm = makeMockLlm(() =>
      JSON.stringify({
        intentSummary: 'x',
        steps: [{ toolName: 'search_web', input: {}, reason: '', todoId: 't1' }],
        todos: [{ id: 't1', text: 't' }],
        finalReplyHint: '',
      }),
    );
    await generatePlanWithLlm({
      inputText: '搜索点东西',
      snapshot: snapshot(),
      llm,
      signal: ctrl.signal,
    });
    expect(llm.calls[0]!.signal).toBe(ctrl.signal);
  });
});
