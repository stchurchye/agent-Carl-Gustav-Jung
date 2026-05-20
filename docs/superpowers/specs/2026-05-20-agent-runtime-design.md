# Agent Runtime 设计文档（子项目 A）

- 项目代号：`agent-runtime`
- 日期：2026-05-20（v2，基于现有项目代码事实重写）
- 状态：设计已定稿，待用户复核 → writing-plans
- 关联：本项目是「行动中止派」全局规划的子项目 A，详见末尾 §20。

---

## 1. 背景与目标

### 1.1 问题陈述

当前「行动中止派」（Expo + Hono monorepo）已经具备较完整的对话基础：

- **私聊**（`chat.ts` + `private_chat_*` 表）+ **群聊**（`groupChat.ts` + `group_messages` + `llm_invoke_jobs`）
- **意图体系**：`packages/shared/social.ts` 的 `IntentKind` enum + `intentRules.ts`（regex 候选）+ `intentClassify.ts`（LLM 兜底）+ `intentAnalyzer.ts`（统一编排）+ `intentExecute.ts`（按 kind 派发）+ `routes/intent.ts`（HTTP）+ mobile `intentFlow.ts` + `IntentChipBar.tsx`
- **Context Pipeline**：私聊有完整的 `prepareChatContext` → `PreparedChatContext`（含 LLM compact + memory salvage）；群聊用 `groupLlm.ts` 的 `buildGroupLlmSystem` + `resolveGroupHistoryMessages` 直接拼 historyText
- **记忆系统**：`memory*.ts`（抽取/检索/压缩/合并/auto-extract/review queue）+ 11 张 memory 表
- **MAGI 集成雏形**：`integrations/magi.ts`（`queryMagiSystem` / `ingestMagiContent`）
- **Provider**：DeepSeek / Dashscope / Zenmux

但当前对话**仍是单步同步的**：一次 `/intent/execute` 完成一次 `executeIntent`，没有：

1. 任务拆解（plan）与 ReAct 循环
2. 工具调用循环（tool use）
3. 后台 / 异步持续（用户断线即结束）
4. 多步任务的可观测进度
5. 预算 / 超时控制
6. 进程重启后的可恢复性
7. 用户中途调整方向的能力（steer）

### 1.2 目标

把「对话执行单个 intent」升级为「**agent run** 执行多步任务」，对齐 2026 主流（Claude Code / Codex / Cursor 2.0）：

1. **ReAct 循环**：`plan → call_tool → observe → (loop) → reply`
2. **后台执行**：用户断线不中断，进程重启可续跑
3. **预算可控**：步数 / 时长 / token 三维度硬上限
4. **可中断 / 可改向**：群成员都能停（cancel）+ 中途改方向（steer）
5. **可观测**：每一步 input/output/tokens/duration 落库，前端流式渲染
6. **TodoList 进度**：Claude Code 风格可勾选清单
7. **工具协议**：Anthropic 风格 + MCP client adapter
8. **Skills / Topic Memory**：每个 topic 可挂"群规"，agent 自动遵守
9. **Approval 模式**：工具调用前的细粒度授权 + 独立 `awaiting_approval` 状态
10. **Self-reflection**：长任务自审 + 失败时自动 re-plan
11. **Hooks**：lifecycle 事件总线
12. **幂等性**：副作用工具（导出、写入 magi、写记忆）crash-safe，可重放不重复

### 1.3 非目标（明确不做）

- ❌ 不做 coding 能力（文件编辑、shell、代码沙箱）
- ❌ 不做多 agent 协作（仅预留 `role` 字段）
- ❌ 不做 git worktree / branching
- ❌ 不做定时调度（E 子项目）
- ❌ 不重写记忆系统（C 子项目）
- ❌ 不做群聊 agent 并发协调（B 子项目；本项目阶段允许同 topic 并发 run）
- ❌ 不做完整 Eval / Replay 框架
- ❌ MCP server 端不实现（只做 client）
- ❌ 不复用 `orchestration_runs` 表（现有表 payload 太松散，新建 `agent_runs` 更清晰；通过 `intent_turn_id` 关联追溯）

---

## 2. 与现有代码 / 数据模型的关系（重要：M1a 完成前先验证一次）

### 2.1 不动的部分

- `chat.ts` / `groupChat.ts` 「直接和 LLM 聊」路径**保留**为 fallback；不删
- `memory*.ts`、`memory_*` 表完全不动
- `contextPipeline.ts` 的 `prepareChatContext` **复用**（见 §7 Context Adapter）
- `groupLlm.ts` 的 `buildGroupLlmSystem` / `resolveGroupHistoryMessages` **复用**
- `integrations/magi.ts` 不动；M1c 阶段将其薄包装为 ToolDef
- 现有 DeepSeek / Dashscope / Zenmux provider 复用

### 2.2 要扩展的部分

| 文件 / 模块 | 改动 | 阶段 |
|------------|------|------|
| `packages/shared/src/social.ts` | `IntentKind` 新增 `'agent_run'` | M1a |
| `packages/shared/src/intent/executable.ts` | `EXECUTABLE_INTENT_KINDS` 加 `'agent_run'` | M1a |
| `apps/api/src/lib/intentRules.ts` | 新增 `'agent_run'` 候选规则（详见 §10 触发优先级） | M1a |
| `apps/api/src/lib/intentAnalyzer.ts` | `finalizeSpecialIntent` 让出位置，确保 agent_run 不误伤现有 intent（详见 §10） | M1a |
| `apps/api/src/lib/intentExecute.ts` | 新增 `if (kind === 'agent_run')` 分支 → 调 `createAgentRun(...)` 并返回 `{ type: 'agent', runId, ... }` | M1a |
| `packages/shared/src/social.ts` | `IntentExecuteResult` 新增 `{ type: 'agent', runId, agentMessageId? }` | M1a |
| `apps/mobile/src/lib/intentFlow.ts` | `executeMessageIntent` 已返回 result，前端识别 `type === 'agent'` 后跳转到 agent stream | M1b |
| `apps/mobile/src/components/IntentChipBar.tsx` | 新增"用 agent 跑"芯片（kind=agent_run） | M1b |

### 2.3 新建的部分

| 模块 | 内容 |
|------|------|
| `apps/api/src/db/migrations/012_agent_runtime.sql` | 新表（见 §5） |
| `apps/api/src/lib/agent/` | runtime 全部代码（见 §11） |
| `apps/api/src/routes/agent.ts` | HTTP/SSE 路由 |
| `apps/mobile/src/features/agent/` | 前端 agent 视图 |

---

## 3. 锁定的设计决策

| # | 决策 | 选定方案 | 理由 |
|---|------|---------|------|
| D1 | 运行时形态 | 单进程 worker + PG 队列（`SELECT FOR UPDATE SKIP LOCKED`） | 个位数并发，0 新组件 |
| D2 | Plan 形态 | LLM 生 JSON plan + 简单循环 | 主流共识，避免框架绑死 |
| D3 | 工具协议 | Anthropic 风格 + MCP client adapter | 本地调用为主，MCP 接生态 |
| D4 | 后台保活 | api 容器内嵌 worker 协程 | 一个容器一份日志 |
| D5 | 多 agent | 单 agent + 预留 `role` 字段 | YAGNI |
| D6 | Plan 模式 | 混合：单步自动跑、多步 10s 倒计时确认、随时能停 | 兼顾体验 |
| D7 | UI 形态 | 聊天内嵌（一条 agent message 渲染卡片）+ 轻量任务面板 | 同一 `agent_run` 两种视图 |
| D8 | 触发入口 | 群聊 `@agent` / 私聊 intent 升级 / 后期任务面板新建 | 复用现有 intent 体系 |
| D9 | 取消权限 | 群成员都能停（记 `cancelled_by_user_id`） | 朋友间用 |
| D10 | 预算默认 | 20 步 / 10 分钟 / 100K tokens | 用户偏宽松 |
| D11 | 工具失败 | 调用 1 次 + 重试 1 次都失败 → 把错误塞回 plan 让 LLM 重新规划 | ReAct 韧性 |
| D12 | Token 归属 | 优先发起人 ZenMux key，fallback 服务端兜底 key，前端透明显示 | 朋友间合理 |
| D13 | ID / 主键风格 | **TEXT PRIMARY KEY + `randomUUID()`**（Node 端生成），不用 `gen_random_uuid()` / UUID 类型 | 严格对齐现有 11 个 migration 的风格 |
| D14 | 迁移文件 | `012_agent_runtime.sql`，append-only，纳入 `migrate.ts` 的字母序遍历；**永不修改已 applied 的迁移**，bugfix 用后续编号补 | 对齐 `migrate.ts` 现有契约 |
| D15 | 与 `llm_invoke_jobs` / `orchestration_runs` 的关系 | **不复用**，新建 `agent_runs`；通过 `intent_turn_id` 关联 `intent_turns`，群聊 `agent_run` 完成时**额外**写 `llm_invoke_jobs`（一次性 done 状态）以保留群聊既有 UI 兼容 | 既有表语义不同，硬塞会污染 |

---

## 4. 核心概念（应用层类型）

### 4.1 AgentRun

```typescript
type AgentRunStatus =
  | 'draft'              // 刚创建,plan 还没生成
  | 'planning'           // 正在生成 plan
  | 'awaiting_confirm'   // 多步任务等用户确认(10s 倒计时,见 §6)
  | 'awaiting_approval'  // 当前 step 工具 approvalMode='ask',等用户/超时(见 §6 + §9)
  | 'running'            // worker 正在跑 step
  | 'replanning'         // 重新规划中(steer / 工具失败 / critique 触发)
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'budget_exhausted';

type AgentRun = {
  id: string;                         // TEXT, randomUUID()
  ownerId: string;                    // 发起人 user_id
  channel: 'private' | 'group';
  sessionId: string | null;           // private 时
  groupId: string | null;             // group 时
  topicId: string | null;             // group 时
  intentTurnId: string | null;        // 关联 intent_turns(id)
  role: AgentRole;                    // 当前固定 'generalist'
  status: AgentRunStatus;
  inputText: string;
  plan: Plan | null;
  todos: TodoItem[];
  budget: {
    maxSteps: number;                 // default 20
    maxSeconds: number;               // default 600
    maxTokens: number;                // default 100_000
  };
  usage: {
    steps: number;
    elapsedSeconds: number;
    tokens: number;
    costCny: number;
  };
  apiKeyOwnerId: string | null;       // 实际付费 user_id (null 表示服务端 key)
  apiKeySource: 'user' | 'server';
  resultMessageId: string | null;     // 见 §8 Message Bridge
  invokeMessageId: string | null;     // 群聊场景对齐 llm_invoke_jobs
  lastHeartbeatAt: Date | null;
  awaitingApprovalUntil: Date | null; // approval 超时时间点(见 §6)
  awaitingApprovalStepIdx: number | null;
  pendingApprovalToolName: string | null;
  createdAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  cancelledByUserId: string | null;
  cancelReason: 'user' | 'steer' | 'budget' | 'crash_reclaim' | null;
};

type AgentRole = 'generalist';        // 未来:'researcher' | 'writer' | ...
```

### 4.2 AgentStep（append-only）

```typescript
type StepKind =
  | 'plan'           // LLM 生成 plan(初次)
  | 'replan'         // LLM 重新规划
  | 'critique'       // self-reflection
  | 'tool_call'      // 调用工具(成功 or 含 retry 的最终结果)
  | 'tool_error'     // 调用工具最终失败(retry 也失败)
  | 'observe'        // 工具结果摘要(用于 LLM 下一轮思考)
  | 'reply'          // 最终回复生成
  | 'approval_request'  // 进入 awaiting_approval
  | 'approval_grant'    // 批准
  | 'approval_deny'     // 拒绝
  | 'approval_timeout'  // 超时
  | 'cancel'         // 用户取消
  | 'steer'          // 用户中途改方向
  | 'heartbeat'      // 进程接管事件(crash recovery 时插入,可选)
  | 'system_error';  // 非工具的系统异常

type AgentStep = {
  id: string;                         // TEXT, randomUUID()
  runId: string;
  idx: number;                        // 同 run 内单调递增
  kind: StepKind;
  toolName: string | null;
  toolCallKey: string | null;         // 幂等键(见 §13)
  input: unknown | null;              // JSONB
  output: unknown | null;             // JSONB
  tokens: number;                     // default 0
  durationMs: number;                 // default 0
  error: string | null;
  byUserId: string | null;            // cancel / steer / approval 操作者
  createdAt: Date;
};
```

### 4.3 AgentTodo（Claude Code 风格）

```typescript
type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'skipped' | 'failed';

type TodoItem = {
  id: string;                         // 简短 id,如 't1'
  text: string;                       // "搜索家族信托资料"
  status: TodoStatus;
  stepRefs: string[];                 // 关联的 AgentStep.id
};
```

**存储**：序列化进 `agent_runs.todos` JSONB（数量 ≤20，无需独立表）。

### 4.4 TopicSkill

```typescript
type TopicSkill = {
  id: string;                         // TEXT, randomUUID()
  scope: 'topic' | 'user' | 'group';
  ownerId: string | null;             // user scope 时
  groupId: string | null;
  topicId: string | null;
  title: string;
  content: string;                    // markdown
  enabled: boolean;
  updatedAt: Date;
  updatedByUserId: string;
};
```

### 4.5 Plan

```typescript
type Plan = {
  intentSummary: string;
  steps: PlanStep[];                  // 可为空数组(纯回复,无工具)
  todos: TodoItem[];                  // 与 steps 不必一一对应
  finalReplyHint: string;             // 最终回复的格式/风格指引
  reasoning: string | null;
  version: number;                    // re-plan 时递增
};

type PlanStep = {
  toolName: string;
  input: Record<string, unknown>;
  reason: string;
  todoId: string | null;
};
```

---

## 5. 数据库迁移（`012_agent_runtime.sql`）

### 5.1 迁移契约

- 文件名：**`apps/api/src/db/migrations/012_agent_runtime.sql`**（沿 011 之后）
- `migrate.ts` 按字母序遍历，已 applied 的不会重跑（`schema_migrations` 表）
- **append-only**：一旦合并到 main 并跑过生产，此文件**永不修改**。后续 bugfix / 加字段都用 `013_xxx.sql`、`014_xxx.sql`
- ID 类型：全部 `TEXT PRIMARY KEY`，由 Node `randomUUID()` 生成（对齐现有所有表）
- 用 `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`（对齐现有风格）
- 外键：`ON DELETE CASCADE`（user / group / topic / session）

### 5.2 SQL

```sql
-- 012_agent_runtime.sql
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

-- 幂等单调:一个工具调用键唯一(同 run 不会跑两次)
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

---

## 6. 状态机（含 `awaiting_approval`）

```
draft
  └─→ planning
        ├─(单步任务 + 高置信度)→ running
        └─(多步任务)→ awaiting_confirm
                       ├─(10s 超时 或 用户 confirm)→ running
                       └─(用户 cancel)→ cancelled
running
  ├─(下一 step 工具 approvalMode='ask')→ awaiting_approval
  ├─(steer)→ replanning → running
  ├─(工具调用 + 重试都失败)→ replanning → running
  ├─(critique 判定 shouldReplan)→ replanning → running
  ├─(完成全部 step)→ completed
  ├─(预算耗尽)→ budget_exhausted (软完成,把已有结果回复)
  ├─(用户 cancel)→ cancelled
  ├─(LLM 解析失败 / 系统异常)→ failed
  └─(30s 无心跳)→ 被另一 worker 接管(详见 §15)

awaiting_approval
  ├─(用户 grant)→ running (跑当前 step)
  ├─(用户 deny)→ replanning (把"用户拒绝执行 {tool}"塞回 plan)
  ├─(60s 超时,工具 costHint='low')→ running (按默认 grant 处理)
  ├─(60s 超时,其他)→ replanning (等同 deny)
  ├─(用户 cancel)→ cancelled
  └─(crash + 30s 无心跳)→ 重启后保持 awaiting_approval(awaiting_approval_until 仍有效);
                          若 awaiting_approval_until 已过期,worker 接管时按超时策略处理
```

### 6.1 关键不变量

- 终态（completed / failed / cancelled / budget_exhausted）一旦进入**不可逆**
- `awaiting_confirm` / `awaiting_approval` **不算"running"**，因此不算预算 `elapsedSeconds`（避免用户慢点击就被预算超时）；只有 `running` / `replanning` 算时长
- `awaiting_approval_until` 是绝对时间戳（不是相对），crash recovery 时 worker 直接比较 `now() vs awaiting_approval_until`，无需追溯
- 终态时必写 `result_message_id`（或 null + 在聊天里发一条"任务结束"占位 message，见 §8）
- `last_heartbeat_at` 在 `running` / `planning` / `replanning` 状态下由 worker 每 10s 写一次；`awaiting_*` 状态**不写**心跳（避免被错误接管）

---

## 7. Context Adapter（取代旧 spec 的 `ContextSnapshot` 占位）

### 7.1 问题

私聊和群聊的 context pipeline 实现差异巨大：

- 私聊：`prepareChatContext({ userId, apiKey, sessionId, pendingUser, dialect?, contextSelection? }) → PreparedChatContext { messages, usage, session }`，**带 LLM compact + memory salvage**
- 群聊：没有统一 `prepareGroupContext`，`groupLlm.ts` 手工拼 `buildGroupLlmSystem` + `resolveGroupHistoryMessages` + historyText 字符串

planner 不能直接吃这两种异构输出，需要一个 adapter 抽象。

### 7.2 设计

```typescript
// apps/api/src/lib/agent/contextAdapter.ts

export type AgentContextSnapshot = {
  /** 已渲染好的 system prompt(含 persona / memory / topic skills) */
  systemPrompt: string;

  /** 经过 compact / 截取的历史消息(LLM 视角) */
  history: ChatMessageInput[];

  /** 给 planner 的简短摘要(≤500 字),用于 plan 阶段提示 */
  shortSummary: string;

  /** 上下文统计(token 数 / 是否压缩过等),只读 */
  usage: ContextUsage;

  /** 来源标识,planner / replyGen 决定怎么用 */
  source: {
    channel: 'private' | 'group';
    sessionId?: string;
    groupId?: string;
    topicId?: string;
  };
};

export async function snapshotForAgent(params: {
  runId: string;
  userId: string;
  channel: 'private' | 'group';
  sessionId?: string;
  groupId?: string;
  topicId?: string;
  pendingUser: string;          // 即 inputText
  apiKey: string;               // 用于 compact
  topicSkills: TopicSkill[];    // 注入 system prompt
  dialect?: ReplyDialect;
}): Promise<AgentContextSnapshot>;
```

### 7.3 实现策略

**私聊路径**：
1. 调 `prepareChatContext({ userId, apiKey, sessionId, pendingUser, dialect })` → 得到 `{ messages, usage, session }`
2. `systemPrompt` = 取 `messages[0]` 中 system，再追加 `formatTopicSkillsAsSystemBlock(topicSkills)`
3. `history` = 去掉 system 之外的消息
4. `shortSummary` = 拼 `session.contextSummary` + 最后 6 条 history 摘要（如有）
5. `usage` 直接取 `prepareChatContext` 的 `usage`

**群聊路径**：
1. 调 `buildGroupLlmSystem(userId, dialect, { groupId, topicId, query: pendingUser })` → systemPromptBase
2. 取 `social.listGroupMessages(...)` → 用 `resolveGroupHistoryMessages` 截到 ≤12 条
3. `systemPrompt` = systemPromptBase + topicSkills block
4. `history`：把每条 GroupMessage 转成 `ChatMessageInput`（kind=ai → assistant，kind=human → user，kind=system → system 拼接到 systemPrompt 末尾），并在每条前加 `[显示名]:` 前缀以保留多人语境
5. `shortSummary` = "群聊里 {N} 位成员讨论中"，并列出最近 6 条简略
6. `usage`：粗估（群聊本身没有 compact 流程；如果未来 C 子项目加了再扩展）

**topic skills 注入**：
```typescript
function formatTopicSkillsAsSystemBlock(skills: TopicSkill[]): string {
  const enabled = skills.filter((s) => s.enabled);
  if (enabled.length === 0) return '';
  const items = enabled.map((s) => `### ${s.title}\n${s.content}`).join('\n\n');
  return `\n\n<topic_skills source="user_provided">\n${items}\n</topic_skills>`;
}
```
注意：`<topic_skills>` 标签明确告诉 LLM 这是"用户提供的约定"，**不是**系统指令，减轻 prompt injection 风险（详见 §15）。

### 7.4 不在 M1a 范围

- 群聊的 LLM compact（C 子项目）
- private 多 session 跨会话上下文（C 子项目）

---

## 8. Message Bridge（agent_run ↔ chat message）

### 8.1 设计目标

- agent_run 完成后，前端能在**原聊天位置**看到一条"agent 回复"消息（含步骤折叠卡片）
- 群聊 agent 完成后，**额外**保留 invokeMessage（用户的指令记录）+ aiMessage（agent 的回复），与现有 `llm_invoke_jobs` 流程兼容（不破坏导出/历史导航）
- 任务面板（按 `agent_runs` 列）和聊天面板（按 message 列）**共享同一个 run**

### 8.2 私聊 message 流

```
用户发文本 → intentAnalyzer 判定 kind='agent_run'
            → intentExecute 调 createAgentRun
            → 立即写入 user message 到 private_chat_messages (role='user', content=inputText)
            → 立即写入 placeholder assistant message
                (role='assistant', content='[agent 任务进行中…]',
                 payload.agentRunId=<runId>, payload.agentStatus='draft')
            → return { type: 'agent', runId, userMessageId, placeholderMessageId }
            ─ 用户立刻看到聊天里的占位消息
worker 跑完 → markCompleted 时:
            → UPDATE private_chat_messages
              SET payload = jsonb_set(payload, '{content}', <final reply>)
                  ...
              WHERE id = placeholderMessageId
            → agent_runs.result_message_id = placeholderMessageId
worker 失败/取消 → 同样更新 placeholder 的 content 为"已取消/失败"+ 状态标
```

**关键**：`result_message_id` 在 run 创建时就**预分配**（写 placeholder 时拿到的 id），不是终态时新建。这样：
- 不会出现"竞态：agent message 还没生成时用户已经看不到任何反馈"
- crash recovery 时不会重复 insert message

### 8.3 群聊 message 流（兼容 `llm_invoke_jobs`）

```
用户在群发"@agent 帮我查 X" → intentAnalyzer 判定 kind='agent_run'
                            → intentExecute 调 createAgentRun(channel='group',...)
                            → social.addGroupMessage(kind='human', content=inputText,
                                llmInvoke={ agentRunId: <runId>, status: 'planning' },
                                jobId=<新建一个 llm_invoke_jobs.id, status='running'>)
                              → invokeMessage
                            → social.addGroupMessage(kind='ai', content='[agent 思考中…]',
                                invokerUserId=ownerId, invokerAssistantName='agent',
                                jobId=<同上>, payload.agentRunId=<runId>)
                              → placeholderAiMessage
                            → agent_runs.invoke_message_id = invokeMessage.id
                              agent_runs.result_message_id = placeholderAiMessage.id
worker 跑完 → 更新 placeholderAiMessage.content = <最终回复>
            → 更新 llm_invoke_jobs.status='done', resultMessageId=placeholderAiMessage.id
worker 失败 → 更新 llm_invoke_jobs.status='failed', placeholderAiMessage 标记失败
```

**为什么群聊还要走 `llm_invoke_jobs`**：
- 现有群聊 UI（消息卡片的 jobId 关联、`llm_invoke` 显示）已经依赖它
- 不写入会让 agent 消息在群聊里"看起来像未受控的 AI 回复"
- 写入是 cheap（一行 INSERT），不影响 agent_run 主路径

### 8.4 前端渲染规则

- 任意 message 含 `payload.agentRunId` → 渲染 `AgentRunCard` 组件（折叠/展开看步骤、todo、最终回复）
- `AgentRunCard` 通过 SSE `/agent/runs/:id/stream` 订阅实时步骤
- 任务面板（`/agent` tab）列出所有 `agent_runs`，点击跳回原聊天位置（私聊跳 session，群聊跳 group/topic 的 invokeMessage）

### 8.5 取消的 message 表现

- 私聊：placeholder message 内容变为"任务被 {displayName} 取消"，保留 agentRunId 供回看
- 群聊：placeholderAiMessage 内容同样更新；`llm_invoke_jobs.status='failed'` 或新增 `'cancelled'` 枚举（这一步需要轻量改 `llm_invoke_jobs.status` 枚举，但**无需新增 migration**，因为 status 是 free-form TEXT）

---

## 9. Planner（含 critique）

### 9.1 接口

```typescript
async function generatePlan(input: {
  runId: string;
  text: string;
  snapshot: AgentContextSnapshot;     // 见 §7
  availableTools: ToolDef[];          // 经过 role / topic_skill 过滤
  previousError?: string;
  previousPlan?: Plan;
  steerInstruction?: string;
  reason: 'initial' | 'retry_after_tool_fail' | 'critique' | 'steer' | 'approval_deny';
}): Promise<Plan>;
```

### 9.2 输出

见 §4.5 Plan 类型。**空 steps 是合法的**：planner 判断用户请求一句话能答时，返回 `steps: []`，worker 跳过工具循环直接调 `generateFinalReply(run, snapshot)` 出回复。

### 9.3 Prompt 骨架

```
你是「行动中止派」的 agent。任务是为下面的用户请求生成一个 JSON plan。

用户请求：{text}
当前上下文摘要：{snapshot.shortSummary}
{snapshot.systemPrompt 已经包含 topic 群规}

可用工具：
  {toolName}: {description}
    input schema: {schema}
    approvalMode: {approvalMode}
    costHint: {costHint}
  ...

{若 reason='retry_after_tool_fail': 上一次工具 {tool} 失败,错误:{previousError},请调整}
{若 reason='steer': 用户中途说:{steerInstruction},请重新规划剩余步骤}
{若 reason='approval_deny': 用户拒绝执行 {tool},请改用替代方案}

要求:
1. 输出**纯 JSON**,符合下面的 schema(略)
2. 最多 {budget.maxSteps - usage.steps} 步剩余
3. 每个 todo 用中文,普通用户能看懂
4. 若用户请求一句话能答,steps 留空数组,把回答写进 finalReplyHint
5. 优先选择 costHint='low' 的工具
```

### 9.4 Critique（self-reflection）

worker 主循环里，每完成 `N=5` 个 step **或** 任何工具连续失败 2 次时，插入 `critique` step：

```typescript
async function critique(input: {
  runId: string;
  plan: Plan;
  recentSteps: AgentStep[];
  snapshot: AgentContextSnapshot;
}): Promise<{
  shouldReplan: boolean;
  reason: string;
  adjustment?: Partial<Plan>;
}>;
```

---

## 10. Intent 触发优先级（避免互相误伤）

### 10.1 优先级表（高 → 低）

| Priority | Intent kind | 触发条件 | 与 `agent_run` 关系 |
|----------|------------|---------|-------------------|
| **1**（最高） | `app_navigate` / `persona_open_settings` | slash 命令 / 导航类 regex | 完全互斥；命中即返回，**不**生成 agent_run 候选 |
| **2** | `memory_correct` / `memory_forget` | "记错了"/"别再提" regex 命中 | 互斥；用户在修正记忆，agent 不该越权 |
| **3** | `memory_remember` | "记住/帮我记" regex 命中 | 互斥；显式记忆操作 |
| **4** | `context_compact` | slash `/压缩` 或 "压缩上下文" | 互斥；维护类操作 |
| **5** | `magi_system_query` | "问.\*知识库" / "magi" | **降级**：magi_system_query 单步够；若用户文本同时含"研究/对比/写"动词，**升级**为 `agent_run`（agent 内部仍可调 magi_system_read 工具） |
| **6** | `magi_content_link` | 单 URL + 无附件 | **降级**：单 URL + 无动词 = magi_content_link；URL + "研究/总结/对比/汇总成 X" 动词 = `agent_run` |
| **7** | `human_group_message` | aiMode=false 且 channel='group' | 互斥；用户明确说不调 AI |
| **8** | **`agent_run`**（新增） | 见 §10.2 启用条件 | — |
| **9** | `chat_private_llm` / `chat_group_llm` | 默认 | 兜底；当 agent_run 启用条件不满足时走普通聊天 |

### 10.2 `agent_run` 启用条件

满足以下**任一**即升级（在 `intentRules.ts` 新增规则）：

```typescript
// 在 intentRules.ts collectRuleMatches 末尾加(在所有 memory/magi 规则之后,
// 在普通 chat 兜底之前)

const AGENT_KEYWORDS_RE =
  /帮我研究|帮我查|帮我对比|帮我整理|帮我汇总|帮我做调研|做一份|写一份|整理成|生成报告|分析一下|找资料|查资料|@agent/i;

const COMPLEX_TASK_RE = /[\s\S]{120,}/;  // 文本超过 120 字

push(
  applyRule(
    'agent_run',
    AGENT_KEYWORDS_RE.test(t) ||
      (URL_RE.test(t) && /研究|总结|对比|汇总|分析|提炼/.test(t)) ||
      (COMPLEX_TASK_RE.test(t) && /[?？]/.test(t)),
    () => [
      {
        kind: 'agent_run',
        label: '让 agent 跑',
        description: '后台多步执行:搜资料 → 整理 → 输出',
        confidence: 0.85,  // 比 magi 链接(0.85)略高,但低于 memory(0.88+)
        group: 'primary',
      },
      // 同时补一个 fallback 普通聊天,让用户能选
      {
        kind: chatKind(ch),
        label: chatLabel(ch),
        description: '不开 agent,直接和 AI 聊',
        confidence: 0.6,
        group: 'other',
      },
    ],
    { forceChips: true },  // 这种升级一定让用户看到 chips,不自动执行
  ),
);
```

### 10.3 与现有 `pickAutoExecute` 的关系

`intentAnalyzer.ts` 的 `pickAutoExecute` 决定是否绕过 chips 自动执行。**`agent_run` 必须满足以下条件才允许 autoExecute**：
- 无任何 memory_* 候选（避免误抢记忆操作）
- 无任何 app_navigate 候选
- confidence ≥ 0.92（比普通 0.82 阈值高，因为 agent 启动成本高）
- 第二候选差距 ≥ 0.20

代码上：在 `pickAutoExecute` 加：
```typescript
if (top.kind === 'agent_run') {
  if (top.confidence < 0.92) return false;
  if (second && top.confidence - second.confidence < 0.20) return false;
}
```

### 10.4 mobile chip UI

- `IntentChipBar` 显示"让 agent 跑"芯片时，旁边显示 "≈ 30s ¥0.3" 估算（来自 plan 阶段还未发生时的粗估，可后期加）
- 点击执行后，前端拿到 `executeIntent` 返回 `{ type: 'agent', runId, placeholderMessageId }`，立刻订阅 SSE `/agent/runs/:id/stream`

---

## 11. Tool Registry 协议

### 11.1 ToolDef

```typescript
type ApprovalMode = 'auto' | 'ask' | 'never';

type ToolDef<I = unknown, O = unknown> = {
  name: string;                       // 'web_search'
  description: string;                // 给 LLM 看
  inputSchema: JSONSchema7;           // function calling schema
  allowedRoles?: AgentRole[];
  approvalMode: ApprovalMode;         // 默认 'auto'
  costHint?: 'low' | 'medium' | 'high';

  /** 是否有副作用(对外部世界写,如发飞书、写 magi、改记忆) */
  hasSideEffects: boolean;

  /** 是否幂等(同样 input 调多次结果一致,无副作用累加) */
  idempotent: boolean;

  /** 计算幂等键的函数(可选):同 input 应得到同 key */
  computeIdempotencyKey?: (input: I) => string;

  handler: (input: I, ctx: ToolCtx) => Promise<O>;
};

type ToolCtx = {
  runId: string;
  stepId: string;
  ownerId: string;
  channel: 'private' | 'group';
  groupId?: string;
  topicId?: string;
  logger: Logger;
  signal: AbortSignal;                // run-level
  apiKey?: string;
  emitEvent: (event: AgentEvent) => void;
};
```

### 11.2 Approval Modes

- `auto`：直接跑（`web_search` / `url_fetch` / `wikipedia` / `pdf_reader` / `youtube_transcript` / `magi_system_read`）
- `ask`：进入 `awaiting_approval` 状态（`doc_export_feishu` / `magi_content_ingest`(写) / `browser_use` / 任何 `hasSideEffects=true` 默认建议 ask）
- `never`：禁用（topic_skill 可临时关掉某工具）

**覆盖优先级**：
1. run 创建时 `body.autoAll: true` → 全部 ask 视为 auto
2. topicSkill 的工具策略覆盖
3. ToolDef 默认 approvalMode

**超时行为**（见 §6 状态机）：
- 默认 60s
- `costHint='low'` 超时 → auto grant
- 其他超时 → deny（等同 replan）

### 11.3 MCP Adapter（M1c 阶段）

```typescript
async function loadMcpServer(config: {
  command: string;
  args: string[];
  env?: Record<string, string>;
}): Promise<ToolDef[]>;
```

M1a 不实现真实加载，只做协议骨架 + mock server 测试。

---

## 12. Worker 主循环

### 12.1 启动

```typescript
// apps/api/src/lib/agent/worker.ts
export function startAgentWorker(opts: { concurrency: number }): WorkerHandle;
```

进程启动时：`setInterval(pickupNextRun, 2_000)`，每次 SELECT FOR UPDATE SKIP LOCKED 一行。

```sql
SELECT * FROM agent_runs
WHERE status IN ('draft','planning','running','replanning')
  AND (last_heartbeat_at IS NULL OR last_heartbeat_at < now() - interval '30 seconds')
ORDER BY created_at
LIMIT 1
FOR UPDATE SKIP LOCKED;
```

`awaiting_confirm` / `awaiting_approval` 的 run **不在 pickup 范围**：它们由 HTTP confirm / approve 路由直接推进，或由独立的 `setInterval(checkTimeouts, 5_000)` 检查超时（见 §12.3）。

### 12.2 主流程伪代码

```typescript
async function executeRun(run: AgentRun) {
  const abortController = new AbortController();
  registerRunSignal(run.id, abortController);
  startHeartbeat(run.id, 10_000);

  try {
    if (!run.plan) {
      run.plan = await doPlanning(run);
      if (run.plan.steps.length > 1 && !run.autoAll) {
        await transitionTo(run, 'awaiting_confirm');
        return; // 退出循环,HTTP confirm 会重新触发 pickup
      }
      await transitionTo(run, 'running');
    }

    for (let i = run.usage.steps; i < run.plan.steps.length; i++) {
      await checkBudget(run);
      if (abortController.signal.aborted) throw new Cancelled('user');

      const planStep = run.plan.steps[i];
      const tool = toolRegistry.get(planStep.toolName);

      if (await needsApproval(tool, run)) {
        await recordStep(run, { kind: 'approval_request', toolName: tool.name, input: planStep.input });
        await transitionTo(run, 'awaiting_approval', {
          awaiting_approval_until: nowPlus(60_000),
          awaiting_approval_step_idx: i,
          pending_approval_tool_name: tool.name,
        });
        return;  // 退出,HTTP approve / 超时检查会重新触发 pickup
      }

      const toolCallKey = tool.computeIdempotencyKey?.(planStep.input) ?? null;

      // 幂等查重(crash recovery)
      if (toolCallKey) {
        const existing = await findStepByToolCallKey(run.id, toolCallKey);
        if (existing) {
          emitEvent({ kind: 'tool_call_replayed', stepId: existing.id });
          continue;  // 跳过,直接进入下一 step
        }
      }

      emitEvent({ kind: 'pre_tool_use', tool: tool.name, input: planStep.input });

      let output;
      let retried = false;
      try {
        output = await withTimeout(tool.handler(planStep.input, ctx), 60_000);
      } catch (err) {
        try {
          output = await withTimeout(tool.handler(planStep.input, ctx), 60_000);
          retried = true;
        } catch (err2) {
          await recordStep(run, {
            kind: 'tool_error',
            toolName: tool.name,
            toolCallKey,
            input: planStep.input,
            error: String(err2),
          });
          // 触发 replan
          run.plan = await doReplan(run, {
            reason: 'retry_after_tool_fail',
            previousError: String(err2),
          });
          continue;
        }
      }

      await recordStep(run, {
        kind: 'tool_call',
        toolName: tool.name,
        toolCallKey,
        input: planStep.input,
        output,
        retried,
      });
      await markTodoCompleted(run, planStep.todoId);
      emitEvent({ kind: 'post_tool_use', tool: tool.name, output });

      if (shouldCritique(run)) {
        const c = await critique({ runId: run.id, plan: run.plan, recentSteps: ..., snapshot: ... });
        await recordStep(run, { kind: 'critique', input: c });
        if (c.shouldReplan) {
          run.plan = await doReplan(run, { reason: 'critique', previousPlan: run.plan });
        }
      }
    }

    const reply = await generateFinalReply(run);
    await recordStep(run, { kind: 'reply', output: reply });
    await markCompleted(run, reply);

  } catch (e) {
    if (e instanceof Cancelled) await markCancelled(run, e.reason);
    else if (e instanceof BudgetExhausted) await softComplete(run);
    else {
      await recordStep(run, { kind: 'system_error', error: String(e) });
      await markFailed(run, e);
    }
  } finally {
    stopHeartbeat(run.id);
    unregisterRunSignal(run.id);
  }
}
```

### 12.3 Timeout Checker

独立的 `setInterval(checkTimeouts, 5_000)`：

```sql
SELECT id, pending_approval_tool_name FROM agent_runs
WHERE status = 'awaiting_approval'
  AND awaiting_approval_until < now()
ORDER BY awaiting_approval_until
LIMIT 10;
```

对每个超时的 run，根据工具 `costHint`：
- `low` → 写 `approval_timeout` step（备注 'auto_grant'），状态回到 `running`，下次 pickup 时执行
- 其他 → 写 `approval_timeout` step（备注 'auto_deny'），状态 `replanning`，触发 re-plan

---

## 13. Crash Recovery & 幂等性

### 13.1 总策略

> **每个 step 都是事务**：先调工具 / 再写 step。如果工具有副作用（`hasSideEffects=true`），**先**写一条 `kind='tool_call'` 的 step（含 `tool_call_key` + `input`，`output=null`）作为 reservation；调用成功再 UPDATE 它的 `output`。crash recovery 时看到 `output IS NULL` 的 step，按工具的 idempotent 标记决定是重跑还是跳过。

### 13.2 工具 idempotency 等级

| 等级 | 工具示例 | recovery 行为 |
|------|---------|--------------|
| **A. 纯读，无副作用** | `web_search` / `url_fetch` / `pdf_reader` / `wikipedia` / `youtube_transcript` / `magi_system_read` | 直接重跑（同样 input 同样结果） |
| **B. 写但幂等** | `doc_export_markdown`（同 title+content 覆盖同一 message）/ `topic_skill_write`（同 id upsert） | 重跑，handler 内部用 upsert / 同 idempotency key 判重 |
| **C. 写但非幂等** | `doc_export_feishu`（每次调用都新建文档）/ `magi_content_ingest`（外部服务） | **必须**实现 `computeIdempotencyKey` + 工具内部缓存：调用前查"该 key 是否已成功过"，是 → 返回缓存结果，否 → 真调用 + 写缓存 |

### 13.3 Recovery 时序

```
worker 启动 → pickup 拿到 run(status='running', last_heartbeat_at 30s 前)
            → 加锁(FOR UPDATE SKIP LOCKED)
            → 读最大 idx 的 agent_step,看 kind:
              - 'tool_call' 且 output != null    → 上一 step 完成,从下一 step 继续
              - 'tool_call' 且 output == null    → 上一 step 是"reservation":
                    + 若 tool.idempotent=true   → 重跑该 step(可能产生重复外部副作用,但工具自身去重)
                    + 若 tool.idempotent=false  → 走 idempotency key 缓存查询,无缓存就跑
              - 'tool_error'                     → 上次 retry 失败,执行 replan
              - 'replan'                         → 上次 replan 完成,从新 plan 的下一 step 继续
              - 'approval_request'(末尾)          → 应该是 status='awaiting_approval',否则数据不一致,标 'failed'
            → 写一条 kind='heartbeat' step(可选,留作排查)
            → 进入主循环
```

### 13.4 跨进程并发安全

- `FOR UPDATE SKIP LOCKED` 保证同一 run 不会被两个 worker 同时跑
- 持锁期间持续 heartbeat
- 写入 step 用 `INSERT ... ON CONFLICT (run_id, idx) DO NOTHING`（防 idx 冲突）
- 工具的 idempotency key 用 unique index 兜底（见 §5.2 `idx_agent_steps_tool_call_key`）

### 13.5 已 applied 的 step 不会被反向回滚

worker 不做"撤销"：crash 之前已经导出的飞书文档不会被删除。这是设计选择：
- agent 任务通常 minutes 级，外部副作用罕见
- 真要"撤销"成本远高于"幂等不重复"
- 用户在前端可以看到所有副作用（导出链接等）

---

## 14. Hooks 事件总线

```typescript
type AgentEvent =
  | { kind: 'run_created'; run: AgentRun }
  | { kind: 'plan_generated'; runId: string; plan: Plan }
  | { kind: 'pre_tool_use'; runId: string; tool: string; input: unknown }
  | { kind: 'post_tool_use'; runId: string; tool: string; output: unknown }
  | { kind: 'tool_call_replayed'; runId: string; stepId: string }     // crash recovery
  | { kind: 'todo_completed'; runId: string; todoId: string }
  | { kind: 'critique'; runId: string; shouldReplan: boolean }
  | { kind: 'approval_requested'; runId: string; tool: string }
  | { kind: 'approval_granted'; runId: string; byUserId: string }
  | { kind: 'approval_denied'; runId: string; byUserId: string; reason: 'user'|'timeout' }
  | { kind: 'cancelled'; runId: string; byUserId: string; reason: string }
  | { kind: 'completed'; runId: string; resultMessageId: string };

export const agentHooks = new EventEmitter<AgentEvent>();
```

内置订阅者：SSE 广播 + 复用现有 `llmRequestLog`。

---

## 15. Interrupt & Steer API

### 15.1 Cancel

`POST /agent/runs/:id/cancel` → 触发 run-level `AbortController.abort('user_cancel')` + 写 `cancel` step + 状态 `cancelled` + 更新 placeholder message。**群成员都能调**（auth 中间件验证用户在 group_members 即可）。

### 15.2 Steer

`POST /agent/runs/:id/steer` body: `{ instruction: string }`：
1. abort 当前 step（同 cancel 的 signal 机制，但 reason='steer'）
2. 写 `steer` step（记 byUserId + instruction）
3. 状态 `replanning`，pickup 时 planner 用 `reason: 'steer'` + `steerInstruction` 重新规划剩余步骤
4. **新的 AbortController** 重建（旧的已 abort）

### 15.3 Approval

- `POST /agent/runs/:id/approve` → 写 `approval_grant` step + 状态回到 `running`，下次 pickup 跑下一 step
- `POST /agent/runs/:id/deny` body: `{ reason?: string }` → 写 `approval_deny` step + 状态 `replanning`

### 15.4 Confirm（plan 确认）

`POST /agent/runs/:id/confirm` → 把 `awaiting_confirm` 直接推进到 `running`。

---

## 16. HTTP / SSE 路由

`apps/api/src/routes/agent.ts`：

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/agent/runs` | 列任务（query: channel, groupId, topicId, sessionId, status, limit, before） |
| GET | `/agent/runs/:id` | 拉 run + steps + todos 当前快照 |
| GET | `/agent/runs/:id/stream` | **SSE** 流式推 `AgentEvent` |
| POST | `/agent/runs/:id/confirm` | `awaiting_confirm` 推进 |
| POST | `/agent/runs/:id/approve` | `awaiting_approval` grant |
| POST | `/agent/runs/:id/deny` | `awaiting_approval` deny |
| POST | `/agent/runs/:id/cancel` | 硬取消 |
| POST | `/agent/runs/:id/steer` | 软引导 |
| POST | `/agent/skills` | 创建/更新 topic skill |
| GET | `/agent/skills` | 列 skill |
| DELETE | `/agent/skills/:id` | 删除 |

**注意**：不提供 `POST /agent/runs`（创建）的 HTTP 入口。Agent run 一律从 `intentExecute` 内部 `createAgentRun()` 创建，统一走 intent 体系，避免出现"两种创建路径，结果不一致"。`createAgentRun` 是 lib 层导出的函数，未来 E 子项目的定时调度可以直接调它。

---

## 17. 代码组织

```
apps/api/src/lib/agent/
├── runtime.ts            # createAgentRun, executeRun(主入口)
├── worker.ts             # 后台循环 + pickup + timeoutChecker
├── planner.ts            # generatePlan
├── critique.ts           # critique
├── replyGen.ts           # generateFinalReply
├── contextAdapter.ts     # snapshotForAgent (§7)
├── messageBridge.ts      # 与 private/group message 的交互 (§8)
├── toolRegistry.ts       # 注册表 + 类型
├── mcpAdapter.ts         # MCP client adapter (M1c)
├── hooks.ts              # 事件总线
├── budget.ts             # 预算检查
├── stepRecorder.ts       # 写 agent_steps + heartbeat + idempotency
├── todoList.ts
├── topicSkills.ts        # CRUD + system prompt 注入
├── steer.ts              # interrupt/steer/cancel/approve/deny
├── store.ts              # agent_runs + agent_steps 的 pg 访问
└── tools/
    ├── echoSleep.ts            # MVP mock,验证 runtime
    ├── webSearch.ts            # M1c
    ├── urlFetch.ts             # M1c
    ├── docExportMarkdown.ts    # M1c
    ├── magiSystemRead.ts       # M1c (包装 integrations/magi)
    ├── magiContentIngest.ts    # M1c (需要 idempotency)
    ├── pdfReader.ts            # M2
    ├── wikipedia.ts            # M2
    ├── youtubeTranscript.ts    # M2
    ├── docExportFeishu.ts      # M2 (需要 idempotency)
    ├── docExportPdf.ts         # M2
    ├── mapsPlaces.ts           # M2
    ├── jsRender.ts             # M2
    └── browserUse.ts           # M3

apps/api/src/routes/
└── agent.ts

apps/api/src/db/migrations/
└── 012_agent_runtime.sql

packages/shared/src/social.ts                # IntentKind 加 'agent_run'
packages/shared/src/intent/executable.ts     # 加 'agent_run'

apps/mobile/src/features/agent/
├── AgentRunCard.tsx
├── AgentRunSteps.tsx
├── AgentTodoList.tsx
├── AgentRunPanel.tsx
├── useAgentRunStream.ts
└── api.ts
```

---

## 18. 里程碑（M1 拆成 M1a / M1b / M1c / M1d）

### 18.1 M1a：基础设施 + Mock Tool 跑通（3 天）

**范围**
- 迁移 `012_agent_runtime.sql`（表 + 索引）
- `lib/agent/runtime.ts` + `worker.ts` + `store.ts` + `stepRecorder.ts` + `budget.ts`
- `tools/echoSleep.ts`（idempotent=true,纯计算）+ `toolRegistry.ts`
- `planner.ts` 最小实现（只支持 echoSleep 工具）
- `contextAdapter.ts` 私聊路径（群聊路径放 M1b）
- `messageBridge.ts` 私聊 placeholder 写入 + completed 时 update
- `packages/shared` 加 `'agent_run'` IntentKind
- `intentRules.ts` 加最简 `agent_run` 规则（仅 `/agent` slash 命令触发）
- `intentExecute.ts` 加 `'agent_run'` 分支
- 后端 `routes/agent.ts` 只实现 GET runs/:id + SSE stream + POST cancel + POST confirm
- worker 进程内嵌（修改 `apps/api/src/index.ts` 启动时 `startAgentWorker({ concurrency: 1 })`）

**验收**
1. ✅ 跑 migration，建表成功
2. ✅ 私聊里发 `/agent 帮我跑三步 echo`，echoSleep 工具被调用 3 次，每次 sleep 2s
3. ✅ `agent_steps` 有 6 条记录（plan + 3×tool_call + reply + 状态记录）
4. ✅ SSE stream 实时推送 step 事件
5. ✅ 聊天里 placeholder message 最终被更新为 "三次 echo 完成"
6. ✅ 跑到第 2 步按 cancel → 状态 cancelled，placeholder message 显示"已取消"
7. ✅ `await_confirm` 超时 10s 自动开跑
8. ✅ kill API 进程 → 重启 → 未完成的 run 自动续跑（继续剩余 echo）

**测试范围（详见 §19 测试矩阵）**
- T1（状态机）、T2（budget）、T3（planner JSON）、T6（echo tool integration）、T9（intent agent_run trigger）

### 18.2 M1b：群聊 + 主流补充能力（3 天）

**范围**
- `contextAdapter.ts` 群聊路径
- `messageBridge.ts` 群聊 invokeMessage + placeholderAi 流（写 `llm_invoke_jobs`）
- `topicSkills.ts` + `routes/agent.ts` skills CRUD
- `critique.ts` 完成
- `steer.ts` 完成 steer API + replan
- approval 流程完整：`awaiting_approval` 状态 + approve/deny/timeout
- mobile：`features/agent/` 全部组件 + `IntentChipBar` 加 agent_run 芯片 + 在聊天里渲染 AgentRunCard
- `hooks.ts` 完成

**验收**
1. ✅ 群聊里发"@agent 测试三步" → 写入 invokeMessage + placeholderAi，agent 跑完后 placeholderAi 更新为最终回复，`llm_invoke_jobs.status='done'`
2. ✅ 任意群成员都能 cancel
3. ✅ `approvalMode='ask'` 的工具调用前进入 awaiting_approval，60s 超时按 costHint 处理
4. ✅ 用户发 steer "改成总结" → replan，新 plan 替换剩余 steps，继续跑
5. ✅ `topic_skills` 创建后，下次同 topic 的 agent run 在 system prompt 里包含该 skill
6. ✅ critique 在 5 步后或失败 2 次后插入（即使是 echo 工具，可强制让 planner 出更长 plan）
7. ✅ mobile 前端能在聊天里展开 AgentRunCard 看每一步

**测试范围**：T4（approval timeout）、T5（heartbeat reclaim）、T7（context adapter 私聊 + 群聊）、T8（message bridge）

### 18.3 M1c：第一个真 Agent（4 天）

**范围**
- 实现 5 个 M1 工具：
  - `webSearch`（Tavily，env: `TAVILY_API_KEY`）— Tier A 纯读
  - `urlFetch`（undici + `@mozilla/readability` + jsdom）— Tier A 纯读
  - `docExportMarkdown`（写 `documents` 表）— Tier B 幂等（用 title+ownerId 作为 idempotency key，upsert）
  - `magiSystemRead`（包装 `queryMagiSystem`）— Tier A
  - `magiContentIngest`（包装 `ingestMagiContent`）— **Tier C 非幂等**，必须实现 `computeIdempotencyKey: (input) => sha256(input.url)` + 工具内部缓存（用 `documents` 表 payload 字段 jsonb_path 查重）
- planner prompt 完整版（含所有工具 schema）
- `intentRules.ts` 升级 `agent_run` 规则到完整 §10.2 启用条件
- M2 工具骨架（不实现，占位）

**验收**
1. ✅ 端到端："@agent 帮我研究家族信托写成 md"，agent：web_search → url_fetch×3 → 写 markdown 文档，最终在聊天里给文档链接 + 简要摘要
2. ✅ 任意一个 url_fetch 失败，重试 1 次后 replan，把 "url X 不可达"塞回 plan，agent 用其他 url 完成
3. ✅ 重复发同一 URL 的 magi ingest，第二次直接拿缓存（验证 idempotency）
4. ✅ MCP adapter 框架能加载本地 mock MCP server（不必接真实生态）

**测试范围**：T10（idempotency / crash recovery 含副作用工具）

### 18.4 M1d：抛光 + Hardening（2 天）

**范围**
- 任务面板 UI（mobile）
- 预算 budget_exhausted 软着陆 + 前端展示已花费
- 所有错误路径的 UX：failed / cancelled / budget_exhausted 都有合理 placeholder message
- Migration 跑过完整生产数据 smoke test
- 单元测试 + 集成测试齐全（见 §19）
- 文档（README + AGENTS.md 加 agent 节）

**验收**
1. ✅ §19 测试矩阵全部通过
2. ✅ 任务面板能列 / 详情 / 取消
3. ✅ 预算耗尽时聊天里看到"已用 X 步、Y tokens、¥Z，到达上限，本次结果：…"
4. ✅ 失败时聊天里看到具体错误，且能点"再试一次"按钮重新 run（创建新 run，不复用旧 run）

### 18.5 M2 / M3 概览

- **M2（5-6 天）**：pdf_reader / wikipedia / youtube_transcript / docExportFeishu（**幂等**：以 user+topic+date 做 key） / docExportPdf / mapsPlaces / jsRender
- **M3（3 天）**：browserUse（Stagehand + Playwright；Docker image 加 Chromium）

---

## 19. 测试矩阵

每行一个测试主题，列出 M1a/b/c/d 哪个阶段需要覆盖。所有 backend 测试用 `vitest`（对齐现有 `memoryPreCompact.test.ts` / `memoryRetrieve.test.ts` 风格），需要 DB 的用 testcontainers-postgres 或本地 PG。

| ID | 测试主题 | 类型 | 覆盖点 | 阶段 |
|----|---------|------|--------|------|
| **T1** | **状态机迁移** | unit | 所有合法迁移 + 非法迁移抛错（draft→completed 应失败）；终态不可逆 | M1a |
| **T2** | **Budget 检查** | unit | maxSteps/maxSeconds/maxTokens 三道闸；耗尽时抛 `BudgetExhausted` | M1a |
| **T3** | **Planner JSON schema** | unit | LLM 输出非法 JSON 时重试 1 次；2 次都失败 → run 标 `failed` 且 step 含 raw 输出；合法 JSON 解析正确；steps 为空数组合法 | M1a |
| **T4** | **Approval timeout** | unit + integration | 60s 超时；costHint='low' auto grant；其他 deny；crash 后超时仍生效（用模拟 time） | M1b |
| **T5** | **Heartbeat reclaim** | integration | worker A 跑到一半进程死亡，30s 后 worker B pickup，从下一 step 继续；同一 run 不会被两 worker 同时跑 | M1d ¹ |
| **T6** | **echo tool integration** | integration | 端到端：创建 run → planner 出 3 步 echo plan → worker 跑 → reply → message 更新 | M1a |
| **T7** | **Context Adapter** | unit | 私聊：snapshot.systemPrompt 含 persona+memory+topicSkill；群聊：history 含成员名前缀；topicSkills 包在 `<topic_skills>` 标签 | M1b |
| **T8** | **Message Bridge** | integration | 私聊：placeholder 在 createAgentRun 时写入，runId 写入 payload；completed 时 UPDATE；群聊：invokeMessage + placeholderAi + `llm_invoke_jobs` 三者一致 | M1b |
| **T9** | **Intent agent_run 触发** | unit | `/agent slash 命令` 触发；"帮我研究 X"动词 + URL 升级；纯 "记住 X" 不升级（memory 优先）；纯 URL 无动词不升级（magi_content_link）；纯 chat 不升级；autoExecute 在 confidence<0.92 时不触发；intentChipBar 出现"让 agent 跑"芯片 | M1a (基础) + M1c (完整规则) |
| **T10** | **Idempotency / Crash recovery 副作用工具** | integration | magi_content_ingest 同 URL 两次只调用一次外部；docExportMarkdown 重复 → 同 docId 覆盖；模拟 crash（kill worker on tool_call 写入后、output 写入前）→ recovery 时按 idempotency key 查到缓存,不重跑外部 | M1c |
| **T11** | **Steer 流程** | integration | 跑到一半 steer → 当前 step 中断 → replan → 剩余 steps 替换 → 继续 | M1b |
| **T12** | **Cancel 权限** | integration | 群聊里非发起人 cancel 成功；外人（非群成员）cancel 返回 403 | M1b |
| **T13** | **Topic Skills 注入** | unit + integration | enable=false 的 skill 不注入；scope='topic' 的 skill 在该 topic 注入而其他 topic 不注入 | M1b |
| **T14** | **预算软着陆** | integration | budget 用尽时生成 final reply 标"已用预算"，不抛异常 | M1d |
| **T15** | **DB 迁移幂等** | integration | 跑 `runMigrations` 两次结果一致；012 已在 `schema_migrations` 时不重跑 | M1a |
| **T16** | **SSE 断线重连** | integration | 客户端断开 SSE 后重连，能继续收到事件（按 run 状态恢复） | M1d ¹ |

> ¹ **2026-05-20 修订（m1b-completion ADR-5）：** T5 / T16 原定 M1b。审阅复核后改为 M1d hardening。M1b-3 mobile 暂用 1.5s polling 占位；M1b-2 通过让出模型已自然覆盖 reclaim 主路径，完整 crash 模拟测试（testcontainers 模拟进程死）独立写在 M1d。

**覆盖率目标**：M1a 完成时 T1/T2/T3/T6/T9/T15 必须 PASS；M1b 完成时 T4/T5/T7/T8/T11/T12/T13/T16 必须 PASS；M1c 完成时 T10 必须 PASS；M1d 完成时全表 PASS。

---

## 20. 与后续子项目（B/C/D/E）的衔接预留

| 子项目 | 本设计预留的接入点 |
|--------|-------------------|
| **B. 群聊并发协调** | `agent_runs.topic_id` 已有索引；B 阶段加表 `topic_locks` + 在 `createAgentRun` 前调 `acquireTopicLock()` |
| **C. 上下文 v2** | `contextAdapter.ts` 的 `snapshotForAgent` 实现替换即可；外部接口不变 |
| **D. 工具集** | 已合并入本 spec §17 + §18 工具清单 |
| **E. 存档与定时调度** | `createAgentRun` 是 lib 层函数，可被 cron 调度直接调用；`doc_export_*` 工具已设计幂等 |

---

## 21. 全局规划总览（备查）

| 子项目 | 主题 | 与本 spec 的关系 |
|--------|------|----------------|
| A | Agent Runtime | **本 spec** |
| B | 群聊 Agent 并发协调 | 紧跟 A |
| C | 上下文 v2 | 与 A 可并行；§7 留接入点 |
| D | 工具集 | **合并入本 spec §17 + §18** |
| E | 存档与定时调度 | A 之后；`createAgentRun` 留接入 |

---

## 22. 设计决策附录（关键 Q&A）

**Q: 为什么不复用 `orchestration_runs` 表？**
A: 该表 payload JSONB 是松散结构，且当前几乎没有代码引用。`agent_runs` 字段众多（plan / todos / budget / usage / approval 状态 / heartbeat 等），用强类型列比 JSONB 更易索引和查询。通过 `intent_turn_id` 关联 `intent_turns` 已经保留了"哪次 intent 触发了 agent run"的追溯关系。

**Q: 为什么群聊还要走 `llm_invoke_jobs`？**
A: 现有群聊 UI（消息卡片的 jobId 关联、`llm_invoke` meta 显示、导出格式）已经依赖它。不写入会让 agent message 在群聊看起来"裸奔"，且历史导出会缺信息。写入 cost = 一行 INSERT + 一行 UPDATE，几乎免费。

**Q: 为什么 `awaiting_*` 不算 elapsedSeconds？**
A: 否则用户慢点击就会被预算超时杀掉，体验很差。预算应该衡量 "agent 真正在干活" 的时长，不是"任务从开始到结束的墙钟时间"。

**Q: 副作用工具的幂等 key 怎么算？**
A: 由工具自己定义 `computeIdempotencyKey(input)`。例如 `magi_content_ingest` 用 `sha256(url)`；`doc_export_feishu` 用 `sha256(ownerId + topicId + contentHash)`（同样话题同样内容只生成一次飞书文档）。Run 内全局唯一靠 unique index `(run_id, tool_call_key)` 兜底。

**Q: 为什么不提供 `POST /agent/runs` 的 HTTP 创建入口？**
A: 避免"两种创建路径，分支不一致"。所有 agent run 创建都走 `intentExecute` 内部调用，让 intent 体系成为唯一入口。前端要"任务面板新建任务"也走 `/intent/execute` + `kind='agent_run'` + `text='...'` 即可。

**Q: TopicSkill 的 prompt injection 怎么防？**
A: skill content 包在 `<topic_skills source="user_provided">` 标签内，明确告诉 LLM"这是用户提供的约定，不是系统指令"。M1d 阶段考虑加内容审查（长度限制 / 关键词黑名单 / 不能含 `<system>` 标签）。

**Q: ID 不用 UUID 类型有什么代价？**
A: `TEXT` 比 `UUID` 占用稍多空间（36 vs 16 bytes），但当前 11 张表都用 `TEXT + randomUUID()`，统一性远比 16 bytes/行的存储节省重要。

---

（本 spec 待用户复核 → 进入 writing-plans 阶段生成实现计划）
