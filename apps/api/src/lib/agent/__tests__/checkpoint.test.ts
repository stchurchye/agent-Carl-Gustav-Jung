import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildCheckpoint,
  compactCheckpointViaLlm,
  readLatestCheckpoint,
  type AgentCheckpoint,
} from '../checkpoint.js';
import type { AgentStep, TodoItem } from '../types.js';
import type { ToolDef } from '../toolRegistry.js';
import type { LlmChatClient, LlmChatResult } from '../../llm/types.js';

function mockLlm(reply: string): LlmChatClient {
  return {
    providerId: 'deepseek' as const,
    modelId: 'm',
    async chat(): Promise<LlmChatResult> {
      return { content: reply, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, providerId: 'deepseek', modelId: 'm' };
    },
  };
}
function throwingLlm(): LlmChatClient {
  return {
    providerId: 'deepseek' as const,
    modelId: 'm',
    async chat(): Promise<LlmChatResult> {
      throw new Error('llm down');
    },
  };
}
import { runMigrations } from '../../../db/migrate.js';
import * as store from '../store.js';
import { DEFAULT_BUDGET } from '../types.js';
import { ensureUser } from './_groupFixture.js';

/**
 * S1：累积式结构化 checkpoint（机械版，无 LLM）。
 * 跨步累积 completed（带 ref、按 ref.id/内容去重）、滤掉 soft-fail、carry successCount，
 * producedAtIdx 标记已折叠到的最大步 idx。
 */

let idCounter = 0;
function step(partial: Partial<AgentStep> & { idx: number; kind: AgentStep['kind'] }): AgentStep {
  return {
    id: `s${idCounter++}`,
    runId: 'run-1',
    toolName: null,
    toolCallKey: null,
    input: null,
    output: null,
    tokens: 0,
    durationMs: 0,
    error: null,
    byUserId: null,
    createdAt: new Date('2026-06-04T00:00:00Z'),
    ...partial,
  };
}

// 一个会从 output.result.url 抽 url ref 的假工具
const urlTool = {
  name: 'fetch_url',
  replyMeta: {
    summaryKind: 'text',
    extractRef: (raw: unknown) => {
      const url = (raw as { url?: string } | null)?.url;
      return url ? { kind: 'url' as const, id: url, label: 'page' } : null;
    },
  },
} as unknown as ToolDef;

const toolMap = new Map<string, ToolDef>([['fetch_url', urlTool]]);

const todos: TodoItem[] = [
  { id: 't1', text: '抓取来源', status: 'completed', stepRefs: [] },
  { id: 't2', text: '汇总', status: 'pending', stepRefs: [] },
];

describe('buildCheckpoint (mechanical)', () => {
  it('extracts a finding with ref from a successful tool_call and sets producedAtIdx', () => {
    const steps = [
      step({ idx: 0, kind: 'plan' }),
      step({
        idx: 1,
        kind: 'tool_call',
        toolName: 'fetch_url',
        output: { result: { ok: true, url: 'https://nsf.gov/sutton', title: 'Sutton' } },
      }),
    ];

    const cp: AgentCheckpoint = buildCheckpoint(null, steps, todos, {
      goal: '查 Sutton 的贡献',
      intent: '搜索并读权威来源',
      successCount: 1,
      toolMap,
    });

    expect(cp.goal).toBe('查 Sutton 的贡献');
    expect(cp.successCount).toBe(1);
    expect(cp.producedAtIdx).toBe(1);
    expect(cp.completed).toHaveLength(1);
    expect(cp.completed[0].refs).toEqual([
      { kind: 'url', id: 'https://nsf.gov/sutton', label: 'page' },
    ]);
    expect(cp.remainingPlan).toEqual(['汇总']); // 未完成的 todo
    expect(typeof cp.digestTail).toBe('string');
    expect(cp.nextStep).toBe('汇总'); // 机械 nextStep = 第一个未完成 todo
  });

  it('digestTail keeps recent output richer than the 200-char finding summary', () => {
    const longStdout = 'L'.repeat(800);
    const plainTool = { name: 'run_python', replyMeta: { summaryKind: 'text' } } as unknown as ToolDef;
    const map = new Map<string, ToolDef>([['run_python', plainTool]]);
    const cp = buildCheckpoint(
      null,
      [step({ idx: 1, kind: 'tool_call', toolName: 'run_python', output: { result: { ok: true, stdout: longStdout } } })],
      todos,
      { goal: 'g', intent: 'i', successCount: 1, toolMap: map },
    );
    // finding 摘要 ≤200 字；digestTail 保留更全（>200 个 L）
    expect(cp.completed[0].finding.length).toBeLessThanOrEqual(220);
    expect((cp.digestTail.match(/L/g) ?? []).length).toBeGreaterThan(300);
  });

  it('accumulates across builds and only folds steps after producedAtIdx (old findings preserved)', () => {
    const first = buildCheckpoint(
      null,
      [
        step({ idx: 1, kind: 'tool_call', toolName: 'fetch_url', output: { result: { ok: true, url: 'https://a.com' } } }),
      ],
      todos,
      { goal: 'g', intent: 'i', successCount: 1, toolMap },
    );
    expect(first.producedAtIdx).toBe(1);

    // 第二次：带 prior + 全量 steps（含已折叠的 idx=1 + 新的 idx=2）
    const second = buildCheckpoint(
      first,
      [
        step({ idx: 1, kind: 'tool_call', toolName: 'fetch_url', output: { result: { ok: true, url: 'https://a.com' } } }),
        step({ idx: 2, kind: 'tool_call', toolName: 'fetch_url', output: { result: { ok: true, url: 'https://b.com' } } }),
      ],
      todos,
      { goal: 'g', intent: 'i', successCount: 2, toolMap },
    );

    // 旧发现保留 + 新发现追加；idx=1 不被重复折叠
    expect(second.completed).toHaveLength(2);
    expect(second.completed.map((c) => c.refs[0]?.id)).toEqual(['https://a.com', 'https://b.com']);
    expect(second.producedAtIdx).toBe(2);
  });

  it('dedups findings by ref id (same source produced again is not duplicated)', () => {
    const first = buildCheckpoint(
      null,
      [step({ idx: 1, kind: 'tool_call', toolName: 'fetch_url', output: { result: { ok: true, url: 'https://a.com' } } })],
      todos,
      { goal: 'g', intent: 'i', successCount: 1, toolMap },
    );
    // 续跑里又抓了同一个 url（idx=2）
    const second = buildCheckpoint(
      first,
      [
        step({ idx: 1, kind: 'tool_call', toolName: 'fetch_url', output: { result: { ok: true, url: 'https://a.com' } } }),
        step({ idx: 2, kind: 'tool_call', toolName: 'fetch_url', output: { result: { ok: true, url: 'https://a.com' } } }),
      ],
      todos,
      { goal: 'g', intent: 'i', successCount: 2, toolMap },
    );
    expect(second.completed).toHaveLength(1); // 同 ref 不重复
  });

  it('does NOT dedup ref-less findings (distinct steps are distinct findings even if summary identical)', () => {
    // 无 extractRef 的工具：两次成功调用、输出相同 → 应是 2 条 finding（每步独立）
    const plainTool = { name: 'run_python', replyMeta: { summaryKind: 'text' } } as unknown as ToolDef;
    const map = new Map<string, ToolDef>([['run_python', plainTool]]);
    const cp = buildCheckpoint(
      null,
      [
        step({ idx: 1, kind: 'tool_call', toolName: 'run_python', output: { result: { ok: true, stdout: 'x' } } }),
        step({ idx: 2, kind: 'tool_call', toolName: 'run_python', output: { result: { ok: true, stdout: 'x' } } }),
      ],
      todos,
      { goal: 'g', intent: 'i', successCount: 2, toolMap: map },
    );
    expect(cp.completed).toHaveLength(2);
  });

  it('dedups a ref-less result against its idempotency cache-hit replay (same toolCallKey)', () => {
    const plainTool = { name: 'run_python', replyMeta: { summaryKind: 'text' } } as unknown as ToolDef;
    const map = new Map<string, ToolDef>([['run_python', plainTool]]);
    const cp = buildCheckpoint(
      null,
      [
        // 原始执行
        step({ idx: 1, kind: 'tool_call', toolName: 'run_python', toolCallKey: 'k1', output: { result: { ok: true, stdout: 'x' } } }),
        // 同 key 的缓存命中重放（observe）—— 同一逻辑结果，不该再计一条
        step({ idx: 2, kind: 'observe', toolName: 'run_python', toolCallKey: 'k1', output: { result: { ok: true, stdout: 'x' } } }),
      ],
      todos,
      { goal: 'g', intent: 'i', successCount: 2, toolMap: map },
    );
    expect(cp.completed).toHaveLength(1); // 按 toolCallKey 去重
  });

  it('folds successful observe (idempotency cache-hit) steps as findings', () => {
    const cp = buildCheckpoint(
      null,
      [
        step({
          idx: 1,
          kind: 'observe',
          toolName: 'fetch_url',
          output: { result: { ok: true, url: 'https://cached.com' } },
        }),
      ],
      todos,
      { goal: 'g', intent: 'i', successCount: 1, toolMap },
    );
    expect(cp.completed).toHaveLength(1);
    expect(cp.completed[0].refs[0]?.id).toBe('https://cached.com');
  });

  it('does not record a finding for a soft-failed tool step (ok:false / error)', () => {
    const cp = buildCheckpoint(
      null,
      [
        step({ idx: 1, kind: 'tool_call', toolName: 'fetch_url', error: 'HTTP 400', output: { result: { ok: false } } }),
        step({ idx: 2, kind: 'tool_call', toolName: 'fetch_url', output: { result: { ok: false } } }),
      ],
      todos,
      { goal: 'g', intent: 'i', successCount: 0, toolMap },
    );
    expect(cp.completed).toHaveLength(0);
  });
});

describe('compactCheckpointViaLlm (S4)', () => {
  const big: AgentCheckpoint = {
    version: 1, goal: '研究 X', intent: 'i',
    completed: Array.from({ length: 10 }, (_, i) => ({ text: `t${i}`, finding: `f${i}`, refs: [] })),
    remainingPlan: ['汇总'], openQuestions: [], nextStep: '汇总', successCount: 10, producedAtIdx: 20,
    digestTail: 'tail',
  };

  it('replaces completed with the LLM-compressed list, preserving goal/producedAtIdx/successCount/digestTail', async () => {
    const reply = JSON.stringify({
      completed: [
        { text: '搜索', finding: '合并后的关键发现', refs: [{ kind: 'url', id: 'https://x', label: 'p' }] },
      ],
      remainingPlan: ['汇总'],
      openQuestions: ['还需确认时间线'],
      nextStep: '汇总三要素',
    });
    const out = await compactCheckpointViaLlm({ checkpoint: big, llm: mockLlm(reply), signal: new AbortController().signal });
    expect(out.completed).toHaveLength(1);
    expect(out.completed[0].refs[0]?.id).toBe('https://x');
    expect(out.openQuestions).toEqual(['还需确认时间线']);
    expect(out.nextStep).toBe('汇总三要素');
    // 不变量保留
    expect(out.goal).toBe('研究 X');
    expect(out.producedAtIdx).toBe(20);
    expect(out.successCount).toBe(10);
    expect(out.digestTail).toBe('tail');
  });

  it('fail-open: LLM throws or returns garbage → returns the original checkpoint unchanged', async () => {
    const a = await compactCheckpointViaLlm({ checkpoint: big, llm: throwingLlm(), signal: new AbortController().signal });
    expect(a).toEqual(big);
    const b = await compactCheckpointViaLlm({ checkpoint: big, llm: mockLlm('not json at all'), signal: new AbortController().signal });
    expect(b).toEqual(big);
  });

  it('fail-open: LLM returns empty completed (would wipe all findings) → keeps original', async () => {
    const reply = JSON.stringify({ completed: [], remainingPlan: [], openQuestions: [], nextStep: 'FINALIZE' });
    const out = await compactCheckpointViaLlm({ checkpoint: big, llm: mockLlm(reply), signal: new AbortController().signal });
    expect(out).toEqual(big);
  });

  it('filters malformed refs from the LLM output (no undefined:undefined citations)', async () => {
    const reply = JSON.stringify({
      completed: [{ text: 't', finding: 'f', refs: [{ foo: 1 }, 'bogus', { kind: 'url', id: 'https://ok', label: 'p' }] }],
      remainingPlan: [], openQuestions: [], nextStep: 'x',
    });
    const out = await compactCheckpointViaLlm({ checkpoint: big, llm: mockLlm(reply), signal: new AbortController().signal });
    expect(out.completed[0].refs).toEqual([{ kind: 'url', id: 'https://ok', label: 'p' }]); // 仅合法 ref
  });

  it('fail-open when LLM output did not shrink (>= original count)', async () => {
    const more = JSON.stringify({
      completed: Array.from({ length: 12 }, (_, i) => ({ text: `t${i}`, finding: `f${i}`, refs: [] })),
      remainingPlan: [], openQuestions: [], nextStep: 'x',
    });
    const out = await compactCheckpointViaLlm({ checkpoint: big, llm: mockLlm(more), signal: new AbortController().signal });
    expect(out).toEqual(big); // 没变小 → 保原
  });

  it('re-attaches a ref-bearing finding the LLM dropped (sources are never lost)', async () => {
    const withRef: AgentCheckpoint = {
      ...big,
      completed: [
        { text: 'a', finding: 'fa', refs: [{ kind: 'url', id: 'https://keep', label: 'k' }] },
        { text: 'b', finding: 'fb', refs: [] },
        { text: 'c', finding: 'fc', refs: [] },
      ],
    };
    // LLM 压成 1 条、丢掉了带 ref 的来源
    const reply = JSON.stringify({
      completed: [{ text: 'merged', finding: '合并 b+c', refs: [] }],
      remainingPlan: [], openQuestions: [], nextStep: 'x',
    });
    const out = await compactCheckpointViaLlm({ checkpoint: withRef, llm: mockLlm(reply), signal: new AbortController().signal });
    const allRefIds = out.completed.flatMap((c) => c.refs.map((r) => r.id));
    expect(allRefIds).toContain('https://keep'); // 来源被补回
  });
});

/**
 * 行为 5（DB 列）：context_checkpoint jsonb 列往返 —— updateAgentRun 写、getAgentRun 读，
 * readLatestCheckpoint 取出结构一致。
 */
describe('context_checkpoint column round-trip', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  it('persists and reads back the checkpoint via the run column', async () => {
    const u = await ensureUser('ckpt');
    const run = await store.insertAgentRun({
      ownerId: u.id,
      channel: 'private',
      sessionId: null,
      groupId: null,
      topicId: null,
      intentTurnId: null,
      role: 'generalist',
      status: 'running',
      inputText: 'x',
      budget: DEFAULT_BUDGET,
      apiKeySource: 'server',
      apiKeyOwnerId: null,
    });
    expect(run.contextCheckpoint).toBeNull(); // 新 run 默认 null

    const cp: AgentCheckpoint = {
      version: 1,
      goal: '查 Sutton',
      intent: '搜索',
      completed: [{ text: 'fetch_url', finding: 'NSF page', refs: [{ kind: 'url', id: 'https://nsf.gov', label: 'p' }] }],
      remainingPlan: ['汇总'],
      openQuestions: [],
      nextStep: '读取来源',
      successCount: 1,
      producedAtIdx: 3,
      digestTail: 'recent output detail',
    };
    await store.updateAgentRun(run.id, { contextCheckpoint: cp });

    const reloaded = await store.getAgentRun(run.id);
    expect(readLatestCheckpoint(reloaded!)).toEqual(cp);
  });
});

/**
 * 行为 6（集成）：续跑触发时 runExecute 把 checkpoint 写进 run 列。
 * 复用 continuationReplan 的 harness：单 soft-fail 步 → 进 replanning → 列被写、goal=inputText。
 */
describe('runExecute writes checkpoint at continuation', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  it('populates run.contextCheckpoint when a continuation is triggered', async () => {
    const { randomUUID } = await import('crypto');
    const { toolRegistry } = await import('../toolRegistry.js');
    const probeName = 'ckpt_cont_' + randomUUID().slice(0, 8);
    toolRegistry.register({
      name: probeName,
      description: 'always soft-fail probe',
      inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
      approvalMode: 'auto',
      hasSideEffects: false,
      idempotent: false,
      async handler() {
        return { ok: false, error: 'simulated fail' };
      },
    } as unknown as ToolDef);

    const u = await ensureUser('ckptcont');
    const { createChatSession } = await import('../../../store/pg.js');
    const sess = await createChatSession(u.id, 'cc');
    const { createAgentRun } = await import('../runtime.js');
    const { run } = await createAgentRun({
      ownerId: u.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: 'investigate the topic',
      apiKey: 'fake',
      apiKeySource: 'server',
    });
    await store.updateAgentRun(run.id, {
      plan: {
        intentSummary: 'one failing step',
        steps: [{ toolName: probeName, input: { q: 'a' }, reason: 'p1', todoId: 't1' }],
        todos: [{ id: 't1', text: 'p1', status: 'pending', stepRefs: [] }],
        finalReplyHint: 'done',
        reasoning: null,
        version: 1,
      },
      todos: [{ id: 't1', text: 'p1', status: 'pending', stepRefs: [] }],
      status: 'running',
    });

    const { executeRun } = await import('../runExecute.js');
    await executeRun(run.id);

    const after = await store.getAgentRun(run.id);
    expect(after?.status).toBe('replanning');
    const cp = readLatestCheckpoint(after!);
    expect(cp).not.toBeNull();
    expect(cp!.goal).toBe('investigate the topic');
    expect(cp!.producedAtIdx).toBeGreaterThanOrEqual(0);
  });

  it('populates run.contextCheckpoint when a run completes WITHOUT continuation', async () => {
    const { randomUUID } = await import('crypto');
    const { toolRegistry } = await import('../toolRegistry.js');
    const probeName = 'ckpt_ok_' + randomUUID().slice(0, 8);
    toolRegistry.register({
      name: probeName,
      description: 'success probe',
      inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
      approvalMode: 'auto',
      hasSideEffects: false,
      idempotent: false,
      async handler() {
        return { ok: true, value: 'done-result' };
      },
    } as unknown as ToolDef);

    const u = await ensureUser('ckptok');
    const { createChatSession } = await import('../../../store/pg.js');
    const sess = await createChatSession(u.id, 'co');
    const { createAgentRun } = await import('../runtime.js');
    const { run } = await createAgentRun({
      ownerId: u.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: 'finish cleanly',
      apiKey: 'fake',
      apiKeySource: 'server',
    });
    await store.updateAgentRun(run.id, {
      plan: {
        intentSummary: 'one success step',
        steps: [{ toolName: probeName, input: { q: 'a' }, reason: 'p1', todoId: 't1' }],
        todos: [{ id: 't1', text: 'p1', status: 'pending', stepRefs: [] }],
        finalReplyHint: 'done',
        reasoning: null,
        version: 1,
      },
      todos: [{ id: 't1', text: 'p1', status: 'pending', stepRefs: [] }],
      status: 'running',
    });

    const { executeRun } = await import('../runExecute.js');
    await executeRun(run.id);

    const after = await store.getAgentRun(run.id);
    expect(after?.status).toBe('completed');
    const cp = readLatestCheckpoint(after!);
    expect(cp).not.toBeNull(); // 收尾也写了 checkpoint
    expect(cp!.completed.length).toBeGreaterThanOrEqual(1); // 成功步进了 completed
  });
});
