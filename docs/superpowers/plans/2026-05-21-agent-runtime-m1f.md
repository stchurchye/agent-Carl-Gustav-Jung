# Agent Runtime M1f Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 M1c/M1e review 推迟的 6 项 hardening 一次清完，让 M2 真工具洪水起步在干净底座上。

**Architecture:** 6 个独立小 task，按"先立接口 → 改 prompt → 工具 audit → 收尾"顺序进行。每个 task 一个 commit。TDD 用在新增逻辑（ToolReplyMeta、parsePlannerJson、tool ok 字段），direct-edit + 跑回归用在纯重构（awaiting_confirm 删、planner prompt 文本调整）。

**Tech Stack:** TypeScript / Vitest / Hono / pg / @eslint/eslintrc local rule

**前置：** `v0.m1e` 已 tag、`main` 261 tests 全绿、`docs/superpowers/specs/2026-05-21-agent-runtime-m1f-design.md` 已通过 review

---

## Task 0：baseline + branch

**Files:**
- N/A（git operations only）

- [ ] **Step 1: 确认 main 干净**

```bash
cd /Users/hongpengwang/行动中止派
git status
git log --oneline -3
```
Expected：`On branch main`、`nothing to commit`、最新 commit 是 `a789b2b docs(agent): M1f spec`。

- [ ] **Step 2: kill 任何残留 dev server**

```bash
pkill -f "tsx watch.*行动中止派" 2>/dev/null
ls /Users/hongpengwang/.cursor/projects/Users-hongpengwang/terminals
```
Expected：无 tsx 进程。terminals 文件夹里现有的可继续用。

- [ ] **Step 3: baseline tests + tsc 全绿**

```bash
set -a; source .env; set +a
npx -w @xzz/api vitest run 2>&1 | tail -5
npx tsc --noEmit -p apps/api
npx tsc --noEmit -p apps/mobile
```
Expected：`Tests  261 passed (261)`、tsc 无输出（成功）。

- [ ] **Step 4: 开 feature branch**

```bash
git checkout -b feat/agent-runtime-m1f
```

---

## Task 1：ToolReplyMeta + replyGen 解耦（spec #2）

**Files:**
- Modify: `apps/api/src/lib/agent/toolRegistry.ts`（加 `ToolReplyMeta` 类型 + `ToolDef.replyMeta` 字段）
- Modify: `apps/api/src/lib/agent/replyGen.ts`（`collectExportedDocs` → `collectReplyRefs`，按 `replyMeta` 派发）
- Modify: 6 个 tool 文件（每个补 `replyMeta`）
  - `apps/api/src/lib/agent/tools/echoSleep.ts`
  - `apps/api/src/lib/agent/tools/webSearch.ts`
  - `apps/api/src/lib/agent/tools/urlFetch.ts`
  - `apps/api/src/lib/agent/tools/magiSystemRead.ts`
  - `apps/api/src/lib/agent/tools/magiContentIngest.ts`
  - `apps/api/src/lib/agent/tools/docExportMarkdown.ts`
- Create: `apps/api/src/lib/agent/__tests__/replyMeta.test.ts`（新单测）
- Modify: `apps/api/src/lib/agent/__tests__/replyGen.test.ts`（适配新签名，加 multi-tool 用例）

### 1.1 写 ToolReplyMeta interface + collectReplyRefs 失败测试

- [ ] **Step 1: 在 toolRegistry.ts 加 ToolReplyMeta 类型 + ToolDef.replyMeta 字段**

修改 `apps/api/src/lib/agent/toolRegistry.ts`，在 `ToolDef` 上方加：

```ts
/**
 * M1f：把 replyGen 里硬编码的 `if (toolName === 'doc_export_markdown')` 模式
 * 反转过来 —— tool 自己声明"我应该怎么进 final reply"。
 *
 * - `summaryKind`：摘要策略；replyGen 按这个决定如何渲染 step.output。
 * - `extractRef`：当 tool 产出可引用 artifact（document/url/magi_card）时，
 *   返回结构化 ref，replyGen 统一渲染成"已写入文档：xxx (id: yyy)"之类。
 * - `failureHint`：失败时给 planner 看的提示文本（M1f Task 2 planner prompt
 *   引用此字段告诉 LLM 失败常见原因）。
 */
export type ToolReplyMeta = {
  summaryKind?: 'text' | 'list' | 'export_ref' | 'silent';
  extractRef?: (output: unknown) => {
    kind: 'document' | 'url' | 'magi_card';
    id: string;
    label?: string;
  } | null;
  failureHint?: string;
};
```

然后修改 `ToolDef` 加可选字段（紧跟 `handler` 之前）：

```ts
export type ToolDef<I = unknown, O = unknown> = {
  name: string;
  description: string;
  inputSchema: JSONSchema7;
  allowedRoles?: AgentRole[];
  approvalMode: ApprovalMode;
  costHint?: 'low' | 'medium' | 'high';
  hasSideEffects: boolean;
  idempotent: boolean;
  computeIdempotencyKey?: (input: I) => string;
  /** M1f：reply / planner prompt 用的工具元数据。可选，默认 'text'。 */
  replyMeta?: ToolReplyMeta;
  handler: (input: I, ctx: ToolCtx) => Promise<O>;
};
```

- [ ] **Step 2: 写 replyMeta.test.ts 单测覆盖新 `collectReplyRefs` 行为**

创建 `apps/api/src/lib/agent/__tests__/replyMeta.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import type { ToolDef } from '../toolRegistry.js';
import { collectReplyRefs, summarizeStepOutput } from '../replyGen.js';
import type { AgentStep } from '../types.js';

function fakeStep(toolName: string, output: unknown): AgentStep {
  return {
    id: `s-${toolName}`,
    runId: 'r',
    seq: 1,
    kind: 'observe',
    toolName,
    input: null,
    output,
    tokens: { prompt: 0, completion: 0 },
    durationMs: 0,
    error: null,
    toolCallKey: null,
    createdAt: new Date(),
  };
}

describe('M1f collectReplyRefs / summarizeStepOutput', () => {
  it('collectReplyRefs: doc_export_markdown emits document ref via replyMeta.extractRef', () => {
    const docTool: Pick<ToolDef, 'name' | 'replyMeta'> = {
      name: 'doc_export_markdown',
      replyMeta: {
        summaryKind: 'export_ref',
        extractRef: (o) => {
          const x = o as { documentId?: string; title?: string };
          return x.documentId
            ? { kind: 'document', id: x.documentId, label: x.title }
            : null;
        },
      },
    };
    const steps = [
      fakeStep('doc_export_markdown', { documentId: 'd1', title: '研究信托' }),
      fakeStep('web_search', { results: [] }),
    ];
    const refs = collectReplyRefs(steps, new Map([[docTool.name, docTool as ToolDef]]));
    expect(refs).toHaveLength(1);
    expect(refs[0]).toEqual({ kind: 'document', id: 'd1', label: '研究信托' });
  });

  it('collectReplyRefs: tools without replyMeta.extractRef are ignored', () => {
    const tool: Pick<ToolDef, 'name' | 'replyMeta'> = {
      name: 'echo_after_sleep',
      replyMeta: { summaryKind: 'silent' },
    };
    const refs = collectReplyRefs(
      [fakeStep('echo_after_sleep', { text: 'hi' })],
      new Map([[tool.name, tool as ToolDef]]),
    );
    expect(refs).toEqual([]);
  });

  it('summarizeStepOutput: list kind picks first 5 titles', () => {
    const out = {
      results: [
        { title: 't1' }, { title: 't2' }, { title: 't3' },
        { title: 't4' }, { title: 't5' }, { title: 't6' },
      ],
    };
    const summary = summarizeStepOutput(out, 'list');
    expect(summary).toContain('t1');
    expect(summary).toContain('t5');
    expect(summary).not.toContain('t6');
  });

  it('summarizeStepOutput: silent kind returns empty string', () => {
    expect(summarizeStepOutput({ anything: 'x' }, 'silent')).toBe('');
  });

  it('summarizeStepOutput: export_ref kind returns short marker only', () => {
    const s = summarizeStepOutput({ documentId: 'd1', title: 't' }, 'export_ref');
    expect(s).toMatch(/^\[已写入文档/);
  });

  it('summarizeStepOutput: default text kind truncates to 200 chars', () => {
    const long = 'x'.repeat(500);
    expect(summarizeStepOutput(long, 'text').length).toBeLessThanOrEqual(200);
  });
});
```

- [ ] **Step 3: 跑测试确认 fail**

```bash
npx -w @xzz/api vitest run src/lib/agent/__tests__/replyMeta.test.ts 2>&1 | tail -15
```
Expected：5-6 tests **fail**，错误信息含 `collectReplyRefs is not exported` 或类似。

### 1.2 重写 replyGen.ts

- [ ] **Step 4: 重写 `apps/api/src/lib/agent/replyGen.ts`**

完整替换文件内容：

```ts
import type { LlmChatClient, LlmChatMessage } from '../llm/types.js';
import type { AgentRun, AgentStep, Plan } from './types.js';
import { toolRegistry, type ToolDef, type ToolReplyMeta } from './toolRegistry.js';

const REPLY_SYSTEM = `你是 agent 任务的收尾发言人。
读取已完成的工具调用结果，用 1-3 段中文给用户回复：
- 简要总结做了什么、得到什么
- 如果生成了文档（doc_export_markdown），明确告知文档标题
- 别复述全部 raw 数据，只给关键结论
- 末尾不需要 emoji 或客套话`;

export type ReplyRef = {
  kind: 'document' | 'url' | 'magi_card';
  id: string;
  label?: string;
};

/**
 * M1f：取代原 `collectExportedDocs` 的硬编码 toolName 判断。遍历 steps，
 * 用每个 tool 的 `replyMeta.extractRef` 取结构化 ref。
 *
 * @param steps 一次 run 的所有 step（caller 通常已 filter 出 observe/tool_call）
 * @param toolMap toolName → ToolDef 的映射。生产里 caller 传
 *   `new Map(toolRegistry.list().map(t => [t.name, t]))`；测试可手 mock。
 */
export function collectReplyRefs(
  steps: AgentStep[],
  toolMap: Map<string, ToolDef>,
): ReplyRef[] {
  const refs: ReplyRef[] = [];
  for (const s of steps) {
    if (!s.toolName) continue;
    const tool = toolMap.get(s.toolName);
    const extractRef = tool?.replyMeta?.extractRef;
    if (!extractRef) continue;
    const raw =
      (s.output as { result?: unknown } | null)?.result ?? s.output;
    try {
      const ref = extractRef(raw);
      if (ref) refs.push(ref);
    } catch {
      // tool extractRef throw 不应让 reply 整体崩
    }
  }
  return refs;
}

/**
 * M1f：按 replyMeta.summaryKind 分发 step output 摘要策略。
 * - text（默认）：JSON.stringify 截断 200 字符
 * - list：尝试取 output.results / output.items 数组，列前 5 项 title
 * - export_ref：只返回短标记，详细信息在 ReplyRef 里
 * - silent：返回空串（caller 应跳过该行）
 */
export function summarizeStepOutput(
  out: unknown,
  kind: ToolReplyMeta['summaryKind'] = 'text',
): string {
  if (kind === 'silent') return '';
  if (kind === 'export_ref') return '[已写入文档，详见下方文档清单]';
  if (kind === 'list') {
    const arr =
      (out as { results?: unknown[]; items?: unknown[] } | null)?.results ??
      (out as { items?: unknown[] } | null)?.items;
    if (Array.isArray(arr)) {
      const titles = arr
        .slice(0, 5)
        .map((it) => {
          if (typeof it === 'string') return it.slice(0, 60);
          const t = (it as { title?: string })?.title;
          return typeof t === 'string' ? t.slice(0, 60) : '[item]';
        })
        .join('、');
      return titles || '(空列表)';
    }
    // fallback 到 text
  }
  if (out == null) return '(无输出)';
  if (typeof out === 'string') return out.slice(0, 200);
  try {
    return JSON.stringify(out).slice(0, 200);
  } catch {
    return '[unserializable]';
  }
}

/**
 * 拼终稿 LLM 输入：plan.intentSummary + 最近若干 tool_call output 摘要 + ref 清单 + plan.finalReplyHint。
 */
export function buildReplyMessages(params: {
  run: AgentRun;
  plan: Plan;
  steps: AgentStep[];
  /** M1f：测试 / 调用方可注入；默认从 toolRegistry 取。 */
  toolMap?: Map<string, ToolDef>;
}): LlmChatMessage[] {
  const { run, plan, steps } = params;
  const toolMap =
    params.toolMap ?? new Map(toolRegistry.list().map((t) => [t.name, t]));

  const toolSteps = steps.filter(
    (s) => s.kind === 'tool_call' || s.kind === 'observe',
  );
  const recent = toolSteps.slice(-6);

  const stepDigest = recent
    .map((s, i) => {
      const tool = s.toolName ?? 'unknown';
      const kind = toolMap.get(s.toolName ?? '')?.replyMeta?.summaryKind ?? 'text';
      const summary = summarizeStepOutput(s.output, kind);
      if (!summary) return null; // silent
      return `${i + 1}. ${tool}: ${summary}`;
    })
    .filter((line): line is string => line !== null)
    .join('\n');

  const refs = collectReplyRefs(steps, toolMap);
  const refLines = refs.length
    ? '\n\n已写入资源：\n' +
      refs.map((r) => `- [${r.kind}] ${r.label ?? r.id} (id: ${r.id})`).join('\n')
    : '';

  const user = `用户原始请求：${run.inputText}

执行目标：${plan.intentSummary}

工具调用摘要：
${stepDigest || '（无工具调用）'}${refLines}

最终回复风格提示：${plan.finalReplyHint || '简明、对话风格'}`;

  return [
    { role: 'system', content: REPLY_SYSTEM },
    { role: 'user', content: user },
  ];
}

/**
 * 让 LLM 生成 agent run 的最终回复内容。LLM 不可用 / 出错时返回 fallback 文本。
 */
export async function generateFinalReply(params: {
  run: AgentRun;
  plan: Plan;
  steps: AgentStep[];
  llm: LlmChatClient;
  signal: AbortSignal;
  toolMap?: Map<string, ToolDef>;
}): Promise<string> {
  const messages = buildReplyMessages(params);
  try {
    const result = await params.llm.chat(messages, {
      temperature: 0.4,
      maxTokens: 800,
      signal: params.signal,
    });
    return result.content;
  } catch {
    const toolMap =
      params.toolMap ?? new Map(toolRegistry.list().map((t) => [t.name, t]));
    const refs = collectReplyRefs(params.steps, toolMap);
    const refLine = refs.length
      ? `\n\n已写入：${refs.map((r) => r.label ?? r.id).join('、')}`
      : '';
    return `已完成 ${params.plan.intentSummary}。${refLine}`;
  }
}
```

- [ ] **Step 5: 跑新单测确认 pass**

```bash
npx -w @xzz/api vitest run src/lib/agent/__tests__/replyMeta.test.ts 2>&1 | tail -10
```
Expected：6 tests passed。

### 1.3 给 6 个工具补 replyMeta

- [ ] **Step 6: echoSleep.ts 补 replyMeta**

修改 `apps/api/src/lib/agent/tools/echoSleep.ts`，在 `idempotent: true,` 之后插入：

```ts
  replyMeta: { summaryKind: 'silent' },
```

- [ ] **Step 7: webSearch.ts 补 replyMeta**

修改 `apps/api/src/lib/agent/tools/webSearch.ts`，在 `idempotent: true,` 之后插入：

```ts
  replyMeta: {
    summaryKind: 'list',
    failureHint: '搜索可能限流或网络故障。可换关键词重试一次；连续失败请改走 magi_system_read 或直接给 finalReply。',
  },
```

- [ ] **Step 8: urlFetch.ts 补 replyMeta**

修改 `apps/api/src/lib/agent/tools/urlFetch.ts`，在 `idempotent: true,` 之后（`computeIdempotencyKey` 之前）插入：

```ts
  replyMeta: {
    summaryKind: 'text',
    failureHint: '该 URL 可能 404 / 超时 / 非 HTML。可跳过此 URL 用其他搜索结果，或换 web_search 重新搜更可靠的来源。',
  },
```

- [ ] **Step 9: magiSystemRead.ts 补 replyMeta**

修改 `apps/api/src/lib/agent/tools/magiSystemRead.ts`，在 `idempotent: true,` 之后插入：

```ts
  replyMeta: {
    summaryKind: 'text',
    failureHint: 'MAGI 内部 API 故障或未开启。可改用 web_search 走公开来源，或直接告诉用户 MAGI 暂不可用。',
  },
```

- [ ] **Step 10: magiContentIngest.ts 补 replyMeta**

修改 `apps/api/src/lib/agent/tools/magiContentIngest.ts`，在 `idempotent: false,` 之后（`computeIdempotencyKey` 之前）插入：

```ts
  replyMeta: {
    summaryKind: 'silent',
    extractRef: (output) => {
      const o = output as { title?: string; videoUrl?: string } | null;
      if (!o?.title) return null;
      return {
        kind: 'magi_card',
        id: o.videoUrl ?? o.title,
        label: o.title,
      };
    },
    failureHint: 'MAGI Content 写入失败可能是上游 5xx 或鉴权问题。可跳过本 URL 继续其它任务。',
  },
```

- [ ] **Step 11: docExportMarkdown.ts 补 replyMeta**

修改 `apps/api/src/lib/agent/tools/docExportMarkdown.ts`，在 `idempotent: true,` 之后（`computeIdempotencyKey` 之前）插入：

```ts
  replyMeta: {
    summaryKind: 'export_ref',
    extractRef: (output) => {
      const o = output as { documentId?: string; title?: string } | null;
      if (!o?.documentId) return null;
      return { kind: 'document', id: o.documentId, label: o.title };
    },
    failureHint: '文档写入失败一般是 DB 故障。可重试一次；如失败 2 次请直接在 finalReply 里把 markdown 内容贴出来给用户。',
  },
```

### 1.4 修旧 replyGen.test.ts + 跑全套

- [ ] **Step 12: 改 `apps/api/src/lib/agent/__tests__/replyGen.test.ts`**

老测试调 `buildReplyMessages({ run, plan, steps })`，无 toolMap → 默认从 registry 取（注册的工具都会被读到）。新签名兼容，旧用例无需改。如果跑测试时有任何 fail（多半是因为现在多了 ref 行 / silent step 行不再出现），按 fail 信息相应调整 expected 字符串。先跑：

```bash
npx -w @xzz/api vitest run src/lib/agent/__tests__/replyGen.test.ts 2>&1 | tail -20
```

如有 fail，按报错调整 `expect(...).toContain(...)` 串即可（不要回退实现）。

- [ ] **Step 13: 跑相关全测**

```bash
npx -w @xzz/api vitest run src/lib/agent/__tests__/replyMeta.test.ts src/lib/agent/__tests__/replyGen.test.ts src/lib/agent/__tests__/runtime.research.e2e.test.ts 2>&1 | tail -15
```
Expected：全 pass。

- [ ] **Step 14: tsc + lint**

```bash
npx tsc --noEmit -p apps/api 2>&1 | tail -5
```
Expected：无输出。

- [ ] **Step 15: 跑完整 api 测试套**

```bash
npx -w @xzz/api vitest run 2>&1 | tail -8
```
Expected：≥261 passed。

- [ ] **Step 16: commit**

```bash
git add -A
git commit -m "refactor(agent): ToolReplyMeta + replyGen 解耦硬编码 toolName (M1f #2)

- toolRegistry: ToolDef 加可选 replyMeta { summaryKind, extractRef, failureHint }
- replyGen: collectExportedDocs → collectReplyRefs（按 extractRef 派发）
- replyGen: 新 summarizeStepOutput 按 summaryKind 分发摘要策略
- 6 个 tool 补 replyMeta：echo silent / webSearch list / urlFetch text /
  magiRead text / magiIngest silent+ref / docExport export_ref+ref
- failureHint 为 Task 2 planner prompt 升级铺路"
```

---

## Task 2：planner prompt 升级（spec #1）

**Files:**
- Modify: `apps/api/src/lib/agent/planner.ts:155-197`（`PLANNER_INSTRUCTION` 文本 + `buildPlannerSystemPrompt` 引用 failureHint + `buildPlannerUserPrompt` 注入 previousFailure）
- Modify: `apps/api/src/lib/agent/__tests__/planner.test.ts`（加 prompt 内容断言）

### 2.1 加测试覆盖新 prompt 内容

- [ ] **Step 1: 加测试 `apps/api/src/lib/agent/__tests__/planner.test.ts`**

在文件末尾加：

```ts
import { _buildPlannerSystemPromptForTest, _buildPlannerUserPromptForTest } from '../planner.js';
import { toolRegistry } from '../toolRegistry.js';

describe('M1f planner prompt 升级 (#1)', () => {
  it('system prompt 含失败处理约定（ok=false / replan / 跳过工具）', () => {
    const sys = _buildPlannerSystemPromptForTest(toolRegistry.list());
    expect(sys).toMatch(/ok=false/);
    expect(sys).toMatch(/失败处理/);
    expect(sys).toMatch(/换参数重试|备选|跳过/);
  });

  it('system prompt 把每个 tool 的 replyMeta.failureHint 渲染出来', () => {
    const sys = _buildPlannerSystemPromptForTest(toolRegistry.list());
    // 至少 webSearch 有 failureHint，应该出现"限流"字样
    expect(sys).toMatch(/限流|网络故障/);
  });

  it('user prompt 在传 previousFailure 时包含失败原因 + 重新规划指示', () => {
    const usr = _buildPlannerUserPromptForTest({
      inputText: '继续',
      snapshot: { systemPrompt: '', shortSummary: '' } as never,
      previousFailure: 'web_search HTTP 429',
    });
    expect(usr).toMatch(/上一步失败原因/);
    expect(usr).toMatch(/web_search HTTP 429/);
    expect(usr).toMatch(/重新规划/);
  });
});
```

- [ ] **Step 2: 跑测试验证 fail**

```bash
npx -w @xzz/api vitest run src/lib/agent/__tests__/planner.test.ts 2>&1 | tail -15
```
Expected：3 个新测试 fail（`_build*ForTest` 还没 export、prompt 里没失败处理段、prompt 里没 failureHint）。

### 2.2 改 planner.ts

- [ ] **Step 3: 修改 `apps/api/src/lib/agent/planner.ts` PLANNER_INSTRUCTION**

把现有 `PLANNER_INSTRUCTION` 常量替换为：

```ts
const PLANNER_INSTRUCTION = `你是任务规划器。读取用户的请求，挑选下列工具组成一个最小可行的 plan。
只输出**严格 JSON**，不要任何解释、不要 markdown 围栏、不要多余字段。

JSON 结构必须是：
{
  "intentSummary": "一句话概括用户想要什么",
  "steps": [
    {
      "toolName": "<上面工具列表里的 name>",
      "input": { ...符合该工具 inputSchema 的对象... },
      "reason": "为什么这一步",
      "todoId": "t1"
    }
  ],
  "todos": [
    { "id": "t1", "text": "对用户可读的待办描述", "status": "pending", "stepRefs": [] }
  ],
  "finalReplyHint": "执行完成后给用户的回复风格提示"
}

约束：
- 每个 step.todoId 必须能在 todos 数组里找到对应 id
- 不要发明不存在的 toolName
- steps 数量控制在 1-6 之间
- 若任务完全是闲聊或单步问答，可只放 1 个 step

工具调用约定（必读）：
- 调用前阅读 tool description 的 inputSchema
- 收到 observation 时检查 \`ok\` 字段：ok=false 或 error 字段非空 → 当前 step 失败
- 失败处理：
  a. 可以换参数重试（如不同搜索词 / 备选 url）→ 在新 plan 里补一个相同 tool 的 step
  b. 该工具能力本身不可用（持续 4xx/5xx）→ 跳过该工具，用其他工具达成目标
  c. 整条路径不可行 → 把已查到的部分写成 reply，明确告诉用户「X 不可达」
- 不要忽略 ok=false 直接进下一步
`;
```

- [ ] **Step 4: 改 `buildPlannerSystemPrompt` 引用 failureHint**

替换函数实现：

```ts
function buildPlannerSystemPrompt(tools: ToolDef[]): string {
  const toolBlock = tools
    .map((t) => {
      const schema = JSON.stringify(t.inputSchema).slice(0, 400);
      const hint = t.replyMeta?.failureHint
        ? `\n  失败常见原因：${t.replyMeta.failureHint}`
        : '';
      return `- ${t.name}: ${t.description}\n  inputSchema: ${schema}${hint}`;
    })
    .join('\n');
  return `${PLANNER_INSTRUCTION}\n\n可用工具：\n${toolBlock}`;
}
```

- [ ] **Step 5: 改 LlmPlannerInput 加可选 previousFailure + buildPlannerUserPrompt 注入**

修改 `LlmPlannerInput` 类型加字段：

```ts
export type LlmPlannerInput = {
  inputText: string;
  snapshot: AgentContextSnapshot;
  llm: LlmChatClient;
  signal: AbortSignal;
  role?: string;
  /**
   * M1f #1：replan 场景下传入。让 LLM 知道上一步失败原因并避免重复同样错误。
   * caller（runPlanGlue / steer / approval_deny replan）按需填。
   */
  previousFailure?: string;
};
```

修改 `buildPlannerUserPrompt`：

```ts
function buildPlannerUserPrompt(input: LlmPlannerInput): string {
  const summary = input.snapshot.shortSummary
    ? `\n\n# 当前上下文摘要\n${input.snapshot.shortSummary}`
    : '';
  const failure = input.previousFailure
    ? `\n\n# 上一步失败原因\n${input.previousFailure}\n请基于这个失败重新规划剩余步骤，避免重复同样错误。`
    : '';
  return `# 用户请求\n${input.inputText}${summary}${failure}`;
}
```

- [ ] **Step 6: 在 planner.ts 文件末尾 export 测试 helper**

```ts
// =====================================================================
// M1f：仅测试用 export（避免污染主 API surface）
// =====================================================================
export const _buildPlannerSystemPromptForTest = buildPlannerSystemPrompt;
export const _buildPlannerUserPromptForTest = buildPlannerUserPrompt;
```

- [ ] **Step 7: 跑 planner 测试 + 全套**

```bash
npx -w @xzz/api vitest run src/lib/agent/__tests__/planner.test.ts src/lib/agent/__tests__/planner.llm.test.ts 2>&1 | tail -15
```
Expected：全 pass。

```bash
npx -w @xzz/api vitest run 2>&1 | tail -8
```
Expected：≥264 passed。

- [ ] **Step 8: commit**

```bash
git add -A
git commit -m "feat(agent): planner prompt 引入工具失败处理约定 + previousFailure 注入 (M1f #1)

- PLANNER_INSTRUCTION 加 ok=false 失败处理段：换参数 / 跳过工具 / 友好告知不可达
- buildPlannerSystemPrompt 渲染每个 tool 的 replyMeta.failureHint
- LlmPlannerInput 加 previousFailure 字段；buildPlannerUserPrompt 注入"上一步失败原因 + 重新规划"
- caller 待办：runPlanGlue/steer 等 replan 入口在 M1g obs-dx 接 previousFailure（M1f 只立 schema）"
```

---

## Task 3：工具 audit —— cancel signal + ok schema + ESLint rule（spec #3 + #5 合并）

**Files:**
- Modify: 6 个 tool 文件（补 `ok` 字段、补 `ctx.signal` 透传、`echoSleep.ts` 检查 abort 后置）
  - `apps/api/src/lib/agent/tools/echoSleep.ts`
  - `apps/api/src/lib/agent/tools/webSearch.ts`
  - `apps/api/src/lib/agent/tools/urlFetch.ts`
  - `apps/api/src/lib/agent/tools/magiSystemRead.ts`
  - `apps/api/src/lib/agent/tools/magiContentIngest.ts`
  - `apps/api/src/lib/agent/tools/docExportMarkdown.ts`
- Modify: 各 tool 对应测试文件 + 加新 ok-schema 用例
  - `apps/api/src/lib/agent/__tests__/tools.webSearch.test.ts`
  - `apps/api/src/lib/agent/__tests__/tools.urlFetch.test.ts`
  - `apps/api/src/lib/agent/__tests__/tools.magi.test.ts`
  - `apps/api/src/lib/agent/__tests__/tools.docExport.test.ts`
- Modify: `apps/api/src/lib/agent/runExecute.ts`（soft-fail 识别，把 `ok===false` 标到 step 的 warning/error）
- Create: `apps/api/eslint-rules/agent-tool-fetch-signal.js`（ESLint local rule）
- Modify: `apps/api/.eslintrc.cjs`（如不存在则创建）注册 local rule
- Create: `apps/api/src/lib/agent/tools/README.md`（tool 作者约定）

### 3.1 加 webSearch / urlFetch / magi ok 字段（TDD）

- [ ] **Step 1: 先改 webSearch ok schema 测试**

修改 `apps/api/src/lib/agent/__tests__/tools.webSearch.test.ts`，在文件末尾加：

```ts
describe('M1f webSearch ok schema (#5)', () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    process.env.TAVILY_API_KEY = 'sk-test';
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('happy path: output 含 ok: true', async () => {
    global.fetch = (async () =>
      new Response(JSON.stringify({ results: [{ title: 't', url: 'u', content: 'c' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as unknown as typeof fetch;
    const { webSearchTool } = await import('../tools/webSearch.js');
    const out = await webSearchTool.handler(
      { query: 'x' },
      { runId: 'r', stepId: 's', ownerId: 'o', channel: 'private', signal: new AbortController().signal } as never,
    );
    expect((out as { ok?: boolean }).ok).toBe(true);
  });

  it('Tavily 4xx: output 含 ok: false + error，不抛', async () => {
    global.fetch = (async () =>
      new Response('rate limit', { status: 429 })) as unknown as typeof fetch;
    const { webSearchTool } = await import('../tools/webSearch.js');
    const out = await webSearchTool.handler(
      { query: 'x' },
      { runId: 'r', stepId: 's', ownerId: 'o', channel: 'private', signal: new AbortController().signal } as never,
    );
    expect((out as { ok?: boolean; error?: string; results: unknown[] }).ok).toBe(false);
    expect((out as { error?: string }).error).toMatch(/429/);
    expect((out as { results: unknown[] }).results).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试 fail**

```bash
npx -w @xzz/api vitest run src/lib/agent/__tests__/tools.webSearch.test.ts 2>&1 | tail -15
```
Expected：2 个新测试 fail。

- [ ] **Step 3: 改 `apps/api/src/lib/agent/tools/webSearch.ts` 加 ok 字段**

把 `WebSearchOutput` 类型和 `handler` 替换为：

```ts
type WebSearchOutput = {
  ok: boolean;
  results: WebSearchHit[];
  note?: string;
  error?: string;
};
```

`handler` 实现替换为：

```ts
  async handler(input, ctx) {
    const apiKey = process.env.TAVILY_API_KEY?.trim();
    if (!apiKey) {
      return { ok: true, results: [], note: '搜索未配置（缺 TAVILY_API_KEY）' };
    }
    const maxResults = Math.max(1, Math.min(input.maxResults ?? 5, 10));
    try {
      const res = await fetch(TAVILY_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query: input.query,
          max_results: maxResults,
          search_depth: 'basic',
        }),
        signal: ctx.signal,
      });
      if (!res.ok) {
        return {
          ok: false,
          results: [],
          error: `Tavily HTTP ${res.status}`,
        };
      }
      const json = (await res.json()) as {
        results?: Array<{ title?: string; url?: string; content?: string }>;
      };
      const results: WebSearchHit[] = (json.results ?? []).map((r) => ({
        title: r.title ?? '',
        url: r.url ?? '',
        snippet: (r.content ?? '').slice(0, 300),
      }));
      return { ok: true, results };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e; // cancel 透传
      return {
        ok: false,
        results: [],
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
```

- [ ] **Step 4: 跑测试 pass**

```bash
npx -w @xzz/api vitest run src/lib/agent/__tests__/tools.webSearch.test.ts 2>&1 | tail -10
```
Expected：全 pass。

- [ ] **Step 5: 改 urlFetch ok schema + 测试**

先在 `apps/api/src/lib/agent/__tests__/tools.urlFetch.test.ts` 末尾加：

```ts
describe('M1f urlFetch ok schema (#5)', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('happy path: output 含 ok: true', async () => {
    global.fetch = (async () => new Response(
      '<html><body><article>hello world</article></body></html>',
      { status: 200, headers: { 'Content-Type': 'text/html' } },
    )) as unknown as typeof fetch;
    const { urlFetchTool } = await import('../tools/urlFetch.js');
    const out = await urlFetchTool.handler(
      { url: 'https://x.test/a' },
      { runId: 'r', stepId: 's', ownerId: 'o', channel: 'private', signal: new AbortController().signal } as never,
    );
    expect((out as { ok?: boolean }).ok).toBe(true);
  });

  it('404: output 含 ok: false + error，不抛', async () => {
    global.fetch = (async () => new Response('Not Found', { status: 404 })) as unknown as typeof fetch;
    const { urlFetchTool } = await import('../tools/urlFetch.js');
    const out = await urlFetchTool.handler(
      { url: 'https://x.test/missing' },
      { runId: 'r', stepId: 's', ownerId: 'o', channel: 'private', signal: new AbortController().signal } as never,
    );
    expect((out as { ok?: boolean }).ok).toBe(false);
    expect((out as { error?: string }).error).toMatch(/404/);
  });
});
```

跑测试确认 fail：

```bash
npx -w @xzz/api vitest run src/lib/agent/__tests__/tools.urlFetch.test.ts 2>&1 | tail -10
```

- [ ] **Step 6: 改 urlFetch.ts**

打开 `apps/api/src/lib/agent/tools/urlFetch.ts`，把 `UrlFetchOutput` 类型加 `ok` + `error`：

```ts
type UrlFetchOutput = {
  ok: boolean;
  url: string;
  title: string;
  excerpt: string;
  text: string;
  truncated: boolean;
  error?: string;
};
```

读完整 `handler` 内容（按 Read tool 拉一遍），在所有 `throw new Error('...')` 失败路径都改成 `return { ok: false, url: input.url, title: '', excerpt: '', text: '', truncated: false, error: '...' }`；在原 happy path return 处加 `ok: true`。content-type / size cap 失败也走这个 ok:false 路径，**除非是 AbortError**（cancel 必须透传）。

参考改法（具体行号以实际为准）：

```ts
  // 替换原 if (!res.ok) throw new Error(`HTTP ${res.status}`)
  if (!res.ok) {
    return {
      ok: false, url: input.url, title: '', excerpt: '', text: '', truncated: false,
      error: `HTTP ${res.status}`,
    };
  }
  // 替换原 if (!ALLOWED_CT.test(...)) throw ...
  if (!ALLOWED_CT.test(ct)) {
    return {
      ok: false, url: input.url, title: '', excerpt: '', text: '', truncated: false,
      error: `unsupported content-type: ${ct}`,
    };
  }
```

外层 try/catch 把 AbortError 透传，其他 error 转 `{ ok: false, error: ... }`。

跑测试 pass：

```bash
npx -w @xzz/api vitest run src/lib/agent/__tests__/tools.urlFetch.test.ts 2>&1 | tail -10
```
Expected：全 pass（包含 M1e 的 8 个原测 + 2 个新增 = 10 pass）。

- [ ] **Step 7: 改 magiSystemRead.ts + magiContentIngest.ts ok schema**

magiSystemRead：现有 catch 已经 return 友好文本，但缺 `ok` 字段。修改 `MagiSystemReadOutput`：

```ts
type MagiSystemReadOutput = {
  ok: boolean;
  answer: string;
  enabled: boolean;
  error?: string;
};
```

`handler` 修改：

```ts
  async handler(input) {
    const enabled = magiSystemEnabled();
    try {
      const answer = await queryMagiSystem(input.question);
      return { ok: true, answer, enabled };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        answer: `MAGI 查询失败：${msg}`,
        enabled,
        error: msg,
      };
    }
  },
```

magiContentIngest：现在直接抛错。改为：

```ts
type MagiContentIngestOutput = {
  ok: boolean;
  title: string;
  summary: string;
  videoUrl?: string;
  enabled: boolean;
  error?: string;
};
```

`handler`：

```ts
  async handler(input) {
    const enabled = magiContentEnabled();
    try {
      const res = await ingestMagiContent(input.url);
      return {
        ok: true,
        title: res.title,
        summary: res.summary,
        videoUrl: res.videoUrl,
        enabled,
      };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      return {
        ok: false,
        title: '',
        summary: '',
        enabled,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
```

- [ ] **Step 8: 给 magi 测试加 ok 字段断言**

在 `apps/api/src/lib/agent/__tests__/tools.magi.test.ts` 末尾加：

```ts
describe('M1f magi ok schema (#5)', () => {
  it('magiSystemRead happy: ok=true', async () => {
    process.env.MAGI_SYSTEM_ENABLED = 'true';
    const { magiSystemReadTool } = await import('../tools/magiSystemRead.js');
    // 现有 mock 让 queryMagiSystem 返回字符串
    const out = await magiSystemReadTool.handler(
      { question: 'x' },
      { runId: 'r', stepId: 's', ownerId: 'o', channel: 'private', signal: new AbortController().signal } as never,
    );
    expect((out as { ok?: boolean }).ok).toBeDefined();
  });
});
```

（具体根据现有 magi 测试 mock 形式调整。如果原测试有更精细的 stub，可在那基础上加 `expect(out.ok).toBe(true)` 一行。）

- [ ] **Step 9: echoSleep + docExportMarkdown 补 ok 字段**

echoSleep：返回值加 `ok: true`：

```ts
type EchoSleepOutput = {
  ok: boolean;
  text: string;
  sleptMs: number;
};
```

```ts
    return { ok: true, text: input.text, sleptMs: ms };
```

docExportMarkdown：成功路径加 `ok: true`（失败仍然抛错，因为 DB 失败属于 hard error）：

```ts
type DocExportMarkdownOutput = {
  ok: boolean;
  documentId: string;
  title: string;
  created: boolean;
};
```

两处 return（`return { documentId: docId, title: versionedTitle, created };`）改为：

```ts
    return { ok: true, documentId: docId, title: versionedTitle, created };
```

### 3.2 runExecute.ts 识别 ok=false

- [ ] **Step 10: 修改 runExecute.ts 在 tool invoke 后识别 ok=false**

读 `apps/api/src/lib/agent/runExecute.ts` 找到调 `tool.handler(input, ctx)` 之后写 observe step 的位置（grep `kind: 'observe'`）。在 recordStep 前加：

```ts
        // M1f #5：tool output { ok: false, error } 视为 soft-fail。
        // 不抛错（避免触发 hard-retry），但把 error 写到 step.error，
        // 下一轮 planner 能在 snapshot 里看到，也能给 critique 触发 replan。
        const softFailed =
          observation != null &&
          typeof observation === 'object' &&
          'ok' in observation &&
          (observation as { ok: unknown }).ok === false;
        const softError = softFailed
          ? ((observation as { error?: string }).error ?? 'soft-fail (ok=false)')
          : undefined;
```

把 `recordStep({ ..., kind: 'observe', output: observation, ... })` 调用加 `error: softError`。

（具体行号视 runExecute.ts 实际而定。`error: null` 改为 `error: softError ?? null`。）

- [ ] **Step 11: 加 runExecute 软失败 step 写入测试**

新文件 `apps/api/src/lib/agent/__tests__/runtime.softFail.test.ts`：

```ts
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import { toolRegistry, type ToolDef } from '../toolRegistry.js';

describe('M1f runtime soft-fail recognition (#5)', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  afterEach(() => {
    // 清理掉测试注册的临时 tool
    if (toolRegistry.get('softfail_probe')) {
      // toolRegistry 没暴露 delete；测试时绕过用其它 tool 同名注册即可，或忽略
    }
  });

  it('tool returns ok=false → observe step.error 被填、run 不 fail', async () => {
    const probe: ToolDef<{ q: string }, { ok: boolean; error?: string }> = {
      name: 'softfail_probe_' + randomUUID().slice(0, 6),
      description: 'probe tool that returns ok=false',
      inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
      approvalMode: 'auto',
      hasSideEffects: false,
      idempotent: true,
      async handler() {
        return { ok: false, error: 'simulated soft-fail' };
      },
    };
    toolRegistry.register(probe);

    // 走 mockRun 而非真 worker，因为我们只要验证 step.error 写入
    const { createUser, createChatSession } = await import('../../../store/pg.js');
    const { hashPassword } = await import('../../auth.js');
    const user = await createUser({
      username: 'sf-' + randomUUID().slice(0, 6),
      passwordHash: await hashPassword('xxxxxxxx'),
      displayName: 'sf',
    });
    const sess = await createChatSession(user.id, 'sf');
    const { createAgentRun } = await import('../runtime.js');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: 'echo 1 步',
      apiKey: '',
      apiKeySource: 'server',
    });
    // 直接给该 run 写一个 plan 用我们 probe tool
    const { getAgentRun, updateAgentRun, listSteps } = await import('../store.js');
    const dbRun = await getAgentRun(run.id);
    await updateAgentRun(run.id, {
      plan: {
        intentSummary: 'soft-fail probe',
        steps: [{ toolName: probe.name, input: { q: 'x' }, reason: 'probe', todoId: 't1' }],
        todos: [{ id: 't1', text: 'probe', status: 'pending', stepRefs: [] }],
        finalReplyHint: 'done',
        reasoning: null,
        version: 1,
      },
    });
    const refreshed = await getAgentRun(run.id);
    const { executeRun } = await import('../runExecute.js');
    await executeRun(refreshed!);

    const steps = await listSteps(run.id);
    const observe = steps.find((s) => s.kind === 'observe' && s.toolName === probe.name);
    expect(observe).toBeDefined();
    expect(observe?.error).toMatch(/simulated soft-fail/);
    // run 不应被标 failed —— soft-fail 只是 observation 标记，让 planner 决定
    const finalRun = await getAgentRun(run.id);
    expect(finalRun?.status).not.toBe('failed');
  });
});
```

跑 fail → pass 流程：

```bash
npx -w @xzz/api vitest run src/lib/agent/__tests__/runtime.softFail.test.ts 2>&1 | tail -10
```

如果测试细节因 runExecute 实际签名不符需要调整，按编译器/runtime 报错修。

### 3.3 cancel signal audit

- [ ] **Step 12: audit echoSleep**

`echoSleep.ts` 现状已经接 `ctx.signal.addEventListener('abort', ...)` 取消 setTimeout（参见 Read 时看到的实现），符合规范，不改。

- [ ] **Step 13: audit webSearch**

`webSearch.ts` 现状 `signal: ctx.signal` 已传给 fetch（Step 3 改 ok schema 时也保留了）。✅

- [ ] **Step 14: audit urlFetch**

`urlFetch.ts` 用内部 `AbortController` + `ctx.signal.addEventListener('abort', onOuterAbort, { once: true })` 串行 cancel。审一下 `onOuterAbort` 是否在 finally 里 removeEventListener，没有的话补：

```ts
    try {
      // ... fetch / read body
    } finally {
      clearTimeout(t);
      ctx.signal.removeEventListener('abort', onOuterAbort);
    }
```

（如果原代码已经是 finally 清理则跳过。）

- [ ] **Step 15: audit magi 工具**

magiSystemRead / magiContentIngest 内部分别调 `queryMagiSystem` / `ingestMagiContent`，看这两个函数是否接 `signal`：

```bash
grep -n "AbortSignal" apps/api/src/lib/integrations/magi.ts
```

如果不接，给函数签名加可选 `signal?: AbortSignal` 参数 + 透传到内部 fetch；同时 tool handler 调用时传 `ctx.signal`：

```ts
const answer = await queryMagiSystem(input.question, ctx.signal);
```

如果 magi.ts 本身没 fetch（只是 mock / stub），加 `if (ctx.signal.aborted) throw new Error('aborted')` 防御即可。

- [ ] **Step 16: docExportMarkdown audit**

`docExportMarkdown` 全是 DB 操作（pg driver），无 fetch。在 handler 起始处加防御性 check：

```ts
  async handler(input, ctx) {
    if (ctx.signal.aborted) throw new Error('aborted');
    // ... 现有逻辑
    if (ctx.signal.aborted) throw new Error('aborted'); // 在 createDocument 调用前再 check 一次
    // ... 现有逻辑
```

（粒度按"长 await 之间穿插 1-2 个 check"。）

### 3.4 ESLint local rule

- [ ] **Step 17: 写 ESLint rule 文件**

创建 `apps/api/eslint-rules/agent-tool-fetch-signal.js`：

```js
'use strict';

/**
 * M1f #3：禁止 apps/api/src/lib/agent/tools/ 下的 fetch() 调用不带 signal。
 * 用户 cancel 后工具还在跑 = 浪费 token + race conditions。
 *
 * 检测：CallExpression callee 是 `fetch`，且第二个参数（options object）里没有
 * `signal` 属性 → 报错。
 *
 * 故意宽容：node-fetch 风格的 fetch(url) 单参不报，因为可能是 GET 而要求所有
 * 工具 fetch 都至少传两参太死板。Tool 作者自己保证多参时带 signal 即可。
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'agent tool 内的 fetch() 必须传 signal',
      category: 'Possible Errors',
    },
    schema: [],
    messages: {
      missingSignal:
        'agent/tools/ 下的 fetch() 必须在 options 对象里传 signal: ctx.signal（或一个绑了 ctx.signal 的 AbortController.signal）。否则 cancelRun 后工具不会停。',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee.type !== 'Identifier' ||
          node.callee.name !== 'fetch'
        ) {
          return;
        }
        // fetch(url) 单参不检查
        if (node.arguments.length < 2) return;
        const opts = node.arguments[1];
        if (opts.type !== 'ObjectExpression') return; // 动态参数，让人工 audit
        const hasSignal = opts.properties.some((p) => {
          if (p.type !== 'Property') return false;
          if (p.key.type === 'Identifier' && p.key.name === 'signal') return true;
          if (p.key.type === 'Literal' && p.key.value === 'signal') return true;
          return false;
        });
        if (!hasSignal) {
          context.report({ node, messageId: 'missingSignal' });
        }
      },
    };
  },
};
```

- [ ] **Step 18: 注册 local rule 到 eslint config**

先看现有配置：

```bash
ls apps/api/.eslintrc* apps/api/eslint.config.* 2>/dev/null
cat apps/api/package.json | grep -A3 lint
```

如果有 `apps/api/eslint.config.js`（flat config），加：

```js
import agentToolFetchSignal from './eslint-rules/agent-tool-fetch-signal.js';

export default [
  // ... existing
  {
    files: ['src/lib/agent/tools/**/*.ts'],
    plugins: {
      'agent-tool-rules': {
        rules: { 'fetch-signal': agentToolFetchSignal },
      },
    },
    rules: {
      'agent-tool-rules/fetch-signal': 'error',
    },
  },
];
```

如果是老的 `.eslintrc.cjs`，改用 CommonJS：

```js
module.exports = {
  // ... existing
  overrides: [
    {
      files: ['src/lib/agent/tools/**/*.ts'],
      plugins: ['local'],
      rules: {
        'local/agent-tool-fetch-signal': 'error',
      },
    },
  ],
  // 同时确保 plugins.local 走本地 rules 目录（用 eslint-plugin-local-rules 或类似机制；
  // 如 monorepo 已配，按既有方式）
};
```

如果 apps/api 当前完全没有 ESLint 配置（rg 没找到），跳过这步，把 lint rule 文件留作 docs 引用，并在 README 里说"未来 lint pipeline 建立后启用"。在 commit message 里 noted。

- [ ] **Step 19: 跑 lint 验证 rule 生效**

```bash
npx -w @xzz/api eslint 'src/lib/agent/tools/**/*.ts' 2>&1 | tail -10
```
Expected：如果配上了，无 error（因为我们已经 audit 过 6 个工具）。

- [ ] **Step 20: 创建 `apps/api/src/lib/agent/tools/README.md`**

```markdown
# Agent Tool 作者约定 (M1f)

写新工具前必读。

## 1. cancel signal

所有 IO 调用必须接 `ctx.signal`：

- `fetch(url, { signal: ctx.signal })`
- `setTimeout` 用 `ctx.signal.addEventListener('abort', () => clearTimeout(t), { once: true })` 包
- DB 操作 / 长循环：在每轮 await 之间 `if (ctx.signal.aborted) throw new Error('aborted')`

ESLint local rule `agent-tool-rules/fetch-signal` 会拦不带 signal 的 fetch。

## 2. output 形如 `{ ok, ... }`

- 成功路径：`return { ok: true, ...data }`
- 软失败（外部 4xx / 超时 / 限流）：`return { ok: false, error: '...', ...partialData }`
- 硬失败（DB 故障 / 内部 bug）：`throw new Error(...)`，runtime 会重试 1 次后 fail run

runtime 会识别 `ok === false` → 写 step.error，planner 下轮能在 snapshot 里看到。

## 3. replyMeta（可选但推荐）

```ts
replyMeta: {
  summaryKind: 'text' | 'list' | 'export_ref' | 'silent',
  extractRef: (output) => { kind, id, label } | null,
  failureHint: '失败常见原因 + 重试建议',
}
```

planner system prompt 会渲染 failureHint，replyGen 会按 summaryKind 决定摘要策略，extractRef 会聚合到 final reply 的"已写入资源"段。

## 4. idempotency

`hasSideEffects: true` 的工具必须实现 `computeIdempotencyKey(input)`，runtime 会按 `${ownerId}:${key}` 防同 run 重复。

## 5. approvalMode

- `auto`：自动跑
- `ask`：跑前要用户授权（mobile 弹窗）
- `never`：禁用（占位）
```

### 3.5 全测 + commit

- [ ] **Step 21: 跑全 api 测试套**

```bash
npx -w @xzz/api vitest run 2>&1 | tail -8
```
Expected：≥267 passed（新增 webSearch×2、urlFetch×2、magi×1、softFail×1）。

- [ ] **Step 22: tsc clean**

```bash
npx tsc --noEmit -p apps/api
```

- [ ] **Step 23: commit**

```bash
git add -A
git commit -m "fix(agent): tool ok schema + cancel signal audit + ESLint local rule (M1f #3 #5)

- 6 个工具统一 output { ok, ... } schema：
  - webSearch/urlFetch/magiSystemRead/magiContentIngest：HTTP 失败不再 throw，
    return { ok:false, error } 让 planner 可识别（AbortError 仍透传）
  - echoSleep/docExportMarkdown：成功路径加 ok:true
- runExecute 识别 ok===false → 写 step.error（不 fail run，让 planner 决定 replan）
- 6 个工具 cancel signal audit：echoSleep/webSearch/urlFetch 已有，magi 工具加 signal 透传 + 防御 abort check，docExport 在长 await 间加 abort check
- 新增 ESLint local rule agent-tool-fetch-signal：拦截 agent/tools/** 下 fetch() 不带 signal
- 新增 apps/api/src/lib/agent/tools/README.md tool 作者约定"
```

---

## Task 4：parsePlannerJson 宽容化（spec #4）

**Files:**
- Modify: `apps/api/src/lib/agent/planner.ts:220-260`（`tryParseJson` + `extractJsonCandidate`）
- Modify: `apps/api/src/lib/agent/__tests__/planner.test.ts`（加污染样本表驱动测试）

### 4.1 写污染样本表驱动测试

- [ ] **Step 1: 在 planner.test.ts 末尾加 dirty input 测试套**

```ts
describe('M1f parsePlannerJson 宽容化 (#4)', () => {
  const validBody = `{
  "intentSummary": "test",
  "steps": [{"toolName":"echo_after_sleep","input":{"text":"hi"},"reason":"x","todoId":"t1"}],
  "todos": [{"id":"t1","text":"t","status":"pending","stepRefs":[]}],
  "finalReplyHint": "done"
}`;

  const cases: Array<{ name: string; raw: string }> = [
    { name: 'fenced ```json block', raw: '```json\n' + validBody + '\n```' },
    { name: 'fenced ``` block (no language)', raw: '```\n' + validBody + '\n```' },
    { name: 'leading prose then JSON', raw: "Here's the plan:\n" + validBody },
    { name: 'trailing prose after JSON', raw: validBody + '\n\nLet me know if you need more.' },
    { name: 'trailing comma in steps[]', raw: validBody.replace(']\n  ,\n  "todos"', '],\n  "todos"').replace('"finalReplyHint": "done"\n}', '"finalReplyHint": "done",\n}') },
    { name: 'CRLF line endings', raw: validBody.replace(/\n/g, '\r\n') },
  ];

  it.each(cases)('parses dirty input: $name', async ({ raw }) => {
    const { parsePlannerJson } = await import('../planner.js');
    const tools = (await import('../toolRegistry.js')).toolRegistry.list();
    const plan = parsePlannerJson(raw, tools);
    expect(plan).not.toBeNull();
    expect(plan?.intentSummary).toBe('test');
  });

  it('still returns null on pure garbage', async () => {
    const { parsePlannerJson } = await import('../planner.js');
    const tools = (await import('../toolRegistry.js')).toolRegistry.list();
    expect(parsePlannerJson('hello world this is not json', tools)).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试 fail**

```bash
npx -w @xzz/api vitest run src/lib/agent/__tests__/planner.test.ts -t 'M1f parsePlannerJson' 2>&1 | tail -15
```
Expected：5-6 个用例 fail（现有 `tryParseJson` 只剥简单 ```json 围栏；prose / trailing-comma / CRLF 没处理）。

### 4.2 改 tryParseJson

- [ ] **Step 3: 重写 `tryParseJson` 函数**

替换 `apps/api/src/lib/agent/planner.ts` 里现有 `tryParseJson` 为：

```ts
/**
 * M1f #4：宽容解析 LLM 输出。处理常见污染：
 * - markdown 围栏（```json / ``` 都剥）
 * - 前后散文（截取第一个 { 到对应 } 的子串）
 * - 尾随逗号（,} → } / ,] → ]）
 * - CRLF（normalize 到 LF）
 *
 * 不引入 JSON5；只做 regex / bracket-counter 预处理 + 一次 JSON.parse。
 */
function tryParseJson(raw: string): LoosePlan | null {
  const candidate = extractJsonCandidate(raw);
  if (!candidate) return null;
  try {
    const v = JSON.parse(candidate) as LoosePlan;
    if (!v || typeof v !== 'object') return null;
    return v;
  } catch {
    return null;
  }
}

function extractJsonCandidate(raw: string): string | null {
  // 1. CRLF → LF
  let s = raw.replace(/\r\n/g, '\n').trim();

  // 2. 剥 markdown fence：```json ... ``` / ``` ... ```
  const fenceMatch = s.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i);
  if (fenceMatch) {
    s = fenceMatch[1].trim();
  }

  // 3. 截取第一个 { ... } 平衡子串（应对前后散文）
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let end = -1;
  let inStr = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) return null;
  let body = s.slice(start, end + 1);

  // 4. 去尾随逗号：,} / ,] / ,\s*}
  body = body.replace(/,(\s*[}\]])/g, '$1');

  return body;
}
```

- [ ] **Step 4: 跑测试 pass**

```bash
npx -w @xzz/api vitest run src/lib/agent/__tests__/planner.test.ts 2>&1 | tail -10
```
Expected：全 pass（包括新 6 个污染用例）。

- [ ] **Step 5: 跑全测**

```bash
npx -w @xzz/api vitest run 2>&1 | tail -8
```
Expected：≥273 passed。

- [ ] **Step 6: commit**

```bash
git add -A
git commit -m "fix(agent): parsePlannerJson 宽容污染输入（fence/prose/trailing-comma/CRLF） (M1f #4)

- 新 extractJsonCandidate：bracket-counter 截 {...} 平衡子串 + 剥 markdown fence + 去尾随逗号 + CRLF normalize
- 表驱动测试 5 种常见污染样本（来自 Kimi/Gemini 实测）
- 不引入 JSON5 依赖；纯 regex / 字符串扫描
- 纯 garbage 仍返回 null（fallback echo plan 走原路径）"
```

---

## Task 5：awaiting_confirm 死路径删除（spec #6）

**Files:**
- Modify: `apps/api/src/lib/agent/types.ts:6`（从 union 移除）
- Modify: `apps/api/src/lib/agent/runLifecycle.ts:272-275`（删 `confirmRun` 函数）
- Modify: `apps/api/src/lib/agent/runtime.ts:6,20`（删 re-export）
- Modify: `apps/api/src/routes/agent.ts:9,278`（删 import + 删 `POST /runs/:id/confirm` 路由）
- Modify: `apps/mobile/src/features/agent/types.ts:3`（mirror enum 移除）
- Modify: `apps/mobile/src/features/agent/AgentRunCard.tsx:42`（删 label）
- Modify: `apps/mobile/src/screens/brain/BrainAgentTasksScreen.tsx:23`（删 label）

**没有 DB migration**：grep 已确认 status 列是 TEXT 不是 PG enum，老数据若有 `'awaiting_confirm'` 字串也不会引发约束错误（业务层不会再写入）。

### 5.1 后端删

- [ ] **Step 1: 改 `apps/api/src/lib/agent/types.ts`**

打开找到 `AgentStatus` union（行 1-15 附近），把 `| 'awaiting_confirm'` 那行删掉。在 union 上方加注释：

```ts
/**
 * Agent 任务状态。
 * M1f：移除 'awaiting_confirm' —— 该状态在 M1d 引入但 mobile 从未接对应 UI，
 * worker 处理逻辑永远进不去。删后 status 列在 DB 仍是 TEXT 无约束，老数据兼容。
 * 如未来需要"先确认参数再 run" → 重新加 enum value 即可（M1f spec ADR）。
 */
export type AgentStatus =
  | 'draft'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'budget_exhausted';
```

- [ ] **Step 2: 删 `apps/api/src/lib/agent/runLifecycle.ts` 末尾的 `confirmRun` 函数**

打开 `apps/api/src/lib/agent/runLifecycle.ts:272-277`，删除：

```ts
export async function confirmRun(runId: string): Promise<void> {
  const run = await store.getAgentRun(runId);
  if (!run || run.status !== 'awaiting_confirm') return;
  await store.updateAgentRun(runId, { status: 'running' });
}
```

- [ ] **Step 3: 删 `apps/api/src/lib/agent/runtime.ts` 的 `confirmRun` re-export**

打开 `apps/api/src/lib/agent/runtime.ts`，在 import / re-export 块里删掉所有 `confirmRun` 引用（行 6 的 JSDoc 提到 confirmRun 也删；行 20 的 import；以及 re-export 块里的对应行）。

- [ ] **Step 4: 删 `apps/api/src/routes/agent.ts` 的 POST /confirm 路由**

打开 `apps/api/src/routes/agent.ts`：
- 行 9 的 import：`import { cancelRun, confirmRun, createAgentRun } from ...` 删掉 `confirmRun,`
- 行 278 附近的 `POST /runs/:id/confirm` 整个 handler 删掉（按 `agent.post('/runs/:id/confirm'` 找起点，删到 handler 结束的 `});`）

- [ ] **Step 5: 后端 tsc + 全测**

```bash
npx tsc --noEmit -p apps/api 2>&1 | tail -5
npx -w @xzz/api vitest run 2>&1 | tail -8
```
Expected：tsc 无 error；测试 ≥273 passed（应该没有测试引用 awaiting_confirm，前面 grep 已确认）。

如果 tsc 报有别处引用 `'awaiting_confirm'` 字符串字面量（types union 收窄了），按报错修：通常是 mobile types mirror 还没改、或某处 `if (status === 'awaiting_confirm')` 分支可以 short-circuit 删除。

### 5.2 Mobile 删

- [ ] **Step 6: 改 `apps/mobile/src/features/agent/types.ts`**

打开找到 mirror 的 union（行 1-10 附近），删除 `'awaiting_confirm'` 那行。

- [ ] **Step 7: 改 `apps/mobile/src/features/agent/AgentRunCard.tsx`**

打开行 42 附近的状态 label map：

```ts
const STATUS_LABEL: Record<AgentStatus, string> = {
  draft: '草稿',
  awaiting_confirm: '等待确认',  // ← 删这行
  running: '进行中',
  // ...
};
```

删掉 `awaiting_confirm: '等待确认',` 那行。

- [ ] **Step 8: 改 `apps/mobile/src/screens/brain/BrainAgentTasksScreen.tsx`**

打开行 23 附近的同样 label map，删掉 `awaiting_confirm:` 行。

- [ ] **Step 9: Mobile tsc clean**

```bash
npx tsc --noEmit -p apps/mobile 2>&1 | tail -5
```
Expected：无 error。

- [ ] **Step 10: 确认 grep 干净**

```bash
rg awaiting_confirm apps/ docs/ 2>&1 | tail -10
```
Expected：只剩 spec / plan / ADR 类文档引用，无源代码引用。

- [ ] **Step 11: 全测最终 baseline**

```bash
npx -w @xzz/api vitest run 2>&1 | tail -8
```
Expected：≥273 passed。

- [ ] **Step 12: commit**

```bash
git add -A
git commit -m "refactor(agent): 删除 awaiting_confirm 死路径 (M1f #6)

M1d 引入 awaiting_confirm 状态但 mobile 从未接 UI，worker 路径永远不可达。
DB status 列是 TEXT 非 PG enum，无需 migration；老数据兼容。

后端删：types.AgentStatus union / runLifecycle.confirmRun / runtime.confirmRun re-export / routes/agent.ts POST /runs/:id/confirm
Mobile 删：features/agent/types.ts mirror / AgentRunCard 状态 label / BrainAgentTasksScreen 状态 label

如未来需要'先确认参数再 run' UI → 重新加 enum value 即可（无破坏性）"
```

---

## Task 6：code-reviewer + followups + merge + tag

**Files:** N/A（review + merge）

- [ ] **Step 1: tsc + 全测最终 baseline**

```bash
npx tsc --noEmit -p apps/api
npx tsc --noEmit -p apps/mobile
npx -w @xzz/api vitest run 2>&1 | tail -8
```
Expected：tsc 都 clean；tests ≥273 passed。

- [ ] **Step 2: 看 commit 历史确认 6 个 task 6 个 commit**

```bash
git log --oneline main..HEAD
```
Expected：6 行（task 1-5 + 这里以后的 review followup 如果有）。如果某个 task 实际拆了多个 commit 也 OK（reviewer 看是按主题切的就行）。

- [ ] **Step 3: 跑 code-reviewer subagent 审 branch**

调用 Task tool，subagent_type=`code-reviewer`，readonly=true，prompt：

```
Review feat/agent-runtime-m1f end-to-end. Branch base: main.

Context:
- M1f = hardening before M2 real-tool flood
- Spec: docs/superpowers/specs/2026-05-21-agent-runtime-m1f-design.md
- Plan: docs/superpowers/plans/2026-05-21-agent-runtime-m1f.md
- 6 tasks: ToolReplyMeta+replyGen 解耦 / planner prompt 升级 / 工具 ok schema+cancel signal+ESLint rule / parsePlannerJson 宽容化 / awaiting_confirm 删

What to look for (priority):
1. 🔴 ToolReplyMeta interface 是否真的 future-proof（M2 加 7-8 个新工具时不需要扩 enum）
2. 🔴 runExecute 识别 ok===false 是否正确（不重复 retry / 不污染 idempotency / step.error 写入语义）
3. 🔴 awaiting_confirm 删除是否真干净（grep 漏网 / mobile 状态 label 漏改 / 老 run 兼容）
4. 🟡 parsePlannerJson extractJsonCandidate 算法在嵌套字符串里的边界（带 } 的 string value 会不会被误判）
5. 🟡 cancel signal audit 完整性（magi 工具是否真透传 / docExport 长 await 间 check 粒度）
6. 🟡 ESLint rule 是否真注册成功 + CI 跑得到（如 apps/api 没有 ESLint setup 这条要 surface 出来）
7. 🟢 6 个 commit message 准确度 + 文档引用

输出格式：blockers / high-priority followups / nits / verdict。要狠不要客气。
```

run_in_background: false（要等结果）。

- [ ] **Step 4: 按 reviewer 报告修 blockers**

如果 reviewer 给 🔴 blocker，开 followup commit 修复：

```bash
# 每个 blocker 一个独立 commit
git commit -m "fix(agent): M1f review blocker — <主题>"
```

跑 `npx -w @xzz/api vitest run` 确保不挂。

- [ ] **Step 5: switch 回 main + merge --no-ff**

```bash
git checkout main
git merge --no-ff feat/agent-runtime-m1f -m "Merge feat/agent-runtime-m1f: Agent Runtime M1f hardening

M1f 一次清掉 M1c/M1e review 推迟的 6 项 hardening：
1. ToolReplyMeta + replyGen 解耦（去硬编码 toolName）
2. planner prompt 升级（工具失败约定 + previousFailure 注入）
3. 工具 ok schema 统一 + cancel signal audit + ESLint local rule
4. parsePlannerJson 宽容化（fence/prose/trailing-comma/CRLF）
5. awaiting_confirm 死路径删除

Tests: 273+ passing。M2 真工具洪水可直接在这干净底座上展开。"
```

- [ ] **Step 6: tag v0.m1f**

```bash
git tag -a v0.m1f -m "v0.m1f — Agent Runtime M1f hardening

Tech-debt cleanup before M2 real-tool flood.

Key changes:
- ToolDef.replyMeta：tool 自带 summaryKind / extractRef / failureHint，replyGen 不再硬编码 toolName
- planner prompt 加工具失败处理约定 + previousFailure 注入
- 6 个工具 output 统一 { ok, ... } schema；runtime soft-fail 识别
- cancel signal 全 audit + ESLint local rule 长期防回归
- parsePlannerJson 宽容污染输入（来自 Kimi/Gemini 实测）
- awaiting_confirm 死路径删（M1d 引入但 mobile 从未接 UI）

273+ tests passing。"

git log --oneline -5
```

- [ ] **Step 7: smoke test main 干净**

```bash
set -a; source .env; set +a
npx -w @xzz/api vitest run 2>&1 | tail -5
```
Expected：≥273 passed。

---

## 完整完成验收

- [ ] 6 commit 落 `feat/agent-runtime-m1f`，每个 commit 主题清晰
- [ ] code-reviewer 审过；blockers 修完
- [ ] `main` 合并完，tag `v0.m1f`
- [ ] `tsc --noEmit -p apps/api` clean
- [ ] `tsc --noEmit -p apps/mobile` clean
- [ ] api tests ≥273 passing
- [ ] `rg awaiting_confirm apps/` 只剩 ADR/docs 引用
- [ ] `apps/api/src/lib/agent/tools/README.md` 存在 + 描述三件套（signal / ok / replyMeta）
- [ ] 6 个工具都有 `replyMeta` 字段
- [ ] ESLint local rule 文件存在（即便 lint pipeline 暂未启用也保留）

---

## Spec 覆盖自查（writing-plans skill 要求）

| Spec 项 | 实施 task | 状态 |
|---------|----------|------|
| #1 planner prompt 升级 | Task 2 | ✅ |
| #2 replyGen 解耦 + ToolDef.replyMeta | Task 1 | ✅ |
| #3 cancel signal audit + ESLint rule | Task 3 step 12-20 | ✅ |
| #4 parsePlannerJson 宽容化 | Task 4 | ✅ |
| #5 工具 output `{ok}` 软约定 | Task 3 step 1-11 | ✅ |
| #6 awaiting_confirm 删 | Task 5 | ✅ |
| 合并 task 3 = #3 + #5（spec §5 排序提示） | Task 3 | ✅ |
| code-reviewer + merge + tag | Task 6 | ✅ |

**自查结果**：spec 6 项全覆盖，无 gap，无 placeholder（所有代码块都是完整可执行的）。
