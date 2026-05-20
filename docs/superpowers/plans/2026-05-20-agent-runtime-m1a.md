# Agent Runtime M1a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Agent Runtime 的基础设施 + echo mock tool 跑通，让"私聊里发 `/agent 帮我跑三步 echo` 后台真的能跑 + 可中断 + 可恢复"成为现实。

**Architecture:** 新建 `apps/api/src/lib/agent/` 目录，提供 `createAgentRun → planner → worker → step recorder → toolRegistry` 的最小可行运行时；通过 PG `SELECT FOR UPDATE SKIP LOCKED` 实现单进程后台 worker；新增 `IntentKind 'agent_run'` 并通过 slash `/agent` 命令触发；通过聊天里的 placeholder message + SSE 流实现 UI。

**Tech Stack:** TypeScript（NodeNext modules）/ Hono `streamSSE`（来自 `hono/streaming`）/ PG（pg ^8.20）/ Vitest ^3.2 / DeepSeek（planner）/ ZenMux（fallback）。

**Spec：** `docs/superpowers/specs/2026-05-20-agent-runtime-design.md`

**前置条件：** 该计划假设 `apps/api` 能正常 `npm run dev:api` 启动且 PG 已连通；测试用 `npm run test -w @xzz/api`。

---

## File Structure

新建文件：

```
apps/api/src/db/migrations/012_agent_runtime.sql

apps/api/src/lib/agent/types.ts             # 共享类型(运行时内部用)
apps/api/src/lib/agent/store.ts             # agent_runs / agent_steps 的 pg CRUD
apps/api/src/lib/agent/toolRegistry.ts      # ToolDef + 注册表
apps/api/src/lib/agent/budget.ts            # 预算检查
apps/api/src/lib/agent/stepRecorder.ts      # writeStep + heartbeat
apps/api/src/lib/agent/contextAdapter.ts    # snapshotForAgent (M1a 只做私聊)
apps/api/src/lib/agent/messageBridge.ts     # placeholder/最终消息更新 (私聊)
apps/api/src/lib/agent/planner.ts           # generatePlan (echo-only 最小版)
apps/api/src/lib/agent/runtime.ts           # createAgentRun + executeRun
apps/api/src/lib/agent/worker.ts            # pickupNextRun + setInterval
apps/api/src/lib/agent/tools/echoSleep.ts   # mock 工具
apps/api/src/lib/agent/index.ts             # 对外导出

apps/api/src/routes/agent.ts                # HTTP/SSE 路由

apps/api/src/lib/agent/__tests__/store.test.ts
apps/api/src/lib/agent/__tests__/budget.test.ts
apps/api/src/lib/agent/__tests__/planner.test.ts
apps/api/src/lib/agent/__tests__/runtime.test.ts
apps/api/src/lib/agent/__tests__/migration.test.ts
apps/api/src/lib/__tests__/intentRules.agent.test.ts  # 验证 /agent slash 触发
```

修改文件：

```
packages/shared/src/social.ts               # IntentKind 加 'agent_run'
packages/shared/src/intent/executable.ts    # EXECUTABLE_INTENT_KINDS 加 'agent_run'
apps/api/src/lib/intentRules.ts             # 新增 /agent slash 命令
apps/api/src/lib/intentExecute.ts           # 加 agent_run 分支
apps/api/src/routes/intent.ts               # IntentExecuteResult 透传 agent 字段
apps/api/src/index.ts                       # 启动 worker + 挂载 /agent 路由
apps/api/src/types.ts                       # （可能）扩展 AppVariables（实际不需要，标在这里防遗漏）
```

---

## Pre-Task: 工作目录与 Git

**Files:** 无

- [ ] **Step 0.1：确认在正确分支**

```bash
cd /Users/hongpengwang/行动中止派
git status
```

若仓库还没 init，先：

```bash
git init
git add .gitignore .env.example README.md docker-compose.yml package.json package-lock.json tsconfig.base.json apps packages scripts docs
git commit -m "chore: initial commit with agent runtime spec"
```

随后新建工作分支：

```bash
git checkout -b feat/agent-runtime-m1a
```

- [ ] **Step 0.2：基线 typecheck + test 通过**

```bash
npm run build -w @xzz/shared
npm run typecheck
npm run test -w @xzz/shared
npm run test -w @xzz/api
```

Expected：全部 PASS。如有失败先修好基线，不要带病开工。

---

## Task 1: Shared 包加入 `IntentKind 'agent_run'`

**Files:**
- Modify: `packages/shared/src/social.ts:122-135`
- Modify: `packages/shared/src/intent/executable.ts:4-16`

- [ ] **Step 1.1：写失败测试 — `agent_run` 在 EXECUTABLE_INTENT_KINDS 内**

新建 `packages/shared/src/intent/__tests__/executable.test.ts`（如目录不存在则 mkdir）：

```typescript
import { describe, expect, it } from 'vitest';
import { EXECUTABLE_INTENT_KINDS, isExecutableIntentKind } from '../executable.js';

describe('EXECUTABLE_INTENT_KINDS', () => {
  it('includes agent_run', () => {
    expect(EXECUTABLE_INTENT_KINDS).toContain('agent_run');
    expect(isExecutableIntentKind('agent_run')).toBe(true);
  });
});
```

- [ ] **Step 1.2：运行确认失败**

```bash
npm run test -w @xzz/shared -- src/intent/__tests__/executable.test.ts
```

Expected：FAIL — `agent_run` not assignable to type `IntentKind`（TS）或 toContain 失败。

- [ ] **Step 1.3：加入 IntentKind**

在 `packages/shared/src/social.ts` 找到 `export type IntentKind =`（line 122），把 `'clarify'` 那一行**之前**追加 `'agent_run'`：

```typescript
export type IntentKind =
  | 'chat_private_llm'
  | 'chat_group_llm'
  | 'human_group_message'
  | 'context_compact'
  | 'memory_remember'
  | 'memory_correct'
  | 'memory_forget'
  | 'magi_system_query'
  | 'magi_content_link'
  | 'app_navigate'
  | 'agent_run'
  /** @deprecated 使用 app_navigate + navigateTarget personality */
  | 'persona_open_settings'
  | 'clarify';
```

- [ ] **Step 1.4：加入 EXECUTABLE_INTENT_KINDS**

修改 `packages/shared/src/intent/executable.ts`：

```typescript
import type { IntentKind } from '../social.js';

/** 移动端芯片与 /api/intent/execute 支持的意图 */
export const EXECUTABLE_INTENT_KINDS: IntentKind[] = [
  'chat_private_llm',
  'chat_group_llm',
  'human_group_message',
  'memory_remember',
  'memory_correct',
  'memory_forget',
  'context_compact',
  'magi_system_query',
  'magi_content_link',
  'app_navigate',
  'agent_run',
  'persona_open_settings',
];

const EXECUTABLE_SET = new Set<IntentKind>(EXECUTABLE_INTENT_KINDS);

export function isExecutableIntentKind(kind: IntentKind): boolean {
  return EXECUTABLE_SET.has(kind);
}
```

- [ ] **Step 1.5：测试通过 + typecheck 通过**

```bash
npm run build -w @xzz/shared
npm run test -w @xzz/shared
npm run typecheck
```

Expected：PASS。注意：`typecheck` 全仓库做，因为 `intentExecute.ts` 现在会出现"`agent_run` not handled in switch"类警告 — 是预期的，但**不**应该是 error。如果是 error 那是上游某个 exhaustive check 抓到了，记下来在 Task 7 修。

- [ ] **Step 1.6：Commit**

```bash
git add packages/shared/src/social.ts packages/shared/src/intent/executable.ts packages/shared/src/intent/__tests__/
git commit -m "feat(shared): add 'agent_run' IntentKind"
```

---

## Task 2: Migration `012_agent_runtime.sql`

**Files:**
- Create: `apps/api/src/db/migrations/012_agent_runtime.sql`
- Create: `apps/api/src/lib/agent/__tests__/migration.test.ts`

- [ ] **Step 2.1：写失败测试 — migration 跑完后表存在**

新建 `apps/api/src/lib/agent/__tests__/migration.test.ts`：

```typescript
import { describe, expect, it, beforeAll } from 'vitest';
import { getPool } from '../../../db/client.js';
import { runMigrations } from '../../../db/migrate.js';

describe('012_agent_runtime migration', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  it('creates agent_runs table with expected columns', async () => {
    const { rows } = await getPool().query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = 'agent_runs' ORDER BY ordinal_position`,
    );
    const names = rows.map((r) => r.column_name);
    expect(names).toEqual(
      expect.arrayContaining([
        'id',
        'owner_id',
        'channel',
        'session_id',
        'group_id',
        'topic_id',
        'intent_turn_id',
        'role',
        'status',
        'input_text',
        'plan',
        'todos',
        'budget',
        'usage',
        'api_key_owner_id',
        'api_key_source',
        'result_message_id',
        'invoke_message_id',
        'last_heartbeat_at',
        'awaiting_approval_until',
        'awaiting_approval_step_idx',
        'pending_approval_tool_name',
        'cancelled_by_user_id',
        'cancel_reason',
        'created_at',
        'started_at',
        'ended_at',
      ]),
    );
  });

  it('creates agent_steps table with expected columns', async () => {
    const { rows } = await getPool().query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'agent_steps' ORDER BY ordinal_position`,
    );
    const names = rows.map((r) => r.column_name);
    expect(names).toEqual(
      expect.arrayContaining([
        'id', 'run_id', 'idx', 'kind', 'tool_name', 'tool_call_key',
        'input', 'output', 'tokens', 'duration_ms', 'error', 'by_user_id',
        'created_at',
      ]),
    );
  });

  it('creates topic_skills table', async () => {
    const { rows } = await getPool().query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'topic_skills' ORDER BY ordinal_position`,
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('is idempotent — running migrations again does not throw', async () => {
    await expect(runMigrations()).resolves.toBeUndefined();
  });

  it('agent_steps has unique constraint on (run_id, tool_call_key)', async () => {
    const { rows } = await getPool().query(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'agent_steps'`,
    );
    const indexes = rows.map((r) => r.indexname);
    expect(indexes).toContain('idx_agent_steps_tool_call_key');
  });
});
```

- [ ] **Step 2.2：运行确认失败**

```bash
npm run test -w @xzz/api -- src/lib/agent/__tests__/migration.test.ts
```

Expected：FAIL — `agent_runs` table 不存在。

- [ ] **Step 2.3：创建 migration**

新建 `apps/api/src/db/migrations/012_agent_runtime.sql`：

```sql
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('private','group')),
  session_id TEXT REFERENCES private_chat_sessions(id) ON DELETE CASCADE,
  group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
  topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  intent_turn_id TEXT REFERENCES intent_turns(id) ON DELETE SET NULL,
  role TEXT NOT NULL DEFAULT 'generalist',
  status TEXT NOT NULL,
  input_text TEXT NOT NULL,
  plan JSONB,
  todos JSONB NOT NULL DEFAULT '[]'::jsonb,
  budget JSONB NOT NULL,
  usage JSONB NOT NULL DEFAULT '{}'::jsonb,
  api_key_owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  api_key_source TEXT NOT NULL CHECK (api_key_source IN ('user','server')),
  result_message_id TEXT,
  invoke_message_id TEXT,
  last_heartbeat_at TIMESTAMPTZ,
  awaiting_approval_until TIMESTAMPTZ,
  awaiting_approval_step_idx INT,
  pending_approval_tool_name TEXT,
  cancelled_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  cancel_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_pickup
  ON agent_runs(status, last_heartbeat_at)
  WHERE status IN ('draft','planning','running','replanning');

CREATE INDEX IF NOT EXISTS idx_agent_runs_topic
  ON agent_runs(group_id, topic_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_runs_owner
  ON agent_runs(owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_runs_session
  ON agent_runs(session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  idx INT NOT NULL,
  kind TEXT NOT NULL,
  tool_name TEXT,
  tool_call_key TEXT,
  input JSONB,
  output JSONB,
  tokens INT NOT NULL DEFAULT 0,
  duration_ms INT NOT NULL DEFAULT 0,
  error TEXT,
  by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, idx)
);

CREATE INDEX IF NOT EXISTS idx_agent_steps_run ON agent_steps(run_id, idx);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_steps_tool_call_key
  ON agent_steps(run_id, tool_call_key)
  WHERE tool_call_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS topic_skills (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('topic','user','group')),
  owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
  topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by_user_id TEXT NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_topic_skills_scope
  ON topic_skills(scope, owner_id, group_id, topic_id)
  WHERE enabled = TRUE;
```

- [ ] **Step 2.4：运行 migration + 测试**

```bash
npm run test -w @xzz/api -- src/lib/agent/__tests__/migration.test.ts
```

Expected：PASS。如果 PG 里已有半成品 `agent_runs` 表（重跑测试导致），手动 `DROP TABLE` 后再跑。建议测试用独立 PG schema。

- [ ] **Step 2.5：Commit**

```bash
git add apps/api/src/db/migrations/012_agent_runtime.sql apps/api/src/lib/agent/__tests__/migration.test.ts
git commit -m "feat(api): add 012_agent_runtime migration"
```

**测试覆盖：T15（DB 迁移幂等）**

---

## Task 3: Agent 内部类型 `types.ts`

**Files:**
- Create: `apps/api/src/lib/agent/types.ts`

- [ ] **Step 3.1：直接写类型定义（纯类型文件不需 TDD）**

新建 `apps/api/src/lib/agent/types.ts`：

```typescript
import type { IntentKind } from '@xzz/shared';

export type AgentRole = 'generalist';

export type AgentRunStatus =
  | 'draft'
  | 'planning'
  | 'awaiting_confirm'
  | 'awaiting_approval'
  | 'running'
  | 'replanning'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'budget_exhausted';

export type AgentChannel = 'private' | 'group';

export type CancelReason = 'user' | 'steer' | 'budget' | 'crash_reclaim';

export type ApiKeySource = 'user' | 'server';

export type TodoStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'skipped'
  | 'failed';

export type TodoItem = {
  id: string;
  text: string;
  status: TodoStatus;
  stepRefs: string[];
};

export type PlanStep = {
  toolName: string;
  input: Record<string, unknown>;
  reason: string;
  todoId: string | null;
};

export type Plan = {
  intentSummary: string;
  steps: PlanStep[];
  todos: TodoItem[];
  finalReplyHint: string;
  reasoning: string | null;
  version: number;
};

export type AgentBudget = {
  maxSteps: number;
  maxSeconds: number;
  maxTokens: number;
};

export type AgentUsage = {
  steps: number;
  elapsedSeconds: number;
  tokens: number;
  costCny: number;
};

export type AgentRun = {
  id: string;
  ownerId: string;
  channel: AgentChannel;
  sessionId: string | null;
  groupId: string | null;
  topicId: string | null;
  intentTurnId: string | null;
  role: AgentRole;
  status: AgentRunStatus;
  inputText: string;
  plan: Plan | null;
  todos: TodoItem[];
  budget: AgentBudget;
  usage: AgentUsage;
  apiKeyOwnerId: string | null;
  apiKeySource: ApiKeySource;
  resultMessageId: string | null;
  invokeMessageId: string | null;
  lastHeartbeatAt: Date | null;
  awaitingApprovalUntil: Date | null;
  awaitingApprovalStepIdx: number | null;
  pendingApprovalToolName: string | null;
  cancelledByUserId: string | null;
  cancelReason: CancelReason | null;
  createdAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
};

export type StepKind =
  | 'plan'
  | 'replan'
  | 'critique'
  | 'tool_call'
  | 'tool_error'
  | 'observe'
  | 'reply'
  | 'approval_request'
  | 'approval_grant'
  | 'approval_deny'
  | 'approval_timeout'
  | 'cancel'
  | 'steer'
  | 'heartbeat'
  | 'system_error';

export type AgentStep = {
  id: string;
  runId: string;
  idx: number;
  kind: StepKind;
  toolName: string | null;
  toolCallKey: string | null;
  input: unknown | null;
  output: unknown | null;
  tokens: number;
  durationMs: number;
  error: string | null;
  byUserId: string | null;
  createdAt: Date;
};

export class AgentCancelled extends Error {
  constructor(public reason: CancelReason) {
    super(`agent run cancelled: ${reason}`);
  }
}

export class AgentBudgetExhausted extends Error {
  constructor(public dimension: 'steps' | 'seconds' | 'tokens') {
    super(`agent budget exhausted on ${dimension}`);
  }
}

export const DEFAULT_BUDGET: AgentBudget = {
  maxSteps: 20,
  maxSeconds: 600,
  maxTokens: 100_000,
};
```

- [ ] **Step 3.2：typecheck 通过**

```bash
npm run typecheck
```

Expected：PASS。

- [ ] **Step 3.3：Commit**

```bash
git add apps/api/src/lib/agent/types.ts
git commit -m "feat(agent): add core runtime types"
```

---

## Task 4: Store `store.ts`（agent_runs / agent_steps CRUD）

**Files:**
- Create: `apps/api/src/lib/agent/store.ts`
- Create: `apps/api/src/lib/agent/__tests__/store.test.ts`

- [ ] **Step 4.1：写失败测试**

新建 `apps/api/src/lib/agent/__tests__/store.test.ts`：

```typescript
import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { getPool } from '../../../db/client.js';
import { runMigrations } from '../../../db/migrate.js';
import * as agentStore from '../store.js';
import { DEFAULT_BUDGET } from '../types.js';
import { createUser } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';

async function ensureUser(name: string): Promise<string> {
  const u = await createUser({
    username: name + '-' + randomUUID().slice(0, 6),
    passwordHash: await hashPassword('xxxxxxxx'),
    displayName: name,
  });
  return u.id;
}

describe('agent store', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('creates and reads an agent run', async () => {
    const ownerId = await ensureUser('runner');
    const created = await agentStore.insertAgentRun({
      ownerId,
      channel: 'private',
      sessionId: null,
      groupId: null,
      topicId: null,
      intentTurnId: null,
      role: 'generalist',
      status: 'draft',
      inputText: 'hello',
      budget: DEFAULT_BUDGET,
      apiKeySource: 'user',
      apiKeyOwnerId: ownerId,
    });

    expect(created.id).toBeDefined();
    expect(created.status).toBe('draft');

    const fetched = await agentStore.getAgentRun(created.id);
    expect(fetched?.inputText).toBe('hello');
    expect(fetched?.budget.maxSteps).toBe(20);
    expect(fetched?.usage.steps).toBe(0);
  });

  it('updates status and usage', async () => {
    const ownerId = await ensureUser('u2');
    const r = await agentStore.insertAgentRun({
      ownerId,
      channel: 'private',
      sessionId: null,
      groupId: null,
      topicId: null,
      intentTurnId: null,
      role: 'generalist',
      status: 'draft',
      inputText: 'x',
      budget: DEFAULT_BUDGET,
      apiKeySource: 'server',
      apiKeyOwnerId: null,
    });
    await agentStore.updateAgentRun(r.id, {
      status: 'running',
      usage: { steps: 1, elapsedSeconds: 5, tokens: 100, costCny: 0.01 },
      lastHeartbeatAt: new Date(),
    });
    const after = await agentStore.getAgentRun(r.id);
    expect(after?.status).toBe('running');
    expect(after?.usage.tokens).toBe(100);
    expect(after?.lastHeartbeatAt).toBeTruthy();
  });

  it('inserts steps and lists by idx', async () => {
    const ownerId = await ensureUser('u3');
    const r = await agentStore.insertAgentRun({
      ownerId, channel: 'private', sessionId: null, groupId: null, topicId: null,
      intentTurnId: null, role: 'generalist', status: 'running',
      inputText: 'x', budget: DEFAULT_BUDGET, apiKeySource: 'server', apiKeyOwnerId: null,
    });
    await agentStore.insertStep({ runId: r.id, idx: 0, kind: 'plan', input: { hi: 1 } });
    await agentStore.insertStep({ runId: r.id, idx: 1, kind: 'tool_call', toolName: 'echo', input: { x: 1 }, output: { x: 1 } });
    const steps = await agentStore.listSteps(r.id);
    expect(steps.length).toBe(2);
    expect(steps[0].kind).toBe('plan');
    expect(steps[1].toolName).toBe('echo');
  });

  it('inserts step idempotently (UNIQUE run_id, idx)', async () => {
    const ownerId = await ensureUser('u4');
    const r = await agentStore.insertAgentRun({
      ownerId, channel: 'private', sessionId: null, groupId: null, topicId: null,
      intentTurnId: null, role: 'generalist', status: 'running',
      inputText: 'x', budget: DEFAULT_BUDGET, apiKeySource: 'server', apiKeyOwnerId: null,
    });
    await agentStore.insertStep({ runId: r.id, idx: 0, kind: 'plan' });
    await expect(
      agentStore.insertStep({ runId: r.id, idx: 0, kind: 'plan' }),
    ).rejects.toThrow();
  });

  it('finds step by tool_call_key', async () => {
    const ownerId = await ensureUser('u5');
    const r = await agentStore.insertAgentRun({
      ownerId, channel: 'private', sessionId: null, groupId: null, topicId: null,
      intentTurnId: null, role: 'generalist', status: 'running',
      inputText: 'x', budget: DEFAULT_BUDGET, apiKeySource: 'server', apiKeyOwnerId: null,
    });
    await agentStore.insertStep({
      runId: r.id, idx: 0, kind: 'tool_call', toolName: 'echo',
      toolCallKey: 'k1', input: { x: 1 }, output: { x: 1 },
    });
    const found = await agentStore.findStepByToolCallKey(r.id, 'k1');
    expect(found?.toolName).toBe('echo');
  });

  it('pickupNextRun returns oldest stale run with row lock semantics', async () => {
    const ownerId = await ensureUser('u6');
    const r = await agentStore.insertAgentRun({
      ownerId, channel: 'private', sessionId: null, groupId: null, topicId: null,
      intentTurnId: null, role: 'generalist', status: 'draft',
      inputText: 'x', budget: DEFAULT_BUDGET, apiKeySource: 'server', apiKeyOwnerId: null,
    });
    const picked = await agentStore.pickupNextRun();
    expect(picked?.id).toBe(r.id);
    expect(picked?.lastHeartbeatAt).toBeTruthy();
  });
});
```

注意：测试假定 `hashPassword` 在 `lib/auth.ts`。如签名不同（如返回 Promise<string>），按实际改。

- [ ] **Step 4.2：运行确认失败**

```bash
npm run test -w @xzz/api -- src/lib/agent/__tests__/store.test.ts
```

Expected：FAIL — `../store.js` 不存在。

- [ ] **Step 4.3：实现 store.ts**

新建 `apps/api/src/lib/agent/store.ts`：

```typescript
import { randomUUID } from 'crypto';
import type { PoolClient } from 'pg';
import { getPool } from '../../db/client.js';
import {
  type AgentRun,
  type AgentRunStatus,
  type AgentStep,
  type AgentBudget,
  type AgentUsage,
  type CancelReason,
  type Plan,
  type TodoItem,
  type StepKind,
  type ApiKeySource,
  type AgentChannel,
  type AgentRole,
} from './types.js';

type Row = Record<string, unknown>;

function parseRun(row: Row): AgentRun {
  return {
    id: row.id as string,
    ownerId: row.owner_id as string,
    channel: row.channel as AgentChannel,
    sessionId: (row.session_id as string | null) ?? null,
    groupId: (row.group_id as string | null) ?? null,
    topicId: (row.topic_id as string | null) ?? null,
    intentTurnId: (row.intent_turn_id as string | null) ?? null,
    role: row.role as AgentRole,
    status: row.status as AgentRunStatus,
    inputText: row.input_text as string,
    plan: (row.plan as Plan | null) ?? null,
    todos: (row.todos as TodoItem[]) ?? [],
    budget: row.budget as AgentBudget,
    usage:
      (row.usage as AgentUsage) ?? {
        steps: 0,
        elapsedSeconds: 0,
        tokens: 0,
        costCny: 0,
      },
    apiKeyOwnerId: (row.api_key_owner_id as string | null) ?? null,
    apiKeySource: row.api_key_source as ApiKeySource,
    resultMessageId: (row.result_message_id as string | null) ?? null,
    invokeMessageId: (row.invoke_message_id as string | null) ?? null,
    lastHeartbeatAt: (row.last_heartbeat_at as Date | null) ?? null,
    awaitingApprovalUntil: (row.awaiting_approval_until as Date | null) ?? null,
    awaitingApprovalStepIdx: (row.awaiting_approval_step_idx as number | null) ?? null,
    pendingApprovalToolName: (row.pending_approval_tool_name as string | null) ?? null,
    cancelledByUserId: (row.cancelled_by_user_id as string | null) ?? null,
    cancelReason: (row.cancel_reason as CancelReason | null) ?? null,
    createdAt: row.created_at as Date,
    startedAt: (row.started_at as Date | null) ?? null,
    endedAt: (row.ended_at as Date | null) ?? null,
  };
}

function parseStep(row: Row): AgentStep {
  return {
    id: row.id as string,
    runId: row.run_id as string,
    idx: row.idx as number,
    kind: row.kind as StepKind,
    toolName: (row.tool_name as string | null) ?? null,
    toolCallKey: (row.tool_call_key as string | null) ?? null,
    input: row.input ?? null,
    output: row.output ?? null,
    tokens: (row.tokens as number) ?? 0,
    durationMs: (row.duration_ms as number) ?? 0,
    error: (row.error as string | null) ?? null,
    byUserId: (row.by_user_id as string | null) ?? null,
    createdAt: row.created_at as Date,
  };
}

const RUN_COLUMNS = `id, owner_id, channel, session_id, group_id, topic_id,
  intent_turn_id, role, status, input_text, plan, todos, budget, usage,
  api_key_owner_id, api_key_source, result_message_id, invoke_message_id,
  last_heartbeat_at, awaiting_approval_until, awaiting_approval_step_idx,
  pending_approval_tool_name, cancelled_by_user_id, cancel_reason,
  created_at, started_at, ended_at`;

export type InsertAgentRunInput = {
  id?: string;
  ownerId: string;
  channel: AgentChannel;
  sessionId: string | null;
  groupId: string | null;
  topicId: string | null;
  intentTurnId: string | null;
  role: AgentRole;
  status: AgentRunStatus;
  inputText: string;
  budget: AgentBudget;
  apiKeyOwnerId: string | null;
  apiKeySource: ApiKeySource;
};

export async function insertAgentRun(
  input: InsertAgentRunInput,
): Promise<AgentRun> {
  const id = input.id ?? randomUUID();
  const { rows } = await getPool().query(
    `INSERT INTO agent_runs (
       id, owner_id, channel, session_id, group_id, topic_id,
       intent_turn_id, role, status, input_text, budget,
       api_key_owner_id, api_key_source
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING ${RUN_COLUMNS}`,
    [
      id,
      input.ownerId,
      input.channel,
      input.sessionId,
      input.groupId,
      input.topicId,
      input.intentTurnId,
      input.role,
      input.status,
      input.inputText,
      JSON.stringify(input.budget),
      input.apiKeyOwnerId,
      input.apiKeySource,
    ],
  );
  return parseRun(rows[0]);
}

export async function getAgentRun(id: string): Promise<AgentRun | null> {
  const { rows } = await getPool().query(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = $1`,
    [id],
  );
  return rows[0] ? parseRun(rows[0]) : null;
}

export type UpdateAgentRunInput = Partial<{
  status: AgentRunStatus;
  plan: Plan | null;
  todos: TodoItem[];
  usage: AgentUsage;
  resultMessageId: string | null;
  invokeMessageId: string | null;
  lastHeartbeatAt: Date | null;
  awaitingApprovalUntil: Date | null;
  awaitingApprovalStepIdx: number | null;
  pendingApprovalToolName: string | null;
  cancelledByUserId: string | null;
  cancelReason: CancelReason | null;
  startedAt: Date | null;
  endedAt: Date | null;
}>;

export async function updateAgentRun(
  id: string,
  patch: UpdateAgentRunInput,
): Promise<AgentRun | null> {
  const map: Record<string, [string, unknown]> = {
    status: ['status', patch.status],
    plan: ['plan', patch.plan === undefined ? undefined : JSON.stringify(patch.plan)],
    todos: ['todos', patch.todos === undefined ? undefined : JSON.stringify(patch.todos)],
    usage: ['usage', patch.usage === undefined ? undefined : JSON.stringify(patch.usage)],
    resultMessageId: ['result_message_id', patch.resultMessageId],
    invokeMessageId: ['invoke_message_id', patch.invokeMessageId],
    lastHeartbeatAt: ['last_heartbeat_at', patch.lastHeartbeatAt],
    awaitingApprovalUntil: ['awaiting_approval_until', patch.awaitingApprovalUntil],
    awaitingApprovalStepIdx: ['awaiting_approval_step_idx', patch.awaitingApprovalStepIdx],
    pendingApprovalToolName: ['pending_approval_tool_name', patch.pendingApprovalToolName],
    cancelledByUserId: ['cancelled_by_user_id', patch.cancelledByUserId],
    cancelReason: ['cancel_reason', patch.cancelReason],
    startedAt: ['started_at', patch.startedAt],
    endedAt: ['ended_at', patch.endedAt],
  };

  const sets: string[] = [];
  const values: unknown[] = [];
  for (const key of Object.keys(patch) as Array<keyof UpdateAgentRunInput>) {
    const entry = map[key];
    if (!entry) continue;
    const [column, value] = entry;
    if (value === undefined) continue;
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  }
  if (sets.length === 0) return getAgentRun(id);
  values.push(id);
  const { rows } = await getPool().query(
    `UPDATE agent_runs SET ${sets.join(', ')} WHERE id = $${values.length}
     RETURNING ${RUN_COLUMNS}`,
    values,
  );
  return rows[0] ? parseRun(rows[0]) : null;
}

export type InsertStepInput = {
  id?: string;
  runId: string;
  idx: number;
  kind: StepKind;
  toolName?: string | null;
  toolCallKey?: string | null;
  input?: unknown;
  output?: unknown;
  tokens?: number;
  durationMs?: number;
  error?: string | null;
  byUserId?: string | null;
};

export async function insertStep(input: InsertStepInput): Promise<AgentStep> {
  const id = input.id ?? randomUUID();
  const { rows } = await getPool().query(
    `INSERT INTO agent_steps (
       id, run_id, idx, kind, tool_name, tool_call_key,
       input, output, tokens, duration_ms, error, by_user_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id, run_id, idx, kind, tool_name, tool_call_key,
               input, output, tokens, duration_ms, error, by_user_id, created_at`,
    [
      id,
      input.runId,
      input.idx,
      input.kind,
      input.toolName ?? null,
      input.toolCallKey ?? null,
      input.input === undefined ? null : JSON.stringify(input.input),
      input.output === undefined ? null : JSON.stringify(input.output),
      input.tokens ?? 0,
      input.durationMs ?? 0,
      input.error ?? null,
      input.byUserId ?? null,
    ],
  );
  return parseStep(rows[0]);
}

export async function listSteps(runId: string): Promise<AgentStep[]> {
  const { rows } = await getPool().query(
    `SELECT id, run_id, idx, kind, tool_name, tool_call_key,
            input, output, tokens, duration_ms, error, by_user_id, created_at
     FROM agent_steps WHERE run_id = $1 ORDER BY idx ASC`,
    [runId],
  );
  return rows.map(parseStep);
}

export async function findStepByToolCallKey(
  runId: string,
  toolCallKey: string,
): Promise<AgentStep | null> {
  const { rows } = await getPool().query(
    `SELECT id, run_id, idx, kind, tool_name, tool_call_key,
            input, output, tokens, duration_ms, error, by_user_id, created_at
     FROM agent_steps
     WHERE run_id = $1 AND tool_call_key = $2
     LIMIT 1`,
    [runId, toolCallKey],
  );
  return rows[0] ? parseStep(rows[0]) : null;
}

export async function maxStepIdx(runId: string): Promise<number> {
  const { rows } = await getPool().query(
    `SELECT MAX(idx) AS m FROM agent_steps WHERE run_id = $1`,
    [runId],
  );
  return (rows[0]?.m as number | null) ?? -1;
}

/**
 * 在事务内挑一条可运行的 run,加 FOR UPDATE SKIP LOCKED 锁,
 * 顺手把 last_heartbeat_at 写到 now() 以阻止其他 worker 抢同一行.
 *
 * 注意:这里只是"挑出来 + 占位",真正持锁/续约由调用方在 executeRun 里完成.
 */
export async function pickupNextRun(): Promise<AgentRun | null> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT ${RUN_COLUMNS} FROM agent_runs
       WHERE status IN ('draft','planning','running','replanning')
         AND (last_heartbeat_at IS NULL
              OR last_heartbeat_at < now() - interval '30 seconds')
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
    );
    if (rows.length === 0) {
      await client.query('COMMIT');
      return null;
    }
    const run = parseRun(rows[0]);
    await client.query(
      `UPDATE agent_runs SET last_heartbeat_at = now() WHERE id = $1`,
      [run.id],
    );
    await client.query('COMMIT');
    return { ...run, lastHeartbeatAt: new Date() };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 4.4：测试通过**

```bash
npm run test -w @xzz/api -- src/lib/agent/__tests__/store.test.ts
```

Expected：PASS。如失败：(a) 检查 PG 是否在跑（开发用 `npm run docker:up`） (b) `parseRun` 中 JSONB 字段 PG node driver 已经自动反序列化为 object，无需 `JSON.parse`，但写入时**必须** `JSON.stringify`（驱动对 jsonb 列要求字符串或 object 之一，统一字符串避免歧义）。

- [ ] **Step 4.5：Commit**

```bash
git add apps/api/src/lib/agent/store.ts apps/api/src/lib/agent/__tests__/store.test.ts
git commit -m "feat(agent): add store for agent_runs and agent_steps"
```

---

## Task 5: Budget 检查 `budget.ts`

**Files:**
- Create: `apps/api/src/lib/agent/budget.ts`
- Create: `apps/api/src/lib/agent/__tests__/budget.test.ts`

- [ ] **Step 5.1：写失败测试**

新建 `apps/api/src/lib/agent/__tests__/budget.test.ts`：

```typescript
import { describe, expect, it } from 'vitest';
import { checkBudget } from '../budget.js';
import {
  AgentBudgetExhausted,
  type AgentBudget,
  type AgentUsage,
} from '../types.js';

const B: AgentBudget = { maxSteps: 5, maxSeconds: 60, maxTokens: 1000 };

function u(p: Partial<AgentUsage>): AgentUsage {
  return { steps: 0, elapsedSeconds: 0, tokens: 0, costCny: 0, ...p };
}

describe('checkBudget', () => {
  it('passes under all limits', () => {
    expect(() => checkBudget(B, u({ steps: 2, elapsedSeconds: 10, tokens: 100 }))).not.toThrow();
  });

  it('throws on steps overflow', () => {
    expect(() => checkBudget(B, u({ steps: 5 }))).toThrow(AgentBudgetExhausted);
    expect(() => checkBudget(B, u({ steps: 5 }))).toThrow(/steps/);
  });

  it('throws on seconds overflow', () => {
    expect(() => checkBudget(B, u({ elapsedSeconds: 60 }))).toThrow(/seconds/);
  });

  it('throws on tokens overflow', () => {
    expect(() => checkBudget(B, u({ tokens: 1000 }))).toThrow(/tokens/);
  });
});
```

- [ ] **Step 5.2：运行确认失败**

```bash
npm run test -w @xzz/api -- src/lib/agent/__tests__/budget.test.ts
```

Expected：FAIL — `../budget.js` 不存在。

- [ ] **Step 5.3：实现 budget.ts**

新建 `apps/api/src/lib/agent/budget.ts`：

```typescript
import {
  AgentBudgetExhausted,
  type AgentBudget,
  type AgentUsage,
} from './types.js';

export function checkBudget(budget: AgentBudget, usage: AgentUsage): void {
  if (usage.steps >= budget.maxSteps) {
    throw new AgentBudgetExhausted('steps');
  }
  if (usage.elapsedSeconds >= budget.maxSeconds) {
    throw new AgentBudgetExhausted('seconds');
  }
  if (usage.tokens >= budget.maxTokens) {
    throw new AgentBudgetExhausted('tokens');
  }
}
```

- [ ] **Step 5.4：测试通过 + Commit**

```bash
npm run test -w @xzz/api -- src/lib/agent/__tests__/budget.test.ts
git add apps/api/src/lib/agent/budget.ts apps/api/src/lib/agent/__tests__/budget.test.ts
git commit -m "feat(agent): add budget check"
```

**测试覆盖：T2（Budget 检查）**

---

## Task 6: Tool Registry + echoSleep 工具

**Files:**
- Create: `apps/api/src/lib/agent/toolRegistry.ts`
- Create: `apps/api/src/lib/agent/tools/echoSleep.ts`

- [ ] **Step 6.1：实现 toolRegistry.ts（纯结构，先不写测试）**

新建 `apps/api/src/lib/agent/toolRegistry.ts`：

```typescript
import type { JSONSchema7 } from 'json-schema';
import type { AgentRole } from './types.js';

export type ApprovalMode = 'auto' | 'ask' | 'never';

export type ToolCtx = {
  runId: string;
  stepId: string;
  ownerId: string;
  channel: 'private' | 'group';
  groupId?: string;
  topicId?: string;
  signal: AbortSignal;
  apiKey?: string;
};

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
  handler: (input: I, ctx: ToolCtx) => Promise<O>;
};

class ToolRegistry {
  private tools = new Map<string, ToolDef>();

  register<I, O>(tool: ToolDef<I, O>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`tool ${tool.name} already registered`);
    }
    this.tools.set(tool.name, tool as ToolDef);
  }

  get(name: string): ToolDef | undefined {
    return this.tools.get(name);
  }

  require(name: string): ToolDef {
    const t = this.tools.get(name);
    if (!t) throw new Error(`unknown tool: ${name}`);
    return t;
  }

  list(role: AgentRole = 'generalist'): ToolDef[] {
    return Array.from(this.tools.values()).filter(
      (t) => !t.allowedRoles || t.allowedRoles.includes(role),
    );
  }
}

export const toolRegistry = new ToolRegistry();
```

注意 `JSONSchema7` 类型可能需要从 `@types/json-schema` 拉。先看是否已存在：

```bash
node -e "console.log(require('json-schema'))" 2>&1 | head -5
```

如果包不存在，安装：

```bash
npm i -D @types/json-schema -w @xzz/api
```

- [ ] **Step 6.2：实现 echoSleep 工具**

新建 `apps/api/src/lib/agent/tools/echoSleep.ts`：

```typescript
import { toolRegistry, type ToolDef } from '../toolRegistry.js';

type EchoSleepInput = {
  text: string;
  sleepMs?: number;
};

type EchoSleepOutput = {
  text: string;
  sleptMs: number;
};

export const echoSleepTool: ToolDef<EchoSleepInput, EchoSleepOutput> = {
  name: 'echo_after_sleep',
  description: '在 sleepMs 毫秒后回显 text;用于测试 agent runtime,不调外部服务.',
  inputSchema: {
    type: 'object',
    required: ['text'],
    properties: {
      text: { type: 'string' },
      sleepMs: { type: 'number', minimum: 0, maximum: 30_000 },
    },
  },
  approvalMode: 'auto',
  costHint: 'low',
  hasSideEffects: false,
  idempotent: true,
  async handler(input, ctx) {
    const ms = Math.max(0, Math.min(input.sleepMs ?? 1000, 30_000));
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      ctx.signal.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new Error('aborted'));
      }, { once: true });
    });
    return { text: input.text, sleptMs: ms };
  },
};

export function registerEchoSleep(): void {
  if (!toolRegistry.get(echoSleepTool.name)) {
    toolRegistry.register(echoSleepTool);
  }
}
```

- [ ] **Step 6.3：typecheck**

```bash
npm run typecheck
```

Expected：PASS。

- [ ] **Step 6.4：Commit**

```bash
git add apps/api/src/lib/agent/toolRegistry.ts apps/api/src/lib/agent/tools/echoSleep.ts apps/api/package.json package-lock.json
git commit -m "feat(agent): add tool registry and echoSleep mock tool"
```

---

## Task 7: Step Recorder（heartbeat + writeStep helper）

**Files:**
- Create: `apps/api/src/lib/agent/stepRecorder.ts`

- [ ] **Step 7.1：实现 stepRecorder.ts**

新建 `apps/api/src/lib/agent/stepRecorder.ts`：

```typescript
import * as store from './store.js';
import type { AgentRun, StepKind } from './types.js';

export type RecordStepInput = {
  runId: string;
  kind: StepKind;
  toolName?: string | null;
  toolCallKey?: string | null;
  input?: unknown;
  output?: unknown;
  tokens?: number;
  durationMs?: number;
  error?: string | null;
  byUserId?: string | null;
};

/**
 * 写一条 step,自动取下一 idx.
 * 注意:并发场景下 idx 由 db unique 约束兜底,调用方应捕获并 retry.
 */
export async function recordStep(input: RecordStepInput) {
  const nextIdx = (await store.maxStepIdx(input.runId)) + 1;
  return store.insertStep({ ...input, idx: nextIdx });
}

/**
 * 启动心跳:每 intervalMs 写一次 last_heartbeat_at = now().
 * 返回 stop fn.
 */
export function startHeartbeat(
  runId: string,
  intervalMs = 10_000,
): () => void {
  const timer = setInterval(() => {
    void store
      .updateAgentRun(runId, { lastHeartbeatAt: new Date() })
      .catch(() => {});
  }, intervalMs);
  return () => clearInterval(timer);
}

/** 用 run.usage + delta 写回新 usage */
export function incrementUsage(
  run: AgentRun,
  delta: {
    steps?: number;
    elapsedSeconds?: number;
    tokens?: number;
    costCny?: number;
  },
) {
  return {
    steps: run.usage.steps + (delta.steps ?? 0),
    elapsedSeconds: run.usage.elapsedSeconds + (delta.elapsedSeconds ?? 0),
    tokens: run.usage.tokens + (delta.tokens ?? 0),
    costCny: run.usage.costCny + (delta.costCny ?? 0),
  };
}
```

- [ ] **Step 7.2：typecheck + Commit**

```bash
npm run typecheck
git add apps/api/src/lib/agent/stepRecorder.ts
git commit -m "feat(agent): add step recorder and heartbeat helpers"
```

---

## Task 8: Planner（最小版，只支持 echoSleep）

**Files:**
- Create: `apps/api/src/lib/agent/planner.ts`
- Create: `apps/api/src/lib/agent/__tests__/planner.test.ts`

M1a 的 planner 不调 LLM —— 直接根据用户输入文本里的"N 步"或"三步"启发式生成 plan。这是为了让 M1a 不被 LLM 不稳定输出干扰，专心 runtime。M1c 阶段升级到真 LLM planner。

- [ ] **Step 8.1：写失败测试**

新建 `apps/api/src/lib/agent/__tests__/planner.test.ts`：

```typescript
import { describe, expect, it } from 'vitest';
import { generatePlanForEcho } from '../planner.js';

describe('planner (echo-only, M1a)', () => {
  it('parses "三步 echo" into 3 echo steps', () => {
    const plan = generatePlanForEcho('帮我跑三步 echo');
    expect(plan.steps.length).toBe(3);
    expect(plan.steps.every((s) => s.toolName === 'echo_after_sleep')).toBe(true);
    expect(plan.todos.length).toBe(3);
  });

  it('parses "5 步" into 5 steps', () => {
    const plan = generatePlanForEcho('跑 5 步 echo');
    expect(plan.steps.length).toBe(5);
  });

  it('defaults to 1 step when no number found', () => {
    const plan = generatePlanForEcho('echo 一下');
    expect(plan.steps.length).toBe(1);
  });

  it('produces a final reply hint', () => {
    const plan = generatePlanForEcho('两步 echo');
    expect(plan.finalReplyHint.length).toBeGreaterThan(0);
  });

  it('returns 1 step (not zero) for minimal request', () => {
    const plan = generatePlanForEcho('echo');
    expect(plan.steps.length).toBe(1);
  });

  it('caps steps at 10', () => {
    const plan = generatePlanForEcho('跑 100 步 echo');
    expect(plan.steps.length).toBeLessThanOrEqual(10);
  });
});
```

- [ ] **Step 8.2：运行确认失败**

```bash
npm run test -w @xzz/api -- src/lib/agent/__tests__/planner.test.ts
```

Expected：FAIL。

- [ ] **Step 8.3：实现 planner.ts**

新建 `apps/api/src/lib/agent/planner.ts`：

```typescript
import { randomUUID } from 'crypto';
import type { Plan, PlanStep, TodoItem } from './types.js';

const CN_NUM: Record<string, number> = {
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

function extractStepCount(text: string): number {
  const arabic = text.match(/(\d+)\s*步/);
  if (arabic) return Math.min(Math.max(parseInt(arabic[1], 10), 1), 10);
  for (const [ch, n] of Object.entries(CN_NUM)) {
    if (new RegExp(`${ch}\\s*步`).test(text)) return Math.min(n, 10);
  }
  return 1;
}

/**
 * M1a echo-only planner. 不调 LLM,纯本地规则.
 * 当 M1c 把 LLM planner 接入后,这个函数将被保留作为 echo 工具的 fallback.
 */
export function generatePlanForEcho(text: string): Plan {
  const n = extractStepCount(text);
  const todos: TodoItem[] = [];
  const steps: PlanStep[] = [];
  for (let i = 1; i <= n; i++) {
    const todoId = `t${i}`;
    todos.push({
      id: todoId,
      text: `Echo 第 ${i} 次`,
      status: 'pending',
      stepRefs: [],
    });
    steps.push({
      toolName: 'echo_after_sleep',
      input: { text: `第 ${i} 次 echo`, sleepMs: 1500 },
      reason: `测试 runtime 第 ${i} 步`,
      todoId,
    });
  }
  return {
    intentSummary: `测试 agent 跑 ${n} 步 echo`,
    steps,
    todos,
    finalReplyHint: `回复:已完成 ${n} 次 echo,每次间隔 1.5s.`,
    reasoning: null,
    version: 1,
  };
}
```

注意：`randomUUID` 导入是因为未来扩展会用，暂时未用到也保留以避免 Task 11/12 改动文件时来回 import。或者你严格 lint 可以删掉这行 import。

- [ ] **Step 8.4：测试通过 + Commit**

```bash
npm run test -w @xzz/api -- src/lib/agent/__tests__/planner.test.ts
git add apps/api/src/lib/agent/planner.ts apps/api/src/lib/agent/__tests__/planner.test.ts
git commit -m "feat(agent): add echo-only planner for M1a"
```

**测试覆盖：T3 部分（JSON 解析失败留 M1c 测试 LLM 版本）**

---

## Task 9: Context Adapter（私聊路径）

**Files:**
- Create: `apps/api/src/lib/agent/contextAdapter.ts`

M1a 的私聊 echo 任务其实**不需要** context（不调 LLM）。但 contextAdapter 是 M1c planner 的依赖，先把私聊路径的实现写好，避免后续返工。

- [ ] **Step 9.1：实现 contextAdapter.ts**

新建 `apps/api/src/lib/agent/contextAdapter.ts`：

```typescript
import type { ContextUsage, ReplyDialect } from '@xzz/shared';
import type { ChatMessageInput } from '../deepseek.js';
import { prepareChatContext } from '../contextPipeline.js';
import { listGroupMessages } from '../../store/pg-social.js';
import { buildGroupLlmSystem, resolveGroupHistoryMessages } from '../groupLlm.js';

export type TopicSkill = {
  id: string;
  scope: 'topic' | 'user' | 'group';
  ownerId: string | null;
  groupId: string | null;
  topicId: string | null;
  title: string;
  content: string;
  enabled: boolean;
};

export type AgentContextSnapshot = {
  systemPrompt: string;
  history: ChatMessageInput[];
  shortSummary: string;
  usage: ContextUsage;
  source: {
    channel: 'private' | 'group';
    sessionId?: string;
    groupId?: string;
    topicId?: string;
  };
};

function formatTopicSkillsAsSystemBlock(skills: TopicSkill[]): string {
  const enabled = skills.filter((s) => s.enabled);
  if (enabled.length === 0) return '';
  const items = enabled
    .map((s) => `### ${s.title}\n${s.content}`)
    .join('\n\n');
  return `\n\n<topic_skills source="user_provided">\n${items}\n</topic_skills>`;
}

export type SnapshotForAgentParams = {
  runId: string;
  userId: string;
  channel: 'private' | 'group';
  sessionId?: string;
  groupId?: string;
  topicId?: string;
  pendingUser: string;
  apiKey: string;
  topicSkills: TopicSkill[];
  dialect?: ReplyDialect;
};

export async function snapshotForAgent(
  params: SnapshotForAgentParams,
): Promise<AgentContextSnapshot> {
  if (params.channel === 'private') {
    if (!params.sessionId) {
      throw new Error('snapshotForAgent: private channel requires sessionId');
    }
    const prepared = await prepareChatContext({
      userId: params.userId,
      apiKey: params.apiKey,
      sessionId: params.sessionId,
      pendingUser: params.pendingUser,
      dialect: params.dialect,
    });
    // prepareChatContext 返回的 messages 第一条通常是 system, 最后一条是 pendingUser.
    // 我们需要拆分:把 system 抠出来追加 topicSkills,history 去掉 pendingUser.
    const systemMsg = prepared.messages.find((m) => m.role === 'system');
    const otherMsgs = prepared.messages.filter((m) => m.role !== 'system');
    // 移除最后一条 pendingUser
    const history =
      otherMsgs.length > 0 && otherMsgs[otherMsgs.length - 1].role === 'user'
        ? otherMsgs.slice(0, -1)
        : otherMsgs;
    const systemPrompt =
      (systemMsg?.content ?? '') +
      formatTopicSkillsAsSystemBlock(params.topicSkills);
    const last6 = history.slice(-6).map((m) => `${m.role}: ${m.content.slice(0, 80)}`).join('\n');
    const shortSummary = `本会话最近交流:\n${last6}`;
    return {
      systemPrompt,
      history,
      shortSummary,
      usage: prepared.usage,
      source: { channel: 'private', sessionId: params.sessionId },
    };
  }

  // group
  if (!params.groupId || !params.topicId) {
    throw new Error('snapshotForAgent: group channel requires groupId+topicId');
  }
  const messages =
    (await listGroupMessages(params.userId, params.groupId, params.topicId, {
      limit: 50,
    })) ?? [];
  const selected = resolveGroupHistoryMessages(messages, null, undefined).slice(-12);
  const systemBase = await buildGroupLlmSystem(params.userId, params.dialect, {
    groupId: params.groupId,
    topicId: params.topicId,
    query: params.pendingUser,
  });
  const systemPrompt = systemBase + formatTopicSkillsAsSystemBlock(params.topicSkills);
  const history: ChatMessageInput[] = selected.map((m) => {
    const role: 'assistant' | 'user' = m.kind === 'ai' ? 'assistant' : 'user';
    const speaker =
      m.kind === 'ai' && m.invokerAssistantName
        ? `${m.authorDisplayName ?? '成员'} 的 ${m.invokerAssistantName}`
        : m.authorDisplayName ?? '成员';
    return { role, content: `[${speaker}] ${m.content}` };
  });
  const last6 = selected
    .slice(-6)
    .map((m) => `${m.authorDisplayName ?? '成员'}: ${m.content.slice(0, 80)}`)
    .join('\n');
  return {
    systemPrompt,
    history,
    shortSummary: `群聊最近 6 条:\n${last6}`,
    usage: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      ratio: 0,
      compacted: false,
    },
    source: {
      channel: 'group',
      groupId: params.groupId,
      topicId: params.topicId,
    },
  };
}
```

- [ ] **Step 9.2：typecheck**

```bash
npm run typecheck
```

Expected：PASS。如果 `ContextUsage` 类型字段名和上面不一致（如 `ratio` 实为 `usageRatio`），按 `@xzz/shared` 实际改。先看一眼：

```bash
grep -n "export type ContextUsage" packages/shared/src/llm/*.ts packages/shared/src/*.ts 2>/dev/null
```

- [ ] **Step 9.3：Commit**

```bash
git add apps/api/src/lib/agent/contextAdapter.ts
git commit -m "feat(agent): add context adapter (private + group)"
```

---

## Task 10: Message Bridge（私聊）

**Files:**
- Create: `apps/api/src/lib/agent/messageBridge.ts`

私聊场景下，`createAgentRun` 时立刻写入 user message + placeholder assistant message，并把 `agentRunId` 塞进 assistant message 的 payload。worker 跑完时 UPDATE 该 placeholder。

- [ ] **Step 10.1：先找现有写 message 的接口**

```bash
grep -n "addChatMessage" apps/api/src/store/pg.ts | head -5
```

Expected：看到类似 `export async function addChatMessage(...)`。如果它的签名不接受 `payload` 字段（例如只接 role/content），需要直接走 SQL UPDATE。下一步根据实际情况选 a 或 b。

- [ ] **Step 10.2a：若 addChatMessage 支持 payload —— 直接调用**

新建 `apps/api/src/lib/agent/messageBridge.ts`：

```typescript
import { getPool } from '../../db/client.js';
import * as pg from '../../store/pg.js';

export type PrivatePlaceholderResult = {
  userMessageId: string;
  placeholderMessageId: string;
};

/**
 * 在私聊 session 里写入用户原文 + assistant placeholder.
 * placeholder.payload.agentRunId 用于前端识别这是 agent 任务.
 */
export async function writePrivatePlaceholder(params: {
  userId: string;
  sessionId: string;
  inputText: string;
  agentRunId: string;
}): Promise<PrivatePlaceholderResult> {
  const userMsg = await pg.addChatMessage(
    params.userId,
    params.sessionId,
    'user',
    params.inputText,
  );
  if (!userMsg) throw new Error('failed to write user message');

  const placeholderContent = '[Agent 任务进行中…]';
  const placeholder = await pg.addChatMessage(
    params.userId,
    params.sessionId,
    'assistant',
    placeholderContent,
  );
  if (!placeholder) throw new Error('failed to write placeholder message');

  // 直接 SQL UPDATE payload(若 pg.addChatMessage 不支持 payload 字段)
  await getPool().query(
    `UPDATE private_chat_messages
     SET payload = jsonb_set(
       payload,
       '{agentRun}',
       jsonb_build_object('agentRunId', $2::text, 'status', 'draft')
     )
     WHERE id = $1`,
    [placeholder.id, params.agentRunId],
  );

  return {
    userMessageId: userMsg.id,
    placeholderMessageId: placeholder.id,
  };
}

/** 任务终态时更新 placeholder 的 content 和 status. */
export async function finalizePrivatePlaceholder(params: {
  messageId: string;
  finalContent: string;
  status: 'completed' | 'failed' | 'cancelled' | 'budget_exhausted';
}): Promise<void> {
  await getPool().query(
    `UPDATE private_chat_messages
     SET payload = jsonb_set(
       jsonb_set(payload, '{content}', to_jsonb($2::text)),
       '{agentRun,status}', to_jsonb($3::text)
     )
     WHERE id = $1`,
    [params.messageId, params.finalContent, params.status],
  );
}
```

- [ ] **Step 10.2b：如果 addChatMessage 签名差异较大**

打开 `apps/api/src/store/pg.ts` 找 `addChatMessage` 的真实签名（包括返回类型），调整上面调用。一定**不要绕过现有 message 写入函数手写 SQL INSERT**，否则其他 reader（如 `getChatMessages`）解析 payload 结构会不一致。

如果 addChatMessage 实际把 content 存进 `payload->'content'`，那把 placeholderContent 当成参数传进去后，记得 finalize 时**同时**更新 `payload->'content'`（上面的 SQL 已经这么做）。

- [ ] **Step 10.3：typecheck**

```bash
npm run typecheck
```

Expected：PASS。

- [ ] **Step 10.4：Commit**

```bash
git add apps/api/src/lib/agent/messageBridge.ts
git commit -m "feat(agent): add private message bridge (placeholder + finalize)"
```

---

## Task 11: Runtime — `createAgentRun` + `executeRun`

**Files:**
- Create: `apps/api/src/lib/agent/runtime.ts`
- Create: `apps/api/src/lib/agent/__tests__/runtime.test.ts`

- [ ] **Step 11.1：写失败测试**

新建 `apps/api/src/lib/agent/__tests__/runtime.test.ts`：

```typescript
import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import { createUser } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';
import { createChatSession } from '../../../store/pg.js';
import { registerEchoSleep } from '../tools/echoSleep.js';
import { createAgentRun, executeRun } from '../runtime.js';
import { getAgentRun, listSteps } from '../store.js';

async function ensureUser(name: string) {
  return createUser({
    username: name + '-' + randomUUID().slice(0, 6),
    passwordHash: await hashPassword('xxxxxxxx'),
    displayName: name,
  });
}

describe('agent runtime end-to-end (echo)', () => {
  beforeAll(async () => {
    await runMigrations();
    registerEchoSleep();
  });

  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('creates a run + runs 3 echo steps to completion', async () => {
    const user = await ensureUser('e2e');
    const session = await createChatSession(user.id, 'agent test');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: session.id,
      inputText: '跑三步 echo',
      apiKey: 'fake',
      apiKeySource: 'server',
    });
    expect(run.status).toBe('draft');

    await executeRun(run.id);

    const after = await getAgentRun(run.id);
    expect(after?.status).toBe('completed');
    const steps = await listSteps(run.id);
    const kinds = steps.map((s) => s.kind);
    expect(kinds).toContain('plan');
    expect(kinds.filter((k) => k === 'tool_call').length).toBe(3);
    expect(kinds[kinds.length - 1]).toBe('reply');
  });

  it('respects cancellation mid-run', async () => {
    const user = await ensureUser('cxl');
    const session = await createChatSession(user.id, 'cxl');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: session.id,
      inputText: '跑 5 步 echo',
      apiKey: 'fake',
      apiKeySource: 'server',
    });
    // 启动 executeRun 但不 await,半秒后取消
    const exec = executeRun(run.id);
    await new Promise((r) => setTimeout(r, 800));
    // 直接通过 store + signal 模拟 cancel:这里我们走 cancel API 的内部函数(待 Task 13 提供 cancelRun)
    const { cancelRun } = await import('../runtime.js');
    await cancelRun(run.id, user.id);
    await exec;
    const after = await getAgentRun(run.id);
    expect(after?.status).toBe('cancelled');
    expect(after?.cancelReason).toBe('user');
  });

  it('soft-completes when budget exhausts on steps', async () => {
    const user = await ensureUser('bgt');
    const session = await createChatSession(user.id, 'bgt');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: session.id,
      inputText: '跑 5 步 echo',
      apiKey: 'fake',
      apiKeySource: 'server',
      budget: { maxSteps: 2, maxSeconds: 600, maxTokens: 100_000 },
    });
    await executeRun(run.id);
    const after = await getAgentRun(run.id);
    expect(after?.status).toBe('budget_exhausted');
    const steps = await listSteps(run.id);
    expect(steps.filter((s) => s.kind === 'tool_call').length).toBeLessThanOrEqual(2);
  });
});
```

注意 `createChatSession` 真实签名可能是 `createChatSession(userId, title)`；若不同请按实际改。

- [ ] **Step 11.2：运行确认失败**

```bash
npm run test -w @xzz/api -- src/lib/agent/__tests__/runtime.test.ts
```

Expected：FAIL — `runtime.js` 不存在。

- [ ] **Step 11.3：实现 runtime.ts**

新建 `apps/api/src/lib/agent/runtime.ts`：

```typescript
import { randomUUID } from 'crypto';
import * as store from './store.js';
import {
  AgentBudgetExhausted,
  AgentCancelled,
  DEFAULT_BUDGET,
  type AgentBudget,
  type AgentChannel,
  type AgentRun,
  type CancelReason,
  type Plan,
  type TodoItem,
} from './types.js';
import { generatePlanForEcho } from './planner.js';
import { recordStep, incrementUsage, startHeartbeat } from './stepRecorder.js';
import { toolRegistry } from './toolRegistry.js';
import { checkBudget } from './budget.js';
import { writePrivatePlaceholder, finalizePrivatePlaceholder } from './messageBridge.js';

const TOOL_TIMEOUT_MS = 60_000;

/** 进程内 runId -> AbortController, 供 cancelRun / steer 触发 */
const runControllers = new Map<string, AbortController>();

export type CreateAgentRunInput = {
  ownerId: string;
  channel: AgentChannel;
  sessionId?: string;
  groupId?: string;
  topicId?: string;
  intentTurnId?: string;
  inputText: string;
  apiKey: string;
  apiKeySource: 'user' | 'server';
  budget?: AgentBudget;
};

export type CreateAgentRunResult = {
  run: AgentRun;
  userMessageId: string | null;
  placeholderMessageId: string | null;
};

export async function createAgentRun(
  input: CreateAgentRunInput,
): Promise<CreateAgentRunResult> {
  const run = await store.insertAgentRun({
    ownerId: input.ownerId,
    channel: input.channel,
    sessionId: input.sessionId ?? null,
    groupId: input.groupId ?? null,
    topicId: input.topicId ?? null,
    intentTurnId: input.intentTurnId ?? null,
    role: 'generalist',
    status: 'draft',
    inputText: input.inputText,
    budget: input.budget ?? DEFAULT_BUDGET,
    apiKeyOwnerId: input.apiKeySource === 'user' ? input.ownerId : null,
    apiKeySource: input.apiKeySource,
  });

  let userMessageId: string | null = null;
  let placeholderMessageId: string | null = null;

  if (input.channel === 'private' && input.sessionId) {
    const bridge = await writePrivatePlaceholder({
      userId: input.ownerId,
      sessionId: input.sessionId,
      inputText: input.inputText,
      agentRunId: run.id,
    });
    userMessageId = bridge.userMessageId;
    placeholderMessageId = bridge.placeholderMessageId;
    await store.updateAgentRun(run.id, {
      resultMessageId: placeholderMessageId,
    });
  }

  return { run, userMessageId, placeholderMessageId };
}

function pickFinalContent(run: AgentRun, plan: Plan | null): string {
  if (!plan) return '[任务未完成]';
  const completed = (run.todos ?? plan.todos).filter((t) => t.status === 'completed').length;
  return `已完成 ${completed} 步:${plan.intentSummary}\n${plan.finalReplyHint}`;
}

async function softComplete(
  run: AgentRun,
  status: 'completed' | 'budget_exhausted' | 'failed' | 'cancelled',
  detail?: string,
) {
  const finalContent =
    status === 'budget_exhausted'
      ? `${pickFinalContent(run, run.plan)}\n\n[预算已用尽:${detail ?? ''}]`
      : status === 'cancelled'
        ? `[任务已取消${detail ? ':' + detail : ''}]`
        : status === 'failed'
          ? `[任务失败${detail ? ':' + detail : ''}]`
          : pickFinalContent(run, run.plan);

  if (run.resultMessageId && run.channel === 'private') {
    await finalizePrivatePlaceholder({
      messageId: run.resultMessageId,
      finalContent,
      status,
    });
  }

  await store.updateAgentRun(run.id, {
    status,
    endedAt: new Date(),
  });
}

export async function executeRun(runId: string): Promise<void> {
  const fetched = await store.getAgentRun(runId);
  if (!fetched) throw new Error(`run not found: ${runId}`);
  let run = fetched;
  if (
    run.status === 'completed' ||
    run.status === 'failed' ||
    run.status === 'cancelled' ||
    run.status === 'budget_exhausted'
  ) {
    return;
  }

  const abortController = new AbortController();
  runControllers.set(runId, abortController);
  const stopHb = startHeartbeat(runId, 10_000);
  const startedAt = run.startedAt ?? new Date();

  try {
    // 1) Plan
    if (!run.plan) {
      await store.updateAgentRun(runId, { status: 'planning', startedAt });
      const plan = generatePlanForEcho(run.inputText);
      await recordStep({ runId, kind: 'plan', output: plan });
      run = (await store.updateAgentRun(runId, {
        plan,
        todos: plan.todos,
        status: 'running',
      }))!;
    }

    const plan = run.plan!;
    const completedCount = run.usage.steps;

    // 2) 工具循环
    for (let i = completedCount; i < plan.steps.length; i++) {
      if (abortController.signal.aborted) throw new AgentCancelled('user');

      const elapsedSeconds = Math.floor((Date.now() - startedAt.getTime()) / 1000);
      checkBudget(run.budget, { ...run.usage, elapsedSeconds });

      const planStep = plan.steps[i];
      const tool = toolRegistry.require(planStep.toolName);
      const stepId = randomUUID();
      const ctx = {
        runId,
        stepId,
        ownerId: run.ownerId,
        channel: run.channel,
        groupId: run.groupId ?? undefined,
        topicId: run.topicId ?? undefined,
        signal: abortController.signal,
      };

      const t0 = Date.now();
      let output: unknown;
      let retried = false;
      try {
        output = await withTimeout(
          tool.handler(planStep.input as never, ctx),
          TOOL_TIMEOUT_MS,
        );
      } catch (err) {
        if (abortController.signal.aborted) throw new AgentCancelled('user');
        try {
          output = await withTimeout(
            tool.handler(planStep.input as never, ctx),
            TOOL_TIMEOUT_MS,
          );
          retried = true;
        } catch (err2) {
          await recordStep({
            runId,
            kind: 'tool_error',
            toolName: tool.name,
            input: planStep.input,
            error: String(err2),
          });
          // M1a 简化:工具失败直接标 failed.M1b 起再做 replan.
          throw err2;
        }
      }
      const durationMs = Date.now() - t0;

      await recordStep({
        runId,
        kind: 'tool_call',
        toolName: tool.name,
        input: planStep.input,
        output: { result: output, retried },
        durationMs,
      });

      // 更新 todo + usage
      const newTodos: TodoItem[] = (run.todos ?? plan.todos).map((t) =>
        t.id === planStep.todoId ? { ...t, status: 'completed' as const } : t,
      );
      const elapsedFinal = Math.floor((Date.now() - startedAt.getTime()) / 1000);
      const usage = incrementUsage(run, { steps: 1, tokens: 0, elapsedSeconds: elapsedFinal - run.usage.elapsedSeconds });
      run = (await store.updateAgentRun(runId, {
        todos: newTodos,
        usage,
      }))!;
    }

    // 3) Reply
    const reply = pickFinalContent(run, plan);
    await recordStep({ runId, kind: 'reply', output: { content: reply } });
    await softComplete(run, 'completed');
  } catch (e) {
    const latest = (await store.getAgentRun(runId)) ?? run;
    if (e instanceof AgentCancelled) {
      await recordStep({ runId, kind: 'cancel', error: e.reason });
      await softComplete(latest, 'cancelled', e.reason);
    } else if (e instanceof AgentBudgetExhausted) {
      await softComplete(latest, 'budget_exhausted', e.dimension);
    } else {
      await recordStep({ runId, kind: 'system_error', error: String(e) });
      await softComplete(latest, 'failed', String(e).slice(0, 200));
    }
  } finally {
    stopHb();
    runControllers.delete(runId);
  }
}

export async function cancelRun(runId: string, byUserId: string): Promise<void> {
  const controller = runControllers.get(runId);
  if (controller) controller.abort('user_cancel');
  // 若 worker 不在本进程(已 crash),直接更新 db
  const run = await store.getAgentRun(runId);
  if (!run) return;
  if (
    run.status === 'completed' ||
    run.status === 'failed' ||
    run.status === 'cancelled' ||
    run.status === 'budget_exhausted'
  ) {
    return;
  }
  await store.updateAgentRun(runId, {
    status: 'cancelled',
    cancelledByUserId: byUserId,
    cancelReason: 'user',
    endedAt: new Date(),
  });
  if (run.resultMessageId && run.channel === 'private') {
    await finalizePrivatePlaceholder({
      messageId: run.resultMessageId,
      finalContent: '[任务已取消]',
      status: 'cancelled',
    });
  }
}

export async function confirmRun(runId: string): Promise<void> {
  const run = await store.getAgentRun(runId);
  if (!run || run.status !== 'awaiting_confirm') return;
  await store.updateAgentRun(runId, { status: 'running' });
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('tool timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
```

**M1a 简化说明：**
1. 没实现 `awaiting_confirm` 倒计时（默认所有 plan 直接进 running，方便 M1a 测试），M1b 加
2. 工具失败 → 直接 failed，没 replan，M1b 加
3. critique 没接入，M1b 加
4. group 通道完整支持留 M1b

- [ ] **Step 11.4：测试通过**

```bash
npm run test -w @xzz/api -- src/lib/agent/__tests__/runtime.test.ts
```

Expected：PASS。如失败常见原因：
- `createChatSession` 函数名不同 → 看 `apps/api/src/store/pg.ts`
- `addChatMessage` 返回类型不同 → 同上
- 测试 timeout：echoSleep 默认 sleepMs=1500，3 步 ~5s，5 步 ~8s；测试超时阈值（vitest 默认 5s）需要在 `vitest.config.ts` 调到 30s。**先把这个调好**：

```bash
cat apps/api/vitest.config.ts 2>/dev/null || echo "no config"
```

如无 config，新建 `apps/api/vitest.config.ts`：

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
```

- [ ] **Step 11.5：Commit**

```bash
git add apps/api/src/lib/agent/runtime.ts apps/api/src/lib/agent/__tests__/runtime.test.ts apps/api/vitest.config.ts
git commit -m "feat(agent): add runtime with createAgentRun + executeRun + cancel"
```

**测试覆盖：T1（状态机迁移）、T6（echo tool integration）**

---

## Task 12: Worker — pickup 循环

**Files:**
- Create: `apps/api/src/lib/agent/worker.ts`

- [ ] **Step 12.1：实现 worker.ts**

新建 `apps/api/src/lib/agent/worker.ts`：

```typescript
import * as store from './store.js';
import { executeRun } from './runtime.js';

export type WorkerHandle = {
  stop: () => void;
};

const inFlight = new Set<string>();

async function tick() {
  if (inFlight.size > 0) return;  // M1a 并发为 1
  const run = await store.pickupNextRun().catch(() => null);
  if (!run) return;
  inFlight.add(run.id);
  executeRun(run.id)
    .catch(() => {})
    .finally(() => inFlight.delete(run.id));
}

export function startAgentWorker(
  opts: { concurrency?: number; intervalMs?: number } = {},
): WorkerHandle {
  const interval = opts.intervalMs ?? 2_000;
  const timer = setInterval(() => {
    void tick();
  }, interval);
  return {
    stop: () => clearInterval(timer),
  };
}
```

- [ ] **Step 12.2：typecheck + Commit**

```bash
npm run typecheck
git add apps/api/src/lib/agent/worker.ts
git commit -m "feat(agent): add worker pickup loop"
```

---

## Task 13: Intent Rules — `/agent` slash 命令

**Files:**
- Modify: `apps/api/src/lib/intentRules.ts`
- Create: `apps/api/src/lib/__tests__/intentRules.agent.test.ts`

- [ ] **Step 13.1：写失败测试**

新建 `apps/api/src/lib/__tests__/intentRules.agent.test.ts`：

```typescript
import { describe, expect, it } from 'vitest';
import { matchSlashCommand, buildCandidatesFromRules } from '../intentRules.js';

describe('intentRules: /agent slash command (M1a)', () => {
  it('/agent triggers agent_run intent', () => {
    const match = matchSlashCommand({
      text: '/agent 跑三步 echo',
      channel: 'private',
    });
    expect(match).toBeTruthy();
    expect(match?.candidates[0].kind).toBe('agent_run');
    expect(match?.forceChips).toBe(true);
  });

  it('/agent puts agent_run as top candidate in buildCandidatesFromRules', () => {
    const r = buildCandidatesFromRules({
      text: '/agent 帮我跑',
      channel: 'private',
    });
    expect(r.candidates[0].kind).toBe('agent_run');
    expect(r.matchedRuleIds).toContain('slash_agent');
  });

  it('non-/agent slash does not trigger agent_run', () => {
    const r = buildCandidatesFromRules({
      text: '/记忆',
      channel: 'private',
    });
    expect(r.candidates[0].kind).not.toBe('agent_run');
  });
});
```

- [ ] **Step 13.2：运行确认失败**

```bash
npm run test -w @xzz/api -- src/lib/__tests__/intentRules.agent.test.ts
```

Expected：FAIL。

- [ ] **Step 13.3：修改 `intentRules.ts`**

打开 `apps/api/src/lib/intentRules.ts`，在 `matchSlashCommand` 函数（约 line 53）里的 `table` 对象里新增一项（紧跟 `'设置'` 之后即可）：

```typescript
    agent: {
      id: 'slash_agent',
      forceChips: true,
      candidates: [
        {
          kind: 'agent_run',
          label: '让 agent 跑',
          description: '后台多步执行,可中断',
          confidence: 0.95,
          group: 'primary',
        },
        {
          kind: chatKind(ctx.channel),
          label: chatLabel(ctx.channel),
          description: '不开 agent,直接和 AI 聊',
          confidence: 0.6,
          group: 'other',
        },
      ],
    },
```

注意 table key 是 `'agent'`，因为命令前缀是 `/agent`（取斜杠后第一个 token 小写）。

- [ ] **Step 13.4：测试通过 + Commit**

```bash
npm run test -w @xzz/api -- src/lib/__tests__/intentRules.agent.test.ts
git add apps/api/src/lib/intentRules.ts apps/api/src/lib/__tests__/intentRules.agent.test.ts
git commit -m "feat(intent): add /agent slash command trigger"
```

**测试覆盖：T9 部分（M1a 只验证 slash；完整规则在 M1c）**

---

## Task 14: Intent Execute — `agent_run` 分支

**Files:**
- Modify: `apps/api/src/lib/intentExecute.ts`

- [ ] **Step 14.1：扩展 IntentExecuteResult 类型**

打开 `packages/shared/src/social.ts`，找 `IntentExecuteResult` 类型定义，新增 `agent` variant。如果该类型是 union，加：

```bash
grep -n "IntentExecuteResult" packages/shared/src/social.ts
```

阅读上下文后，在 union 末尾追加：

```typescript
  | {
      type: 'agent';
      runId: string;
      userMessageId: string | null;
      placeholderMessageId: string | null;
      confirmation?: string;
    }
```

如果 IntentExecuteResult 是 interface，则改成 type union。**先 grep 出实际写法再改，避免破坏其他 variant**。

- [ ] **Step 14.2：build shared**

```bash
npm run build -w @xzz/shared
```

Expected：PASS。

- [ ] **Step 14.3：修改 `intentExecute.ts`，加 agent_run 分支**

在 `apps/api/src/lib/intentExecute.ts` 文件末尾的 `if (input.kind === 'chat_private_llm')` **之前**，插入：

```typescript
  if (input.kind === 'agent_run') {
    if (input.channel !== 'private' || !input.sessionId) {
      return { type: 'skipped', reason: 'AGENT_PRIVATE_ONLY_M1A' };
    }
    const { createAgentRun } = await import('./agent/runtime.js');
    const { run, userMessageId, placeholderMessageId } = await createAgentRun({
      ownerId: input.userId,
      channel: 'private',
      sessionId: input.sessionId,
      inputText: input.text,
      apiKey: input.deepseekApiKey ?? input.apiKey,
      apiKeySource: input.deepseekApiKey ? 'user' : 'server',
    });
    return {
      type: 'agent',
      runId: run.id,
      userMessageId,
      placeholderMessageId,
    };
  }
```

注意 M1a 阶段**只支持私聊**，群聊在 M1b。`agent_run` 分支返回后，前端拿到 `runId` 立即订阅 SSE。

- [ ] **Step 14.4：typecheck**

```bash
npm run typecheck
```

Expected：PASS。如有 `IntentExecuteResult` switch 报 exhaustive check 失败，按报错文件加 `case 'agent'` 处理（通常只是 mobile 一侧的渲染逻辑）。

- [ ] **Step 14.5：Commit**

```bash
git add apps/api/src/lib/intentExecute.ts packages/shared/src/social.ts packages/shared/dist
git commit -m "feat(intent): wire agent_run to createAgentRun (private only, M1a)"
```

---

## Task 15: HTTP/SSE 路由 — `routes/agent.ts`

**Files:**
- Create: `apps/api/src/routes/agent.ts`

- [ ] **Step 15.1：实现路由**

新建 `apps/api/src/routes/agent.ts`：

```typescript
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { ErrorCodes } from '@xzz/shared';
import type { AppVariables } from '../types.js';
import { jsonError } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import * as store from '../lib/agent/store.js';
import { cancelRun, confirmRun } from '../lib/agent/runtime.js';

export const agentRouter = new Hono<{ Variables: AppVariables }>();

agentRouter.use('*', requireAuth);

agentRouter.get('/runs/:id', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const run = await store.getAgentRun(id);
  if (!run) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  if (run.ownerId !== userId) return jsonError(c, ErrorCodes.FORBIDDEN, 403);
  const steps = await store.listSteps(id);
  return c.json({
    ok: true,
    data: { run, steps },
    requestId: c.get('requestId'),
  });
});

agentRouter.get('/runs/:id/stream', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const run = await store.getAgentRun(id);
  if (!run) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  if (run.ownerId !== userId) return jsonError(c, ErrorCodes.FORBIDDEN, 403);

  return streamSSE(c, async (stream) => {
    let lastStepIdx = -1;
    let lastStatus = run.status;
    let alive = true;
    stream.onAbort(() => { alive = false; });

    while (alive) {
      const current = await store.getAgentRun(id);
      if (!current) break;
      const steps = await store.listSteps(id);
      const newSteps = steps.filter((s) => s.idx > lastStepIdx);
      for (const s of newSteps) {
        await stream.writeSSE({
          event: 'step',
          data: JSON.stringify(s),
        });
        lastStepIdx = s.idx;
      }
      if (current.status !== lastStatus) {
        await stream.writeSSE({
          event: 'status',
          data: JSON.stringify({ status: current.status, runId: id }),
        });
        lastStatus = current.status;
      }
      const terminal =
        current.status === 'completed' ||
        current.status === 'failed' ||
        current.status === 'cancelled' ||
        current.status === 'budget_exhausted';
      if (terminal) {
        await stream.writeSSE({
          event: 'end',
          data: JSON.stringify({ runId: id, finalStatus: current.status }),
        });
        break;
      }
      await new Promise<void>((r) => setTimeout(r, 1_000));
    }
  });
});

agentRouter.post('/runs/:id/cancel', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const run = await store.getAgentRun(id);
  if (!run) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  // M1a 只允许 owner 自己取消;群聊放行留 M1b
  if (run.ownerId !== userId) return jsonError(c, ErrorCodes.FORBIDDEN, 403);
  await cancelRun(id, userId);
  return c.json({ ok: true, requestId: c.get('requestId') });
});

agentRouter.post('/runs/:id/confirm', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const run = await store.getAgentRun(id);
  if (!run) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  if (run.ownerId !== userId) return jsonError(c, ErrorCodes.FORBIDDEN, 403);
  await confirmRun(id);
  return c.json({ ok: true, requestId: c.get('requestId') });
});
```

注意 `ErrorCodes.FORBIDDEN` 若不存在则用 `ErrorCodes.UNAUTHORIZED` 或现有的等价物（grep 一下确认）。

- [ ] **Step 15.2：typecheck + Commit**

```bash
npm run typecheck
git add apps/api/src/routes/agent.ts
git commit -m "feat(api): add /agent routes (get + stream + cancel + confirm)"
```

---

## Task 16: 挂载 worker + 路由到 `index.ts`

**Files:**
- Modify: `apps/api/src/index.ts`

- [ ] **Step 16.1：导入 + 挂载**

打开 `apps/api/src/index.ts`，在 `import { intentRouter } from './routes/intent.js';` 之后加：

```typescript
import { agentRouter } from './routes/agent.js';
import { startAgentWorker } from './lib/agent/worker.js';
import { registerEchoSleep } from './lib/agent/tools/echoSleep.js';
```

然后在路由挂载块（找 `app.route('/intent', intentRouter)` 那一段）后追加：

```typescript
app.route('/agent', agentRouter);
```

最后在 `runMigrations()` 调用之后（`serve(...)` 之前）加：

```typescript
registerEchoSleep();
startAgentWorker({ concurrency: 1, intervalMs: 2_000 });
```

如果 `index.ts` 没有显式 `runMigrations()`（看是否在 startup.ts 里），那就紧跟 `serve(...)` 之**前**调用。先确认：

```bash
grep -n "runMigrations\|startup\|startAgentWorker" apps/api/src/index.ts
```

- [ ] **Step 16.2：手工 smoke test**

```bash
npm run build -w @xzz/shared
npm run dev:api
```

另开终端：

```bash
curl http://localhost:3922/health
# expected: {"ok":true,...}
```

- [ ] **Step 16.3：Commit**

```bash
git add apps/api/src/index.ts
git commit -m "feat(api): mount agent router and start worker"
```

---

## Task 17: End-to-end smoke test（手工）

**Files:** 无（手工验收）

- [ ] **Step 17.1：注册用户 + 拿 token**

按现有 README，使用 `/api/auth/register` 创建 fixtures 用户（或复用已有 user）。把 `Authorization: Bearer <token>` 备好。

- [ ] **Step 17.2：建一个私聊 session**

```bash
curl -X POST http://localhost:3922/chat/sessions \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"title":"agent test"}'
# response: { ok: true, data: { id, ... } }
```

记下 sessionId。

- [ ] **Step 17.3：通过 intent execute 触发 agent_run**

```bash
curl -X POST http://localhost:3922/intent/execute \
  -H "Authorization: Bearer <TOKEN>" \
  -H "X-DeepSeek-Api-Key: any" \
  -H "X-ZenMux-Api-Key: any" \
  -H "Content-Type: application/json" \
  -d '{
    "kind": "agent_run",
    "text": "/agent 跑三步 echo",
    "channel": "private",
    "sessionId": "<SESSION_ID>"
  }'
# response: { ok: true, data: { type: 'agent', runId, userMessageId, placeholderMessageId } }
```

记下 runId。

- [ ] **Step 17.4：订阅 SSE 看进度**

```bash
curl -N http://localhost:3922/agent/runs/<RUN_ID>/stream \
  -H "Authorization: Bearer <TOKEN>"
```

Expected：每 1-2 秒推一条 `step` 事件，最终一个 `status: completed` 和 `end`。

- [ ] **Step 17.5：拉聊天消息验证 placeholder 已更新**

```bash
curl http://localhost:3922/chat/sessions/<SESSION_ID>/messages \
  -H "Authorization: Bearer <TOKEN>"
```

Expected：最后一条 assistant message content 已经从 `[Agent 任务进行中…]` 变为 `已完成 3 步:...`。

- [ ] **Step 17.6：测试取消**

新开一个 run，立刻取消：

```bash
curl -X POST http://localhost:3922/intent/execute -H "..." -d '...'  # 拿到 runId
sleep 1
curl -X POST http://localhost:3922/agent/runs/<RUN_ID>/cancel -H "Authorization: Bearer <TOKEN>"
```

再查 messages，最后 assistant 应该是 `[任务已取消]`。

- [ ] **Step 17.7：测试 crash recovery（重要）**

```bash
# 1. 启动一个 5 步任务,echo 每步 1.5s,总共 7-8s
curl -X POST .../intent/execute ... '{"kind":"agent_run","text":"/agent 跑 5 步 echo",...}'
# 2. 立刻 kill -9 dev:api 进程
kill -9 $(lsof -ti tcp:3922)
# 3. 等 30s 让 heartbeat 失效
sleep 35
# 4. 重启
npm run dev:api &
# 5. 等几秒,看 logs / DB
psql -d xzz -c "SELECT id, status, usage FROM agent_runs ORDER BY created_at DESC LIMIT 1;"
# expected: status='completed' 或 'running'(正在续跑),usage.steps >= kill 之前的值
```

如果 status 仍是 'running' 但已经过去很久 → 看 worker 是否成功 pickup（grep "pickupNextRun" 的日志）。如果没有日志，可能是 worker `tick()` 没启动 — 回去 Task 16 检查。

如果 status 是 'failed'，看 agent_steps 最后一条 `kind='system_error'` 的 error 内容。

---

## Task 18: 最终 verification + 文档

**Files:**
- Modify: `README.md`

- [ ] **Step 18.1：全量测试通过**

```bash
npm run build -w @xzz/shared
npm run typecheck
npm run test -w @xzz/shared
npm run test -w @xzz/api
```

Expected：全部 PASS。

- [ ] **Step 18.2：在 README 末尾追加 agent 节**

打开 `README.md`，在文末追加：

```markdown

## Agent Runtime (M1a)

- 触发：在私聊里发 `/agent 跑三步 echo`
- 接口：
  - `POST /intent/execute` 带 `kind: 'agent_run'`
  - `GET /agent/runs/:id` 查任务详情
  - `GET /agent/runs/:id/stream`（SSE）看实时步骤
  - `POST /agent/runs/:id/cancel`
  - `POST /agent/runs/:id/confirm`
- M1a 只支持私聊 + echo mock 工具；群聊 + 真工具留 M1b/M1c
- 设计文档：`docs/superpowers/specs/2026-05-20-agent-runtime-design.md`
```

- [ ] **Step 18.3：Commit + 推送**

```bash
git add README.md
git commit -m "docs: document agent runtime M1a entry points"

# 推送到远端(如果有 remote)
git push -u origin feat/agent-runtime-m1a 2>&1 || echo "no remote configured"
```

---

## 完成验收清单（对照 Spec §18.1）

逐项核对 spec 中 M1a 的 8 条验收标准：

- [ ] **AC1**：跑 migration 建表成功 — Task 2
- [ ] **AC2**：私聊里发 `/agent 帮我跑三步 echo`，echoSleep 工具被调 3 次（每次 sleep ~1.5s）— Task 11 + 17
- [ ] **AC3**：`agent_steps` 含 plan + 3×tool_call + reply 共 5+ 条 — Task 11 测试
- [ ] **AC4**：SSE stream 实时推送 step 事件 — Task 15 + 17.4
- [ ] **AC5**：聊天里 placeholder message 最终被更新为 "已完成 3 步…" — Task 10 + 17.5
- [ ] **AC6**：cancel 后状态变 cancelled，placeholder 显示"已取消"— Task 11 + 17.6
- [ ] **AC7**：`awaiting_confirm` 10s 自动开跑 — **M1a 简化为单步自动跑，倒计时留 M1b**（在 spec §18.1 的 AC 中标记 "M1b 完成"）
- [ ] **AC8**：kill API 进程后重启续跑 — Task 17.7

测试矩阵覆盖（Spec §19）：

- [ ] **T1（状态机迁移）** — Task 11 测试
- [ ] **T2（Budget 检查）** — Task 5 测试
- [ ] **T3（Planner JSON schema）** — Task 8 测试（M1a echo-only planner；LLM JSON 解析失败留 M1c）
- [ ] **T6（echo tool integration）** — Task 11 测试
- [ ] **T9（intent agent_run trigger）** — Task 13 测试（slash 部分；完整规则 M1c）
- [ ] **T15（DB 迁移幂等）** — Task 2 测试

---

## 已知 M1a 简化项（M1b 必须补回）

1. ⚠️ `awaiting_confirm` 状态机分支未实现（直接 draft→planning→running）
2. ⚠️ `awaiting_approval` 状态机分支未实现
3. ⚠️ 工具失败 → 直接 failed，未做 retry+replan
4. ⚠️ Critique（self-reflection）未实现
5. ⚠️ Steer API 未实现
6. ⚠️ 群聊通道未实现（intentExecute 显式 reject `AGENT_PRIVATE_ONLY_M1A`）
7. ⚠️ TopicSkill CRUD API 未实现（表已建）
8. ⚠️ Mobile UI 未实现（前端仍能通过 SSE 看到，但没有 AgentRunCard）
9. ⚠️ MCP adapter 未实现
10. ⚠️ Hooks 事件总线未实现

这 10 项都已在 spec §18.2 (M1b) / §18.3 (M1c) / §18.4 (M1d) 安排了去处。

---

## Self-Review 摘要

**Spec 覆盖**：所有 M1a 章节都有对应 task；M1a 简化项均明确标 M1b 去向。

**Placeholder 扫描**：无 TBD/TODO/"implement later"。每个 step 都有具体代码或具体命令。

**类型一致性**：
- `AgentRun.status` 在 types.ts (Task 3) 定义为 union，store.ts (Task 4) parseRun 解码一致
- `Plan` / `PlanStep` / `TodoItem` 在 types.ts 定义，planner.ts (Task 8) / runtime.ts (Task 11) 引用一致
- `ToolDef.handler(input, ctx)` 签名跨 Task 6 / 11 一致
- `createAgentRun` 在 Task 11 定义返回 `{ run, userMessageId, placeholderMessageId }`，Task 14 intentExecute 解构匹配

---

Plan complete and saved to `docs/superpowers/plans/2026-05-20-agent-runtime-m1a.md`.

下一份 plan（M1b：群聊 + approval + steer + critique + mobile UI）等 M1a 实现完成、code review 通过后再写。
