# Agent Runtime M4 设计

**状态：** writing-plans 前
**前置：** v0.m3（ask_user + deep_research + child executor pool）+ M3 hotfix（resume 跳步 / 子 run 密钥继承 / deep_research 超时窗口）
**估算：** ~4-5 天

---

## 0. 目标 & 非目标

**目标：** 让用户「看得见 agent 在干什么、找得回历史、能一键重试、知道花了多少钱」。

M1-M3 把 agent 的智能上限推到能反问 + 派子任务，但用户体感仍停留在"提交 → 等几十秒 → 出结果"。M4 不增加任何新的 agent 能力，只把已有能力变成可见、可控、可复用。

**主线五件事：**
1. **任务面板 mobile screen**：独立"我的任务"列表页（按状态筛选 + 进入详情 + 拉到底加载更多）
2. **Cost dashboard**：`usage.costCny` 真填数；列表每行 / 详情卡片 / 今日聚合都显示￥
3. **`pending_user_input_expires_at`**：`awaiting_user_input` 状态默认 24h 超时，worker 自动 cancel('user_timeout')
4. **Run summary metadata**：完成时落「N 步 / 用了 M 个工具 / 找到 K 篇论文」一行摘要，列表/详情都展示
5. **Mobile SSE adapter**：把 mobile 端 1.5s polling 切到后端已有的 `GET /runs/:id/stream`，step 实时流式刷出

**非目标：**
- ❌ 群聊 agent 集成（topic_lock / 群里 ask_user 谁回答 / 群里 deep_research report 渲染）—— 留 M5
- ❌ MCP client adapter —— 留后续
- ❌ Skills marketplace / 用户自带工具
- ❌ Memory/RAG 联动让 agent 主动用 memory_*
- ❌ 异步 deep_research（不阻塞父 run）—— M5 候选

---

## 1. 关键决策

| ID | 决策 | 选择 | 备选 / 理由 |
|---|---|---|---|
| ADR-M4-1 | Cost 计算时机 | LLM call 完成后在 `runLlmClient` 拦截响应，按 `(prompt_tokens, completion_tokens)` × model 单价立即累加到 `run.usage.costCny` | 不在 softComplete 一次性算：tokens 已经分散在多次 call 里，存累计反而麻烦；按 call 增量算最准 |
| ADR-M4-2 | Pricing table | 内置 hardcode `apps/api/src/lib/agent/modelPricing.ts`，每千 prompt / completion token 单价（CNY）；查不到 model → 0 + 记 `notice='COST_UNKNOWN_MODEL'`（一次性 per run） | 不做 admin UI / DB 表：每月手动维护 + commit 即可；后续真要动态可加 DB |
| ADR-M4-3 | Expires 检查 | 复用现有 worker tick：新增 `autoExpireAwaitingUserInput()` 与 `autoResolveExpiredApprovals` 并列调用 | 不开新定时任务：worker tick 已经每秒级跑，复用零成本 |
| ADR-M4-4 | Expires 默认值 | 24h；由 `runExecute.ts` 在切到 `awaiting_user_input` 时显式写 `now() + 24h`，列本身不给 default | 24h 体感"明天还能回来回答"；列 nullable + 应用层写：M3 已存在的 awaiting run（无 expires_at）会被 worker checker 跳过，不会被回溯性 cancel |
| ADR-M4-5 | Run summary 字段 | 新增 `agent_runs.summary JSONB NULL`，结构 `{ stepCount, toolCount, toolBreakdown: {[toolName]: count}, refCount }` | 不新建表：单 run 只算一次，落在主表读起来零 join |
| ADR-M4-6 | Summary 生成时机 | `softComplete` 在写 final content 前调 `buildRunSummary(steps)` 落库 | 一次性算够用；failed/cancelled/budget_exhausted 同样产 summary（按已发生的 step） |
| ADR-M4-7 | Mobile SSE 库 | 用 `react-native-sse`（社区第三方，Expo Go 兼容、ReadableStream-free），失败 fallback 到现有 polling hook | 不用 fetch + ReadableStream：Hermes 引擎对 streaming 支持参差；也不用 native EventSource：RN 无 polyfill |
| ADR-M4-8 | 任务面板入口 | 在 mobile bottom tab 新增「任务」tab，挂 `AgentRunListScreen`；点击 item 进 `AgentRunDetailScreen`，挂现有 `AgentRunCard` | 不内嵌到现有 chat / 会话页：任务全局可见性 > 上下文紧贴 |

---

## 2. 数据库 / Schema

### 2.1 Migration 019 `019_agent_run_summary_and_user_input_expires.sql`

```sql
ALTER TABLE agent_runs
  ADD COLUMN pending_user_input_expires_at TIMESTAMPTZ NULL,
  ADD COLUMN summary JSONB NULL;

-- 加速 expires 扫描：只对处于 awaiting_user_input 的 run 建条件索引。
CREATE INDEX idx_agent_runs_pending_user_input_expires
  ON agent_runs(pending_user_input_expires_at)
  WHERE status = 'awaiting_user_input' AND pending_user_input_expires_at IS NOT NULL;
```

**说明：**
- `pending_user_input_expires_at` 不给 default：由 `ask_user` 工具在切到 `awaiting_user_input` 时显式写入 `now() + 24h`。这样老 awaiting run（M3 没填的）也能跑——nullable 时 `autoExpireAwaitingUserInput` 跳过即可。
- `summary` JSONB 单字段，结构由应用层校验，零 schema 改动后续可扩展。

### 2.2 类型扩展

- `AgentRun.pendingUserInputExpiresAt: Date | null`（前后端同步）
- `AgentRun.summary: RunSummary | null`
- `RunSummary` 新类型：

  ```ts
  export type RunSummary = {
    stepCount: number;          // 不含 system_error / heartbeat / reclaim
    toolCount: number;          // distinct toolName 数
    toolBreakdown: Record<string, number>;  // toolName → call count
    refCount: number;           // ReplyRef 总数
  };
  ```

- `CancelReason` 新增 `'user_timeout'` 字面量

---

## 3. 新增 / 修改的模块

### 3.1 Cost accounting

**新增 `apps/api/src/lib/agent/modelPricing.ts`**

```ts
// 单价 = CNY per 1000 tokens (基于 2026-05 各厂商公开 pricing；按月手动维护)
type PriceEntry = { promptCny: number; completionCny: number };
export const MODEL_PRICING: Record<string, PriceEntry> = {
  // DeepSeek 官方 (CNY 原价)
  'deepseek-chat':                 { promptCny: 0.0007, completionCny: 0.0014 },
  'deepseek-reasoner':             { promptCny: 0.0040, completionCny: 0.0160 },
  // ZenMux / OpenRouter 代理 (USD × 7.2 → CNY)
  'openai/gpt-4o':                 { promptCny: 0.0180, completionCny: 0.0720 },
  'openai/gpt-4o-mini':            { promptCny: 0.0011, completionCny: 0.0043 },
  'openai/gpt-4.1':                { promptCny: 0.0144, completionCny: 0.0576 },
  'openai/gpt-4.1-mini':           { promptCny: 0.0029, completionCny: 0.0115 },
  'anthropic/claude-3.5-sonnet':   { promptCny: 0.0216, completionCny: 0.1080 },
  'anthropic/claude-3.5-haiku':    { promptCny: 0.0072, completionCny: 0.0360 },
  'anthropic/claude-3.7-sonnet':   { promptCny: 0.0216, completionCny: 0.1080 },
  'anthropic/claude-sonnet-4':     { promptCny: 0.0216, completionCny: 0.1080 },
  'anthropic/claude-opus-4':       { promptCny: 0.1080, completionCny: 0.5400 },
  'google/gemini-2.0-flash-001':   { promptCny: 0.0007, completionCny: 0.0029 },
  'google/gemini-2.5-pro':         { promptCny: 0.0090, completionCny: 0.0720 },
  'qwen/qwen-2.5-72b-instruct':    { promptCny: 0.0023, completionCny: 0.0058 },
  // 兜底：找不到精确 model 时按 provider 前缀的中位值估算（在 computeCallCostCny 内实现）
};

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
  return { costCny: Math.round(cost * 10000) / 10000, unknownModel: false };
}
```

**修改 `runLlmClient.ts`**

`resolveLlmClient(run)` 返回的 `LlmChatClient` 已是 provider-agnostic 包装。在该包装里，每次 `chat()` 返回后插入 cost 累计逻辑（统一拦截点，无需改各 provider 实现）：

```ts
// runLlmClient.ts 内部 wrapper（伪代码，实际看现有结构调整）
const resp = await innerProvider.chat(messages);
const promptTokens = resp.usage?.promptTokens ?? 0;
const completionTokens = resp.usage?.completionTokens ?? 0;
const { costCny, unknownModel } = computeCallCostCny(
  modelId, promptTokens, completionTokens,
);
// incrementUsage 是纯函数，返回新 usage；要落库还需 store.updateAgentRun
const newUsage = incrementUsage(currentRun, {
  tokens: promptTokens + completionTokens,
  costCny,
});
await store.updateAgentRun(run.id, { usage: newUsage });
if (unknownModel) {
  await emitNoticeOnce(run.id, 'COST_UNKNOWN_MODEL',
    `cost 估算缺 model 单价：${modelId}`);
}
return resp;
```

> 注意：现有 `incrementUsage` 签名 `(run, delta) → newUsage` 只算不存。spec 这里增的落库一行是新行为。

**修改 `stepRecorder.ts` `incrementUsage`：** delta 类型从 `{ steps?; tokens?; elapsedSeconds? }` 扩到含 `costCny?`，加在现有 `tokens` 计数旁边。

**修改 `notices.ts`：** `NoticeCode` 新增 `'COST_UNKNOWN_MODEL'`；提供 `emitNoticeOnce(runId, code, msg)` 用 `listNoticesForRun` 取最近 20 条做 in-memory dedup（避免每次 LLM call 都刷一条）。

### 3.2 `pending_user_input_expires_at` + worker checker

**修改 `runExecute.ts`：** 现有 M3 ask_user 暂停分支（约 L317-L333）的 `store.updateAgentRun` 调用增 `pendingUserInputExpiresAt`：

```ts
await store.updateAgentRun(runId, {
  status: 'awaiting_user_input',
  pendingUserPrompt: typeof question === 'string' ? question : '',
  pendingUserStepIdx: i,
  pendingUserInputExpiresAt: new Date(Date.now() + 24 * 3600 * 1000),
});
```

**新增 `apps/api/src/lib/agent/expireAwaitingUserInput.ts`：**

```ts
export async function autoExpireAwaitingUserInput(now: Date): Promise<number> {
  const { rows } = await getPool().query(
    `SELECT id, owner_id FROM agent_runs
       WHERE status = 'awaiting_user_input'
         AND pending_user_input_expires_at IS NOT NULL
         AND pending_user_input_expires_at < $1`,
    [now],
  );
  for (const r of rows) {
    // 走 cancelRun 走标准取消通路（步骤 + softComplete + notice），cancel_reason='user_timeout'
    await cancelRun(r.id, /* byUserId */ r.owner_id, /* reason override */ 'user_timeout');
  }
  return rows.length;
}
```

**修改 `cancelRun(runId, byUserId, reasonOverride?: CancelReason)`：** 接收可选 reason 覆盖。

- 默认（不传 reasonOverride）：`cancel_reason='user'`，`cancelled_by_user_id=byUserId`（沿用现有 M1b 语义）
- `reasonOverride='user_timeout'`：`cancel_reason='user_timeout'`，`cancelled_by_user_id=byUserId`（仍记发起者，便于审计 "由系统代谁取消"）
- step 记 `cancel` kind，output `{ reason: <effective reason> }`，softComplete 走 `'cancelled'` 状态分支

**修改 `worker.ts` tick：** 在 `autoResolveExpiredApprovals` 之后再调 `autoExpireAwaitingUserInput(new Date())`。

### 3.3 Run summary

**新增 `apps/api/src/lib/agent/runSummary.ts`：**

```ts
export function buildRunSummary(steps: AgentStep[]): RunSummary {
  const NOISE: AgentStepKind[] = ['heartbeat', 'reclaim', 'system_error'];
  const useful = steps.filter((s) => !NOISE.includes(s.kind));
  const toolBreakdown: Record<string, number> = {};
  let refCount = 0;
  for (const s of useful) {
    if (s.kind === 'tool_call' && s.toolName) {
      toolBreakdown[s.toolName] = (toolBreakdown[s.toolName] ?? 0) + 1;
    }
    const out = s.output as { result?: { citations?: unknown[] } } | null;
    const refs = Array.isArray(out?.result?.citations) ? out!.result!.citations.length : 0;
    refCount += refs;
  }
  return {
    stepCount: useful.length,
    toolCount: Object.keys(toolBreakdown).length,
    toolBreakdown,
    refCount,
  };
}
```

**修改 `runLifecycle.ts.softComplete`：** 在 `await store.updateAgentRun(run.id, { status, endedAt })` 之前调用：

```ts
const steps = await store.listSteps(run.id);
const summary = buildRunSummary(steps);
await store.updateAgentRun(run.id, { summary });
```

（注意要落在 status update 之前，否则 status='completed' 后再 update summary 会触发不必要的 hook 重发。简单做法：把 summary 合进 status update 同一个 `updateAgentRun` 调用。）

### 3.4 任务面板 mobile

**新增 `apps/mobile/src/screens/AgentRunListScreen.tsx`：**

- 用 `useEffect` + `useFocusEffect` 拉 `GET /api/agent/runs?limit=50`（已有）
- 状态筛选 chip：全部 / 进行中（draft|planning|running|replanning|awaiting_*）/ 已完成 / 失败 / 取消
- 列表 item：`status icon + inputText (1 line, 截断) + provider/model + summary (N 步 · M 工具 · ¥X) + relative time`
- 点击 item → `navigation.navigate('AgentRunDetail', { runId })`
- 拉到底加载更多：`hasMore` 字段已有

**新增 `apps/mobile/src/screens/AgentRunDetailScreen.tsx`：**

- 顶部 header（返回 + run id 末 6 位 + status badge）
- body 直接挂 `<AgentRunCard runId={...} />`

**新增 bottom tab 「任务」：** 在 mobile 主导航增 tab 项，icon 临时用 emoji 🗂 或 react-native-vector-icons（按现有 tab 风格用同套）。

**修改 `AgentRunCard.tsx`：** 终态卡片底部追加一行 summary（"5 步 · 3 工具 · 12 引用 · ¥0.045"），与现有 budget_exhausted 区分。

### 3.5 Mobile SSE adapter

**新增 `apps/mobile/src/features/agent/hooks/useAgentRunSSE.ts`：**

```ts
import EventSource from 'react-native-sse';
import { agentApiBaseUrl, getAuthToken } from '../../auth';
// 复用 GET /api/agent/runs/:id/stream 后端
// 事件：step / notice / status / end（已有命名）
// Last-Event-ID 续传由 react-native-sse 自动管
// 失败：close + 调用上层 onError 切回 polling fallback
```

**改造 `AgentRunCard.tsx`：** import alias 切到 `useAgentRunSSE`；若 hook 内部任何 throw 即捕获 fallback 到 `useAgentRunPoll`：

```ts
const { run, steps, ... } = useAgentRunSubscription(runId);
// useAgentRunSubscription 内部先尝试 SSE，错误时降级到 poll
```

**新增依赖：** `react-native-sse`（用 `npx expo install react-native-sse`）。

---

## 4. API 改动

新 API 0 条。改动：

- `GET /api/agent/runs`：响应里每条 run 额外带 `summary?: RunSummary | null` 字段（已经返回 run 对象，store 改完自动同步）
- `GET /api/agent/runs/:id`：同上 + `pendingUserInputExpiresAt`
- 现有 SSE / cancel / retry / resume / approve / deny / steer 路由不变

---

## 5. 测试矩阵

| 模块 | 测试用例 | 期望 |
|---|---|---|
| migration 019 | 字段存在 + 索引存在 | ✅ |
| store.ts | summary / pendingUserInputExpiresAt 读写 roundtrip | ✅ |
| modelPricing | 已知 model → 正数；未知 model → 0 + unknownModel=true | ✅ |
| modelPricing | 零 tokens → 零 cost | ✅ |
| modelPricing | 极大 tokens（100万）→ 不溢出，结果保留 4 位小数 | ✅ |
| runLlmClient | LLM call 完成后 usage.costCny 累加；多次 call 累计 | ✅ |
| runLlmClient | 未知 model 第一次 call 触发 COST_UNKNOWN_MODEL notice；同 run 第二次不再触发 | ✅ |
| autoExpireAwaitingUserInput | 过期 run → cancel('user_timeout')；未过期不动 | ✅ |
| autoExpireAwaitingUserInput | expires_at IS NULL → 跳过 | ✅ |
| autoExpireAwaitingUserInput | 已 cancelled 的 awaiting → 不重复处理（status 校验） | ✅ |
| runExecute | ask_user 暂停时 pendingUserInputExpiresAt 落库 = now() + 24h（±5s 容错） | ✅ |
| buildRunSummary | 多 tool_call → toolBreakdown / toolCount 正确；citations 累加 refCount | ✅ |
| buildRunSummary | 全是 heartbeat/reclaim/system_error → stepCount=0 | ✅ |
| softComplete | completed run 写 summary | ✅ |
| softComplete | failed run 写 summary（按已发生 step） | ✅ |
| useAgentRunSSE | 收到 step 事件后 setState 触发；连接失败 onError 调用 fallback | ✅（mock EventSource） |
| AgentRunListScreen | 状态筛选切换 → 重新拉数据 + 列表更新 | ✅（RTL render） |
| AgentRunCard | terminal + summary 存在 → 显示 summary 行 | ✅ |

预期新增 ~20 测试，总数 ~420。

---

## 6. 风险 & 缓解

| 风险 | 缓解 |
|---|---|
| Pricing 数据过期（厂商降价 / 改型号） | hardcode + 月度 commit；运行时缺 model 单价软降级（cost=0 + 一次性 notice），不影响 run 完成 |
| `react-native-sse` 在 Expo Go 上失败 | useAgentRunSubscription 内部 try-catch fallback 到现有 polling；polling 兜底永远可用 |
| autoExpireAwaitingUserInput 与 user resume race（用户在 23h59m 提交） | cancelRun 内部已经按 status 守卫；只取消仍在 awaiting 的 run，resume 跑过的会跳过 |
| summary 计算很慢（极长 run，几百 step） | listSteps 已经走索引；几百 step 几十 ms，可接受 |
| 任务面板 N+1：每 row 想看 summary 但 GET /runs 只回 run summary | listAgentRunsForUser 已 SELECT 整行 run，summary 自动包含 |
| Mobile bottom tab 顺序冲突（已有几个 tab） | 跟现有 tab 风格 commit，新增 tab 不动旧顺序 |
| 用户感知不到"今天花了多少钱"——列表底部 footer 容易被滚动遮挡 | 列表页头部固定一个 sticky banner：「今日 ¥X.XX · 本月 ¥X.XX」 |

---

## 7. 实施路线图

| 任务 | 内容 | 工时 |
|---|---|---|
| T0 | 分支 `feat/agent-runtime-m4` + baseline | 0.1d |
| T1 | migration 019 + types/store 扩展 + tests | 0.5d |
| T2 | modelPricing.ts + computeCallCostCny + tests | 0.3d |
| T3 | runLlmClient cost 拦截 + emitNoticeOnce + tests | 0.5d |
| T4 | runSummary.ts + softComplete 集成 + tests | 0.5d |
| T5 | autoExpireAwaitingUserInput + worker tick 接入 + cancelRun reason override + tests | 0.6d |
| T6 | AgentRunCard summary 行 + 调整布局 | 0.2d |
| T7 | AgentRunListScreen + 状态筛选 + 今日聚合 banner | 0.8d |
| T8 | AgentRunDetailScreen + bottom tab 接入 + navigation 路由 | 0.4d |
| T9 | useAgentRunSSE hook + AgentRunCard fallback + tests | 1.0d |
| T10 | 全量 review + merge main + tag v0.m4 | 0.3d |

**合计：** ~4.5 天（含 SSE）；不含 SSE 砍 T9 即 ~3.5 天。

---

## 8. 决策附录

**Q: 为什么 pricing 不进 DB？**
A: 不是 user-facing 数据，月频更新；hardcode + git diff review 比 DB CRUD 安全；后续真要 dynamic 可以加 `model_pricing` 表 + 写一个 admin 路由。M4 不做。

**Q: deep_research 子 run 的 cost 算到谁头上？**
A: 算到子 run 自己。父 run 的 deep_research tool_call 不直接消耗 LLM token，子 run 才有。任务面板列表会把父子 run 都列出来（按 createdAt 排），用户能分别看到。后续可加"父 run 视图聚合子 run cost"，M4 不做。

**Q: summary 字段为什么用 JSONB 而不是几个独立列？**
A: tool 数量可变（M2 加了 10 个，M5 可能再加），toolBreakdown 用 JSONB 才能不改 schema 扩展；总 cost 字段已经在 `usage.costCny`，summary 只补"做了什么"维度。

**Q: 移动端 SSE 出错降级到 polling，用户怎么知道？**
A: 不需要知道——polling 提供的是 last-known state，行为跟 SSE 一致只是延迟 1.5s。开发期可以 console.warn，生产期静默。

**Q: 任务面板会不会暴露其他用户的 run？**
A: API `GET /api/agent/runs` 已经按 `owner_id = me OR me ∈ group_members(run.groupId)` 过滤，沿用现有授权（M1d Task 4 实现）。

**Q: 24h timeout 之后用户在第 25 小时回答会发生什么？**
A: `POST /runs/:id/resume` 校验 status 必须为 `awaiting_user_input`；过期后 status='cancelled'，resume 返回 409。前端 UI 通过 fetchRun 拿到 cancelled status + cancel_reason='user_timeout' 后给提示并隐藏 input 框。

---

（本 spec 待用户复核 → 进入 writing-plans 阶段生成实现计划）
