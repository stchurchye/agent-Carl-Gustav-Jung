# Agent Runtime M1b-3 Implementation Plan — Mobile UI + Hooks

> **本 plan 已根据 `m1b-completion.md`（2026-05-20）修订。**
> 关键变更：补 logHook 消费者 task / T16 SSE defer M1d 写死 / hooks 事件名与 spec §14 映射对齐 / 前后端 todo status 枚举对齐 / risky_echo 与 AC7 主路径解耦。
> 估时上调至 **6–10h**（不含 T16；含则 +4-6h）。

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。

**Goal:** 让 agent_run 在前端有体感——`IntentChipBar` 出 `让 agent 跑` 芯片、`intentFlow` 处理 `type: 'agent'` 结果、聊天里渲染 `AgentRunCard`（**M1b 用 polling，SSE/T16 defer M1d**，含 cancel / approve / deny / steer 按钮）。同时实现 `hooks.ts` 事件总线，把 agent 生命周期事件广播出去，**M1b-3 内置一个 `logHook` 消费者把事件写到 `clientLogs`**，为 M1c+ 的 webhook / Slack 通知打底。

**Architecture:**
- 前端：`features/agent/` 新建目录，含 `AgentRunCard.tsx / AgentTodoList.tsx / AgentSteerInput.tsx / hooks/useAgentRunSSE.ts / agentApi.ts`；`ChatMessageRow.tsx` / `GroupChatScreen.tsx` 嵌入 AgentRunCard（当 message.payload.agentRun 存在时）；`IntentChipBar.tsx` 增加 `agent_run` 芯片样式；`intentFlow.ts` / `applyIntentExecute.ts` 处理 `type: 'agent'` 不再走 LLM 而是订阅 SSE。
- 后端 hooks：`apps/api/src/lib/agent/hooks.ts` 简单 EventEmitter；runtime.ts 在关键点 `emit('run.started' | 'step.recorded' | 'run.completed' | 'run.failed' | 'run.cancelled')`；M1b-3 内部消费者：仅写一个 `logHook` 把事件转 `clientLog`（已有 `clientLogs` 表）。

**Tech Stack:** RN + Expo（已有），Hono SSE（已有），EventTarget / EventEmitter3 二选一（用 node:events 内置）。

**前置：** M1b-1 + M1b-2 合并完成。

**Spec：** §8（前端集成）、§16（hooks）

---

## File Structure

新建：

```
apps/mobile/src/features/agent/agentApi.ts
apps/mobile/src/features/agent/AgentRunCard.tsx
apps/mobile/src/features/agent/AgentTodoList.tsx
apps/mobile/src/features/agent/AgentStepList.tsx
apps/mobile/src/features/agent/AgentSteerInput.tsx
apps/mobile/src/features/agent/hooks/useAgentRunSSE.ts
apps/mobile/src/features/agent/types.ts

apps/api/src/lib/agent/hooks.ts
apps/api/src/lib/agent/__tests__/hooks.test.ts
```

修改：

```
apps/mobile/src/components/IntentChipBar.tsx              # 加 agent_run 视觉
apps/mobile/src/lib/intentFlow.ts                         # 处理 type:'agent'
apps/mobile/src/lib/applyIntentExecute.ts                 # 同上
apps/mobile/src/components/ChatMessageRow.tsx             # 渲染 AgentRunCard
apps/mobile/src/screens/GroupChatScreen.tsx               # 群聊位置渲染 AgentRunCard

apps/api/src/lib/agent/runtime.ts                         # 触发 hooks
apps/api/src/lib/agent/stepRecorder.ts                    # recordStep 时 emit step.recorded
README.md
```

---

## Pre-Task

```bash
git checkout feat/agent-runtime-m1b-2
git checkout -b feat/agent-runtime-m1b-3
pkill -f "tsx watch.*agent-Carl-Gustav-Jung" 2>/dev/null
set -a; source .env; set +a
npm run typecheck && npm run test -w @xzz/api  # baseline
```

---

## Task 1: Backend hooks.ts + 单元测试

**Files:**
- Create: `apps/api/src/lib/agent/hooks.ts`

### 1.1 实现

**事件名与 spec §14 对齐表**（M1b 实现子集，留 M1c 扩展）：

| 本 plan emit | spec §14 名 | M1b 是否触发 |
|------|-------|--------|
| `run.created` | run_created | M1c 加（M1a 已有 createAgentRun 但无 emit） |
| `run.started` | run_started | ✅ M1b |
| `run.completed` | run_completed | ✅ M1b |
| `run.failed` | run_failed | ✅ M1b |
| `run.cancelled` | run_cancelled | ✅ M1b |
| `run.budget_exhausted` | run_budget_exhausted | ✅ M1b |
| `step.recorded` | step_recorded | ✅ M1b |
| `pre_tool_use` | pre_tool_use | M1c |
| `post_tool_use` | post_tool_use | M1c |
| `approval_requested` | approval_requested | M1c（M1b 通过 `step.recorded` 间接监听） |

事件名用**点号风格**（`run.started`），M1c 引入新事件时也保持 `domain.event` 命名，方便后续过滤。

```typescript
import { EventEmitter } from 'events';
import type { AgentRun, AgentStep } from './types.js';

export type AgentHookEvent =
  | { type: 'run.started'; run: AgentRun }
  | { type: 'run.completed'; run: AgentRun }
  | { type: 'run.failed'; run: AgentRun; error: string }
  | { type: 'run.cancelled'; run: AgentRun; byUserId: string | null }
  | { type: 'run.budget_exhausted'; run: AgentRun; resource: string }
  | { type: 'step.recorded'; runId: string; step: AgentStep };

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

### 1.2 单元测试 `__tests__/hooks.test.ts`

```typescript
import { describe, expect, it } from 'vitest';
import { agentHookBus, type AgentHookEvent } from '../hooks.js';

describe('agentHookBus', () => {
  it('routes events to handlers', () => {
    const received: AgentHookEvent[] = [];
    const off = agentHookBus.onEvent((e) => received.push(e));
    agentHookBus.emitEvent({ type: 'run.completed', run: { id: 'r1' } as never });
    agentHookBus.emitEvent({ type: 'step.recorded', runId: 'r1', step: { id: 's1' } as never });
    off();
    agentHookBus.emitEvent({ type: 'run.completed', run: { id: 'r2' } as never });
    expect(received.length).toBe(2);
    expect(received[0].type).toBe('run.completed');
    expect(received[1].type).toBe('step.recorded');
  });
});
```

```bash
npm run test -w @xzz/api -- src/lib/agent/__tests__/hooks.test.ts
git add apps/api/src/lib/agent/hooks.ts apps/api/src/lib/agent/__tests__/hooks.test.ts
git commit -m "feat(agent): event bus hooks (run/step events)"
```

---

## Task 2: runtime.ts + stepRecorder.ts 嵌入 emit

**Files:**
- Modify: `apps/api/src/lib/agent/runtime.ts`
- Modify: `apps/api/src/lib/agent/stepRecorder.ts`

### 2.1 stepRecorder emit

在 `recordStep` 末尾、返回前：

```typescript
  const step = await store.insertStep({ ...input, idx: nextIdx });
  // emit
  const { agentHookBus } = await import('./hooks.js');
  agentHookBus.emitEvent({ type: 'step.recorded', runId: input.runId, step });
  return step;
```

### 2.2 runtime emit

在 `executeRun` 开头（status 切到 running 后）：

```typescript
agentHookBus.emitEvent({ type: 'run.started', run });
```

在 `softComplete` 中根据 status emit：

```typescript
import { agentHookBus } from './hooks.js';
// 末尾根据 status:
if (status === 'completed') agentHookBus.emitEvent({ type: 'run.completed', run: latest });
else if (status === 'failed') agentHookBus.emitEvent({ type: 'run.failed', run: latest, error: finalContent });
else if (status === 'cancelled') agentHookBus.emitEvent({ type: 'run.cancelled', run: latest, byUserId: latest.cancelledByUserId });
else if (status === 'budget_exhausted') agentHookBus.emitEvent({ type: 'run.budget_exhausted', run: latest, resource: latest.cancelReason ?? 'unknown' });
```

`latest` = 重新 `await store.getAgentRun(run.id)` 拿到带 endedAt 等终态字段的对象。

### 2.3 typecheck + commit

```bash
npm run typecheck
npm run test -w @xzz/api  # 既有测试不应回归
git add apps/api/src/lib/agent/runtime.ts apps/api/src/lib/agent/stepRecorder.ts
git commit -m "feat(agent): runtime emits run/step events"
```

---

## Task 2.5: logHook 消费者（订阅 hook bus → 写 clientLogs）

**Files:**
- Create: `apps/api/src/lib/agent/logHook.ts`
- Create: `apps/api/src/lib/agent/__tests__/logHook.test.ts`
- Modify: `apps/api/src/index.ts`（启动时 `registerLogHook()`）

### 2.5.1 实现

```typescript
import { agentHookBus, type AgentHookEvent } from './hooks.js';
import { getPool } from '../../db/client.js';

let unsub: (() => void) | null = null;

/**
 * 订阅 agent 事件,把每个事件序列化写到 client_logs(或类似表)。
 * M1b-3 简化:用现有 client_logs 表(grep schema 确认表名)。
 * M1c+ 可扩展:按事件类型路由到 webhook / Slack / 文件归档。
 */
export function registerLogHook(): void {
  if (unsub) return;
  unsub = agentHookBus.onEvent(async (e: AgentHookEvent) => {
    try {
      await getPool().query(
        `INSERT INTO client_logs (id, user_id, level, message, payload, created_at)
         VALUES (gen_random_uuid()::text, $1, 'info', $2, $3::jsonb, now())`,
        [
          (e as any).run?.ownerId ?? null,
          `agent.${e.type}`,
          JSON.stringify(serializeEvent(e)),
        ],
      );
    } catch (err) {
      // 不能让 hook 失败影响主流程
      console.error('[agent logHook] insert failed', err);
    }
  });
}

export function unregisterLogHook(): void {
  unsub?.();
  unsub = null;
}

function serializeEvent(e: AgentHookEvent): unknown {
  switch (e.type) {
    case 'step.recorded':
      return { runId: e.runId, step: { idx: e.step.idx, kind: e.step.kind, toolName: e.step.toolName } };
    case 'run.failed': return { runId: e.run.id, error: e.error };
    case 'run.cancelled': return { runId: e.run.id, byUserId: e.byUserId };
    case 'run.budget_exhausted': return { runId: e.run.id, resource: e.resource };
    default: return { runId: e.run.id, status: e.run.status };
  }
}
```

**注意：** `client_logs` 表名 / 列名按真实 schema 改（grep `apps/api/src/db/migrations/*.sql` 找 client_logs 或 llm_request_log）。若没有合适的表，**也可写到 stdout/winston**，但 plan 测试要求"事件落表"，最少要找一张表（hint：`010_client_logs.sql`、`011_llm_request_log.sql` 之类）。

### 2.5.2 单元测试

```typescript
import { describe, expect, it, beforeAll, beforeEach, afterEach } from 'vitest';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import { agentHookBus } from '../hooks.js';
import { registerLogHook, unregisterLogHook } from '../logHook.js';

describe('logHook', () => {
  beforeAll(async () => { await runMigrations(); });
  beforeEach(async () => {
    await getPool().query(`DELETE FROM client_logs WHERE message LIKE 'agent.%'`);
    registerLogHook();
  });
  afterEach(() => unregisterLogHook());

  it('persists run.completed event', async () => {
    agentHookBus.emitEvent({
      type: 'run.completed',
      run: { id: 'r-test', ownerId: 'u-test', status: 'completed' } as never,
    });
    // 写入是 async,等一下
    await new Promise((r) => setTimeout(r, 200));
    const { rows } = await getPool().query(
      `SELECT message, payload FROM client_logs WHERE message = 'agent.run.completed' ORDER BY created_at DESC LIMIT 1`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0].payload?.runId).toBe('r-test');
  });
});
```

### 2.5.3 启动时注册

`apps/api/src/index.ts` 在 `startAgentWorker()` 旁边加：

```typescript
import { registerLogHook } from './lib/agent/logHook.js';
// ...
registerLogHook();
```

```bash
set -a; source .env; set +a
npm run test -w @xzz/api -- src/lib/agent/__tests__/logHook.test.ts
git add apps/api/src/lib/agent/logHook.ts apps/api/src/lib/agent/__tests__/logHook.test.ts apps/api/src/index.ts
git commit -m "feat(agent): logHook consumer (writes events to client_logs)"
```

---

## Task 3: 前端 agentApi.ts + types

**Files:**
- Create: `apps/mobile/src/features/agent/types.ts`
- Create: `apps/mobile/src/features/agent/agentApi.ts`

### 3.1 types.ts

参照后端 `AgentRun` / `AgentStep` 字段，定义前端用 type。可以从 `@xzz/shared` 导出（如果后端类型已在 shared）；否则就在前端复制最小子集。**优先策略**：把 spec §4 的 `AgentRun / AgentStep / Plan / TodoItem` 移到 `packages/shared/src/agent.ts` 并 re-export，前后端共享。

```typescript
// 简化做法:不动后端,前端定义结构最小子集
export type AgentRunStatus =
  | 'draft' | 'awaiting_confirm' | 'planning' | 'running'
  | 'awaiting_approval' | 'replanning'
  | 'completed' | 'failed' | 'cancelled' | 'budget_exhausted';

export type AgentStepKind =
  | 'plan' | 'tool_call' | 'tool_error' | 'observe'
  | 'critique' | 'reply' | 'steer'
  | 'approval_request' | 'approval_grant' | 'approval_deny' | 'approval_timeout';

export type AgentStep = {
  id: string;
  runId: string;
  idx: number;
  kind: AgentStepKind;
  toolName: string | null;
  input: unknown;
  output: unknown;
  error: string | null;
  byUserId: string | null;
  createdAt: string;
};

/**
 * Todo status + stepRefs: 必须与后端 types.ts TodoItem 精确对齐。
 *
 * 实际后端（M1a 已落地，勿改）：
 *   TodoStatus = 'pending' | 'in_progress' | 'completed' | 'skipped' | 'failed'
 *   stepRefs: string[]  （UUID 字符串，不是数字索引）
 *
 * 两处历史错误已在此修正：
 *   ❌ 前版本缺少 'failed'
 *   ❌ 前版本 stepRefs: number[]
 */
export type AgentTodo = {
  id: string;
  text: string;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped' | 'failed';
  stepRefs: string[];
};

export type AgentRun = {
  id: string;
  ownerId: string;
  channel: 'private' | 'group';
  status: AgentRunStatus;
  inputText: string;
  todos: AgentTodo[];
  pendingApprovalToolName: string | null;
  awaitingApprovalUntil: string | null;
};
```

### 3.2 agentApi.ts

```typescript
import { request } from '../../lib/apiRequest';
import type { AgentRun, AgentStep } from './types';

export async function getAgentRun(id: string): Promise<AgentRun> {
  return request(`/api/agent/runs/${id}`, { method: 'GET' });
}
export async function cancelAgentRun(id: string): Promise<void> {
  return request(`/api/agent/runs/${id}/cancel`, { method: 'POST' });
}
export async function approveAgentRun(id: string): Promise<void> {
  return request(`/api/agent/runs/${id}/approve`, { method: 'POST' });
}
export async function denyAgentRun(id: string, reason?: string): Promise<void> {
  return request(`/api/agent/runs/${id}/deny`, {
    method: 'POST', body: JSON.stringify({ reason }),
  });
}
export async function steerAgentRun(id: string, instruction: string): Promise<void> {
  return request(`/api/agent/runs/${id}/steer`, {
    method: 'POST', body: JSON.stringify({ instruction }),
  });
}
```

注意 `request` 的真实签名 — grep `apps/mobile/src/lib/apiRequest.ts` 确认调用方式（可能是 `(path, opts) => Promise<{data}>` 或 `apiRequest(...)`）。按真实调整。

Commit：

```bash
git add apps/mobile/src/features/agent/types.ts apps/mobile/src/features/agent/agentApi.ts
git commit -m "feat(mobile): agent api client + types"
```

---

## Task 4: useAgentRunPoll hook（T16 SSE defer M1d）

**Files:**
- Create: `apps/mobile/src/features/agent/hooks/useAgentRunPoll.ts`（名字不再叫 SSE，避免误导）

> **架构决策（写入 `m1b-completion.md` ADR-5）：M1b 用 polling fallback，不走 `/runs/:id/stream` SSE。T16（SSE 断线重连）defer 到 M1d。**
>
> Spec §19 在 M1b 收尾时同步把 T16 标 M1d，本 plan Task 8 README 写明。
>
> 还需要也 export `agentApi.listSteps(runId)`：M1b 简化版直接复用 polling 一并查 steps；若没有专门 endpoint，可在 `GET /api/agent/runs/:id` 里返回 `{ run, steps }`（**M1b-1 Task 4 已经统一了 GET handler，可顺手补**）。

### 4.1 实现

```typescript
import { useEffect, useState } from 'react';
import { getAgentRun } from '../agentApi';
import type { AgentRun, AgentStep } from '../types';

const POLL_INTERVAL_MS = 1500;

export function useAgentRunPoll(runId: string | null) {
  const [run, setRun] = useState<AgentRun | null>(null);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!runId) return;
    let stopped = false;
    async function poll() {
      setConnected(true);
      while (!stopped) {
        try {
          // 后端 GET /api/agent/runs/:id 返回 { run, steps }(M1b-1 Task 4 已统一)
          const res = await getAgentRun(runId);
          if (stopped) break;
          if ((res as any).run) {
            setRun((res as any).run);
            setSteps((res as any).steps ?? []);
          } else {
            setRun(res as AgentRun);
          }
          const status = ((res as any).run ?? res).status;
          if (['completed', 'failed', 'cancelled', 'budget_exhausted'].includes(status)) break;
        } catch (e) {
          // ignore;下轮重试
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
      if (!stopped) setConnected(false);
    }
    poll();
    return () => { stopped = true; };
  }, [runId]);

  return { run, steps, connected };
}
```

### 4.2 AgentRunCard 改用 useAgentRunPoll

在 Task 5.4 的 `AgentRunCard.tsx` 中：

```typescript
// 把 import { useAgentRunSSE } from './hooks/useAgentRunSSE';
// 改成:
import { useAgentRunPoll as useAgentRunSubscription } from './hooks/useAgentRunPoll';
```

> 用 alias `useAgentRunSubscription` 是因为 M1d 升级到 SSE 时只改一行 import，不动 card。

```bash
git add apps/mobile/src/features/agent/hooks/useAgentRunPoll.ts
git commit -m "feat(mobile): useAgentRunPoll (M1b polling; SSE defer M1d)"
```

---

## Task 5: AgentRunCard + AgentTodoList + AgentStepList + AgentSteerInput

**Files:**
- Create: 4 个 tsx 文件

### 5.1 AgentTodoList.tsx（纯展示）

```tsx
import React from 'react';
import { View, Text } from 'react-native';
import type { AgentTodo } from './types';

export function AgentTodoList({ todos }: { todos: AgentTodo[] }) {
  return (
    <View>
      {todos.map((t) => (
        <View key={t.id} style={{ flexDirection: 'row', paddingVertical: 4 }}>
          <Text>{t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '▷' : t.status === 'skipped' ? '–' : t.status === 'failed' ? '✗' : '○'}</Text>
          <Text style={{ marginLeft: 8, opacity: ['completed', 'skipped', 'failed'].includes(t.status) ? 0.5 : 1, color: t.status === 'failed' ? '#c33' : undefined }}>{t.text}</Text>
        </View>
      ))}
    </View>
  );
}
```

### 5.2 AgentStepList.tsx

```tsx
import React from 'react';
import { ScrollView, View, Text } from 'react-native';
import type { AgentStep } from './types';

export function AgentStepList({ steps }: { steps: AgentStep[] }) {
  return (
    <ScrollView style={{ maxHeight: 200 }}>
      {steps.map((s) => (
        <View key={s.id} style={{ paddingVertical: 2 }}>
          <Text style={{ fontSize: 12, opacity: 0.6 }}>
            #{s.idx} {s.kind}{s.toolName ? ` (${s.toolName})` : ''}
          </Text>
          {s.error ? <Text style={{ fontSize: 11, color: '#c33' }}>{s.error}</Text> : null}
        </View>
      ))}
    </ScrollView>
  );
}
```

### 5.3 AgentSteerInput.tsx

```tsx
import React, { useState } from 'react';
import { View, TextInput, TouchableOpacity, Text } from 'react-native';

export function AgentSteerInput({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [text, setText] = useState('');
  return (
    <View style={{ flexDirection: 'row', marginTop: 8 }}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="发送指令调整 agent 行为..."
        style={{ flex: 1, borderWidth: 1, borderColor: '#ccc', padding: 6, borderRadius: 6 }}
      />
      <TouchableOpacity
        onPress={() => { if (text.trim()) { onSubmit(text.trim()); setText(''); } }}
        style={{ marginLeft: 6, padding: 8, backgroundColor: '#456', borderRadius: 6 }}
      >
        <Text style={{ color: '#fff' }}>steer</Text>
      </TouchableOpacity>
    </View>
  );
}
```

### 5.4 AgentRunCard.tsx（主壳）

```tsx
import React from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { useAgentRunPoll as useAgentRunSubscription } from './hooks/useAgentRunPoll';
import {
  cancelAgentRun, approveAgentRun, denyAgentRun, steerAgentRun,
} from './agentApi';
import { AgentTodoList } from './AgentTodoList';
import { AgentStepList } from './AgentStepList';
import { AgentSteerInput } from './AgentSteerInput';

export function AgentRunCard({ runId }: { runId: string }) {
  const { run, steps, connected } = useAgentRunSubscription(runId);
  if (!run) return <Text>加载 agent run…</Text>;
  // 注意: 'replanning' / 'awaiting_approval' 非终态,仍可 cancel/steer
  const terminal = ['completed', 'failed', 'cancelled', 'budget_exhausted'].includes(run.status);
  const awaitingApproval = run.status === 'awaiting_approval';

  return (
    <View style={{
      padding: 10, borderRadius: 8, marginVertical: 6,
      backgroundColor: terminal ? '#f4f4f4' : '#eef4ff',
    }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ fontWeight: '600' }}>
          Agent {run.status}{connected ? ' · live' : ''}
        </Text>
        {!terminal ? (
          <TouchableOpacity onPress={() => cancelAgentRun(runId).catch(() => {})}>
            <Text style={{ color: '#c33' }}>取消</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <Text style={{ fontSize: 12, opacity: 0.6 }} numberOfLines={2}>
        {run.inputText}
      </Text>

      <View style={{ marginTop: 8 }}><AgentTodoList todos={run.todos ?? []} /></View>

      {awaitingApproval ? (
        <View style={{ flexDirection: 'row', marginTop: 8 }}>
          <Text style={{ flex: 1 }}>等待授权工具：{run.pendingApprovalToolName}</Text>
          <TouchableOpacity onPress={() => approveAgentRun(runId)}>
            <Text style={{ color: '#393' }}>同意</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => denyAgentRun(runId)} style={{ marginLeft: 12 }}>
            <Text style={{ color: '#c33' }}>拒绝</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={{ marginTop: 8 }}>
        <AgentStepList steps={steps} />
      </View>

      {!terminal ? (
        <AgentSteerInput
          onSubmit={(text) => steerAgentRun(runId, text).catch((e) => Alert.alert('steer 失败', String(e)))}
        />
      ) : null}
    </View>
  );
}
```

Commit：

```bash
git add apps/mobile/src/features/agent/
git commit -m "feat(mobile): AgentRunCard + Todo/Step/Steer components"
```

---

## Task 6: IntentChipBar + intentFlow + applyIntentExecute 接入

**Files:**
- Modify: `apps/mobile/src/components/IntentChipBar.tsx`
- Modify: `apps/mobile/src/lib/intentFlow.ts`
- Modify: `apps/mobile/src/lib/applyIntentExecute.ts`

### 6.1 IntentChipBar 视觉

打开文件，找到根据 `candidate.kind` 渲染样式的 switch / map。加 `agent_run` 分支：

```typescript
case 'agent_run':
  return { label: candidate.label || '让 agent 跑', emoji: '🤖', color: '#5a6cff' };
```

如果文件结构是其他形式（按 group/primary 分组等），按真实结构改。grep `IntentChipBar.tsx` 看现有：

```bash
grep -n "case '" apps/mobile/src/components/IntentChipBar.tsx | head -20
```

### 6.2 intentFlow.ts / applyIntentExecute.ts 处理 `type: 'agent'`

**字段约定（与 M1b-1 messageBridge 必须一致）：**
- 私聊 placeholder：`private_chat_messages.payload.agentRun = { agentRunId, status }`
- 群聊 placeholderAi：`group_messages.payload.agentRun = { agentRunId, status, llmJobId }`

如果实现时发现 M1b-1 真实字段名不是 `agentRun`（如改成 `agent_run` 或 `agentRunMeta`），**两边一起改并补 grep 检查**：

```bash
grep -rn "payload?.agentRun\|payload\.agentRun\|'agentRun'" apps/api/src apps/mobile/src
```

grep 找当前 switch：

```bash
grep -n "type === " apps/mobile/src/lib/applyIntentExecute.ts apps/mobile/src/lib/intentFlow.ts | head
```

找到处理 `type: 'private_chat'` / `type: 'group_chat'` 等的位置，加一个 case：

```typescript
if (result.type === 'agent') {
  // result = { type: 'agent', runId, userMessageId, placeholderMessageId }
  // 不发 LLM 请求,聊天 UI 会通过 placeholderMessageId 上 payload.agentRun.agentRunId
  // 自动渲染 AgentRunCard。这里只需要 refresh messages。
  await refetchMessages?.();
  return;
}
```

### 6.3 ChatMessageRow.tsx：渲染 AgentRunCard

打开 `ChatMessageRow.tsx`，找到 message 渲染主体。在最外层加判断：

```tsx
const agentRunId = message.payload?.agentRun?.agentRunId as string | undefined;
if (agentRunId) {
  return (
    <View>
      <AgentRunCard runId={agentRunId} />
    </View>
  );
}
// 否则走原逻辑
```

import：`import { AgentRunCard } from '../features/agent/AgentRunCard';`

### 6.4 GroupChatScreen.tsx：群聊消息也同样判断

群聊 message row 通常在 `GroupChatScreen.tsx` 内联或单独 row 组件中。grep：

```bash
grep -rn "agentRun\|payload?.agentRun" apps/mobile/src 2>/dev/null
grep -n "renderItem\|MessageRow" apps/mobile/src/screens/GroupChatScreen.tsx | head
```

同样加 `agentRun` 判断 → 渲染 AgentRunCard。

Commit：

```bash
git add apps/mobile/src/components/IntentChipBar.tsx apps/mobile/src/lib/intentFlow.ts \
  apps/mobile/src/lib/applyIntentExecute.ts apps/mobile/src/components/ChatMessageRow.tsx \
  apps/mobile/src/screens/GroupChatScreen.tsx
git commit -m "feat(mobile): IntentChipBar agent chip + AgentRunCard in chat rows"
```

---

## Task 7: 整体验证

### 7.1 Type + test

```bash
set -a; source .env; set +a
pkill -f "tsx watch.*agent-Carl-Gustav-Jung" 2>/dev/null
npm run typecheck
npm run test -w @xzz/api
npm run test -w @xzz/shared
```

Expected：全 PASS（无 mobile 单测，仅 typecheck 验前端）。

### 7.2 手工验收清单（可选实跑）

在 README 顶部 dev 启动指引下：

```bash
# 1) docker-compose up -d
# 2) cd apps/api && npm run dev   # 注意:跑测试前要关闭
# 3) cd apps/mobile && npm run start
# 4) 私聊场景:发 "/agent 跑三步 echo" → 应该看到 AgentRunCard 出现 + step 实时刷新 + 终态变 completed
# 5) 群聊同理
# 6) 当 risky_echo 工具激活时(目前仅测试环境注册),应能看到 "等待授权" + 同意/拒绝按钮
```

### 7.3 README 更新

```markdown
## Agent Runtime M1b-3（Mobile + Hooks）

### 前端
- `features/agent/`:
  - `AgentRunCard` 嵌入聊天消息行(私聊 + 群聊),渲染当前 agent run 实时状态
  - `AgentTodoList` 显示 plan 拆出来的待办
  - `AgentStepList` 显示已执行的 step
  - `AgentSteerInput` 输入 steer 指令
  - `useAgentRunSSE` (M1b-3 实现为 polling fallback,M1d 升级 SSE)
- `IntentChipBar` 加 agent_run 芯片(🤖 让 agent 跑)
- `intentFlow / applyIntentExecute` 处理 `type:'agent'` 结果,不发 LLM 请求

### 后端
- `agentHookBus`: 简单 EventEmitter,广播 run.started/completed/failed/cancelled/budget_exhausted + step.recorded
- runtime/stepRecorder 内置触发点
- M1c+ 消费者:webhook / Slack 通知 / 归档(留作未来)
```

```bash
git add README.md
git commit -m "docs: M1b-3 mobile + hooks"
```

---

## 验收清单（对照 Spec §18.2 + m1b-completion §1）

- [ ] **AC7**（mobile AgentRunCard 在聊天中可看每步 / 私聊 + 群聊都打开不 403）— Tasks 4+5+6
- [ ] **AC2 视觉部分**（cancel 按钮）— Task 5
- [ ] **AC3 视觉部分**（approval 按钮 + awaiting_approval 显示）— Task 5
- [ ] **AC4 视觉部分**（steer 输入）— Task 5
- [ ] hooks.ts 完成 + logHook 消费者 — Tasks 1+2+2.5
- [ ] **T16 SSE 断线重连** — **defer M1d**（本 plan 不验收，写入 README + spec §19）

## 手工验收（README 章节）

1. 私聊：发 `/agent 跑三步 echo` → AgentRunCard 出现 + todos 倒计时 + 完成态变 `[已完成 3 次 echo]`
2. 群聊：A 群里发 `/agent 跑三步 echo` → 同上；B 用户（同群）打开 chat 不 403、可看 card
3. Steer：在跑 5 步 echo 时，输入框发"改成跑两步" → card 上 plan version 变 2、剩余跑完
4. Approval（**需要 NODE_ENV=test 或手工注册 riskyEcho**）：跑一个 risky 计划 → 看到"同意/拒绝"按钮 + 60s 倒计时
5. 任务完成后检查 `client_logs WHERE message LIKE 'agent.%'` 有事件流

---

## Self-Review

**Spec 覆盖**：M1b spec §18.2 AC7 + hooks.ts 完成 + logHook 落地。AC1-AC6 的视觉部分在卡片里都有入口。

**Placeholder 扫描**：
- `useAgentRunPoll` 写死 1.5s 间隔，注释指引 M1d 升级到 SSE 时只换 import
- `request / apiRequest` / `API_BASE_URL` 真实导出 implementer grep 校准
- `client_logs` 表名 implementer grep schema 确认；若实际是 `llm_request_log` 或其他，相应调整

**类型一致性**：
- 前端 `AgentTodo.status` 用 `'completed'` 与后端 M1a planner 输出对齐（不是 `'done'`）
- `AgentRunStatus` 包含 `'replanning'`，非终态时仍渲染 steer 输入
- 前端 types.ts 是后端类型最小子集；M1c 可考虑迁到 `packages/shared/src/agent.ts` 共享

**已知 M1b-3 简化项（M1d hardening）**：
1. polling 替代 SSE → T16
2. AgentSteerInput / 按钮在 `awaiting_approval` / `replanning` 状态的禁用 UX 待打磨
3. ChatMessageRow.tsx 改动按真实结构最小入侵

---

## 修订记录

**2026-05-20 v2**（response to review）：
- 加 Task 2.5：logHook 消费者（写 client_logs；spec §16 hooks.ts "完成"条目）
- hook 事件名与 spec §14 加映射表
- `useAgentRunSSE` → `useAgentRunPoll`（写死 polling；T16 defer M1d，写入 m1b-completion + spec §19）
- AgentRunCard 用 alias import 让 M1d 升级 SSE 时单点修改
- 前端 `AgentTodo.status` 改为 `'completed'`（与后端枚举对齐）
- AgentRunCard / ChatMessageRow 显式说明 `payload.agentRun.agentRunId` 字段与 M1b-1 一致
- 加群聊手工验收：B 用户打开 card 不 403（依赖 M1b-1 Task 4 放权）
- 估时 5h → **6–10h**（不含 T16）

---

Plan complete and saved to `docs/superpowers/plans/2026-05-20-agent-runtime-m1b-3.md`.

---

## 全部 M1b 完成后的总收尾

三个 plan 都跑完后：

```bash
git checkout main
git merge --no-ff feat/agent-runtime-m1b-1
git merge --no-ff feat/agent-runtime-m1b-2
git merge --no-ff feat/agent-runtime-m1b-3
git tag v0.m1b
```

下一阶段：**M1c**（第一个真 Agent — webSearch / urlFetch / docExportMarkdown / magiSystemRead / magiContentIngest + LLM planner + LLM critique）。
