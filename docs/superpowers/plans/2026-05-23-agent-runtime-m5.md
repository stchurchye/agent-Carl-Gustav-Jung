# Agent Runtime M5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 M4 可观测的基础上做"产物可复用 + 模型自由切换"——M5 = M5A（Run Artifacts）+ M5B（Multi-Model UI），让用户既能拿到独立于聊天的最终产物（含结构化引用），又能在发起任务前自主选模型。

**Architecture:**

M5A 复用 M4 已有的 `softComplete` / `RunSummary` / `collectReplyRefs` 全部基础设施。新增：
1. DB column `agent_runs.artifact JSONB NULL`（与 `summary` 平级）。
2. `softComplete` 在算 `summary` 同时算 `RunArtifact = { finalContent, refs[], modelSnapshot, producedAt, diagramIds? }` 并合并 update。
3. Mobile `BrainAgentTaskDetailScreen` 顶部展示 artifact 卡片，支持"复制全文 / 跳转引用"。

M5B 后端基础设施已就位（M1e 加的 `providerId`/`modelId` 列 + `resolveLlmClient` 路由）。新增：
1. 让 `MODEL_PRICING` 与 catalog 明确对齐：有可靠价格的模型才标 `priceKnown: true`，未知价格继续允许 `COST_UNKNOWN_MODEL` notice。
2. `AGENT_LLM_MODEL_OPTIONS` 加 `requiresKey` / `vendor` / `priceKnown` 字段，UI 用来判断是否要提示用户配 key、如何分组、成本是否可估算。
3. Mobile 在 ChatScreen / GroupChatScreen 的发送区加"模型"按钮（小芯片），点开 bottom sheet 列模型，选择持久化到 `setAgentDefaultModel`（即下次默认 = 这次选的）。
4. Bottom sheet 顶部对未配置 key 的模型显示"需要 ZenMux Key → 去配置"行内提示，深链到 `BrainHomeKeys`。

**Tech Stack:** TypeScript / Hono / pg / Vitest（apps/api）；Expo / React Native / @react-navigation（apps/mobile）。

**前置：** v0.m4 + M4 review fix（cancelRun 竞态守卫 + resume 清 expires + cost reload，本日 13:09 commit）。所有 M4 列 + summary 落库 + AgentRunCard 都已就位。

**Spec：** 本文档内联设计；无独立 design doc（M5 改动比 M4 小，spec 与 plan 合并）。

---

## 测试命令统一约定

所有后端测试都需要 DB 连接：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run <test file>
```

不要带 `--reporter=summary`（vitest 会当 module 加载报错）。Mobile 编译用 `cd apps/mobile && npx tsc --noEmit`。

---

## T0：分支 + baseline

**Files:** none

- [ ] **Step 1：开分支 + 全量后端测试通过**

```bash
cd /Users/hongpengwang/agent-Carl-Gustav-Jung
git checkout main && git pull --ff-only
git checkout -b feat/agent-runtime-m5
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run
```

Expected：全绿（M4 后约 410 个 case）。`runtime.userKey.test.ts` 偶尔 flaky → 单文件重跑一次确认。

- [ ] **Step 2：mobile 编译通过**

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected：exit 0。

---

# Part A：M5A Run Artifacts

## T1：Migration 020 + types/store artifact 列

**Files:**
- Create: `apps/api/src/db/migrations/020_agent_run_artifact.sql`
- Modify: `apps/api/src/lib/agent/types.ts`
- Modify: `apps/api/src/lib/agent/store.ts`
- Create: `apps/api/src/lib/agent/__tests__/store.m5.test.ts`

### Step 1：写 migration 020

- [ ] 创建：

```sql
-- apps/api/src/db/migrations/020_agent_run_artifact.sql
-- M5A Task 1：agent_runs.artifact JSONB NULL —— 终态产物（finalContent + 结构化 refs + 模型快照）
-- 与 summary 平级；softComplete 在同一次 update 写入，避免读取顺序竞态。
ALTER TABLE agent_runs
  ADD COLUMN artifact JSONB NULL;
```

不加索引：artifact 只在单条 run 查询时读取，不参与 WHERE 过滤。

### Step 2：types 扩展（TDD：先写测试）

- [ ] 在 `apps/api/src/lib/agent/types.ts` 加：

```typescript
export type ReplyRef = {
  kind: 'document' | 'url' | 'magi_card' | 'diagram';
  id: string;
  label?: string;
};

export type RunArtifact = {
  /** 最终回复正文（与 chat placeholder 内容一致；child run 这里是唯一来源） */
  finalContent: string;
  /** 结构化引用：document/url/magi_card/diagram；已 dedupe */
  refs: ReplyRef[];
  /** 模型快照——retry/分享时保留产出环境信息 */
  model: {
    providerId: string;
    modelId: string;
  };
  /** ISO timestamp，方便前端"产出于 …"展示 */
  producedAt: string;
};
```

并在 `AgentRun` 上加：

```typescript
artifact: RunArtifact | null;
```

> **依赖循环注意**：`types.ts` 此前是叶子模块。`ReplyRef` 当前在 `replyGen.ts` 定义，types 直接 import 会引入循环。
>
> 解决步骤：
> 1. 把 `ReplyRef` 类型 **搬到** `types.ts`（保留 export name 不变）。
> 2. `replyGen.ts` 顶部把原 `export type ReplyRef = {...}` 改成 `import type { ReplyRef } from './types.js'; export type { ReplyRef };` —— 保持对外 import 路径兼容，任何 `from './replyGen.js'` 的 caller 不用改。
> 3. `collectReplyRefs` 实现保持原位。
>
> 验证：全量 `tsc --noEmit` + `vitest run` 通过即可。

### Step 3：store 扩展

- [ ] `apps/api/src/lib/agent/store.ts` 的 `RUN_COLUMNS` 末尾加 `'artifact'`。
- [ ] `parseRun` 加 `artifact: row.artifact ?? null` 转换（pg 已自动反序列化 JSONB）。
- [ ] `UpdateAgentRunInput` 加 `artifact?: RunArtifact | null` 字段。
- [ ] `updateAgentRun` 的 map 处理 `artifact`：`JSON.stringify` 写入；`null` 走 `set artifact = NULL`（参考 `summary` 的实现）。

### Step 4：测试 `store.m5.test.ts`

- [ ] 三个 case（参考 `store.m4.test.ts`）：
  1. `insertAgentRun` 默认 `artifact === null`。
  2. `updateAgentRun({ artifact: { finalContent: '...', refs: [{ kind: 'document', id: 'd1' }], model: { providerId: 'deepseek', modelId: 'deepseek-chat' }, producedAt: '2026-05-23T00:00:00Z' } })` round-trip → re-read 等值。
  3. `updateAgentRun({ artifact: null })` 清空。

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run src/lib/agent/__tests__/store.m5.test.ts
```

Expected: 3 PASS。

---

## T2：softComplete 落 artifact

**Files:**
- Modify: `apps/api/src/lib/agent/runLifecycle.ts`
- Create: `apps/api/src/lib/agent/__tests__/runLifecycle.artifact.test.ts`

### Step 1：先写失败测试

- [ ] `apps/api/src/lib/agent/__tests__/runLifecycle.artifact.test.ts`：

```typescript
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { getPool } from '../../../db/client.js';
import { runMigrations } from '../../../db/migrate.js';
import * as store from '../store.js';
import { softComplete } from '../runLifecycle.js';
import { DEFAULT_BUDGET } from '../types.js';
import { ensureUser } from './_groupFixture.js';

describe('softComplete writes artifact', { timeout: 15000 }, () => {
  beforeAll(async () => { await runMigrations(); });
  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('completed run → artifact { finalContent, refs[], model, producedAt }', async () => {
    const { id: ownerId } = await ensureUser('m5-artifact');
    const run = await store.insertAgentRun({
      ownerId, channel: 'private', sessionId: null, groupId: null, topicId: null,
      intentTurnId: null, role: 'generalist', status: 'running',
      inputText: 'hello', budget: DEFAULT_BUDGET,
      apiKeySource: 'server', apiKeyOwnerId: null,
      providerId: 'deepseek', modelId: 'deepseek-chat',
    });
    // 测试环境 buildFinalContent 走 pickFallbackFinalContent。
    // 注意：当前 pickFallbackFinalContent 不读 reply step 内容，所以这里不断言等于"最终回复内容"，
    // 只断言 artifact.finalContent 与 buildFinalContent 返回值一致。
    const { recordStep } = await import('../stepRecorder.js');
    await recordStep({
      runId: run.id,
      kind: 'reply',
      output: { content: '最终回复内容' },
    });
    await softComplete((await store.getAgentRun(run.id))!, 'completed');
    const reloaded = (await store.getAgentRun(run.id))!;
    expect(reloaded.artifact).not.toBeNull();
    expect(reloaded.artifact!.finalContent.length).toBeGreaterThan(0);
    expect(reloaded.artifact!.finalContent).toContain('任务未完成');
    expect(reloaded.artifact!.model.providerId).toBe('deepseek');
    expect(reloaded.artifact!.model.modelId).toBe('deepseek-chat');
    expect(reloaded.artifact!.producedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Array.isArray(reloaded.artifact!.refs)).toBe(true);
  });

  it('failed run → artifact also written（refs 可空，但 finalContent 是模板）', async () => {
    const { id: ownerId } = await ensureUser('m5-fail');
    const run = await store.insertAgentRun({
      ownerId, channel: 'private', sessionId: null, groupId: null, topicId: null,
      intentTurnId: null, role: 'generalist', status: 'running',
      inputText: 'hello', budget: DEFAULT_BUDGET,
      apiKeySource: 'server', apiKeyOwnerId: null,
    });
    await softComplete((await store.getAgentRun(run.id))!, 'failed', 'oom');
    const reloaded = (await store.getAgentRun(run.id))!;
    expect(reloaded.artifact).not.toBeNull();
    // 不绑定具体模板措辞（buildFinalContent 模板可能微调），只校验非空 + 结构
    expect(reloaded.artifact!.finalContent.length).toBeGreaterThan(0);
    expect(reloaded.artifact!.refs).toEqual([]);
    expect(reloaded.artifact!.model.providerId).toBeTruthy();
  });
});
```

Expected：跑这个文件 → 2 FAIL（artifact 还没实现）。

### Step 2：实现 artifact 写入

- [ ] 修改 `softComplete`（`runLifecycle.ts`，约 L186 起）：

```typescript
import { collectReplyRefs } from './replyGen.js';
import { toolRegistry } from './toolRegistry.js';

export async function softComplete(
  run: AgentRun,
  status: 'completed' | 'budget_exhausted' | 'failed' | 'cancelled',
  detail?: string,
): Promise<void> {
  const finalContent = await buildFinalContent(run, status, detail);

  // ... 原有 placeholder finalize / child-run reply step 逻辑保持不变 ...

  await killSandboxForRun(run.id);

  const stepsForSummary = await store.listSteps(run.id);
  const summary = buildRunSummary(stepsForSummary);

  // M5A：构建 artifact，所有 terminal status 都写。
  // refs 用全局 toolRegistry —— 与 generateFinalReply 路径一致。
  const toolMap = new Map(toolRegistry.list().map((t) => [t.name, t]));
  const refs = collectReplyRefs(stepsForSummary, toolMap);
  const artifact: RunArtifact = {
    finalContent,
    refs,
    model: {
      providerId: run.providerId ?? 'deepseek',
      modelId: run.modelId ?? 'deepseek-v4-pro',
    },
    producedAt: new Date().toISOString(),
  };

  await store.updateAgentRun(run.id, {
    status,
    endedAt: new Date(),
    summary,
    artifact,
  });
  // ... 原有 hook emit ...
}
```

- [ ] 同步修 idle-path `cancelRun`（同文件 L320 起，M4 review 已加 summary，这里再加 artifact）。让所有 terminal 路径行为一致。

```typescript
// In cancelRun（无 controller path）：
const stepsForSummary = await store.listSteps(runId);
const summary = buildRunSummary(stepsForSummary);
const toolMap = new Map(toolRegistry.list().map((t) => [t.name, t]));
const refs = collectReplyRefs(stepsForSummary, toolMap);
const artifact: RunArtifact = {
  finalContent: '[任务已取消]',
  refs,
  model: {
    providerId: run.providerId ?? 'deepseek',
    modelId: run.modelId ?? 'deepseek-v4-pro',
  },
  producedAt: new Date().toISOString(),
};
await store.updateAgentRun(runId, {
  status: 'cancelled',
  cancelledByUserId: byUserId,
  cancelReason: reasonOverride ?? 'user',
  endedAt: new Date(),
  summary,
  artifact,
});
```

### Step 3：跑测试

- [ ] 跑新测试 + 已有 lifecycle 测试：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run \
  src/lib/agent/__tests__/runLifecycle.artifact.test.ts \
  src/lib/agent/__tests__/runLifecycle.summary.test.ts \
  src/lib/agent/__tests__/expireAwaitingUserInput.test.ts
```

Expected：全绿。

- [ ] 全量 backend 测试：

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run
```

Expected：≥410 PASS。如有 flaky 单文件重跑确认。

---

## T3：API 暴露 artifact（无代码改动，验证）

**Files:** none（验证）

agent route 已经返回完整 `AgentRun` row，artifact 字段会自动出现在 `GET /api/agent/runs/:id` 响应里。

- [ ] **Step 1：手工 e2e 验证**（DB 直查即可，不必跑完整 RN）

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) \
  psql $DATABASE_URL -c "SELECT id, status, artifact FROM agent_runs WHERE status='completed' ORDER BY ended_at DESC LIMIT 3;"
```

Expected：artifact 字段 JSONB 非 null（仅对 M5A 部署之后完成的 run；之前的 run 留空，UI 应兼容 null）。

---

## T4：Mobile artifact 卡片

**Files:**
- Modify: `apps/mobile/src/features/agent/types.ts`（加 `RunArtifact` 镜像）
- Modify: `apps/mobile/src/features/agent/AgentRunCard.tsx`（加 artifact 渲染 + 复制按钮）
- Modify: `apps/mobile/src/locales/zh-CN.ts`（"复制全文" / "引用 N 项" / "产出于 …"）

### Step 1：类型镜像

- [ ] `apps/mobile/src/features/agent/types.ts` 加：

```typescript
export type ReplyRef = {
  kind: 'document' | 'url' | 'magi_card' | 'diagram';
  id: string;
  label?: string;
};

export type RunArtifact = {
  finalContent: string;
  refs: ReplyRef[];
  model: { providerId: string; modelId: string };
  producedAt: string;
};
```

并在 `AgentRun` 加 `artifact?: RunArtifact | null`。

### Step 2：AgentRunCard 渲染

- [ ] 在 `AgentRunCard.tsx` 现有 summary 行下方新增"产物"区块（仅在 `run.artifact && isTerminal(run.status)` 时渲染）。结构：

```
┌─ 产物 ────────────────────────────────┐
│ {finalContent 前 5 行，可展开}        │
│ ──────                                │
│ 引用 (3)：                            │
│  • [doc] xxx 报告                     │
│  • [url] example.com/path             │
│  • [diagram] 渲染流程                 │
│                                       │
│ [复制全文] · 产出于 12:34 · DeepSeek  │
└───────────────────────────────────────┘
```

- 复制全文：`Clipboard.setStringAsync(artifact.finalContent)` + Toast "已复制"。
- ref 点击：
  - `document` / `magi_card` → 暂留空（M5 不实现路由跳转，先打 console.log）
  - `url` → `Linking.openURL`
  - `diagram` → 滚到对应 step（已有 diagram step；可用 ref.id 匹配 `step.output.diagramId`）。M5 不强求完美，先 console.log 即可。
- "产出于" 用相对时间（复用 `formatRelative` 如果已有；否则简单 `new Date(producedAt).toLocaleTimeString('zh-CN')`）。

### Step 3：mobile 编译 + 视觉自检

- [ ] `cd apps/mobile && npx tsc --noEmit` → exit 0。
- [ ] 可选：手动启动 expo + 真机点开一个 M5A 之后完成的 run，检查 artifact 卡片渲染（artifact null 时不显示该区块）。

---

# Part B：M5B Multi-Model UI

## T5：MODEL_PRICING 与 catalog 对齐

**Files:**
- Modify: `apps/api/src/lib/agent/modelPricing.ts`
- Modify: `apps/api/src/lib/agent/__tests__/modelPricing.test.ts`

### Step 1：先写测试

- [ ] 在 `modelPricing.test.ts` 加 case，断言 **catalog 已承诺显示成本的模型** 不触发 `unknownModel: true`。
- [ ] 对没有可靠公开价格的新模型，不要强行填表；应在 catalog 里标记 `priceKnown: false`，并允许后端继续 emit `COST_UNKNOWN_MODEL`。

```typescript
it('catalog models with priceKnown=true are priced', () => {
  for (const m of [
    'deepseek-v4-flash',
    // 只有查到官方 / ZenMux 明确定价后才把新模型加入这里
  ]) {
    const r = computeCallCostCny(m, 1000, 500);
    expect(r.unknownModel, `${m} should be priced`).toBe(false);
    expect(r.costCny).toBeGreaterThan(0);
  }
});
```

Expected：先 FAIL，填完可靠定价后 PASS。

### Step 2：填表

- [ ] `MODEL_PRICING` 加（**所有数字必须现查官方页或 ZenMux 后台确认**；执行 worker 必须在 commit message 注明数据来源 URL 和查询日期）：

```typescript
// 示例：只有价格来源确认后才添加
'deepseek-v4-flash':             { promptCny: <confirmed>, completionCny: <confirmed> },
```

> **重要约束**：执行 worker 不得使用占位数字，也不得把不存在/未公开的模型价格猜出来。记不准就保留 unknownModel，并在 UI 显示「成本暂不可估算」。

### Step 3：跑测试

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run src/lib/agent/__tests__/modelPricing.test.ts
```

Expected：该文件全部 PASS。

---

## T6：catalog `requiresKey` + 默认排序

**Files:**
- Modify: `packages/shared/src/llm/agentModelCatalog.ts`
- Create: `packages/shared/src/llm/__tests__/agentModelCatalog.test.ts`（如果该目录没 test 也可放 `packages/shared/__tests__/`）

### Step 1：扩 type

- [ ] 在 `AgentLlmModelOption` 上加：

```typescript
export type AgentLlmModelOption = {
  providerId: AgentLlmProviderId;
  modelId: string;
  label: string;
  hint?: string;
  /** M5B：UI 用来判断是否要提示用户"需配置 Key" */
  requiresKey: 'deepseek' | 'zenmux';
  /** M5B：UI 分组（vendor 维度而非 backend providerId） */
  vendor: 'deepseek' | 'openai' | 'anthropic' | 'moonshot' | 'google';
  /** 成本估算是否可靠；false 时 UI 展示"成本暂不可估算" */
  priceKnown?: boolean;
};
```

- [ ] 给每条 `AGENT_LLM_MODEL_OPTIONS` 填 `requiresKey` 和 `vendor`：

```typescript
{ providerId: 'deepseek', modelId: 'deepseek-v4-pro',           ..., requiresKey: 'deepseek', vendor: 'deepseek', priceKnown: true },
{ providerId: 'deepseek', modelId: 'deepseek-v4-flash',         ..., requiresKey: 'deepseek', vendor: 'deepseek', priceKnown: true /* only if T5 confirmed */ },
{ providerId: 'zenmux',   modelId: 'anthropic/claude-sonnet-4.6', ..., requiresKey: 'zenmux',   vendor: 'anthropic', priceKnown: true },
{ providerId: 'zenmux',   modelId: 'anthropic/claude-opus-4.7',   ..., requiresKey: 'zenmux',   vendor: 'anthropic', priceKnown: false /* until confirmed */ },
{ providerId: 'zenmux',   modelId: 'openai/gpt-5.5',              ..., requiresKey: 'zenmux',   vendor: 'openai', priceKnown: false /* until confirmed */ },
{ providerId: 'zenmux',   modelId: 'moonshotai/kimi-k2.6',        ..., requiresKey: 'zenmux',   vendor: 'moonshot', priceKnown: false /* until confirmed */ },
```

### Step 2：catalog 测试

- [ ] `packages/shared/__tests__/agentModelCatalog.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import {
  AGENT_LLM_MODEL_OPTIONS,
  findAgentLlmOption,
} from '../src/llm/agentModelCatalog.js';

describe('AGENT_LLM_MODEL_OPTIONS', () => {
  it('every option has requiresKey and vendor', () => {
    for (const o of AGENT_LLM_MODEL_OPTIONS) {
      expect(o.requiresKey, o.modelId).toMatch(/^(deepseek|zenmux)$/);
      expect(o.vendor, o.modelId).toBeTruthy();
      expect(typeof (o.priceKnown ?? true), o.modelId).toBe('boolean');
    }
  });
  it('deepseek vendor → requiresKey=deepseek', () => {
    for (const o of AGENT_LLM_MODEL_OPTIONS.filter((x) => x.vendor === 'deepseek')) {
      expect(o.requiresKey).toBe('deepseek');
    }
  });
  it('non-deepseek vendor → requiresKey=zenmux', () => {
    for (const o of AGENT_LLM_MODEL_OPTIONS.filter((x) => x.vendor !== 'deepseek')) {
      expect(o.requiresKey).toBe('zenmux');
    }
  });
});
```

Expected：3 PASS（先写后填 catalog，先 FAIL 再 PASS）。

### Step 3：跑 shared 包测试

```bash
cd packages/shared && npx vitest run
```

> 如果 packages/shared 没有 vitest 配置，跳过该步，等 mobile 编译时由 RN bundler 检查类型即可。

---

## T7：Mobile compose-time model picker

**Files:**
- Create: `apps/mobile/src/features/agent/AgentModelPickerSheet.tsx`
- Modify: `apps/mobile/src/screens/ChatScreen.tsx`
- Modify: `apps/mobile/src/screens/GroupChatScreen.tsx`
- Modify: `apps/mobile/src/locales/zh-CN.ts`

### Step 1：建 sheet 组件

- [ ] `AgentModelPickerSheet.tsx`：

```typescript
// props: { visible: boolean; current: { providerId, modelId } | null; onPick: (opt) => void; onClose: () => void; missingKeys: { deepseek: boolean; zenmux: boolean } }
// 用 React Native 的 Modal + ScrollView，按 vendor 分组列出 AGENT_LLM_MODEL_OPTIONS。
// 每个 row：label + hint + （如果 requiresKey 对应 key 缺失）灰色 + "未配置 Key" + 点击不切换，弹 Alert "去 BrainHomeKeys 配置？" 跳转。
// 选中态 = current.modelId 匹配；点击 onPick 后立刻关闭 sheet。
```

设计要点（写到文件 header docstring）：
- 不引第三方 bottom-sheet 库（避免引依赖）；用现有 `<Modal animationType="slide">`，模态半屏样式。
- `missingKeys` 由调用方通过 `getDeepSeekApiKey()` / `getZenMuxApiKey()` 计算后传入（避免组件直接依赖 SecureStore 难测试）。
- 选中后 caller 负责 `setAgentDefaultModel({ providerId, modelId })`，sheet 只 emit `onPick`。

### Step 2：ChatScreen 接入

- [ ] 在发送输入框上方（或左侧）加一个小芯片：

```
[模型: DeepSeek V4 Pro ▾]
```

点击 → 打开 sheet。状态：
- `[currentModel, setCurrentModel] = useState<AgentLlmModelOption>(default)`，初始值通过 `useEffect(() => getAgentDefaultModel().then(setCurrentModel))` 拉。
- `onPick` → `setAgentDefaultModel(opt)` + `setCurrentModel(opt)` + close。
- 发送 agent_run 时 `agentOptions = { providerId: currentModel.providerId, modelId: currentModel.modelId }`（替换现有 `await getAgentDefaultModel()` 调用，避免双查 SecureStore）。

- [ ] 缺 key 状态：`useEffect` 里同时读两个 key 写入 `missingKeys` state，传给 sheet。

### Step 3：抽 hook + GroupChatScreen 同步

- [ ] 把"加载默认 → 加载 key 状态 → setAgentDefaultModel"逻辑抽到 `apps/mobile/src/features/agent/useAgentModelPicker.ts`：

```typescript
export function useAgentModelPicker() {
  const [current, setCurrent] = useState<AgentLlmModelOption>(/* default */);
  const [missingKeys, setMissingKeys] = useState({ deepseek: false, zenmux: false });
  const [sheetVisible, setSheetVisible] = useState(false);

  useEffect(() => {
    void (async () => {
      const def = await getAgentDefaultModel();
      const opt = findAgentLlmOption(def.providerId, def.modelId) ?? AGENT_LLM_MODEL_OPTIONS[0];
      setCurrent(opt);
      const [ds, zm] = await Promise.all([getDeepSeekApiKey(), getZenMuxApiKey()]);
      setMissingKeys({ deepseek: !ds, zenmux: !zm });
    })();
  }, []);

  const pick = useCallback(async (opt: AgentLlmModelOption) => {
    await setAgentDefaultModel({ providerId: opt.providerId, modelId: opt.modelId });
    setCurrent(opt);
    setSheetVisible(false);
  }, []);

  return { current, missingKeys, sheetVisible, setSheetVisible, pick };
}
```

- [ ] ChatScreen 和 GroupChatScreen 调同一个 hook，render chip + `<AgentModelPickerSheet visible={sheetVisible} current={current} missingKeys={missingKeys} onPick={pick} onClose={() => setSheetVisible(false)} onConfigureKeys={...} />`。
- [ ] `onConfigureKeys` 跳转约定：如果当前 screen 不在 `BrainStack` 内，使用根 navigation 跳到 Brain tab 再 navigate `BrainHomeKeys`（参考 `apps/mobile/src/lib/appNavigateFromIntent.ts` 的 `navigateBrainTab(navigation, 'BrainHomeKeys')`），不要直接 `navigation.navigate('BrainHomeKeys')`，否则跨 navigator 可能失败。
- [ ] **chip 位置约定**：放在输入框 toolbar 上方（与"intent 标签"/" attach button"同一行末尾）。若现有 toolbar 已挤，放到输入框下方独立一行，宽度 auto，左对齐。具体位置由实现者根据现有布局决定，**目标是不破坏现有发送区高度**。

### Step 4：mobile 编译

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected：exit 0。

> 真机视觉验证可在 T9 review 阶段一起做。

---

## T8：Settings 入口增强（兼容旧 default 屏）

**Files:**
- Modify: `apps/mobile/src/screens/brain/BrainAgentDefaultModelScreen.tsx`

### Step 1：复用 sheet 风格 + 缺 key 提示

- [ ] 让 `BrainAgentDefaultModelScreen` 也用 `AgentModelPickerSheet` 渲染（或抽出公共 `AgentModelPickerList` 直接 inline 渲染）。Key 缺失行为一致。
- [ ] 保留原入口（`BrainHubScreen` 已有），但提示文案改为"该选择会成为发送时默认值，发送时仍可临时改"。

### Step 2：mobile 编译

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected：exit 0。

---

# 收尾

## T9：全量 review + merge main + tag v0.m5

**Files:** none

- [ ] **Step 1：全量后端测试**

```bash
cd apps/api && DATABASE_URL=$(grep DATABASE_URL ../../.env | cut -d= -f2-) npx vitest run
```

Expected：全绿。`userKey.test.ts` flaky 重跑。

- [ ] **Step 2：mobile 编译**

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected：exit 0。

- [ ] **Step 3：code-reviewer subagent 走一遍**

prompt 模板：
> 这是 M5 implementation（artifact 落库 + multi-model picker）。重点关注：
> (a) softComplete artifact 写入是否与 summary / placeholder finalize 互不干扰；
> (b) RunArtifact 在 cancelRun/failed 路径行为是否一致；
> (c) `ReplyRef` 类型搬迁是否产生循环依赖；
> (d) AgentModelPickerSheet missingKeys 计算时序是否有 race（key 异步加载完成前用户点开 sheet）；
> (e) MODEL_PRICING 新条目数值来源是否合理。
> 列出所有 critical / important 问题。

- [ ] **Step 4：merge main + tag**

```bash
git checkout main && git pull --ff-only
git merge --no-ff feat/agent-runtime-m5 -m "M5: Run Artifacts + Multi-Model Picker"
git tag v0.m5
```

不要 push，等用户决定。

---

## 失败回滚

M5A migration 不能直接 down（artifact 列里有数据）。如果发现 `softComplete` artifact 写入引入 bug：
- 短期：把 `softComplete` 里 artifact 计算逻辑 try/catch 包住，失败不阻塞 status update（fail-open）。
- 长期：保留 column，artifact 算 nullable 字段，前端兼容 null。

M5B 任何阶段都可关：把 ChatScreen 的 chip 隐藏，回退到 default model 行为即可（不动 backend）。

---

## 估时

- Part A（T1–T4）：4 个 task，~1 个工作日。瓶颈在 mobile artifact UI 细节。
- Part B（T5–T8）：4 个 task，~1.5 个工作日。瓶颈在 sheet 组件 + 两个 screen 接入 + 真实定价核对。
- T9 review：0.5 个工作日。

合计 **3 天**，可 Part A / Part B 并行（不同 file scope，无冲突）。
