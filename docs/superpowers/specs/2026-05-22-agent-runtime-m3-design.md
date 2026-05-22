# Agent Runtime M3 设计

**状态：** writing-plans
**前置：** v0.m2（11 件工具上线，user_api_keys_enc 落库）
**估算：** ~5-6 天（2 件工具 + 1 个状态机扩展 + 1 个 resume API + planner prompt + 移动端最小适配）

---

## 0. 目标 & 非目标

**目标：** 让 agent 从「单回合按 plan 执行」升级到「能主动反问 + 能派子 agent 深挖」。

**两件新工具：**
1. `ask_user`：识别问题模糊时，写一条「待用户回答」消息，run 进入 `awaiting_user_input` 暂停态，用户在移动端回复后续跑。
2. `deep_research`：派一个独立子 run 深挖一个子问题（同步阻塞），完成后把报告作为 observation 返回父 run。

**非目标：**
- 异步轮询子 run 模式（同步阻塞够用，加异步会引入 SSE/轮询/UI 复杂度，留 M4）
- 子 agent 再派孙 agent（严格防递归）
- 复杂的"reasoning trace"展示（移动端只展示子 run 最终 markdown 报告）

---

## 1. 关键决策（用户已拍板）

| ID | 决策 | 选择 | 备选 / 理由 |
|---|---|---|---|
| ADR-M3-1 | `ask_user` 暂停态 | 新建 `awaiting_user_input` 加入 enum | 不复用 M1f 删除的 `awaiting_confirm`（语义不同：approval 是确认参数，input 是补充信息） |
| ADR-M3-2 | 子 agent LLM | 继承父 agent providerId/modelId | 一致性 > 省钱；后续可加 `subAgentModel` 覆盖 |
| ADR-M3-3 | 子 agent 工具集 | 只读子集（白名单），且禁止 `deep_research` | 白名单：`search_papers`, `search_web`, `wikipedia`, `fetch_url`, `document_reader`, `get_paper_citations`, `datetime_now`, `magi_system_read`。**禁止：** `run_python`（成本/隔离）、`render_diagram` / `doc_export_markdown`（写入副作用）、`critique_last_answer`、`ask_user`（暂停态嵌套混乱）、`deep_research`（递归）、`magi_content_ingest` |
| ADR-M3-4 | 父 → 子调用 | **独立 child executor pool**：新增 `childExecutor.ts` 维护独立 inFlight Set + concurrency limit（default 3），与 `worker.ts` 主 pool 分离。父 run 在 deep_research handler 里调 `dispatchChildRun(childId)` → 轮询 `getAgentRun(childId)` 直到 terminal。这样父持有主 worker slot 不阻塞子调度，互不死锁。异步轮询模式留 M4。 | 不走 inline 因为子 run 可能跑几十秒，inline 会让 handler 期间所有 step persistence/取消信号失去隔离；不走主 worker pool 因为单 slot 死锁 |
| ADR-M3-5 | 子 run 关系 | 新增 `agent_runs.parent_run_id TEXT NULL` 列，外键自引用 | 便于追溯；移动端默认不展示子 run（按 parent_run_id IS NULL 过滤） |
| ADR-M3-6 | resume 入口 | 新增 `POST /api/agent-runs/:id/resume` 接口，body: `{ userInput: string }` | 也可走现有 message 通道间接触发，但显式 API 语义更清晰 |
| ADR-M3-7 | 子 run 预算 | 父 run 调用时传 `maxSteps` (1-8, default 5)；子 run elapsedSeconds 计入父 run 整体预算 | 防止深递归（虽然已禁递归，但单层也要控时间） |

---

## 2. 新增/修改的模块

### 2.1 数据库
- **Migration 018** `018_agent_run_parent_and_pending_input.sql`：
  ```sql
  ALTER TABLE agent_runs
    ADD COLUMN parent_run_id TEXT NULL REFERENCES agent_runs(id) ON DELETE SET NULL,
    ADD COLUMN pending_user_prompt TEXT NULL,
    ADD COLUMN pending_user_step_idx INTEGER NULL;
  CREATE INDEX idx_agent_runs_parent ON agent_runs(parent_run_id) WHERE parent_run_id IS NOT NULL;
  ```
  - `parent_run_id`: 子 run 指向父 run；ON DELETE SET NULL（父删了子 run 保留为孤儿，便于审计）
  - `pending_user_prompt`: ask_user 当时写的问题，便于前端展示
  - `pending_user_step_idx`: 暂停时停在哪一步，resume 时从下一步继续

### 2.2 类型
`AgentRunStatus` 增加 `'awaiting_user_input'`。
`AgentRun` 增加 `parentRunId: string | null`、`pendingUserPrompt: string | null`、`pendingUserStepIdx: number | null`。

### 2.3 新工具

#### `ask_user`
- **Input**: `{ question: string, options?: string[] }`
- **Output**: `{ ok: true, paused: true, messageId: string }` —— **本工具不返回数据**，而是写一条 type=`agent_question` 的消息，并把 run.status 切到 `awaiting_user_input`、记 `pending_user_prompt`/`pending_user_step_idx`
- **特殊语义**：worker 看到 ok+paused 立即终止本轮 step loop，**不**进入下一步 plan，**不**触发 critique，run 保持 awaiting 直到用户 resume
- **replyMeta**: `summaryKind: 'silent'`（不参与 final reply 聚合）

#### `deep_research`
- **Input**: `{ question: string, maxSteps?: number }`（maxSteps 1-8，default 5）
- **Output**: `{ ok: boolean, report: string, citations: ReplyRef[], stepsUsed: number, childRunId: string, error?: string }`
- **实现**：
  1. 在父 run 的 ctx 里调用 `createAgentRun({ parentRunId, ownerId, channel: 'private', inputText: question, ..., toolWhitelist: SUBAGENT_TOOLS })`
  2. 立即 `executeRun(childRunId)` 同步阻塞跑完
  3. 子 run 完成后读取最终 reply 的 markdown + 收集所有 step 产出的 ReplyRef → 组装成 report
  4. AbortError：父 run 取消时同时取消子 run（注册 `ctx.signal` listener）
- **特殊语义**：子 run 的 plan 不允许包含 `ask_user` / `deep_research` —— 在 plan 校验阶段过滤
- **replyMeta**: `summaryKind: 'text'`（report 直接拼进 final reply）

### 2.4 runtime / executor 改造
- `runExecute.ts` 在 observation 处理后检查 `ok && paused === true` → break loop，不 critique，不 markStepDone（步骤本身算 succeeded，整 run 转 awaiting_user_input）
- 新增 `resumeAgentRun(runId, userInput)`：
  - 校验 status === `'awaiting_user_input'`
  - 把用户回答作为一条 step observation 追加（kind='user_input'），写入 chat 历史
  - 清空 `pending_user_prompt` / `pending_user_step_idx`，status → `'running'`，重新 enqueue 给 worker
- worker reclaim 时跳过 `awaiting_user_input` 状态的 run（已有逻辑应已覆盖，确认即可）

### 2.5 API 路由
- `POST /api/agent-runs/:id/resume` body `{ userInput: string }` → 调 `resumeAgentRun` → 返回最新 run snapshot
- 现有 GET / cancel 路由不变

### 2.6 Planner prompt 增量
追加到工具选型建议段落：
```
- **问题模糊 / 缺关键前提**（"画个图" "做个分析" 而没说数据源） → 先 ask_user 反问，不要硬猜
- **需要多步深挖一个子问题**（"近 5 年关于 X 的实证支持" "Y 理论的争议") → deep_research 派子 agent，比串多个 search_papers + fetch_url 更整洁
- **永远禁止**：在 deep_research 子任务里嵌套 deep_research / ask_user（会被运行时拦截）
```

### 2.7 移动端最小适配
- `AgentStepList` 新增 step kind 渲染：
  - `tool=ask_user` observation → 展示"等待你回答"卡片 + 输入框 + 提交按钮（调 resume API）
  - `tool=deep_research` observation → 展示"子任务报告"折叠卡片（默认折叠，展开看 markdown）
- 现有 message feed 渲染 `type=agent_question` 消息：高亮 + 引用问题文本

---

## 3. 测试矩阵

| 模块 | 测试用例 | 期望 |
|---|---|---|
| migration 018 | 字段存在 + 自引用外键 | ✅ |
| store.ts | parentRunId/pendingUserPrompt 读写 roundtrip | ✅ |
| ask_user tool | handler 写消息 + 设 pending_* + 返回 paused:true | ✅ |
| ask_user tool | 缺 question → 校验失败 | ✅ |
| runExecute | observation paused=true → loop 终止 + run.status=awaiting_user_input | ✅ |
| resumeAgentRun | awaiting → running + user_input 追加为 observation | ✅ |
| resumeAgentRun | 状态不对（如 completed）→ 拒绝 | ✅ |
| deep_research tool | 派子 run + 子 run 跑完 + 报告聚合 | ✅ |
| deep_research tool | 子 run plan 含 deep_research → 过滤报错 | ✅ |
| deep_research tool | maxSteps 越界 → clamp 到 [1,8] | ✅ |
| deep_research tool | 父 run cancel → 子 run 同时 cancel | ✅ |
| 工具白名单 | 子 run 的 toolRegistry 视图只含白名单 | ✅ |
| API resume 路由 | 200 happy path + 404 + 409（状态不符） | ✅ |
| planner prompt | snapshot 更新通过 | ✅ |

预期新增 ~25 测试，总数 ~400。

---

## 4. 风险 & 缓解

| 风险 | 缓解 |
|---|---|
| 同步阻塞子 run 导致父 run 步骤超时 | maxSteps default 5 + 父 run budget 计入子 run elapsedSeconds，到 budget_exhausted 强制结束 |
| 用户长时间不 resume → run 一直 awaiting | 加一个 `pending_user_input_expires_at`（默认 24h），过期 worker 把 run 转 cancelled('user_timeout')；可放 M3 polish 或 M4 |
| 子 run 调用了 run_python 也烧 E2B sandbox 配额 | 白名单已排除 run_python，无风险 |
| ask_user 在 group channel 怎么 resume？谁回答算数？ | M3 限定 ask_user 只在 channel='private' 生效；group 里调用直接返回 `ok:false, error:'ask_user only supported in private channel'` |
| 移动端没有 resume UI 会让 awaiting_user_input run 卡死 | M3 必须最小 UI（输入框 + 提交），不能纯后端 |

---

## 5. 实施路线图

| 任务 | 内容 | 工时 |
|---|---|---|
| T0 | 分支 `feat/agent-runtime-m3` + 全量 baseline | 0.2d |
| T1 | migration 018 + types/store 扩展 + tests | 0.5d |
| T2 | `ask_user` 工具 + executor 暂停语义 + tests | 1d |
| T3 | `resumeAgentRun` lib + `POST /resume` 路由 + tests | 1d |
| T4 | `deep_research` 工具 + 工具白名单 + 子 run 取消 + tests | 1.5d |
| T5 | planner prompt 增量 + snapshot 更新 | 0.3d |
| T6 | 移动端 ask_user 输入卡片 + deep_research 折叠报告 | 1d |
| T7 | 全量 review + merge main + tag v0.m3 | 0.3d |

合计：~5-6 天

---

**确认进入 writing-plans 阶段。**
