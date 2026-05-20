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
import {
  generatePlanWithLlm,
  parsePlannerJson,
  generatePlanForEcho,
} from '../planner.js';
import { toolRegistry } from '../toolRegistry.js';
import { registerEchoSleep } from '../tools/echoSleep.js';
import { registerWebSearch } from '../tools/webSearch.js';
import { registerUrlFetch } from '../tools/urlFetch.js';
import { registerDocExportMarkdown } from '../tools/docExportMarkdown.js';
import type { AgentContextSnapshot } from '../contextAdapter.js';

const chatCompletionRaw = vi.mocked(deepseek.chatCompletionRaw);

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
  registerUrlFetch();
  registerDocExportMarkdown();
});

describe('parsePlannerJson', () => {
  it('parses a valid plan', () => {
    const raw = JSON.stringify({
      intentSummary: '研究家族信托',
      steps: [
        {
          toolName: 'web_search',
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
        steps: [{ toolName: 'web_search', input: {}, reason: '', todoId: 't1' }],
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
      steps: [{ toolName: 'web_search', input: {}, reason: '', todoId: 't9' }],
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

describe('generatePlanWithLlm', () => {
  it('returns LLM-parsed plan on happy path', async () => {
    chatCompletionRaw.mockResolvedValue(
      JSON.stringify({
        intentSummary: '研究家族信托',
        steps: [
          {
            toolName: 'web_search',
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
      apiKey: 'fake',
    });
    expect(plan.steps[0].toolName).toBe('web_search');
    expect(plan.todos[0].id).toBe('t1');
    expect(chatCompletionRaw).toHaveBeenCalledOnce();
    const [, messages] = chatCompletionRaw.mock.calls[0]!;
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('web_search');
    expect(messages[1].content).toContain('帮我研究家族信托');
  });

  it('falls back to echo planner if LLM throws', async () => {
    chatCompletionRaw.mockRejectedValue(new Error('llm down'));
    const plan = await generatePlanWithLlm({
      inputText: '跑两步 echo',
      snapshot: snapshot(),
      apiKey: 'fake',
    });
    expect(plan.steps[0].toolName).toBe('echo_after_sleep');
    expect(plan.steps.length).toBe(generatePlanForEcho('跑两步 echo').steps.length);
  });

  it('falls back to echo planner if LLM returns invalid JSON', async () => {
    chatCompletionRaw.mockResolvedValue('not json at all');
    const plan = await generatePlanWithLlm({
      inputText: '跑三步 echo',
      snapshot: snapshot(),
      apiKey: 'fake',
    });
    expect(plan.steps[0].toolName).toBe('echo_after_sleep');
  });
});
