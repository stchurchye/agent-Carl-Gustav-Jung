import { describe, expect, it } from 'vitest';
import { buildReplyMessages, generateFinalReply } from '../replyGen.js';
import type { AgentRun, AgentStep, Plan } from '../types.js';
import type { LlmChatClient, LlmChatResult } from '../../llm/types.js';
import { registerDocExportMarkdown } from '../tools/docExportMarkdown.js';

// M1f：fallback 路径 collectReplyRefs 依赖 toolRegistry 取 replyMeta.extractRef，
// 测试文件直接 register doc_export_markdown 以验证 fallback 仍能 surface 文档信息。
registerDocExportMarkdown();

function makeMockLlm(reply: () => Promise<string> | string): LlmChatClient {
  return {
    providerId: 'deepseek' as const,
    modelId: 'deepseek-v4-pro',
    async chat(_messages, _opts): Promise<LlmChatResult> {
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
  providerId: 'deepseek',
  modelId: 'deepseek-v4-pro',
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

describe('buildReplyMessages with checkpoint (S2)', () => {
  it('sources accumulated findings + refs from the checkpoint, not just last-6 steps', () => {
    // 一个长 run：早期发现（step-2 的 url）已折叠进 checkpoint.completed，
    // 但当前传入的 steps 不含它（模拟 last-N 窗口外）。终稿应仍引用它。
    const runWithCp: AgentRun = {
      ...baseRun,
      contextCheckpoint: {
        version: 1,
        goal: '研究家族信托并存档',
        intent: '研究家族信托',
        completed: [
          { text: 'fetch_url', finding: '权威来源给出信托三要素', refs: [{ kind: 'url', id: 'https://early-source.example/trust', label: '信托三要素' }] },
        ],
        remainingPlan: [],
        openQuestions: [],
        nextStep: 'FINALIZE',
        successCount: 3,
        producedAtIdx: 9,
        digestTail: '- run_python: {"result":{"ok":true,"stdout":"computed=42"}}',
      },
    };
    const msgs = buildReplyMessages({ run: runWithCp, plan, steps: [] });
    const user = msgs[1].content;
    expect(user).toContain('https://early-source.example/trust'); // 早期来源进了终稿
    expect(user).toContain('信托三要素');
    expect(user).toContain('computed=42'); // digestTail 的近窗细节
  });

  it('redacts secrets in tool output projection (S2d) — output value never reaches the reply LLM', () => {
    const SECRET = 'sk-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ';
    const steps: AgentStep[] = [
      stepBase({ idx: 1, kind: 'tool_call', toolName: 'fetch_url', output: { result: { ok: true, text: `leaked ${SECRET}` } } }),
    ];
    const msgs = buildReplyMessages({ run: baseRun, plan, steps });
    expect(msgs[1].content).not.toContain(SECRET);
    expect(msgs[1].content).toContain('[REDACTED');
  });

  it('omits empty-finding lines (silent tools) from the checkpoint digest but keeps their refs', () => {
    const runWithCp: AgentRun = {
      ...baseRun,
      contextCheckpoint: {
        version: 1, goal: 'g', intent: 'i',
        completed: [
          { text: 'render_diagram', finding: '', refs: [{ kind: 'diagram', id: 'd1', label: '架构图' }] },
          { text: 'fetch_url', finding: '读到了关键结论', refs: [] },
        ],
        remainingPlan: [], openQuestions: [], nextStep: '', successCount: 2, producedAtIdx: 5, digestTail: '',
      },
    };
    const user = buildReplyMessages({ run: runWithCp, plan, steps: [] })[1].content;
    expect(user).not.toContain('render_diagram: \n'); // 无空摘要噪声行
    expect(user).toContain('读到了关键结论');
    expect(user).toContain('架构图'); // silent 工具的 ref 仍在资源清单
  });
});

describe('buildReplyMessages', () => {
  it('formats user prompt with intent + recent tool digests + exported doc hint', () => {
    const steps: AgentStep[] = [
      stepBase({
        idx: 0,
        toolName: 'search_web',
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
    expect(msgs[1].content).toContain('search_web');
    expect(msgs[1].content).toContain('doc_export_markdown');
    expect(msgs[1].content).toContain('家族信托研究');
    expect(msgs[1].content).toContain('doc-1');
  });

  it('handles zero tool steps gracefully', () => {
    const msgs = buildReplyMessages({ run: baseRun, plan, steps: [] });
    expect(msgs[1].content).toContain('（无工具调用）');
  });
});

describe('generateFinalReply (LlmChatClient interface, M1e Task 11d)', () => {
  it('returns LLM response on success', async () => {
    const llm = makeMockLlm(() => '已为你研究家族信托，结果如下…');
    const out = await generateFinalReply({
      run: baseRun,
      plan,
      steps: [],
      llm,
      signal: new AbortController().signal,
    });
    expect(out).toContain('家族信托');
  });

  it('falls back when LLM throws, mentions exported docs', async () => {
    const llm = makeMockLlm(() => {
      throw new Error('down');
    });
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
      llm,
      signal: new AbortController().signal,
    });
    expect(out).toContain('TITLE');
    expect(out).toContain('研究家族信托');
  });
});
