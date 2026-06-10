import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  generatePlanWithLlm,
  parsePlannerJsonDetailed,
  PlannerJsonParseError,
  PlannerUnknownToolError,
} from '../planner.js';
import { toolRegistry } from '../toolRegistry.js';
import { registerEchoSleep } from '../tools/echoSleep.js';
import { registerWebSearch } from '../tools/webSearch.js';
import { registerDocExportMarkdown } from '../tools/docExportMarkdown.js';
import type { AgentContextSnapshot } from '../contextAdapter.js';
import type { LlmChatClient, LlmChatMessage, LlmChatResult } from '../../llm/types.js';

/**
 * issue 0005(P0-S4):plan 含未注册 toolName 时的优雅 replan 路径。
 * - parse 期区分「JSON 坏」vs「工具名未知」(PlannerUnknownToolError)
 * - generatePlanWithLlm 对未知工具名带原因**重试一次**;二次仍未知才抛
 * - 子 agent 用角色裁剪后的工具表,同样适用(AC ③)
 */

function planJson(toolName: string): string {
  return JSON.stringify({
    intentSummary: 'x',
    steps: [{ toolName, input: {}, reason: 'r', todoId: 't1' }],
    todos: [{ id: 't1', text: 't' }],
    finalReplyHint: '',
  });
}

function makeSeqLlm(replies: string[]): LlmChatClient & {
  calls: Array<{ messages: LlmChatMessage[] }>;
} {
  const calls: Array<{ messages: LlmChatMessage[] }> = [];
  return {
    providerId: 'deepseek' as const,
    modelId: 'deepseek-test',
    calls,
    async chat(messages): Promise<LlmChatResult> {
      calls.push({ messages });
      const content = replies[Math.min(calls.length - 1, replies.length - 1)];
      return {
        content,
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        providerId: 'deepseek',
        modelId: 'deepseek-test',
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

function plannerInput(llm: LlmChatClient, extra?: Partial<Parameters<typeof generatePlanWithLlm>[0]>) {
  return {
    inputText: '帮我研究荣格',
    snapshot: snapshot(),
    llm,
    signal: new AbortController().signal,
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  registerEchoSleep();
  registerWebSearch();
  registerDocExportMarkdown();
});

describe('parsePlannerJsonDetailed (issue 0005)', () => {
  it('未知 toolName → plan=null 且 unknownTools 点名', () => {
    const r = parsePlannerJsonDetailed(planJson('nonexistent_tool'), toolRegistry.list());
    expect(r.plan).toBeNull();
    expect(r.unknownTools).toEqual(['nonexistent_tool']);
  });

  it('合法 plan → unknownTools 为空', () => {
    const r = parsePlannerJsonDetailed(planJson('search_web'), toolRegistry.list());
    expect(r.plan).not.toBeNull();
    expect(r.unknownTools).toEqual([]);
  });

  it('JSON 坏/其他结构错误 → plan=null 且 unknownTools 为空(与未知工具区分)', () => {
    expect(parsePlannerJsonDetailed('garbage', toolRegistry.list())).toEqual({
      plan: null,
      unknownTools: [],
    });
  });
});

describe('generatePlanWithLlm:未知工具名 → 带原因重试一次 (issue 0005 AC①②)', () => {
  it('首次未知 → 重试 prompt 点名「不存在」的工具,二次合法 → 返回 plan', async () => {
    const llm = makeSeqLlm([planJson('risky_echo'), planJson('search_web')]);
    const plan = await generatePlanWithLlm(plannerInput(llm));
    expect(plan.steps[0].toolName).toBe('search_web');
    expect(llm.calls.length).toBe(2);
    const retryUserMsg =
      llm.calls[1].messages.filter((m) => m.role === 'user').at(-1)?.content ?? '';
    expect(retryUserMsg).toContain('risky_echo');
    expect(retryUserMsg).toContain('不存在');
  });

  it('二次仍未知 → 抛 PlannerUnknownToolError(写明工具名),不再重试', async () => {
    const llm = makeSeqLlm([planJson('risky_echo'), planJson('ghost_tool')]);
    const err = await generatePlanWithLlm(plannerInput(llm)).catch((e) => e);
    expect(err).toBeInstanceOf(PlannerUnknownToolError);
    expect((err as PlannerUnknownToolError).unknownTools).toEqual(['ghost_tool']);
    expect(llm.calls.length).toBe(2);
  });

  it('纯 JSON 坏(非未知工具)→ 仍抛 PlannerJsonParseError 且不重试(原契约不变)', async () => {
    const llm = makeSeqLlm(['not json at all']);
    await expect(generatePlanWithLlm(plannerInput(llm))).rejects.toBeInstanceOf(
      PlannerJsonParseError,
    );
    expect(llm.calls.length).toBe(1);
  });

  it('子 agent(researcher 角色裁剪表):注册表内但子集外的工具同样按未知处理 (AC③)', async () => {
    // doc_export_markdown 已注册,但不在 researcher 子集 → 对子 agent 视同未知 → 重试纠正
    const llm = makeSeqLlm([planJson('doc_export_markdown'), planJson('search_web')]);
    const plan = await generatePlanWithLlm(
      plannerInput(llm, { isSubagent: true, role: 'researcher' }),
    );
    expect(plan.steps[0].toolName).toBe('search_web');
    expect(llm.calls.length).toBe(2);
    const retryUserMsg =
      llm.calls[1].messages.filter((m) => m.role === 'user').at(-1)?.content ?? '';
    expect(retryUserMsg).toContain('doc_export_markdown');
  });
});
