# Agent Runtime M7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** v0.m7 子项目 B 首期 —— 群聊 Agent 并发协调：同 topic 自动合并 / queued 排队 / ask_user 群聊解禁 + 30s owner 独占 / deep_research 群聊子卡片。

**Architecture:** `acquireTopicSlot` 决策入口（intentExecute 内 advisory_xact_lock 串行同 topic）→ create_fresh / merge / queue 三分支；merge 写 `user_message_appended` step + `agent_runs.merged_inputs` JSONB；runExecute 每步前检查 `merged_inputs_consumed_count`，未消化 → record `replan(reason='merge_trigger')` + 切 `replanning` 让出，worker re-pickup 后走现有 `applyReplanningIfNeeded` 通路；ask_user 在群聊里写 `payload.kind='agent_ask_user'` 群消息，runExecute paused 分支补 `askUserStartedAt/Target`；worker checker `autoOpenAskUserForAll` 30s 后单事务 update run + group_messages.payload + emit hook；`AgentHookEvent` 新增 4 类，M6 long-poll 路由 hold 中订阅，命中立即出 batch。

**Tech Stack:** TypeScript / Hono / pg / Vitest（apps/api）；Expo / React Native（apps/mobile）。零新增 npm 依赖；migration `021_agent_topic_coord.sql`（注意 020 已被 artifact 占用）。

**Spec:** `docs/superpowers/specs/2026-05-22-agent-runtime-m7-design.md`

---

## 测试命令统一约定

后端测试（需 DB）：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run <test file>
```

后端全量：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run
```

Mobile 编译：

```bash
cd apps/mobile && npx tsc --noEmit
```

> 注：`runtime.group.test.ts` 偶尔 FK race flaky → 单文件重跑确认。M7 新增 group race 测试若 flaky，按同样方式处理。

---

## T0：分支 + baseline

**Files:** none

- [ ] **Step 1: 拉新分支 + 后端全量测试**

```bash
cd /Users/hongpengwang/agent-Carl-Gustav-Jung
git checkout main && git pull --ff-only
git checkout -b feat/agent-runtime-m7
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run
```

Expected：全绿，~470 tests（v0.m6 baseline）。记下数字 N0 备 T11 对比。

- [ ] **Step 2: Mobile 编译**

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected：exit 0。

- [ ] **Step 3: 锁定 migration 序号**

```bash
cd /Users/hongpengwang/agent-Carl-Gustav-Jung
ls apps/api/src/db/migrations/ | tail -5
```

Expected：最后一项是 `020_agent_run_artifact.sql`。M7 新 migration 用 `021_agent_topic_coord.sql`。

---

# Part A：T1 数据模型 + 类型扩展（基础设施）

## T1a：migration 021_agent_topic_coord.sql

**Files:**
- Create: `apps/api/src/db/migrations/021_agent_topic_coord.sql`
- Test: `apps/api/src/lib/agent/__tests__/migration.test.ts`（已存在 —— 加一个 case）

### Step 1：写 migration

- [ ] 创建 `apps/api/src/db/migrations/021_agent_topic_coord.sql`：

```sql
-- M7 子项目 B：群聊 Agent 并发协调
-- 包含：自动合并 + 排队 + ask_user 群聊扩展 + 两个 partial index。
--
-- 字段语义：
--   merged_inputs                    JSONB[]  追问数组 [{ text, byUserId, byUsername, at }]
--   merged_inputs_consumed_count     INT      runExecute 已注入到 planner / replan 的追问条数
--   queue_position                   INT      queued 时记位次（UI hint，非真源）
--   ask_user_target_user_id          TEXT     当前 ask_user 期待谁答（默认 = owner_id）
--   ask_user_started_at              TIMESTAMPTZ  本次 ask_user 进入 awaiting 的时刻
--                                                （独立于 last_heartbeat_at，后者被 worker 持续刷新）
--   ask_user_opened_for_all_at       TIMESTAMPTZ  worker checker 升级后 set
ALTER TABLE agent_runs
  ADD COLUMN merged_inputs JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN merged_inputs_consumed_count INT DEFAULT 0,
  ADD COLUMN queue_position INT,
  ADD COLUMN ask_user_target_user_id TEXT,
  ADD COLUMN ask_user_started_at TIMESTAMPTZ,
  ADD COLUMN ask_user_opened_for_all_at TIMESTAMPTZ;

-- blocking：真在跑的（不含 queued），acquireTopicSlot 用
CREATE INDEX IF NOT EXISTS idx_agent_runs_topic_blocking
  ON agent_runs(topic_id, created_at DESC)
  WHERE status IN ('draft','planning','running','replanning',
                   'awaiting_approval','awaiting_user_input');

-- queued：dequeueNextOnTopic 用，按入队时间升序
CREATE INDEX IF NOT EXISTS idx_agent_runs_topic_queued
  ON agent_runs(topic_id, created_at ASC)
  WHERE status = 'queued';
```

### Step 2：运行 migration

- [ ] 执行：

```bash
cd /Users/hongpengwang/agent-Carl-Gustav-Jung/apps/api
DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx tsx src/db/migrate.ts
```

Expected：日志包含 `021_agent_topic_coord.sql` 已 applied。

### Step 3：DB 字段核查

- [ ] 跑：

```bash
DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) psql "$DATABASE_URL" \
  -c "\d agent_runs" | grep -E "merged_inputs|queue_position|ask_user_"
```

Expected 输出包含 6 列：`merged_inputs`、`merged_inputs_consumed_count`、`queue_position`、`ask_user_target_user_id`、`ask_user_started_at`、`ask_user_opened_for_all_at`。

- [ ] 索引：

```bash
DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) psql "$DATABASE_URL" \
  -c "\d agent_runs" | grep -E "idx_agent_runs_topic_(blocking|queued)"
```

Expected：两个 partial index 存在。

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/db/migrations/021_agent_topic_coord.sql
git commit -m "feat(agent/m7-t1a): migration 021 agent topic coordination columns + partial indexes"
```

---

## T1b：types.ts 扩展（backend）

**Files:**
- Modify: `apps/api/src/lib/agent/types.ts`

### Step 1：扩 `AgentRunStatus` + 新 step kind + 新 `MergedInput` 类型 + `AgentRun` 字段

- [ ] 改 `apps/api/src/lib/agent/types.ts`：

```typescript
// L9-21 在 'budget_exhausted' 之前插 'queued'
export type AgentRunStatus =
  | 'draft'
  | 'planning'
  | 'awaiting_approval'
  | 'awaiting_user_input'
  | 'running'
  | 'replanning'
  | 'queued'           // M7: 同 topic active run 占用时入队
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'budget_exhausted';

// L125-146 StepKind 联合类型：加 'user_message_appended'（merge 时写）
export type StepKind =
  | 'plan'
  | 'replan'
  | 'critique'
  | 'tool_call'
  | 'tool_error'
  | 'observe'
  | 'user_input'
  | 'user_message_appended'  // M7：merge 时写的追问
  | 'reply'
  | 'approval_request'
  | 'approval_grant'
  | 'approval_deny'
  | 'approval_timeout'
  | 'cancel'
  | 'steer'
  | 'reclaim'
  | 'heartbeat'
  | 'system_error';

// 新类型（在 AgentRun 之前）
export type MergedInput = {
  text: string;
  byUserId: string;
  byUsername: string;
  at: string;  // ISO timestamp
};

// L72-123 AgentRun 末尾追加 6 个新字段
export type AgentRun = {
  // ... 现有字段保持 ...
  /** M7：追问数组，acquireTopicSlot merge 分支 append。 */
  mergedInputs: MergedInput[];
  /** M7：runExecute 已注入 planner / replan 的追问数。每步前比较推进。 */
  mergedInputsConsumedCount: number;
  /** M7：queued 状态下记录的初始位次（UI hint，非真源）。 */
  queuePosition: number | null;
  /** M7：ask_user 群聊期待谁答（默认 = ownerId）。 */
  askUserTargetUserId: string | null;
  /** M7：本次 ask_user 进入 awaiting 时刻；30s 后 worker 升级为开放。 */
  askUserStartedAt: Date | null;
  /** M7：worker checker 升级后 set；UI 据此切显示+权限。 */
  askUserOpenedForAllAt: Date | null;
};
```

### Step 2：tsc 通过

- [ ] 跑：

```bash
cd apps/api && npx tsc --noEmit
```

Expected：失败（store.ts parseRun / updateAgentRun map 没读新字段，会有数处 TS error）。**这是预期** —— T1c 解决。先确认错误集中在 `store.ts`，不是 types.ts 本身。

- [ ] **Step 3: Commit（不验证 tsc 全过）**

```bash
git add apps/api/src/lib/agent/types.ts
git commit -m "feat(agent/m7-t1b): extend AgentRunStatus/StepKind/AgentRun for M7 fields"
```

---

## T1c：store.ts 扩展（parseRun / UpdateAgentRunInput / RUN_COLUMNS / export UpdateAgentRunPatch）

**Files:**
- Modify: `apps/api/src/lib/agent/store.ts`

### Step 1：扩 RUN_COLUMNS + parseRun

- [ ] 在 `apps/api/src/lib/agent/store.ts` L103-112 改 `RUN_COLUMNS`：

```typescript
const RUN_COLUMNS = `id, owner_id, channel, session_id, group_id, topic_id,
  intent_turn_id, role, status, input_text, plan, todos, budget, usage,
  api_key_owner_id, api_key_source, provider_id, model_id,
  sandbox_id, user_api_keys_enc,
  parent_run_id, pending_user_prompt, pending_user_step_idx,
  pending_user_input_expires_at, summary, artifact,
  result_message_id, invoke_message_id,
  last_heartbeat_at, awaiting_approval_until, awaiting_approval_step_idx,
  pending_approval_tool_name, cancelled_by_user_id, cancel_reason,
  created_at, started_at, ended_at,
  merged_inputs, merged_inputs_consumed_count, queue_position,
  ask_user_target_user_id, ask_user_started_at, ask_user_opened_for_all_at`;
```

- [ ] 在 `parseRun` 末尾（L67 `endedAt:` 后）追加：

```typescript
mergedInputs: (row.merged_inputs as MergedInput[] | null) ?? [],
mergedInputsConsumedCount: (row.merged_inputs_consumed_count as number | null) ?? 0,
queuePosition: (row.queue_position as number | null) ?? null,
askUserTargetUserId: (row.ask_user_target_user_id as string | null) ?? null,
askUserStartedAt: (row.ask_user_started_at as Date | null) ?? null,
askUserOpenedForAllAt: (row.ask_user_opened_for_all_at as Date | null) ?? null,
```

- [ ] L1-18 import 块加 `MergedInput`：

```typescript
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
  type RunSummary,
  type RunArtifact,
  type MergedInput,
} from './types.js';
```

### Step 2：扩 `UpdateAgentRunInput` + map 表 + export 类型别名

- [ ] L273-302 扩展 `UpdateAgentRunInput`，末尾追加：

```typescript
  /** M7 P1 推进 consumed_count；与 status 一起 update 时 jsonb 走 jsonbOrNull。 */
  mergedInputs: MergedInput[] | null;
  mergedInputsConsumedCount: number;
  queuePosition: number | null;
  askUserTargetUserId: string | null;
  askUserStartedAt: Date | null;
  askUserOpenedForAllAt: Date | null;
}>;

/** M7：spec 引用类型别名，方便调用方写 `Parameters<typeof updateAgentRun>[1]` 之外也能用具名类型。 */
export type UpdateAgentRunPatch = UpdateAgentRunInput;
```

- [ ] L308-330 `updateAgentRun` 的 `map` 表追加：

```typescript
    mergedInputs: ['merged_inputs', jsonbOrNull(patch.mergedInputs)],
    mergedInputsConsumedCount: ['merged_inputs_consumed_count', patch.mergedInputsConsumedCount],
    queuePosition: ['queue_position', patch.queuePosition],
    askUserTargetUserId: ['ask_user_target_user_id', patch.askUserTargetUserId],
    askUserStartedAt: ['ask_user_started_at', patch.askUserStartedAt],
    askUserOpenedForAllAt: ['ask_user_opened_for_all_at', patch.askUserOpenedForAllAt],
```

### Step 3：扩 `pickupNextRun` SQL，排除 'queued'

- [ ] L449-479 `pickupNextRun` SQL 不变（`status IN ('draft','planning','running','replanning')` 本来就不含 queued —— **核验** 一次确认）。如果未来改了，本步要保持排除 `'queued'`。

### Step 4：tsc 通过

- [ ] 跑：

```bash
cd apps/api && npx tsc --noEmit
```

Expected：exit 0。

- [ ] **Step 5: 跑现有 store / runtime 测试确认零回归**

```bash
DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run \
  src/lib/agent/__tests__/runtime.test.ts \
  src/lib/agent/__tests__/runLifecycle.artifact.test.ts \
  src/lib/agent/__tests__/messageBridge.group.test.ts
```

Expected：全绿。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/agent/store.ts
git commit -m "feat(agent/m7-t1c): extend store.parseRun/updateAgentRun/UpdateAgentRunPatch for M7 fields"
```

---

## T1d：hooks.ts 扩展（4 个新事件）

**Files:**
- Modify: `apps/api/src/lib/agent/hooks.ts`
- Test: `apps/api/src/lib/agent/__tests__/hooks.test.ts`（已存在 —— 加 case）

### Step 1：扩 `AgentHookEvent`

- [ ] 改 `apps/api/src/lib/agent/hooks.ts`：

```typescript
import { EventEmitter } from 'events';
import type { AgentRun, AgentRunStatus, AgentStep } from './types.js';

export type AgentHookEvent =
  | { type: 'run.started'; run: AgentRun }
  | { type: 'run.completed'; run: AgentRun }
  | { type: 'run.failed'; run: AgentRun; error: string }
  | { type: 'run.cancelled'; run: AgentRun; byUserId: string | null }
  | { type: 'run.budget_exhausted'; run: AgentRun; resource: string }
  | { type: 'step.recorded'; runId: string; step: AgentStep }
  // M7：状态-only 变化 + 出队 + ask_user 升级 + 追问入队
  | { type: 'run.status_changed'; run: AgentRun; from: AgentRunStatus; to: AgentRunStatus }
  | { type: 'run.dequeued'; run: AgentRun }
  | { type: 'ask_user.opened_for_all'; runId: string; run: AgentRun }
  | { type: 'run.merged_input_appended'; runId: string; mergedInputsCount: number };

class AgentHookBus extends EventEmitter {
  emitEvent(e: AgentHookEvent) {
    this.emit('agent.event', e);
  }
  onEvent(handler: (e: AgentHookEvent) => void): () => void {
    this.on('agent.event', handler);
    return () => this.off('agent.event', handler);
  }
}

export const agentHookBus = new AgentHookBus();
agentHookBus.setMaxListeners(50);
```

### Step 2：加 hook 类型 case 到 `hooks.test.ts`

- [ ] 在 `apps/api/src/lib/agent/__tests__/hooks.test.ts` 末尾追加：

```typescript
describe('M7 hook events', () => {
  it('emits and receives run.status_changed', async () => {
    const received: AgentHookEvent[] = [];
    const off = agentHookBus.onEvent((e) => received.push(e));
    const fakeRun = { id: 'r1', status: 'replanning' } as unknown as AgentRun;
    agentHookBus.emitEvent({
      type: 'run.status_changed',
      run: fakeRun,
      from: 'running',
      to: 'replanning',
    });
    off();
    const evt = received.find((e) => e.type === 'run.status_changed');
    expect(evt).toBeDefined();
    if (evt && evt.type === 'run.status_changed') {
      expect(evt.from).toBe('running');
      expect(evt.to).toBe('replanning');
    }
  });

  it('emits run.dequeued / ask_user.opened_for_all / run.merged_input_appended', () => {
    const received: AgentHookEvent[] = [];
    const off = agentHookBus.onEvent((e) => received.push(e));
    const fakeRun = { id: 'r2' } as unknown as AgentRun;
    agentHookBus.emitEvent({ type: 'run.dequeued', run: fakeRun });
    agentHookBus.emitEvent({ type: 'ask_user.opened_for_all', runId: 'r2', run: fakeRun });
    agentHookBus.emitEvent({ type: 'run.merged_input_appended', runId: 'r2', mergedInputsCount: 3 });
    off();
    expect(received.map((e) => e.type)).toEqual(
      expect.arrayContaining([
        'run.dequeued',
        'ask_user.opened_for_all',
        'run.merged_input_appended',
      ]),
    );
  });
});
```

需补 `import type { AgentHookEvent } from '../hooks.js';` 和 `import type { AgentRun } from '../types.js';`（若文件顶部还没 import）。

### Step 3：跑测试

- [ ] 跑：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run src/lib/agent/__tests__/hooks.test.ts
```

Expected：全绿（含原有 + 新 case）。

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/lib/agent/hooks.ts apps/api/src/lib/agent/__tests__/hooks.test.ts
git commit -m "feat(agent/m7-t1d): AgentHookEvent + 4 new types (status_changed/dequeued/opened_for_all/merged_input_appended)"
```

---

## T1e：mobile types.ts 同步

**Files:**
- Modify: `apps/mobile/src/features/agent/types.ts`

### Step 1：扩 `AgentRunStatus` + `AgentStepKind` + `MergedInput` + `AgentRun` 字段

- [ ] 改 `apps/mobile/src/features/agent/types.ts`：

```typescript
// L1-11 加 'queued'
export type AgentRunStatus =
  | 'draft'
  | 'planning'
  | 'running'
  | 'awaiting_approval'
  | 'awaiting_user_input'
  | 'replanning'
  | 'queued'           // M7
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'budget_exhausted';

// L14-32 AgentStepKind 加 'user_message_appended'
export type AgentStepKind =
  | 'plan'
  | 'replan'
  | 'tool_call'
  | 'tool_error'
  | 'observe'
  | 'user_input'
  | 'user_message_appended'  // M7
  | 'critique'
  | 'reply'
  | 'steer'
  | 'approval_request'
  | 'approval_grant'
  | 'approval_deny'
  | 'approval_timeout'
  | 'cancel'
  | 'reclaim'
  | 'heartbeat'
  | 'system_error';

// 新类型（放在 AgentRun 前）
export type MergedInput = {
  text: string;
  byUserId: string;
  byUsername: string;
  at: string;
};

// L101-131 AgentRun 末尾追加（保持其余字段不变）
export type AgentRun = {
  // ...
  // M7 新字段（都 optional，老 backend 不会返回）
  mergedInputs?: MergedInput[];
  mergedInputsConsumedCount?: number;
  queuePosition?: number | null;
  askUserTargetUserId?: string | null;
  askUserStartedAt?: string | null;       // ISO（mobile 侧 Date 全部 ISO string）
  askUserOpenedForAllAt?: string | null;
};
```

### Step 2：tsc 通过

- [ ] 跑：

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected：exit 0。

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/features/agent/types.ts
git commit -m "feat(agent/m7-t1e): mobile types sync (queued status / user_message_appended / merged fields)"
```

---

# Part B：T2 acquireTopicSlot 决策入口

## T2a：store 层 3 个查询函数 + advisory lock helper

**Files:**
- Modify: `apps/api/src/lib/agent/store.ts`
- Test: `apps/api/src/lib/agent/__tests__/store.topicSlot.test.ts`（新）

### Step 1：写失败测试

- [ ] 创建 `apps/api/src/lib/agent/__tests__/store.topicSlot.test.ts`：

```typescript
/**
 * M7 T2a：store 层 topic slot 查询函数测试。
 *
 * 覆盖：
 *   - findBlockingActiveOnTopic：排除 queued
 *   - findQueuedHeadOnTopic：FIFO 取队首
 *   - countBlockingPlusQueuedOnTopic：union count
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { getPool } from '../../../db/client.js';
import * as store from '../store.js';
import type { AgentRunStatus } from '../types.js';
import { ensureUser, ensureGroup } from './_groupFixture.js';

async function insertRunRaw(opts: {
  ownerId: string;
  topicId: string;
  groupId: string;
  status: AgentRunStatus;
  createdAt?: Date;
}): Promise<string> {
  const id = randomUUID();
  await getPool().query(
    `INSERT INTO agent_runs (id, owner_id, channel, group_id, topic_id, role,
       status, input_text, budget, api_key_source, created_at, last_heartbeat_at)
     VALUES ($1, $2, 'group', $3, $4, 'generalist',
       $5, 'test', '{"maxSteps":5,"maxSeconds":60,"maxTokens":1000}'::jsonb,
       'server', $6, NULL)`,
    [id, opts.ownerId, opts.groupId, opts.topicId, opts.status, opts.createdAt ?? new Date()],
  );
  return id;
}

describe('store topic slot queries (M7 T2a)', () => {
  let owner: { id: string };
  let groupId: string;
  let topicId: string;

  beforeEach(async () => {
    owner = await ensureUser('m7-store');
    const g = await ensureGroup(owner.id, 'm7-t2a-' + Math.random());
    groupId = g.groupId;
    topicId = g.topicId;
  });

  it('findBlockingActiveOnTopic excludes queued runs', async () => {
    const runningId = await insertRunRaw({ ownerId: owner.id, groupId, topicId, status: 'running' });
    await insertRunRaw({ ownerId: owner.id, groupId, topicId, status: 'queued' });
    const r = await store.findBlockingActiveOnTopic(topicId);
    expect(r?.id).toBe(runningId);
  });

  it('findBlockingActiveOnTopic returns null when only queued', async () => {
    await insertRunRaw({ ownerId: owner.id, groupId, topicId, status: 'queued' });
    const r = await store.findBlockingActiveOnTopic(topicId);
    expect(r).toBeNull();
  });

  it('findQueuedHeadOnTopic returns FIFO oldest', async () => {
    const t0 = new Date(Date.now() - 5000);
    const t1 = new Date(Date.now() - 3000);
    const t2 = new Date(Date.now() - 1000);
    const a = await insertRunRaw({ ownerId: owner.id, groupId, topicId, status: 'queued', createdAt: t0 });
    await insertRunRaw({ ownerId: owner.id, groupId, topicId, status: 'queued', createdAt: t1 });
    await insertRunRaw({ ownerId: owner.id, groupId, topicId, status: 'queued', createdAt: t2 });
    const r = await store.findQueuedHeadOnTopic(topicId);
    expect(r?.id).toBe(a);
  });

  it('countBlockingPlusQueuedOnTopic includes both sets', async () => {
    await insertRunRaw({ ownerId: owner.id, groupId, topicId, status: 'running' });
    await insertRunRaw({ ownerId: owner.id, groupId, topicId, status: 'awaiting_user_input' });
    await insertRunRaw({ ownerId: owner.id, groupId, topicId, status: 'queued' });
    await insertRunRaw({ ownerId: owner.id, groupId, topicId, status: 'completed' });  // 不算
    const n = await store.countBlockingPlusQueuedOnTopic(topicId);
    expect(n).toBe(3);
  });
});
```

### Step 2：跑测试验证 fail

- [ ] 跑：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run src/lib/agent/__tests__/store.topicSlot.test.ts
```

Expected：FAIL with `findBlockingActiveOnTopic is not a function` 等。

### Step 3：实现 3 个查询函数 + advisory lock helper

- [ ] 在 `apps/api/src/lib/agent/store.ts` 末尾追加：

```typescript
// ============================================================
// M7：topic slot 查询 + 合并/排队事务原语
//
// 设计约束（ADR-M7-14 + R13）：本节所有可能与 acquireTopicSlot 写入冲突的函数
// 都接受 `client?: PoolClient`，调用方（withTopicCoordination）持有 advisory lock
// 的事务客户端会原样透传；不传 client 时退回独立连接（旧路径 / 非协调场景）。
// ============================================================

import type { PoolClient } from 'pg';

const BLOCKING_STATUSES_SQL = `('draft','planning','running','replanning','awaiting_approval','awaiting_user_input')`;
const TERMINAL_STATUSES = new Set([
  'completed',
  'failed',
  'cancelled',
  'budget_exhausted',
]);

function exec(client: PoolClient | undefined) {
  return client ?? getPool();
}

/**
 * M7：找 topic 上正在跑（不含 queued）的最新 run。
 * acquireTopicSlot 判定 merge / queue 时用。
 */
export async function findBlockingActiveOnTopic(
  topicId: string,
  client?: PoolClient,
): Promise<AgentRun | null> {
  const { rows } = await exec(client).query(
    `SELECT ${RUN_COLUMNS} FROM agent_runs
     WHERE topic_id = $1
       AND status IN ${BLOCKING_STATUSES_SQL}
     ORDER BY created_at DESC
     LIMIT 1`,
    [topicId],
  );
  return rows[0] ? parseRun(rows[0]) : null;
}

/**
 * M7：拿 topic 上 status='queued' 的队首（FIFO）。
 * dequeueNextOnTopic 用。
 */
export async function findQueuedHeadOnTopic(
  topicId: string,
  client?: PoolClient,
): Promise<AgentRun | null> {
  const { rows } = await exec(client).query(
    `SELECT ${RUN_COLUMNS} FROM agent_runs
     WHERE topic_id = $1 AND status = 'queued'
     ORDER BY created_at ASC
     LIMIT 1`,
    [topicId],
  );
  return rows[0] ? parseRun(rows[0]) : null;
}

/**
 * M7：blocking + queued 总数。queue 分支算 precedingCount 用。
 */
export async function countBlockingPlusQueuedOnTopic(
  topicId: string,
  client?: PoolClient,
): Promise<number> {
  const { rows } = await exec(client).query(
    `SELECT COUNT(*)::int AS c FROM agent_runs
     WHERE topic_id = $1
       AND (status IN ${BLOCKING_STATUSES_SQL} OR status = 'queued')`,
    [topicId],
  );
  return (rows[0]?.c as number | null) ?? 0;
}

/**
 * M7：merge target 已经 terminal 时抛此错；上层 retry-once。
 * applyMergeInTx 检测 SELECT FOR UPDATE 命中 terminal 或 UPDATE rowCount=0 抛。
 */
export class MergeTargetTerminalError extends Error {
  constructor(public readonly targetRunId: string) {
    super(`merge target run ${targetRunId} is already terminal`);
    this.name = 'MergeTargetTerminalError';
  }
}

/**
 * M7：在事务内合并写 user_message_appended step + agent_runs.merged_inputs JSONB。
 *
 * - 传入 `client` 时：复用调用方事务（withTopicCoordination 持锁场景），**不**自己 BEGIN/COMMIT。
 * - 不传 `client` 时：自管理短事务（保留向后兼容，但目前没人这么用）。
 *
 * 防并发要点：先 `SELECT ... FOR UPDATE` 锁目标 run 行，再读 MAX(idx)；
 * 同 run 的其他 INSERT step（如 worker 自己 recordStep）走 stepRecorder 默认 pool，
 * 命中行锁后会被阻塞，避免 idx 撞车 unique constraint 冲突。
 * 当行锁释放后，本事务的 INSERT 也已经 commit，最大 idx 已前进，对方读到正确的 MAX。
 */
export async function applyMergeInTx(
  targetRunId: string,
  entry: MergedInput,
  client?: PoolClient,
): Promise<void> {
  const ownClient = !client;
  const c = client ?? (await getPool().connect());
  try {
    if (ownClient) await c.query('BEGIN');
    const lockRes = await c.query(
      `SELECT status FROM agent_runs WHERE id = $1 FOR UPDATE`,
      [targetRunId],
    );
    if (lockRes.rowCount === 0) {
      if (ownClient) await c.query('ROLLBACK');
      throw new MergeTargetTerminalError(targetRunId);
    }
    const status = lockRes.rows[0].status as string;
    if (TERMINAL_STATUSES.has(status)) {
      if (ownClient) await c.query('ROLLBACK');
      throw new MergeTargetTerminalError(targetRunId);
    }

    const { rows: idxRows } = await c.query(
      `SELECT COALESCE(MAX(idx), -1) AS m FROM agent_steps WHERE run_id = $1`,
      [targetRunId],
    );
    const nextIdx = ((idxRows[0]?.m as number | null) ?? -1) + 1;
    await c.query(
      `INSERT INTO agent_steps (id, run_id, idx, kind, input, output, tokens, duration_ms)
         VALUES ($1, $2, $3, 'user_message_appended', $4::jsonb, NULL, 0, 0)`,
      [randomUUID(), targetRunId, nextIdx, JSON.stringify(entry)],
    );
    await c.query(
      `UPDATE agent_runs
         SET merged_inputs = COALESCE(merged_inputs, '[]'::jsonb) || $1::jsonb,
             status = CASE
                        WHEN status IN ('planning','running','awaiting_approval','awaiting_user_input')
                          THEN 'replanning'
                        ELSE status
                      END,
             updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify([entry]), targetRunId],
    );
    if (ownClient) await c.query('COMMIT');
  } catch (e) {
    if (ownClient) await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    if (ownClient) c.release();
  }
}

/**
 * M7：仅查 merged_inputs 长度 + consumed_count，避免 runExecute 每步全表 SELECT 浪费（R12）。
 */
export async function getMergedInputCounts(
  runId: string,
  client?: PoolClient,
): Promise<{ total: number; consumed: number } | null> {
  const { rows } = await exec(client).query(
    `SELECT jsonb_array_length(COALESCE(merged_inputs, '[]'::jsonb))::int AS total,
            COALESCE(merged_inputs_consumed_count, 0)::int AS consumed
       FROM agent_runs WHERE id = $1`,
    [runId],
  );
  if (!rows[0]) return null;
  return { total: Number(rows[0].total), consumed: Number(rows[0].consumed) };
}
```

> 注意：`MergedInput` 类型需在文件顶部 import 块已经 import（T1c 已加）。`PoolClient` 是新增 import，加在文件顶部 `import { Pool } from 'pg';` 附近：`import type { PoolClient } from 'pg';`。

> 没有放 `lockTopicForCoordination` —— advisory lock 改为 `topicCoord.withTopicCoordination` helper 提供，避免 store 层暴露 "事务调用约束"（lock 必须在事务里、必须 commit 释放）。

### Step 4：跑测试验证 PASS

- [ ] 跑：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run src/lib/agent/__tests__/store.topicSlot.test.ts
```

Expected：全绿（4 case）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/agent/store.ts apps/api/src/lib/agent/__tests__/store.topicSlot.test.ts
git commit -m "feat(agent/m7-t2a): store helpers findBlocking/findQueued/count/applyMergeInTx (client-aware)"
```

---

## T2b：acquireTopicSlot 决策函数

**Files:**
- Create: `apps/api/src/lib/agent/topicCoord.ts`
- Test: `apps/api/src/lib/agent/__tests__/topicCoord.acquireSlot.test.ts`（新）

### Step 1：写失败测试（TB1-TB5 + TB16）

- [ ] 创建 `apps/api/src/lib/agent/__tests__/topicCoord.acquireSlot.test.ts`：

```typescript
/**
 * M7 T2b：acquireTopicSlot 决策测试（TB1-TB5 + TB16 覆盖）。
 *
 * TB1: private / 无 active → create_fresh
 * TB2: 同 owner 任意时间 → merge
 * TB3: 跨 owner 5s 内 → merge with mergedByUserId
 * TB4: 跨 owner 60s 后 → queue with precedingCount
 * TB5: parentRunId 存在 → 强制 create_fresh
 * TB16: 同 topic 1 running + 1 queued → findBlocking 只返 running；不 merge 到 queued
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { PoolClient } from 'pg';
import { getPool } from '../../../db/client.js';
import { acquireTopicSlot, withTopicCoordination, type SlotDecision } from '../topicCoord.js';
import { ensureUser, ensureGroup } from './_groupFixture.js';
import { randomUUID } from 'crypto';

/**
 * Helper：跑一次 withTopicCoordination 并把决策返出来（测试关注 decision，不做实际写入）。
 * 用真实 helper 而非裸 acquireTopicSlot，可以一并验证 advisory lock 不会自锁/死锁。
 */
async function decide(input: Parameters<typeof acquireTopicSlot>[0]): Promise<SlotDecision> {
  if (input.channel !== 'group' || !input.topicId) {
    return acquireTopicSlot(input);
  }
  return withTopicCoordination(input.topicId, (client) => acquireTopicSlot(input, client));
}

async function insertRun(opts: {
  ownerId: string;
  topicId: string | null;
  groupId: string | null;
  status: string;
  createdAt?: Date;
}): Promise<string> {
  const id = randomUUID();
  await getPool().query(
    `INSERT INTO agent_runs (id, owner_id, channel, group_id, topic_id, role,
       status, input_text, budget, api_key_source, created_at)
     VALUES ($1, $2, $3, $4, $5, 'generalist',
       $6, 'test', '{"maxSteps":5,"maxSeconds":60,"maxTokens":1000}'::jsonb,
       'server', $7)`,
    [
      id,
      opts.ownerId,
      opts.groupId ? 'group' : 'private',
      opts.groupId,
      opts.topicId,
      opts.status,
      opts.createdAt ?? new Date(),
    ],
  );
  return id;
}

describe('acquireTopicSlot (M7 T2b)', () => {
  let user1: { id: string };
  let user2: { id: string };
  let groupId: string;
  let topicId: string;

  beforeEach(async () => {
    user1 = await ensureUser('m7-u1');
    user2 = await ensureUser('m7-u2');
    const g = await ensureGroup(user1.id, 'm7-t2b-' + Math.random());
    groupId = g.groupId;
    topicId = g.topicId;
  });

  // TB1
  it('private channel → always create_fresh', async () => {
    const d = await decide({
      channel: 'private',
      topicId: null,
      ownerId: user1.id,
    });
    expect(d.action).toBe('create_fresh');
  });

  // TB1.1
  it('group with no active → create_fresh', async () => {
    const d = await decide({
      channel: 'group',
      topicId,
      ownerId: user1.id,
    });
    expect(d.action).toBe('create_fresh');
  });

  // TB5
  it('parentRunId set → force create_fresh', async () => {
    await insertRun({ ownerId: user1.id, groupId, topicId, status: 'running' });
    const d = await decide({
      channel: 'group',
      topicId,
      ownerId: user1.id,
      parentRunId: 'p1',
    });
    expect(d.action).toBe('create_fresh');
  });

  // TB2
  it('same owner active → merge regardless of age', async () => {
    const blockingId = await insertRun({
      ownerId: user1.id, groupId, topicId, status: 'running',
      createdAt: new Date(Date.now() - 5 * 60_000),  // 5 min ago
    });
    const d = await decide({
      channel: 'group',
      topicId,
      ownerId: user1.id,
    });
    expect(d.action).toBe('merge');
    if (d.action === 'merge') {
      expect(d.targetRunId).toBe(blockingId);
      expect(d.mergedByUserId).toBeUndefined();
    }
  });

  // TB3
  it('cross owner within 30s → merge with mergedByUserId', async () => {
    const blockingId = await insertRun({
      ownerId: user1.id, groupId, topicId, status: 'running',
      createdAt: new Date(Date.now() - 5_000),
    });
    const d = await decide({
      channel: 'group',
      topicId,
      ownerId: user2.id,
    });
    expect(d.action).toBe('merge');
    if (d.action === 'merge') {
      expect(d.targetRunId).toBe(blockingId);
      expect(d.mergedByUserId).toBe(user2.id);
    }
  });

  // TB4
  it('cross owner after 30s window → queue with precedingCount', async () => {
    await insertRun({
      ownerId: user1.id, groupId, topicId, status: 'running',
      createdAt: new Date(Date.now() - 60_000),
    });
    const d = await decide({
      channel: 'group',
      topicId,
      ownerId: user2.id,
    });
    expect(d.action).toBe('queue');
    if (d.action === 'queue') {
      expect(d.precedingCount).toBe(1);
    }
  });

  // TB16
  it('queued runs do not count as blocking', async () => {
    const runningId = await insertRun({
      ownerId: user1.id, groupId, topicId, status: 'running',
      createdAt: new Date(Date.now() - 60_000),
    });
    await insertRun({
      ownerId: user1.id, groupId, topicId, status: 'queued',
      createdAt: new Date(Date.now() - 30_000),
    });
    // u2 进来：blocking = running，跨 owner 60s 前 → queue（precedingCount=2: 1 running + 1 queued）
    const d = await decide({
      channel: 'group',
      topicId,
      ownerId: user2.id,
    });
    expect(d.action).toBe('queue');
    if (d.action === 'queue') {
      expect(d.precedingCount).toBe(2);
    }
  });

  // 契约保护：群聊不传 client 直接调 acquireTopicSlot 必抛错
  it('group channel without client throws contract error', async () => {
    await expect(
      acquireTopicSlot({ channel: 'group', topicId, ownerId: user1.id }),
    ).rejects.toThrow(/withTopicCoordination/);
  });
});
```

### Step 2：跑测试验证 fail

- [ ] 跑：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run src/lib/agent/__tests__/topicCoord.acquireSlot.test.ts
```

Expected：FAIL（模块不存在）。

### Step 3：实现 acquireTopicSlot + withTopicCoordination

- [ ] 创建 `apps/api/src/lib/agent/topicCoord.ts`：

```typescript
/**
 * M7 子项目 B：群聊 Agent 并发协调入口（ADR-M7-14 + R13）。
 *
 * 核心契约：
 *   1. 群聊 agent_run 创建路径必须套在 withTopicCoordination(topicId, fn) 内执行；
 *   2. fn 接到的 client 已经在 BEGIN + pg_advisory_xact_lock 状态下，acquireTopicSlot
 *      + 后续 createFreshInTx / applyMergeInTx / applyQueueInTx 必须复用同 client；
 *   3. fn 返回后 helper 统一 COMMIT 释放锁；异常路径 ROLLBACK。
 *
 *   "先 acquireTopicSlot commit 再 createAgentRun" 是错误模式 —— 两个并发请求都能在锁外
 *   看到 "无 active"，从而双写 fresh run。R13 / TB1 / TB16 verify。
 *
 * 决策矩阵（详见 design spec §8.1）：
 *   parentRunId 非空 ............ create_fresh （ADR-M7-7：子 run 不被合并）
 *   private / 无 topicId ........ create_fresh
 *   blocking 不存在 ............. create_fresh
 *   blocking.ownerId == self .... merge        （同 owner 任意时间合并）
 *   blocking.createdAt 30s 内 ... merge        （跨 owner 30s 窗口合并）
 *   其它 ........................ queue
 */
import type { PoolClient } from 'pg';
import { getPool } from '../../db/client.js';
import * as store from './store.js';
import type { AgentChannel } from './types.js';

export const MERGE_WINDOW_MS = 30_000;

export type SlotDecision =
  | { action: 'create_fresh' }
  | { action: 'merge'; targetRunId: string; mergedByUserId?: string }
  | { action: 'queue'; precedingCount: number };

export type AcquireTopicSlotInput = {
  channel: AgentChannel;
  topicId: string | null;
  ownerId: string;
  parentRunId?: string | null;
};

/**
 * 同 topic 决策 + 落库的串行化 helper。fn 内的所有 store 写入必须把 client 透传过去。
 */
export async function withTopicCoordination<T>(
  topicId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    // hashtext 返回 32-bit → 用两位 key 降低跨 topic 哈希碰撞概率
    await client.query(
      `SELECT pg_advisory_xact_lock(
         hashtext('agent_topic_coord:' || $1),
         hashtext('m7')
       )`,
      [topicId],
    );
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * 仅做决策（读 blocking + 算 precedingCount），不开事务/不持锁。
 * 群聊路径必须由 withTopicCoordination 提供持锁的 client；客户端否则会触发 race（R13）。
 */
export async function acquireTopicSlot(
  input: AcquireTopicSlotInput,
  client?: PoolClient,
): Promise<SlotDecision> {
  // ADR-M7-7：子 run 强制 fresh（防自合并到父 run）
  if (input.parentRunId) return { action: 'create_fresh' };

  // 私聊 / 无 topicId：不参与协调（无需持锁）
  if (input.channel !== 'group' || !input.topicId) {
    return { action: 'create_fresh' };
  }

  // 严格契约：群聊场景必须传 client（来自 withTopicCoordination）
  if (!client) {
    throw new Error(
      '[acquireTopicSlot] group channel requires a transactional client; ' +
        'wrap the call in withTopicCoordination(topicId, async (client) => ...)',
    );
  }

  const topicId = input.topicId;
  const blocking = await store.findBlockingActiveOnTopic(topicId, client);
  if (!blocking) return { action: 'create_fresh' };

  // 同 owner → 任意时间合并
  if (blocking.ownerId === input.ownerId) {
    return { action: 'merge', targetRunId: blocking.id };
  }

  // 跨 owner + 窗口内 → 合并
  const ageMs = Date.now() - blocking.createdAt.getTime();
  if (ageMs < MERGE_WINDOW_MS) {
    return {
      action: 'merge',
      targetRunId: blocking.id,
      mergedByUserId: input.ownerId,
    };
  }

  // 跨 owner + 窗口外 → queue
  const precedingCount = await store.countBlockingPlusQueuedOnTopic(topicId, client);
  return { action: 'queue', precedingCount };
}
```

### Step 4：跑测试验证 PASS

- [ ] 跑：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run src/lib/agent/__tests__/topicCoord.acquireSlot.test.ts
```

Expected：全绿（8 case）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/agent/topicCoord.ts apps/api/src/lib/agent/__tests__/topicCoord.acquireSlot.test.ts
git commit -m "feat(agent/m7-t2b): acquireTopicSlot + withTopicCoordination (single-tx advisory lock)"
```

---


# Part C：T3 intentExecute 三分支

## T3a：扩展 `IntentExecuteResult` shared 类型

**Files:**
- Modify: `packages/shared/src/intent/executeResult.ts`

### Step 1：加 mergedIntoRunId / queued 字段

- [ ] 改 `packages/shared/src/intent/executeResult.ts` `'agent'` 变体：

```typescript
  | {
      type: 'agent';
      runId: string;
      userMessageId: string | null;
      placeholderMessageId: string | null;
      confirmation?: string;
      // M7：本次请求被合并到既有 active run；mobile 据此显示"已合并"提示
      mergedIntoRunId?: string;
      // M7：本次请求被排队；mobile 据此显示"排队中·前 N 个"
      queued?: boolean;
      queuePosition?: number;
    };
```

### Step 2：编译 shared

- [ ] 跑：

```bash
cd packages/shared && npx tsc --noEmit
```

Expected：exit 0。

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/intent/executeResult.ts
git commit -m "feat(shared/m7-t3a): IntentExecuteResult.agent + mergedIntoRunId/queued fields"
```

---

## T3b：intentExecute 群聊分支三向路由

**Files:**
- Modify: `apps/api/src/lib/intentExecute.ts`（仅 group 分支 L205-225）
- Modify: `apps/api/src/lib/agent/runLifecycle.ts`（新增可选 `status: 'queued'` 路径）
- Test: `apps/api/src/lib/__tests__/intentExecute.m7.test.ts`（新）

### Step 1：写失败测试

- [ ] 创建 `apps/api/src/lib/__tests__/intentExecute.m7.test.ts`：

```typescript
/**
 * M7 T3b：intentExecute 群聊 agent_run 三分支测试（TB1/2/3/4 集成版）。
 *
 * 覆盖：
 *   - 无 active → type='agent'（fresh）
 *   - 有 active 同 owner → type='agent', mergedIntoRunId 非空，仅 1 条新 group_messages
 *   - 跨 owner 60s 后 → type='agent', queued=true, queuePosition=N
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getPool } from '../../db/client.js';
import { executeIntent } from '../intentExecute.js';
import { ensureUser, ensureGroup } from '../agent/__tests__/_groupFixture.js';
import { randomUUID } from 'crypto';

async function insertActiveRun(opts: {
  ownerId: string;
  topicId: string;
  groupId: string;
  status?: string;
  createdAt?: Date;
}): Promise<string> {
  const id = randomUUID();
  await getPool().query(
    `INSERT INTO agent_runs (id, owner_id, channel, group_id, topic_id, role,
       status, input_text, budget, api_key_source, created_at, last_heartbeat_at)
     VALUES ($1, $2, 'group', $3, $4, 'generalist',
       $5, 'existing', '{"maxSteps":5,"maxSeconds":60,"maxTokens":1000}'::jsonb,
       'server', $6, NULL)`,
    [
      id,
      opts.ownerId,
      opts.groupId,
      opts.topicId,
      opts.status ?? 'running',
      opts.createdAt ?? new Date(),
    ],
  );
  return id;
}

async function countGroupMessages(groupId: string, topicId: string): Promise<number> {
  const { rows } = await getPool().query(
    `SELECT COUNT(*)::int AS c FROM group_messages
     WHERE group_id = $1 AND topic_id = $2`,
    [groupId, topicId],
  );
  return Number(rows[0].c);
}

describe('intentExecute group agent_run M7', () => {
  let owner: { id: string };
  let other: { id: string };
  let groupId: string;
  let topicId: string;

  beforeEach(async () => {
    owner = await ensureUser('m7-int-o');
    other = await ensureUser('m7-int-x');
    const g = await ensureGroup(owner.id, 'm7-int-' + Math.random());
    groupId = g.groupId;
    topicId = g.topicId;
    // 让 other 也是群成员
    await getPool().query(
      `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member')
       ON CONFLICT DO NOTHING`,
      [groupId, other.id],
    );
  });

  it('TB-intent-fresh: no active → create fresh run', async () => {
    const r = await executeIntent({
      userId: owner.id,
      text: 'hello echo 1',
      kind: 'agent_run',
      channel: 'group',
      groupId, topicId,
      apiKey: '',
    });
    expect(r.type).toBe('agent');
    if (r.type === 'agent') {
      expect(r.runId).toBeTruthy();
      expect(r.mergedIntoRunId).toBeUndefined();
      expect(r.queued).toBeUndefined();
    }
  });

  it('TB-intent-merge: same owner active → merge (no new ai placeholder, 1 invoker msg)', async () => {
    const targetId = await insertActiveRun({ ownerId: owner.id, groupId, topicId });
    const before = await countGroupMessages(groupId, topicId);
    const r = await executeIntent({
      userId: owner.id,
      text: '追问 X',
      kind: 'agent_run',
      channel: 'group',
      groupId, topicId,
      apiKey: '',
    });
    expect(r.type).toBe('agent');
    if (r.type === 'agent') {
      expect(r.runId).toBe(targetId);
      expect(r.mergedIntoRunId).toBe(targetId);
    }
    const after = await countGroupMessages(groupId, topicId);
    expect(after - before).toBe(1);  // 仅 1 条 invoker，无 ai placeholder

    // merged_inputs 已追加
    const { rows } = await getPool().query(
      `SELECT merged_inputs FROM agent_runs WHERE id = $1`,
      [targetId],
    );
    const merged = rows[0].merged_inputs as Array<{ text: string }>;
    expect(merged).toHaveLength(1);
    expect(merged[0].text).toBe('追问 X');
  });

  it('TB1-race: two parallel fresh requests → exactly one creates blocking run', async () => {
    // R13 / ADR-M7-14：两个并发请求必须串行 → 只有 1 个 create_fresh，另一个走 merge
    const [r1, r2] = await Promise.all([
      executeIntent({
        userId: owner.id,
        text: 'race A',
        kind: 'agent_run',
        channel: 'group',
        groupId, topicId,
        apiKey: '',
      }),
      executeIntent({
        userId: owner.id,
        text: 'race B',
        kind: 'agent_run',
        channel: 'group',
        groupId, topicId,
        apiKey: '',
      }),
    ]);
    expect(r1.type).toBe('agent');
    expect(r2.type).toBe('agent');
    // 唯一存活的 blocking run（status NOT IN terminal/queued）必须只有 1 个
    const { rows } = await getPool().query(
      `SELECT COUNT(*)::int AS c FROM agent_runs
       WHERE topic_id = $1
         AND status IN ('draft','planning','running','replanning','awaiting_approval','awaiting_user_input')`,
      [topicId],
    );
    expect(rows[0].c).toBe(1);
    // 其中一个必定 mergedIntoRunId 指向另一个的 runId
    if (r1.type === 'agent' && r2.type === 'agent') {
      const merged = r1.mergedIntoRunId ?? r2.mergedIntoRunId;
      const fresh = r1.mergedIntoRunId ? r2.runId : r1.runId;
      expect(merged).toBe(fresh);
    }
  });

  it('TB-intent-queue: cross owner after window → queued', async () => {
    await insertActiveRun({
      ownerId: owner.id, groupId, topicId,
      createdAt: new Date(Date.now() - 60_000),
    });
    const r = await executeIntent({
      userId: other.id,
      text: '我也来问',
      kind: 'agent_run',
      channel: 'group',
      groupId, topicId,
      apiKey: '',
    });
    expect(r.type).toBe('agent');
    if (r.type === 'agent') {
      expect(r.queued).toBe(true);
      expect(r.queuePosition).toBeGreaterThanOrEqual(1);
    }
    // 新 run status='queued'
    const { rows } = await getPool().query(
      `SELECT status FROM agent_runs WHERE id = $1`,
      [(r as { runId: string }).runId],
    );
    expect(rows[0].status).toBe('queued');
  });
});
```

### Step 2：跑测试验证 fail

- [ ] 跑：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run src/lib/__tests__/intentExecute.m7.test.ts
```

Expected：FAIL（acquireTopicSlot 未接入；返回普通 fresh）。

### Step 3：runLifecycle 让 `createAgentRun` 接受 `existingRun`（关键：critical section 内只 INSERT row）

R13 + ADR-M7-14 要求：群聊新建 run 时，"决策 + INSERT agent_runs row" 必须在 `withTopicCoordination` 提供的同一事务内完成；否则两个并发请求都能在锁外看到"无 active"双写 fresh run。但 `createAgentRun` 当前是个完整流程（INSERT + writePlaceholder + updateRun），把整体塞进事务侵入太大。改为：先在事务内 `store.insertAgentRun(client, ...)`，commit 释放锁；再调 `createAgentRun({ ..., existingRun })` 跳过 INSERT 直接做后续 placeholder/worker 联动。

- [ ] 在 `apps/api/src/lib/agent/runLifecycle.ts` 扩展 `CreateAgentRunInput`：

```typescript
  /** M7：T3 queue 分支专用，决定 INSERT 的初始 status。默认 'draft'。 */
  initialStatus?: 'draft' | 'queued';
  /** M7：queued 时记录入队 N。 */
  queuePosition?: number;
  /**
   * M7：调用方已经在持锁事务里 INSERT 了 run 行（R13 闭环），
   * 传入时 createAgentRun 跳过 store.insertAgentRun，直接走 placeholder/updateRun 后续。
   */
  existingRun?: AgentRun;
```

- [ ] 改 `createAgentRun` 函数：在 `const run = await store.insertAgentRun(...)` 之前插入：

```typescript
  const runStatus = input.initialStatus ?? 'draft';
  const run = input.existingRun ?? await store.insertAgentRun({
    ownerId: input.ownerId,
    channel: input.channel,
    sessionId: input.sessionId ?? null,
    groupId: input.groupId ?? null,
    topicId: input.topicId ?? null,
    intentTurnId: input.intentTurnId ?? null,
    role: 'generalist',
    status: runStatus,
    inputText: input.inputText,
    budget: input.budget ?? DEFAULT_BUDGET,
    apiKeyOwnerId: input.apiKeySource === 'user' ? input.ownerId : null,
    apiKeySource: input.apiKeySource,
    userApiKeyEnc,
    userZenmuxKeyEnc,
    providerId,
    modelId: input.modelId,
    userApiKeysEnc,
    parentRunId: input.parentRunId ?? null,
    queuePosition: input.queuePosition ?? null,  // M7
  });
```

> 注意：`existingRun` 路径下 `userApiKeyEnc / userZenmuxKeyEnc / userApiKeysEnc` 等密封字段都已经在事务里写入（intentExecute 提前 seal 并塞给 insertAgentRunInTx），跳过 store.insertAgentRun 不会丢失。

- [ ] `store.insertAgentRun` 当前不接 `queue_position` / `status` 形参；快速扩展 `InsertAgentRunInput` 加：

```typescript
  status?: AgentRunStatus;        // M7：默认 'draft'，T3 queue 分支传 'queued'
  queuePosition?: number | null;  // M7
```

并把 INSERT SQL 改成（保留向后兼容）：

```typescript
  `INSERT INTO agent_runs (
     id, owner_id, channel, session_id, group_id, topic_id,
     intent_turn_id, role, status, input_text, budget,
     api_key_owner_id, api_key_source, user_api_key_enc,
     user_zenmux_key_enc, provider_id, model_id, user_api_keys_enc,
     parent_run_id, queue_position
   ) VALUES (
     $1,$2,$3,$4,$5,$6,$7,$8, COALESCE($9, 'draft'), $10, $11,
     $12,$13,$14,$15,
     COALESCE($16, 'deepseek'),
     COALESCE($17, 'deepseek-v4-pro'),
     COALESCE($18::jsonb, '{}'),
     $19,
     $20
   )
   RETURNING ${RUN_COLUMNS}`
```

`$9` 改为 `input.status ?? null`、`$20` 为 `input.queuePosition ?? null`。

- [ ] **关键新增：`store.insertAgentRunInTx(client, input)`**：与 `insertAgentRun` 同 SQL，但跑在 caller 提供的 `PoolClient` 上（withTopicCoordination 的事务客户端）。最干净的实现是把现有 SQL 抽出常量，两个函数共享，例如：

```typescript
export async function insertAgentRunInTx(
  client: PoolClient,
  input: InsertAgentRunInput,
): Promise<AgentRun> {
  const { rows } = await client.query(INSERT_AGENT_RUN_SQL, buildInsertAgentRunParams(input));
  return parseRun(rows[0]);
}
```

把 `insertAgentRun` 内部也改为 `getPool().query(INSERT_AGENT_RUN_SQL, buildInsertAgentRunParams(input))`，确保两条路径完全等价。

### Step 4：intentExecute 群聊分支改造（withTopicCoordination 全程持锁）

- [ ] 改 `apps/api/src/lib/intentExecute.ts` group `agent_run` 分支（L205-225）。整段替换：

```typescript
    if (input.channel === 'group') {
      if (!input.groupId || !input.topicId) {
        return { type: 'skipped', reason: 'AGENT_GROUP_REQUIRES_GROUP_TOPIC' };
      }

      // M7 T3：withTopicCoordination 持锁事务内决策 + 写入 → commit 后做 placeholder/hook
      const { withTopicCoordination, acquireTopicSlot } =
        await import('./agent/topicCoord.js');
      const {
        applyMergeInTx,
        insertAgentRunInTx,
        MergeTargetTerminalError,
      } = await import('./agent/store.js');
      const { getUserById } = await import('../store/pg-profile.js');
      const { createAgentRun } = await import('./agent/runtime.js');
      const { agentHookBus } = await import('./agent/hooks.js');
      const { getMergedInputCounts, getAgentRun } = await import('./agent/store.js');
      const { getPool } = await import('../db/client.js');

      // 提前准备所有需要落到 agent_runs 行的字段（含 user key 密封），让事务内部仅做 INSERT。
      const sealedKeys = await sealUserApiKeysForInsert({  // 抽个本地 helper，封装 sealUserApiKey/sealUserApiKeys
        apiKey, apiKeySource, providerId, userApiKeys: input.userApiKeys,
        ownerId: input.userId,
      });

      type SlotResult =
        | { kind: 'merge'; targetRunId: string; mergedByUserId?: string }
        | { kind: 'fresh'; run: AgentRun }
        | { kind: 'queue'; run: AgentRun; precedingCount: number };

      let slot: SlotResult | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          slot = await withTopicCoordination(input.topicId, async (client) => {
            const decision = await acquireTopicSlot(
              { channel: 'group', topicId: input.topicId, ownerId: input.userId, parentRunId: null },
              client,
            );
            if (decision.action === 'merge') {
              const profile = await getUserById(input.userId);
              const byUsername = profile?.displayName ?? profile?.username ?? input.userId;
              await applyMergeInTx(
                decision.targetRunId,
                { text: input.text, byUserId: input.userId, byUsername, at: new Date().toISOString() },
                client,
              );
              return { kind: 'merge', targetRunId: decision.targetRunId, mergedByUserId: decision.mergedByUserId };
            }
            if (decision.action === 'queue') {
              const run = await insertAgentRunInTx(client, {
                ownerId: input.userId,
                channel: 'group',
                sessionId: null,
                groupId: input.groupId,
                topicId: input.topicId,
                intentTurnId: null,
                role: 'generalist',
                status: 'queued',
                inputText: input.text,
                budget: DEFAULT_BUDGET,
                apiKeyOwnerId: apiKeySource === 'user' ? input.userId : null,
                apiKeySource,
                ...sealedKeys,
                providerId,
                modelId,
                parentRunId: null,
                queuePosition: decision.precedingCount,
              });
              return { kind: 'queue', run, precedingCount: decision.precedingCount };
            }
            // create_fresh
            const run = await insertAgentRunInTx(client, {
              ownerId: input.userId,
              channel: 'group',
              sessionId: null,
              groupId: input.groupId,
              topicId: input.topicId,
              intentTurnId: null,
              role: 'generalist',
              status: 'draft',
              inputText: input.text,
              budget: DEFAULT_BUDGET,
              apiKeyOwnerId: apiKeySource === 'user' ? input.userId : null,
              apiKeySource,
              ...sealedKeys,
              providerId,
              modelId,
              parentRunId: null,
              queuePosition: null,
            });
            return { kind: 'fresh', run };
          });
          break;  // 成功，跳出 retry
        } catch (err) {
          if (err instanceof MergeTargetTerminalError && attempt === 0) {
            continue;  // 目标 run 在 merge 事务期间转 terminal，重判
          }
          throw err;
        }
      }
      if (!slot) throw new Error('agent run slot acquisition failed after retry');

      // ====== 锁已释放：以下都是非互斥后续工作 ======
      if (slot.kind === 'merge') {
        const counts = await getMergedInputCounts(slot.targetRunId);
        const targetRun = await getAgentRun(slot.targetRunId);
        if (targetRun && counts) {
          agentHookBus.emitEvent({
            type: 'run.merged_input_appended',
            runId: slot.targetRunId,
            mergedInputsCount: counts.total,
          });
        }
        // 写 1 条 invoker 群消息（人类发言），指向原 run
        const invoke = await social.addGroupMessage(
          input.userId,
          input.groupId,
          input.topicId,
          { kind: 'human', content: input.text },
        );
        if (invoke) {
          await getPool().query(
            `UPDATE group_messages
               SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
                 'agentRun', jsonb_build_object(
                   'agentRunId', $2::text,
                   'role', 'merged_invoker',
                   'mergedByUserId', $3::text
                 )
               )
             WHERE id = $1`,
            [invoke.id, slot.targetRunId, input.userId],
          );
        }
        return {
          type: 'agent',
          runId: slot.targetRunId,
          userMessageId: invoke?.id ?? null,
          placeholderMessageId: null,
          mergedIntoRunId: slot.targetRunId,
        };
      }

      // queue / fresh：复用 createAgentRun 后半段写 placeholder / 联动 worker
      const r = await createAgentRun({
        ownerId: input.userId,
        channel: 'group',
        groupId: input.groupId,
        topicId: input.topicId,
        inputText: input.text,
        apiKey, apiKeySource, providerId, modelId,
        existingRun: slot.run,  // ← 关键：跳过重复 INSERT
      });
      if (slot.kind === 'queue') {
        return {
          type: 'agent',
          runId: r.run.id,
          userMessageId: r.userMessageId,
          placeholderMessageId: r.placeholderMessageId,
          queued: true,
          queuePosition: slot.precedingCount,
        };
      }
      return {
        type: 'agent',
        runId: r.run.id,
        userMessageId: r.userMessageId,
        placeholderMessageId: r.placeholderMessageId,
      };
    }
```

`sealUserApiKeysForInsert` 是本文件内的小 helper（10 行）：把 `createAgentRun` 现有的 sealUserApiKey + sealUserApiKeys 提前跑一次返回 `{ userApiKeyEnc, userZenmuxKeyEnc, userApiKeysEnc }`，避免 critical section 内做加密 IO 拉长锁时长。复制 `runLifecycle.createAgentRun` 内的对应逻辑即可。

> 注：本块用 `await import('../db/client.js')` 拿 `getPool`，避免在文件顶部新增 import（intentExecute.ts 现有 import 块没有 `db/client`）。如未来重构允许，可移到顶部 import。

### Step 5：跑测试验证 PASS

- [ ] 先编译：

```bash
cd apps/api && npx tsc --noEmit
```

Expected：exit 0。

- [ ] 跑 M7 测试 + 现有 intentExecute 测试：

```bash
DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run \
  src/lib/__tests__/intentExecute.m7.test.ts \
  src/lib/__tests__/intentExecute.agentOptions.test.ts
```

Expected：全绿。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/intentExecute.ts apps/api/src/lib/agent/runLifecycle.ts \
        apps/api/src/lib/agent/store.ts apps/api/src/lib/agent/topicCoord.ts \
        apps/api/src/lib/__tests__/intentExecute.m7.test.ts
git commit -m "feat(agent/m7-t3): intentExecute group agent_run → withTopicCoordination + fresh/merge/queue (R13 safe)"
```

---

# Part D：T4 dequeueNextOnTopic + 三出口集成

## T4a：dequeueNextOnTopic 函数 + hook emit

**Files:**
- Modify: `apps/api/src/lib/agent/topicCoord.ts`
- Test: `apps/api/src/lib/agent/__tests__/topicCoord.dequeue.test.ts`（新）

### Step 1：写失败测试（TB6 + TB16 集成）

- [ ] 创建 `apps/api/src/lib/agent/__tests__/topicCoord.dequeue.test.ts`：

```typescript
/**
 * M7 T4a：dequeueNextOnTopic 测试（TB6 + TB16 集成）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getPool } from '../../../db/client.js';
import { dequeueNextOnTopic } from '../topicCoord.js';
import { agentHookBus } from '../hooks.js';
import { ensureUser, ensureGroup } from './_groupFixture.js';
import { randomUUID } from 'crypto';

async function insertRun(opts: {
  ownerId: string;
  topicId: string;
  groupId: string;
  status: string;
  createdAt?: Date;
}): Promise<string> {
  const id = randomUUID();
  await getPool().query(
    `INSERT INTO agent_runs (id, owner_id, channel, group_id, topic_id, role,
       status, input_text, budget, api_key_source, created_at)
     VALUES ($1, $2, 'group', $3, $4, 'generalist',
       $5, 'test', '{"maxSteps":5,"maxSeconds":60,"maxTokens":1000}'::jsonb,
       'server', $6)`,
    [id, opts.ownerId, opts.groupId, opts.topicId, opts.status, opts.createdAt ?? new Date()],
  );
  return id;
}

describe('dequeueNextOnTopic (M7 T4a)', () => {
  let owner: { id: string };
  let groupId: string;
  let topicId: string;

  beforeEach(async () => {
    owner = await ensureUser('m7-deq');
    const g = await ensureGroup(owner.id, 'm7-deq-' + Math.random());
    groupId = g.groupId;
    topicId = g.topicId;
  });

  it('dequeues FIFO head when no blocking exists', async () => {
    const oldId = await insertRun({
      ownerId: owner.id, groupId, topicId, status: 'queued',
      createdAt: new Date(Date.now() - 5_000),
    });
    await insertRun({
      ownerId: owner.id, groupId, topicId, status: 'queued',
      createdAt: new Date(Date.now() - 1_000),
    });

    const events: unknown[] = [];
    const off = agentHookBus.onEvent((e) => events.push(e));
    await dequeueNextOnTopic(topicId);
    off();

    const { rows } = await getPool().query(
      `SELECT id, status, queue_position FROM agent_runs WHERE id = $1`, [oldId],
    );
    expect(rows[0].status).toBe('draft');
    expect(rows[0].queue_position).toBeNull();

    const dequeued = events.find(
      (e) => (e as { type: string }).type === 'run.dequeued',
    );
    expect(dequeued).toBeDefined();
  });

  it('does nothing when blocking active still exists', async () => {
    await insertRun({ ownerId: owner.id, groupId, topicId, status: 'running' });
    const queuedId = await insertRun({
      ownerId: owner.id, groupId, topicId, status: 'queued',
    });
    await dequeueNextOnTopic(topicId);
    const { rows } = await getPool().query(
      `SELECT status FROM agent_runs WHERE id = $1`, [queuedId],
    );
    expect(rows[0].status).toBe('queued');
  });
});
```

### Step 2：跑验证 fail

- [ ] 跑：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run src/lib/agent/__tests__/topicCoord.dequeue.test.ts
```

Expected：FAIL（`dequeueNextOnTopic is not a function`）。

### Step 3：实现 dequeueNextOnTopic

- [ ] 在 `apps/api/src/lib/agent/topicCoord.ts` 末尾追加：

```typescript
/**
 * M7：active run 进 terminal 时调用，把同 topic 队首 'queued' run 提到 'draft'，
 * worker 下一 tick 自然 pickup。
 *
 * 触发点（T4b）：softComplete / cancelRun / reclaim 三个出口都调。
 */
export async function dequeueNextOnTopic(topicId: string | null): Promise<void> {
  if (!topicId) return;
  // queued 本身不算 blocking；如果还有 running 等就别 dequeue（让它跑完）
  const stillBlocking = await store.findBlockingActiveOnTopic(topicId);
  if (stillBlocking) return;
  const next = await store.findQueuedHeadOnTopic(topicId);
  if (!next) return;
  const updated = await store.updateAgentRun(next.id, {
    status: 'draft',
    queuePosition: null,
  });
  if (updated) {
    const { agentHookBus } = await import('./hooks.js');
    agentHookBus.emitEvent({ type: 'run.dequeued', run: updated });
  }
}
```

### Step 4：跑测试验证 PASS

- [ ] 跑：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run src/lib/agent/__tests__/topicCoord.dequeue.test.ts
```

Expected：全绿（2 case）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/agent/topicCoord.ts apps/api/src/lib/agent/__tests__/topicCoord.dequeue.test.ts
git commit -m "feat(agent/m7-t4a): dequeueNextOnTopic + run.dequeued hook"
```

---

## T4b：在 softComplete / cancelRun / reclaim 三出口接入

**Files:**
- Modify: `apps/api/src/lib/agent/runLifecycle.ts`（softComplete + cancelRun）
- Modify: `apps/api/src/lib/agent/runExecuteHelpers.ts`（recordReclaimIfNeeded 出口）

### Step 1：softComplete 末尾接入

- [ ] 改 `apps/api/src/lib/agent/runLifecycle.ts` `softComplete` 函数（L184-273）。在 hook emit 块后追加：

```typescript
  // M7：群聊 run 终态 → 触发同 topic 队首 dequeue
  if (run.channel === 'group' && run.topicId) {
    const { dequeueNextOnTopic } = await import('./topicCoord.js');
    await dequeueNextOnTopic(run.topicId);
  }
}
```

### Step 2：cancelRun 末尾接入

- [ ] 同 `apps/api/src/lib/agent/runLifecycle.ts` `cancelRun` 函数（L324-408）末尾，在最后的 placeholder finalize 块之后追加：

```typescript
  // M7：cancelled 也算 terminal，触发队首 dequeue
  if (run.channel === 'group' && run.topicId) {
    const { dequeueNextOnTopic } = await import('./topicCoord.js');
    await dequeueNextOnTopic(run.topicId);
  }
}
```

> 注意：`cancelRun` 早返回（已 terminal）路径不走这里，但已 terminal 的 run 不可能再次释放 slot，无需 dequeue。

### Step 3：reclaim 触发（heartbeat reclaim path）

- [ ] reclaim 路径**不直接触发 dequeue**：reclaim 只把"假死" run 重新拉回 active，并没有让 slot 真正释放。但 reclaim 后会进入 executeRun → 可能立刻 softComplete → 已覆盖。结论：reclaim 出口**无需新增 dequeue 调用**。

> 记一行说明给读者：see `runExecuteHelpers.recordReclaimIfNeeded` —— reclaim 仅延续 run，不释放 slot。

### Step 4：跑现有 run 终态相关测试，确认零回归

- [ ] 跑：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run \
  src/lib/agent/__tests__/runLifecycle.artifact.test.ts \
  src/lib/agent/__tests__/runLifecycle.cancelArtifact.test.ts \
  src/lib/agent/__tests__/runLifecycle.summary.test.ts \
  src/lib/agent/__tests__/runtime.test.ts \
  src/lib/agent/__tests__/runtime.group.test.ts
```

Expected：全绿。

### Step 5：写 TB6 集成测试（softComplete 触发 dequeue）

- [ ] 创建 `apps/api/src/lib/agent/__tests__/runLifecycle.dequeue.test.ts`：

```typescript
/**
 * M7 TB6：softComplete on group run → topic 队首 dequeue。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getPool } from '../../../db/client.js';
import { softComplete } from '../runLifecycle.js';
import * as store from '../store.js';
import { ensureUser, ensureGroup } from './_groupFixture.js';
import { randomUUID } from 'crypto';

async function insertRun(opts: {
  ownerId: string;
  topicId: string;
  groupId: string;
  status: string;
}): Promise<string> {
  const id = randomUUID();
  await getPool().query(
    `INSERT INTO agent_runs (id, owner_id, channel, group_id, topic_id, role,
       status, input_text, budget, api_key_source)
     VALUES ($1, $2, 'group', $3, $4, 'generalist',
       $5, 'test', '{"maxSteps":5,"maxSeconds":60,"maxTokens":1000}'::jsonb, 'server')`,
    [id, opts.ownerId, opts.groupId, opts.topicId, opts.status],
  );
  return id;
}

describe('softComplete dequeues queued head (M7 TB6)', () => {
  let owner: { id: string };
  let groupId: string;
  let topicId: string;

  beforeEach(async () => {
    owner = await ensureUser('m7-tb6');
    const g = await ensureGroup(owner.id, 'tb6-' + Math.random());
    groupId = g.groupId;
    topicId = g.topicId;
  });

  it('completed → queued head → draft', async () => {
    const activeId = await insertRun({ ownerId: owner.id, groupId, topicId, status: 'running' });
    const queuedId = await insertRun({ ownerId: owner.id, groupId, topicId, status: 'queued' });
    const active = (await store.getAgentRun(activeId))!;

    await softComplete(active, 'completed');

    const { rows } = await getPool().query(
      `SELECT status FROM agent_runs WHERE id = $1`, [queuedId],
    );
    expect(rows[0].status).toBe('draft');
  });
});
```

### Step 6：跑测试验证 PASS

- [ ] 跑：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run src/lib/agent/__tests__/runLifecycle.dequeue.test.ts
```

Expected：全绿。

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/agent/runLifecycle.ts apps/api/src/lib/agent/__tests__/runLifecycle.dequeue.test.ts
git commit -m "feat(agent/m7-t4b): softComplete/cancelRun trigger dequeueNextOnTopic for group runs"
```

---

# Part E：T5 追问消化 P1-P4

## T5a：P1 runExecute 每步前 checkMergedInputs + 触发 replan

**Files:**
- Modify: `apps/api/src/lib/agent/runExecute.ts`（L124 主循环顶部插入）
- Modify: `apps/api/src/lib/agent/runExecuteHelpers.ts`（applyReplanningIfNeeded critique 分支 reason 判断）
- Test: `apps/api/src/lib/agent/__tests__/runtime.mergeReplanP1.test.ts`（新）

### Step 1：写失败测试（TB13）

- [ ] 创建 `apps/api/src/lib/agent/__tests__/runtime.mergeReplanP1.test.ts`：

```typescript
/**
 * M7 TB13：P1 追问消化 → 触发 replan 测试。
 *
 * 流程：
 *   1. 创建一个 group run，写 1 步 echo plan
 *   2. 在第 0 步执行之前，往 merged_inputs append 一条追问
 *   3. executeRun → 第 0 步前检测到未消化 → record replan(reason='merge_trigger')
 *      → status='replanning' → return
 *   4. 校验 agent_runs.inputText 未被修改（关键 ADR-M7-13）
 *   5. 校验 agent_steps 含 1 条 replan(reason='merge_trigger')
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getPool } from '../../../db/client.js';
import * as store from '../store.js';
import { createAgentRun, executeRun } from '../runtime.js';
import { applyMergeInTx } from '../store.js';
import { ensureUser, ensureGroup } from './_groupFixture.js';

describe('P1 merged_input triggers replan (M7 TB13)', () => {
  let owner: { id: string };
  let groupId: string;
  let topicId: string;

  beforeEach(async () => {
    owner = await ensureUser('m7-p1');
    const g = await ensureGroup(owner.id, 'p1-' + Math.random());
    groupId = g.groupId;
    topicId = g.topicId;
  });

  it('records replan(reason=merge_trigger) and switches to replanning; inputText untouched', async () => {
    const r = await createAgentRun({
      ownerId: owner.id,
      channel: 'group',
      groupId, topicId,
      inputText: 'echo 三步',  // 用 echo 关键词跳过 LLM planner（test env）
      apiKey: '',
      apiKeySource: 'server',
    });
    const runId = r.run.id;
    const originalInput = r.run.inputText;

    // 模拟追问：append 1 条 merged_input
    await applyMergeInTx(runId, {
      text: '能不能再加一句',
      byUserId: owner.id,
      byUsername: 'tester',
      at: new Date().toISOString(),
    });

    await executeRun(runId);

    const after = (await store.getAgentRun(runId))!;
    // 关键：inputText 未被改写（ADR-M7-13）
    expect(after.inputText).toBe(originalInput);
    expect(after.status).toBe('replanning');
    expect(after.mergedInputsConsumedCount).toBe(1);

    const steps = await store.listSteps(runId);
    const replan = steps.find((s) => s.kind === 'replan');
    expect(replan).toBeDefined();
    expect((replan!.output as { reason: string }).reason).toBe('merge_trigger');
  });
});
```

### Step 2：跑验证 fail

- [ ] 跑：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run src/lib/agent/__tests__/runtime.mergeReplanP1.test.ts
```

Expected：FAIL（status 仍是 completed 或 replanning 未触发）。

### Step 3：runExecute L124 主循环顶部插入 checkMergedInputs

- [ ] 改 `apps/api/src/lib/agent/runExecute.ts`，在 `for (let i = completedCount; ...` 循环的**第一行内**插入（即 abort check 之前）：

```typescript
    for (let i = completedCount; i < plan.steps.length; i++) {
      // === M7 P1：检查未消化追问 → 触发 replan，让 worker re-pickup 走 applyReplanningIfNeeded ===
      // 仅 SELECT 2 列，<1ms（R12）。
      const counts = await store.getMergedInputCounts(runId);
      if (counts && counts.total > counts.consumed) {
        const fromStatus = run.status;
        await recordStep({
          runId,
          kind: 'replan',
          output: {
            reason: 'merge_trigger',
            mergedTotal: counts.total,
            previouslyConsumed: counts.consumed,
          },
        });
        await store.updateAgentRun(runId, {
          mergedInputsConsumedCount: counts.total,
          status: 'replanning',
        });
        const latest = (await store.getAgentRun(runId))!;
        agentHookBus.emitEvent({
          type: 'run.status_changed',
          run: latest,
          from: fromStatus,
          to: 'replanning',
        });
        return;
      }
      // === End M7 P1 ===

      if (abortController.signal.aborted) {
        // ... 现有逻辑
```

> 顶部 import 块如果还没 import `agentHookBus`，加：`import { agentHookBus } from './hooks.js';`（应当已存在 —— `softComplete` emit 终态用到）；如不存在请加。

### Step 4：applyReplanningIfNeeded 识别 merge_trigger 跳过重复 record

- [ ] 改 `apps/api/src/lib/agent/runExecuteHelpers.ts` `applyReplanningIfNeeded`（L63-112）。在拿到 `lastSteer/lastDeny` 之后、`denyIsNewest` 判定之前插入：

```typescript
  // M7 P1：P1 路径已写过一条 replan(reason='merge_trigger')，避免重复 record
  const lastReplanStep = [...steps].reverse().find((s) => s.kind === 'replan');
  const mergeTriggered =
    (lastReplanStep?.output as { reason?: string } | null)?.reason === 'merge_trigger';
```

然后把 critique 分支（`} else if (!steerIsNewest) {`）的 `recordStep(...)` 调用包成条件：

```typescript
  } else if (!steerIsNewest) {
    if (!mergeTriggered) {
      await recordStep({
        runId: run.id,
        kind: 'replan',
        output: {
          reason: 'critique_or_unspecified',
          clearedPlan: true,
          prevPlanVersion: run.plan?.version ?? null,
        },
      });
    }
    next = (await store.updateAgentRun(run.id, {
      plan: null,
      todos: [],
    }))!;
  }
```

### Step 5：跑测试验证 PASS

- [ ] 跑：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run src/lib/agent/__tests__/runtime.mergeReplanP1.test.ts
```

Expected：全绿。

- [ ] 跑现有 replan-loop 测试确认零回归：

```bash
DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run \
  src/lib/agent/__tests__/runtime.replanLoop.test.ts \
  src/lib/agent/__tests__/runtime.steer.test.ts \
  src/lib/agent/__tests__/runtime.softFail.test.ts
```

Expected：全绿。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/agent/runExecute.ts apps/api/src/lib/agent/runExecuteHelpers.ts \
        apps/api/src/lib/agent/__tests__/runtime.mergeReplanP1.test.ts
git commit -m "feat(agent/m7-t5a): P1 runExecute checkMergedInputs → record replan(merge_trigger) + replanning"
```

---

## T5b：P1a planner.buildPlannerUserPrompt 加 mergedInputs 段

**Files:**
- Modify: `apps/api/src/lib/agent/planner.ts`
- Modify: `apps/api/src/lib/agent/runPlanGlue.ts`
- Test: `apps/api/src/lib/agent/__tests__/planner.mergedInputs.test.ts`（新）

### Step 1：写失败测试

- [ ] 创建 `apps/api/src/lib/agent/__tests__/planner.mergedInputs.test.ts`：

```typescript
/**
 * M7 T5b：planner prompt 包含追问段（TB13 后半段）。
 *
 * 验证：mergedInputs 非空时，buildPlannerUserPrompt 渲染 "# 后续追问" 段。
 */
import { describe, it, expect, vi } from 'vitest';
import { generatePlanWithLlm } from '../planner.js';
import type { LlmChatClient, LlmChatMessage } from '../../llm/types.js';

describe('planner buildPlannerUserPrompt with mergedInputs (M7 T5b)', () => {
  it('includes merged input section when mergedInputs provided', async () => {
    let capturedUser = '';
    const llm: LlmChatClient = {
      chat: vi.fn(async (msgs: LlmChatMessage[]) => {
        capturedUser = msgs[msgs.length - 1].content;
        return {
          content: JSON.stringify({
            intentSummary: '总结',
            steps: [{ toolName: 'echo_after_sleep', input: { text: 'x', sleepMs: 1 }, reason: 'r', todoId: 't1' }],
            todos: [{ id: 't1', text: 't1', status: 'pending', stepRefs: [] }],
            finalReplyHint: 'ok',
          }),
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        };
      }),
    };

    await generatePlanWithLlm({
      inputText: '主请求',
      snapshot: {
        systemPrompt: '',
        history: [],
        shortSummary: '',
        usage: {
          usedTokens: 0, limitTokens: 0, ratio: 0,
          breakdown: { system: 0, summary: 0, history: 0, document: 0, pendingUser: 0, outputReserve: 0 },
          compacted: false, droppedVerbatimTurns: 0,
        },
        source: { channel: 'private' },
      },
      llm,
      signal: new AbortController().signal,
      mergedInputs: [
        { text: '追问 A', byUserId: 'u1', byUsername: '小张', at: '2026-05-22T10:00:00Z' },
        { text: '追问 B', byUserId: 'u2', byUsername: '小李', at: '2026-05-22T10:00:30Z' },
      ],
    });

    expect(capturedUser).toContain('# 后续追问');
    expect(capturedUser).toContain('@小张');
    expect(capturedUser).toContain('追问 A');
    expect(capturedUser).toContain('@小李');
    expect(capturedUser).toContain('追问 B');
  });

  it('omits section when mergedInputs empty or undefined', async () => {
    let capturedUser = '';
    const llm: LlmChatClient = {
      chat: vi.fn(async (msgs: LlmChatMessage[]) => {
        capturedUser = msgs[msgs.length - 1].content;
        return {
          content: '{"intentSummary":"x","steps":[{"toolName":"echo_after_sleep","input":{"text":"x","sleepMs":1},"reason":"r","todoId":"t1"}],"todos":[{"id":"t1","text":"t1","status":"pending","stepRefs":[]}],"finalReplyHint":""}',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        };
      }),
    };

    await generatePlanWithLlm({
      inputText: '主请求',
      snapshot: {
        systemPrompt: '',
        history: [],
        shortSummary: '',
        usage: {
          usedTokens: 0, limitTokens: 0, ratio: 0,
          breakdown: { system: 0, summary: 0, history: 0, document: 0, pendingUser: 0, outputReserve: 0 },
          compacted: false, droppedVerbatimTurns: 0,
        },
        source: { channel: 'private' },
      },
      llm,
      signal: new AbortController().signal,
    });
    expect(capturedUser).not.toContain('# 后续追问');
  });
});
```

### Step 2：跑验证 fail

- [ ] 跑：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run src/lib/agent/__tests__/planner.mergedInputs.test.ts
```

Expected：FAIL（"# 后续追问" 段未渲染）。

### Step 3：planner 接受 mergedInputs

- [ ] 改 `apps/api/src/lib/agent/planner.ts` `LlmPlannerInput` 类型（L92-115）末尾加：

```typescript
  /** M7 P1a：合并的追问；非空时 buildPlannerUserPrompt 拼入 "# 后续追问" 段。 */
  mergedInputs?: Array<{ text: string; byUserId: string; byUsername: string; at: string }>;
```

- [ ] 改 `buildPlannerUserPrompt`（L234-242）：

```typescript
function buildPlannerUserPrompt(input: LlmPlannerInput): string {
  const summary = input.snapshot.shortSummary
    ? `\n\n# 当前上下文摘要\n${input.snapshot.shortSummary}`
    : '';
  const failure = input.previousFailure
    ? `\n\n# 上一步失败原因\n${input.previousFailure}\n请基于这个失败重新规划剩余步骤，避免重复同样错误。`
    : '';
  // M7 P1a：合并的追问段（不污染 DB，每次 planner 调用按当前 merged_inputs 全量拼）
  const merged = input.mergedInputs ?? [];
  const mergedSection = merged.length > 0
    ? `\n\n# 后续追问（合并自其他成员，需在新 plan 中一并回应）\n` +
      merged.map((m, i) => `${i + 1}. @${m.byUsername} (${m.at}): ${m.text}`).join('\n')
    : '';
  return `# 用户请求\n${input.inputText}${mergedSection}${summary}${failure}`;
}
```

### Step 4：runPlanGlue.buildInitialPlan 透传 mergedInputs

- [ ] 改 `apps/api/src/lib/agent/runPlanGlue.ts` `buildInitialPlan`（L92-99）：

```typescript
    return await generatePlanWithLlm({
      inputText: text,
      snapshot,
      llm,
      signal,
      previousFailure,
      isSubagent: !!run.parentRunId,
      mergedInputs: run.mergedInputs ?? [],  // M7 P1a
    });
```

### Step 5：跑测试验证 PASS

- [ ] 跑：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run src/lib/agent/__tests__/planner.mergedInputs.test.ts
```

Expected：全绿（2 case）。

- [ ] **Step 6: 跑现有 planner 测试确认零回归**

```bash
DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run \
  src/lib/agent/__tests__/planner.test.ts \
  src/lib/agent/__tests__/planner.llm.test.ts \
  src/lib/agent/__tests__/planner.subagent.test.ts \
  src/lib/agent/__tests__/runPlanGlue.notice.test.ts \
  src/lib/agent/__tests__/runPlanGlue.previousFailure.test.ts
```

Expected：全绿。

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/agent/planner.ts apps/api/src/lib/agent/runPlanGlue.ts \
        apps/api/src/lib/agent/__tests__/planner.mergedInputs.test.ts
git commit -m "feat(agent/m7-t5b): buildPlannerUserPrompt + buildInitialPlan accept mergedInputs (P1a)"
```

---

## T5c：P2 generateFinalReply 加追问段

**Files:**
- Modify: `apps/api/src/lib/agent/replyGen.ts`
- Test: `apps/api/src/lib/agent/__tests__/replyGen.mergedInputs.test.ts`（新）

### Step 1：写失败测试（TB14）

- [ ] 创建 `apps/api/src/lib/agent/__tests__/replyGen.mergedInputs.test.ts`：

```typescript
/**
 * M7 TB14：buildReplyMessages 包含追问段。
 */
import { describe, it, expect } from 'vitest';
import { buildReplyMessages } from '../replyGen.js';
import type { AgentRun, Plan } from '../types.js';

describe('buildReplyMessages with mergedInputs (M7 TB14)', () => {
  const fakePlan: Plan = {
    intentSummary: '一步 echo',
    steps: [],
    todos: [],
    finalReplyHint: '',
    reasoning: null,
    version: 1,
  };

  const baseRun: AgentRun = {
    id: 'r1', ownerId: 'u1', channel: 'group',
    sessionId: null, groupId: 'g', topicId: 't', intentTurnId: null,
    role: 'generalist', status: 'running', inputText: '主请求',
    plan: fakePlan, todos: [],
    budget: { maxSteps: 5, maxSeconds: 60, maxTokens: 1000 },
    usage: { steps: 0, elapsedSeconds: 0, tokens: 0, costCny: 0 },
    apiKeyOwnerId: null, apiKeySource: 'server',
    providerId: 'deepseek', modelId: 'deepseek-v4-pro',
    sandboxId: null, userApiKeysEnc: {},
    parentRunId: null, pendingUserPrompt: null, pendingUserStepIdx: null,
    pendingUserInputExpiresAt: null, summary: null, artifact: null,
    resultMessageId: null, invokeMessageId: null, lastHeartbeatAt: null,
    awaitingApprovalUntil: null, awaitingApprovalStepIdx: null,
    pendingApprovalToolName: null, cancelledByUserId: null, cancelReason: null,
    createdAt: new Date(), startedAt: null, endedAt: null,
    mergedInputs: [], mergedInputsConsumedCount: 0, queuePosition: null,
    askUserTargetUserId: null, askUserStartedAt: null, askUserOpenedForAllAt: null,
  };

  it('renders 后续追问 section in user message when mergedInputs non-empty', () => {
    const run = {
      ...baseRun,
      mergedInputs: [
        { text: '追问甲', byUserId: 'u2', byUsername: '老王', at: '2026-05-22T10:00:00Z' },
      ],
    };
    const msgs = buildReplyMessages({ run, plan: fakePlan, steps: [] });
    const user = msgs.find((m) => m.role === 'user')!;
    expect(user.content).toContain('# 后续追问列表');
    expect(user.content).toContain('@老王');
    expect(user.content).toContain('追问甲');
  });

  it('omits section when mergedInputs empty', () => {
    const msgs = buildReplyMessages({ run: baseRun, plan: fakePlan, steps: [] });
    const user = msgs.find((m) => m.role === 'user')!;
    expect(user.content).not.toContain('# 后续追问列表');
  });
});
```

### Step 2：跑验证 fail

- [ ] 跑：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run src/lib/agent/__tests__/replyGen.mergedInputs.test.ts
```

Expected：FAIL（user.content 不含 "# 后续追问列表"）。

### Step 3：buildReplyMessages 拼追问段

- [ ] 改 `apps/api/src/lib/agent/replyGen.ts` `buildReplyMessages`（L100-146）。在 `const refs = collectReplyRefs(...)` 之后、`const user = ` 之前加：

```typescript
  const merged = run.mergedInputs ?? [];
  const mergedSection = merged.length > 0
    ? `\n\n# 后续追问列表（共 ${merged.length} 条，需在 reply 中统一回应）\n` +
      merged.map((m) => `- @${m.byUsername}: ${m.text}`).join('\n')
    : '';
```

并把现有 user 模板末尾拼上 `${mergedSection}`：

```typescript
  const user = `用户原始请求：${run.inputText}

执行目标：${plan.intentSummary}

工具调用摘要：
${stepDigest || '（无工具调用）'}${refLines}${mergedSection}

最终回复风格提示：${plan.finalReplyHint || '简明、对话风格'}`;
```

### Step 4：跑测试验证 PASS

- [ ] 跑：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run \
  src/lib/agent/__tests__/replyGen.mergedInputs.test.ts \
  src/lib/agent/__tests__/replyGen.test.ts \
  src/lib/agent/__tests__/replyMeta.test.ts
```

Expected：全绿。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/agent/replyGen.ts apps/api/src/lib/agent/__tests__/replyGen.mergedInputs.test.ts
git commit -m "feat(agent/m7-t5c): buildReplyMessages includes 后续追问列表 section (P2)"
```

---

## T5d：P3 runCritique 加追问段

**Files:**
- Modify: `apps/api/src/lib/agent/critique.ts`

> 实施轻量：critique 当前不调 LLM（只是规则）。P3 的语义是"未来 critique 升级到 LLM 时已经能感知追问"。本期最小实现：把 mergedInputs 作为 `CritiqueInput` 可选字段，runCritique 内**不主动**用（保持现有规则），但在 `output.reason` 字符串里 append "(merged_inputs=N)" 便于调试。

### Step 1：扩 `CritiqueInput`

- [ ] 改 `apps/api/src/lib/agent/critique.ts`：

```typescript
import type { AgentStep, MergedInput, Plan } from './types.js';

export type CritiqueReason = 'periodic' | 'consecutive_failures';

export type CritiqueInput = {
  plan: Plan;
  recentSteps: AgentStep[];
  reason: CritiqueReason;
  /** M7 P3：未消化的追问；当前实现仅 append 到 output.reason 字符串便于调试。 */
  mergedInputs?: MergedInput[];
};

// ... 现有 isToolFailure 不变 ...

export function runCritique(input: CritiqueInput): CritiqueOutput {
  const mergedHint =
    input.mergedInputs && input.mergedInputs.length > 0
      ? ` [merged_inputs=${input.mergedInputs.length}]`
      : '';
  if (input.reason === 'consecutive_failures') {
    const tail = input.recentSteps.slice(-4);
    const failures = tail.filter(isToolFailure);
    if (failures.length >= 2) {
      return {
        shouldReplan: true,
        reason: '连续两次工具失败,建议重规划' + mergedHint,
      };
    }
  }
  return { shouldReplan: false, reason: 'no action needed' + mergedHint };
}
```

### Step 2：runExecute critique 调用透传 mergedInputs

- [ ] 改 `apps/api/src/lib/agent/runExecute.ts`（L351-378 两个 `runCritique(...)` 调用），把 `run.mergedInputs` 传入：

```typescript
      // periodic critique
      const c = runCritique({
        plan,
        recentSteps: recentTail,
        reason: 'periodic',
        mergedInputs: run.mergedInputs,
      });
```

两处都改。

### Step 3：跑现有 critique 测试确认零回归

- [ ] 跑：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run \
  src/lib/agent/__tests__/critique.test.ts
```

Expected：全绿（行为未变，新增字段是 optional）。

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/lib/agent/critique.ts apps/api/src/lib/agent/runExecute.ts
git commit -m "feat(agent/m7-t5d): runCritique accepts mergedInputs (P3 - debug hint only)"
```

---

## T5e：P4 contextAdapter group 分支拼 user_message_appended

**Files:**
- Modify: `apps/api/src/lib/agent/contextAdapter.ts`
- Modify: `apps/api/src/lib/agent/contextAdapter.ts` 调用方 `SnapshotForAgentParams` 已有 `runId`（无需扩参数）
- Test: `apps/api/src/lib/agent/__tests__/contextAdapter.mergedInputs.test.ts`（新）

### Step 1：写失败测试

- [ ] 创建 `apps/api/src/lib/agent/__tests__/contextAdapter.mergedInputs.test.ts`：

```typescript
/**
 * M7 T5e：contextAdapter group 分支末尾拼 user_message_appended 作为 history。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getPool } from '../../../db/client.js';
import { snapshotForAgent } from '../contextAdapter.js';
import { applyMergeInTx } from '../store.js';
import { ensureUser, ensureGroup } from './_groupFixture.js';
import { randomUUID } from 'crypto';

async function insertRun(opts: {
  ownerId: string; topicId: string; groupId: string;
}): Promise<string> {
  const id = randomUUID();
  await getPool().query(
    `INSERT INTO agent_runs (id, owner_id, channel, group_id, topic_id, role,
       status, input_text, budget, api_key_source)
     VALUES ($1, $2, 'group', $3, $4, 'generalist',
       'running', 'main', '{"maxSteps":5,"maxSeconds":60,"maxTokens":1000}'::jsonb,
       'server')`,
    [id, opts.ownerId, opts.groupId, opts.topicId],
  );
  return id;
}

describe('contextAdapter group includes user_message_appended (M7 T5e)', () => {
  let owner: { id: string };
  let groupId: string;
  let topicId: string;

  beforeEach(async () => {
    owner = await ensureUser('m7-ctx');
    const g = await ensureGroup(owner.id, 'ctx-' + Math.random());
    groupId = g.groupId;
    topicId = g.topicId;
  });

  it('appends user_message_appended step content as user history', async () => {
    const runId = await insertRun({ ownerId: owner.id, groupId, topicId });
    await applyMergeInTx(runId, {
      text: '追问 P4',
      byUserId: owner.id,
      byUsername: '小赵',
      at: new Date().toISOString(),
    });
    const snap = await snapshotForAgent({
      runId,
      userId: owner.id,
      channel: 'group',
      groupId, topicId,
      pendingUser: 'next q',
      apiKey: '',
    });
    const merged = snap.history.find(
      (m) => m.role === 'user' && m.content.includes('追问 P4'),
    );
    expect(merged).toBeDefined();
    expect(merged!.content).toContain('小赵');
  });
});
```

### Step 2：跑验证 fail

- [ ] 跑：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run src/lib/agent/__tests__/contextAdapter.mergedInputs.test.ts
```

Expected：FAIL。

### Step 3：contextAdapter group 分支追加

- [ ] 改 `apps/api/src/lib/agent/contextAdapter.ts` 末尾 group 分支（L139-161），在 `const last6 = ...` 之前插入：

```typescript
  // M7 P4：读本 run 的 user_message_appended steps 作为 user history 末尾
  const { listSteps } = await import('./store.js');
  const apSteps = await listSteps(params.runId);
  for (const s of apSteps) {
    if (s.kind !== 'user_message_appended') continue;
    const input = s.input as { text?: string; byUsername?: string } | null;
    if (!input?.text) continue;
    history.push({
      role: 'user',
      content: `[${input.byUsername ?? '成员'}] ${input.text}`,
    });
  }
```

### Step 4：跑测试验证 PASS

- [ ] 跑：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run \
  src/lib/agent/__tests__/contextAdapter.mergedInputs.test.ts \
  src/lib/agent/__tests__/contextAdapter.group.test.ts
```

Expected：全绿。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/agent/contextAdapter.ts apps/api/src/lib/agent/__tests__/contextAdapter.mergedInputs.test.ts
git commit -m "feat(agent/m7-t5e): contextAdapter group appends user_message_appended steps to history (P4)"
```

---

# Part F：T6 ask_user 群聊解禁

## T6a：writeAskUserPrompt helper（messageBridge）

**Files:**
- Modify: `apps/api/src/lib/agent/messageBridge.ts`

### Step 1：实现 helper

- [ ] 在 `apps/api/src/lib/agent/messageBridge.ts` 末尾追加：

```typescript
/**
 * M7 T6：群聊 ask_user prompt 群消息。
 *
 * payload.kind = 'agent_ask_user'，mobile GroupChatScreen 据此分支到 AskUserPromptCard。
 * payload.askUser.openedForAll 由 worker checker 在 30s 后切 true，同事务 UPDATE 本消息。
 */
export async function writeAskUserPrompt(params: {
  runId: string;
  groupId: string;
  topicId: string;
  target: string;
  question: string;
}): Promise<string> {
  // 写一条 ai 类型群消息（agent 自己发问）；invokerUserId = target，方便消息归属
  const msg = await social.addGroupMessage(
    params.target,
    params.groupId,
    params.topicId,
    {
      kind: 'ai',
      content: params.question,
      jobId: null,
      invokerUserId: params.target,
    },
  );
  if (!msg) throw new Error('failed to write ask_user prompt');

  await getPool().query(
    `UPDATE group_messages
       SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
         'kind', 'agent_ask_user',
         'askUser', jsonb_build_object(
           'runId', $2::text,
           'target', $3::text,
           'question', $4::text,
           'openedForAll', false
         )
       )
     WHERE id = $1`,
    [msg.id, params.runId, params.target, params.question],
  );
  return msg.id;
}
```

> 现有 `messageBridge.ts` L4 已 import `social` 和 `getPool`，复用即可。

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/lib/agent/messageBridge.ts
git commit -m "feat(agent/m7-t6a): writeAskUserPrompt helper for group ask_user"
```

---

## T6b：askUser tool handler 群聊分支

**Files:**
- Modify: `apps/api/src/lib/agent/tools/askUser.ts`

### Step 1：去早返回 + 调 helper

- [ ] 改 `apps/api/src/lib/agent/tools/askUser.ts` handler（L54-114）：

```typescript
  async handler(input, ctx) {
    const question = (input.question ?? '').trim();
    if (!question) {
      return {
        ok: false, paused: false, messageId: '',
        error: 'question cannot be empty',
      };
    }

    if (ctx.channel === 'private') {
      // 保留 L72-113 现有 INSERT private_chat_messages 全部逻辑
      if (!ctx.sessionId) {
        return {
          ok: false, paused: false, messageId: '',
          error: 'ask_user requires a private chat session (ctx.sessionId missing)',
        };
      }
      const id = randomUUID();
      const createdAt = new Date();
      const payload = {
        id,
        sessionId: ctx.sessionId,
        role: 'assistant' as const,
        content: question,
        type: 'agent_question',
        question,
        options: input.options ?? [],
        agentRunId: ctx.runId,
        agentStepId: ctx.stepId,
        createdAt: createdAt.toISOString(),
      };
      try {
        const { rows } = await getPool().query(
          `INSERT INTO private_chat_messages (id, session_id, owner_id, payload, created_at)
           VALUES ($1, $2, $3, $4::jsonb, $5)
           RETURNING id`,
          [id, ctx.sessionId, ctx.ownerId, JSON.stringify(payload), createdAt],
        );
        const messageId = (rows[0]?.id as string) ?? id;
        return { ok: true, paused: true, messageId };
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') throw e;
        return {
          ok: false, paused: false, messageId: '',
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }

    // M7 T6：群聊分支取代原 L55-62 的早返回
    if (!ctx.groupId || !ctx.topicId) {
      return {
        ok: false, paused: false, messageId: '',
        error: 'group ask_user requires groupId+topicId',
      };
    }
    try {
      const { writeAskUserPrompt } = await import('../messageBridge.js');
      const msgId = await writeAskUserPrompt({
        runId: ctx.runId,
        groupId: ctx.groupId,
        topicId: ctx.topicId,
        target: ctx.ownerId,
        question,
      });
      return { ok: true, paused: true, messageId: msgId };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      return {
        ok: false, paused: false, messageId: '',
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
```

- [ ] 删除 replyMeta.failureHint 里的 "Private channel only" / "在 group 中触发请改写一段澄清问题作为普通回复直接发出" 措辞，改成：

```typescript
  replyMeta: {
    summaryKind: 'silent',
    failureHint:
      'ask_user 失败：检查 sessionId（私聊）或 groupId+topicId（群聊）是否齐全。',
  },
```

并更新顶部注释（L1-16）："当前只支持 private channel" → "私聊 + 群聊均支持。群聊 owner 30s 独占应答，超时由 worker checker 升级到任意群成员可答。"

### Step 2：跑现有 askUser 测试确认私聊路径零回归

- [ ] 跑：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run \
  src/lib/agent/__tests__/runtime.askUser.test.ts
```

Expected：全绿。

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/lib/agent/tools/askUser.ts
git commit -m "feat(agent/m7-t6b): askUser handler enables group channel via writeAskUserPrompt"
```

---

## T6c：runExecute paused 分支扩 askUser 群聊字段

**Files:**
- Modify: `apps/api/src/lib/agent/runExecute.ts`（L334-348）

### Step 1：扩 paused 分支

- [ ] 改 `apps/api/src/lib/agent/runExecute.ts` L334-348：

```typescript
      if (
        tool.name === 'ask_user' &&
        obsObj?.ok === true &&
        obsObj?.paused === true
      ) {
        const question = (planStep.input as { question?: unknown })?.question;
        const fromStatus = run.status;  // ADR-M7-12：update 前 capture

        // 复用现有签名；T1c 已 export UpdateAgentRunPatch 类型别名
        const patch: store.UpdateAgentRunPatch = {
          status: 'awaiting_user_input',
          pendingUserPrompt: typeof question === 'string' ? question : '',
          pendingUserStepIdx: i,
          pendingUserInputExpiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        };
        // M7 T6c：群聊扩展，记录 owner 独占起点
        if (run.channel === 'group') {
          patch.askUserTargetUserId = run.ownerId;
          patch.askUserStartedAt = new Date();
          patch.askUserOpenedForAllAt = null;
        }
        const updated = (await store.updateAgentRun(runId, patch))!;
        agentHookBus.emitEvent({
          type: 'run.status_changed',
          run: updated,
          from: fromStatus,
          to: 'awaiting_user_input',
        });
        return;
      }
```

### Step 2：跑 askUser e2e + runtime 测试

- [ ] 跑：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run \
  src/lib/agent/__tests__/runtime.askUser.test.ts
```

Expected：全绿。

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/lib/agent/runExecute.ts
git commit -m "feat(agent/m7-t6c): runExecute paused branch sets askUser group fields + emits status_changed"
```

---

## T6d：resume 路由 canAnswerAskUser 权限

**Files:**
- Modify: `apps/api/src/routes/agent.ts`（L296-319 resume handler）
- Test: `apps/api/src/routes/__tests__/agent.routes.resume.test.ts`（已存在 —— 加 group case）

### Step 1：写失败测试（TB8/9/10）

- [ ] 在 `apps/api/src/routes/__tests__/agent.routes.resume.test.ts` 末尾追加新 describe block。该文件已有 `makeApp / tokenFor` helper（`tokenFor(u: { id, username, displayName })` 返回 `Promise<string>`），直接复用 —— **务必 `await tokenFor(user)` 并把 helper 接收的是 `user object`，不是 `userId` 字符串**。`ensureUser` 也返回完整 user object（含 username/displayName）：

```typescript
import { agentHookBus } from '../../lib/agent/hooks.js';
import { randomUUID } from 'crypto';
import { ensureGroup } from '../../lib/agent/__tests__/_groupFixture.js';

type TestUser = Awaited<ReturnType<typeof ensureUser>>;  // { id; username; displayName; ... }

describe('M7 T6d ask_user group resume permission', () => {
  let owner: TestUser;
  let other: TestUser;
  let outsider: TestUser;
  let groupId: string;
  let topicId: string;
  let runId: string;

  beforeEach(async () => {
    owner = await ensureUser('m7-resume-o');
    other = await ensureUser('m7-resume-x');
    outsider = await ensureUser('m7-resume-z');
    const g = await ensureGroup(owner.id, 'rt-' + Math.random());
    groupId = g.groupId; topicId = g.topicId;
    await getPool().query(
      `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member')
       ON CONFLICT DO NOTHING`,
      [groupId, other.id],
    );
    runId = randomUUID();
    await getPool().query(
      `INSERT INTO agent_runs (id, owner_id, channel, group_id, topic_id, role,
         status, input_text, budget, api_key_source,
         pending_user_prompt, pending_user_step_idx, pending_user_input_expires_at,
         ask_user_target_user_id, ask_user_started_at)
       VALUES ($1, $2, 'group', $3, $4, 'generalist',
         'awaiting_user_input', 'q', '{"maxSteps":5,"maxSeconds":60,"maxTokens":1000}'::jsonb,
         'server', 'pick A or B', 1, NOW() + INTERVAL '1 hour',
         $2, NOW())`,
      [runId, owner.id, groupId, topicId],
    );
  });

  it('TB8: non-owner within owner-lock window → 403', async () => {
    const app = makeApp();
    const token = await tokenFor(other);
    const res = await app.fetch(
      new Request(`http://x/api/agent/runs/${runId}/resume`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ userInput: '我来答' }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it('TB9: after openedForAll, group member can answer', async () => {
    await getPool().query(
      `UPDATE agent_runs SET ask_user_opened_for_all_at = NOW() WHERE id = $1`,
      [runId],
    );
    const app = makeApp();
    const token = await tokenFor(other);
    const res = await app.fetch(
      new Request(`http://x/api/agent/runs/${runId}/resume`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ userInput: '我来答' }),
      }),
    );
    expect(res.status).toBe(200);
  });

  it('TB10: non-member always 403 even after openedForAll', async () => {
    await getPool().query(
      `UPDATE agent_runs SET ask_user_opened_for_all_at = NOW() WHERE id = $1`,
      [runId],
    );
    const app = makeApp();
    const token = await tokenFor(outsider);
    const res = await app.fetch(
      new Request(`http://x/api/agent/runs/${runId}/resume`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ userInput: '我来答' }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it('TB10b: non-member set as askUserTargetUserId still 403 (membership 优先)', async () => {
    // 极端兜底：未来 planner 如果误把 target 设成非群成员，必须仍然拒绝
    await getPool().query(
      `UPDATE agent_runs SET ask_user_target_user_id = $2 WHERE id = $1`,
      [runId, outsider.id],
    );
    const app = makeApp();
    const token = await tokenFor(outsider);
    const res = await app.fetch(
      new Request(`http://x/api/agent/runs/${runId}/resume`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ userInput: '我来答' }),
      }),
    );
    expect(res.status).toBe(403);
  });
});
```

> `agent.routes.resume.test.ts` 头部已经定义了 `makeApp`/`tokenFor`（见现有 longpoll/resume 测试 L26 范例）：

```typescript
async function tokenFor(u: { id: string; username: string; displayName: string }) {
  const { accessToken } = await signAccessToken({
    id: u.id, username: u.username, displayName: u.displayName,
    createdAt: new Date().toISOString(),
  });
  return accessToken;
}
function makeApp() {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => { c.set('requestId', randomUUID()); await next(); });
  app.route('/api/agent', agentRouter);
  return app;
}
```

直接复用，不要重新发明。

### Step 2：跑验证 fail

- [ ] 跑：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run src/routes/__tests__/agent.routes.resume.test.ts
```

Expected：TB8 / TB10 通过（现有 `canAccessRun` 已禁非成员），但 TB9 FAIL（非 owner 即使 openedForAll 也会被 `canAccessRun` 通过、但缺少 owner-lock 判断 —— 老 handler 没限）。Actually：TB8 现在也会过（403/200 混乱）。运行结果以实际为准；总之至少 1 case fail。

### Step 3：实现 canAnswerAskUser + 替换 resume 权限

- [ ] 在 `apps/api/src/routes/agent.ts` 现有 `canAccessRun` 之后追加：

```typescript
/**
 * M7 T6d：群聊 ask_user resume 权限。比 canAccessRun 更严：
 *   - 私聊：仅 owner
 *   - 群聊 owner：永远可答（无论是否群成员表 —— owner 隐式拥有最高权限）
 *   - 群聊其他人：必须先是群成员，然后满足以下任一条件：
 *     · 是 askUserTargetUserId（planner 指定的目标）
 *     · openedForAll 已生效（30s 倒计时后）
 *   - 非群成员：永远不可答（即便 askUserTargetUserId 被错误设置为非群成员，也兜底拒绝）
 *
 * 注意：本函数仅判断 ask_user resume 权限；GET /runs/:id 等读权限仍用 canAccessRun。
 */
export async function canAnswerAskUser(run: AgentRun, userId: string): Promise<boolean> {
  if (run.channel !== 'group') return userId === run.ownerId;
  // owner 直通（无论 ask_user 配置如何）
  if (userId === run.ownerId) return true;
  // 严格：先 enforce 群成员身份，再看 target / openedForAll
  const { rows } = await getPool().query(
    `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1`,
    [run.groupId, userId],
  );
  if (rows.length === 0) return false;
  // 是群成员 + 被指定为 target → 可答
  if (run.askUserTargetUserId && userId === run.askUserTargetUserId) return true;
  // 是群成员 + 已升级为开放 → 任意群成员可答
  if (run.askUserOpenedForAllAt && new Date(run.askUserOpenedForAllAt) <= new Date()) {
    return true;
  }
  return false;
}
```

- [ ] 修改 `agentRouter.post('/runs/:id/resume', ...)` handler（L296-319）：把权限校验从 `canAccessRun` 改成 `canAnswerAskUser`：

```typescript
agentRouter.post('/runs/:id/resume', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const run = await store.getAgentRun(id);
  if (!run) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  if (!(await canAnswerAskUser(run, userId)))
    return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);
  if (run.status !== 'awaiting_user_input') return jsonError(c, ErrorCodes.VALIDATION, 409);
  // ... 其余逻辑保持原样
});
```

### Step 4：跑测试验证 PASS

- [ ] 跑：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run src/routes/__tests__/agent.routes.resume.test.ts
```

Expected：全绿（含原有 + TB8 / TB9 / TB10）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/agent.ts apps/api/src/routes/__tests__/agent.routes.resume.test.ts
git commit -m "feat(agent/m7-t6d): canAnswerAskUser + resume route enforces group owner-lock / openedForAll / non-member"
```

---

## T6e：worker checker autoOpenAskUserForAll

**Files:**
- Create: `apps/api/src/lib/agent/openAskUserForAll.ts`
- Modify: `apps/api/src/lib/agent/worker.ts`
- Test: `apps/api/src/lib/agent/__tests__/openAskUserForAll.test.ts`（新，TB17）

### Step 1：写失败测试（TB17）

- [ ] 创建 `apps/api/src/lib/agent/__tests__/openAskUserForAll.test.ts`：

```typescript
/**
 * M7 TB17：autoOpenAskUserForAll worker checker 单事务 update。
 *
 * 验证：
 *   - 30s 后命中 → agent_runs.ask_user_opened_for_all_at 非空
 *   - 同事务 update group_messages.payload.askUser.openedForAll → true
 *   - emit ask_user.opened_for_all hook
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getPool } from '../../../db/client.js';
import { autoOpenAskUserForAll } from '../openAskUserForAll.js';
import { agentHookBus } from '../hooks.js';
import { writeAskUserPrompt } from '../messageBridge.js';
import { ensureUser, ensureGroup } from './_groupFixture.js';
import { randomUUID } from 'crypto';

describe('autoOpenAskUserForAll (M7 TB17)', () => {
  let owner: { id: string };
  let groupId: string;
  let topicId: string;
  let runId: string;
  let msgId: string;

  beforeEach(async () => {
    owner = await ensureUser('m7-aoaa');
    const g = await ensureGroup(owner.id, 'aoaa-' + Math.random());
    groupId = g.groupId;
    topicId = g.topicId;
    runId = randomUUID();
    await getPool().query(
      `INSERT INTO agent_runs (id, owner_id, channel, group_id, topic_id, role,
         status, input_text, budget, api_key_source,
         pending_user_prompt, pending_user_step_idx, pending_user_input_expires_at,
         ask_user_target_user_id, ask_user_started_at)
       VALUES ($1, $2, 'group', $3, $4, 'generalist',
         'awaiting_user_input', 'q', '{"maxSteps":5,"maxSeconds":60,"maxTokens":1000}'::jsonb,
         'server', 'q', 0, NOW() + INTERVAL '1 hour',
         $2, NOW() - INTERVAL '60 seconds')`,
      [runId, owner.id, groupId, topicId],
    );
    msgId = await writeAskUserPrompt({
      runId, groupId, topicId, target: owner.id, question: 'q',
    });
  });

  it('opens for all after 30s and updates group_messages payload', async () => {
    const events: unknown[] = [];
    const off = agentHookBus.onEvent((e) => events.push(e));
    const n = await autoOpenAskUserForAll(new Date());
    off();
    expect(n).toBeGreaterThanOrEqual(1);

    const { rows } = await getPool().query(
      `SELECT ask_user_opened_for_all_at FROM agent_runs WHERE id = $1`, [runId],
    );
    expect(rows[0].ask_user_opened_for_all_at).not.toBeNull();

    const { rows: m } = await getPool().query(
      `SELECT payload FROM group_messages WHERE id = $1`, [msgId],
    );
    const p = m[0].payload as { askUser?: { openedForAll?: boolean } };
    expect(p.askUser?.openedForAll).toBe(true);

    const hook = events.find((e) => (e as { type: string }).type === 'ask_user.opened_for_all');
    expect(hook).toBeDefined();
  });

  it('skips runs within 30s window', async () => {
    await getPool().query(
      `UPDATE agent_runs SET ask_user_started_at = NOW() WHERE id = $1`, [runId],
    );
    const n = await autoOpenAskUserForAll(new Date());
    const { rows } = await getPool().query(
      `SELECT ask_user_opened_for_all_at FROM agent_runs WHERE id = $1`, [runId],
    );
    expect(rows[0].ask_user_opened_for_all_at).toBeNull();
  });
});
```

### Step 2：跑验证 fail

- [ ] 跑：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run src/lib/agent/__tests__/openAskUserForAll.test.ts
```

Expected：FAIL（模块不存在）。

### Step 3：实现 autoOpenAskUserForAll

- [ ] 创建 `apps/api/src/lib/agent/openAskUserForAll.ts`：

```typescript
/**
 * M7 T6e：群聊 ask_user owner 独占 → 30s 后升级为"任意群成员可答"。
 *
 * 模式对齐 M4 autoExpireAwaitingUserInput：每 worker tick 扫一次。
 *
 * 单事务做 3 件事：
 *   1. UPDATE agent_runs SET ask_user_opened_for_all_at = NOW()
 *   2. UPDATE group_messages SET payload.askUser.openedForAll = true
 *   3. emit ask_user.opened_for_all hook
 *
 * 关键设计：用 ask_user_started_at（独立时间戳）判 30s，
 * 而不是 last_heartbeat_at（被 worker 持续刷新）。
 */
import { getPool } from '../../db/client.js';
import * as store from './store.js';
import { agentHookBus } from './hooks.js';

const ASK_USER_OWNER_LOCK_MS = 30_000;

export async function autoOpenAskUserForAll(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - ASK_USER_OWNER_LOCK_MS);
  const client = await getPool().connect();
  try {
    const { rows: candidates } = await client.query(
      `SELECT id FROM agent_runs
        WHERE status = 'awaiting_user_input'
          AND channel = 'group'
          AND ask_user_opened_for_all_at IS NULL
          AND ask_user_started_at IS NOT NULL
          AND ask_user_started_at < $1`,
      [cutoff],
    );

    let resolved = 0;
    for (const row of candidates) {
      const runId = row.id as string;
      await client.query('BEGIN');
      try {
        const upd = await client.query(
          `UPDATE agent_runs
              SET ask_user_opened_for_all_at = NOW()
            WHERE id = $1
              AND status = 'awaiting_user_input'
              AND ask_user_opened_for_all_at IS NULL
            RETURNING id`,
          [runId],
        );
        if (upd.rowCount === 0) {
          await client.query('ROLLBACK');
          continue;  // 已被另一 worker 抢
        }
        await client.query(
          `UPDATE group_messages
              SET payload = jsonb_set(
                COALESCE(payload, '{}'::jsonb),
                '{askUser,openedForAll}',
                'true'::jsonb,
                true
              )
            WHERE payload->>'kind' = 'agent_ask_user'
              AND payload->'askUser'->>'runId' = $1`,
          [runId],
        );
        await client.query('COMMIT');
        const latest = await store.getAgentRun(runId);
        if (latest) {
          agentHookBus.emitEvent({
            type: 'ask_user.opened_for_all',
            runId,
            run: latest,
          });
        }
        resolved++;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.warn('[autoOpenAskUserForAll] update failed', runId, e);
      }
    }
    return resolved;
  } finally {
    client.release();
  }
}
```

### Step 4：接入 worker tick

- [ ] 改 `apps/api/src/lib/agent/worker.ts`，在 `autoExpireAwaitingUserInput` 之后加：

```typescript
import { autoOpenAskUserForAll } from './openAskUserForAll.js';

// ... 在 tick() 内 autoExpireAwaitingUserInput 块之后追加：
  // 1.6) M7 T6e：群聊 ask_user owner 独占 30s 后开放
  try {
    await autoOpenAskUserForAll(new Date());
  } catch (e) {
    console.error('[agent worker] autoOpenAskUserForAll failed', e);
  }
```

### Step 5：跑测试验证 PASS

- [ ] 跑：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run src/lib/agent/__tests__/openAskUserForAll.test.ts
```

Expected：全绿（2 case）。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/agent/openAskUserForAll.ts apps/api/src/lib/agent/worker.ts \
        apps/api/src/lib/agent/__tests__/openAskUserForAll.test.ts
git commit -m "feat(agent/m7-t6e): autoOpenAskUserForAll worker checker (30s owner lock → openedForAll)"
```

---

# Part G：T7 deep_research 群聊子卡片

## T7a：writeGroupChildPlaceholder helper（messageBridge）

**Files:**
- Modify: `apps/api/src/lib/agent/messageBridge.ts`

### Step 1：实现 helper

- [ ] 在 `apps/api/src/lib/agent/messageBridge.ts` 末尾追加：

```typescript
/**
 * M7 T7：deep_research 群聊子 run 占位。
 *
 * 与 writeGroupPlaceholder 的区别：不写 human invoker message。
 * 父 run 已经在群里有 invoker（owner 自己），子 run 是 agent 派出的，
 * 写一条 human 消息会"伪造 owner 发了'研究 xxx'"（ADR-M7-6）。
 *
 * 返回的字段对齐 writeGroupPlaceholder.GroupPlaceholderResult，
 * 但 invokeMessageId = '' 标识"没有 invoker 消息"。
 */
export async function writeGroupChildPlaceholder(params: {
  parentRunId: string;
  parentOwnerId: string;
  childRunId: string;
  groupId: string;
  topicId: string;
  childInputText: string;
}): Promise<GroupPlaceholderResult> {
  const job = await intel.createLlmJob({
    ownerId: params.parentOwnerId,
    invokerUserId: params.parentOwnerId,
    groupId: params.groupId,
    topicId: params.topicId,
    payload: {
      agentRunId: params.childRunId,
      parentRunId: params.parentRunId,
      kind: 'agent_child',
    },
  });

  const placeholderContent = `[子任务研究中：${params.childInputText.slice(0, 40)}…]`;
  const placeholder = await social.addGroupMessage(
    params.parentOwnerId,
    params.groupId,
    params.topicId,
    {
      kind: 'ai',
      content: placeholderContent,
      jobId: job.id,
      invokerUserId: params.parentOwnerId,
    },
  );
  if (!placeholder) throw new Error('failed to write group child placeholder');

  await getPool().query(
    `UPDATE group_messages
     SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
       'agentRun',
       jsonb_build_object(
         'agentRunId', $2::text,
         'parentRunId', $3::text,
         'status', 'draft',
         'llmJobId', $4::text,
         'isChildPlaceholder', true
       )
     )
     WHERE id = $1`,
    [placeholder.id, params.childRunId, params.parentRunId, job.id],
  );

  return {
    invokeMessageId: '',  // 无 invoker
    placeholderAiMessageId: placeholder.id,
    llmJobId: job.id,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/lib/agent/messageBridge.ts
git commit -m "feat(agent/m7-t7a): writeGroupChildPlaceholder helper (no human invoker)"
```

---

## T7b：createAgentRun 加 surfaceMode 参数

**Files:**
- Modify: `apps/api/src/lib/agent/runLifecycle.ts`

### Step 1：扩 input 类型 + 路由

- [ ] 改 `apps/api/src/lib/agent/runLifecycle.ts` `CreateAgentRunInput` 类型，追加：

```typescript
  /**
   * M7 T7：占位写入方式。
   *   - 'default'：现有 writeGroupPlaceholder（human invoker + ai placeholder）
   *   - 'child_card'：M7 deep_research 群聊；走 writeGroupChildPlaceholder（仅 ai）
   * 未指定时默认 'default'。
   */
  surfaceMode?: 'default' | 'child_card';
```

- [ ] 修改 `createAgentRun` 群聊分支（L145-166），根据 `input.surfaceMode === 'child_card'` 切换：

```typescript
  if (input.channel === 'group' && input.groupId && input.topicId) {
    const surfaceMode = input.surfaceMode ?? 'default';
    let bridge:
      | { invokeMessageId: string; placeholderAiMessageId: string; llmJobId: string };
    if (surfaceMode === 'child_card') {
      if (!input.parentRunId) {
        throw new Error('surfaceMode=child_card requires parentRunId');
      }
      const { writeGroupChildPlaceholder } = await import('./messageBridge.js');
      bridge = await writeGroupChildPlaceholder({
        parentRunId: input.parentRunId,
        parentOwnerId: input.ownerId,
        childRunId: run.id,
        groupId: input.groupId,
        topicId: input.topicId,
        childInputText: input.inputText,
      });
    } else {
      bridge = await writeGroupPlaceholder({
        userId: input.ownerId,
        groupId: input.groupId,
        topicId: input.topicId,
        inputText: input.inputText,
        agentRunId: run.id,
      });
    }
    userMessageId = bridge.invokeMessageId || null;
    placeholderMessageId = bridge.placeholderAiMessageId;
    llmJobId = bridge.llmJobId;
    const updated = await store.updateAgentRun(run.id, {
      invokeMessageId: bridge.invokeMessageId || null,
      resultMessageId: placeholderMessageId,
    });
    return {
      run: updated ?? run,
      userMessageId,
      placeholderMessageId,
      llmJobId,
    };
  }
```

- [ ] **Step 2: 跑 messageBridge / runLifecycle 既有测试，确认零回归**

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run \
  src/lib/agent/__tests__/messageBridge.group.test.ts \
  src/lib/agent/__tests__/runLifecycle.artifact.test.ts \
  src/lib/agent/__tests__/runtime.group.test.ts
```

Expected：全绿。

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/lib/agent/runLifecycle.ts
git commit -m "feat(agent/m7-t7b): createAgentRun + surfaceMode='child_card' routes to writeGroupChildPlaceholder"
```

---

## T7c：deepResearch handler 群聊分支

**Files:**
- Modify: `apps/api/src/lib/agent/tools/deepResearch.ts`
- Test: `apps/api/src/lib/agent/__tests__/deepResearch.group.test.ts`（新，TB11）

### Step 1：写失败测试（TB11）

- [ ] 创建 `apps/api/src/lib/agent/__tests__/deepResearch.group.test.ts`：

```typescript
/**
 * M7 TB11：deep_research 群聊子 run。
 *
 * 验证：
 *   - 父 channel=group → 子 channel=group + 同 topic
 *   - 子 placeholder 仅 1 条 ai 消息（无 human）
 *   - acquireTopicSlot 不被合并（parentRunId 强制 create_fresh）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getPool } from '../../../db/client.js';
import { ensureUser, ensureGroup } from './_groupFixture.js';
import { randomUUID } from 'crypto';

// Mock dispatchChildRun 不真跑（避免 LLM）
vi.mock('../childExecutor.js', () => ({
  dispatchChildRun: vi.fn(async (id: string) => {
    // 立刻标 completed 让 deepResearch poll loop 退出
    const { getPool } = await import('../../../db/client.js');
    await getPool().query(
      `UPDATE agent_runs SET status='completed', ended_at=NOW() WHERE id=$1`,
      [id],
    );
  }),
}));

describe('deep_research group child run (M7 TB11)', () => {
  let owner: { id: string };
  let groupId: string;
  let topicId: string;
  let parentId: string;

  beforeEach(async () => {
    owner = await ensureUser('m7-dr');
    const g = await ensureGroup(owner.id, 'dr-' + Math.random());
    groupId = g.groupId;
    topicId = g.topicId;
    parentId = randomUUID();
    await getPool().query(
      `INSERT INTO agent_runs (id, owner_id, channel, group_id, topic_id, role,
         status, input_text, budget, api_key_source)
       VALUES ($1, $2, 'group', $3, $4, 'generalist',
         'running', 'main', '{"maxSteps":5,"maxSeconds":60,"maxTokens":1000}'::jsonb,
         'server')`,
      [parentId, owner.id, groupId, topicId],
    );
  });

  it('spawns child in same group/topic with 1 ai placeholder only', async () => {
    const { deepResearchTool } = await import('../tools/deepResearch.js');
    const ctx = {
      runId: parentId, stepId: 'step-1', ownerId: owner.id,
      channel: 'group' as const,
      groupId, topicId,
      signal: new AbortController().signal,
    };
    const before = await getPool().query(
      `SELECT COUNT(*)::int AS c FROM group_messages WHERE group_id=$1 AND topic_id=$2`,
      [groupId, topicId],
    );
    const result = await deepResearchTool.handler({ question: 'subtopic xyz' }, ctx);
    expect(result.ok).toBe(true);

    // 子 run 同 group/topic
    const { rows } = await getPool().query(
      `SELECT channel, group_id, topic_id FROM agent_runs WHERE parent_run_id = $1`,
      [parentId],
    );
    expect(rows[0].channel).toBe('group');
    expect(rows[0].group_id).toBe(groupId);
    expect(rows[0].topic_id).toBe(topicId);

    // group_messages 只多 1 条
    const after = await getPool().query(
      `SELECT COUNT(*)::int AS c FROM group_messages WHERE group_id=$1 AND topic_id=$2`,
      [groupId, topicId],
    );
    expect(after.rows[0].c - before.rows[0].c).toBe(1);

    // 那条是 ai
    const { rows: msgs } = await getPool().query(
      `SELECT payload FROM group_messages WHERE group_id=$1 AND topic_id=$2 ORDER BY created_at DESC LIMIT 1`,
      [groupId, topicId],
    );
    const p = msgs[0].payload as { kind?: string };
    expect(p.kind).toBe('ai');
  });
});
```

### Step 2：跑验证 fail

- [ ] 跑：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run src/lib/agent/__tests__/deepResearch.group.test.ts
```

Expected：FAIL（子 run channel='private' 或写 2 条 group msg）。

### Step 3：deepResearch handler 群聊分支

- [ ] 改 `apps/api/src/lib/agent/tools/deepResearch.ts` handler（L71-90）：

```typescript
      const isParentGroup =
        parentRun.channel === 'group' && !!parentRun.groupId && !!parentRun.topicId;

      const childResult = await createAgentRun({
        ownerId: parentRun.ownerId,
        channel: isParentGroup ? 'group' : 'private',
        groupId: isParentGroup ? parentRun.groupId! : undefined,
        topicId: isParentGroup ? parentRun.topicId! : undefined,
        inputText: input.question,
        apiKey: '',
        apiKeySource: parentRun.apiKeySource,
        providerId: parentRun.providerId,
        modelId: parentRun.modelId,
        parentRunId: parentRun.id,
        budget: { maxSteps, maxSeconds: 120, maxTokens: 50_000 },
        surfaceMode: isParentGroup ? 'child_card' : 'default',
      });
```

### Step 4：跑测试验证 PASS

- [ ] 跑：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run \
  src/lib/agent/__tests__/deepResearch.group.test.ts \
  src/lib/agent/__tests__/runtime.research.e2e.test.ts
```

Expected：全绿。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/agent/tools/deepResearch.ts apps/api/src/lib/agent/__tests__/deepResearch.group.test.ts
git commit -m "feat(agent/m7-t7c): deep_research routes child run to group when parent is group (surfaceMode=child_card)"
```

---

# Part H：T8 long-poll 订阅 4 个新 hook

**Files:**
- Modify: `apps/api/src/routes/agent.ts`（L248-260 long-poll subscribe 块）
- Test: `apps/api/src/routes/__tests__/agent.longpoll.m7.test.ts`（新，TB15）

### Step 1：写失败测试（TB15）

- [ ] 创建 `apps/api/src/routes/__tests__/agent.longpoll.m7.test.ts`：

```typescript
/**
 * M7 TB15：long-poll 在 hold 期间订阅 4 个新 hook，命中立即出 batch。
 *
 * 测试约定（对齐 agent.longpoll.test.ts，直接搬运 makeApp / tokenFor）：
 *   - tokenFor 接 user object（{ id, username, displayName }），返回 Promise<string>
 *   - _holdMs=3000 缩短等待
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { randomUUID } from 'crypto';
import { getPool } from '../../db/client.js';
import { runMigrations } from '../../db/migrate.js';
import { agentHookBus } from '../../lib/agent/hooks.js';
import { ensureUser, ensureGroup } from '../../lib/agent/__tests__/_groupFixture.js';
import { agentRouter } from '../agent.js';
import { signAccessToken } from '../../lib/auth.js';
import type { AppVariables } from '../../types.js';

function makeApp() {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('requestId', randomUUID());
    await next();
  });
  app.route('/api/agent', agentRouter);
  return app;
}

async function tokenFor(u: { id: string; username: string; displayName: string }) {
  const { accessToken } = await signAccessToken({
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    createdAt: new Date().toISOString(),
  });
  return accessToken;
}

type TestUser = Awaited<ReturnType<typeof ensureUser>>;

describe('long-poll subscribes to M7 status-only events (TB15)', () => {
  let owner: TestUser;
  let groupId: string;
  let topicId: string;
  let runId: string;

  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    owner = await ensureUser('m7-lp');
    const g = await ensureGroup(owner.id, 'lp-' + Math.random());
    groupId = g.groupId;
    topicId = g.topicId;
    runId = randomUUID();
    await getPool().query(
      `INSERT INTO agent_runs (id, owner_id, channel, group_id, topic_id, role,
         status, input_text, budget, api_key_source)
       VALUES ($1, $2, 'group', $3, $4, 'generalist',
         'running', 'main', '{"maxSteps":5,"maxSeconds":60,"maxTokens":1000}'::jsonb,
         'server')`,
      [runId, owner.id, groupId, topicId],
    );
  });

  async function startLongPollAndEmit(emit: () => void) {
    const app = makeApp();
    const token = await tokenFor(owner);
    const fetchPromise = app.fetch(
      new Request(
        `http://x/api/agent/runs/${runId}/long-poll?after=-1&_holdMs=3000`,
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    );
    setTimeout(emit, 50);
    const res = await fetchPromise;
    return await res.text();
  }

  it('returns batch immediately when run.status_changed fires', async () => {
    const txt = await startLongPollAndEmit(() => {
      agentHookBus.emitEvent({
        type: 'run.status_changed',
        run: { id: runId } as never,
        from: 'running', to: 'replanning',
      });
    });
    expect(txt).toContain('"type":"batch"');
  }, 5000);

  it('returns batch immediately when run.dequeued fires', async () => {
    const txt = await startLongPollAndEmit(() => {
      agentHookBus.emitEvent({ type: 'run.dequeued', run: { id: runId } as never });
    });
    expect(txt).toContain('"type":"batch"');
  }, 5000);

  it('returns batch immediately when ask_user.opened_for_all fires', async () => {
    const txt = await startLongPollAndEmit(() => {
      agentHookBus.emitEvent({
        type: 'ask_user.opened_for_all',
        runId,
        run: { id: runId } as never,
      });
    });
    expect(txt).toContain('"type":"batch"');
  }, 5000);

  it('returns batch immediately when run.merged_input_appended fires', async () => {
    const txt = await startLongPollAndEmit(() => {
      agentHookBus.emitEvent({
        type: 'run.merged_input_appended',
        runId,
        mergedInputsCount: 2,
      });
    });
    expect(txt).toContain('"type":"batch"');
  }, 5000);
});
```

### Step 2：跑验证 fail

- [ ] 跑：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run src/routes/__tests__/agent.longpoll.m7.test.ts
```

Expected：FAIL（long-poll 在 hold 中 ignore 这 4 个事件）。

### Step 3：扩 long-poll 订阅集合

- [ ] 改 `apps/api/src/routes/agent.ts` 长轮询 hold 块 L248-260：

```typescript
    unsubscribeRef = agentHookBus.onEvent((event: AgentHookEvent) => {
      if (event.type === 'step.recorded' && event.runId === id) {
        settle('step');
      } else if (
        (event.type === 'run.completed' ||
          event.type === 'run.failed' ||
          event.type === 'run.cancelled' ||
          event.type === 'run.budget_exhausted') &&
        event.run.id === id
      ) {
        settle('run');
      } else if (
        // M7 T8：状态-only 变化也立即出 batch
        (event.type === 'run.status_changed' && event.run.id === id) ||
        (event.type === 'run.dequeued' && event.run.id === id) ||
        (event.type === 'ask_user.opened_for_all' && event.runId === id) ||
        (event.type === 'run.merged_input_appended' && event.runId === id)
      ) {
        settle('run');
      }
    });
```

### Step 4：跑测试验证 PASS

- [ ] 跑：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run \
  src/routes/__tests__/agent.longpoll.m7.test.ts \
  src/routes/__tests__/agent.longpoll.test.ts
```

Expected：全绿（含 M6 + M7 新加 4 case）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/agent.ts apps/api/src/routes/__tests__/agent.longpoll.m7.test.ts
git commit -m "feat(agent/m7-t8): long-poll subscribes to 4 new hook events (status_changed/dequeued/opened_for_all/merged_input_appended)"
```

---

# Part I：T9-T10 Mobile

## T9：AgentRunCard 增量改动

**Files:**
- Modify: `apps/mobile/src/features/agent/AgentRunCard.tsx`

> 现状假设：组件已渲染 `run.status` 和 `run.todos`。下面只追加 2 段 UI 后缀 + 1 段 deep_research 跳转。如组件分文件，按需找对应 sub-component。

### Step 1：找文件

- [ ] 列文件：

```bash
ls apps/mobile/src/features/agent/AgentRunCard*
```

Expected：`AgentRunCard.tsx` 或类似命名。如名字不同（如 `AgentRunCardView.tsx`），后面 step 路径相应替换。

### Step 2：扩 STATUS_LABEL + 加 queued / merged 后缀

> 现状（`apps/mobile/src/features/agent/AgentRunCard.tsx` L44）：`STATUS_LABEL` 类型是 `Record<AgentRunStatus, string>`，T1e 把 `'queued'` 加进 `AgentRunStatus` 后，TS 会编译失败要求补 case。

- [ ] 改 `STATUS_LABEL` 加 `queued` key：

```tsx
const STATUS_LABEL: Record<AgentRunStatus, string> = {
  draft: '准备中',
  planning: '规划中',
  running: '运行中',
  awaiting_approval: '等待授权',
  awaiting_user_input: '等待输入',
  replanning: '重新规划',
  queued: '排队中',                  // ← M7 新加
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  budget_exhausted: '预算耗尽',
};
```

- [ ] 在 `AgentRunCard.tsx` header 段（status / progress 行附近，即原 `Agent · {STATUS_LABEL[run.status]}` 行下方）追加（具体位置按现有布局自然嵌入）：

```tsx
{run.status === 'queued' && (
  <Text style={{ fontSize: 12, color: '#888' }}>
    排队中 · 前面还有 {run.queuePosition ?? '?'} 个任务
  </Text>
)}

{run.mergedInputs && run.mergedInputs.length > 0 && (
  <Text style={{ fontSize: 12, color: '#888' }}>
    · 已合并 {run.mergedInputs.length} 个追问
  </Text>
)}
```

### Step 3：deep_research 子 run 跳转

> 实施前先 grep 现有 step 渲染位置：

```bash
rg "step\.kind.*tool_call" apps/mobile/src/features/agent/ -l
```

- [ ] 在 step 渲染列表里，识别 `step.toolName === 'deep_research'` 且 output 含 `childRunId`，包装 TouchableOpacity：

```tsx
{(() => {
  if (step.kind === 'tool_call' && step.toolName === 'deep_research') {
    const out = step.output as { result?: { childRunId?: string } } | null;
    const childRunId = out?.result?.childRunId;
    if (childRunId) {
      return (
        <TouchableOpacity onPress={() => navigation.navigate('AgentRunDetail', { runId: childRunId })}>
          <Text style={{ color: '#0a66c2' }}>
            研究子任务（→ 查看详情）
          </Text>
        </TouchableOpacity>
      );
    }
  }
  return null;
})()}
```

> 实际目标 screen 名按现有 router 命名（`BrainAgentRunDetailScreen` 或 `AgentRunDetailScreen`）；查：

```bash
rg "AgentRunDetail|BrainAgentRunDetail" apps/mobile/src --type tsx -l
```

替换 `'AgentRunDetail'` 为真实名。

### Step 4：mobile tsc 通过

- [ ] 跑：

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected：exit 0。

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/features/agent/
git commit -m "feat(agent/m7-t9): AgentRunCard queued/merged suffix + deep_research child run jump"
```

---

## T10：AskUserPromptCard + GroupChatScreen 集成

**Files:**
- Create: `apps/mobile/src/features/agent/AskUserPromptCard.tsx`
- Modify: `apps/mobile/src/screens/GroupChatScreen.tsx`

### Step 1：定位 GroupChatScreen 消息渲染分支

- [ ] grep：

```bash
rg "payload\.agentRun|payload\.askUser|payload\?\.kind" apps/mobile/src/screens/GroupChatScreen.tsx -n
```

Expected：现有 `payload.agentRun` 分支约在 L500+。

### Step 2：创建 AskUserPromptCard

- [ ] 创建 `apps/mobile/src/features/agent/AskUserPromptCard.tsx`：

```tsx
/**
 * M7 T10：群聊 ask_user 提示卡。
 *
 * 数据双源：
 *   1. message payload.askUser（原始问题文本 + openedForAll 初始值）
 *   2. useAgentRunPoll(runId) 拉到的最新 run（动态 ask_user_opened_for_all_at /
 *      ask_user_target_user_id / pending_user_input_expires_at）
 *
 * 输入框可见性：
 *   - currentUserId === askUserTargetUserId → 始终可见
 *   - askUserOpenedForAllAt 非空 → 任意群成员可见
 *   - 否则隐藏（仅显示"请 @target 回答 + 30s 倒计时"）
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAgentRunPoll } from './hooks/useAgentRunPoll';
import { resumeAgentRun } from './agentApi';
import { useAuth } from '../../components/AuthGate';
import { appAlert } from '../../lib/appAlert';

export type AskUserPromptCardProps = {
  runId: string;
  /** message payload.askUser 提供初始值，等 useAgentRunPoll 拉到新数据后覆盖 */
  initial: {
    question: string;
    target: string;
    openedForAll: boolean;
  };
};

export function AskUserPromptCard(props: AskUserPromptCardProps) {
  const { runId, initial } = props;
  const { run } = useAgentRunPoll(runId);
  // useAuth 返回 { user, logout, applyAuthUser }，user 可能为 null（未登录）
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [input, setInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const question = run?.pendingUserPrompt ?? initial.question;
  const target = run?.askUserTargetUserId ?? initial.target;
  const openedForAll =
    !!run?.askUserOpenedForAllAt || initial.openedForAll;

  // 30s 倒计时
  const startedAtMs = run?.askUserStartedAt
    ? new Date(run.askUserStartedAt).getTime()
    : 0;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const remainSec = useMemo(() => {
    if (!startedAtMs || openedForAll) return 0;
    return Math.max(0, Math.ceil((startedAtMs + 30_000 - now) / 1000));
  }, [startedAtMs, openedForAll, now]);

  const canAnswer = userId === target || openedForAll;

  const onSubmit = async () => {
    const trimmed = input.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await resumeAgentRun(runId, trimmed);
      setInput('');
    } catch (e) {
      appAlert('提交失败', String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, marginVertical: 6 }}>
      <Text style={{ fontSize: 14, marginBottom: 6 }}>{question}</Text>
      <Text style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>
        {openedForAll
          ? '任意群成员可回答'
          : `请 @${target} 回答 · ${remainSec}s 后开放`}
      </Text>
      {canAnswer && (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="输入你的回答…"
            style={{ flex: 1, borderWidth: 1, borderColor: '#eee', borderRadius: 6, padding: 6 }}
            editable={!submitting}
          />
          <TouchableOpacity onPress={onSubmit} disabled={submitting || input.trim().length === 0}
                            style={{ marginLeft: 8, padding: 6, backgroundColor: '#0a66c2', borderRadius: 6 }}>
            <Text style={{ color: '#fff' }}>{submitting ? '提交中' : '提交'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}
```

> Import 路径已对齐当前项目（验证过）：
> - `useAgentRunPoll`：`apps/mobile/src/features/agent/hooks/useAgentRunPoll.ts`
> - `useAuth`：`apps/mobile/src/components/AuthGate.tsx`，返回 `{ user: User | null; logout; applyAuthUser }`
> - `appAlert`：`apps/mobile/src/lib/appAlert.ts`
>
> 接口校验：

```bash
rg "export.*useAgentRunPoll|export.*resumeAgentRun|export.*appAlert" apps/mobile/src -n | head
```

如 `resumeAgentRun` 不存在或签名不同，需在 `agentApi.ts` 加一个对齐（M3/M4 应该已经有，先 grep 再决定是否补）：

```typescript
export async function resumeAgentRun(runId: string, userInput: string): Promise<void> {
  await api.post(`/api/agent/runs/${runId}/resume`, { userInput });
}
```

### Step 3：GroupChatScreen 接 AskUserPromptCard

- [ ] 在 `apps/mobile/src/screens/GroupChatScreen.tsx` 现有 `payload.agentRun` 分支**之前**插入：

```tsx
const askUser = (msg.payload as { kind?: string; askUser?: {
  runId: string; target: string; question: string; openedForAll?: boolean;
} } | null)?.askUser;
const isAskUser = (msg.payload as { kind?: string } | null)?.kind === 'agent_ask_user';
if (isAskUser && askUser) {
  return (
    <AskUserPromptCard
      key={msg.id}
      runId={askUser.runId}
      initial={{
        question: askUser.question,
        target: askUser.target,
        openedForAll: !!askUser.openedForAll,
      }}
    />
  );
}
```

并 `import { AskUserPromptCard } from '../features/agent/AskUserPromptCard';`。

### Step 4：mobile tsc 通过

- [ ] 跑：

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected：exit 0。如有 import 名不一致，按真实项目改。

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/features/agent/AskUserPromptCard.tsx apps/mobile/src/screens/GroupChatScreen.tsx
git commit -m "feat(agent/m7-t10): mobile AskUserPromptCard + GroupChatScreen 'agent_ask_user' branch"
```

---

# Part J：T11-T12 收尾

## T11：全量测试 + code review

**Files:** none

### Step 1：跑后端全量

- [ ] 跑：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run
```

Expected：全绿，~487 tests（基线 N0=~470 + 新增 17 = 487）。如某个 case flaky（如 `runtime.group.test.ts` FK race），单文件重跑一次确认。

### Step 2：mobile tsc

- [ ] 跑：

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected：exit 0。

### Step 3：手测清单（mobile §12.2）

- [ ] 启 dev server，按以下手动验证：
  1. 群里同一 owner 30s 内追问 → AgentRunCard 显示"·已合并 1 个追问"，群里仅多 1 条用户消息（无 AI placeholder 重复）
  2. 群里跨 owner 60s 后追问 → AgentRunCard 显示"排队中·前 1 个"
  3. 群里 agent 调 ask_user → 群里出现 `AskUserPromptCard`；非 owner 30s 内点不出输入框；30s 后输入框对所有成员可见
  4. 群里 agent 调 deep_research → 群里出现 2 张卡（父 + 子），点父卡 `deep_research` step 跳到子 run 详情
  5. 私聊任意 agent run → 完全不受影响

### Step 4：code-reviewer subagent 跑 diff

- [ ] 跑：

```bash
git diff main..HEAD --stat
```

记下变动文件数 + 行数，然后启动 code-reviewer subagent（任务："review diff main..HEAD against M7 spec `docs/superpowers/specs/2026-05-22-agent-runtime-m7-design.md`"）。

Expected：无 Critical / 无 Blocker。如有 Important，按需修正后再次提交（参考 M6 receiving-code-review skill）。

- [ ] **Step 5: 记录验收 checklist 完成**

```bash
git log --oneline main..HEAD | head -30
```

确认包含所有 T1-T10 commit。

---

## T12：合并 + tag

**Files:** none

### Step 1：merge main

- [ ] 跑：

```bash
git checkout main
git pull --ff-only
git merge --no-ff feat/agent-runtime-m7 -m "chore(agent): merge M7 (子项目 B 群聊 Agent 并发协调)"
```

> 如 merge 有 conflict，按 superpowers:finishing-a-development-branch skill 流程处理。

### Step 2：tag + push

- [ ] 跑：

```bash
git tag -a v0.m7 -m "v0.m7: 子项目 B 首期 - 群聊 Agent 并发协调
- 同 topic 自动合并 (同 owner 任意时间 / 跨 owner 30s)
- 跨窗口 queued + dequeue
- ask_user 群聊解禁 + 30s owner 独占
- deep_research 群聊子卡片
- 4 个新 hook + long-poll 推送"
```

- [ ] 用户决定是否 push（不主动 push）。

---

## 自审核对照（writing-plans skill §Self-Review）

完成所有 task 后，按以下 checklist 自查：

### 1. Spec 覆盖矩阵

| Spec 章节 | 实现 task | ✅ |
|---|---|---|
| §5 migration 020 | T1a | ✅ |
| §5 AgentRunStatus / StepKind 扩展 | T1b | ✅ |
| §5 AgentHookEvent 4 新事件 | T1d | ✅ |
| §5 mobile types 同步 | T1e | ✅ |
| §6 ask_user 群聊 handler | T6b | ✅ |
| §6 runExecute paused 分支扩 | T6c | ✅ |
| §6 canAnswerAskUser | T6d | ✅ |
| §6 autoOpenAskUserForAll worker checker | T6e | ✅ |
| §6 AskUserPromptCard | T10 | ✅ |
| §7 writeGroupChildPlaceholder | T7a | ✅ |
| §7 createAgentRun surfaceMode | T7b | ✅ |
| §7 deepResearch group routing | T7c | ✅ |
| §7 父卡 deep_research 跳转 | T9 | ✅ |
| §8.1 acquireTopicSlot | T2b | ✅ |
| §8.1 advisory_xact_lock | T2b（withTopicCoordination） | ✅ |
| §8.2 merge 分支 + applyMergeInTx | T2a + T3b | ✅ |
| §8.3 queue 分支 (status='queued') | T3b（initialStatus）| ✅ |
| §8.4 dequeueNextOnTopic | T4a | ✅ |
| §8.4 三出口接入 | T4b | ✅ |
| §9.3 P1 runExecute checkMergedInputs | T5a | ✅ |
| §9.3a P1a buildPlannerUserPrompt mergedInputs | T5b | ✅ |
| §9.4 P2 buildReplyMessages | T5c | ✅ |
| §9 P3 critique mergedInputs | T5d | ✅ |
| §9.5 P4 contextAdapter group | T5e | ✅ |
| §9.6 retry-once on MergeTargetTerminal | T2a + T3b（attempt 循环）| ✅ |
| §5 long-poll 订阅 4 新事件 | T8 | ✅ |
| §10 mobile UI 改动 | T9 + T10 | ✅ |
| §12 TB1-TB17 | T2 / T3 / T4 / T5 / T6 / T7 / T8 单测 + T11 整合 | ✅ |

### 2. Placeholder 扫描

- [ ] 全文搜：

```bash
grep -E "TBD|TODO|fill in|implement later|appropriate error handling" docs/superpowers/plans/2026-05-22-agent-runtime-m7.md
```

Expected：无 hits（或仅命中 spec 引用的 ADR / failureHint 字面字符串）。

### 3. 类型一致性

- 全文使用一致命名（核对几个易错点）：
  - `MergedInput`（types.ts）vs `MergedInput`（mobile types.ts）：字段对齐 `text/byUserId/byUsername/at` ✅
  - `withTopicCoordination(topicId, async (client) => ...)` 是群聊路径**强制**入口；`acquireTopicSlot` 群聊场景不传 `client` 抛错（契约保护，TB1 race test 覆盖）✅
  - `SlotDecision` 三态：`create_fresh / merge / queue`；intentExecute 在锁事务内分别走 `insertAgentRunInTx` / `applyMergeInTx` / `insertAgentRunInTx(status='queued')`；commit 后再调 `createAgentRun({ existingRun })` 完成 placeholder ✅
  - `applyMergeInTx(targetRunId, entry, client?)`：客户端持锁时复用同事务，并先 `SELECT ... FOR UPDATE` 锁目标 run 行（防同 run 并发写 step idx 冲突）✅
  - `MergeTargetTerminalError` 上层 retry-once；超过一次仍命中说明 DB 异常 ✅
  - `dequeueNextOnTopic` 接 `string | null`（safe-guard），早返回 null 时不报错 ✅
  - `surfaceMode` 取值 `'default' | 'child_card'`，全 plan 一致 ✅
  - `canAnswerAskUser` 与 `canAccessRun` 区分，前者用在 resume，后者用在 GET/cancel；**owner → 群成员 → target / openedForAll** 顺序判定，非群成员永远拒绝（含被错设为 target 的兜底，TB10b 覆盖）✅
  - `tokenFor(user)` 接 user 对象返回 `Promise<string>`（参考 `agent.longpoll.test.ts` L40），所有调用必须 `await tokenFor(user)` 而非传 `userId` ✅
  - `STATUS_LABEL`（mobile `AgentRunCard.tsx` L44）必须包含 `queued: '排队中'`，与 `AgentRunStatus` 类型穷尽匹配 ✅
  - mobile `AskUserPromptCard` import 路径：`./hooks/useAgentRunPoll` / `../../components/AuthGate` / `../../lib/appAlert`；`useAuth()` 返回 `{ user }`（不是 `{ userId }`）✅

---

（计划完成 → 可进入 `subagent-driven-development` 或 `executing-plans` 执行阶段）
