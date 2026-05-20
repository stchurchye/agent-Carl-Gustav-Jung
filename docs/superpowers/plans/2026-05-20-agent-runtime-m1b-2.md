# Agent Runtime M1b-2 Implementation Plan — Approval + Steer + Critique

> **本 plan 已根据 `m1b-completion.md`（2026-05-20）重大修订。**
> 关键架构变更：**Approval 改为 spec-aligned 让出模型**（executeRun 不阻塞；timeout checker + approve/deny route 触发 worker re-pickup）；**Deny → `replanning`**（不是 cancelled）；**Steer abort 当前 step + replanning**。详见 ADR-1/2/3。
> 估时上调至 **10–14h**。

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。

**Goal:** 让 runtime 支持三种"运行中可干预"能力（全部对齐 spec §12/§14/§15）：
- (a) `approvalMode='ask'` 工具调用前：写 `approval_request` step、切 `awaiting_approval`、设 `awaiting_approval_until = now()+60s`、**executeRun 立即 return**。三条恢复路径：HTTP `/approve` → `running` + enqueue；HTTP `/deny` → `replanning` + enqueue；timeout checker（5s 周期）按 `costHint` 自动 grant/deny。
- (b) 用户中途发 steer 指令：abort 当前 step controller、status 切 `replanning`、写新 plan、worker re-pickup 进 planner 路径。
- (c) critique 自我检查：每 5 步或连续失败 2 次插入；M1b 用规则 stub，接口与 spec §9.4 一致供 M1c LLM 接入。

**Architecture:**
- `runtimeRegistry.ts`（新）：进程内 `Map<runId, AbortController>`，供 `steer.ts` import 触发 abort（fix 原 plan 的 `Object.assign(Map)` 死代码）。
- `approval.ts`：纯 store 层，导出 `approveRun / denyRun / autoResolveExpiredApprovals(now)`；**无 polling loop**。
- `steer.ts`：写新 plan + abort controller + 状态置 `replanning`。
- `worker.ts`：tick 内增加 `autoResolveExpiredApprovals(now)` 扫描；同时把 `pickupNextRun` 的 status 条件从 `'draft'/'running'` 扩到 **`'replanning'` 也 pickup**。
- `runtime.ts`：approval gate 改为"写 step + 切状态 + return"；新增 `replanning` 分支调 planner(reason='steer'|'approval_deny')；catch `AgentCancelled('steer')` 不 softFail。

**Tech Stack:** 同前。无新依赖。

**前置：** M1b-1 已合并。echo 工具默认 `approvalMode='auto'` 不触发 approval；测试用 `riskyEcho` 走 `'ask'` 路径。

**Spec：** §6.2（状态机）、§9.4（critique）、§12（approval 状态机）、§14（hook 事件，本 plan 不实现 emit，留 M1b-3）、§15（steer + deny → replanning）

**与 spec 的差异表（self-review 用）：**

| 主题 | Spec | M1b-2 实现 | 差异说明 |
|------|------|----------|---------|
| Approval 等待 | §12 让出 + checker | 同上 | 1:1 对齐 |
| Deny | §15.3 → `replanning` | 同上 | 1:1 对齐 |
| Steer | §15.2 abort + `replanning` | 同上 | 1:1 对齐 |
| critique | §9.4 LLM | 规则 stub | M1c 升级，接口签名 1:1 |
| `approval_timeout` step kind | spec 未明确列 | **新加 enum 值** + db migration 增 `cancelReason` 允许列表（如需校验） | 已写测试，§19 未覆盖 timeout step kind |

---

## File Structure

新建：

```
apps/api/src/lib/agent/runtimeRegistry.ts         # 进程内 runControllers Map(供 steer.ts abort)
apps/api/src/lib/agent/approval.ts                # approveRun / denyRun / autoResolveExpiredApprovals
apps/api/src/lib/agent/critique.ts                # 规则化 critique stub
apps/api/src/lib/agent/steer.ts                   # steerRun(abort + 写新 plan + 'replanning')
apps/api/src/lib/agent/tools/riskyEcho.ts         # approvalMode='ask' 测试工具

apps/api/src/lib/agent/__tests__/approval.test.ts             # 单元 + 自动 timeout
apps/api/src/lib/agent/__tests__/critique.test.ts
apps/api/src/lib/agent/__tests__/steer.test.ts                # 含 abort 行为
apps/api/src/lib/agent/__tests__/runtime.approval.test.ts     # e2e: approve → resume / deny → replan / timeout-auto
apps/api/src/lib/agent/__tests__/runtime.steer.test.ts        # T11: abort + replan + 剩余 step 数对齐
apps/api/src/lib/agent/__tests__/worker.timeoutChecker.test.ts # 单元
```

修改：

```
apps/api/src/lib/agent/runtime.ts                 # approval gate 改让出;steer cancel reason 不 softFail;replanning 分支调 planner
apps/api/src/lib/agent/store.ts                   # pickupNextRun 加 'replanning' status
apps/api/src/lib/agent/worker.ts                  # tick 加 autoResolveExpiredApprovals
apps/api/src/lib/agent/planner.ts                 # 加 generatePlanForSteer + generatePlanForApprovalDeny
apps/api/src/lib/agent/types.ts                   # AgentStepKind 加 'approval_timeout';AgentCancelled.reason 加 'steer'
apps/api/src/routes/agent.ts                      # /runs/:id/approve, /deny, /steer
apps/api/src/index.ts                             # registerRiskyEcho (仅 NODE_ENV=test)
```

---

## Pre-Task

```bash
git checkout feat/agent-runtime-m1b-1  # 假设 m1b-1 已合并到这个分支或 main
git checkout -b feat/agent-runtime-m1b-2
pkill -f "tsx watch.*行动中止派" 2>/dev/null; sleep 2
set -a; source .env; set +a
npm run typecheck && npm run test -w @xzz/api  # baseline green
```

---

## Task 1: `riskyEcho` 工具 + 测试

**Files:**
- Create: `apps/api/src/lib/agent/tools/riskyEcho.ts`

参照 `echoSleep.ts`，复制并改 `approvalMode: 'ask'`，`costHint: 'medium'`，`name: 'risky_echo'`。这样测试时可在不写真工具的前提下验证 approval。

```typescript
import { toolRegistry, type ToolDef } from '../toolRegistry.js';

type In = { text: string; sleepMs?: number };
type Out = { text: string; sleptMs: number };

export const riskyEchoTool: ToolDef<In, Out> = {
  name: 'risky_echo',
  description: '需要用户确认的 echo,用于测试 approval 流程',
  inputSchema: {
    type: 'object', required: ['text'],
    properties: {
      text: { type: 'string' },
      sleepMs: { type: 'number', minimum: 0, maximum: 30_000 },
    },
  },
  approvalMode: 'ask',
  costHint: 'medium',
  hasSideEffects: true,
  idempotent: false,
  async handler(input, ctx) {
    const ms = Math.max(0, Math.min(input.sleepMs ?? 500, 30_000));
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      ctx.signal.addEventListener('abort', () => {
        clearTimeout(t); reject(new Error('aborted'));
      }, { once: true });
    });
    return { text: input.text, sleptMs: ms };
  },
};

export function registerRiskyEcho(): void {
  if (!toolRegistry.get(riskyEchoTool.name)) toolRegistry.register(riskyEchoTool);
}
```

Commit：

```bash
git add apps/api/src/lib/agent/tools/riskyEcho.ts
git commit -m "feat(agent): add riskyEcho test tool (approvalMode=ask)"
```

---

## Task 2: `approval.ts`（让出模型）+ 单元测试

**Files:**
- Create: `apps/api/src/lib/agent/approval.ts`
- Create: `apps/api/src/lib/agent/__tests__/approval.test.ts`

### 2.1 设计（ADR-1）

approval 不在 runtime 循环里阻塞。runtime 写完 `approval_request` step、把 run 状态置 `awaiting_approval` 后**立即 return**。三条触发恢复的路径：

1. **HTTP `/approve`** → `approveRun(runId, userId)`：状态 `awaiting_approval` → `running`、清 awaiting 字段、写 `approval_grant` step、enqueue。
2. **HTTP `/deny`** → `denyRun(runId, userId, reason)`：状态 → `replanning`、清 awaiting 字段、写 `approval_deny` step（含 byUserId/reason）、enqueue。**不进 cancelled。**
3. **Timeout checker**（worker tick 5s 周期）→ `autoResolveExpiredApprovals(now)`：扫 `awaiting_approval_until < now`，按 `costHint` 分流：
   - `low` → 等价 approveRun（byUserId='system', step.reason='auto-low-cost'）
   - 其他 → 等价 denyRun（byUserId='system', step.reason='auto-timeout-deny'）

`enqueue` 在 M1b-2 简化版：直接 `await store.updateAgentRun(runId, { lastHeartbeatAt: null })` 让 pickup SQL 把它当待捡（`last_heartbeat_at IS NULL` 命中 pickup 条件，已在 Task 5.1 确认）。无需额外字段。

### 2.2 实现

```typescript
import * as store from './store.js';
import { getPool } from '../../db/client.js';   // ⚠️ store.ts 不 export getPool，直接用 client
import { recordStep } from './stepRecorder.js';
import type { ToolDef } from './toolRegistry.js';

/**
 * 用户同意 awaiting_approval 状态的 run。
 * 状态切回 'running' 并清空 awaiting 字段;写 approval_grant step。
 */
export async function approveRun(
  runId: string,
  byUserId: string,
  reason: string = 'manual',
): Promise<boolean> {
  const run = await store.getAgentRun(runId);
  if (!run || run.status !== 'awaiting_approval') return false;
  await store.updateAgentRun(runId, {
    status: 'running',
    awaitingApprovalUntil: null,
    awaitingApprovalStepIdx: null,
    pendingApprovalToolName: null,
    lastHeartbeatAt: null,  // 让 worker pickup
  });
  await recordStep({
    runId, kind: 'approval_grant',
    toolName: run.pendingApprovalToolName ?? null,
    byUserId,
    output: { reason },
  });
  return true;
}

/**
 * 用户拒绝。状态 → 'replanning' (不是 cancelled),让 worker 用 planner reason='approval_deny' 重规划。
 */
export async function denyRun(
  runId: string,
  byUserId: string,
  reason: string = 'manual',
): Promise<boolean> {
  const run = await store.getAgentRun(runId);
  if (!run || run.status !== 'awaiting_approval') return false;
  await store.updateAgentRun(runId, {
    status: 'replanning',
    awaitingApprovalUntil: null,
    awaitingApprovalStepIdx: null,
    pendingApprovalToolName: null,
    lastHeartbeatAt: null,
  });
  await recordStep({
    runId, kind: 'approval_deny',
    toolName: run.pendingApprovalToolName ?? null,
    byUserId,
    output: { reason },
  });
  return true;
}

/**
 * 由 worker.ts tick 周期调用(每 5s)。扫所有过期 awaiting_approval,按 costHint 自动分流。
 * 返回 resolve 的 run 数(供观测)。
 */
export async function autoResolveExpiredApprovals(now: Date = new Date()): Promise<number> {
  const { rows } = await getPool().query(  // store.ts 不导出 getPool，直接用 client.ts
    `SELECT id, pending_approval_tool_name FROM agent_runs
     WHERE status = 'awaiting_approval' AND awaiting_approval_until < $1`,
    [now],
  );
  let resolved = 0;
  for (const row of rows) {
    const toolName: string | null = row.pending_approval_tool_name;
    const { toolRegistry } = await import('./toolRegistry.js');
    const tool = toolName ? toolRegistry.get(toolName) : null;
    const isLowCost = tool?.costHint === 'low';
    if (isLowCost) {
      await approveRun(row.id, 'system', 'auto-low-cost-timeout');
      await recordStep({
        runId: row.id, kind: 'approval_timeout',
        toolName, output: { auto: 'granted' },
      });
    } else {
      await denyRun(row.id, 'system', 'auto-timeout-deny');
      await recordStep({
        runId: row.id, kind: 'approval_timeout',
        toolName, output: { auto: 'denied' },
      });
    }
    resolved++;
  }
  return resolved;
}
```

注意 `store.getPool` 需要 export；如果 store.ts 没暴露，在 store.ts 加：
```typescript
export { getPool } from '../../db/client.js';
```

### 2.3 单元测试（无 polling，纯状态机）

```typescript
import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import { createUser } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';
import * as store from '../store.js';
import { DEFAULT_BUDGET } from '../types.js';
import {
  approveRun, denyRun, autoResolveExpiredApprovals,
} from '../approval.js';
import { registerRiskyEcho, riskyEchoTool } from '../tools/riskyEcho.js';
import { toolRegistry } from '../toolRegistry.js';

async function mkAwaiting(ownerId: string, toolName: string, untilOffsetMs = 60_000) {
  const r = await store.insertAgentRun({
    ownerId, channel: 'private', sessionId: null, groupId: null, topicId: null,
    intentTurnId: null, role: 'generalist', status: 'running',
    inputText: 'x', budget: DEFAULT_BUDGET, apiKeySource: 'server', apiKeyOwnerId: null,
  });
  await store.updateAgentRun(r.id, {
    status: 'awaiting_approval',
    pendingApprovalToolName: toolName,
    awaitingApprovalUntil: new Date(Date.now() + untilOffsetMs),
  });
  return r.id;
}

describe('approval (let-go model)', () => {
  beforeAll(async () => {
    await runMigrations();
    registerRiskyEcho();
  });
  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('approveRun: awaiting → running + writes approval_grant', async () => {
    const u = await createUser({
      username: 'ap-' + randomUUID().slice(0, 6),
      passwordHash: await hashPassword('xxxxxxxx'), displayName: 'ap',
    });
    const id = await mkAwaiting(u.id, riskyEchoTool.name);
    expect(await approveRun(id, u.id)).toBe(true);
    const r = await store.getAgentRun(id);
    expect(r?.status).toBe('running');
    expect(r?.pendingApprovalToolName).toBeNull();
    const steps = await store.listSteps(id);
    expect(steps.some((s) => s.kind === 'approval_grant')).toBe(true);
  });

  it('denyRun: awaiting → replanning + writes approval_deny', async () => {
    const u = await createUser({
      username: 'dn-' + randomUUID().slice(0, 6),
      passwordHash: await hashPassword('xxxxxxxx'), displayName: 'dn',
    });
    const id = await mkAwaiting(u.id, riskyEchoTool.name);
    expect(await denyRun(id, u.id, 'no')).toBe(true);
    const r = await store.getAgentRun(id);
    expect(r?.status).toBe('replanning');  // 不是 cancelled
    const steps = await store.listSteps(id);
    const denyStep = steps.find((s) => s.kind === 'approval_deny');
    expect(denyStep).toBeDefined();
    expect(denyStep!.byUserId).toBe(u.id);
  });

  it('autoResolveExpiredApprovals: low-cost tool auto-grants', async () => {
    const u = await createUser({
      username: 'tl-' + randomUUID().slice(0, 6),
      passwordHash: await hashPassword('xxxxxxxx'), displayName: 'tl',
    });
    toolRegistry.register({ ...riskyEchoTool, name: 'low_risky', costHint: 'low' });
    const id = await mkAwaiting(u.id, 'low_risky', -1_000);  // 已过期 1s
    const n = await autoResolveExpiredApprovals(new Date());
    expect(n).toBe(1);
    const r = await store.getAgentRun(id);
    expect(r?.status).toBe('running');
    const steps = await store.listSteps(id);
    expect(steps.some((s) => s.kind === 'approval_timeout' && (s.output as any)?.auto === 'granted')).toBe(true);
  });

  it('autoResolveExpiredApprovals: medium-cost tool auto-denies → replanning', async () => {
    const u = await createUser({
      username: 'tm-' + randomUUID().slice(0, 6),
      passwordHash: await hashPassword('xxxxxxxx'), displayName: 'tm',
    });
    const id = await mkAwaiting(u.id, riskyEchoTool.name, -1_000);  // medium
    await autoResolveExpiredApprovals(new Date());
    const r = await store.getAgentRun(id);
    expect(r?.status).toBe('replanning');
  });

  it('not-yet-expired runs are not auto-resolved', async () => {
    const u = await createUser({
      username: 'nx-' + randomUUID().slice(0, 6),
      passwordHash: await hashPassword('xxxxxxxx'), displayName: 'nx',
    });
    await mkAwaiting(u.id, riskyEchoTool.name, 60_000);
    const n = await autoResolveExpiredApprovals(new Date());
    expect(n).toBe(0);
  });
});
```

跑 + commit：

```bash
set -a; source .env; set +a
npm run test -w @xzz/api -- src/lib/agent/__tests__/approval.test.ts
git add apps/api/src/lib/agent/approval.ts apps/api/src/lib/agent/__tests__/approval.test.ts
git commit -m "feat(agent): approval flow let-go model (ADR-1, deny → replanning)"
```

---

## Task 3: critique.ts（规则化 stub）

**Files:**
- Create: `apps/api/src/lib/agent/critique.ts`
- Create: `apps/api/src/lib/agent/__tests__/critique.test.ts`

### 3.1 实现

```typescript
import type { AgentStep, Plan } from './types.js';

export type CritiqueInput = {
  plan: Plan;
  recentSteps: AgentStep[];
  reason: 'periodic' | 'consecutive_failures';
};

export type CritiqueOutput = {
  shouldReplan: boolean;
  reason: string;
  adjustment?: Partial<Plan>;
};

/**
 * M1b-2 规则化 stub:
 * - 连续 2 次工具失败 → shouldReplan=true (M1c 接入 LLM 后改成真 critique)
 * - 周期触发 → 永远 shouldReplan=false (M1a/M1b 没有真 LLM,直接跳过)
 *
 * 工具失败定义:`tool_error` kind step.
 */
export function runCritique(input: CritiqueInput): CritiqueOutput {
  if (input.reason === 'consecutive_failures') {
    const lastTwo = input.recentSteps.slice(-4); // 取最近 4 step,容忍一些 reply/observe 噪声
    const failures = lastTwo.filter((s) => s.kind === 'tool_error');
    if (failures.length >= 2) {
      return {
        shouldReplan: true,
        reason: '连续两次工具失败,建议重规划',
      };
    }
  }
  return { shouldReplan: false, reason: 'no action needed' };
}
```

### 3.2 测试

```typescript
import { describe, expect, it } from 'vitest';
import { runCritique } from '../critique.js';
import type { AgentStep, Plan } from '../types.js';

const dummyPlan: Plan = {
  intentSummary: 'x', steps: [], todos: [], finalReplyHint: '',
  reasoning: null, version: 1,
};

function step(kind: AgentStep['kind'], idx = 0): AgentStep {
  return {
    id: 's' + idx, runId: 'r', idx, kind,
    toolName: null, toolCallKey: null, input: null, output: null,
    tokens: 0, durationMs: 0, error: null, byUserId: null,
    createdAt: new Date(),
  };
}

describe('runCritique stub', () => {
  it('returns shouldReplan=true on 2 consecutive failures', () => {
    const r = runCritique({
      plan: dummyPlan,
      recentSteps: [step('tool_error', 1), step('tool_error', 2)],
      reason: 'consecutive_failures',
    });
    expect(r.shouldReplan).toBe(true);
  });

  it('no replan when not enough failures', () => {
    const r = runCritique({
      plan: dummyPlan,
      recentSteps: [step('tool_call', 1), step('tool_error', 2)],
      reason: 'consecutive_failures',
    });
    expect(r.shouldReplan).toBe(false);
  });

  it('periodic critique never replans in stub', () => {
    const r = runCritique({
      plan: dummyPlan,
      recentSteps: Array.from({ length: 6 }, (_, i) => step('tool_call', i)),
      reason: 'periodic',
    });
    expect(r.shouldReplan).toBe(false);
  });
});
```

Commit：

```bash
npm run test -w @xzz/api -- src/lib/agent/__tests__/critique.test.ts
git add apps/api/src/lib/agent/critique.ts apps/api/src/lib/agent/__tests__/critique.test.ts
git commit -m "feat(agent): rule-based critique stub (LLM upgrade M1c)"
```

---

## Task 4: runtimeRegistry + steer.ts（ADR-3 abort）+ planner 扩展

**Files:**
- Create: `apps/api/src/lib/agent/runtimeRegistry.ts`
- Create: `apps/api/src/lib/agent/steer.ts`
- Create: `apps/api/src/lib/agent/__tests__/steer.test.ts`
- Modify: `apps/api/src/lib/agent/planner.ts`
- Modify: `apps/api/src/lib/agent/runtime.ts`（仅顶部把 `runControllers` 从本地 Map 改为 `import { runControllers } from './runtimeRegistry.js'`）

### 4.0 runtimeRegistry.ts（消除 `Object.assign(Map)` 死代码）

```typescript
// 进程内活跃 run 的 AbortController 注册表。steer.ts 用它触发当前 step abort。
export const runControllers = new Map<string, AbortController>();
```

修改 `runtime.ts`：

1. 删掉第 24 行 `const runControllers = new Map<string, AbortController>();`
2. 顶部加 `import { runControllers } from './runtimeRegistry.js';`
3. **⚠️ 必须同时检查 `cancelRun`**（现有代码 L255–256）：

```typescript
// runtime.ts cancelRun 里也用了 runControllers:
const controller = runControllers.get(runId);
if (controller) controller.abort('user_cancel');
```

这行用的是之前的私有 Map。迁到 runtimeRegistry 后，`cancelRun` 里的引用会自动指向同一个 Map（同 import），**无需单独改**——只要 import 是从 runtimeRegistry 来的就对了。

确认方法：`import { runControllers } from './runtimeRegistry.js'` 加到顶部后，grep 一次 `runControllers` 确认 runtime.ts 里不再有本地声明。

### 4.1 planner 加 generatePlanForSteer + generatePlanForApprovalDeny

```typescript
/**
 * M1b-2 echo-aware steer planner: 用户指令里抽数字 N → N 步 echo plan; 没数字 → 默认 1 步。
 * M1c 升级为 LLM 调用，签名保持。
 */
export function generatePlanForSteer(
  prevPlan: Plan,
  instruction: string,
  alreadyCompletedSteps: number,
): Plan {
  const next = generatePlanForEcho(instruction);
  return {
    ...next,
    intentSummary: `[steer] ${instruction}`,
    version: prevPlan.version + 1,
  };
}

/**
 * 用户 deny 某个工具调用 → 重新规划剩余步骤。M1b 简化为 echo 1 步;
 * M1c LLM 时携带 deniedTool 名 + 原 inputText 让 planner 找替代方案。
 */
export function generatePlanForApprovalDeny(
  prevPlan: Plan,
  deniedTool: string,
  inputText: string,
): Plan {
  const next = generatePlanForEcho(inputText || '继续');
  return {
    ...next,
    intentSummary: `[after deny:${deniedTool}] 改用替代方案`,
    version: prevPlan.version + 1,
  };
}
```

### 4.2 steer.ts（abort + replanning，spec §15.2）

```typescript
import * as store from './store.js';
import { generatePlanForSteer } from './planner.js';
import { recordStep } from './stepRecorder.js';
import { runControllers } from './runtimeRegistry.js';

export type SteerInput = {
  runId: string;
  byUserId: string;
  instruction: string;
};

/**
 * 用户中途 steer:
 * 1) 校验 run 非终态
 * 2) 写新 plan (version+1)
 * 3) 切状态到 'replanning' 并清 heartbeat (让 worker pickup)
 * 4) 记录 steer step
 * 5) abort 本进程的 controller (若 run 当前在本进程跑) → executeRun 抛 AgentCancelled('steer'),
 *    runtime catch 时识别 'steer' 不写 cancelled, 让 worker pickup 进 replanning 路径
 */
export async function steerRun(input: SteerInput): Promise<{ accepted: boolean; reason?: string }> {
  const run = await store.getAgentRun(input.runId);
  if (!run) return { accepted: false, reason: 'run_missing' };
  if (['completed', 'failed', 'cancelled', 'budget_exhausted'].includes(run.status)) {
    return { accepted: false, reason: 'terminal' };
  }
  if (!run.plan) return { accepted: false, reason: 'no_plan' };

  const newPlan = generatePlanForSteer(run.plan, input.instruction, run.usage.steps);
  await store.updateAgentRun(input.runId, {
    plan: newPlan,
    todos: newPlan.todos,
    status: 'replanning',
    lastHeartbeatAt: null,
  });
  await recordStep({
    runId: input.runId, kind: 'steer',
    byUserId: input.byUserId,
    input: { instruction: input.instruction, newPlanVersion: newPlan.version },
  });

  const controller = runControllers.get(input.runId);
  if (controller) {
    // 注意:这里 abort 后 executeRun 抛 AgentCancelled('steer');
    // runtime catch 必须分流(见 Task 5.2)
    controller.abort();
  }
  return { accepted: true };
}
```

### 4.3 测试（unit；端到端 abort + replan 留 Task 6 runtime.steer.test.ts）

```typescript
import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import { createUser } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';
import * as store from '../store.js';
import { DEFAULT_BUDGET } from '../types.js';
import { steerRun } from '../steer.js';
import { generatePlanForEcho } from '../planner.js';
import { runControllers } from '../runtimeRegistry.js';

async function mkRunningWithPlan(ownerId: string) {
  const r = await store.insertAgentRun({
    ownerId, channel: 'private', sessionId: null, groupId: null, topicId: null,
    intentTurnId: null, role: 'generalist', status: 'running',
    inputText: '跑 5 步 echo', budget: DEFAULT_BUDGET,
    apiKeySource: 'server', apiKeyOwnerId: null,
  });
  const plan = generatePlanForEcho('跑 5 步 echo');
  await store.updateAgentRun(r.id, { plan, todos: plan.todos });
  return store.getAgentRun(r.id);
}

describe('steerRun', () => {
  beforeAll(async () => { await runMigrations(); });
  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
    runControllers.clear();
  });

  it('accepted: plan version bumps, status → replanning, steer step written', async () => {
    const u = await createUser({
      username: 's1-' + randomUUID().slice(0, 6),
      passwordHash: await hashPassword('xxxxxxxx'), displayName: 's1',
    });
    const run = (await mkRunningWithPlan(u.id))!;
    const res = await steerRun({ runId: run.id, byUserId: u.id, instruction: '改成跑两步' });
    expect(res.accepted).toBe(true);
    const after = await store.getAgentRun(run.id);
    expect(after?.status).toBe('replanning');
    expect(after?.plan?.version).toBe(2);
    expect(after?.plan?.steps.length).toBe(2);
    const steps = await store.listSteps(run.id);
    expect(steps.some((s) => s.kind === 'steer')).toBe(true);
  });

  it('aborts the active controller if present', async () => {
    const u = await createUser({
      username: 's-abort-' + randomUUID().slice(0, 6),
      passwordHash: await hashPassword('xxxxxxxx'), displayName: 'sa',
    });
    const run = (await mkRunningWithPlan(u.id))!;
    const ctl = new AbortController();
    runControllers.set(run.id, ctl);
    expect(ctl.signal.aborted).toBe(false);
    await steerRun({ runId: run.id, byUserId: u.id, instruction: '改成跑两步' });
    expect(ctl.signal.aborted).toBe(true);
  });

  it('rejected on terminal status', async () => {
    const u = await createUser({
      username: 's2-' + randomUUID().slice(0, 6),
      passwordHash: await hashPassword('xxxxxxxx'), displayName: 's2',
    });
    const run = (await mkRunningWithPlan(u.id))!;
    await store.updateAgentRun(run.id, { status: 'completed', endedAt: new Date() });
    const res = await steerRun({ runId: run.id, byUserId: u.id, instruction: 'x' });
    expect(res.accepted).toBe(false);
    expect(res.reason).toBe('terminal');
  });
});
```

Commit：

```bash
npm run test -w @xzz/api -- src/lib/agent/__tests__/steer.test.ts
git add apps/api/src/lib/agent/planner.ts apps/api/src/lib/agent/steer.ts apps/api/src/lib/agent/__tests__/steer.test.ts
git commit -m "feat(agent): steer API + planner generatePlanForSteer"
```

---

## Task 5: runtime.ts 嵌入 approval 让出 + replanning 分支 + steer abort 分流 + critique

**Files:**
- Modify: `apps/api/src/lib/agent/runtime.ts`
- Modify: `apps/api/src/lib/agent/store.ts`（`pickupNextRun` 加 `'replanning'` status）
- Modify: `apps/api/src/lib/agent/types.ts`（加 step kind `'approval_timeout'`；`AgentCancelled.reason` 加 `'steer'`）

### 5.0 types.ts 扩展（⚠️ self-review：已无需修改，直接跳过）

```bash
# 先验证：M1a 已落地的类型
grep -n "approval_timeout\|CancelReason\|'steer'" apps/api/src/lib/agent/types.ts
# 应该能看到:
# StepKind 里有 'approval_timeout'
# CancelReason = 'user' | 'steer' | 'budget' | 'crash_reclaim'
```

真实 `types.ts` 已包含这两个类型，**本 Task 直接跳过**，不改任何文件。

### 5.1 store.pickupNextRun 确认状态列表（⚠️ self-review：'replanning' 已在列表，直接跳过）

```bash
grep -A8 "pickupNextRun" apps/api/src/lib/agent/store.ts | grep "status IN"
# 实际输出: WHERE status IN ('draft','planning','running','replanning')
# 'replanning' 已在 M1a 写入，无需修改
```

**唯一需要做的事**：确认 `'awaiting_approval'` 不在列表（已确认，不在）。无需改代码。

### 5.2 runtime.executeRun 改造（核心）

**(a-0) 在早返回检查中补 `'awaiting_approval'`（⚠️ 安全漏洞，必须加）**

当前 `executeRun` 开头的 terminal-status 检查：

```typescript
// 现有代码（不含 awaiting_approval）
if (
  run.status === 'completed' ||
  run.status === 'failed' ||
  run.status === 'cancelled' ||
  run.status === 'budget_exhausted'
) { return; }
```

必须在其后紧接补上：

```typescript
// ⚠️ 必须加：让出模型下，awaiting_approval 状态不能重入 tool loop
if (run.status === 'awaiting_approval') return;
```

不加这句，worker 万一在 approve 之前又捡到同一个 `awaiting_approval` run，会直接跳过 approval gate 执行工具。

**(a) approval gate — 让出模型**

在 `tool.handler` 调用之前：

```typescript
      // === Approval gate (ADR-1) ===
      if (tool.approvalMode === 'never') {
        await recordStep({
          runId, kind: 'approval_deny',
          toolName: tool.name, input: planStep.input,
          error: 'approvalMode=never',
        });
        // 跳过本步
        const usage = incrementUsage(run, { steps: 1 });
        run = (await store.updateAgentRun(runId, { usage }))!;
        continue;
      }
      if (tool.approvalMode === 'ask') {
        await recordStep({
          runId, kind: 'approval_request',
          toolName: tool.name, input: planStep.input,
        });
        await store.updateAgentRun(runId, {
          status: 'awaiting_approval',
          awaitingApprovalUntil: new Date(Date.now() + 60_000),
          awaitingApprovalStepIdx: await store.maxStepIdx(runId),
          pendingApprovalToolName: tool.name,
        });
        // 让出: 不抛错, 直接 return; worker 会在 approve/deny/timeout 后 re-pickup
        return;
      }
      // === End approval gate ===
```

**(b) 顶部分流：进入 `replanning` 时调 planner**

`executeRun` 开头读出 run 后，分流：

```typescript
  if (run.status === 'replanning') {
    // 找最近一条 approval_deny / steer step 作为 reason
    const steps = await store.listSteps(runId);
    const lastSteer = [...steps].reverse().find((s) => s.kind === 'steer');
    const lastDeny = [...steps].reverse().find((s) => s.kind === 'approval_deny');
    let newPlan;
    if (lastSteer) {
      const instruction = (lastSteer.input as any)?.instruction as string | undefined;
      newPlan = generatePlanForSteer(run.plan!, instruction ?? '继续', run.usage.steps);
    } else if (lastDeny) {
      newPlan = generatePlanForApprovalDeny(run.plan!, lastDeny.toolName ?? 'unknown', run.inputText);
    } else {
      newPlan = generatePlanForSteer(run.plan!, run.inputText, run.usage.steps);
    }
    // steer.ts 已经写了 plan + steer step;这里只在 deny 情况下需写新 plan
    if (!lastSteer) {
      await store.updateAgentRun(runId, { plan: newPlan, todos: newPlan.todos });
    }
    await store.updateAgentRun(runId, { status: 'running' });
    run = (await store.getAgentRun(runId))!;
    // 重置 usage.steps?M1b 简化:replanning 后 i 从 0 重数,不复用旧 steps;
    // 但 budget.steps 不清零(继续累加,防止无限 replan)
  }
```

**(c) steer abort 分流：abort 检查点 + catch 块双处理**

`AbortController` 不携带 reason，区分 steer/user cancel 靠**读 db status**：

```typescript
// for 循环顶部，原来的 aborted 检查改为：
if (abortController.signal.aborted) {
  // steerRun 先写 status='replanning' 再 abort，所以这里读 db 可区分
  const cur = await store.getAgentRun(runId);
  if (cur?.status === 'replanning') throw new AgentCancelled('steer');
  throw new AgentCancelled('user');
}
```

catch 块完整改造（对齐现有 runtime.ts 结构，不要漏掉 `latest`）：

```typescript
} catch (e) {
  const latest = (await store.getAgentRun(runId)) ?? run;
  if (e instanceof AgentCancelled && e.reason === 'steer') {
    // steer 触发：run 已是 replanning，直接 return，worker 下次 pickup 进 replanning 分支
    return;
  }
  if (e instanceof AgentCancelled) {
    await recordStep({ runId, kind: 'cancel', error: e.reason });
    await softComplete(latest, 'cancelled', e.reason);
    return;
  }
  if (e instanceof AgentBudgetExhausted) {
    await softComplete(latest, 'budget_exhausted', e.dimension);
    return;
  }
  await recordStep({ runId, kind: 'system_error', error: String(e) });
  await softComplete(latest, 'failed', String(e).slice(0, 200));
} finally {
  stopHb();
  runControllers.delete(runId);
}
```

注意：`AgentCancelled` 已经是 `new AgentCancelled(reason: CancelReason)` 且 `CancelReason` 含 `'steer'`（types.ts 已有，Task 5.0 不需改）。

**(d) critique 嵌入**

在 for 循环**末尾**（每完成一个 step 之后）保持原 plan 草稿，但**不**自己写 plan（已经让 steer/deny 重规划，critique 只插 step；M1b stub 周期 critique 不 replan）：

```typescript
      // === Critique (M1b-2 stub) ===
      const stepsDone = run.usage.steps;
      if (stepsDone > 0 && stepsDone % 5 === 0) {
        const recentTail = (await store.listSteps(runId)).slice(-5);
        const { runCritique } = await import('./critique.js');
        const c = runCritique({ plan, recentSteps: recentTail, reason: 'periodic' });
        await recordStep({ runId, kind: 'critique', output: c });
      }
      const allSteps = await store.listSteps(runId);
      const recentFailures = allSteps.slice(-4).filter((s) => s.kind === 'tool_error').length;
      if (recentFailures >= 2) {
        const { runCritique } = await import('./critique.js');
        const c = runCritique({
          plan, recentSteps: allSteps.slice(-4), reason: 'consecutive_failures',
        });
        await recordStep({ runId, kind: 'critique', output: c });
        if (c.shouldReplan) {
          // 走 replanning 路径(让让 worker re-pickup 时调 planner)
          await store.updateAgentRun(runId, { status: 'replanning' });
          return;
        }
      }
```

import 顶部加：

```typescript
import { generatePlanForSteer, generatePlanForApprovalDeny } from './planner.js';
import { runControllers } from './runtimeRegistry.js';
```

### 5.3 typecheck

```bash
npm run typecheck
```

修补任何类型错误（plan const → let、`AgentCancelled` 构造、reason union 扩展等）。

### 5.4 跑既有测试确认无 regression

```bash
set -a; source .env; set +a
npm run test -w @xzz/api -- src/lib/agent/__tests__/runtime.test.ts
```

Expected：M1a 的 3 个 case 全 PASS。echoSleep 是 `'auto'`，跳过 approval gate。

```bash
git add apps/api/src/lib/agent/runtime.ts apps/api/src/lib/agent/store.ts apps/api/src/lib/agent/types.ts
git commit -m "feat(agent): runtime approval let-go + replanning branch + steer abort dispatch"
```

---

## Task 5.5: worker.ts 加 timeout checker

**Files:**
- Modify: `apps/api/src/lib/agent/worker.ts`
- Create: `apps/api/src/lib/agent/__tests__/worker.timeoutChecker.test.ts`

### 5.5.1 在 worker.tick 中加 autoResolveExpiredApprovals

打开 `worker.ts`，找到 `tick`/`pickupNextRun` 主循环。改造为：

```typescript
async function tick() {
  // 1) 自动解决过期的 awaiting_approval
  const { autoResolveExpiredApprovals } = await import('./approval.js');
  try { await autoResolveExpiredApprovals(new Date()); } catch (e) { console.error('[agent worker] autoResolve failed', e); }

  // 2) 原 pickup running/draft/replanning
  // ... 原逻辑 ...
}
```

可以让 `pickupNextRun` SQL 同时把 `'replanning'` 含进去（Task 5.1 已改）。

### 5.5.2 单元测试

```typescript
import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import { createUser } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';
import * as store from '../store.js';
import { DEFAULT_BUDGET } from '../types.js';
import { registerRiskyEcho, riskyEchoTool } from '../tools/riskyEcho.js';
import { autoResolveExpiredApprovals } from '../approval.js';

describe('autoResolveExpiredApprovals (worker tick)', () => {
  beforeAll(async () => {
    await runMigrations();
    registerRiskyEcho();
  });
  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('processes only expired runs', async () => {
    const u = await createUser({
      username: 'w-' + randomUUID().slice(0, 6),
      passwordHash: await hashPassword('xxxxxxxx'), displayName: 'w',
    });
    // 1 过期 + 1 未过期
    const r1 = await store.insertAgentRun({
      ownerId: u.id, channel: 'private', sessionId: null, groupId: null, topicId: null,
      intentTurnId: null, role: 'generalist', status: 'awaiting_approval',
      inputText: 'x', budget: DEFAULT_BUDGET, apiKeySource: 'server', apiKeyOwnerId: null,
    });
    await store.updateAgentRun(r1.id, {
      pendingApprovalToolName: riskyEchoTool.name,
      awaitingApprovalUntil: new Date(Date.now() - 1_000),
    });
    const r2 = await store.insertAgentRun({
      ownerId: u.id, channel: 'private', sessionId: null, groupId: null, topicId: null,
      intentTurnId: null, role: 'generalist', status: 'awaiting_approval',
      inputText: 'y', budget: DEFAULT_BUDGET, apiKeySource: 'server', apiKeyOwnerId: null,
    });
    await store.updateAgentRun(r2.id, {
      pendingApprovalToolName: riskyEchoTool.name,
      awaitingApprovalUntil: new Date(Date.now() + 30_000),
    });
    const n = await autoResolveExpiredApprovals(new Date());
    expect(n).toBe(1);
    expect((await store.getAgentRun(r1.id))?.status).toBe('replanning');
    expect((await store.getAgentRun(r2.id))?.status).toBe('awaiting_approval');
  });
});
```

```bash
set -a; source .env; set +a
npm run test -w @xzz/api -- src/lib/agent/__tests__/worker.timeoutChecker.test.ts
git add apps/api/src/lib/agent/worker.ts apps/api/src/lib/agent/__tests__/worker.timeoutChecker.test.ts
git commit -m "feat(agent): worker tick auto-resolves expired approvals"
```

---

## Task 6: routes/agent.ts — approve / deny / steer

**Files:**
- Modify: `apps/api/src/routes/agent.ts`

在 `confirmRun` 之后追加：

```typescript
agentRouter.post('/runs/:id/approve', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const run = await store.getAgentRun(id);
  if (!run) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  // 群聊也允许任意成员 approve(类比 cancel)
  let allowed = run.ownerId === userId;
  if (!allowed && run.channel === 'group' && run.groupId) {
    const { rows } = await getPool().query(
      `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1`,
      [run.groupId, userId],
    );
    allowed = rows.length > 0;
  }
  if (!allowed) return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);
  const { approveRun } = await import('../lib/agent/approval.js');
  const ok = await approveRun(id, userId);
  return c.json({ ok, requestId: c.get('requestId') });
});

agentRouter.post('/runs/:id/deny', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const run = await store.getAgentRun(id);
  if (!run) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  let allowed = run.ownerId === userId;
  if (!allowed && run.channel === 'group' && run.groupId) {
    const { rows } = await getPool().query(
      `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1`,
      [run.groupId, userId],
    );
    allowed = rows.length > 0;
  }
  if (!allowed) return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);
  const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
  const { denyRun } = await import('../lib/agent/approval.js');
  const ok = await denyRun(id, userId, body.reason);
  return c.json({ ok, requestId: c.get('requestId') });
});

agentRouter.post('/runs/:id/steer', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const run = await store.getAgentRun(id);
  if (!run) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  let allowed = run.ownerId === userId;
  if (!allowed && run.channel === 'group' && run.groupId) {
    const { rows } = await getPool().query(
      `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1`,
      [run.groupId, userId],
    );
    allowed = rows.length > 0;
  }
  if (!allowed) return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);
  const body = await c.req.json<{ instruction: string }>();
  if (!body.instruction) return jsonError(c, ErrorCodes.BAD_REQUEST, 400);
  const { steerRun } = await import('../lib/agent/steer.js');
  const res = await steerRun({ runId: id, byUserId: userId, instruction: body.instruction });
  return c.json({ ok: res.accepted, reason: res.reason, requestId: c.get('requestId') });
});
```

注意把 `getPool` import 进来（如果还没）。

**鉴权一致性：** approve/deny/steer 三 handler 全部复用 M1b-1 Task 4 的 `canAccessRun(run, userId)`（私聊 owner-only，群聊任意成员）。**最少补一个测试 case**：群聊里非 owner 成员 approve 一个 awaiting_approval 的 run 返回 200，非成员返回 403。可放在 M1b-1 已有的 `agent.routes.test.ts` 里追加。

typecheck + commit：

```bash
npm run typecheck
git add apps/api/src/routes/agent.ts apps/api/src/routes/__tests__/agent.routes.test.ts
git commit -m "feat(api): /runs/:id/{approve,deny,steer} routes (group-member auth)"
```

---

## Task 7: runtime + approval + steer 端到端集成测试（T4 + T11）

**Files:**
- Create: `apps/api/src/lib/agent/__tests__/runtime.approval.test.ts`
- Create: `apps/api/src/lib/agent/__tests__/runtime.steer.test.ts`

> 注意：在让出模型下，e2e 测试需要"模拟 worker re-pickup"：
> 1. 调 `executeRun(runId)` → 让出（写 awaiting_approval 或 replanning）
> 2. 手工调 `approveRun / denyRun / steerRun` 或 `autoResolveExpiredApprovals`
> 3. 再调 `executeRun(runId)` 让它继续跑
>
> 整个测试不依赖 worker 后台线程（worker 在 test 环境已被 M1a 的 guard 关掉）。

### 7.1 测试

```typescript
import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import { createUser, createChatSession } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';
import { registerEchoSleep } from '../tools/echoSleep.js';
import { registerRiskyEcho } from '../tools/riskyEcho.js';
import { createAgentRun, executeRun } from '../runtime.js';
import { approveRun, denyRun } from '../approval.js';
import { steerRun } from '../steer.js';
import { getAgentRun, listSteps } from '../store.js';
import { toolRegistry } from '../toolRegistry.js';

// 临时挂接一个"用 risky_echo 跑 N 步"的 planner —— 因为 M1a planner 只生成 echo_after_sleep
// 我们用 monkey-patch 一个 mini planner:测试时直接构造一个 plan 写入。
// 简化:测试里手工写 plan + status=running,跳过 planning,直接调 executeRun。

async function ensureUser(name: string) {
  return createUser({
    username: name + '-' + randomUUID().slice(0, 6),
    passwordHash: await hashPassword('xxxxxxxx'),
    displayName: name,
  });
}

async function mkRunWithRiskyPlan(ownerId: string, sessionId: string, nSteps: number) {
  const { insertAgentRun, updateAgentRun } = await import('../store.js');
  const { writePrivatePlaceholder } = await import('../messageBridge.js');
  const run = await insertAgentRun({
    ownerId, channel: 'private', sessionId, groupId: null, topicId: null,
    intentTurnId: null, role: 'generalist', status: 'draft',
    inputText: `测试 ${nSteps} 步 risky`, budget: { maxSteps: 10, maxSeconds: 600, maxTokens: 100_000 },
    apiKeySource: 'server', apiKeyOwnerId: null,
  });
  const placeholder = await writePrivatePlaceholder({
    userId: ownerId, sessionId, inputText: 'x', agentRunId: run.id,
  });
  await updateAgentRun(run.id, { resultMessageId: placeholder.placeholderMessageId });
  // 预置 plan: N 步 risky_echo
  const plan = {
    intentSummary: 'risky test',
    steps: Array.from({ length: nSteps }, (_, i) => ({
      toolName: 'risky_echo',
      input: { text: `r${i + 1}`, sleepMs: 100 },
      reason: `r ${i + 1}`,
      todoId: `t${i + 1}`,
    })),
    todos: Array.from({ length: nSteps }, (_, i) => ({
      id: `t${i + 1}`, text: `risky ${i + 1}`, status: 'pending' as const, stepRefs: [],
    })),
    finalReplyHint: '已完成',
    reasoning: null,
    version: 1,
  };
  await updateAgentRun(run.id, { plan, todos: plan.todos, status: 'running' });
  return run.id;
}

describe('runtime approval e2e', () => {
  beforeAll(async () => {
    await runMigrations();
    registerEchoSleep();
    registerRiskyEcho();
  });
  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('approve resumes run (let-go model)', async () => {
    const u = await ensureUser('ap');
    const s = await createChatSession(u.id, 'ap');
    const runId = await mkRunWithRiskyPlan(u.id, s.id, 1);

    // 第一次执行 → 让出到 awaiting_approval
    await executeRun(runId);
    const r1 = await getAgentRun(runId);
    expect(r1?.status).toBe('awaiting_approval');

    // 用户 approve → status 切回 running
    await approveRun(runId, u.id);
    expect((await getAgentRun(runId))?.status).toBe('running');

    // 模拟 worker re-pickup
    await executeRun(runId);
    const after = await getAgentRun(runId);
    expect(after?.status).toBe('completed');
    const kinds = (await listSteps(runId)).map((x) => x.kind);
    expect(kinds).toContain('approval_request');
    expect(kinds).toContain('approval_grant');
    expect(kinds.filter((k) => k === 'tool_call').length).toBe(1);
  });

  it('deny → replanning (NOT cancelled), worker re-plans', async () => {
    const u = await ensureUser('dn');
    const s = await createChatSession(u.id, 'dn');
    const runId = await mkRunWithRiskyPlan(u.id, s.id, 1);
    await executeRun(runId);
    expect((await getAgentRun(runId))?.status).toBe('awaiting_approval');

    await denyRun(runId, u.id, 'nope');
    const denied = await getAgentRun(runId);
    expect(denied?.status).toBe('replanning');  // 关键: 不是 cancelled
    expect((await listSteps(runId)).some((s) => s.kind === 'approval_deny')).toBe(true);

    // worker re-pickup → planner reason='approval_deny' 生成新 plan
    await executeRun(runId);
    const final = await getAgentRun(runId);
    // M1b stub: 新 plan 是 echo,跑完 → completed
    expect(['completed', 'replanning']).toContain(final!.status);
    expect(final!.plan!.intentSummary).toMatch(/after deny|steer|继续/);
  });

  it('timeout-low auto-grants and run resumes', async () => {
    const u = await ensureUser('tla');
    const s = await createChatSession(u.id, 'tla');
    // 自定义低成本工具
    toolRegistry.register({ ...riskyEchoTool, name: 'low_risky_e2e', costHint: 'low' });
    // 用工厂建 run + plan 引用 'low_risky_e2e'
    const { insertAgentRun, updateAgentRun } = await import('../store.js');
    const { writePrivatePlaceholder } = await import('../messageBridge.js');
    const run = await insertAgentRun({
      ownerId: u.id, channel: 'private', sessionId: s.id, groupId: null, topicId: null,
      intentTurnId: null, role: 'generalist', status: 'draft',
      inputText: 'low timeout', budget: { maxSteps: 10, maxSeconds: 600, maxTokens: 100_000 },
      apiKeySource: 'server', apiKeyOwnerId: null,
    });
    const ph = await writePrivatePlaceholder({
      userId: u.id, sessionId: s.id, inputText: 'x', agentRunId: run.id,
    });
    await updateAgentRun(run.id, { resultMessageId: ph.placeholderMessageId });
    const plan = {
      intentSummary: 't', steps: [{ toolName: 'low_risky_e2e', input: { text: 'a', sleepMs: 50 }, reason: '', todoId: 't1' }],
      todos: [{ id: 't1', text: 't', status: 'pending' as const, stepRefs: [] }],
      finalReplyHint: '', reasoning: null, version: 1,
    };
    await updateAgentRun(run.id, { plan, todos: plan.todos, status: 'running' });

    await executeRun(run.id);  // 让出
    // 把 awaiting_until 改成已过期
    await getPool().query(
      `UPDATE agent_runs SET awaiting_approval_until = $1 WHERE id = $2`,
      [new Date(Date.now() - 1_000), run.id],
    );
    const { autoResolveExpiredApprovals } = await import('../approval.js');
    await autoResolveExpiredApprovals(new Date());
    expect((await getAgentRun(run.id))?.status).toBe('running');
    await executeRun(run.id);
    expect((await getAgentRun(run.id))?.status).toBe('completed');
  });
});
```

### 7.2 runtime.steer.test.ts（T11：abort + replan + 剩余步数对齐）

```typescript
// 同 imports
describe('runtime steer e2e (T11)', () => {
  beforeAll(async () => { await runMigrations(); registerEchoSleep(); });
  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
    runControllers.clear();
  });

  it('steer mid-run aborts current step, replans, and finishes with new plan step count', async () => {
    const u = await ensureUser('st');
    const s = await createChatSession(u.id, 'st');
    const { insertAgentRun, updateAgentRun } = await import('../store.js');
    const { writePrivatePlaceholder } = await import('../messageBridge.js');
    const { generatePlanForEcho } = await import('../planner.js');
    const run = await insertAgentRun({
      ownerId: u.id, channel: 'private', sessionId: s.id, groupId: null, topicId: null,
      intentTurnId: null, role: 'generalist', status: 'draft',
      inputText: '跑 5 步 echo',
      budget: { maxSteps: 20, maxSeconds: 600, maxTokens: 100_000 },
      apiKeySource: 'server', apiKeyOwnerId: null,
    });
    const ph = await writePrivatePlaceholder({
      userId: u.id, sessionId: s.id, inputText: '跑 5 步 echo', agentRunId: run.id,
    });
    await updateAgentRun(run.id, { resultMessageId: ph.placeholderMessageId });
    const plan = generatePlanForEcho('跑 5 步 echo');  // 5 steps
    await updateAgentRun(run.id, { plan, todos: plan.todos, status: 'running' });

    // 启动 executeRun(并行),1.8s 后 steer
    const exec = executeRun(run.id);
    await new Promise((r) => setTimeout(r, 1800));
    const steerRes = await steerRun({
      runId: run.id, byUserId: u.id, instruction: '改成跑两步',
    });
    expect(steerRes.accepted).toBe(true);
    await exec;  // executeRun 因 abort('steer') 直接 return,不抛错

    // 此时 run status='replanning'
    const mid = await getAgentRun(run.id);
    expect(mid?.status).toBe('replanning');
    expect(mid?.plan?.version).toBe(2);
    expect(mid?.plan?.steps.length).toBe(2);

    // 模拟 worker re-pickup → 走 replanning 分支 → 跑新 plan 2 steps
    await executeRun(run.id);
    const final = await getAgentRun(run.id);
    expect(final?.status).toBe('completed');

    const steps = await listSteps(run.id);
    const kinds = steps.map((s) => s.kind);
    expect(kinds).toContain('steer');
    // 总 tool_call <= 旧 step 累计(被 abort 时数) + 新 plan 2 步
    // 强断言:新 plan 跑了 exactly 2 tool_call
    const toolCallsAfterSteer = steps.filter(
      (s, idx) => s.kind === 'tool_call' && idx > steps.findIndex((x) => x.kind === 'steer'),
    ).length;
    expect(toolCallsAfterSteer).toBe(2);
  });
});
```

### 7.3 跑 + commit

```bash
set -a; source .env; set +a
npm run test -w @xzz/api -- src/lib/agent/__tests__/runtime.approval.test.ts src/lib/agent/__tests__/runtime.steer.test.ts
git add apps/api/src/lib/agent/__tests__/runtime.approval.test.ts apps/api/src/lib/agent/__tests__/runtime.steer.test.ts
git commit -m "test(agent): approval + steer e2e (T4 + T11)"
```

---

## Task 8: 全量验证 + README

```bash
set -a; source .env; set +a
pkill -f "tsx watch.*行动中止派" 2>/dev/null; sleep 2
npm run typecheck
npm run test -w @xzz/api
```

Expected：在 M1a/M1b-1 基础上多 4 个测试文件 / ~15 个 case，全 PASS。

README 追加：

```markdown
## Agent Runtime M1b-2（Approval + Steer + Critique）

- 工具 `approvalMode='ask'` 时,runtime 在调工具前写 `approval_request` step 并把 run 状态切到 `awaiting_approval`(60s 超时;`costHint='low'` 自动 grant,其他 deny)
- `POST /api/agent/runs/:id/approve` / `/deny` 用户授权 / 拒绝
- `POST /api/agent/runs/:id/steer { instruction }` 中途换方向;runtime 在每次循环顶部检查 plan.version,变化时切换到新 plan 剩余 steps
- critique 在每完成 5 步或连续 2 次工具失败时插入 `critique` step(M1b-2 用规则化 stub,M1c 接入 LLM)
- 测试工具 `risky_echo`(approvalMode=ask)只在测试环境注册
```

```bash
git add README.md
git commit -m "docs: M1b-2 approval + steer + critique"
```

---

## 验收清单（对照 Spec §18.2 + §19 + m1b-completion §1）

- [ ] **AC3**（approval ask 流程 + 60s 超时按 costHint 处理 + deny → replanning）— Tasks 2+5+5.5+6+7
- [ ] **AC4**（steer = abort + replanning + 新 plan 剩余 step 数对齐）— Tasks 4+5+6+7.2
- [ ] **AC6**（critique 触发，规则 stub）— Tasks 3+5

测试矩阵：
- [ ] **T4**（Approval timeout 单元 + e2e + worker 自动 resolve）— Tasks 2 + 5.5 + 7
- [ ] **T11**（Steer abort + replan + 剩余 step 数）— Tasks 4 + 7.2

defer：
- **T5（heartbeat reclaim）** → M1d
- 路由层 approve/deny/steer 群成员鉴权测试 → Task 6（补 P1）

---

## Self-Review

**Spec 覆盖**：1:1 对齐 §12/§14/§15 主路径（详见 plan 头部"与 spec 的差异表"）。critique 是规则 stub，但接口与 spec §9.4 一致，M1c 升级时**只**改 critique.ts 实现即可。

**Placeholder 扫描**：
- `enqueue` 用 `lastHeartbeatAt = null` trick；M1d 可改成专用 `next_pickup_at` 列
- 工厂 helper `mkRunWithRiskyPlan` 复制于 approval + steer 两个测试文件 → implementer 可抽到 `__tests__/_runFactory.ts`

**类型一致性**：
- `AgentStepKind` 新增 `'approval_timeout'`、`AgentCancelReason` 新增 `'steer'` 都在 types.ts 一次性改
- `runCritique` 输入输出与 spec §9.4 签名一致
- `runtimeRegistry.runControllers` 单点 Map，避免 `Object.assign(Map)` 死代码

**架构选择记录（与原稿差异）**：
1. ❌ 删除 `waitForApprovalOrTimeout`（阻塞 poll 模式）
2. ✅ 改 store-level `approveRun / denyRun / autoResolveExpiredApprovals`
3. ✅ Deny → `replanning` 而非 `cancelled`（spec §15.3）
4. ✅ Steer abort controller + 状态 → `replanning`（spec §15.2）
5. ✅ worker tick 加 timeout checker
6. ✅ `pickupNextRun` 接纳 `'replanning'` status

---

## 修订记录

**2026-05-20 v2**（response to review）：
- **架构重写**：approval 从阻塞 poll 改为 spec-aligned 让出模型；deny → replanning；steer 真 abort
- 新增 `runtimeRegistry.ts` 消除 `Object.assign(Map)` 死代码
- 新增 Task 5.5 worker timeout checker
- 新增 Task 7.2 `runtime.steer.test.ts`（T11 强断言：steer 后 exactly N 步 tool_call）
- 新增 step kind `approval_timeout`（不再借用 `cancelReason: 'budget'`）
- 估时 6h → **10–14h**

Plan complete and saved to `docs/superpowers/plans/2026-05-20-agent-runtime-m1b-2.md`.
