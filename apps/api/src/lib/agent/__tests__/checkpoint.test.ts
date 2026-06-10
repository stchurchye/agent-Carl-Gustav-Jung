import { describe, beforeAll, expect, it } from 'vitest';
import { describeDb } from '../../../testUtils/dbGuard.js';
import {
  buildCheckpoint,
  checkpointNeedsCompaction,
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

  it('finding 和 digestTail 都能充分保留大输出（v4 rich finding）', () => {
    // v4：text 工具的 finding 现在保留最多 2000 字（不再 200 字截断）
    // digestTail 保留最多 4000 字/步（8 步近窗）
    // 两者都比旧版 200 字上限更富，LLM 压缩器和 planner 都能看到更完整的内容。
    const longStdout = 'L'.repeat(3000);
    const plainTool = { name: 'run_python', replyMeta: { summaryKind: 'text' } } as unknown as ToolDef;
    const map = new Map<string, ToolDef>([['run_python', plainTool]]);
    const cp = buildCheckpoint(
      null,
      [step({ idx: 1, kind: 'tool_call', toolName: 'run_python', output: { result: { ok: true, stdout: longStdout } } })],
      todos,
      { goal: 'g', intent: 'i', successCount: 1, toolMap: map },
    );
    // finding 最多保留 2000 字（v4 rich finding）
    expect(cp.completed[0].finding.length).toBeLessThanOrEqual(2000);
    expect(cp.completed[0].finding.length).toBeGreaterThan(500); // 远超旧版 200
    // digestTail 最多保留 4000 字/步
    expect((cp.digestTail.match(/L/g) ?? []).length).toBeGreaterThan(500);
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

  it('does not re-fold a ref already in a prior MERGED multi-ref finding (review #4)', () => {
    // prior 里有一条 S4 压缩合并出的多-ref 发现 [A,B]
    const prior: AgentCheckpoint = {
      version: 1, goal: 'g', intent: 'i',
      completed: [{ text: 'merged', finding: 'A+B 合并', refs: [
        { kind: 'url', id: 'https://a.com', label: 'A' },
        { kind: 'url', id: 'https://b.com', label: 'B' },
      ] }],
      remainingPlan: [], openQuestions: [], nextStep: '', successCount: 2, producedAtIdx: 5, digestTail: '',
    };
    // 续跑里重抓了 B（非首 ref）
    const cp = buildCheckpoint(
      prior,
      [step({ idx: 6, kind: 'tool_call', toolName: 'fetch_url', output: { result: { ok: true, url: 'https://b.com' } } })],
      todos,
      { goal: 'g', intent: 'i', successCount: 3, toolMap },
    );
    expect(cp.completed).toHaveLength(1); // B 已被合并条目表示，不重折
  });

  it('keeps a distinct finding that shares ONE ref but carries a unique source (review #4 .every, not .some)', () => {
    // prior 里两条**不同结论**的发现，恰好共享来源 B：[A,B] 与 [B,C]。
    // （S4 LLM 压缩并不保证把 refs 在条目间无重叠地切分。）
    // 旧 `.some`：第二条因含已见的 B 被整条丢弃 → 唯一来源 C 永久丢失。
    const prior: AgentCheckpoint = {
      version: 1, goal: 'g', intent: 'i',
      completed: [
        { text: 'f1', finding: 'A+B 结论', refs: [
          { kind: 'url', id: 'https://a.com', label: 'A' },
          { kind: 'url', id: 'https://b.com', label: 'B' },
        ] },
        { text: 'f2', finding: 'B+C 另一结论', refs: [
          { kind: 'url', id: 'https://b.com', label: 'B' },
          { kind: 'url', id: 'https://c.com', label: 'C' },
        ] },
      ],
      remainingPlan: [], openQuestions: [], nextStep: '', successCount: 2, producedAtIdx: 5, digestTail: '',
    };
    const cp = buildCheckpoint(prior, [], todos, { goal: 'g', intent: 'i', successCount: 2, toolMap });
    expect(cp.completed).toHaveLength(2); // 两条都保留
    const allIds = cp.completed.flatMap((c) => c.refs.map((r) => r.id));
    expect(allIds).toContain('https://c.com'); // 仅在第二条出现的来源 C 不丢
  });

  it('K1:合成报告(synthesis)引用全部已被内容登记 → 仍保留(报告是新内容,不是来源的内容)', () => {
    const drTool = {
      name: 'deep_research',
      replyMeta: {
        summaryKind: 'text',
        checkpointFindingKind: 'synthesis',
        extractRefs: (raw: unknown) =>
          ((raw as { citations?: Array<{ kind: 'url'; id: string }> } | null)?.citations ?? []),
      },
    } as unknown as ToolDef;
    const map = new Map<string, ToolDef>([['fetch_url', urlTool], ['deep_research', drTool]]);
    const cp = buildCheckpoint(
      null,
      [
        // 父 run 先深读了 X(content 登记 url:X)
        step({ idx: 1, kind: 'tool_call', toolName: 'fetch_url', output: { result: { ok: true, url: 'https://x.com' } } }),
        // 随后 deep_research 的报告恰好只引用 X —— 报告本身是合成的新内容,不能被吞
        step({ idx: 2, kind: 'tool_call', toolName: 'deep_research', output: { result: { ok: true, report: '综合分析…', citations: [{ kind: 'url', id: 'https://x.com' }] } } }),
      ],
      todos,
      { goal: 'g', intent: 'i', successCount: 2, toolMap: map },
    );
    expect(cp.completed).toHaveLength(2);
    expect(cp.completed[1]!.kind).toBe('synthesis');
  });

  it('K1:synthesis 引用过的来源,之后被 fetch_url 深读 → 深读保留(引用≠内容已折叠)', () => {
    const drTool = {
      name: 'deep_research',
      replyMeta: {
        summaryKind: 'text',
        checkpointFindingKind: 'synthesis',
        extractRefs: (raw: unknown) =>
          ((raw as { citations?: Array<{ kind: 'url'; id: string }> } | null)?.citations ?? []),
      },
    } as unknown as ToolDef;
    const map = new Map<string, ToolDef>([['fetch_url', urlTool], ['deep_research', drTool]]);
    const cp = buildCheckpoint(
      null,
      [
        step({ idx: 1, kind: 'tool_call', toolName: 'deep_research', output: { result: { ok: true, report: 'R', citations: [{ kind: 'url', id: 'https://x.com' }] } } }),
        step({ idx: 2, kind: 'tool_call', toolName: 'fetch_url', output: { result: { ok: true, url: 'https://x.com' } } }),
      ],
      todos,
      { goal: 'g', intent: 'i', successCount: 2, toolMap: map },
    );
    expect(cp.completed).toHaveLength(2); // 深读不被 synthesis 的引用挡掉
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
        // 原始执行：key 在 toolCallKey 列
        step({ idx: 1, kind: 'tool_call', toolName: 'run_python', toolCallKey: 'k1', output: { result: { ok: true, stdout: 'x' } } }),
        // 缓存命中重放（observe）—— 生产形态：toolCallKey 列为 null，key 在 input.idempotencyKey
        step({ idx: 2, kind: 'observe', toolName: 'run_python', input: { cached: true, idempotencyKey: 'k1' }, output: { result: { ok: true, stdout: 'x' } } }),
      ],
      todos,
      { goal: 'g', intent: 'i', successCount: 2, toolMap: map },
    );
    expect(cp.completed).toHaveLength(1); // 按 toolCallKey 去重
  });

  it('redacts secrets in a ref id/label (URL carrying a credential) — review #1', () => {
    const cp = buildCheckpoint(
      null,
      [step({
        idx: 1, kind: 'tool_call', toolName: 'fetch_url',
        output: { result: { ok: true, url: 'https://host/data?api_key=sk-ant-abcdefghijklmnopqrstuvwxyz01' } },
      })],
      todos,
      { goal: 'g', intent: 'i', successCount: 1, toolMap },
    );
    const refId = cp.completed[0].refs[0]?.id ?? '';
    expect(refId).not.toContain('sk-ant-abcdefghijklmnopqrstuvwxyz01');
    expect(refId).toContain('[REDACTED');
    expect(refId).toContain('https://host/data'); // URL 结构保留、只刮密钥
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

describe('buildRichFinding per summaryKind (v4)', () => {
  it('text 工具：finding 保留最多 2000 字（远超旧版 200 字）', () => {
    const cp = buildCheckpoint(
      null,
      [step({ idx: 1, kind: 'tool_call', toolName: 'fetch_url',
        output: { result: { ok: true, url: 'https://x.com', content: 'A'.repeat(5000) } } })],
      todos,
      { goal: 'g', intent: 'i', successCount: 1, toolMap },
    );
    expect(cp.completed[0].finding.length).toBeGreaterThan(500); // 远超 200
    expect(cp.completed[0].finding.length).toBeLessThanOrEqual(2000);
  });

  it('silent 工具：finding 仍为空串', () => {
    const silentTool = {
      name: 'echo_after_sleep',
      replyMeta: { summaryKind: 'silent' },
    } as unknown as ToolDef;
    const map = new Map<string, ToolDef>([['echo_after_sleep', silentTool]]);
    const cp = buildCheckpoint(
      null,
      [step({ idx: 1, kind: 'tool_call', toolName: 'echo_after_sleep',
        output: { result: { ok: true, text: 'B'.repeat(5000) } } })],
      todos,
      { goal: 'g', intent: 'i', successCount: 1, toolMap: map },
    );
    expect(cp.completed[0].finding).toBe('');
  });

  it('export_ref 工具：finding 仍为固定标记（不因大输出变长）', () => {
    const exportTool = {
      name: 'doc_export_markdown',
      replyMeta: { summaryKind: 'export_ref' },
    } as unknown as ToolDef;
    const map = new Map<string, ToolDef>([['doc_export_markdown', exportTool]]);
    const cp = buildCheckpoint(
      null,
      [step({ idx: 1, kind: 'tool_call', toolName: 'doc_export_markdown',
        output: { result: { ok: true, docId: 'uuid-1234', content: 'C'.repeat(5000) } } })],
      todos,
      { goal: 'g', intent: 'i', successCount: 1, toolMap: map },
    );
    expect(cp.completed[0].finding).toBe('[已写入资源，详见下方资源清单]');
  });

  it('list 工具：finding 使用 summarizeStepOutput 提取 title（不截半原始 JSON）', () => {
    // search_web 输出通常 >2000 字；原始 JSON.stringify().slice(2000) 会断在 snippet 中间。
    // list-kind 应走 summarizeStepOutput 的 title 提取，结构干净、不产生残缺 JSON。
    const searchTool = {
      name: 'search_web',
      replyMeta: { summaryKind: 'list' },
    } as unknown as ToolDef;
    const map = new Map<string, ToolDef>([['search_web', searchTool]]);
    const manyResults = Array.from({ length: 5 }, (_, i) => ({
      url: `https://site${i}.com/very/long/path`,
      title: `研究结论 ${i}：维生素C的长期影响与临床证据`,
      snippet: 'S'.repeat(400), // 每条长 snippet
    }));
    const cp = buildCheckpoint(
      null,
      [step({ idx: 1, kind: 'tool_call', toolName: 'search_web',
        output: { result: { ok: true, results: manyResults } } })],
      todos,
      { goal: 'g', intent: 'i', successCount: 1, toolMap: map },
    );
    const finding = cp.completed[0].finding;
    // 应包含 title
    expect(finding).toContain('研究结论');
    // 不应是以 '{"result"' 开头的原始 JSON wrapper（说明 result 解包生效）
    expect(finding.startsWith('{"result"')).toBe(false);
    // R2-1 契约更新:结构化摘录(title — url + snippet≤200/条),带 url 供重规划深读;
    // 上限 = 5×(80 title + url + 200 snippet) ≈ 1.5K,仍在 finding 2000 字预算内。
    expect(finding).toContain('https://site0.com');
    expect(finding.length).toBeLessThan(1600);
  });
});

describe('buildDigestTail 扩容 (v4)', () => {
  const opts = { goal: 'g', intent: 'i', successCount: 0, toolMap };

  it('保留最近 8 步而不是 4 步', () => {
    // 10 步成功 tool_call → digest 应包含后 8 步（第 2-9 步），第 0-1 步被裁掉
    const steps = Array.from({ length: 10 }, (_, i) =>
      step({ idx: i, kind: 'tool_call', toolName: 'fetch_url',
        output: { result: { ok: true, url: `https://s${i}.com`, content: 'x' } } })
    );
    const cp = buildCheckpoint(null, steps, todos, opts);
    // 每步一行含 "fetch_url"；至少 8 行
    const lines = cp.digestTail.split('\n').filter(l => l.includes('fetch_url'));
    expect(lines.length).toBeGreaterThanOrEqual(8);
  });

  it('每步截断到 4000 字（不是 1500）', () => {
    const bigOutput = { result: { ok: true, content: 'A'.repeat(10000) } };
    const steps = [step({ idx: 1, kind: 'tool_call', toolName: 'fetch_url', output: bigOutput })];
    const cp = buildCheckpoint(null, steps, todos, opts);
    // 行内容（"fetch_url: " 之后的 JSON）应 ≤ 4100 字（4000 + 少量 JSON 结构开销）
    const payload = cp.digestTail.split('fetch_url: ')[1] ?? '';
    expect(payload.length).toBeLessThanOrEqual(4100);
    expect(payload.length).toBeGreaterThan(1500); // 比旧上限更大
  });

  it('每行带 [步骤 N] idx 标注（供 recall_step 定位）', () => {
    const steps = [
      step({ idx: 3, kind: 'tool_call', toolName: 'fetch_url', output: { result: { ok: true, url: 'https://x.com' } } }),
      step({ idx: 7, kind: 'tool_call', toolName: 'fetch_url', output: { result: { ok: true, url: 'https://y.com' } } }),
    ];
    const cp = buildCheckpoint(null, steps, todos, opts);
    expect(cp.digestTail).toContain('[步骤 3]');
    expect(cp.digestTail).toContain('[步骤 7]');
  });
});

describe('checkpointNeedsCompaction (S5)', () => {
  const base = {
    version: 1 as const, goal: 'g', intent: 'i', remainingPlan: [], openQuestions: [],
    nextStep: '', successCount: 0, producedAtIdx: 0, digestTail: '',
  };
  it('false for a small checkpoint', () => {
    expect(checkpointNeedsCompaction({ ...base, completed: [{ text: 't', finding: 'f', refs: [] }] })).toBe(false);
  });
  it('true when completed has ≥8 rich 2000-char findings (v4 threshold 15000)', () => {
    // v4：finding 现在最多 2000 字；阈值升至 15000（~7-8 条触发）
    const many = Array.from({ length: 8 }, (_, i) => ({ text: `tool${i}`, finding: 'A'.repeat(2000), refs: [] }));
    expect(checkpointNeedsCompaction({ ...base, completed: many })).toBe(true);
  });
  it('false when only 6 rich findings (12000 bytes < 15000 threshold)', () => {
    const few = Array.from({ length: 6 }, (_, i) => ({ text: `tool${i}`, finding: 'A'.repeat(2000), refs: [] }));
    expect(checkpointNeedsCompaction({ ...base, completed: few })).toBe(false);
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

  it('fail-open when re-attaching lost refs makes the result not smaller (review #3, convergence)', async () => {
    // 全 ref-bearing；LLM 返回更少条但丢了多数来源 → 补回后 >= 原始 → 该 fail-open 保原，
    // 否则 needsCompaction 恒真、每轮重压不收敛。
    const refful: AgentCheckpoint = {
      ...big,
      completed: Array.from({ length: 6 }, (_, i) => ({ text: `t${i}`, finding: `f${i}`, refs: [{ kind: 'url' as const, id: `https://s${i}.com`, label: `s${i}` }] })),
    };
    // LLM 返回 5 条但全丢 refs（首条留一个无关 ref）
    const reply = JSON.stringify({
      completed: Array.from({ length: 5 }, (_, i) => ({ text: `m${i}`, finding: `merged${i}`, refs: [] })),
      remainingPlan: [], openQuestions: [], nextStep: 'x',
    });
    const out = await compactCheckpointViaLlm({ checkpoint: refful, llm: mockLlm(reply), signal: new AbortController().signal });
    expect(out).toEqual(refful); // 补回 6 条丢失来源 → 5+6=11 >= 6 → fail-open
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

  it('accepts a same-count compaction that shrinks bytes (review #3 byte-metric, not count)', async () => {
    // 同条数但每条 finding 大幅变短 → 字节确实缩小、needsCompaction 会转假。
    // 旧"按条数"判据：6>=6 → 误判没缩小 → fail-open → 每轮重压、永不收敛。
    const longCp: AgentCheckpoint = {
      ...big,
      completed: Array.from({ length: 6 }, (_, i) => ({ text: `t${i}`, finding: '长'.repeat(300), refs: [] })),
    };
    const reply = JSON.stringify({
      completed: Array.from({ length: 6 }, (_, i) => ({ text: `t${i}`, finding: '短', refs: [] })),
      remainingPlan: [], openQuestions: [], nextStep: 'x',
    });
    const out = await compactCheckpointViaLlm({ checkpoint: longCp, llm: mockLlm(reply), signal: new AbortController().signal });
    expect(out.completed).toHaveLength(6);
    expect(out.completed[0].finding).toBe('短'); // 接受压缩，不再 fail-open
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
describeDb('context_checkpoint column round-trip', () => {
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
describeDb('runExecute writes checkpoint at continuation', () => {
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
