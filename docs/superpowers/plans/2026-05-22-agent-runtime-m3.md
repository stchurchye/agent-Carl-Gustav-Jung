# M3 Implementation Plan

**Spec:** `docs/superpowers/specs/2026-05-22-agent-runtime-m3-design.md`
**Branch:** `feat/agent-runtime-m3`（off `main`，HEAD `b30ea87`）
**Baseline:** M2 完整，375 tests（9 个并发 flaky 与本 milestone 无关）

---

## 通用约定

- **TDD：** 每个新模块先写失败测试，再写实现。
- **commit 粒度：** 每个 task 一次 commit；task 内部小 sub-step 不单独 commit。
- **测试命令：**
  ```bash
  cd "/Users/hongpengwang/agent-Carl-Gustav-Jung/apps/api" && \
    DATABASE_URL=postgresql://xzz:xzz_dev_password@localhost:5433/xzz_app \
    npx vitest run --testPathPattern <pattern> 2>&1 | tail -30
  ```
- **M1f 工具约定（每个工具必须）：**
  1. handler catch 块第一行 `if (e instanceof Error && e.name === 'AbortError') throw e;`
  2. fetch 调用必须传 `signal: ctx.signal`
  3. 输出对象第一字段 `ok: boolean`
  4. `replyMeta` 必须含 `summaryKind` 和 `failureHint`

---

## Task 0：Branch + baseline

```bash
cd "/Users/hongpengwang/agent-Carl-Gustav-Jung" && git checkout main && git pull --rebase origin main && git checkout -b feat/agent-runtime-m3
```

验证 baseline：
```bash
cd "/Users/hongpengwang/agent-Carl-Gustav-Jung/apps/api" && DATABASE_URL=... npx vitest run 2>&1 | tail -5
cd "/Users/hongpengwang/agent-Carl-Gustav-Jung/apps/api" && npx tsc --noEmit 2>&1 | tail -3
```

记录基线测试数（用 M2 收尾的 ~366 passed 数字）。

---

## Task 1：Migration 018 + types + store 扩展

**目标：** 给 `agent_runs` 加 `parent_run_id` / `pending_user_prompt` / `pending_user_step_idx` 列，加 `'awaiting_user_input'` 状态。

### 1.1 Migration

创建 `apps/api/src/db/migrations/018_agent_run_subagent_and_ask_user.sql`：

```sql
-- M3 Task 1: parent_run_id (for deep_research child runs)
--          + pending_user_prompt + pending_user_step_idx (for ask_user resume)
ALTER TABLE agent_runs
  ADD COLUMN parent_run_id TEXT NULL REFERENCES agent_runs(id) ON DELETE SET NULL,
  ADD COLUMN pending_user_prompt TEXT NULL,
  ADD COLUMN pending_user_step_idx INTEGER NULL;
CREATE INDEX idx_agent_runs_parent ON agent_runs(parent_run_id) WHERE parent_run_id IS NOT NULL;
```

应用：
```bash
DATABASE_URL=... psql "$DATABASE_URL" -f apps/api/src/db/migrations/018_agent_run_subagent_and_ask_user.sql
```

### 1.2 类型扩展

`apps/api/src/lib/agent/types.ts`:

```typescript
// AgentRunStatus 增加：
export type AgentRunStatus =
  | 'draft'
  | 'planning'
  | 'awaiting_approval'
  | 'awaiting_user_input'   // M3
  | 'running'
  | 'replanning'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'budget_exhausted';

// AgentRun 增加 3 个字段（放在 userApiKeysEnc 后面）：
parentRunId: string | null;
pendingUserPrompt: string | null;
pendingUserStepIdx: number | null;
```

### 1.3 store.ts plumbing

找到现有 `parseRun` 行映射函数和 `updateAgentRun` 的 dynamic SET 构造器，依葫芦画瓢加入新字段：
- SELECT 语句加 `parent_run_id, pending_user_prompt, pending_user_step_idx`
- `parseRun` 映射 snake → camel
- `UpdateAgentRunInput` 加 `parentRunId?`, `pendingUserPrompt?: string | null`, `pendingUserStepIdx?: number | null`
- `updateAgentRun` dynamic SET 加 3 条 case
- `createAgentRun` 的 INSERT 接受 `parentRunId`（用作 INSERT 列）

### 1.4 测试

创建 `apps/api/src/lib/agent/__tests__/store.m3.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import * as store from '../store.js';

describe('store M3 columns', () => {
  it('round-trips parent_run_id and pending_user_prompt', async () => {
    if (!process.env.DATABASE_URL) return;
    const parent = await store.createAgentRun({
      ownerId: 'u-m3', channel: 'private', inputText: 'parent', role: 'generalist',
      providerId: 'deepseek', modelId: 'deepseek-v4-pro',
    });
    const child = await store.createAgentRun({
      ownerId: 'u-m3', channel: 'private', inputText: 'child', role: 'generalist',
      providerId: 'deepseek', modelId: 'deepseek-v4-pro',
      parentRunId: parent.id,
    });
    await store.updateAgentRun(parent.id, {
      status: 'awaiting_user_input',
      pendingUserPrompt: '你想分析哪一年的数据？',
      pendingUserStepIdx: 2,
    });
    const reloadedParent = await store.getAgentRun(parent.id);
    const reloadedChild = await store.getAgentRun(child.id);
    expect(reloadedParent?.status).toBe('awaiting_user_input');
    expect(reloadedParent?.pendingUserPrompt).toBe('你想分析哪一年的数据？');
    expect(reloadedParent?.pendingUserStepIdx).toBe(2);
    expect(reloadedChild?.parentRunId).toBe(parent.id);
  });
});
```

跑通：
```bash
DATABASE_URL=... npx vitest run --testPathPattern store.m3 2>&1 | tail -10
```

### 1.5 commit

```bash
git add -A && git commit -m "feat(agent/m3): migration 018 + parentRunId + pendingUserPrompt store plumbing"
```

---

## Task 2：`ask_user` 工具 + executor 暂停语义

### 2.1 探索

```bash
rg "kind:.*observe|StepKind|stepRecorder" apps/api/src/lib/agent --type ts -n | head -20
```

读 `runExecute.ts` 找到 observation 处理位置（每个 step 收到 result 后写 step + 判断是否 critique/replan/下一步）。

### 2.2 ask_user 工具

创建 `apps/api/src/lib/agent/tools/askUser.ts`：

```typescript
import { toolRegistry, type ToolDef } from '../toolRegistry.js';
import { getPool } from '../../../db/client.js';

type AskUserInput = {
  question: string;
  options?: string[];
};

type AskUserOutput = {
  ok: boolean;
  paused: boolean;
  messageId: string;
  error?: string;
};

export const askUserTool: ToolDef<AskUserInput, AskUserOutput> = {
  name: 'ask_user',
  description:
    'Pause the run and ask the user a clarifying question. Use ONLY when the task is ambiguous and you genuinely cannot proceed without more info (missing data source, unclear scope, multiple valid interpretations). Do NOT use for "do you want me to continue" — just continue. The run pauses until user replies via the resume API; reply is appended as next observation.',
  inputSchema: {
    type: 'object',
    required: ['question'],
    properties: {
      question: { type: 'string', minLength: 1 },
      options: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    },
  },
  approvalMode: 'auto',
  costHint: 'low',
  hasSideEffects: true,
  idempotent: false,
  replyMeta: {
    summaryKind: 'silent',
    failureHint: 'ask_user 失败：仅在 channel=private 可用。如在 group 触发，请改写一段澄清问题作为回复直接发出。',
  },
  async handler(input, ctx) {
    if (ctx.channel !== 'private') {
      return { ok: false, paused: false, messageId: '',
        error: 'ask_user only supported in private channel' };
    }
    if (!input.question.trim()) {
      return { ok: false, paused: false, messageId: '',
        error: 'question cannot be empty' };
    }
    try {
      const { rows } = await getPool().query(
        `INSERT INTO private_chat_messages (id, owner_id, session_id, sender_role, content_md, payload, created_at)
         VALUES (gen_random_uuid()::text, $1, $2, 'agent', $3, $4, NOW())
         RETURNING id`,
        [
          ctx.ownerId,
          ctx.sessionId ?? null,
          input.question,
          JSON.stringify({
            type: 'agent_question',
            runId: ctx.runId,
            stepId: ctx.stepId,
            question: input.question,
            options: input.options ?? [],
          }),
        ],
      );
      return { ok: true, paused: true, messageId: rows[0].id as string };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      return { ok: false, paused: false, messageId: '',
        error: e instanceof Error ? e.message : String(e) };
    }
  },
};

export function registerAskUser(): void {
  if (!toolRegistry.get(askUserTool.name)) toolRegistry.register(askUserTool);
}
```

**注意：** `private_chat_messages` 表的实际 schema 要先确认（参考 M2 Task 5 render_diagram 也遇到同样问题，最后建了独立 agent_diagrams 表）。如果 schema 不匹配，方案：
- 优先：用现有 message 写入 helper（`messageBridge.ts` 里查 `writePrivatePlaceholder`/`finalizePrivatePlaceholder`）
- 备选：建独立 `agent_questions` 表（同 M2 agent_diagrams 思路）

实际 SQL/helper 用法以 `bash psql "$DATABASE_URL" -c "\d private_chat_messages"` 输出为准。

### 2.3 toolRegistry / ctx 检查

`ctx` 是否含 `channel` 和 `sessionId`？读 `toolRegistry.ts` 找 `ToolContext` 类型，需要的话扩展。M1 应已有 `channel`，`sessionId` 可能需要新增（创建 ctx 时从 run 取）。

### 2.4 executor 暂停语义

读 `runExecute.ts` 主循环，找到 observation 处理后的"继续下一步"位置。插入：

```typescript
// M3 ask_user 暂停：若 tool 返回 ok:true 且 paused:true，把 run 切到 awaiting_user_input 并 break
const obsRecord = /* result 对象 */;
const outputObj = obsRecord?.output as { ok?: boolean; paused?: boolean } | undefined;
if (outputObj?.ok === true && outputObj?.paused === true && step.toolName === 'ask_user') {
  await store.updateAgentRun(run.id, {
    status: 'awaiting_user_input',
    pendingUserPrompt: (step.input as { question?: string }).question ?? '',
    pendingUserStepIdx: stepIdx,
  });
  return; // 退出 executeRun
}
```

### 2.5 测试

创建 `apps/api/src/lib/agent/__tests__/tools.askUser.test.ts`：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { askUserTool, registerAskUser } from '../tools/askUser.js';
import { toolRegistry } from '../toolRegistry.js';

vi.mock('../../../db/client.js', () => ({
  getPool: () => ({
    query: vi.fn(async () => ({ rows: [{ id: 'msg_q_1' }] })),
  }),
}));

const fakeCtx = {
  runId: 'r', stepId: 's', ownerId: 'u', channel: 'private' as const,
  sessionId: 'sess1',
  signal: new AbortController().signal,
};

describe('ask_user tool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('registers idempotently', () => {
    registerAskUser(); registerAskUser();
    expect(toolRegistry.get('ask_user')).toBeDefined();
  });

  it('private channel + valid question → ok:true paused:true', async () => {
    const out = await askUserTool.handler({ question: '你想分析哪年？' }, fakeCtx);
    expect(out.ok).toBe(true);
    expect(out.paused).toBe(true);
    expect(out.messageId).toBe('msg_q_1');
  });

  it('group channel → ok:false', async () => {
    const out = await askUserTool.handler({ question: 'x' }, { ...fakeCtx, channel: 'group' });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/private/);
  });

  it('empty question → ok:false', async () => {
    const out = await askUserTool.handler({ question: '   ' }, fakeCtx);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/empty/);
  });
});
```

executor 暂停测试 `apps/api/src/lib/agent/__tests__/runtime.askUser.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import * as store from '../store.js';
import { executeRun } from '../runtime.js';
// ... setup helpers from existing runtime.test.ts

describe('executor handles ask_user pause', () => {
  it('paused:true → run.status=awaiting_user_input, no further steps', async () => {
    if (!process.env.DATABASE_URL) return;
    // 用 fakeLlm 生成 plan = [{ toolName: 'ask_user', input: { question: '你要分析哪年？' } }, ...]
    // 跑 executeRun
    // 校验：
    //   1. run.status === 'awaiting_user_input'
    //   2. run.pendingUserPrompt === '你要分析哪年？'
    //   3. 只有 1 个 plan/observe step 被记录，第二步未执行
  });
});
```

参考现有 `runtime.test.ts` 的 fakeLlm + planner mock 套路。

### 2.6 注册 + commit

```typescript
// registerAgentTools.ts 加：
import { registerAskUser } from './tools/askUser.js';
registerAskUser();
```

```bash
DATABASE_URL=... npx vitest run --testPathPattern "tools.askUser|runtime.askUser" 2>&1 | tail -15
git add -A && git commit -m "feat(agent/m3): ask_user tool + executor pause semantics"
```

---

## Task 3：resumeAgentRun + POST /resume 路由

### 3.1 resumeAgentRun lib

在 `apps/api/src/lib/agent/runLifecycle.ts` 添加：

```typescript
export type ResumeAgentRunInput = {
  runId: string;
  userInput: string;
};

export async function resumeAgentRun(input: ResumeAgentRunInput): Promise<{ run: AgentRun }> {
  const run = await store.getAgentRun(input.runId);
  if (!run) throw new Error(`run not found: ${input.runId}`);
  if (run.status !== 'awaiting_user_input') {
    throw new Error(`run ${input.runId} is not awaiting user input (status=${run.status})`);
  }
  const trimmed = input.userInput.trim();
  if (!trimmed) throw new Error('userInput cannot be empty');

  // 写一条 user_input observation step
  await store.appendStep({
    runId: run.id,
    kind: 'observe',
    toolName: 'ask_user',
    input: { question: run.pendingUserPrompt },
    output: { ok: true, userInput: trimmed, resumedAt: new Date().toISOString() },
    stepIdx: (run.pendingUserStepIdx ?? 0) + 1,
  });
  // 把 user reply 也作为一条 user message 写入 chat（便于回看）
  // ... 调 messageBridge 或直接 INSERT private_chat_messages（sender_role='user'）

  await store.updateAgentRun(run.id, {
    status: 'running',
    pendingUserPrompt: null,
    pendingUserStepIdx: null,
  });
  const updated = await store.getAgentRun(run.id);
  return { run: updated! };
}
```

**注意：** `appendStep` 实际签名要确认（M1 应已存在）；step `kind` 是否支持 `'observe'`/`'user_input'` 也要查 types.ts `StepKind`。可能需要扩展 StepKind 加 `'user_input'`，或复用 `'observe'` + payload 标识。简单路径：复用 `'observe'`，output 里加 `resumedAt`/`userInput` 字段。

### 3.2 POST /api/agent/runs/:id/resume 路由

`apps/api/src/routes/agent.ts` 添加（参考 cancel 路由结构）：

```typescript
import { resumeAgentRun } from '../lib/agent/runLifecycle.js';

agentRouter.post('/runs/:id/resume', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const run = await store.getAgentRun(id);
  if (!run) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  if (!(await canAccessRun(run, userId)))
    return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);
  if (run.status !== 'awaiting_user_input')
    return jsonError(c, ErrorCodes.VALIDATION, 409);

  const body = await c.req.json<{ userInput?: string }>().catch(() => ({}));
  const userInput = (body.userInput ?? '').trim();
  if (!userInput) return jsonError(c, ErrorCodes.VALIDATION, 400);

  try {
    const result = await resumeAgentRun({ runId: id, userInput });
    return c.json({ ok: true, data: { run: result.run }, requestId: c.get('requestId') });
  } catch (e) {
    return jsonError(c, ErrorCodes.VALIDATION, 409,
      e instanceof Error ? e.message : 'resume failed');
  }
});
```

### 3.3 测试

`apps/api/src/lib/agent/__tests__/runLifecycle.resume.test.ts`：
- happy path：创建 run + 手动设 awaiting → resume → status running, pending_* cleared, 新 step 追加
- 状态非 awaiting → throw
- userInput 空 → throw

`apps/api/src/routes/__tests__/agent.routes.resume.test.ts`：
- 200 happy path（cookie auth）
- 404（run 不存在）
- 403（非 owner）
- 409（状态非 awaiting）
- 400（userInput 空）

### 3.4 commit

```bash
DATABASE_URL=... npx vitest run --testPathPattern "resume" 2>&1 | tail -15
git add -A && git commit -m "feat(agent/m3): resumeAgentRun + POST /api/agent/runs/:id/resume route"
```

---

## Task 4：`deep_research` + child executor pool

### 4.1 子 run 工具白名单

`apps/api/src/lib/agent/runtimeRegistry.ts` 或新建 `subagentTools.ts`：

```typescript
/**
 * M3 ADR-3：子 agent 工具白名单。只读 + 信息检索 + 沙箱外；不许写副作用、不许递归。
 */
export const SUBAGENT_TOOL_WHITELIST: ReadonlySet<string> = new Set([
  'search_papers',
  'search_web',
  'wikipedia',
  'fetch_url',
  'document_reader',
  'get_paper_citations',
  'datetime_now',
  'magi_system_read',
]);
```

### 4.2 child executor pool

创建 `apps/api/src/lib/agent/childExecutor.ts`：

```typescript
import { executeRun } from './runtime.js';
import * as store from './store.js';

const DEFAULT_CONCURRENCY = 3;
const childInFlight = new Set<string>();
let concurrency = DEFAULT_CONCURRENCY;
let pendingQueue: Array<{ runId: string; resolve: () => void }> = [];

export function setChildConcurrency(n: number): void { concurrency = Math.max(1, n); }

/**
 * 派一个子 run 异步执行。返回 Promise 在子 run 进入 inFlight 时 resolve（不等执行完）。
 * 实际 polling 等子 run 终态由 caller 处理（getAgentRun(runId) 看 status）。
 */
export async function dispatchChildRun(runId: string): Promise<void> {
  return new Promise((resolve) => {
    pendingQueue.push({ runId, resolve });
    drain();
  });
}

function drain(): void {
  while (childInFlight.size < concurrency && pendingQueue.length > 0) {
    const job = pendingQueue.shift()!;
    childInFlight.add(job.runId);
    job.resolve();
    void executeRun(job.runId)
      .catch((e) => {
        console.error('[child executor] executeRun failed', job.runId, e);
      })
      .finally(() => {
        childInFlight.delete(job.runId);
        drain();
      });
  }
}

export function _childExecutorStats() {
  return { inFlight: childInFlight.size, pending: pendingQueue.length, concurrency };
}
```

测试 `apps/api/src/lib/agent/__tests__/childExecutor.test.ts`：
- 派 5 个 run，concurrency=2 → 同时只跑 2 个，前 2 个完成后剩下 3 个依次启动
- inFlight 计数正确清零

### 4.3 createAgentRun 接受 parentRunId + toolWhitelist hint

修改 `CreateAgentRunInput` 加 `parentRunId?: string;`，传给 store.createAgentRun。

工具白名单的应用：planner 拿可用工具列表时，如果 run 是子 run（`parentRunId !== null`），过滤为白名单。修改 `planner.ts` 的 tool catalog 构造：

```typescript
function getToolsForRun(run: AgentRun) {
  const all = toolRegistry.list();
  if (run.parentRunId) {
    return all.filter(t => SUBAGENT_TOOL_WHITELIST.has(t.name));
  }
  return all;
}
```

且：父 run plan 校验阶段，把 `deep_research`/`ask_user` 在子 run 里出现的拒绝（即 plan parse 后 step 校验，如果 run.parentRunId !== null 且 step.toolName ∈ {deep_research, ask_user} → 整 plan reject 重 plan）。

### 4.4 deep_research 工具

创建 `apps/api/src/lib/agent/tools/deepResearch.ts`：

```typescript
import { toolRegistry, type ToolDef } from '../toolRegistry.js';
import * as store from '../store.js';
import { createAgentRun } from '../runLifecycle.js';
import { dispatchChildRun } from '../childExecutor.js';

type DeepResearchInput = {
  question: string;
  maxSteps?: number;
};

type DeepResearchOutput = {
  ok: boolean;
  report: string;
  citations: Array<{ kind: string; id: string; label?: string }>;
  stepsUsed: number;
  childRunId: string;
  error?: string;
};

const POLL_INTERVAL_MS = 500;
const MAX_WAIT_MS = 5 * 60_000;

export const deepResearchTool: ToolDef<DeepResearchInput, DeepResearchOutput> = {
  name: 'deep_research',
  description:
    'Spawn a sub-agent to research a focused sub-question (literature review, "what does recent research say about X", investigating controversies). The sub-agent has search_papers/wikipedia/fetch_url/document_reader/etc. and returns a markdown report. Use ONCE per high-level question; do NOT spawn nested deep_research.',
  inputSchema: {
    type: 'object',
    required: ['question'],
    properties: {
      question: { type: 'string', minLength: 5 },
      maxSteps: { type: 'integer', minimum: 1, maximum: 8 },
    },
  },
  approvalMode: 'auto',
  costHint: 'high',
  hasSideEffects: true,
  idempotent: false,
  replyMeta: {
    summaryKind: 'text',
    failureHint: 'deep_research 失败：子 agent 超时 / 工具不可用 / 子任务定义不清。可改用单步 search_papers + fetch_url 串行，或缩小 question 范围重试。',
  },
  async handler(input, ctx) {
    const parentRun = await store.getAgentRun(ctx.runId);
    if (!parentRun) {
      return { ok: false, report: '', citations: [], stepsUsed: 0, childRunId: '',
        error: 'parent run not found' };
    }
    if (parentRun.parentRunId) {
      return { ok: false, report: '', citations: [], stepsUsed: 0, childRunId: '',
        error: 'deep_research cannot be nested (run is already a sub-agent)' };
    }
    const maxSteps = Math.max(1, Math.min(input.maxSteps ?? 5, 8));

    try {
      // 1. 创建子 run（无 placeholder message，纯内部）
      const childResult = await createAgentRun({
        ownerId: parentRun.ownerId,
        channel: 'private',
        inputText: input.question,
        apiKey: '',  // 继承父配置，TODO: 真实环境从父 run 解 user_api_keys
        apiKeySource: parentRun.apiKeySource,
        providerId: parentRun.providerId,
        modelId: parentRun.modelId,
        parentRunId: parentRun.id,
        budget: { maxSteps, maxSeconds: 120, maxTokens: 50_000 },
      });
      const childRunId = childResult.run.id;

      // 2. 父 run 取消时同步取消子 run
      const onAbort = () => {
        void store.updateAgentRun(childRunId, {
          status: 'cancelled', cancelReason: 'user',
        });
      };
      ctx.signal.addEventListener('abort', onAbort, { once: true });

      // 3. 派子 run 入 child executor
      await dispatchChildRun(childRunId);

      // 4. 轮询子 run 终态
      const startedAt = Date.now();
      let childRun = childResult.run;
      while (Date.now() - startedAt < MAX_WAIT_MS) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        if (ctx.signal.aborted) {
          const err = new Error('aborted'); err.name = 'AbortError'; throw err;
        }
        const reloaded = await store.getAgentRun(childRunId);
        if (!reloaded) break;
        childRun = reloaded;
        if (['completed', 'failed', 'cancelled', 'budget_exhausted'].includes(reloaded.status)) {
          break;
        }
      }
      ctx.signal.removeEventListener('abort', onAbort);

      if (childRun.status !== 'completed') {
        return { ok: false, report: '', citations: [], stepsUsed: childRun.usage.steps,
          childRunId, error: `child run terminated with status ${childRun.status}` };
      }

      // 5. 收集子 run 的最终 reply + 步骤 ReplyRef
      const steps = await store.listSteps(childRunId);
      const finalStep = steps[steps.length - 1];
      const report = (finalStep?.output as { content?: string })?.content
        ?? '(child run completed without text reply)';
      const citations: DeepResearchOutput['citations'] = [];
      for (const s of steps) {
        const ref = (s.output as { ref?: unknown })?.ref;
        if (ref && typeof ref === 'object') citations.push(ref as DeepResearchOutput['citations'][number]);
      }

      return { ok: true, report, citations, stepsUsed: childRun.usage.steps, childRunId };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      return { ok: false, report: '', citations: [], stepsUsed: 0, childRunId: '',
        error: e instanceof Error ? e.message : String(e) };
    }
  },
};

export function registerDeepResearch(): void {
  if (!toolRegistry.get(deepResearchTool.name)) toolRegistry.register(deepResearchTool);
}
```

**实现细节注意：**
- `finalStep?.output` 字段的实际位置和 ReplyRef 提取方式要看 `runReply.ts`/`replyGen.ts`。可能需要专门写一个 `summarizeChildRunReply(childRunId)` helper 复用现有 reply 生成逻辑。
- 子 run 的 budget 字段需要 `createAgentRun` 接受（M1 应已有）。
- 子 run cancel 时需要传 cancel reason，可能要扩展 `CancelReason` 加 `'parent_aborted'`（或复用 `'user'`）。

### 4.5 测试

`apps/api/src/lib/agent/__tests__/tools.deepResearch.test.ts`：
- 子 run 派遣成功 → 轮询完成 → report 包含子 run 最终 reply
- 子 run failed → ok:false + error 写明原因
- 父 run cancel → 子 run 也被 cancel（监听 abort）
- maxSteps 越界 → clamp [1,8]
- 父 run 自身是子 run（parentRunId 非空）→ 拒绝嵌套

`apps/api/src/lib/agent/__tests__/childExecutor.test.ts`：见 4.2

`apps/api/src/lib/agent/__tests__/planner.subagent.test.ts`：
- planner 给子 run 拿到的 tool 列表只含白名单
- planner 给父 run 拿到的 tool 列表完整

### 4.6 注册 + commit

```typescript
// registerAgentTools.ts
import { registerDeepResearch } from './tools/deepResearch.js';
registerDeepResearch();
```

```bash
DATABASE_URL=... npx vitest run --testPathPattern "deepResearch|childExecutor|planner.subagent" 2>&1 | tail -20
git add -A && git commit -m "feat(agent/m3): deep_research tool + child executor pool + subagent tool whitelist"
```

---

## Task 5：Planner prompt + snapshot

编辑 `apps/api/src/lib/agent/planner.ts` 找到 `PLANNER_INSTRUCTION`，在工具选型建议部分末尾追加：

```
- **问题模糊 / 缺关键前提**（"画个图" "做个分析" 而没说数据源 / 时间范围） → 先 ask_user 反问，不要硬猜
- **需要多步深挖一个子问题**（如 "近 5 年关于禀赋效应的实证支持" / "X 理论的当前争议"） → deep_research 派子 agent
- **绝对禁止**：在 deep_research 子任务里嵌套 deep_research / ask_user（运行时会拦截）
```

```bash
DATABASE_URL=... npx vitest run --testPathPattern planner 2>&1 | tail -10
# 如有快照失败：
DATABASE_URL=... npx vitest run --testPathPattern planner -u 2>&1 | tail -5
git add -A && git commit -m "feat(agent/m3): planner prompt mentions ask_user + deep_research"
```

---

## Task 6：移动端最小适配

### 6.1 探索

```bash
ls apps/mobile/src/components/
rg "AgentStepList|DiagramStepCard|agent_question" apps/mobile/src --type tsx --type ts -l
```

### 6.2 ask_user 输入卡片

创建 `apps/mobile/src/components/AskUserPrompt.tsx`：

```tsx
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { resumeAgentRun } from '../api/agentApi'; // 新加的 API client 方法

type Props = {
  runId: string;
  question: string;
  options?: string[];
  onResumed?: () => void;
};

export default function AskUserPrompt({ runId, question, options, onResumed }: Props) {
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true); setErr(null);
    try {
      await resumeAgentRun(runId, text.trim());
      onResumed?.();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '提交失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.box}>
      <Text style={styles.q}>{question}</Text>
      {options && options.length > 0 ? (
        <View style={styles.chips}>
          {options.map((opt) => (
            <TouchableOpacity key={opt} style={styles.chip} onPress={() => submit(opt)} disabled={busy}>
              <Text style={styles.chipText}>{opt}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={reply}
            onChangeText={setReply}
            placeholder="输入你的回答"
            editable={!busy}
            multiline
          />
          <TouchableOpacity style={styles.send} onPress={() => submit(reply)} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendText}>发送</Text>}
          </TouchableOpacity>
        </View>
      )}
      {err ? <Text style={styles.err}>{err}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: '#fff8e1', borderLeftWidth: 3, borderLeftColor: '#f9a825',
    padding: 12, borderRadius: 6, marginVertical: 8 },
  q: { fontSize: 14, color: '#333', marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { backgroundColor: '#e0e0e0', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  chipText: { fontSize: 13, color: '#333' },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  input: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 8, minHeight: 36 },
  send: { backgroundColor: '#1976d2', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6 },
  sendText: { color: '#fff', fontWeight: '600' },
  err: { color: 'red', fontSize: 12, marginTop: 4 },
});
```

### 6.3 deep_research 折叠卡片

创建 `apps/mobile/src/components/DeepResearchReport.tsx`：

```tsx
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import Markdown from 'react-native-markdown-display'; // 如未安装：npx expo install react-native-markdown-display

type Props = {
  question: string;
  report: string;
  citations?: Array<{ kind: string; id: string; label?: string }>;
  stepsUsed: number;
};

export default function DeepResearchReport({ question, report, citations, stepsUsed }: Props) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={styles.box}>
      <TouchableOpacity onPress={() => setExpanded(!expanded)} style={styles.header}>
        <Text style={styles.title}>📚 深度调研：{question}</Text>
        <Text style={styles.meta}>{stepsUsed} 步 · {expanded ? '▼' : '▶'}</Text>
      </TouchableOpacity>
      {expanded && (
        <ScrollView style={styles.body} nestedScrollEnabled>
          <Markdown>{report}</Markdown>
          {citations && citations.length > 0 && (
            <View style={styles.citations}>
              <Text style={styles.citationsTitle}>引用 ({citations.length})</Text>
              {citations.map((c, i) => (
                <Text key={i} style={styles.citation}>• {c.label ?? c.id}</Text>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: '#f5f5f5', borderRadius: 8, marginVertical: 6, overflow: 'hidden' },
  header: { flexDirection: 'row', justifyContent: 'space-between', padding: 12 },
  title: { fontSize: 14, fontWeight: '600', flex: 1, marginRight: 8 },
  meta: { fontSize: 12, color: '#666' },
  body: { padding: 12, maxHeight: 400, backgroundColor: '#fff' },
  citations: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#eee' },
  citationsTitle: { fontSize: 12, fontWeight: '600', color: '#666', marginBottom: 4 },
  citation: { fontSize: 12, color: '#444', marginVertical: 2 },
});
```

### 6.4 集成到 step / message renderer

在 `AgentStepList.tsx`（M2 加 DiagramStepCard 的地方）继续加分支：

```tsx
if (step.toolName === 'ask_user' && step.kind === 'observe' && run.status === 'awaiting_user_input') {
  const input = step.input as { question?: string; options?: string[] };
  return <AskUserPrompt runId={run.id} question={input.question ?? ''} options={input.options} onResumed={onRefresh} />;
}
if (step.toolName === 'deep_research' && step.kind === 'observe') {
  const out = step.output as { ok: boolean; report?: string; citations?: any[]; stepsUsed?: number };
  const input = step.input as { question?: string };
  if (out.ok) {
    return <DeepResearchReport question={input.question ?? ''} report={out.report ?? ''}
      citations={out.citations} stepsUsed={out.stepsUsed ?? 0} />;
  }
}
```

### 6.5 API client 加 resumeAgentRun

`apps/mobile/src/api/agentApi.ts`（实际文件名以现状为准）：

```typescript
export async function resumeAgentRun(runId: string, userInput: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/agent/runs/${runId}/resume`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userInput }),
  });
  if (!res.ok) throw new Error(`resume failed: ${res.status}`);
}
```

### 6.6 mobile tsc + commit

```bash
cd "/Users/hongpengwang/agent-Carl-Gustav-Jung/apps/mobile" && npx tsc --noEmit 2>&1 | tail -10
git add -A && git commit -m "feat(mobile/m3): AskUserPrompt + DeepResearchReport components"
```

---

## Task 7：全量 review + merge + tag

### 7.1 全量测试 + tsc + lint

```bash
cd "/Users/hongpengwang/agent-Carl-Gustav-Jung/apps/api" && DATABASE_URL=... npx vitest run 2>&1 | tail -15
cd "/Users/hongpengwang/agent-Carl-Gustav-Jung/apps/api" && npx tsc --noEmit 2>&1 | tail -5
cd "/Users/hongpengwang/agent-Carl-Gustav-Jung/apps/mobile" && npx tsc --noEmit 2>&1 | tail -5
cd "/Users/hongpengwang/agent-Carl-Gustav-Jung" && npm run lint -w @xzz/api 2>&1 | tail -10
```

预期 ≥ 395 tests passed（基线 366 + ~25 新增；9 个 flaky 不变）。

### 7.2 派 code-reviewer

```
Review feat/agent-runtime-m3 against docs/superpowers/specs/2026-05-22-agent-runtime-m3-design.md.

Confirm:
1. ask_user 触发 paused 后 executor 真的不进入下一步；user replies via /resume API → run 正确恢复
2. deep_research 子 run 严格走白名单（不含 deep_research / ask_user / run_python / render_diagram）
3. 父 run cancel 时子 run 也被 cancel
4. child executor pool 与主 worker 互不阻塞（drain 逻辑正确）
5. migration 018 字段全部加好；所有 store 改动 round-trip 通过
6. M1f 三件套约定：每个新工具都满足 ok/replyMeta/ctx.signal
7. mobile UI 至少 minimal 可用（AskUserPrompt 提交能触发 resume API）

flag 任何 high 严重度问题 + 子 run 失控/递归/死锁风险作为 BLOCKER。
```

修复 high 后：
```bash
git add -A && git commit -m "fix(agent/m3): code-reviewer findings"
```

### 7.3 merge + tag

```bash
git checkout main && git pull --rebase origin main
git merge --no-ff feat/agent-runtime-m3 -m "Merge feat/agent-runtime-m3: ask_user + deep_research + child executor pool + resume API + mobile components"
git tag v0.m3 && git log --oneline -5
```

### 7.4 收尾报告

向用户汇报：M3 完成，新增 2 工具 + 1 状态 + 1 API + 2 移动端组件，N tests passing。

---

## Self-Review

- **范围覆盖：** spec 中的 7 个 ADR 都有对应 task；ADR-M3-4 在 plan 中演化为 child executor pool 实现。
- **TDD 路径：** 每个 task 包含 failing-test → implement → pass 顺序。
- **可执行性：** 文件路径、命令、代码片段都对得上 M2 完成后的实际仓库状态。
- **风险闭环：** group channel ask_user 拒绝、嵌套 deep_research 拒绝、父 cancel 联动子 cancel、子 run 工具白名单——4 个 spec 中的风险点都有对应实现。
- **遗留确认项：**
  - `private_chat_messages` 表结构（Task 2.2）实际不确定，可能需建独立 `agent_questions` 表
  - 子 run 的 budget 字段 createAgentRun 是否完全支持（Task 4.4）需要复查
  - mobile `react-native-markdown-display` 是否已装（Task 6.3）需要确认

执行 subagent 时这三项让它先 explore，发现需要建表/扩字段时直接做，不要卡住。

---

**Plan saved. Ready for subagent dispatch.**
