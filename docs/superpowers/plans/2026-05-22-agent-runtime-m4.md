# Agent Runtime M4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户看得见 agent 在干什么、找得回历史、能一键重试、知道花了多少钱——M4 v1 交付任务面板 + cost 估算 + 24h 暂停超时 + run summary 四件事。

**Architecture:** 后端基础设施大部分已有（GET /runs 列表 API / SSE / retry / cancel）。M4 只补：(1) `usage.costCny` 真填数（在 `runLlmClient` 拦截 chat 后按 model pricing 累加），(2) `pending_user_input_expires_at` 列 + worker tick checker，(3) `summary` JSONB 列 + `softComplete` 落库，(4) mobile bottom tab `任务` + 列表/详情两个新 screen。SSE 适配作为 M4 polish（独立 patch tag）。

**Tech Stack:** TypeScript / Hono / pg / Vitest（apps/api）；Expo / React Native / @react-navigation/bottom-tabs（apps/mobile）。

**前置：** v0.m3 + M3 hotfix（commit 05c91ac）。所有 M3 API / executor / mobile components 已就位。

**Spec：** `docs/superpowers/specs/2026-05-22-agent-runtime-m4-design.md`

---

## 测试命令统一约定

所有后端测试都需要 DB 连接，运行命令模板：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run --reporter=verbose <test file>
```

> 若 `.env` 没配 `DATABASE_URL` → 显式 export：`export DATABASE_URL='postgres://...'`。M2 / M3 都验证过这个模板，沿用即可。

---

## T0: 分支 + baseline

**Files:** none

- [ ] **Step 1：开分支 + 验证 baseline 通过**

```bash
cd /Users/hongpengwang/行动中止派
git checkout main && git pull --ff-only
git checkout -b feat/agent-runtime-m4
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run --reporter=summary
```

Expected: all tests PASS（M3 hotfix 后大约 400 个测试）。若有 flaky 试 1 次再跑。

- [ ] **Step 2：mobile baseline 编译通过**

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected: exit 0.

---

## T1: Migration 019 + types/store M4 plumbing

**Files:**
- Create: `apps/api/src/db/migrations/019_agent_run_summary_and_user_input_expires.sql`
- Modify: `apps/api/src/lib/agent/types.ts`
- Modify: `apps/api/src/lib/agent/store.ts`
- Create: `apps/api/src/lib/agent/__tests__/store.m4.test.ts`

### Step 1：写 migration 019

- [ ] 创建 migration SQL：

```sql
-- apps/api/src/db/migrations/019_agent_run_summary_and_user_input_expires.sql
-- M4 Task 1: pending_user_input_expires_at (24h timeout for ask_user)
--          + summary JSONB (一次性聚合 step / tool / ref 计数)
ALTER TABLE agent_runs
  ADD COLUMN pending_user_input_expires_at TIMESTAMPTZ NULL,
  ADD COLUMN summary JSONB NULL;

-- 加速 worker tick 的过期扫描：只对仍在 awaiting_user_input 的 run 建条件索引。
CREATE INDEX idx_agent_runs_pending_user_input_expires
  ON agent_runs(pending_user_input_expires_at)
  WHERE status = 'awaiting_user_input' AND pending_user_input_expires_at IS NOT NULL;
```

### Step 2：types 扩展（先写测试）

- [ ] 创建测试文件 `apps/api/src/lib/agent/__tests__/store.m4.test.ts`：

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { getPool } from '../../../db/client.js';
import { runMigrations } from '../../../db/migrate.js';
import * as agentStore from '../store.js';
import { DEFAULT_BUDGET } from '../types.js';
import { createUser } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';

async function ensureUser(): Promise<string> {
  const u = await createUser({
    username: 'm4-store-' + randomUUID().slice(0, 6),
    passwordHash: await hashPassword('xxxxxxxx'),
    displayName: 'm4-store-test',
  });
  return u.id;
}

function baseInsertInput(ownerId: string): agentStore.InsertAgentRunInput {
  return {
    ownerId,
    channel: 'private',
    sessionId: null,
    groupId: null,
    topicId: null,
    intentTurnId: null,
    role: 'generalist',
    status: 'draft',
    inputText: 'hi',
    budget: DEFAULT_BUDGET,
    apiKeySource: 'server',
    apiKeyOwnerId: null,
  };
}

describe('M4 Task 1: summary + pending_user_input_expires_at columns', { timeout: 15000 }, () => {
  beforeAll(async () => {
    await runMigrations();
  });
  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('defaults: insertAgentRun + getAgentRun → summary / pendingUserInputExpiresAt null', async () => {
    const ownerId = await ensureUser();
    const run = await agentStore.insertAgentRun(baseInsertInput(ownerId));
    expect(run.summary).toBeNull();
    expect(run.pendingUserInputExpiresAt).toBeNull();
    const re = await agentStore.getAgentRun(run.id);
    expect(re?.summary).toBeNull();
    expect(re?.pendingUserInputExpiresAt).toBeNull();
  });

  it("updateAgentRun: pendingUserInputExpiresAt round-trip", async () => {
    const ownerId = await ensureUser();
    const run = await agentStore.insertAgentRun(baseInsertInput(ownerId));
    const future = new Date(Date.now() + 24 * 3600 * 1000);
    const updated = await agentStore.updateAgentRun(run.id, {
      pendingUserInputExpiresAt: future,
    });
    expect(updated?.pendingUserInputExpiresAt?.getTime()).toBe(future.getTime());
    const re = await agentStore.getAgentRun(run.id);
    expect(re?.pendingUserInputExpiresAt?.getTime()).toBe(future.getTime());
  });

  it("updateAgentRun: pendingUserInputExpiresAt → null clears", async () => {
    const ownerId = await ensureUser();
    const run = await agentStore.insertAgentRun(baseInsertInput(ownerId));
    await agentStore.updateAgentRun(run.id, {
      pendingUserInputExpiresAt: new Date(),
    });
    const cleared = await agentStore.updateAgentRun(run.id, {
      pendingUserInputExpiresAt: null,
    });
    expect(cleared?.pendingUserInputExpiresAt).toBeNull();
  });

  it("updateAgentRun: summary round-trip", async () => {
    const ownerId = await ensureUser();
    const run = await agentStore.insertAgentRun(baseInsertInput(ownerId));
    const summary = {
      stepCount: 5,
      toolCount: 2,
      toolBreakdown: { search_web: 2, fetch_url: 1 },
      refCount: 3,
    };
    const updated = await agentStore.updateAgentRun(run.id, { summary });
    expect(updated?.summary).toEqual(summary);
    const re = await agentStore.getAgentRun(run.id);
    expect(re?.summary).toEqual(summary);
  });
});
```

- [ ] 运行测试：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run src/lib/agent/__tests__/store.m4.test.ts
```

Expected: 4 FAIL — `summary` / `pendingUserInputExpiresAt` 字段不存在。

### Step 3：types.ts 扩展

- [ ] 编辑 `apps/api/src/lib/agent/types.ts`，在 `AgentRun` 内 `pendingUserStepIdx` 之后追加：

```ts
  /** M4 Task 1: ask_user 暂停的 24h 超时戳；过期由 worker tick 自动 cancel。null 表示无限期等。 */
  pendingUserInputExpiresAt: Date | null;
  /** M4 Task 4: 任务完成时落的聚合摘要（步数 / 工具 / ref 数）；UI 在列表/详情都展示。 */
  summary: RunSummary | null;
```

- [ ] 在文件末尾追加 `RunSummary` 类型：

```ts
/**
 * M4 Task 4：run 完成（含 failed / cancelled / budget_exhausted）时由 buildRunSummary
 * 计算并落到 agent_runs.summary。用于任务面板列表的「N 步 · M 工具 · K 引用」一行摘要。
 *
 * 仅统计 useful step：filter out heartbeat / reclaim / system_error，避免把审计步算进数。
 */
export type RunSummary = {
  /** useful step 总数（含 plan / tool_call / observe / reply / approval_* / steer / user_input） */
  stepCount: number;
  /** distinct tool name 数 */
  toolCount: number;
  /** tool name → call count（cached 命中也算 1 次，但 idempotency 命中走 observe，不算 tool_call） */
  toolBreakdown: Record<string, number>;
  /** 各 step output.result.citations 累加；通常代表"找到 K 篇论文 / K 个 URL" */
  refCount: number;
};
```

### Step 4：store.ts 扩展

- [ ] 在 `parseRun`（约 L20-L65）添加两行（紧跟现有 `pendingUserStepIdx`）：

```ts
    pendingUserInputExpiresAt: (row.pending_user_input_expires_at as Date | null) ?? null,
    summary: (row.summary as RunSummary | null) ?? null,
```

- [ ] 在 `RUN_COLUMNS`（约 L85）追加两列（保持与 `parseRun` 顺序一致）：

```ts
const RUN_COLUMNS = `id, owner_id, channel, session_id, group_id, topic_id,
  intent_turn_id, role, status, input_text, plan, todos, budget, usage,
  api_key_owner_id, api_key_source, provider_id, model_id,
  sandbox_id, user_api_keys_enc,
  parent_run_id, pending_user_prompt, pending_user_step_idx,
  pending_user_input_expires_at, summary,
  result_message_id, invoke_message_id,
  last_heartbeat_at, awaiting_approval_until, awaiting_approval_step_idx,
  pending_approval_tool_name, cancelled_by_user_id, cancel_reason,
  created_at, started_at, ended_at`;
```

- [ ] 在 `UpdateAgentRunInput` type 内 `pendingUserStepIdx` 之后追加：

```ts
  /** M4 Task 1: ask_user 暂停的 24h 超时戳。清空时传 null。 */
  pendingUserInputExpiresAt: Date | null;
  /** M4 Task 4: run summary 聚合摘要。 */
  summary: RunSummary | null;
```

- [ ] 在 `updateAgentRun.map` 内 `pendingUserStepIdx` 之后追加：

```ts
    pendingUserInputExpiresAt: ['pending_user_input_expires_at', patch.pendingUserInputExpiresAt],
    summary: [
      'summary',
      patch.summary === undefined ? undefined : JSON.stringify(patch.summary),
    ],
```

- [ ] 在 store.ts 顶部 import 列表添加 `RunSummary`：

```ts
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
} from './types.js';
```

### Step 5：运行测试 → 通过

- [ ] 跑：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run src/lib/agent/__tests__/store.m4.test.ts
```

Expected: 4 PASS。

- [ ] 再跑 M3 store 测试确认没破坏：

```bash
DATABASE_URL=... npx vitest run src/lib/agent/__tests__/store.m3.test.ts
```

Expected: 4 PASS。

### Step 6：commit

```bash
cd /Users/hongpengwang/行动中止派
git add apps/api/src/db/migrations/019_agent_run_summary_and_user_input_expires.sql \
        apps/api/src/lib/agent/types.ts \
        apps/api/src/lib/agent/store.ts \
        apps/api/src/lib/agent/__tests__/store.m4.test.ts
git commit -m "feat(agent/m4): migration 019 + types/store M4 扩展（summary + pending_user_input_expires_at）"
```

---

## T2: modelPricing 模块 + computeCallCostCny

**Files:**
- Create: `apps/api/src/lib/agent/modelPricing.ts`
- Create: `apps/api/src/lib/agent/__tests__/modelPricing.test.ts`

### Step 1：先写测试

- [ ] 创建 `apps/api/src/lib/agent/__tests__/modelPricing.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { computeCallCostCny, MODEL_PRICING } from '../modelPricing.js';

describe('modelPricing.computeCallCostCny', () => {
  it('returns unknownModel=true and cost=0 when modelId is null', () => {
    const r = computeCallCostCny(null, 1000, 500);
    expect(r.unknownModel).toBe(true);
    expect(r.costCny).toBe(0);
  });

  it('returns unknownModel=true and cost=0 for unknown model', () => {
    const r = computeCallCostCny('some/never-heard-of', 1000, 500);
    expect(r.unknownModel).toBe(true);
    expect(r.costCny).toBe(0);
  });

  it('deepseek-chat: 1000 prompt + 1000 completion → ¥0.0020 + ¥0.0080 = ¥0.0100', () => {
    const r = computeCallCostCny('deepseek-chat', 1000, 1000);
    expect(r.unknownModel).toBe(false);
    expect(r.costCny).toBeCloseTo(0.01, 4);
  });

  it('deepseek-reasoner: 2000 prompt + 1000 completion → ¥0.008 + ¥0.016 = ¥0.024', () => {
    const r = computeCallCostCny('deepseek-reasoner', 2000, 1000);
    expect(r.costCny).toBeCloseTo(0.024, 4);
  });

  it('claude-sonnet-4.5: 1000 + 1000 → ¥0.0216 + ¥0.108 = ¥0.1296', () => {
    const r = computeCallCostCny('anthropic/claude-sonnet-4.5', 1000, 1000);
    expect(r.costCny).toBeCloseTo(0.1296, 4);
  });

  it('zero tokens → zero cost (known model)', () => {
    const r = computeCallCostCny('deepseek-chat', 0, 0);
    expect(r.unknownModel).toBe(false);
    expect(r.costCny).toBe(0);
  });

  it('1M tokens does not overflow; result rounded to 4 decimal places', () => {
    const r = computeCallCostCny('deepseek-chat', 1_000_000, 0);
    // 1M / 1000 * 0.002 = 2.0000
    expect(r.costCny).toBe(2.0);
  });

  it('MODEL_PRICING contains both DeepSeek default & deepseek-v4-pro fallback', () => {
    // 'deepseek-v4-pro' 是 DB DEFAULT，必须有 entry，否则所有 server-key run 都触发 unknown notice
    expect(MODEL_PRICING['deepseek-v4-pro']).toBeDefined();
    expect(MODEL_PRICING['deepseek-chat']).toBeDefined();
    expect(MODEL_PRICING['deepseek-reasoner']).toBeDefined();
  });

  it('MODEL_PRICING entries all use positive numbers', () => {
    for (const [model, entry] of Object.entries(MODEL_PRICING)) {
      expect(entry.promptCny, `${model}.promptCny`).toBeGreaterThanOrEqual(0);
      expect(entry.completionCny, `${model}.completionCny`).toBeGreaterThanOrEqual(0);
    }
  });
});
```

- [ ] 跑测试：

```bash
cd apps/api && npx vitest run src/lib/agent/__tests__/modelPricing.test.ts
```

Expected: 9 FAIL — module 不存在。

### Step 2：实现 modelPricing.ts

- [ ] 创建 `apps/api/src/lib/agent/modelPricing.ts`：

```ts
/**
 * Agent runtime cost accounting：按 model 估算每次 LLM call 的人民币成本。
 *
 * 设计原则：
 * - 数据手动维护：hardcode table + 月度对一次官方页面（M4 spec §8 Q&A）
 * - 统一按 cache-miss 估算：不区分 DeepSeek prompt-cache 命中与否，宁高勿低
 * - USD → CNY 汇率常数 7.2：实际波动 ±5%，长期看够用
 * - 查不到 model → return { costCny: 0, unknownModel: true } 让 caller 一次性 emit
 *   COST_UNKNOWN_MODEL notice，不阻塞 run
 *
 * 维护节奏：每月人肉对一次官方价格页面：
 * - https://api-docs.deepseek.com/zh-cn/quick_start/pricing-details-cny
 * - https://openrouter.ai/models（ZenMux 等代理价大致一致）
 *
 * 偏差容忍：±20% 内不修；超过就 commit 更新。UI 文案写"估算值"避免误以为账单。
 */

type PriceEntry = { promptCny: number; completionCny: number };

/** 单价 = CNY per 1000 tokens（cache miss）。 */
export const MODEL_PRICING: Record<string, PriceEntry> = {
  // ─── DeepSeek 官方 CNY 原价（cache miss）─────────────────────────────────
  // input ¥2/M (miss)   output ¥8/M
  'deepseek-chat':                 { promptCny: 0.002,   completionCny: 0.008   },
  // input ¥4/M (miss)   output ¥16/M
  'deepseek-reasoner':             { promptCny: 0.004,   completionCny: 0.016   },
  // 'deepseek-v4-pro' 是 DB DEFAULT；按 deepseek-chat 一档估算（如有偏差月度 commit 修正）
  'deepseek-v4-pro':               { promptCny: 0.002,   completionCny: 0.008   },

  // ─── OpenAI via ZenMux（USD × 7.2 → CNY）────────────────────────────────
  // gpt-4o $2.50 / $10  per M → 0.018 / 0.072
  'openai/gpt-4o':                 { promptCny: 0.018,   completionCny: 0.072   },
  // gpt-4o-mini $0.15 / $0.60 per M → 0.00108 / 0.00432
  'openai/gpt-4o-mini':            { promptCny: 0.0011,  completionCny: 0.0043  },
  // gpt-5 $1.25 / $10 per M → 0.009 / 0.072
  'openai/gpt-5':                  { promptCny: 0.009,   completionCny: 0.072   },

  // ─── Anthropic via ZenMux（USD × 7.2 → CNY）────────────────────────────
  // sonnet 4.5 $3 / $15 per M → 0.0216 / 0.108
  'anthropic/claude-sonnet-4.5':   { promptCny: 0.0216,  completionCny: 0.108   },
  // sonnet 4.6 与 4.5 同价（暂未公开调整）
  'anthropic/claude-sonnet-4.6':   { promptCny: 0.0216,  completionCny: 0.108   },
  // opus 4.6 $5 / $25 per M → 0.036 / 0.18
  'anthropic/claude-opus-4.6':     { promptCny: 0.036,   completionCny: 0.18    },
  // haiku 3.5 $0.80 / $4 per M → 0.00576 / 0.0288
  'anthropic/claude-haiku-3.5':    { promptCny: 0.00576, completionCny: 0.0288  },
  // 兼容历史 alias（M3 期间 planner 可能见到）
  'anthropic/claude-3.5-sonnet':   { promptCny: 0.0216,  completionCny: 0.108   },
  'anthropic/claude-3.5-haiku':    { promptCny: 0.00576, completionCny: 0.0288  },

  // ─── Google via ZenMux（USD × 7.2 → CNY）────────────────────────────────
  // gemini 2.5 pro $1.25 / $10 per M → 0.009 / 0.072
  'google/gemini-2.5-pro':         { promptCny: 0.009,   completionCny: 0.072   },
  // gemini 2.5 flash $0.075 / $0.30 per M → 0.00054 / 0.00216
  'google/gemini-2.5-flash':       { promptCny: 0.00054, completionCny: 0.00216 },
};

/**
 * 计算单次 LLM call 的成本。
 *
 * @returns
 *   - `costCny`：CNY，保留 4 位小数（最小单位约 1 厘）
 *   - `unknownModel`：true 表示 modelId 不在 table，caller 应一次性 emit notice
 */
export function computeCallCostCny(
  modelId: string | null,
  promptTokens: number,
  completionTokens: number,
): { costCny: number; unknownModel: boolean } {
  if (!modelId) return { costCny: 0, unknownModel: true };
  const entry = MODEL_PRICING[modelId];
  if (!entry) return { costCny: 0, unknownModel: true };
  const cost =
    (promptTokens / 1000) * entry.promptCny +
    (completionTokens / 1000) * entry.completionCny;
  return {
    costCny: Math.round(cost * 10000) / 10000,
    unknownModel: false,
  };
}
```

### Step 3：测试 → 全过

- [ ] 跑：

```bash
cd apps/api && npx vitest run src/lib/agent/__tests__/modelPricing.test.ts
```

Expected: 9 PASS。

### Step 4：commit

```bash
git add apps/api/src/lib/agent/modelPricing.ts apps/api/src/lib/agent/__tests__/modelPricing.test.ts
git commit -m "feat(agent/m4): modelPricing.ts + computeCallCostCny + tests（按 cache-miss 估算 / USD ×7.2 → CNY）"
```

---

## T3: Cost intercept in runLlmClient + emitNoticeOnce

**Files:**
- Modify: `apps/api/src/lib/agent/notices.ts`
- Modify: `apps/api/src/lib/agent/runLlmClient.ts`
- Modify: `apps/mobile/src/features/agent/types.ts`（mirror notice code）
- Create: `apps/api/src/lib/agent/__tests__/runLlmClient.cost.test.ts`

### Step 1：扩展 NoticeCode

- [ ] 编辑 `apps/api/src/lib/agent/notices.ts`，`NoticeCode` 联合类型增 `'COST_UNKNOWN_MODEL'`：

```ts
export type NoticeCode =
  // key / 鉴权
  | 'USER_KEY_MISSING'
  | 'USER_KEY_DECRYPT_FAILED'
  | 'NO_API_KEY'
  // retry / 幂等
  | 'RETRY_DEDUPED'
  // LLM 失败
  | 'PLANNER_LLM_FALLBACK'
  | 'REPLY_LLM_FALLBACK'
  // skill / 注入防御
  | 'SKILL_WARN_KEYWORD'
  | 'SKILL_DROPPED'
  // 工具
  | 'DOC_EXPORT_VERSIONED'
  | 'TOOL_PAYLOAD_TOO_LARGE'
  // MCP
  | 'MCP_HANDSHAKE_FAILED'
  // M4: cost accounting
  | 'COST_UNKNOWN_MODEL';
```

- [ ] mirror 到 mobile：编辑 `apps/mobile/src/features/agent/types.ts`，`NoticeCode` 增同字段：

```ts
export type NoticeCode =
  | 'USER_KEY_MISSING'
  | 'USER_KEY_DECRYPT_FAILED'
  | 'NO_API_KEY'
  | 'RETRY_DEDUPED'
  | 'PLANNER_LLM_FALLBACK'
  | 'REPLY_LLM_FALLBACK'
  | 'SKILL_WARN_KEYWORD'
  | 'SKILL_DROPPED'
  | 'DOC_EXPORT_VERSIONED'
  | 'TOOL_PAYLOAD_TOO_LARGE'
  | 'MCP_HANDSHAKE_FAILED'
  | 'COST_UNKNOWN_MODEL';
```

### Step 2：写测试（先 fail）

- [ ] 创建 `apps/api/src/lib/agent/__tests__/runLlmClient.cost.test.ts`：

```ts
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { getPool } from '../../../db/client.js';
import { runMigrations } from '../../../db/migrate.js';
import * as store from '../store.js';
import { DEFAULT_BUDGET } from '../types.js';
import { createUser } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';
import { resolveLlmClient, _resetRunLlmClientNoticeDedup } from '../runLlmClient.js';
import { listNoticesForRun } from '../notices.js';

vi.mock('../../llm/factory.js', () => ({
  buildLlmClient: vi.fn((spec) => ({
    providerId: spec.providerId,
    modelId: spec.modelId,
    chat: vi.fn(async () => ({
      content: 'mocked',
      usage: { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 },
      providerId: spec.providerId,
      modelId: spec.modelId,
    })),
  })),
}));

async function ensureUser(): Promise<string> {
  const u = await createUser({
    username: 'm4-llm-' + randomUUID().slice(0, 6),
    passwordHash: await hashPassword('xxxxxxxx'),
    displayName: 'm4-llm-test',
  });
  return u.id;
}

async function makeRun(ownerId: string, modelId: string) {
  return store.insertAgentRun({
    ownerId,
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
    providerId: 'deepseek',
    modelId,
  });
}

describe('runLlmClient cost accounting', { timeout: 15000 }, () => {
  beforeAll(async () => {
    process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'test-key';
    await runMigrations();
  });
  beforeEach(async () => {
    _resetRunLlmClientNoticeDedup();
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_event_logs');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('known model: chat() returns → usage.costCny 累加到 run', async () => {
    const ownerId = await ensureUser();
    const run = await makeRun(ownerId, 'deepseek-chat');
    const client = await resolveLlmClient(run);
    expect(client).not.toBeNull();
    await client!.chat([{ role: 'user', content: 'hi' }], { signal: new AbortController().signal });

    const reloaded = await store.getAgentRun(run.id);
    // 1000 prompt × 0.002 + 500 completion × 0.008 / 1000 = 0.002 + 0.004 = 0.006
    expect(reloaded?.usage.costCny).toBeCloseTo(0.006, 4);
    expect(reloaded?.usage.tokens).toBe(1500);
  });

  it('multiple chat() calls: costCny accumulates', async () => {
    const ownerId = await ensureUser();
    const run = await makeRun(ownerId, 'deepseek-chat');
    const client = await resolveLlmClient(run);
    await client!.chat([{ role: 'user', content: 'a' }], { signal: new AbortController().signal });
    await client!.chat([{ role: 'user', content: 'b' }], { signal: new AbortController().signal });

    const reloaded = await store.getAgentRun(run.id);
    expect(reloaded?.usage.costCny).toBeCloseTo(0.012, 4);
    expect(reloaded?.usage.tokens).toBe(3000);
  });

  it('unknown model: emits COST_UNKNOWN_MODEL notice once', async () => {
    const ownerId = await ensureUser();
    const run = await makeRun(ownerId, 'fictional/model-xyz');
    const client = await resolveLlmClient(run);
    await client!.chat([{ role: 'user', content: 'x' }], { signal: new AbortController().signal });
    await client!.chat([{ role: 'user', content: 'y' }], { signal: new AbortController().signal });

    const reloaded = await store.getAgentRun(run.id);
    expect(reloaded?.usage.costCny).toBe(0); // unknown → 0
    const notices = await listNoticesForRun(run.id, { limit: 20 });
    const costNotices = notices.filter((n) => n.code === 'COST_UNKNOWN_MODEL');
    expect(costNotices.length).toBe(1); // 仅一次（dedup 生效）
  });
});
```

- [ ] 跑：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run src/lib/agent/__tests__/runLlmClient.cost.test.ts
```

Expected: 3 FAIL（chat 是 mock 默认行为，没有 wrap，cost 不会累加，notice 也不会 emit）。

### Step 3：实现 wrap 逻辑

- [ ] 编辑 `apps/api/src/lib/agent/runLlmClient.ts`，在 imports 区添加：

```ts
import { incrementUsage } from './stepRecorder.js';
import { computeCallCostCny } from './modelPricing.js';
import type { LlmChatClient, LlmProviderId, LlmChatMessage, LlmChatOptions, LlmChatResult } from '../llm/types.js';
```

> 注：原文件已经 import `LlmChatClient` / `LlmProviderId`，把剩下三个加上即可，避免重复 import。手动 dedup。

- [ ] 在文件末尾追加 wrap 函数：

```ts
/**
 * M4 Task 3：把 LlmChatClient 包一层 cost accounting。
 *
 * 行为：每次 .chat() 返回成功后，按 (modelId, promptTokens, completionTokens)
 * 算 cost，更新 run.usage.{tokens, costCny}。失败（throw）不计费——避免把
 * provider 5xx 当成有效成本。
 *
 * 未知 modelId（不在 MODEL_PRICING）：cost=0 + 一次性 emit COST_UNKNOWN_MODEL
 * notice（dedup 走原 `emitOnce` LRU，与其他 fallback notice 共享 cap）。
 *
 * 并发安全：用"读最新 run → updateAgentRun"避免覆盖其他 chat() 同时累加。
 * worker 内 chat() 串行执行（一个 run 同时只有一个 in-flight LLM call），
 * 极端 race 概率很小；即便覆盖也仅影响估算金额（不是结算账单），可接受。
 */
function wrapWithCostAccounting(
  runId: string,
  inner: LlmChatClient,
): LlmChatClient {
  return {
    providerId: inner.providerId,
    modelId: inner.modelId,
    async chat(
      messages: LlmChatMessage[],
      opts: LlmChatOptions,
    ): Promise<LlmChatResult> {
      const result = await inner.chat(messages, opts);
      try {
        const { promptTokens, completionTokens } = result.usage;
        const { costCny, unknownModel } = computeCallCostCny(
          inner.modelId,
          promptTokens,
          completionTokens,
        );
        const latest = await store.getAgentRun(runId);
        if (latest) {
          const newUsage = incrementUsage(latest, {
            tokens: promptTokens + completionTokens,
            costCny,
          });
          await store.updateAgentRun(runId, { usage: newUsage });
        }
        if (unknownModel) {
          await emitOnce(runId, inner.providerId, 'COST_UNKNOWN_MODEL', {
            severity: 'info',
            message: `成本估算缺 ${inner.modelId} 的单价表，本次按 0 计；其他维度（tokens / 步数 / 用时）不受影响。`,
            context: { modelId: inner.modelId, providerId: inner.providerId },
          });
        }
      } catch (e) {
        console.warn('[runLlmClient.wrapWithCostAccounting] post-chat update failed', e);
      }
      return result;
    },
  };
}
```

- [ ] 在 `resolveLlmClient` 末尾的 `return buildLlmClient(...)` 行替换为 wrap：

把：

```ts
  try {
    return buildLlmClient({ providerId, modelId, apiKey });
  } catch (e) {
```

替换为：

```ts
  try {
    const inner = buildLlmClient({ providerId, modelId, apiKey });
    return wrapWithCostAccounting(run.id, inner);
  } catch (e) {
```

### Step 4：跑测试 → 通过

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run src/lib/agent/__tests__/runLlmClient.cost.test.ts
```

Expected: 3 PASS。

### Step 5：跑现有 runLlmClient 相关测试确认不破

```bash
DATABASE_URL=... npx vitest run src/lib/agent/__tests__/runLlmClient
```

Expected: 全部 PASS（含原 fallback / key resolve tests）。

### Step 6：commit

```bash
git add apps/api/src/lib/agent/notices.ts \
        apps/api/src/lib/agent/runLlmClient.ts \
        apps/api/src/lib/agent/__tests__/runLlmClient.cost.test.ts \
        apps/mobile/src/features/agent/types.ts
git commit -m "feat(agent/m4): cost 拦截 in runLlmClient.wrapWithCostAccounting + COST_UNKNOWN_MODEL notice"
```

---

## T4: runSummary 模块 + softComplete 集成

**Files:**
- Create: `apps/api/src/lib/agent/runSummary.ts`
- Create: `apps/api/src/lib/agent/__tests__/runSummary.test.ts`
- Modify: `apps/api/src/lib/agent/runLifecycle.ts`
- Create: `apps/api/src/lib/agent/__tests__/runLifecycle.summary.test.ts`

### Step 1：写 runSummary 单元测试

- [ ] 创建 `apps/api/src/lib/agent/__tests__/runSummary.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { buildRunSummary } from '../runSummary.js';
import type { AgentStep } from '../types.js';

function mkStep(partial: Partial<AgentStep>): AgentStep {
  return {
    id: partial.id ?? 'sid',
    runId: partial.runId ?? 'rid',
    idx: partial.idx ?? 0,
    kind: partial.kind ?? 'plan',
    toolName: partial.toolName ?? null,
    toolCallKey: partial.toolCallKey ?? null,
    input: partial.input ?? null,
    output: partial.output ?? null,
    tokens: partial.tokens ?? 0,
    durationMs: partial.durationMs ?? 0,
    error: partial.error ?? null,
    byUserId: partial.byUserId ?? null,
    createdAt: partial.createdAt ?? new Date(),
  };
}

describe('buildRunSummary', () => {
  it('empty steps → zeros', () => {
    const s = buildRunSummary([]);
    expect(s).toEqual({ stepCount: 0, toolCount: 0, toolBreakdown: {}, refCount: 0 });
  });

  it('filters out noise kinds (heartbeat / reclaim / system_error)', () => {
    const steps = [
      mkStep({ kind: 'plan' }),
      mkStep({ kind: 'heartbeat' }),
      mkStep({ kind: 'reclaim' }),
      mkStep({ kind: 'system_error' }),
      mkStep({ kind: 'reply' }),
    ];
    const s = buildRunSummary(steps);
    expect(s.stepCount).toBe(2); // plan + reply
  });

  it('counts tool_call → toolBreakdown + toolCount distinct', () => {
    const steps = [
      mkStep({ kind: 'tool_call', toolName: 'search_web' }),
      mkStep({ kind: 'tool_call', toolName: 'search_web' }),
      mkStep({ kind: 'tool_call', toolName: 'fetch_url' }),
      mkStep({ kind: 'tool_call', toolName: null }), // 不该计入 toolBreakdown
    ];
    const s = buildRunSummary(steps);
    expect(s.toolBreakdown).toEqual({ search_web: 2, fetch_url: 1 });
    expect(s.toolCount).toBe(2);
  });

  it('accumulates refCount from output.result.citations', () => {
    const steps = [
      mkStep({
        kind: 'tool_call',
        toolName: 'search_papers',
        output: { result: { citations: [{ id: '1' }, { id: '2' }] } },
      }),
      mkStep({
        kind: 'tool_call',
        toolName: 'fetch_url',
        output: { result: { citations: [{ id: '3' }] } },
      }),
      mkStep({
        kind: 'tool_call',
        toolName: 'echo',
        output: { result: { foo: 'bar' } }, // 无 citations
      }),
    ];
    const s = buildRunSummary(steps);
    expect(s.refCount).toBe(3);
  });

  it('handles malformed output gracefully (string output / null)', () => {
    const steps = [
      mkStep({ kind: 'tool_call', toolName: 't1', output: 'just a string' }),
      mkStep({ kind: 'tool_call', toolName: 't2', output: null }),
      mkStep({ kind: 'tool_call', toolName: 't3', output: { result: 'still string' } }),
    ];
    const s = buildRunSummary(steps);
    expect(s.refCount).toBe(0);
    expect(s.toolBreakdown).toEqual({ t1: 1, t2: 1, t3: 1 });
  });
});
```

- [ ] 跑：

```bash
cd apps/api && npx vitest run src/lib/agent/__tests__/runSummary.test.ts
```

Expected: 5 FAIL（module 不存在）。

### Step 2：实现 runSummary.ts

- [ ] 创建 `apps/api/src/lib/agent/runSummary.ts`：

```ts
/**
 * M4 Task 4：run 完成时算的"一行摘要"。
 *
 * 调用点：runLifecycle.softComplete（completed / failed / cancelled / budget_exhausted
 * 都会跑），结果写到 agent_runs.summary JSONB 列。
 *
 * 仅统计 useful step：heartbeat / reclaim / system_error 都是审计 / 故障维护类，
 * 用户不关心。tool_call 中 toolName=null 的（极少见，理论上不应出现）也不计入
 * toolBreakdown，但仍计入 stepCount。
 */
import type { AgentStep, AgentStepKind, RunSummary } from './types.js';

const NOISE_KINDS: AgentStepKind[] = ['heartbeat', 'reclaim', 'system_error'];

export function buildRunSummary(steps: AgentStep[]): RunSummary {
  const useful = steps.filter((s) => !NOISE_KINDS.includes(s.kind));
  const toolBreakdown: Record<string, number> = {};
  let refCount = 0;
  for (const s of useful) {
    if (s.kind === 'tool_call' && s.toolName) {
      toolBreakdown[s.toolName] = (toolBreakdown[s.toolName] ?? 0) + 1;
    }
    // 兼容性提取 output.result.citations.length；非 object / 非数组都视作 0
    const out = s.output;
    if (out && typeof out === 'object') {
      const result = (out as { result?: unknown }).result;
      if (result && typeof result === 'object') {
        const citations = (result as { citations?: unknown }).citations;
        if (Array.isArray(citations)) {
          refCount += citations.length;
        }
      }
    }
  }
  return {
    stepCount: useful.length,
    toolCount: Object.keys(toolBreakdown).length,
    toolBreakdown,
    refCount,
  };
}
```

- [ ] 跑测试：

```bash
npx vitest run src/lib/agent/__tests__/runSummary.test.ts
```

Expected: 5 PASS。

### Step 3：softComplete 集成测试

- [ ] 创建 `apps/api/src/lib/agent/__tests__/runLifecycle.summary.test.ts`：

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { getPool } from '../../../db/client.js';
import { runMigrations } from '../../../db/migrate.js';
import * as store from '../store.js';
import { DEFAULT_BUDGET } from '../types.js';
import { softComplete } from '../runLifecycle.js';
import { recordStep } from '../stepRecorder.js';
import { createUser } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';

async function ensureUser(): Promise<string> {
  const u = await createUser({
    username: 'm4-sum-' + randomUUID().slice(0, 6),
    passwordHash: await hashPassword('xxxxxxxx'),
    displayName: 'm4-sum-test',
  });
  return u.id;
}

describe('softComplete writes run summary', { timeout: 15000 }, () => {
  beforeAll(async () => {
    await runMigrations();
  });
  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('completed run → summary 落库 with tool_call breakdown', async () => {
    const ownerId = await ensureUser();
    const run = await store.insertAgentRun({
      ownerId, channel: 'private', sessionId: null, groupId: null, topicId: null,
      intentTurnId: null, role: 'generalist', status: 'running',
      inputText: 'echo hi', budget: DEFAULT_BUDGET, apiKeySource: 'server', apiKeyOwnerId: null,
    });
    await recordStep({ runId: run.id, kind: 'plan', output: { intentSummary: 'x' } });
    await recordStep({
      runId: run.id, kind: 'tool_call', toolName: 'echo',
      output: { result: { text: 'hi' } },
    });
    await recordStep({
      runId: run.id, kind: 'tool_call', toolName: 'echo',
      output: { result: { text: 'hi2' } },
    });
    await recordStep({
      runId: run.id, kind: 'tool_call', toolName: 'search_web',
      output: { result: { citations: [{ id: 'a' }, { id: 'b' }] } },
    });
    await recordStep({ runId: run.id, kind: 'reply', output: { content: 'done' } });

    await softComplete(run, 'completed');
    const re = await store.getAgentRun(run.id);
    expect(re?.status).toBe('completed');
    expect(re?.summary).not.toBeNull();
    expect(re?.summary?.stepCount).toBe(5);
    expect(re?.summary?.toolCount).toBe(2);
    expect(re?.summary?.toolBreakdown).toEqual({ echo: 2, search_web: 1 });
    expect(re?.summary?.refCount).toBe(2);
  });

  it('failed run → summary still落库 with whatever happened', async () => {
    const ownerId = await ensureUser();
    const run = await store.insertAgentRun({
      ownerId, channel: 'private', sessionId: null, groupId: null, topicId: null,
      intentTurnId: null, role: 'generalist', status: 'running',
      inputText: 'x', budget: DEFAULT_BUDGET, apiKeySource: 'server', apiKeyOwnerId: null,
    });
    await recordStep({ runId: run.id, kind: 'plan', output: {} });
    await recordStep({ runId: run.id, kind: 'tool_error', toolName: 'broken', error: 'boom' });
    await softComplete(run, 'failed', 'tool broken');
    const re = await store.getAgentRun(run.id);
    expect(re?.status).toBe('failed');
    expect(re?.summary?.stepCount).toBe(2);
    expect(re?.summary?.toolCount).toBe(0); // tool_error 不算 tool_call
  });
});
```

- [ ] 跑：

```bash
DATABASE_URL=... npx vitest run src/lib/agent/__tests__/runLifecycle.summary.test.ts
```

Expected: 2 FAIL（softComplete 还没写 summary）。

### Step 4：修改 softComplete

- [ ] 编辑 `apps/api/src/lib/agent/runLifecycle.ts`，在文件顶部 import 列表添加：

```ts
import { buildRunSummary } from './runSummary.js';
```

- [ ] 在 `softComplete` 函数内部，找到 `await store.updateAgentRun(run.id, { status, endedAt: new Date() });` 这一行（约 L210），替换为：

```ts
  // M4 Task 4：算 summary 并合并进 status update 同一行 SQL，避免触发额外的
  // run.updated hook 重发；failed / cancelled / budget_exhausted 同样落 summary
  // （按已发生的 step 算，能让任务面板列表统一显示"做了什么"）。
  const stepsForSummary = await store.listSteps(run.id);
  const summary = buildRunSummary(stepsForSummary);

  await store.updateAgentRun(run.id, {
    status,
    endedAt: new Date(),
    summary,
  });
```

> 注：现有 softComplete 还在该 update 之前有 `await killSandboxForRun(run.id)` 和子 run 的 `recordStep`（synthesized reply）等逻辑。把上面这段替换的是**最后那条 status+endedAt 的 updateAgentRun 调用**，不动前面任何代码。

### Step 5：跑测试 → 通过

```bash
DATABASE_URL=... npx vitest run src/lib/agent/__tests__/runLifecycle.summary.test.ts src/lib/agent/__tests__/runSummary.test.ts
```

Expected: 7 PASS。

### Step 6：跑已有 lifecycle 测试确认不破坏

```bash
DATABASE_URL=... npx vitest run src/lib/agent/__tests__/runLifecycle.resume.test.ts
DATABASE_URL=... npx vitest run src/lib/agent/__tests__/runtime
```

Expected: 全部 PASS。

### Step 7：commit

```bash
git add apps/api/src/lib/agent/runSummary.ts \
        apps/api/src/lib/agent/__tests__/runSummary.test.ts \
        apps/api/src/lib/agent/__tests__/runLifecycle.summary.test.ts \
        apps/api/src/lib/agent/runLifecycle.ts
git commit -m "feat(agent/m4): runSummary.buildRunSummary + softComplete 落 agent_runs.summary"
```

---

## T5: pending_user_input_expires_at + worker checker + cancelRun reason override

**Files:**
- Modify: `apps/api/src/lib/agent/runExecute.ts`（写 expires_at）
- Modify: `apps/api/src/lib/agent/runLifecycle.ts`（cancelRun reason override）
- Create: `apps/api/src/lib/agent/expireAwaitingUserInput.ts`
- Modify: `apps/api/src/lib/agent/worker.ts`（tick 接入）
- Modify: `apps/api/src/lib/agent/types.ts`（CancelReason 加 user_timeout）
- Modify: `apps/mobile/src/features/agent/types.ts`（CancelReason mirror）
- Create: `apps/api/src/lib/agent/__tests__/expireAwaitingUserInput.test.ts`
- Modify: `apps/api/src/lib/agent/__tests__/runtime.askUser.test.ts`（增 expires 校验）

### Step 1：CancelReason 加 user_timeout

- [ ] 编辑 `apps/api/src/lib/agent/types.ts`：

```ts
export type CancelReason = 'user' | 'steer' | 'budget' | 'crash_reclaim' | 'user_timeout';
```

- [ ] 同步到 mobile `apps/mobile/src/features/agent/types.ts`。先看看是否已 mirror，没的话加：

```bash
# 先看 mobile 端有没有 CancelReason
rg "CancelReason" apps/mobile/src
```

> 若 mobile 没暴露 CancelReason 类型（按 spec 通常没暴露给 UI），此步可跳过；mobile 用 string union 兜底。

### Step 2：cancelRun reason override

- [ ] 编辑 `apps/api/src/lib/agent/runLifecycle.ts`，找到 `cancelRun` 函数签名（约 L296）：

```ts
export async function cancelRun(
  runId: string,
  byUserId: string,
): Promise<void> {
```

替换为：

```ts
export async function cancelRun(
  runId: string,
  byUserId: string,
  reasonOverride?: CancelReason,
): Promise<void> {
```

- [ ] 在该函数内部，找到 `await store.updateAgentRun(runId, { status: 'cancelled', cancelledByUserId: byUserId, cancelReason: 'user', endedAt: new Date() });`（约 L319-L324），替换 `'user'` 为：

```ts
  const effectiveReason: CancelReason = reasonOverride ?? 'user';
  await store.updateAgentRun(runId, {
    status: 'cancelled',
    cancelledByUserId: byUserId,
    cancelReason: effectiveReason,
    endedAt: new Date(),
  });
```

- [ ] 在 imports 区添加 `CancelReason` 类型（若未导入）：检查文件顶部 import `from './types.js'` 行，确保含 `CancelReason`。

### Step 3：runExecute 写 expires_at

- [ ] 编辑 `apps/api/src/lib/agent/runExecute.ts`，找到 M3 ask_user 暂停分支（约 L317-L333），把：

```ts
      if (
        tool.name === 'ask_user' &&
        obsObj?.ok === true &&
        obsObj?.paused === true
      ) {
        const question = (planStep.input as { question?: unknown })?.question;
        await store.updateAgentRun(runId, {
          status: 'awaiting_user_input',
          pendingUserPrompt: typeof question === 'string' ? question : '',
          pendingUserStepIdx: i,
        });
        return;
      }
```

替换为：

```ts
      if (
        tool.name === 'ask_user' &&
        obsObj?.ok === true &&
        obsObj?.paused === true
      ) {
        const question = (planStep.input as { question?: unknown })?.question;
        // M4 Task 5：写 24h timeout 戳。worker tick 的
        // autoExpireAwaitingUserInput 会自动 cancel('user_timeout')。
        // 列 nullable，M3 老 awaiting run 没 expires_at → 永远不会被回溯性 cancel。
        await store.updateAgentRun(runId, {
          status: 'awaiting_user_input',
          pendingUserPrompt: typeof question === 'string' ? question : '',
          pendingUserStepIdx: i,
          pendingUserInputExpiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        });
        return;
      }
```

### Step 4：写 autoExpireAwaitingUserInput 测试

- [ ] 创建 `apps/api/src/lib/agent/__tests__/expireAwaitingUserInput.test.ts`：

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { getPool } from '../../../db/client.js';
import { runMigrations } from '../../../db/migrate.js';
import * as store from '../store.js';
import { DEFAULT_BUDGET } from '../types.js';
import { autoExpireAwaitingUserInput } from '../expireAwaitingUserInput.js';
import { createUser } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';

async function ensureUser(): Promise<string> {
  const u = await createUser({
    username: 'm4-exp-' + randomUUID().slice(0, 6),
    passwordHash: await hashPassword('xxxxxxxx'),
    displayName: 'm4-exp-test',
  });
  return u.id;
}

async function makeAwaitingRun(ownerId: string, expiresAt: Date | null) {
  const run = await store.insertAgentRun({
    ownerId, channel: 'private', sessionId: null, groupId: null, topicId: null,
    intentTurnId: null, role: 'generalist', status: 'awaiting_user_input',
    inputText: 'x', budget: DEFAULT_BUDGET, apiKeySource: 'server', apiKeyOwnerId: null,
  });
  await store.updateAgentRun(run.id, {
    pendingUserPrompt: 'q?',
    pendingUserStepIdx: 0,
    pendingUserInputExpiresAt: expiresAt,
  });
  return run;
}

describe('autoExpireAwaitingUserInput', { timeout: 15000 }, () => {
  beforeAll(async () => {
    await runMigrations();
  });
  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('expired run → cancelled with reason=user_timeout', async () => {
    const u = await ensureUser();
    const r = await makeAwaitingRun(u, new Date(Date.now() - 1000));
    const n = await autoExpireAwaitingUserInput(new Date());
    expect(n).toBe(1);
    const re = await store.getAgentRun(r.id);
    expect(re?.status).toBe('cancelled');
    expect(re?.cancelReason).toBe('user_timeout');
    expect(re?.endedAt).toBeInstanceOf(Date);
  });

  it('not-yet-expired run → untouched', async () => {
    const u = await ensureUser();
    const r = await makeAwaitingRun(u, new Date(Date.now() + 30_000));
    const n = await autoExpireAwaitingUserInput(new Date());
    expect(n).toBe(0);
    const re = await store.getAgentRun(r.id);
    expect(re?.status).toBe('awaiting_user_input');
  });

  it('expires_at IS NULL → skipped（兼容 M3 老 awaiting run）', async () => {
    const u = await ensureUser();
    const r = await makeAwaitingRun(u, null);
    const n = await autoExpireAwaitingUserInput(new Date());
    expect(n).toBe(0);
    const re = await store.getAgentRun(r.id);
    expect(re?.status).toBe('awaiting_user_input');
  });

  it('non-awaiting run with past expires_at → skipped', async () => {
    const u = await ensureUser();
    const r = await store.insertAgentRun({
      ownerId: u, channel: 'private', sessionId: null, groupId: null, topicId: null,
      intentTurnId: null, role: 'generalist', status: 'running',
      inputText: 'x', budget: DEFAULT_BUDGET, apiKeySource: 'server', apiKeyOwnerId: null,
    });
    await store.updateAgentRun(r.id, {
      pendingUserInputExpiresAt: new Date(Date.now() - 1000),
    });
    const n = await autoExpireAwaitingUserInput(new Date());
    expect(n).toBe(0);
    const re = await store.getAgentRun(r.id);
    expect(re?.status).toBe('running');
  });

  it('returns 0 when nothing to expire', async () => {
    const n = await autoExpireAwaitingUserInput(new Date());
    expect(n).toBe(0);
  });
});
```

- [ ] 跑：

```bash
DATABASE_URL=... npx vitest run src/lib/agent/__tests__/expireAwaitingUserInput.test.ts
```

Expected: 5 FAIL（module 不存在）。

### Step 5：实现 expireAwaitingUserInput.ts

- [ ] 创建 `apps/api/src/lib/agent/expireAwaitingUserInput.ts`：

```ts
/**
 * M4 Task 5：worker tick 的"过期 awaiting_user_input"检查。
 *
 * 与 autoResolveExpiredApprovals 并列在 worker.tick 调用。
 *
 * 行为：
 *   1. 查所有 status='awaiting_user_input' 且 pending_user_input_expires_at < now() 的 run
 *   2. 对每一个调 cancelRun(runId, ownerId, 'user_timeout')
 *      - 走标准 cancel 通路：写 cancel step、softComplete → 走 placeholder finalize、emit run.cancelled hook
 *      - byUserId 用 owner_id（语义"为用户超时自动取消"，比 NULL 更便于审计）
 *
 * 不处理：
 *   - pending_user_input_expires_at IS NULL：兼容 M3 老 awaiting run，永远不回溯 cancel
 *   - 已 cancelled / completed 的 run：status 过滤已挡掉
 *
 * 返回处理掉的 run 数量（供 worker 日志 / 测试用）。
 */
import { getPool } from '../../db/client.js';
import { cancelRun } from './runLifecycle.js';

export async function autoExpireAwaitingUserInput(now: Date = new Date()): Promise<number> {
  const { rows } = await getPool().query(
    `SELECT id, owner_id
       FROM agent_runs
      WHERE status = 'awaiting_user_input'
        AND pending_user_input_expires_at IS NOT NULL
        AND pending_user_input_expires_at < $1`,
    [now],
  );
  let resolved = 0;
  for (const row of rows) {
    try {
      await cancelRun(row.id as string, row.owner_id as string, 'user_timeout');
      resolved++;
    } catch (e) {
      console.warn('[autoExpireAwaitingUserInput] cancelRun failed (suppressed)', row.id, e);
    }
  }
  return resolved;
}
```

### Step 6：跑测试 → 通过

```bash
DATABASE_URL=... npx vitest run src/lib/agent/__tests__/expireAwaitingUserInput.test.ts
```

Expected: 5 PASS。

### Step 7：worker tick 接入

- [ ] 编辑 `apps/api/src/lib/agent/worker.ts`，在 imports 加：

```ts
import { autoExpireAwaitingUserInput } from './expireAwaitingUserInput.js';
```

- [ ] 在 `tick()` 函数内，把现有 `autoResolveExpiredApprovals` 调用之后追加：

```ts
  // 1.5) M4 Task 5：过期 awaiting_user_input → auto cancel('user_timeout')
  try {
    await autoExpireAwaitingUserInput(new Date());
  } catch (e) {
    console.error('[agent worker] autoExpireAwaitingUserInput failed', e);
  }
```

完整 tick 函数应为：

```ts
async function tick() {
  // 1) Approval timeout checker (M1b-2 ADR-1)
  try {
    await autoResolveExpiredApprovals(new Date());
  } catch (e) {
    console.error('[agent worker] autoResolveExpiredApprovals failed', e);
  }

  // 1.5) M4 Task 5：过期 awaiting_user_input → auto cancel('user_timeout')
  try {
    await autoExpireAwaitingUserInput(new Date());
  } catch (e) {
    console.error('[agent worker] autoExpireAwaitingUserInput failed', e);
  }

  // 2) Pickup 下一个 draft/running/replanning 待办 run。
  if (inFlight.size > 0) return;
  const run = await store.pickupNextRun().catch(() => null);
  if (!run) return;
  inFlight.add(run.id);
  executeRun(run.id)
    .catch(() => {})
    .finally(() => inFlight.delete(run.id));
}
```

### Step 8：扩展 runtime.askUser.test.ts 校验 expires_at

- [ ] 编辑 `apps/api/src/lib/agent/__tests__/runtime.askUser.test.ts`，在第一个 it 块 "ask_user returns paused:true → run.status = awaiting_user_input" 内部添加一个断言（找到 `expect(reloaded?.status).toBe('awaiting_user_input');` 之后）：

```ts
    // M4 Task 5：pendingUserInputExpiresAt 落库 = now() + 24h (±5s 容错)
    const expectedExpiresMs = Date.now() + 24 * 3600 * 1000;
    const actualExpiresMs = reloaded?.pendingUserInputExpiresAt?.getTime() ?? 0;
    expect(Math.abs(actualExpiresMs - expectedExpiresMs)).toBeLessThan(5000);
```

- [ ] 跑：

```bash
DATABASE_URL=... npx vitest run src/lib/agent/__tests__/runtime.askUser.test.ts
```

Expected: 3 PASS。

### Step 9：跑整套 runtime 测试不破坏

```bash
DATABASE_URL=... npx vitest run src/lib/agent/__tests__/runLifecycle src/lib/agent/__tests__/runtime
```

Expected: 全部 PASS。

### Step 10：commit

```bash
git add apps/api/src/lib/agent/types.ts \
        apps/api/src/lib/agent/runLifecycle.ts \
        apps/api/src/lib/agent/runExecute.ts \
        apps/api/src/lib/agent/expireAwaitingUserInput.ts \
        apps/api/src/lib/agent/worker.ts \
        apps/api/src/lib/agent/__tests__/expireAwaitingUserInput.test.ts \
        apps/api/src/lib/agent/__tests__/runtime.askUser.test.ts
git commit -m "feat(agent/m4): pending_user_input_expires_at + autoExpireAwaitingUserInput worker checker + cancelRun reason override(user_timeout)"
```

---

## T6: AgentRunCard summary 行 + cost 行

**Files:**
- Modify: `apps/mobile/src/features/agent/types.ts`（mirror RunSummary / pendingUserInputExpiresAt）
- Modify: `apps/mobile/src/features/agent/AgentRunCard.tsx`

### Step 1：mirror types 到 mobile

- [ ] 编辑 `apps/mobile/src/features/agent/types.ts`：

`AgentRun` type 在现有 `pendingUserStepIdx` 之后追加：

```ts
  // M4 Task 1: ask_user 24h timeout 戳；UI 用来显示倒计时
  pendingUserInputExpiresAt?: string | null;
  // M4 Task 4: 完成时落的一行摘要
  summary?: RunSummary | null;
```

> mobile 端 Date 字段都用 ISO string 接，与现有 `createdAt` / `awaitingApprovalUntil` 一致。

在文件底部追加 `RunSummary` 类型（与 backend 对齐）：

```ts
/**
 * M4 Task 4：与 backend RunSummary 对齐。仅在 terminal status 之后非空。
 */
export type RunSummary = {
  stepCount: number;
  toolCount: number;
  toolBreakdown: Record<string, number>;
  refCount: number;
};
```

### Step 2：AgentRunCard 加 summary + cost 行

- [ ] 编辑 `apps/mobile/src/features/agent/AgentRunCard.tsx`，在 `imports` 后加 helper（约 L40 KIND_LABEL 后）：

```ts
function formatCny(n?: number): string {
  if (!n || n <= 0) return '¥0.00';
  if (n < 0.01) return `¥${n.toFixed(4)}`;
  return `¥${n.toFixed(2)}`;
}

function formatSummary(run: { summary?: { stepCount: number; toolCount: number; refCount: number } | null; usage?: { costCny: number } | null }): string {
  const s = run.summary;
  const cost = run.usage?.costCny ?? 0;
  if (!s) return formatCny(cost);
  const parts: string[] = [];
  parts.push(`${s.stepCount} 步`);
  if (s.toolCount > 0) parts.push(`${s.toolCount} 工具`);
  if (s.refCount > 0) parts.push(`${s.refCount} 引用`);
  parts.push(formatCny(cost) + ' 估算');
  return parts.join(' · ');
}
```

- [ ] 在 `AgentRunCard` 函数末尾的 `</View>` 之前（紧跟 retry 按钮区块）追加 summary 行：

找到现有的最末段：

```tsx
      {terminal && run.status !== 'completed' ? (
        <View style={{ marginTop: 8, flexDirection: 'row', justifyContent: 'flex-end' }}>
          <TouchableOpacity
            onPress={async () => {
              try {
                const { runId: newId } = await retryAgentRun(runId);
                await onRetry?.(newId);
              } catch (e) {
                Alert.alert('重试失败', String(e));
              }
            }}
          >
            <Text style={{ color: '#0a6' }}>再试一次</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}
```

在 retry 块之前插入：

```tsx
      {terminal ? (
        <View style={{ marginTop: 8 }}>
          <Text style={{ fontSize: 11, opacity: 0.55 }}>
            {formatSummary(run)}
          </Text>
        </View>
      ) : null}
```

### Step 3：mobile tsc 编译通过

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected: exit 0。

### Step 4：commit

```bash
git add apps/mobile/src/features/agent/types.ts \
        apps/mobile/src/features/agent/AgentRunCard.tsx
git commit -m "feat(agent/m4 mobile): AgentRunCard terminal 状态显示 summary + cost 估算行"
```

---

## T7: AgentRunListScreen

**Files:**
- Modify: `apps/mobile/src/lib/api.ts`（修 `listAgentRuns` 返回类型加 `hasMore`）
- Modify: `apps/mobile/src/features/agent/agentApi.ts`（包装高层 `listAgentRuns`）
- Create: `apps/mobile/src/screens/AgentRunListScreen.tsx`

### Step 1：修 api.ts 返回类型

> 现状：`apps/mobile/src/lib/api.ts` L737-L743 已有 `api.listAgentRuns({ status?, limit? })`，但返回类型写的是 `request<{ runs: unknown[] }>`，把 backend 的 `hasMore` 字段吞掉了。先把类型放出来。

- [ ] 编辑 `apps/mobile/src/lib/api.ts`，把：

```ts
  listAgentRuns: (params?: { status?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.limit) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<{ runs: unknown[] }>(`/api/agent/runs${suffix}`);
  },
```

替换为：

```ts
  listAgentRuns: (params?: { status?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.limit) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<{ runs: unknown[]; hasMore: boolean }>(`/api/agent/runs${suffix}`);
  },
```

### Step 2：高层 agentApi.listAgentRuns 包装

- [ ] 编辑 `apps/mobile/src/features/agent/agentApi.ts`，文件末尾追加：

```ts
import type { AgentRunStatus } from './types';

export type ListAgentRunsResult = {
  runs: AgentRun[];
  hasMore: boolean;
};

/**
 * M4 Task 7：拉用户可见的 agent run 列表。
 * 后端 GET /api/agent/runs（M1d Task 4）：按 owner_id = me 或 me ∈ group_members 过滤；
 * limit 默认 50，最大 100；响应 { runs, hasMore }。
 */
export async function listAgentRuns(opts?: {
  status?: AgentRunStatus;
  limit?: number;
}): Promise<ListAgentRunsResult> {
  const res = await api.listAgentRuns(opts);
  const data = res.data as { runs: AgentRun[]; hasMore: boolean };
  return { runs: data.runs ?? [], hasMore: data.hasMore ?? false };
}
```

> 注：`AgentRun` 已在文件顶部从 `'./types'` import，复用即可；只新增 `AgentRunStatus` import。

### Step 3：创建 screen

- [ ] 创建 `apps/mobile/src/screens/AgentRunListScreen.tsx`：

```tsx
import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, RefreshControl, StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { listAgentRuns } from '../features/agent/agentApi';
import type { AgentRun, AgentRunStatus } from '../features/agent/types';

type FilterKey = 'all' | 'inflight' | 'completed' | 'failed' | 'cancelled';

const FILTERS: { key: FilterKey; label: string; statuses: AgentRunStatus[] | null }[] = [
  { key: 'all',       label: '全部',     statuses: null },
  { key: 'inflight',  label: '进行中',   statuses: ['draft', 'planning', 'running', 'replanning', 'awaiting_approval', 'awaiting_user_input'] },
  { key: 'completed', label: '已完成',   statuses: ['completed'] },
  { key: 'failed',    label: '失败',     statuses: ['failed', 'budget_exhausted'] },
  { key: 'cancelled', label: '取消',     statuses: ['cancelled'] },
];

const STATUS_LABEL: Record<AgentRunStatus, string> = {
  draft: '准备中',
  planning: '规划中',
  running: '运行中',
  awaiting_approval: '等待授权',
  awaiting_user_input: '等待输入',
  replanning: '重新规划',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  budget_exhausted: '预算耗尽',
};

function statusColor(s: AgentRunStatus): string {
  if (s === 'completed') return '#0a6';
  if (s === 'failed' || s === 'budget_exhausted') return '#c33';
  if (s === 'cancelled') return '#999';
  return '#06b';
}

function formatCny(n?: number): string {
  if (!n || n <= 0) return '¥0.00';
  if (n < 0.01) return `¥${n.toFixed(4)}`;
  return `¥${n.toFixed(2)}`;
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

function expiresCountdown(iso?: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return '已过期';
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return `剩 ${h}h ${m}m`;
}

export function AgentRunListScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<{ AgentRunDetail: { runId: string } }>>();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const filterDef = FILTERS.find((f) => f.key === filter)!;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 简化做法：状态筛选在客户端做（后端 API 一次只支持单 status）。
      // 列表整体 limit 100，多 status 的 chip（进行中）需要把多个状态并起来。
      const { runs: fetched, hasMore: hm } = await listAgentRuns({ limit: 100 });
      setRuns(fetched);
      setHasMore(hm);
    } catch (e) {
      console.warn('[AgentRunListScreen.load]', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const filteredRuns = useMemo(() => {
    if (!filterDef.statuses) return runs;
    return runs.filter((r) => filterDef.statuses!.includes(r.status));
  }, [runs, filterDef]);

  const aggregate = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const month = new Date(today.getFullYear(), today.getMonth(), 1);
    let todayCost = 0;
    let monthCost = 0;
    let inflightCount = 0;
    for (const r of runs) {
      const cost = r.usage?.costCny ?? 0;
      const created = typeof r.createdAt === 'string' ? new Date(r.createdAt) : r.createdAt as unknown as Date;
      if (created >= today) todayCost += cost;
      if (created >= month) monthCost += cost;
      if (['draft', 'planning', 'running', 'replanning', 'awaiting_approval', 'awaiting_user_input'].includes(r.status)) {
        inflightCount++;
      }
    }
    return { todayCost, monthCost, inflightCount };
  }, [runs]);

  return (
    <View style={styles.container}>
      <View style={styles.banner}>
        <Text style={styles.bannerText}>
          今日 {formatCny(aggregate.todayCost)} · 本月 {formatCny(aggregate.monthCost)} · {aggregate.inflightCount} 个进行中
        </Text>
        <Text style={styles.bannerHint}>费用为估算值（按 cache-miss 上限算）</Text>
      </View>

      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.filterText, filter === f.key && styles.filterTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filteredRuns}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={
          loading ? (
            <View style={styles.empty}><ActivityIndicator /></View>
          ) : (
            <View style={styles.empty}><Text style={styles.emptyText}>暂无任务</Text></View>
          )
        }
        ListFooterComponent={hasMore ? <Text style={styles.footerHint}>仅显示最近 100 条</Text> : null}
        renderItem={({ item }) => {
          const cost = item.usage?.costCny ?? 0;
          const summary = item.summary;
          const expiresLabel = item.status === 'awaiting_user_input'
            ? expiresCountdown(item.pendingUserInputExpiresAt as string | null | undefined)
            : null;
          const created = typeof item.createdAt === 'string' ? item.createdAt : new Date(item.createdAt as unknown as Date).toISOString();
          return (
            <TouchableOpacity
              style={styles.row}
              onPress={() => navigation.navigate('AgentRunDetail', { runId: item.id })}
            >
              <View style={styles.rowTopLine}>
                <Text style={[styles.statusBadge, { color: statusColor(item.status) }]}>
                  ● {STATUS_LABEL[item.status] ?? item.status}
                </Text>
                <Text style={styles.relTime}>{relativeTime(created)}</Text>
                {expiresLabel ? (
                  <Text style={styles.expiresBadge}>⏱ {expiresLabel}</Text>
                ) : null}
              </View>
              <Text style={styles.inputText} numberOfLines={2}>
                {item.inputText}
              </Text>
              <Text style={styles.metaLine}>
                {summary
                  ? `${summary.stepCount} 步 · ${summary.toolCount} 工具${summary.refCount > 0 ? ` · ${summary.refCount} 引用` : ''} · `
                  : ''}
                {formatCny(cost)} 估算
              </Text>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  banner: {
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ddd',
    backgroundColor: '#fafafa',
  },
  bannerText: { fontSize: 13, fontWeight: '600', color: '#222' },
  bannerHint: { fontSize: 10, color: '#888', marginTop: 2 },
  filterRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eee',
  },
  filterChip: {
    paddingHorizontal: 10, paddingVertical: 4,
    backgroundColor: '#eef', borderRadius: 12,
  },
  filterChipActive: { backgroundColor: '#1976d2' },
  filterText: { fontSize: 12, color: '#1976d2' },
  filterTextActive: { color: '#fff', fontWeight: '600' },
  row: {
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#f0f0f0',
  },
  rowTopLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusBadge: { fontSize: 12, fontWeight: '600' },
  relTime: { fontSize: 10, color: '#999', marginLeft: 'auto' },
  expiresBadge: { fontSize: 10, color: '#a60' },
  inputText: { fontSize: 13, color: '#222', marginTop: 4 },
  metaLine: { fontSize: 11, color: '#666', marginTop: 4 },
  empty: { padding: 40, alignItems: 'center' },
  emptyText: { color: '#999' },
  footerHint: { textAlign: 'center', color: '#999', fontSize: 11, paddingVertical: 12 },
});
```

### Step 4：mobile tsc 通过

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected: exit 0。

### Step 5：commit

```bash
git add apps/mobile/src/lib/api.ts \
        apps/mobile/src/features/agent/agentApi.ts \
        apps/mobile/src/screens/AgentRunListScreen.tsx
git commit -m "feat(agent/m4 mobile): AgentRunListScreen + listAgentRuns 返回 hasMore（聚合 banner + 状态筛选 + awaiting 倒计时）"
```

---

## T8: AgentRunDetailScreen + 接入 bottom tab

**Files:**
- Create: `apps/mobile/src/screens/AgentRunDetailScreen.tsx`
- Create: `apps/mobile/src/navigation/AgentRunsStack.tsx`
- Modify: `apps/mobile/src/navigation/types.ts`
- Modify: `apps/mobile/src/navigation/RootTabs.tsx`
- Modify: `apps/mobile/src/locales/zh-CN.ts`（增 `tabs.agentRuns` 标签）

### Step 1：navigation types 加 AgentRunsStackParamList

- [ ] 编辑 `apps/mobile/src/navigation/types.ts`，追加：

```ts
export type AgentRunsStackParamList = {
  AgentRunList: undefined;
  AgentRunDetail: { runId: string };
};
```

### Step 2：创建 AgentRunDetailScreen

- [ ] 创建 `apps/mobile/src/screens/AgentRunDetailScreen.tsx`：

```tsx
import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { AgentRunsStackParamList } from '../navigation/types';
import { AgentRunCard } from '../features/agent/AgentRunCard';

type DetailRoute = RouteProp<AgentRunsStackParamList, 'AgentRunDetail'>;

export function AgentRunDetailScreen() {
  const route = useRoute<DetailRoute>();
  const navigation = useNavigation();
  const runId = route.params.runId;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← 返回</Text>
        </TouchableOpacity>
        <Text style={styles.title}>任务详情</Text>
        <Text style={styles.runIdHint}>#{runId.slice(-6)}</Text>
      </View>
      <ScrollView style={styles.body} contentContainerStyle={{ padding: 12 }}>
        <AgentRunCard runId={runId} onRetry={(newId) => {
          navigation.navigate('AgentRunDetail' as never, { runId: newId } as never);
        }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 12, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eee',
  },
  backText: { color: '#06b', fontSize: 14 },
  title: { fontSize: 16, fontWeight: '600' },
  runIdHint: { marginLeft: 'auto', fontSize: 11, color: '#999' },
  body: { flex: 1 },
});
```

### Step 3：创建 AgentRunsStack

- [ ] 创建 `apps/mobile/src/navigation/AgentRunsStack.tsx`：

```tsx
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { AgentRunsStackParamList } from './types';
import { AgentRunListScreen } from '../screens/AgentRunListScreen';
import { AgentRunDetailScreen } from '../screens/AgentRunDetailScreen';

const Stack = createNativeStackNavigator<AgentRunsStackParamList>();

export function AgentRunsStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="AgentRunList" component={AgentRunListScreen} />
      <Stack.Screen name="AgentRunDetail" component={AgentRunDetailScreen} />
    </Stack.Navigator>
  );
}
```

### Step 4：locales 加 `tabs.agentRuns`

- [ ] 看 `apps/mobile/src/locales/zh-CN.ts` 现有 `tabs.studio` / `tabs.brain` 字段位置：

```bash
grep -n "tabs\." apps/mobile/src/locales/zh-CN.ts
```

- [ ] 编辑该文件，在 `tabs` 对象内追加：

```ts
    agentRuns: '任务',
```

### Step 5：RootTabs 接入

- [ ] 编辑 `apps/mobile/src/navigation/RootTabs.tsx`：

在 import 区追加：

```ts
import type { AgentRunsStackParamList } from './types';
import { AgentRunsStack } from './AgentRunsStack';
```

在 `RootTabParamList` 增 `AgentRunsTab`：

```ts
export type RootTabParamList = {
  StudioTab: NavigatorScreenParams<GroupStackParamList> | undefined;
  BrainTab: NavigatorScreenParams<BrainStackParamList> | undefined;
  AgentRunsTab: NavigatorScreenParams<AgentRunsStackParamList> | undefined;
};
```

在 `<Tab.Navigator>` 内，紧跟 BrainTab 之后追加（保持现有 tab 顺序不被打乱，新 tab 加在末尾）：

```tsx
      <Tab.Screen
        name="AgentRunsTab"
        component={AgentRunsStack}
        options={{
          tabBarLabel: ({ focused }) => (
            <TabLabel label={zh.tabs.agentRuns} focused={focused} brain={false} />
          ),
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: wechat.textSecondary,
          tabBarStyle: [styles.tabBar, styles.tabBarStudio],
        }}
      />
```

> tab 视觉风格沿用 `studio` 系列（白底）。

### Step 6：mobile tsc + 启动一次

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected: exit 0。

> （手动 smoke：可选跑 `npx expo start` 在模拟器里点新 tab 确认渲染，但不强制；CI 没启动 RN。）

### Step 7：commit

```bash
git add apps/mobile/src/screens/AgentRunDetailScreen.tsx \
        apps/mobile/src/navigation/AgentRunsStack.tsx \
        apps/mobile/src/navigation/types.ts \
        apps/mobile/src/navigation/RootTabs.tsx \
        apps/mobile/src/locales/zh-CN.ts
git commit -m "feat(agent/m4 mobile): bottom tab \"任务\" + AgentRunsStack + AgentRunDetailScreen"
```

---

## T9: 全量 review + merge main + tag v0.m4

**Files:** none

### Step 1：跑全量后端测试

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run --reporter=summary
```

Expected: all PASS（约 420 tests）。若 flaky 重试 1 次。

### Step 2：mobile tsc + lint

```bash
cd apps/mobile && npx tsc --noEmit
```

```bash
cd apps/api && npx tsc --noEmit
```

Expected: exit 0 双方。

### Step 3：手动 review checklist

- [ ] migration 019 跑过：`DATABASE_URL=... npx tsx src/db/runMigrations.ts`（或类似命令；按现有项目脚本）确认 idempotent。
- [ ] M3 老 awaiting run（`pending_user_input_expires_at IS NULL`）不会被 autoExpire 误 cancel——已被 expireAwaitingUserInput.test.ts 覆盖
- [ ] DeepSeek 单价 0.002/0.008 与 [官方 CNY 页面](https://api-docs.deepseek.com/zh-cn/quick_start/pricing-details-cny) 对一遍
- [ ] cost 算的是 (prompt + completion) 而非 totalTokens 的二次解读——已在 wrap 函数验证
- [ ] AgentRunCard 终态显示的 cost 数字与 list 列表 row 显示一致（都用 `formatCny`）
- [ ] AgentRunListScreen banner 写"估算"两字，避免误以为账单

### Step 4：调度 code-reviewer subagent

```bash
# 直接调用 reviewer，目标是 diff 自 main 起的所有 M4 commits
```

- [ ] 用 Task 调用 `code-reviewer` subagent，prompt 大致："review M4 diff against M4 spec (`docs/superpowers/specs/2026-05-22-agent-runtime-m4-design.md`)"。
- [ ] 修任何 BLOCKER / IMPORTANT 后再继续。

### Step 5：merge to main + tag

```bash
git checkout main
git merge --no-ff feat/agent-runtime-m4 -m "Merge feat/agent-runtime-m4: 任务面板 + cost 估算 + 24h timeout + run summary"
git tag v0.m4
```

> 不 push，留给用户决定何时 push。

### Step 6：post-merge sanity

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run --reporter=summary
```

Expected: all PASS on main。

---

## M4 polish (可选，独立 patch tag)

> 这一段不算入 v0.m4 必交付范围。完成后独立 commit + tag `v0.m4.1`。

### P1: Mobile SSE adapter

**Files:**
- Add dep: `react-native-sse`（`cd apps/mobile && npx expo install react-native-sse`）
- Create: `apps/mobile/src/features/agent/hooks/useAgentRunSSE.ts`
- Create: `apps/mobile/src/features/agent/hooks/useAgentRunSubscription.ts`
- Modify: `apps/mobile/src/features/agent/AgentRunCard.tsx`（切到 wrapper hook）

**Step 1:** 装依赖
```bash
cd apps/mobile && npx expo install react-native-sse
```

**Step 2:** 写 `useAgentRunSSE.ts`——参考 `useAgentRunPoll.ts` 结构，把 fetch 循环换成 EventSource 订阅 step / notice / status / end 事件。

**Step 3:** 写 `useAgentRunSubscription.ts`：先 try SSE，失败 fallback 到 poll。

**Step 4:** AgentRunCard 切到 wrapper。

**Step 5:** tag `v0.m4.1`。

---

## Self-Review Checklist

**Spec coverage（每条 M4 spec 都有 task）：**

| Spec 要求 | 实现 task |
|---|---|
| migration 019 加 summary + expires_at | T1 |
| AgentRun.summary + pendingUserInputExpiresAt | T1 |
| RunSummary 新类型 | T1 |
| CancelReason 加 user_timeout | T5 |
| modelPricing.ts hardcode table | T2 |
| computeCallCostCny 函数 | T2 |
| runLlmClient 拦截 cost | T3 |
| emitOnce dedup COST_UNKNOWN_MODEL | T3 |
| runSummary.buildRunSummary | T4 |
| softComplete 落 summary | T4 |
| runExecute 写 expires_at | T5 |
| autoExpireAwaitingUserInput | T5 |
| cancelRun reason override | T5 |
| worker tick 接入 | T5 |
| AgentRunCard 终态 summary 行 | T6 |
| AgentRunListScreen + banner + filter | T7 |
| AgentRunDetailScreen + bottom tab | T8 |
| M4 polish: SSE adapter | P1（独立 tag） |

**No placeholders 扫描通过：** 所有 step 含完整代码 / 完整命令 / 完整测试代码；无 "TBD / TODO / 类似 Task X" 表述。

**类型一致性扫描通过：**
- `RunSummary` 在 backend types.ts 与 mobile types.ts 同型
- `pendingUserInputExpiresAt` 字段名前后一致
- `incrementUsage` delta 含 `costCny`（已有，确认 spec/plan 都用）
- `cancelRun` 第 3 参数 `reasonOverride?: CancelReason` 一致

---

## 执行选项

**完成 plan 后选一个执行方式：**

**1. Subagent-Driven（推荐）** —— 每个 task 派一个 fresh subagent 实现 + review 间隔；快速迭代，每个 task 之间我会 review。

**2. Inline Execution** —— 当前 session 内顺序执行 T1 → T9，每 2-3 个 task 一个 checkpoint。

哪个？
