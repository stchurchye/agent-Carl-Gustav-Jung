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
- ❌ 不引入 advisory_lock / Redis / 队列中间件

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
| **ADR-M7-3** | 追问注入方式 | step `user_message_appended` | 完全对齐 ReAct 模型；不改 schema；contextAdapter 自然 include；唯一代价是当前 LLM call (≤30s) 期间看不见，下一 iteration 生效 |
| **ADR-M7-4** | 合并后 UI | 原 AgentRunCard 加后缀"·已合并 N 个追问"，不发新系统消息 | 减少群消息流污染；invoker 自己的人类消息已在群里，足够 |
| **ADR-M7-5** | ask_user 群聊"谁回答" | owner 30s 独占 → 任意群成员（worker checker 升级） | owner 在场即不被打断；30s 是用户能容忍的 owner 响应窗口；超时让"路过的人"能救场 |
| **ADR-M7-6** | deep_research 子 run 群聊呈现 | 子 run channel=group，独立创建群消息（复用 writeGroupPlaceholder） | 复用度最高；group_messages 天然支持多卡共存；零新组件 |
| **ADR-M7-7** | 子 run 不被合并 | acquireTopicSlot 检测 `parentRunId` → 强制 create_fresh | 避免子 run 合并到父 run 自己（死锁） |
| **ADR-M7-8** | queued 状态可见性 | 卡片显式 "排队中·前 N 个" + lastIdx 长轮询触发出队后立即 UI 更新 | 减少"卡住了？"的疑问 |

---

## 5. 数据模型（migration 020）

```sql
-- 020_agent_topic_coord.sql

-- 自动合并 + 排队
ALTER TABLE agent_runs
  ADD COLUMN merged_into_run_id TEXT REFERENCES agent_runs(id),
  ADD COLUMN merged_inputs JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN queue_position INT;
  -- merged_into_run_id：合并源 → 目标；目标本身保持 NULL（罕用，仅为可追溯）
  -- merged_inputs：[{ text, byUserId, byUsername, at }]
  -- queue_position：queued 时记位次（仅 UI 展示用，非源数据）

-- ask_user 群聊"谁回答"
ALTER TABLE agent_runs
  ADD COLUMN ask_user_target_user_id TEXT,
  ADD COLUMN ask_user_started_at TIMESTAMPTZ,
  ADD COLUMN ask_user_opened_for_all_at TIMESTAMPTZ;
  -- target_user_id：当前 ask_user 期待谁答（默认 = owner_id；保留字段为未来 planner 显式 @某人留口）
  -- started_at：本次 ask_user 进入 awaiting 的时刻（用于判断"是否已过 30s 独占期"，不能用 last_heartbeat_at —— 它被 worker 持续刷新）
  -- opened_for_all_at：worker checker 升级后 set，UI 据此切显示+权限

-- 高效 findActiveRunOnTopic / countActiveOrQueuedOnTopic
CREATE INDEX IF NOT EXISTS idx_agent_runs_topic_active
  ON agent_runs(topic_id, created_at DESC)
  WHERE status IN ('draft','planning','running','replanning',
                   'awaiting_approval','awaiting_user_input','queued');
```

**`AgentRunStatus` 新增 `'queued'`**（types.ts L9-21）。

**新 step kind**：`'user_message_appended'`，input = `{ text: string, byUserId: string, byUsername: string, mergedAt: string }`。

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

### 6.2 新行为

```typescript
// askUser.ts handler 群聊分支
if (ctx.channel === 'group') {
  await store.updateAgentRun(runId, {
    status: 'awaiting_user_input',
    pendingUserPrompt: input.question,
    pendingUserStepIdx: ctx.stepIdx,
    askUserTargetUserId: ctx.ownerId,
    askUserStartedAt: new Date().toISOString(),
    askUserOpenedForAllAt: null,
    pendingUserInputExpiresAt: addMs(now, 24*3600*1000),
  });

  const bridgeMsgId = await writeAskUserPrompt({
    runId,
    groupId: ctx.groupId,
    topicId: ctx.topicId,
    target: ctx.ownerId,
    question: input.question,
  });

  return { ok: true, paused: true, messageId: bridgeMsgId };
}
```

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

// 命中 → UPDATE ask_user_opened_for_all_at = NOW()
// → agentHookBus.emit({ type: 'ask_user.opened_for_all', runId })
// → writeAskUserNotice(runId, '30 秒已过，任意群成员可回答')
```

⚠️ **关键**：必须用 `ask_user_started_at` 而不是 `last_heartbeat_at` —— 后者被 worker 持续刷新（M1d 设计），无法表达 status 转换时刻。

### 6.5 Mobile

新组件 `AskUserPromptCard.tsx`：

- props: `{ runId, target, question, openedForAll, expiresAt }`
- 渲染：问题文本 + "请 @{target.username} 回答" 标签 + 30s 倒计时
- 输入框：仅 `currentUserId === target || openedForAll` 时显示
- 倒计时归零或 `openedForAll=true` → 标签变 "任意群成员可回答"
- 提交 → `POST /api/agent/runs/{runId}/resume { input: text }`

`GroupChatScreen.tsx` message render 加 `payload.askUser` 分支 → `AskUserPromptCard`。

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

### 7.2 新行为

```typescript
const isParentGroup = parentRun.channel === 'group';
const childResult = await createAgentRun({
  ownerId: parentRun.ownerId,
  channel: isParentGroup ? 'group' : 'private',
  groupId: isParentGroup ? parentRun.groupId : undefined,
  topicId: isParentGroup ? parentRun.topicId : undefined,
  parentRunId: parentRun.id,
  inputText: input.question,
  // ... 其他保留
});
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

async function acquireTopicSlot(input: {
  channel: AgentChannel;
  topicId: string | null;
  ownerId: string;
  parentRunId?: string | null;
}): Promise<SlotDecision> {
  // 子 run 强制 fresh（防自合并）
  if (input.parentRunId) return { action: 'create_fresh' };

  // 私聊不参与协调
  if (input.channel !== 'group' || !input.topicId) {
    return { action: 'create_fresh' };
  }

  const active = await findActiveRunOnTopic(input.topicId);
  if (!active) return { action: 'create_fresh' };

  // 同 owner → 任意时间合并
  if (active.ownerId === input.ownerId) {
    return { action: 'merge', targetRunId: active.id };
  }

  // 跨 owner + 30s 窗口 → 合并
  const ageMs = Date.now() - new Date(active.createdAt).getTime();
  if (ageMs < 30_000) {
    return { action: 'merge', targetRunId: active.id, mergedByUserId: input.ownerId };
  }

  // 跨 owner + 窗口外 → queue
  const precedingCount = await countActiveOrQueuedOnTopic(input.topicId);
  return { action: 'queue', precedingCount };
}
```

### 8.2 merge 分支处理（在 intentExecute 内）

```typescript
case 'merge': {
  await recordStep(decision.targetRunId, {
    kind: 'user_message_appended',
    input: {
      text: input.text,
      byUserId: input.userId,
      byUsername: await lookupUsername(input.userId),
      mergedAt: new Date().toISOString(),
    },
  });

  await store.appendMergedInput(decision.targetRunId, { ... });

  // 仅写 1 条 invoker 群消息（人类发言），指向原 run
  const invokerMsgId = await writeGroupMessage({
    groupId, topicId, userId: input.userId,
    text: input.text,
    payload: { agentRun: { agentRunId: decision.targetRunId, isMergedInvoker: true } },
  });

  return {
    type: 'agent_merged',
    runId: decision.targetRunId,
    mergedInto: decision.targetRunId,
    invokerMessageId: invokerMsgId,
  };
}
```

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
  const active = await findActiveRunOnTopic(topicId);
  if (active && active.status !== 'queued') return;  // 还有 non-queued active

  const next = await store.findQueuedHeadOnTopic(topicId);
  if (!next) return;

  await store.updateAgentRun(next.id, {
    status: 'draft',
    queuePosition: null,
  });
  agentHookBus.emit({ type: 'run.dequeued', runId: next.id });
  // 下个 worker tick 自然 pickup
}
```

worker `pickupNextRun` 加 `status NOT IN ('queued')` 过滤（已隐含在原 `idx_agent_runs_pickup` 的 WHERE，需要确认；如未隐含则显式加）。

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

## 9. T4：自动合并（追问注入）

这一项的判定和落库逻辑已在 §8.1-§8.2 完成；本节补充 ReAct 集成的细节。

### 9.1 user_message_appended step 在 contextAdapter 的呈现

`contextAdapter.snapshotForAgent` 已经 include 全部 agent_steps；`user_message_appended` 自然出现在 step 序列中。LLM 看到的 plan/observation 序列形如：

```
[plan] goal: 帮我们分析这个论文
[tool_call] fetch_url(url=...)
[tool_result] ok: true, content: ...
[user_message_appended] "@user1: 顺便也看看作者背景" (by user2, at 12:34)
[tool_call] ...
```

→ planner LLM 在下一 iteration 自然把追问纳入推理。

### 9.2 追问对当前 LLM call 的影响

**不影响**当前 LLM call（可能正在跑 30s）；追问写入 DB 后**等下一 iteration 才生效**。这是 ADR-M7-3 的明确权衡：换来"无中断、无 token 浪费、零 schema 改动"。

### 9.3 合并 race condition

多个并发 `intent/execute` 同时命中"merge to same active run"是可能的（两个用户同时提交）。处理：

```typescript
// intentExecute 内对 'merge' 决策包 retry-once 包装
async function executeAgentRunWithRetry(input): Promise<AgentExecResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const decision = await acquireTopicSlot(input);
    try {
      if (decision.action === 'merge') {
        return await applyMergeInTx(decision.targetRunId, input);
      }
      if (decision.action === 'queue') {
        return await applyQueueInTx(decision.precedingCount, input);
      }
      return await applyCreateFreshInTx(input);
    } catch (err) {
      if (err instanceof MergeTargetTerminalError && attempt === 0) {
        continue;  // 目标 run 在 merge 事务期间转 terminal，重判
      }
      throw err;
    }
  }
  throw new Error('agent run slot acquisition failed after retry');
}

// applyMergeInTx 内的核心事务
BEGIN;
INSERT INTO agent_steps (...) VALUES (...);
const updateRes = await client.query(
  `UPDATE agent_runs
     SET merged_inputs = merged_inputs || $1::jsonb
     WHERE id = $2 AND status NOT IN ('completed','failed','cancelled','budget_exhausted')`,
  [...],
);
if (updateRes.rowCount === 0) throw new MergeTargetTerminalError();
COMMIT;
```

retry 只发生 1 次（重判通常变成 `create_fresh` 或 `queue`）；超过 1 次仍失败说明 DB 异常，抛错由上层处理。

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
| **T1** | migration 020 + types/store 扩展 + `AgentRunStatus='queued'` + 新 step kind | 0.5 d | T0 |
| **T2** | acquireTopicSlot 算法 + 单测 | 1.0 d | T1 |
| **T3** | intentExecute 三分支处理（create_fresh/merge/queue） + recordStep 注入 + writeGroupMessage(invoker-only) | 1.0 d | T2 |
| **T4** | dequeueNextOnTopic + worker pickup 排除 queued + softComplete/cancelRun/reclaim 三出口集成 | 0.8 d | T3 |
| **T5** | ask_user 群聊：handler 分支 + writeAskUserPrompt + canAnswerAskUser + autoOpenAskUserForAll worker checker | 1.5 d | T1 |
| **T6** | deep_research 群聊：channel 传递 + parentRunId 防自合并 | 0.5 d | T2 |
| **T7** | mobile AgentRunCard：queued / merged 后缀 / deep_research 跳转 | 0.5 d | T3, T6 |
| **T8** | mobile AskUserPromptCard（新组件） + GroupChatScreen 集成 | 1.0 d | T5 |
| **T9** | 测试矩阵 backend (TB1-TB12) + mobile tsc 验证 + code-reviewer subagent 跑 diff | 1.0 d | T2-T8 |
| **T10** | Merge main + tag v0.m7 | 0.2 d | T9 |

**合计 8.2 天**，对齐 2-2.5 周日历时间（含 review/修复/buffer）。

**并行性**：T5 / T6 / T7 / T8 可在 T4 后并行（不同文件）。

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
| TB11 | deep_research group child | integration | 父 group → 子 channel=group + 群消息 + 不合并 |
| TB12 | jsonbOrNull regression | unit | merged_inputs null-clear 走 helper（jsonbOrNull 已存在） |

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
| **R8** | 历史群聊老 run 的 schema 兼容 | 新字段全部 `DEFAULT NULL / '[]'::jsonb`；老 run 读出来正常 |

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
2. ✅ TB1-TB12 全部 PASS
3. ✅ Mobile §12.2 手测清单 5 项全部验证
4. ✅ Mobile `npx tsc --noEmit` exit 0
5. ✅ Backend `vitest run` 全绿（基线 ~470 + 新增 ~12 ≈ 482）
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
A: UI hint。队列实际位次靠"创建时间 + status='queued'"动态计算（`countActiveOrQueuedOnTopic`），`queue_position` 仅记录创建时的位置便于初始渲染。当其他 queued run 被取消时，位置可能"自然前进"但 `queue_position` 不更新（避免 N 个 queued run 同时刷新的写放大）；UI 每次 long-poll 都重算实时位次。

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
A: AgentRunCard 的"·已合并 N 个追问"后缀**立即更新**（合并事务 commit 后通过 agentHookBus → long-poll 推送）；用户看到"我的追问被收到了"是即时的。LLM 真正"消化"追问需要等当前 LLM call 完成（≤30s），是合理的延迟。如果未来要做到 LLM call 中途也能感知，需要 ADR-M7-3 升级到 "interrupt + restart" 方案，本期不做。

---

（本 spec 待用户复核 → 进入 writing-plans 阶段生成实现计划）
