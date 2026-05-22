# Agent Runtime M7 设计文档（子项目 B：群聊 Agent 并发协调）

- 项目代号：`agent-runtime` v0.m7（子项目 B 首期）
- 日期：2026-05-22
- 状态：设计待用户复核 → writing-plans
- 关联：
  - 原 spec §20 衔接预留：`2026-05-20-agent-runtime-design.md` L1255
  - M4 spec 显式划入 B：`2026-05-22-agent-runtime-m4-design.md` L25（topic_lock / 群里 ask_user 谁回答 / 群里 deep_research report 渲染）
  - v0.m6 已 merge（tag `v0.m6` + `cb727e6`）

---

## 1. 背景

A 子项目（M1–M6 Agent Runtime）已完成。原全局规划 §20-21 将"群聊 Agent 并发协调"列为 B 子项目，紧跟 A。

实际现状（M7 调研结论）：

1. **没有 topic 级锁**：`createAgentRun` 不查同 `topic_id` 是否有 active run，每次都新建。
2. **伪并发 + 排队不可见**：worker `concurrency=1` 全局串行（`worker.ts` L29-36 `inFlight` Set），第二个 run 实际排队，但用户体感是"卡在准备中"，没有任何提示。
3. **ask_user 群聊禁用**：`askUser.ts` L52-60 检测 `channel='group'` 直接返回 `ok:false`；agent 在群里遇到含糊问题只能硬猜或改写普通回复。
4. **deep_research 子 run 群聊渲染粗糙**：`deepResearch.ts` L75 硬编码子 `channel: 'private'`；report 作为父 run reply 纯文本嵌入，群里看不到子 run 卡片、不能下钻。
5. **多人同时@AI 浪费**：同 topic 短时间内多人各发触发，会跑出 N 个独立 run + N 张 AgentRunCard，账单 ×N，体验割裂。

M7 把这 5 点收口，落地 B 子项目首期。

## 2. 目标 / 非目标

### 2.1 目标

| ID | 验收点 |
|---|---|
| G1 | 同 topic 同 owner 任意时间窗 / 不同 owner 30s 窗口内的后发 agent_run 触发自动合并到现有 active run，群里仅多 1 条 invoker 消息，AgentRunCard 显示"·已合并 N 个追问" |
| G2 | 跨 30s 窗口 / 不同 owner 的后发触发 status=`queued`；AgentRunCard 显示"排队中·前 N 个"；active run 终态时队首自动出队进入 draft |
| G3 | 群聊 `ask_user` 工具可用；owner 30s 独占应答；30s 后任意群成员可答；非群成员永远不能答 |
| G4 | 父 run 在群聊里调用 `deep_research` → 子 run 同 group/topic 创建群消息（独立 AgentRunCard），父卡 tool_call 行可点击跳转子 run 详情 |
| G5 | 现有私聊路径（M1–M6 全部场景）完全不受影响 |

### 2.2 非目标

- ❌ 不做内容相似度判断（同 topic + 时间窗 = 假设相关；YAGNI）
- ❌ 不做跨 topic 合并
- ❌ 不做 `chat_group_llm`（普通群聊 LLM）路径的并发协调（只动 `agent_run`）
- ❌ 不做 admin UI / dashboard（合并、队列状态全靠 SQL 查询）
- ❌ 不做"群体投票/审批"（M8+ 评估）
- ❌ 不做 `topic_locks` 单独表（原 spec 提到，本期评估为过度设计 —— 见 §4 ADR-M7-1）
- ❌ 不动 long-poll / artifact / Settings / 写作功能
- ❌ 不引入 Redis / 队列中间件（沿用 PG 单库 + worker 全局串行）

> 注：会**使用** PG 原生 `pg_advisory_xact_lock`（无表/无额外资源）作为同 topic 协调的串行化点；详见 ADR-M7-14 + R13。advisory lock 不属于"中间件"，只是事务级 mutex，随事务自动释放。

---

## 3. 调研：现状路径与并发行为

### 3.1 触发路径（群聊）

```
mobile GroupChatScreen.invokeAi
  → POST /intent/analyze              (intentAnalyzer.analyzeIntentUnified)
  → 用户点选 'agent_run' chip
  → POST /intent/execute              (intentExecute L169-225)
  → createAgentRun({ channel: 'group', topicId, groupId, ... })
      → INSERT agent_runs (status='draft')
      → writeGroupPlaceholder
          → INSERT llm_invoke_jobs (status='pending')
          → INSERT group_messages ×2 (human invoker + ai placeholder)
  → worker.pickupNextRun (inFlight=Set, concurrency=1, FOR UPDATE SKIP LOCKED)
  → executeRun → ReAct loop → softComplete
      → UPDATE group_messages.payload.content
      → UPDATE llm_invoke_jobs.status='done'
```

### 3.2 关键文件

| 职责 | 文件 |
|---|---|
| Intent 路由 | `apps/api/src/routes/intent.ts` |
| Intent 分析 | `apps/api/src/lib/intentAnalyzer.ts` / `intentRules.ts` |
| Execute 分支 | `apps/api/src/lib/intentExecute.ts` |
| createAgentRun | `apps/api/src/lib/agent/runLifecycle.ts` |
| 群聊 message bridge | `apps/api/src/lib/agent/messageBridge.ts` |
| Worker pickup | `apps/api/src/lib/agent/worker.ts` / `store.ts` |
| ask_user tool | `apps/api/src/lib/agent/tools/askUser.ts` |
| deep_research tool | `apps/api/src/lib/agent/tools/deepResearch.ts` |
| Mobile 群聊 | `apps/mobile/src/screens/GroupChatScreen.tsx` |
| AgentRunCard | `apps/mobile/src/features/agent/AgentRunCard.tsx` |

### 3.3 现有锁机制

| 机制 | 范围 |
|---|---|
| `FOR UPDATE SKIP LOCKED` (`store.ts` L454-460) | 单条 agent_run 行，防多 worker 抢同一 run |
| `inFlight` Set (`worker.ts` L10, L30) | **进程内全局**：同时只跑 1 个顶层 executeRun |
| `childExecutor` 队列 (`childExecutor.ts` L6-39) | 子 run 独立池，默认 concurrency=3 |
| retry 10s 去重 (`agent.ts` L347-354) | `(owner_id, input_text)`，非 topic |
| heartbeat reclaim (`store.ts` L456-457) | 30s 无 heartbeat 可 re-pickup |

**当前不存在**：topic_locks / advisory_lock / Redis / BullMQ / 任何 topic 级 mutex。

---

## 4. 架构总览与 ADR

### 4.1 总览图

```
intent/execute (kind='agent_run', channel='group')
  ↓
acquireTopicSlot ────┬── 'create_fresh' → createAgentRun（正常）
                     │
                     ├── 'merge' → recordStep(target, user_message_appended)
                     │            + UPDATE merged_inputs
                     │            + INSERT 1 条 invoker 群消息（指向 target）
                     │
                     └── 'queue'  → createAgentRun(status='queued', queue_position=N)
                                  + writeGroupPlaceholder（卡片显示"排队中"）

worker.pickup ── 跳过 status='queued'
  ↓
softComplete / cancelRun / reclaim
  ↓
dequeueNextOnTopic(topicId) ── 队首 'queued' → 'draft'
```

### 4.2 ADR

| ID | 决策 | 选择 | 理由 |
|---|---|---|---|
| **ADR-M7-1** | 是否新建 `topic_locks` 表 | **不建** | worker 已全局串行 + 自动合并 + queued 状态足够表达并发协调；新表带来双源同步风险（agent_runs.status vs topic_locks.holder） |
| **ADR-M7-2** | 同 topic 合并窗口 | 同 owner 任意时间 / 跨 owner 30s | 同 owner 接力问 = 始终是"补充上下文"；跨 owner 30s 是"撞同一事件"的统计经验阈值 |
| **ADR-M7-3** | 追问注入方式 | step `user_message_appended` + **显式注入到 planner / generateFinalReply / 必要时触发 replan**（不依赖 contextAdapter 自然 include —— 实测它只读 group_messages 不读 agent_steps） | 详见 §9。当前 LLM call (≤30s) 期间看不见追问；当前 plan 还有剩余 step 时下一 step 前 checkMergedInputs → 触发 replan；当前 plan 跑完才合并 → 在 generateFinalReply 注入 |
| **ADR-M7-4** | 合并后 UI | 原 AgentRunCard 加后缀"·已合并 N 个追问"，不发新系统消息 | 减少群消息流污染；invoker 自己的人类消息已在群里，足够 |
| **ADR-M7-5** | ask_user 群聊"谁回答" | owner 30s 独占 → 任意群成员（worker checker 升级） | owner 在场即不被打断；30s 是用户能容忍的 owner 响应窗口；超时让"路过的人"能救场 |
| **ADR-M7-6** | deep_research 子 run 群聊呈现 | 子 run channel=group，**新 helper `writeGroupChildPlaceholder` 只写 AI 子任务卡，不写 human invoker**（避免伪造"用户发言"） | 复用 `writeGroupPlaceholder` 会塞一条 human 消息进群里，看起来是 owner 真的发了"研究 xxx"；用 child helper 隔离 |
| **ADR-M7-7** | 子 run 不被合并 | acquireTopicSlot 检测 `parentRunId` → 强制 create_fresh | 避免子 run 合并到父 run 自己（死锁） |
| **ADR-M7-8** | queued 状态可见性 | 卡片显式 "排队中·前 N 个" + 出队后立即 UI 更新 | 减少"卡住了？"的疑问 |
| **ADR-M7-9** | 状态-only 事件如何让 long-poll 立即唤醒 | 扩展 `AgentHookEvent` 加 `run.status_changed`、`run.dequeued`、`ask_user.opened_for_all`；M6 long-poll 路由在 hold 期间订阅这些事件，命中立即 batch 返回 | M6 spec 长轮询只在 `step.recorded` / 终态唤醒；M7 的 queued→draft、ask_user 独占→开放都是 status-only 变化，不补 hook 类型 mobile 端最长 25s 才看见状态变化 |
| **ADR-M7-10** | 合并源 run tombstone | **不创建** —— merge 决策不在 agent_runs 多写一行；`merged_into_run_id` 字段从 spec 删除 | merge 唯一记录就是 `agent_runs.merged_inputs` JSONB 数组 + 一条 `agent_steps.user_message_appended` 行；不需要 tombstone run |
| **ADR-M7-11** | `ask_user` 群聊状态字段更新位置 | tool handler 仅写 group prompt + 返回 `{ paused:true }`；`runExecute` 已有 `paused` 分支统一写 `askUserStartedAt/target/openedForAllAt` | `ToolCtx` 没有 `stepIdx` 等 runtime-only 字段；M3 现有暂停语义就是 handler 返回 paused→runExecute 写状态，M7 沿用 |
| **ADR-M7-12** | `run.status_changed` 事件的 `from`/`to` capture 时机 | 在 `await store.updateAgentRun(...)` 之前先 `const fromStatus = run.status`；不要事后从返回值算（updated.status 已经是新值） | hook 消费方依赖 from→to 转移做匹配（例：long-poll 仅订阅 `to in (replanning, completed, awaiting_user_input)`）；fromStatus 写错会让事件链路出现"从 X 到 X"的伪事件 |
| **ADR-M7-13** | `inputText` 是否被 P1 修改 | **永远不修改**；planner prompt 每次按当前 `merged_inputs` 全量重拼（`buildPlannerUserPrompt` 接受 `mergedInputs` 参数） | 多次追问会累积污染 inputText；用 JSONB 真源 + 即时拼接保持幂等（§9.3a） |
| **ADR-M7-14** | 同 topic 决策 + 落库的并发串行化 | 使用 PG `pg_advisory_xact_lock(hashtext('agent_topic_coord:'||$topicId), hashtext('m7'))` 在**单一事务**内串行化 `acquireTopicSlot` + 后续 `createAgentRun` / `applyMergeInTx` / `applyQueueInTx` 写入；`commit` 前不释放锁 | 仅在判定期持锁、决策后再写入会让两个并发"无 active"请求都决策 `create_fresh` 然后各插一条 active run（双 fresh bug）。把"读 blocking + 写 fresh/merge/queue" 合并进同一事务才能真正闭环；advisory lock 不需要新表，事务结束自动释放 |

---

## 5. 数据模型（migration 020）

```sql
-- 020_agent_topic_coord.sql

-- 自动合并 + 排队
ALTER TABLE agent_runs
  ADD COLUMN merged_inputs JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN queue_position INT,
  ADD COLUMN merged_inputs_consumed_count INT DEFAULT 0;
  -- merged_inputs：[{ text, byUserId, byUsername, at }]
  -- queue_position：queued 时记位次（仅 UI 展示用，非源数据）
  -- merged_inputs_consumed_count：runExecute 已注入到 planner / replan 的追问条数
  --   每步前比较 merged_inputs.length > consumed_count → 触发 replan + 推进 count
  --   见 §9.3

-- ask_user 群聊"谁回答"
ALTER TABLE agent_runs
  ADD COLUMN ask_user_target_user_id TEXT,
  ADD COLUMN ask_user_started_at TIMESTAMPTZ,
  ADD COLUMN ask_user_opened_for_all_at TIMESTAMPTZ;
  -- target_user_id：当前 ask_user 期待谁答（默认 = owner_id；保留字段为未来 planner 显式 @某人留口）
  -- started_at：本次 ask_user 进入 awaiting 的时刻（用于判断"是否已过 30s 独占期"，不能用 last_heartbeat_at —— 它被 worker 持续刷新）
  -- opened_for_all_at：worker checker 升级后 set，UI 据此切显示+权限

-- 拆两个 partial index：blocking 不含 queued，queued 独立
-- 避免 acquireTopicSlot 找 active 时把 queued run 误判为 blocking
CREATE INDEX IF NOT EXISTS idx_agent_runs_topic_blocking
  ON agent_runs(topic_id, created_at DESC)
  WHERE status IN ('draft','planning','running','replanning',
                   'awaiting_approval','awaiting_user_input');

CREATE INDEX IF NOT EXISTS idx_agent_runs_topic_queued
  ON agent_runs(topic_id, created_at ASC)
  WHERE status = 'queued';
```

**`AgentRunStatus` 新增 `'queued'`**（types.ts L9-21）。

**新 step kind**：`'user_message_appended'`，input = `{ text: string, byUserId: string, byUsername: string, mergedAt: string }`。

**`AgentHookEvent` 扩展（ADR-M7-9）**（hooks.ts）：

```typescript
export type AgentHookEvent =
  // 现有
  | { type: 'run.started'; run: AgentRun }
  | { type: 'run.completed'; run: AgentRun }
  | { type: 'run.failed'; run: AgentRun; error: string }
  | { type: 'run.cancelled'; run: AgentRun; byUserId: string | null }
  | { type: 'run.budget_exhausted'; run: AgentRun; resource: string }
  | { type: 'step.recorded'; runId: string; step: AgentStep }
  // M7 新增
  | { type: 'run.status_changed'; run: AgentRun; from: AgentRunStatus; to: AgentRunStatus }
  | { type: 'run.dequeued'; run: AgentRun }
  | { type: 'ask_user.opened_for_all'; runId: string; run: AgentRun }
  | { type: 'run.merged_input_appended'; runId: string; mergedInputsCount: number };
```

**M6 long-poll 路由更新（apps/api/src/routes/agent.ts）**：

在 hold 期间订阅 `agentHookBus`，命中以上任一新事件且 `runId` 匹配 → 立即出 batch。新增订阅清单全部针对**当前 long-poll 的 `id`**，不广播其他 run 的事件。

**复用**：`'tool_call'/'tool_result'` 表达 deep_research 子 run 引用（output 已含 `childRunId`）。

---

## 6. T1：ask_user 群聊解禁（"谁回答"语义）

### 6.1 当前行为

`askUser.ts` L52-60：

```typescript
if (ctx.channel === 'group') {
  return {
    ok: false,
    paused: false,
    messageId: '',
    error: 'ask_user only supported in private channel',
  };
}
```

→ planner 收到 `ok:false` 改用 reply step 表达问题（与普通群消息混在一起）。

### 6.2 新行为（ADR-M7-11：handler 不写状态）

`askUser.ts` tool handler 只做"写消息 + 返回 paused"，状态字段由 runExecute 在 `paused` 分支统一写入。理由：

- `ToolCtx` 当前只暴露 `runId/stepId/ownerId/channel/sessionId/groupId/topicId/signal/apiKey`，**无 `stepIdx`**；M3 现有 ask_user 暂停语义就是"handler 不写 status"，M7 沿用避免重构面扩大。
- 现有 `runExecute` 的 paused 分支已经处理了私聊场景（写 `awaiting_user_input + pendingUserPrompt + pendingUserStepIdx + pendingUserInputExpiresAt`），只需扩展群聊分支。

**askUser.ts handler 改动**：

- **私聊分支**：完全保留 L81-104 现有 `INSERT private_chat_messages` 逻辑，不抽 helper、不重构（避免实施者误以为要新建抽象）；
- **群聊分支**：删除 L55-62 的 `ok:false` 早返回，改成调用新 helper `writeAskUserPrompt`（仅 M7 新增）。

```typescript
async handler(input, ctx) {
  const question = (input.question ?? '').trim();
  if (!question) {
    return { ok: false, paused: false, messageId: '', error: 'question cannot be empty' };
  }

  if (ctx.channel === 'private') {
    // 现有私聊路径保留 askUser.ts L72-113 全部逻辑（sessionId 校验 + INSERT
    // private_chat_messages + try/catch），不抽 helper、不动行为
    return await /* existing private_chat_messages INSERT block */;
  }

  // M7 群聊分支（取代原 L55-62 的 ok:false 早返回）
  if (!ctx.groupId || !ctx.topicId) {
    return { ok: false, paused: false, messageId: '',
             error: 'group ask_user requires groupId+topicId' };
  }
  const msgId = await writeAskUserPrompt({
    runId: ctx.runId,
    groupId: ctx.groupId,
    topicId: ctx.topicId,
    target: ctx.ownerId,
    question,
  });
  return { ok: true, paused: true, messageId: msgId };
}
```

**runExecute paused 分支扩展（apps/api/src/lib/agent/runExecute.ts L334-348）**：

```typescript
if (tool.name === 'ask_user' && obsObj?.ok === true && obsObj?.paused === true) {
  const question = (planStep.input as { question?: unknown })?.question;
  const fromStatus = run.status;  // 必须在 update 前 capture（ADR-M7-12）

  // 复用 store.updateAgentRun 现有签名（Parameters 派生类型）
  // store.ts 尚未 export 单独的 UpdateAgentRunPatch；M7 T1 顺手 export 一下
  const patch: Parameters<typeof store.updateAgentRun>[1] = {
    status: 'awaiting_user_input',
    pendingUserPrompt: typeof question === 'string' ? question : '',
    pendingUserStepIdx: i,
    pendingUserInputExpiresAt: new Date(Date.now() + 24 * 3600 * 1000),
  };
  // M7 群聊扩展：记录 owner 独占起点
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

> T1 实现需在 `store.ts` `export type UpdateAgentRunPatch = Parameters<typeof updateAgentRun>[1]`，便于 spec 内引用类型名（或保持 `Parameters<...>` inline 写法）。

`writeAskUserPrompt` 新增（`messageBridge.ts`）：写一条 `group_messages`，`payload = { kind: 'agent_ask_user', askUser: { runId, target, question, openedForAll: false } }`。

### 6.3 resume 权限

`agent.ts` `POST /api/agent/runs/:id/resume` 现有 handler 改造：

```typescript
async function canAnswerAskUser(run: AgentRun, userId: string): Promise<boolean> {
  if (run.channel !== 'group') return userId === run.ownerId;

  if (userId === run.ownerId) return true;
  if (run.askUserTargetUserId && userId === run.askUserTargetUserId) return true;

  if (run.askUserOpenedForAllAt && new Date(run.askUserOpenedForAllAt) <= new Date()) {
    const member = await isGroupMember(run.groupId!, userId);
    return member;
  }
  return false;
}
```

### 6.4 独占 → 开放升级

新 worker checker：`autoOpenAskUserForAll`（模式对齐 M4 `autoExpireAwaitingUserInput`）：

```typescript
// 每 10s 扫一次
SELECT id, ask_user_target_user_id
FROM agent_runs
WHERE status = 'awaiting_user_input'
  AND channel = 'group'
  AND ask_user_opened_for_all_at IS NULL
  AND ask_user_started_at IS NOT NULL
  AND ask_user_started_at < NOW() - INTERVAL '30 seconds';

// 命中后单事务做 3 件事：
//  1. UPDATE agent_runs SET ask_user_opened_for_all_at = NOW()
//  2. UPDATE 原 ask_user prompt 群消息 payload：openedForAll → true
//     UPDATE group_messages
//        SET payload = jsonb_set(payload, '{askUser,openedForAll}', 'true'::jsonb)
//      WHERE payload->>'kind' = 'agent_ask_user'
//        AND payload->'askUser'->>'runId' = $1
//  3. emit agentHookBus { type: 'ask_user.opened_for_all', runId, run }
//     → long-poll 立即推送 mobile 重渲染（ADR-M7-9）
//
// （不再写 system notice 消息；状态在原 prompt 卡内自然切换即可，群聊更干净）
```

⚠️ **两个关键**：
1. 必须用 `ask_user_started_at` 而不是 `last_heartbeat_at` —— 后者被 worker 持续刷新（M1d 设计），无法表达 status 转换时刻。
2. 必须同时 update 原 group_messages payload —— 否则 mobile `AskUserPromptCard` 渲染原消息时仍读到 `openedForAll:false`，权限切换无依据。

### 6.5 Mobile

新组件 `AskUserPromptCard.tsx`：

- props: `{ runId }`（只接 runId，其余数据从 hook 拉）
- **数据源**：组件内调 `useAgentRunPoll(runId)`（M6 现有 hook），拿 `run.askUserOpenedForAllAt / askUserTargetUserId / pendingUserPrompt / pendingUserInputExpiresAt`
- 渲染：`run.pendingUserPrompt` 问题文本 + "请 @{targetUsername} 回答" 标签 + 30s 倒计时（基于 `askUserStartedAt + 30s`）
- 输入框：仅 `currentUserId === askUserTargetUserId || askUserOpenedForAllAt != null` 时显示
- 倒计时归零或 `askUserOpenedForAllAt != null` → 标签变 "任意群成员可回答"
- 提交 → `POST /api/agent/runs/{runId}/resume { userInput: text }`

**双数据源策略好处**：worker checker 触发的 hook `ask_user.opened_for_all` 经 long-poll 推送，hook 自动重渲染；不依赖原 group_messages payload 是否被更新到。group_messages payload 的更新仅为"消息加载/缓存命中时初始状态可信"。

`GroupChatScreen.tsx` message render 加 `payload.kind === 'agent_ask_user'` 分支 → `<AskUserPromptCard runId={payload.askUser.runId} />`。

### 6.6 复用度

90% 复用 M3/M4 已有的 `awaiting_user_input` 状态机 + `pendingUserPrompt` + resume 路由 + `pendingUserInputExpiresAt` + worker checker 模式；仅新增"群聊权限判定"+"独占→开放升级"+"群聊 prompt 消息" + `AskUserPromptCard`。

---

## 7. T2：群聊 deep_research 子 run 独立卡片

### 7.1 当前行为

`deepResearch.ts` L70-83：

```typescript
const childResult = await createAgentRun({
  ownerId: parentRun.ownerId,
  channel: 'private',          // ← 硬编码
  inputText: input.question,
  // ...
});
```

→ 群里看不到子 run；report 作为 `deep_research` tool output 嵌入父 run reply 文本。

### 7.2 新行为（ADR-M7-6：新 helper `writeGroupChildPlaceholder`）

**为什么不直接复用 `writeGroupPlaceholder`**：它会写一条 `kind: 'human'` 群消息（伪造 owner 发了"研究 xxx"），跟实际"agent 自己派出子 agent"语义不符；老消息加载/导出时会出现 owner 没真说过的话。

**新 helper（apps/api/src/lib/agent/messageBridge.ts）**：

```typescript
export async function writeGroupChildPlaceholder(params: {
  parentRunId: string;
  parentOwnerId: string;
  childRunId: string;
  groupId: string;
  topicId: string;
  childInputText: string;
}): Promise<{ placeholderAiMessageId: string; llmJobId: string }> {
  // 只写一条 ai 占位（无 human invoker），payload 同时挂 agentRun + parentRunId
  const job = await intel.createLlmJob({
    ownerId: params.parentOwnerId,
    invokerUserId: params.parentOwnerId,
    groupId: params.groupId,
    topicId: params.topicId,
    payload: { agentRunId: params.childRunId, parentRunId: params.parentRunId, kind: 'agent_child' },
  });
  const placeholder = await social.addGroupMessage(
    params.parentOwnerId,
    params.groupId, params.topicId,
    { kind: 'ai', content: `[子任务研究中：${params.childInputText.slice(0, 40)}…]`,
      jobId: job.id, invokerUserId: params.parentOwnerId },
  );
  await getPool().query(
    `UPDATE group_messages
       SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
         'agentRun', jsonb_build_object(
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
  return { placeholderAiMessageId: placeholder.id, llmJobId: job.id };
}
```

**deep_research handler 改动**：

```typescript
const isParentGroup = parentRun.channel === 'group';
const childResult = await createAgentRun({
  ownerId: parentRun.ownerId,
  channel: isParentGroup ? 'group' : 'private',
  groupId: isParentGroup ? parentRun.groupId : undefined,
  topicId: isParentGroup ? parentRun.topicId : undefined,
  parentRunId: parentRun.id,
  inputText: input.question,
  surfaceMode: isParentGroup ? 'child_card' : 'default',  // 见下方
  // ... 其他保留
});
```

**`createAgentRun` 加 `surfaceMode` 参数**（`runLifecycle.ts`）：

```typescript
type SurfaceMode = 'default' | 'child_card';
// default：现有 writeGroupPlaceholder（human + ai）
// child_card：M7 deep_research 群聊；走 writeGroupChildPlaceholder（只 ai）
```

**关键防护**（acquireTopicSlot 内）：

```typescript
if (input.parentRunId) {
  return { action: 'create_fresh' };
}
```

避免子 run 被合并到父 run（topic_id 相同会撞）。

### 7.3 mobile 父卡可下钻

`AgentRunCard.tsx` 渲染 tool_call step 时：

```tsx
{step.kind === 'tool_call' && step.input.toolName === 'deep_research' && (
  <TouchableOpacity
    onPress={() => navigation.navigate('AgentRunDetail', { runId: childRunId })}
    style={...}
  >
    <Text>研究中：{input.question}（→ 查看子任务）</Text>
  </TouchableOpacity>
)}
```

`childRunId` 从 step output 取（现有逻辑已记录）。

### 7.4 验证已隔离

`writeGroupPlaceholder` 按 runId 隔离写 group_messages：父 run 和子 run 各自有独立的 invoke/result 消息，不互相覆盖。已经验证 `messageBridge.ts` 的 finalize 路径用 `lookupGroupLlmJobId(run.resultMessageId)` 按 runId 路由。

---

## 8. T3：topic_lock + queued UX（最小贴合原 spec）

### 8.1 acquireTopicSlot 算法

```typescript
type SlotDecision =
  | { action: 'create_fresh' }
  | { action: 'merge'; targetRunId: string; mergedByUserId?: string }
  | { action: 'queue'; precedingCount: number };

async function acquireTopicSlot(
  input: {
    channel: AgentChannel;
    topicId: string | null;
    ownerId: string;
    parentRunId?: string | null;
  },
  client?: PoolClient,  // 持锁事务时由 withTopicCoordination 注入
): Promise<SlotDecision> {
  // 子 run 强制 fresh（防自合并）
  if (input.parentRunId) return { action: 'create_fresh' };

  // 私聊不参与协调
  if (input.channel !== 'group' || !input.topicId) {
    return { action: 'create_fresh' };
  }

  // 注意：blocking 不含 queued —— queued run 本身不阻塞，新来的应该 merge / queue
  // 到真正在跑的那个，而不是 merge 到另一个 queued
  const blocking = await findBlockingActiveOnTopic(input.topicId, client);
  if (!blocking) {
    // 没有 blocking 但可能有 queued（罕见：刚 dequeue 完还没 pickup）
    // 此时新 run 直接 create_fresh，让 worker 自行 FIFO；不与 queued 合并
    return { action: 'create_fresh' };
  }

  // 同 owner → 任意时间合并
  if (blocking.ownerId === input.ownerId) {
    return { action: 'merge', targetRunId: blocking.id };
  }

  // 跨 owner + 30s 窗口 → 合并
  const ageMs = Date.now() - new Date(blocking.createdAt).getTime();
  if (ageMs < 30_000) {
    return { action: 'merge', targetRunId: blocking.id, mergedByUserId: input.ownerId };
  }

  // 跨 owner + 窗口外 → queue
  const precedingCount = await countBlockingPlusQueuedOnTopic(input.topicId, client);
  return { action: 'queue', precedingCount };
}
```

**调用 contract（强制）**：群聊 channel 必须将 `acquireTopicSlot` 调用包在 `withTopicCoordination(topicId, async (client) => { ... })` 内，并把 `client` 透传给 `acquireTopicSlot` + 后续 `insertAgentRun` / `applyMergeInTx` / `applyQueueInTx`。否则两个并发请求会先后拿锁却各自看到"无 active"，双写 fresh run（ADR-M7-14 + R13 详述）。

**store 层新增 3 个查询**：

| 函数 | SQL | 用途 |
|---|---|---|
| `findBlockingActiveOnTopic(topicId, client?)` | `WHERE topic_id=$1 AND status IN ('draft','planning','running','replanning','awaiting_approval','awaiting_user_input') ORDER BY created_at DESC LIMIT 1` | acquireTopicSlot 判定 blocking；持锁事务时传 `client` 复用 |
| `findQueuedHeadOnTopic(topicId, client?)` | `WHERE topic_id=$1 AND status='queued' ORDER BY created_at ASC LIMIT 1` | dequeueNextOnTopic 拿队首 |
| `countBlockingPlusQueuedOnTopic(topicId, client?)` | `COUNT(*) WHERE topic_id=$1 AND status IN (blocking ∪ 'queued')` | queue 决策时算 precedingCount |

> store 层这三个函数 + `insertAgentRun` / `applyMergeInTx` / `applyQueueInTx` 都额外接 `client?: PoolClient` 可选形参；不传时走 `getPool().query` 旧路径（保留向后兼容），传入时复用 `withTopicCoordination` 的事务客户端。

两个 partial index（§5）分别支持前两个查询零回表。第三个 count 走 union scan（数量小，可接受）。

### 8.2 merge 分支处理（在 intentExecute 内）

实施细节直接复用现有 `social.addGroupMessage`（无新 wrapper），merge 分支整体作为一个事务包：

```typescript
case 'merge': {
  const username = await lookupUsername(input.userId);
  const mergedEntry = {
    text: input.text,
    byUserId: input.userId,
    byUsername: username,
    at: new Date().toISOString(),
  };

  // 单事务：append step + append merged_inputs JSONB
  // 注意：UPDATE WHERE status NOT IN (terminal) 是 race 兜底
  // → 命中 rowCount=0 抛 MergeTargetTerminalError，retry-once 路径触发重判
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    // recordStep 内部用 stepRecorder，要走全局 emit hook → 单独调，不放事务
    await client.query('COMMIT');
  } finally { client.release(); }

  // step + merged_inputs append 走 store helper（store 层已封装事务）
  await store.applyMergeInTx(decision.targetRunId, mergedEntry);
  agentHookBus.emitEvent({
    type: 'run.merged_input_appended',
    runId: decision.targetRunId,
    mergedInputsCount: (await store.getMergedInputCounts(decision.targetRunId))!.total,
  });

  // 仅写 1 条 invoker 群消息（人类发言），指向原 run；复用 social.addGroupMessage
  const invoke = await social.addGroupMessage(
    input.userId,
    decision.groupId, decision.topicId,
    { kind: 'human', content: input.text, jobId: null, invokerUserId: input.userId },
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
      [invoke.id, decision.targetRunId, input.userId],
    );
  }

  return {
    type: 'agent_merged',
    runId: decision.targetRunId,
    mergedInto: decision.targetRunId,
    invokerMessageId: invoke?.id ?? null,
  };
}
```

**新 store helper `applyMergeInTx`**（store.ts）：

```typescript
export async function applyMergeInTx(
  targetRunId: string,
  entry: { text: string; byUserId: string; byUsername: string; at: string },
): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    // 1. 写 user_message_appended step
    const nextIdx = await maxStepIdxInTx(client, targetRunId);
    await client.query(
      `INSERT INTO agent_steps (id, run_id, idx, kind, input)
         VALUES ($1, $2, $3, 'user_message_appended', $4::jsonb)`,
      [randomUUID(), targetRunId, nextIdx + 1, JSON.stringify(entry)],
    );
    // 2. append merged_inputs JSONB（条件：run 还活跃）
    const updateRes = await client.query(
      `UPDATE agent_runs
         SET merged_inputs = COALESCE(merged_inputs, '[]'::jsonb) || $1::jsonb
       WHERE id = $2
         AND status NOT IN ('completed','failed','cancelled','budget_exhausted')`,
      [JSON.stringify([entry]), targetRunId],
    );
    if (updateRes.rowCount === 0) {
      await client.query('ROLLBACK');
      throw new MergeTargetTerminalError(targetRunId);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
```

step 的 `idx` 在事务内通过 `SELECT COALESCE(MAX(idx), -1)+1 FROM agent_steps WHERE run_id=$1` 拿。注意这里**不**走 `stepRecorder.recordStep`（它会发 `step.recorded` hook，merge 路径专属 hook 是 `run.merged_input_appended`，避免重复唤醒 long-poll）。

### 8.3 queue 分支处理

正常 `createAgentRun` 但：

```typescript
const r = await store.insertAgentRun({
  ...standardFields,
  status: 'queued',
  queuePosition: decision.precedingCount,
});

await writeGroupPlaceholder({ runId: r.id, ... });
// placeholder 上的 AgentRunCard 看到 status='queued' → 显示"排队中·前 N 个"
```

### 8.4 dequeueNextOnTopic

```typescript
// 在 softComplete / cancelRun / reclaim 三个出口都调
async function dequeueNextOnTopic(topicId: string): Promise<void> {
  // 用 blocking 选择器：queued run 本身不算 blocking
  const stillBlocking = await store.findBlockingActiveOnTopic(topicId);
  if (stillBlocking) return;  // 还有其他 run 在跑，继续等

  const next = await store.findQueuedHeadOnTopic(topicId);
  if (!next) return;

  const updated = await store.updateAgentRun(next.id, {
    status: 'draft',
    queuePosition: null,
  });
  agentHookBus.emitEvent({ type: 'run.dequeued', run: updated! });
  // 下个 worker tick 自然 pickup
}
```

**worker `pickupNextRun` 已有约束**（store.ts L455）：

```sql
WHERE status IN ('draft','planning','running','replanning')
```

不含 `'queued'`，所以 queued run 永远不会被错误 pickup。M7 不改这一行。

### 8.5 mobile

`AgentRunCard.tsx` 加分支：

```tsx
{run.status === 'queued' && (
  <Text style={...}>
    排队中 · 前面还有 {run.queuePosition ?? '?'} 个任务
  </Text>
)}

{run.mergedInputs && run.mergedInputs.length > 0 && (
  <Text style={...}>· 已合并 {run.mergedInputs.length} 个追问</Text>
)}
```

---

## 9. T4：自动合并（追问消化机制）

### 9.1 现状的真相（review 修正）

之前版本 spec 错误假设"`contextAdapter.snapshotForAgent` 已经 include 全部 agent_steps，`user_message_appended` 自然出现在 step 序列中"。

**实测**：

- `contextAdapter.snapshotForAgent`（apps/api/src/lib/agent/contextAdapter.ts L128-145）**只读 `group_messages` 表**，根本不读 `agent_steps`；group history 走 `listGroupMessages` + `resolveGroupHistoryMessages.slice(-12)`。
- `runExecute` 主循环（runExecute.ts L124）按**初始 plan 顺序**执行固定步骤，**不会**每步重新让 planner 看 steps；只有 `applyReplanningIfNeeded`（critique / approval deny / steer 触发）才会重 plan。
- `replyGen.generateFinalReply`（replyGen.ts）拿全部 steps 但 prompt 只渲染 tool_call/observe；`user_message_appended` 不在它的渲染范围。

**结论**：不做额外注入，`user_message_appended` 只是 DB 里的死记录。M7 必须显式 wire 4 个注入点：

### 9.2 追问消化的 4 个注入点

| 注入点 | 触发时机 | 看到的内容 | 实现位置 |
|---|---|---|---|
| **P1 planner replan** | runExecute 主循环每步前 `checkMergedInputsChanged()` → 若有未消化追问 → 触发 replan | planner 看到 `# 用户原始请求 + # 追问列表` | `runExecute.ts` 主循环 + `planner.buildPlannerUserPrompt` |
| **P2 final reply** | `generateFinalReply` 构造 system / user prompt 时拼入未消化追问 | LLM 终稿能呼应全部追问 | `replyGen.ts.buildReplyMessages` |
| **P3 critique** | `runCritique`（已有）拿到 steps + run → 把追问也放进 critique prompt | critique 能基于追问判断"plan 还合理吗" | `critique.ts` |
| **P4 群聊 history** | snapshotForAgent for group 时**额外**读本 run 的 `user_message_appended` step → 作为 user message 末尾拼入 history | LLM 短摘要 / 后续 LLM call 都能看到 | `contextAdapter.ts.snapshotForAgent` |

P1 是最关键的（让 agent 真正按追问"行动"）；P2-P4 是兜底（即使没触发 replan，最终 reply / critique / 后续 LLM 都能感知）。

### 9.3 P1 详解：runExecute 每步前 check + 触发 replan

新增 `agent_runs.merged_inputs_consumed_count INT DEFAULT 0`（§5）。

**关键原则**：**不写 `inputText`**。`merged_inputs` JSONB 是真源；inputText 保持创建时原值。否则多次追问会累积污染（第一次 P1 拼了"# 后续追问"段，第二次 P1 又拼一遍 → 重复 header）。consumed_count 只用来判定"是否需要触发 replan"。

**runExecute 主循环每步前（L124 for 循环顶部）插入**：

```typescript
// M7 P1：检查是否有未消化追问 → 触发 replan
// 仅 reload 必要字段，避免每步全表 SELECT 浪费（见 R12）
const counts = await store.getMergedInputCounts(runId);
if (counts && counts.total > counts.consumed) {
  const fromStatus = run.status;  // 必须在 update 前 capture（见 ADR-M7-12）

  // 1. 写一条 replan step，明示 reason='merge_trigger'
  //    避免 applyReplanningIfNeeded critique 分支落 'critique_or_unspecified'
  //    误导日志/排查
  await recordStep({
    runId,
    kind: 'replan',
    output: {
      reason: 'merge_trigger',
      mergedTotal: counts.total,
      previouslyConsumed: counts.consumed,
    },
  });

  // 2. 推进 consumed count + 标 replanning + 让出
  await store.updateAgentRun(runId, {
    mergedInputsConsumedCount: counts.total,
    status: 'replanning',
  });

  // 3. emit status hook → long-poll 推送 mobile
  const latest = (await store.getAgentRun(runId))!;
  agentHookBus.emitEvent({
    type: 'run.status_changed',
    run: latest,
    from: fromStatus,
    to: 'replanning',
  });

  return;  // runExecute 退出，worker tick 后再 pickup → applyReplanningIfNeeded
}
```

**`store.getMergedInputCounts(runId)`** 新增（仅查 2 字段）：

```typescript
export async function getMergedInputCounts(
  runId: string,
): Promise<{ total: number; consumed: number } | null> {
  const { rows } = await getPool().query(
    `SELECT jsonb_array_length(COALESCE(merged_inputs, '[]'::jsonb)) AS total,
            COALESCE(merged_inputs_consumed_count, 0) AS consumed
       FROM agent_runs WHERE id = $1`,
    [runId],
  );
  if (!rows[0]) return null;
  return { total: Number(rows[0].total), consumed: Number(rows[0].consumed) };
}
```

**`applyReplanningIfNeeded` 修改**（runExecuteHelpers.ts L63 起）：把 merge_trigger 路径作为 critique 分支的一种 reason，但**不重复 record replan step**（P1 已 record）。修改片段：

```typescript
// 在 critique 分支前先查最近 replan step 的 reason
const lastReplan = [...steps].reverse().find((s) => s.kind === 'replan');
const mergeTriggered = (lastReplan?.output as { reason?: string } | null)?.reason === 'merge_trigger';

// 走 critique 分支但跳过重复 recordStep
} else if (!steerIsNewest) {
  if (!mergeTriggered) {
    await recordStep({ runId: run.id, kind: 'replan', output: { reason: 'critique_or_unspecified', ... } });
  }
  next = (await store.updateAgentRun(run.id, { plan: null, todos: [] }))!;
}
```

之后正常走 `executeRun` 的 `if (!run.plan) → buildInitialPlan → generatePlanWithLlm`。

### 9.3a P1 planner prompt 拼接（即时，不污染 DB）

`buildPlannerUserPrompt`（planner.ts L235-241）扩展接受 `mergedInputs` 参数：

```typescript
// 改造前
return `# 用户请求\n${input.inputText}${summary}${failure}`;

// 改造后
const mergedSection = (input.mergedInputs ?? []).length > 0
  ? `\n\n# 后续追问（合并自其他成员，需在新 plan 中一并回应）\n` +
    input.mergedInputs!.map((m, i) =>
      `${i + 1}. @${m.byUsername} (${m.at}): ${m.text}`).join('\n')
  : '';
return `# 用户请求\n${input.inputText}${mergedSection}${summary}${failure}`;
```

`buildInitialPlan`（runPlanGlue.ts L92-99）传入 `run.mergedInputs`：

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

**消化时机**：

- merge 发生时**不立即** interrupt 当前 LLM call（不浪费 token）；
- 当前 step 跑完进入下一 iteration 顶部检查时才触发 replan；
- 最坏延迟 ≈ 一个 LLM call (≤30s) + 一个 tool call (≤30-60s)。

### 9.4 P2 详解：generateFinalReply 拼追问

`buildReplyMessages`（replyGen.ts L100-148）当前 system message 模板里只渲染 toolSteps。M7 改成：

```typescript
const mergedInputs = run.mergedInputs ?? [];
const mergedSection = mergedInputs.length > 0
  ? `\n\n# 后续追问列表（共 ${mergedInputs.length} 条，需在 reply 中统一回应）\n` +
    mergedInputs.map(m => `- @${m.byUsername}: ${m.text}`).join('\n')
  : '';
// 拼到 system message 尾部
```

### 9.5 P4 详解：contextAdapter group 分支拼 user_message_appended

`snapshotForAgent` group 分支末尾，从 `agent_steps` 拉本 run 的 `user_message_appended`，作为 history user messages 拼入：

```typescript
// 在 history 数组末尾加
const apSteps = await store.listSteps(params.runId);
const appended = apSteps.filter(s => s.kind === 'user_message_appended');
for (const s of appended) {
  const input = s.input as { text: string; byUsername: string };
  history.push({ role: 'user', content: `[${input.byUsername}] ${input.text}` });
}
```

### 9.6 合并 race condition

多个并发 `intent/execute` 同时命中"merge to same active run"是可能的（两个用户同时提交）。处理：

```typescript
// intentExecute 群聊分支：单事务持锁 → 决策 → 写入
async function executeAgentRunWithRetry(input): Promise<AgentExecResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await withTopicCoordination(input.topicId!, async (client) => {
        const decision = await acquireTopicSlot(input, client);
        if (decision.action === 'merge') {
          return await applyMergeInTx(decision.targetRunId, input, client);
        }
        if (decision.action === 'queue') {
          return await applyQueueInTx(decision.precedingCount, input, client);
        }
        return await applyCreateFreshInTx(input, client);
      });
    } catch (err) {
      if (err instanceof MergeTargetTerminalError && attempt === 0) {
        continue;  // 目标 run 在 merge 事务期间转 terminal，重判
      }
      throw err;
    }
  }
  throw new Error('agent run slot acquisition failed after retry');
}

// applyMergeInTx 在已经持有 topic advisory lock 的 client 上额外锁定目标 run 行：
async function applyMergeInTx(targetRunId, input, client) {
  // SELECT FOR UPDATE 防止与同 run 的其他 worker 写 step 并发出 idx 撞车
  const lockRes = await client.query(
    `SELECT status FROM agent_runs WHERE id = $1 FOR UPDATE`,
    [targetRunId],
  );
  if (lockRes.rowCount === 0) throw new MergeTargetTerminalError();
  const status = lockRes.rows[0].status;
  if (TERMINAL_STATUSES.includes(status)) throw new MergeTargetTerminalError();

  const maxRes = await client.query(
    `SELECT COALESCE(MAX(idx), -1) AS max_idx FROM agent_steps WHERE run_id = $1`,
    [targetRunId],
  );
  const nextIdx = Number(maxRes.rows[0].max_idx) + 1;
  await client.query(
    `INSERT INTO agent_steps (..., idx, ...) VALUES (..., $1, ...)`,
    [nextIdx, /* ... */],
  );
  await client.query(
    `UPDATE agent_runs
       SET merged_inputs = merged_inputs || $1::jsonb,
           status = CASE
                      WHEN status IN ('planning','running','awaiting_approval','awaiting_user_input')
                        THEN 'replanning'
                      ELSE status
                    END,
           updated_at = NOW()
     WHERE id = $2`,
    [JSON.stringify([mergedEntry]), targetRunId],
  );
  return { kind: 'merged', targetRunId };
}
```

要点：
1. `withTopicCoordination` 内 `commit` 之前**不释放** advisory lock，因此 `acquireTopicSlot` + `applyXxxInTx` 全程对同 topic 串行；
2. `applyMergeInTx` 内再 `SELECT ... FOR UPDATE` 锁住目标 run 行，把"读 MAX(idx) → INSERT step"与同 run 其它步骤写入互斥（同 run 的 step 写入也走 row lock 配合），避免 unique constraint 撞车；
3. retry 只发生 1 次（重判通常变成 `create_fresh` 或 `queue`）；超过 1 次仍失败说明 DB 异常，抛错由上层处理。

---

## 10. 群聊 UI 改动汇总（mobile）

| 组件 | 改动 | 复杂度 |
|---|---|---|
| `AgentRunCard.tsx` | (1) `status='queued'` 显示"排队中·前 N 个"<br>(2) `merged_inputs.length > 0` 显示"·已合并 N 个追问"后缀<br>(3) `tool_call` 是 `deep_research` 且 `channel='group'` → 行可点击跳子 run 详情 | 中 |
| `AskUserPromptCard.tsx`（新） | 群聊 ask_user 提示卡：问题 + target user 标签 + 30s 倒计时 + 条件输入框 | 中 |
| `GroupChatScreen.tsx` | message render 加 `payload.askUser` 分支 → `AskUserPromptCard` | 小 |
| `BrainAgentRunDetailScreen` | 复用现有（merged_inputs / queue_position 在 AgentRunCard header 显示） | 极小 |
| `useAgentRunPoll` | 不动（long-poll 已能推送 status 变化和 merged_inputs 更新） | 0 |

**不动**：long-poll、artifact、Settings、写作、其他工具卡。

---

## 11. 任务拆分与时序

| Tx | 内容 | 工时 | 依赖 |
|---|---|---|---|
| **T0** | 分支 + baseline 全量测试 | 0.2 d | — |
| **T1** | migration 020（merged_inputs / consumed_count / queue_position / ask_user_* / 拆两个索引）+ types/store 扩展（含 `export type UpdateAgentRunPatch`）+ `AgentRunStatus='queued'` + 新 step kind + `AgentHookEvent` 4 个新事件 + **mobile `apps/mobile/src/features/agent/types.ts` 同步**（AgentRunStatus / mergedInputs / queuePosition 等字段）| 1.0 d | T0 |
| **T2** | acquireTopicSlot + findBlockingActiveOnTopic / findQueuedHeadOnTopic / countBlockingPlusQueuedOnTopic + 单测 | 1.0 d | T1 |
| **T3** | intentExecute 三分支处理（create_fresh/merge/queue） + recordStep `user_message_appended` 注入 + applyMergeInTx + writeGroupMessage(invoker-only) + retry-once 包装 | 1.2 d | T2 |
| **T4** | dequeueNextOnTopic + 在 softComplete/cancelRun/reclaim 三出口集成 + emit `run.dequeued` hook | 0.5 d | T3 |
| **T5** | **追问消化机制 P1-P4**：runExecute checkMergedInputs + planner buildPlannerUserPrompt 加追问段 + replyGen.buildReplyMessages 加追问段 + critique.runCritique 加追问段 + contextAdapter group 分支拼 user_message_appended | 1.5 d | T1, T3 |
| **T6** | ask_user 群聊：handler 仅写 prompt 消息 + runExecute paused 分支扩展群聊状态字段 + canAnswerAskUser + autoOpenAskUserForAll worker checker（同事务 update group_messages payload + emit hook） | 1.5 d | T1 |
| **T7** | deep_research 群聊：新 helper `writeGroupChildPlaceholder` + createAgentRun 加 `surfaceMode` 参数 + parentRunId 防自合并已在 T2 | 0.7 d | T2, T6 |
| **T8** | **M6 long-poll 路由订阅 4 个新 hook 事件**：`run.status_changed` / `run.dequeued` / `ask_user.opened_for_all` / `run.merged_input_appended` 命中立即出 batch + TB15 集成测试（mock hook emit）| 0.6 d | T1 |
| **T9** | mobile AgentRunCard：queued / merged 后缀 / deep_research 跳转 | 0.5 d | T3, T7 |
| **T10** | mobile AskUserPromptCard（新组件，只接 runId + useAgentRunPoll 拉状态） + GroupChatScreen 集成 | 1.0 d | T6 |
| **T11** | 测试矩阵 backend (TB1-TB17) + mobile tsc 验证 + code-reviewer subagent 跑 diff | 1.3 d | T2-T10 |
| **T12** | Merge main + tag v0.m7 | 0.2 d | T11 |

**合计 11.2 天**，对齐 2.5-3 周日历时间（含 review/修复/buffer）。相对 v2 多 0.6 天，主要来自 T1（mobile types 同步 +0.3）/ T8（TB15 集成 +0.2）/ T11（TB16-TB17 +0.1）。

**并行性**：T5 / T6 / T7 / T8 / T9 / T10 在 T4 后可在不同维度并行（T5/T6 backend；T7 backend；T8 backend；T9/T10 mobile）。

---

## 12. 测试矩阵

### 12.1 Backend (`vitest` + DB)

| ID | 主题 | 类型 | 覆盖点 |
|---|---|---|---|
| TB1 | acquireTopicSlot create_fresh | unit | private / 无 active → fresh |
| TB2 | acquireTopicSlot same_owner_merge | unit | 同 owner 任意时间 → merge |
| TB3 | acquireTopicSlot cross_owner_in_window | unit | 跨 owner 5s 内 → merge with mergedByUserId |
| TB4 | acquireTopicSlot cross_owner_after_window | unit | 跨 owner 60s 后 → queue with precedingCount |
| TB5 | acquireTopicSlot parent_run_skip | unit | parentRunId 存在 → 强制 create_fresh |
| TB6 | dequeue on terminal | integration | active run softComplete → 队首 'queued' → 'draft' |
| TB7 | merge step 注入 + race | integration | merge 后 listSteps 含 user_message_appended；并发 merge 时事务安全 |
| TB8 | ask_user group owner only | integration | 群 ask_user 后 30s 内非 owner resume → 403 |
| TB9 | ask_user group open for all | integration | 30s 后 worker checker 升级；任意群成员 resume → 200 |
| TB10 | ask_user group non-member | integration | 非群成员 resume → 403（即使过 30s） |
| TB11 | deep_research group child | integration | 父 group → 子 channel=group + writeGroupChildPlaceholder（仅 1 条 ai 消息，无 human）+ 不合并 |
| TB12 | jsonbOrNull regression | unit | merged_inputs null-clear 走 helper（jsonbOrNull 已存在） |
| **TB13** | 追问消化 P1 触发 replan | integration | merge 发生后下一 iter 顶部检测 → record replan step(reason='merge_trigger') → status='replanning' → applyReplanningIfNeeded（识别 merge_trigger 跳过重复 record）→ planner LLM mock 验证 user prompt 含"# 后续追问"段；同时验证 `agent_runs.inputText` 未被修改 |
| **TB14** | 追问消化 P2 final reply | integration | run 完成 + 有 merged_inputs → buildReplyMessages 包含追问段 |
| **TB15** | long-poll 状态-only 唤醒 | integration | long-poll hold 中 emit `run.dequeued` / `ask_user.opened_for_all` → 立即出 batch（&lt; 200ms） |
| **TB16** | findBlockingActiveOnTopic 排除 queued | unit | 同 topic 有 1 running + 1 queued → findBlocking 只返 running；findQueuedHead 返 queued |
| **TB17** | ask_user worker checker 同事务 update | integration | 30s 后 worker checker 触发 → agent_runs.ask_user_opened_for_all_at + group_messages.payload.askUser.openedForAll 同步为 true |

### 12.2 Mobile (`tsc --noEmit` + 手测清单)

| 主题 | 覆盖 |
|---|---|
| AgentRunCard queued 显示 | `status='queued'` 渲染"排队中·前 N" |
| AgentRunCard merged 后缀 | `merged_inputs.length > 0` 显示后缀 |
| AskUserPromptCard owner 期 | 输入框仅 owner / target 可见 |
| AskUserPromptCard 开放期 | 倒计时归零或 `openedForAll=true` 输入框对全员可见 |
| deep_research 跳转 | 父卡 `deep_research` tool_call 行点击 → child run 详情 |

---

## 13. 风险与失败模式

| ID | 风险 | 缓解 |
|---|---|---|
| **R1** | ask_user 群聊 owner 长时间不答，run 超时 cancel → "AI 提了问题就消失了" | 复用 M4 `pendingUserInputExpiresAt` 24h timeout；triggers `cancelRun(reason: 'user_timeout')` 已实现；UI 显示倒计时 |
| **R2** | 自动合并误判（场景：第二个人问完全不相关的事） | 30s + 同 topic 已是强约束；UI 后缀让 owner 看见可"拆出"（实操：cancel + 重发）；不加内容判断（YAGNI） |
| **R3** | 子 run（deep_research group）的 acquireTopicSlot 死循环 | `parentRunId` 强制 create_fresh，TB5 覆盖 |
| **R4** | queued run 永不出队（active run 卡死） | M1d `last_heartbeat_at` reclaim 机制；30s 无 heartbeat → re-pickup；queued dequeue 在 softComplete / cancelRun / reclaim 三个出口都触发 |
| **R5** | merge 时第二个 invoker 在群里期待看到自己的 AgentRunCard，但没出来 | invoker 群消息 `payload.agentRun.agentRunId` 指向原 run，点击该消息下钻；卡片后缀显示"·已合并 @user2"让原 owner 看见 |
| **R6** | ask_user 开放后多人抢答竞态 | resume 路由用事务 + `FOR UPDATE` 加锁 agent_run 行 + 检查 `status === 'awaiting_user_input'`；第二个 resume → 409 conflict |
| **R7** | 已 queued 的 run 用户想取消 | 复用现有 `cancelRun`，会触发 `dequeueNextOnTopic` 让下一个出队 |
| **R8** | 历史群聊老 run 的 schema 兼容 | 新字段全部 `DEFAULT NULL / '[]'::jsonb / 0`；老 run 读出来正常 |
| **R9** | 追问消化延迟（P1 最坏 ≈ 一个 LLM call + 一个 tool call） | 已在 §9.3 明示；UI 后缀"·已合并 N 个追问"立即显示让用户感知"被收到了"；最坏延迟仍远小于 24h timeout |
| **R10** | merged_inputs 暴增（恶意循环 @AI） | UI 后缀已显示数量；P1 replan 时 planner prompt 拼追问段可能爆 token；缓解：单 run merged_inputs.length 软上限 20，超过 → 自动 queue 而非 merge；另在 `acquireTopicSlot` 内额外检查 `usage.elapsedSeconds > 600` 或 `usage.steps >= maxSteps - 2`，命中也强制 queue；后期可在 `app_settings` 加可调上限 |
| **R11** | 验收/测试矩阵编号扩展 | TB1-TB17 共 17 个 case（原 12 + 新 5）；基线 ~470 + 新增 17 ≈ 487 |
| **R12** | 每步前 `getMergedInputCounts` DB roundtrip | 仅 SELECT 2 列 + PK 命中，<1ms；典型 plan 长度 5-15 步 → 全程 < 20ms overhead；若未来 plan 显著变长，可改用 `agentHookBus` listener 在 worker 内存维护 dirty flag |
| **R13** | 同 topic 两个 fresh 并发产生（race） | 见 ADR-M7-14：`acquireTopicSlot` 在事务内 `pg_advisory_xact_lock(hashtext('agent_topic_coord:'||topicId), hashtext('m7'))`，**该事务内**直接完成 `createAgentRun` / `applyMergeInTx` / `applyQueueInTx` 写入，commit 后再返回 decision。判定与写入分离会导致双 fresh；不能拆。TB1 / TB16 用 `Promise.all([acquire1, acquire2])` verify |

---

## 14. 与未来子项目的衔接

| 子项目 | 本期预留 |
|---|---|
| **B' （B 后续期）** | 群体投票/审批 / 跨 topic 资源协调 / 任务"协作者列表"显示 |
| **C 上下文 v2** | `merged_inputs` 已经是 ReAct context 的一部分，C 实现 `snapshotForAgent v2` 时自然兼容 |
| **E 定时调度** | 定时触发的 agent_run 走 `parentRunId=null + channel='group'` 也会走 acquireTopicSlot；定时任务遇到"撞 active run"自动 queued，不会"被合并到用户任务"（因为定时任务的 ownerId 不同且通常超过 30s 窗口） |
| **D 工具集补完（M7 后续）** | 不影响（工具是 step 内执行，跟并发协调正交） |

---

## 15. 验收（Acceptance Criteria）

合并到 main 前必须满足：

1. ✅ G1-G5 全部通过手测
2. ✅ TB1-TB17 全部 PASS
3. ✅ Mobile §12.2 手测清单 5 项全部验证
4. ✅ Mobile `npx tsc --noEmit` exit 0
5. ✅ Backend `vitest run` 全绿（基线 ~470 + 新增 17 ≈ 487）
6. ✅ 私聊路径任意 run 完整跑通（M1-M6 case 抽样验证）
7. ✅ code-reviewer subagent diff main..HEAD 无 Critical
8. ✅ 合并 + tag v0.m7

---

## 16. 设计决策附录（关键 Q&A）

**Q: 为什么不直接用 `topic_locks` 表？**
A: 原 spec 提出 `topic_locks` 是 5 年前 worker 单进程没确定时的设想；现状 worker 已经全局串行（`inFlight` Set + DB SKIP LOCKED），再加 topic_locks 是双源同步（`agent_runs.status` vs `topic_locks.holder_run_id`），任何一边 update 漏掉就会出现"锁了没人持有"或"持有者已 terminal 但锁还在"的脏状态。用 `agent_runs.status` 单一真相源 + 高频索引查询，胜在数据一致性。

**Q: 为什么合并窗口选 30s 而不是 10s 或 60s？**
A: 10s 太短，群里"用户 1 说完用户 2 打字 10s 内回"的场景频繁；60s 太长，跨场景的不同问题会被错误合并。30s 是"接力对话"和"独立问题"的统计经验阈值；可在 `app_settings` 表加 `agent_merge_window_ms` 后期调（本期写常量即可）。

**Q: 为什么 ask_user 群聊 owner 独占期是 30s？**
A: 与合并窗口数字一致，便于用户记忆（"30s 是群聊 agent 协调的统一节拍"）。owner 30s 内通常仍在场（刚发完消息）；30s 后大概率切走，需要别人接力。

**Q: merge 时为什么不写 ai placeholder？**
A: ai placeholder 是为了让群里出现 AgentRunCard。merge 已经有原 run 的 AgentRunCard 在群里跑着，再写一条 placeholder 会让群里出现两张同 runId 的卡（mobile L554-558 任何 `agentRun.agentRunId` 都挂卡）。让 invoker 消息 `payload.agentRun.agentRunId` 指向原 run 即可下钻，不需要新卡。

**Q: 自动合并能不能扩展到 `chat_group_llm`（普通群聊 LLM）？**
A: 不做。`chat_group_llm` 已经是同步 LLM call（用户发完几秒返回），没有"长任务在跑"的并发问题；合并语义不适用。本期只动 `agent_run`。

**Q: queue_position 字段是真实数据还是 UI hint？**
A: UI hint。队列实际位次靠"创建时间 + status='queued'"动态计算（`countBlockingPlusQueuedOnTopic`），`queue_position` 仅记录创建时的位置便于初始渲染。当其他 queued run 被取消时，位置可能"自然前进"但 `queue_position` 不更新（避免 N 个 queued run 同时刷新的写放大）；UI 每次 long-poll 都重算实时位次。

**Q: ask_user 群聊 prompt 消息 vs 普通 agent reply 消息怎么区分？**
A: `payload.kind = 'agent_ask_user'`（新增）vs 现有 `payload.agentRun`。mobile render 优先识别 `agent_ask_user` → `AskUserPromptCard`；现有 `agentRun` 路径不动。

**Q: 设计里出现了多个"30s"，是同一个吗？**
A: 不是，是 3 个独立的 30s，刚好都取经验值，文档明确区分如下：

| 场景 | "30s" 含义 | 字段/常量 | 出处 |
|---|---|---|---|
| 跨 owner 合并窗口 | 同 topic active run `created_at + 30s` 内的后发触发 → 自动合并 | `MERGE_WINDOW_MS = 30_000` (T2) | §8.1 |
| ask_user owner 独占期 | ask_user 进入 awaiting 后 `ask_user_started_at + 30s` 内非 owner/target 不能 resume | `ASK_USER_OWNER_LOCK_MS = 30_000` (T5) | §6.4 |
| worker heartbeat reclaim | run 上 `last_heartbeat_at + 30s` 仍无更新 → 视为 worker 死亡，re-pickup | 现有，M1d | §3.3 |

这 3 个常量在代码里独立定义、独立调整，文档解释里都写"30s"是巧合（且方便用户记忆）。

**Q: ReAct loop 在跑时合并的追问，下一 iteration 才生效，会不会让用户觉得"我刚追问了 AI 怎么没反应"？**
A: AgentRunCard 的"·已合并 N 个追问"后缀**立即更新**（合并事务 commit 后 emit `run.merged_input_appended` → long-poll 推送）；用户看到"我的追问被收到了"是即时的。LLM 真正"消化"追问需要等：(1) 当前 step 完成 (≤30-90s)；(2) runExecute 下一 iter 顶部检测 → 切 replanning + 让出；(3) worker 下次 tick (≤2s)；(4) applyReplanningIfNeeded → 新 LLM plan call。最坏总延迟约 30-120s，远小于 24h timeout。后缀 + replan 路径完整在 §9.3。如果未来要做到 LLM call 中途也能感知，需要 ADR-M7-3 升级到 "interrupt + restart" 方案，本期不做。

**Q: 为什么 P1 用"标 replanning + return 让出 + worker re-pickup"这么绕，不直接在循环里调 replan？**
A: 完全对齐现有 `applyReplanningIfNeeded` 路径，避免重复 LLM/budget/cancel/heartbeat 装配。`replanning` 状态机已有完整支持（worker pickup 列表包含 'replanning'，reclaim 不误伤，cost accounting 兼容）；硬拆 in-loop replan 等于复制一遍这套基础设施。代价是多 1 个 worker tick (≤2s)，可接受。

**Q: P1 和 P2/P3/P4 重复吗？只做 P1 不行吗？**
A: 不行。P1 只触发"plan 还有剩余步"的场景；当 merge 发生时 plan 已经跑完进入 `generateFinalReply` / `runCritique`，P1 的 checkMergedInputs 已经不会再被调用。P2 (final reply) + P3 (critique) + P4 (history) 是兜底，覆盖"晚到的追问"。四个一起做才闭环。

**Q: contextAdapter 改了之后，私聊路径会受影响吗？**
A: 不会。§9.5 的改动只在 `params.channel === 'group'` 分支末尾追加。私聊走 `prepareChatContext` 完全独立，不读 agent_steps。M7 P4 不影响 G5（私聊路径完整跑通）。

**Q: P1 为什么不把 merge 拼到 `inputText` 持久化，省得 planner 每次都拼？**
A: 因为多次追问会**累积污染**：第一次 P1 把"# 后续追问"段拼进 `inputText` 并写库；第二次又有新追问 → P1 再次基于"已经被污染的 inputText"拼一遍 → 出现两个"# 后续追问"header 或重复条目。`merged_inputs` JSONB 是真源，`inputText` 永远保持创建时原值；planner prompt 每次按"当前 merged_inputs 全量"重新拼，幂等且无副作用。代价是 planner LLM call 多吃几百 token（追问段重复发），但比脏库的修复成本低得多。

**Q: 同 topic 两个用户几乎同时 @AI（间距 < 50ms），acquireTopicSlot 会不会并发产生 2 个 fresh？**
A: 不会，但前提是**判定与写入必须在同一事务内持锁完成**（ADR-M7-14）。实现入口形如：

```typescript
async function withTopicCoordination<T>(
  topicId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext('agent_topic_coord:'||$1), hashtext('m7'))`,
      [topicId],
    );
    const result = await fn(client);  // 内部完成 findBlocking + create/merge/queue
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
```

`intentExecute` 的群聊 `agent_run` 分支整段套在 `withTopicCoordination(topicId, async (client) => { ... })` 里；`findBlockingActiveOnTopic` / `insertAgentRun` / `applyMergeInTx` 这三个 store 函数都额外接一个可选 `client?: PoolClient` 形参，传入时复用同一事务，不传时走 `getPool().query` 旧路径（保留向后兼容）。  
若拆成"先 acquireTopicSlot commit 完，再 createAgentRun"，两个并发请求都能在锁外看到"无 active"，然后各插一条 fresh run；分离即破。TB1 / TB16 用 `Promise.all([acquire1, acquire2])` 验证。

**Q: applyReplanningIfNeeded 里的 critique 分支 reason 写成什么？P1 触发的也走那里吗？**
A: P1 触发时**自己 record 一条 `replan` step**，`output.reason = 'merge_trigger'`，明示 trigger 来源。applyReplanningIfNeeded 后续走 critique 分支时会先检查最近一条 replan step 的 reason：若已经是 `merge_trigger` → 跳过自己的 `recordStep`（避免重复），但仍执行 `plan=null / todos=[]` 让 executeRun 重 plan。这样日志/排查链路上能清楚区分"用户 steer critique"与"群聊追问触发 replan"。

---

（本 spec 待用户复核 → 进入 writing-plans 阶段生成实现计划）
