# Agent Runtime M4 设计

**状态：** writing-plans 前
**前置：** v0.m3（ask_user + deep_research + child executor pool）+ M3 hotfix（resume 跳步 / 子 run 密钥继承 / deep_research 超时窗口）
**估算：** ~3.5 天（M4 主线）；mobile SSE 单独作为 M4 polish 视时间补做

---

## 0. 目标 & 非目标

**目标：** 让用户「看得见 agent 在干什么、找得回历史、能一键重试、知道花了多少钱」。

M1-M3 把 agent 的智能上限推到能反问 + 派子任务，但用户体感仍停留在"提交 → 等几十秒 → 出结果"。M4 不增加任何新的 agent 能力，只把已有能力变成可见、可控、可复用。

**主线四件事（M4 v1）：**
1. **任务面板 mobile screen**：独立"我的任务"列表页（按状态筛选 + 进入详情 + 拉到底加载更多）；以 bottom tab `任务` 暴露
2. **Cost dashboard**：`usage.costCny` 真填数；列表每行 / 详情卡片 / 今日聚合都显示￥；DeepSeek/ZenMux 单价按 cache-miss 保守估算
3. **`pending_user_input_expires_at`**：`awaiting_user_input` 状态 24h 超时，worker 自动 cancel('user_timeout')；UI 显示倒计时提示
4. **Run summary metadata**：完成时落「N 步 / 用了 M 个工具 / 找到 K 篇论文」一行摘要，列表/详情都展示

**M4 polish（视时间补做，不阻塞 v0.m4 tag）：**
- **Mobile SSE adapter**：把 mobile 1.5s polling 切到后端已有的 `GET /runs/:id/stream`。后端 SSE 已完成；polling 兜底永远可用，所以推后做不影响功能完整性，只影响"实时感"。

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
| ADR-M4-2 | Pricing table | 内置 hardcode `apps/api/src/lib/agent/modelPricing.ts`，每千 prompt / completion token 单价（CNY）；**统一按 cache-miss 单价估算，不区分 cache hit**；查不到 model → 0 + 记 `notice='COST_UNKNOWN_MODEL'`（一次性 per run） | 不做 admin UI / DB 表：每月手动维护 + commit 即可；不算 cache hit：DeepSeek prompt-cache 命中需要相邻轮次 prefix 相同，agent 多步任务命中率不稳定，统一按 miss 算简单且偏保守（"实际账单不会高于这个估算"） |
| ADR-M4-3 | Expires 检查 | 复用现有 worker tick：新增 `autoExpireAwaitingUserInput()` 与 `autoResolveExpiredApprovals` 并列调用 | 不开新定时任务：worker tick 已经每秒级跑，复用零成本 |
| ADR-M4-4 | Expires 默认值 | 24h；由 `runExecute.ts` 在切到 `awaiting_user_input` 时显式写 `now() + 24h`，列本身不给 default | 24h 体感"明天还能回来回答"；列 nullable + 应用层写：M3 已存在的 awaiting run（无 expires_at）会被 worker checker 跳过，不会被回溯性 cancel |
| ADR-M4-5 | Run summary 字段 | 新增 `agent_runs.summary JSONB NULL`，结构 `{ stepCount, toolCount, toolBreakdown: {[toolName]: count}, refCount }` | 不新建表：单 run 只算一次，落在主表读起来零 join |
| ADR-M4-6 | Summary 生成时机 | `softComplete` 在写 final content 前调 `buildRunSummary(steps)` 落库 | 一次性算够用；failed/cancelled/budget_exhausted 同样产 summary（按已发生的 step） |
| ADR-M4-7 | Mobile 数据订阅 | **M4 v1 继续用现有 1.5s polling**（`useAgentRunPoll`）；SSE 适配（`react-native-sse` + 失败 fallback polling）作为 M4 polish 视时间补 | 后端 SSE 已就绪，但 mobile 接入有 Expo/Hermes 兼容性不确定性；polling 稳定、断线即续传、已被现有 UI 验证。SSE 主要好处是延迟从 1.5s 降到 <1s，对任务面板"看着干活"体验有提升但非阻塞 |
| ADR-M4-8 | 任务面板入口 | 在 mobile bottom tab 新增「任务」tab（路由名 `AgentRuns`），挂 `AgentRunListScreen`；点击 item 进 `AgentRunDetailScreen`，挂现有 `AgentRunCard`；图标用现有 icon set 中的 `list` / `activity` 类，不用 emoji | 不内嵌到现有 chat / 会话页：任务全局可见性 > 上下文紧贴；emoji 临时感太强 |

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
// 单价 = CNY per 1000 tokens
// 数据来源（2026-05 复核）：
//   DeepSeek 官方 CNY 公示价（取 cache-miss）
//   其余通过 ZenMux / OpenRouter 代理转计费，USD 单价 × 7.2 估算（汇率常数）
// 维护节奏：每月人肉对一次官方页面；不算 cache hit（DeepSeek prompt-cache
//          命中率对 agent 多步任务不稳定，统一按 miss 算"宁高勿低"）。
type PriceEntry = { promptCny: number; completionCny: number };
export const MODEL_PRICING: Record<string, PriceEntry> = {
  // ─── DeepSeek 官方（CNY 原价，cache miss）───────────────────────────────
  // 来源：https://api-docs.deepseek.com/zh-cn/quick_start/pricing-details-cny
  //   deepseek-chat:     input ¥2/M (miss)   output ¥8/M
  //   deepseek-reasoner: input ¥4/M (miss)   output ¥16/M
  'deepseek-chat':                 { promptCny: 0.002, completionCny: 0.008 },
  'deepseek-reasoner':             { promptCny: 0.004, completionCny: 0.016 },

  // ─── OpenAI（USD × 7.2 → CNY）─────────────────────────────────────────
  // 来源：openrouter.ai pricing 页面（2026-05 复核）
  //   gpt-4o:        $2.50 / $10  per M
  //   gpt-4o-mini:   $0.15 / $0.60 per M
  //   gpt-5:         $1.25 / $10  per M
  'openai/gpt-4o':                 { promptCny: 0.018,  completionCny: 0.072  },
  'openai/gpt-4o-mini':            { promptCny: 0.0011, completionCny: 0.0043 },
  'openai/gpt-5':                  { promptCny: 0.009,  completionCny: 0.072  },

  // ─── Anthropic（USD × 7.2 → CNY）──────────────────────────────────────
  //   sonnet 4.5:  $3   / $15  per M
  //   opus 4.6:    $5   / $25  per M
  //   haiku 3.5:   $0.80 / $4  per M
  'anthropic/claude-sonnet-4.5':   { promptCny: 0.0216, completionCny: 0.108  },
  'anthropic/claude-opus-4.6':     { promptCny: 0.036,  completionCny: 0.180  },
  'anthropic/claude-haiku-3.5':    { promptCny: 0.00576, completionCny: 0.0288 },
  // M3 期间仍可能见到的老 alias，保留映射
  'anthropic/claude-3.5-sonnet':   { promptCny: 0.0216, completionCny: 0.108  },
  'anthropic/claude-3.5-haiku':    { promptCny: 0.00576, completionCny: 0.0288 },

  // ─── Google（USD × 7.2 → CNY）─────────────────────────────────────────
  //   gemini 2.5 pro:  $1.25 / $10 per M
  //   gemini 2.5 flash: $0.075 / $0.30 per M
  'google/gemini-2.5-pro':         { promptCny: 0.009,   completionCny: 0.072  },
  'google/gemini-2.5-flash':       { promptCny: 0.00054, completionCny: 0.00216 },
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
  // 4 位小数足够（最小单位 ¥0.0001 ≈ 1 厘）；rounded down to avoid 浮点尾巴。
  return { costCny: Math.round(cost * 10000) / 10000, unknownModel: false };
}
```

**保守估算说明：** 上述单价**全部按 cache-miss 算**，因此显示数字 = "如果没命中任何 prompt cache 时的最大估算"。实际账单一般会更便宜（特别是 deepseek 多轮对话场景）。UI 上提示文案："费用为估算值，与实际账单可能有 ±20% 差异。"

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

**新增 bottom tab 「任务」：** 在 mobile 主导航增 tab 项，路由名 `AgentRuns`。

- icon 用现有 icon set（先看 mobile 已用什么 vector-icons 包，从 `list-outline` / `pulse-outline` / `flash-outline` 里挑一个）
- 不用 emoji（视觉临时感太强；commit 前确认现有 tab 视觉风格）
- 列表页头部固定 sticky banner：「今日 ¥X.XX · 本月 ¥Y.YY · K 个进行中」（聚合数据由 `GET /runs` 响应客户端算）
- awaiting_user_input 状态的 row 右侧显示「⏱ 剩 23h 12m」倒计时，让用户知道 24h 内回答否则会被自动取消

**修改 `AgentRunCard.tsx`：** 终态卡片底部追加一行 summary（"5 步 · 3 工具 · 12 引用 · ¥0.045"），与现有 budget_exhausted 区分。

### 3.5 Mobile SSE adapter（M4 polish，视时间补做）

**说明：** M4 v1 不交付此项。继续用现有 `useAgentRunPoll`（1.5s 全量拉 + 自然断线续传），新任务面板 / cost / summary 等所有 UI 都正常工作。

若有时间补做：

**新增 `apps/mobile/src/features/agent/hooks/useAgentRunSSE.ts`：**

```ts
import EventSource from 'react-native-sse';
// 后端：GET /api/agent/runs/:id/stream（已实现，支持 Last-Event-ID 续传）
// 事件：step / notice / status / end
// 实现要点：
//   1. 把 auth token 拼到 URL header（react-native-sse 支持 customHeaders）
//   2. 监听 step/notice/status/end，setState 喂出去
//   3. onError → close + 调上层 onError 让 UI 切回 polling
```

**改造 `AgentRunCard.tsx`：** 引入 `useAgentRunSubscription` wrapper hook：

```ts
// useAgentRunSubscription 内部先尝试 SSE，错误时降级到 poll
const { run, steps, ... } = useAgentRunSubscription(runId);
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
| AgentRunListScreen | 状态筛选切换 → 重新拉数据 + 列表更新 | ✅（RTL render） |
| AgentRunListScreen | sticky banner 渲染今日 / 本月聚合金额 | ✅ |
| AgentRunListScreen | awaiting_user_input row 显示倒计时 + 0 / 过期时显示"已过期" | ✅ |
| AgentRunCard | terminal + summary 存在 → 显示 summary 行 | ✅ |
| useAgentRunSSE | (polish) 收到 step 事件后 setState 触发；连接失败 onError 调用 fallback | ⏸ M4 polish |

预期新增 ~18 测试（M4 v1）+ 2 测试（SSE polish），总数 ~420。

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

**M4 v1（必交付，~3.5 天）：**

| 任务 | 内容 | 工时 |
|---|---|---|
| T0 | 分支 `feat/agent-runtime-m4` + baseline | 0.1d |
| T1 | migration 019 + types/store 扩展 + tests | 0.5d |
| T2 | modelPricing.ts + computeCallCostCny + tests | 0.3d |
| T3 | runLlmClient cost 拦截 + emitNoticeOnce + tests | 0.5d |
| T4 | runSummary.ts + softComplete 集成 + tests | 0.5d |
| T5 | autoExpireAwaitingUserInput + worker tick 接入 + cancelRun reason override + tests | 0.6d |
| T6 | AgentRunCard summary 行 + 终态金额行 + 调整布局 | 0.2d |
| T7 | AgentRunListScreen + 状态筛选 + sticky 聚合 banner + awaiting 倒计时 | 0.8d |
| T8 | AgentRunDetailScreen + bottom tab 接入 + navigation 路由 | 0.4d |
| T9 | 全量 review + merge main + tag v0.m4 | 0.3d |

**合计 v1：** ~4.2d → 给自己留 buffer 也算 ~5d 内能交付。

**M4 polish（可选，视时间补；不阻塞 v0.m4 tag）：**

| 任务 | 内容 | 工时 |
|---|---|---|
| P1 | `useAgentRunSSE` hook + `useAgentRunSubscription` wrapper + AgentRunCard 切源 + tests | 1.0d |

polish 项独立 commit，可走 patch tag `v0.m4.1`。

---

## 8. 决策附录

**Q: 为什么 pricing 不进 DB？**
A: 不是 user-facing 数据，月频更新；hardcode + git diff review 比 DB CRUD 安全；后续真要 dynamic 可以加 `model_pricing` 表 + 写一个 admin 路由。M4 不做。

**Q: pricing 数字一定准吗？**
A: 不一定。这是"估算值"，不是实际账单。三个来源差异点：
1. **不算 cache hit**：DeepSeek 多轮对话命中 prompt cache 实际可能比估算便宜 50-75%
2. **USD → CNY 用 ×7.2 常数**：实际汇率会浮动 ±5%
3. **厂商不定期调价**：模型迭代后老 alias 可能下架或降价
所以 UI 显示金额时要带"估算"二字，列表 banner 也写"今日 ¥X.XX 估算"。**月度对一次单价表**，发现偏差超过 ±20% 就 commit 修正。

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
