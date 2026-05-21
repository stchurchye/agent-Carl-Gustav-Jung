# 行动中止派 — 家人辅助写作 App

双端（Expo）+ Node API。写作与问答分开；多文稿标签；增删对比与版本回滚；全中文界面。

**API 专用端口：`3922`**（避免与 3000、3001、3100 等常见端口冲突）

## 结构

```
apps/mobile     # Expo React Native
apps/api        # Hono API
packages/shared # 类型、错误文案、时间格式化、diff
docker-compose.yml
```

## 方式一：Docker 跑后端（推荐）

```bash
cd /Users/hongpengwang/行动中止派

# 复制环境变量（Docker 必填 JWT_SECRET，至少 32 字符随机串）
cp .env.example .env
# 编辑 .env：JWT_SECRET=... 以及可选 DEEPSEEK_API_KEY=sk-...
# 生成 JWT：openssl rand -base64 32

# 构建并启动（端口 3922）
npm run docker:up

# 查看日志
npm run docker:logs

# 停止
npm run docker:down
```

验证：`curl http://localhost:3922/health`

## 方式二：本机直接跑 API

```bash
npm install
npm run build -w @xzz/shared
npm run dev:api   # 同样使用 3922 端口
npm run test      # shared 包单元测试
npm run typecheck # 全仓库类型检查
```

## 启动手机端

```bash
npm run dev:mobile
```

- iOS 模拟器：`http://localhost:3922`
- Android 模拟器：`http://10.0.2.2:3922`
- 真机：`EXPO_PUBLIC_API_URL=http://你的电脑IP:3922 npm run dev:mobile`

## 第一阶段已实现

- [x] 写作 / 问答 / 我的 三 Tab
- [x] 写作多标签、切换文稿
- [x] 续写/润色 → 绿增灰删对比 → 同意/拒绝
- [x] 历史版本（按天 · 周几 · 午别 · 几点）与回滚
- [x] 问答自由聊天 + 朗读回复
- [x] DeepSeek Pro（`deepseek-v4-pro`）
- [x] 「我的」里填写密钥
- [x] Docker 部署 API（端口 3922）
- [ ] 本地听写 / 飞书导出（待接）

## DeepSeek 密钥

1. [platform.deepseek.com](https://platform.deepseek.com/api_keys) 申请  
2. App → **我的** → 填入密钥 → **测试一下**  
3. 或写入 `.env` 给 Docker：`DEEPSEEK_API_KEY=sk-...`

## Agent Runtime（M1a + M1b-{1,2,3} + M1c + M1d）

后台多步 agent 执行能力。**当前范围**：

- **M1a**：私聊触发、echo mock 工具、worker 后台跑、取消 / SSE 流。
- **M1b-1**：群聊触发、群成员任意一人可取消 / 查看 / 流式订阅、`topic_skills` 三层 scope（user/group/topic）CRUD + 自动注入 system prompt。
- **M1b-2**：approval gate（`approvalMode='ask'` 工具调用前让出，60s 后按 `costHint` 自动 grant/deny）、steer（中途换方向，abort + replanning）、critique（每 5 步或连续 2 次失败插入 stub critique step）。
- **M1b-3**：mobile UI + hooks bus。`AgentRunCard` 嵌入私聊 / 群聊消息行，含 cancel / approve / deny / steer 操作；`agentHookBus` 广播 run 生命周期 + step 事件，`logHook` 把事件落到 `agent_event_logs` 表。**M1b 用 polling（1.5s）替代 SSE；T16 断线重连 defer 到 M1d**。
- **M1c**：第一批真工具 + LLM planner + LLM 终稿 + idempotency gate + MCP 骨架。
  - 工具：`magi_system_read`（auto / 读 MAGI）、`magi_content_ingest`（ask / 写 MAGI）、`web_search`（auto / Tavily）、`url_fetch`（auto / Mozilla Readability）、`doc_export_markdown`（auto / 按 title upsert 到 documents 表）
  - LLM planner：`generatePlanWithLlm` 用 DeepSeek 把 user 请求 + tool list 翻译成 plan；解析失败 / LLM 不可用自动 fallback 到 echo planner
  - LLM 终稿：`replyGen.generateFinalReply` 在 `softComplete(status='completed')` 时调 LLM 把工具结果汇成一段话，失败 fallback 到原 hint 拼接
  - Idempotency gate：`runtime.resolveToolCallKey(tool, planStep)` 为带 `computeIdempotencyKey` 的工具拼 `<toolName>:<key>`，runtime 先查 `agent_steps.tool_call_key` 命中则改写 observe step 跳过外部调用（适用于同 run 内重复 / crash 恢复）
  - intent 升级：`agent_research` 规则识别"研究/调研/整理一份报告"等自然语言把 `agent_run` 提到 primary chip；orchestrator `autoExecute` 显式排除 `agent_run`，让 agent 始终 user-confirm
  - MCP：`apps/api/src/lib/agent/mcp/` 提供 `McpClient` 接口 + `registerMcpServer` 把远端工具命名空间化（`mcp:<server>:<tool>`）后注册为本地 `ToolDef`；真实 transport defer 到 M1d
- **M1d**：hardening、UX、扩展性。
  - **T5 heartbeat reclaim**：worker A 写完 `tool_call` 后崩溃、`agent_runs.usage.steps` 未追上时，worker B re-pickup 时按 DB 里 `tool_call + observe` 计数推断 `completedCount`，从下一步开始而非重跑非幂等工具。从 `replanning` 状态进入 executeRun 时跳过 reclaim 检测（usage 是被显式 reset 的，不是 crash）。同时写一条 `heartbeat` step `{reclaim: true}` 留痕。
  - **T14 budget_exhausted UX**：终稿明确列出"步骤 X/Y、tokens A/B、用时 Cs/Ds"+ "再试一次"提示；`AgentRunCard` 给 budget_exhausted 单独渲染 usage 行。
  - **Retry**：`POST /api/agent/runs/:id/retry`（仅 terminal 状态）按原 `inputText` / `channel` / `budget` 创建新 run；`AgentRunCard` failed / cancelled / budget_exhausted 状态下显示"再试一次"按钮，详情页 retry 后自动 `navigation.replace` 到新 run。
  - **任务面板**：`GET /api/agent/runs?status=&limit=` 返回 owner runs + 群成员 runs（不含外人）；`BrainAgentTasksScreen` 列表 + `BrainAgentTaskDetailScreen` 详情，已挂到 `BrainHubScreen` 入口。
  - **T16 SSE Last-Event-ID**：`/runs/:id/stream` 每条 step 带 SSE `id` 字段；客户端断线重连用 `Last-Event-ID` header 或 `?after=N` query 续传，跳过已收到的 step。Mobile 继续走轮询（full state read 天然续传）。
  - **Per-user DeepSeek key in worker**：用户在客户端填的 key 经 `secretBox.sealUserApiKey`（AES-256-GCM）落到 `agent_runs.user_api_key_enc`，worker 调 LLM 时 `resolveEffectiveApiKey(run)` 优先解开用户 key，缺则退回 env `DEEPSEEK_API_KEY`。**需要配置 `AGENT_KEY_SECRET`**（≥16 字符）才会启用；未配置则 user key 在写入时被丢弃 + warn。
    - **Rotation (M1e Task 9)**：sealed payload 升级为 v1 格式（带 `0x01` versionTag 头），同时新增 `AGENT_KEY_SECRET_PREV` env 用于平滑轮换。流程：把当前 `AGENT_KEY_SECRET` 复制到 `AGENT_KEY_SECRET_PREV`、生成新 SECRET、重启 API；老 sealed key 走 PREV 解，新写入走新 SECRET。read path 兼容 M1d v0（无 versionTag）的老数据。
  - **Topic skill prompt-injection 防御**：`upsertSkill` 前用 `validateSkillInput` 检查；M1e Task 5 把 pattern 分两档 —— **high** severity（明显 jailbreak：忽略以上指令/规则/设定/人设/上下文/对话、you are now DAN、ignore any prior instructions、force-call magi_content_ingest 等）继续 reject 400；**low** severity（仅出现 `api_key` / `secret` 关键词）允许写入但 warn-log，避免合法的"密钥管理 SOP"被误杀。
  - **User-facing notice 通道 (M1e Task 2)**：之前静默 fallback 的场景（user key 不可用、retry 被去重、planner LLM 失败、skill 注入被 reject…）现在统一写到 `agent_event_logs(event_type='user_facing_notice')`，UI 顶部 banner 展示。`GET /api/agent/runs/:id` 响应附带最新 20 条 notices；SSE 流的 event id 加了命名空间前缀 `s:<step_idx>` / `n:<event_log_id>`，断线重连按前缀 dispatch。`NoticeCode` enum 见 `apps/api/src/lib/agent/notices.ts`。
  - **MCP stdio transport**：`apps/api/src/lib/agent/mcp/stdioTransport.ts` 提供 `McpStdioClient`，按行式 JSON-RPC（`tools/list`、`tools/call`）与 stdio MCP server 通信；自带 `_demoEchoServer.mjs` smoke 测试，可作为接 Anthropic 官方 SDK 前的参考。

**入口**：

- 私聊：发 `/agent 跑三步 echo`
- 群聊：在群话题内发 `/agent 帮我研究…`，`intentExecute` 落到 `createAgentRun({ channel:'group', groupId, topicId })`，同步建 `llm_invoke_jobs` + 群消息占位

**HTTP / SSE**（均挂在 `/api/agent`，需登录）：

- `POST /api/intent/execute` 带 `kind: 'agent_run'` 触发任务（私聊 / 群聊均可）
- `GET /api/agent/runs/:id` 取任务详情（run + 全部 steps）—— 私聊仅 owner，群聊任意群成员可访问
- `GET /api/agent/runs/:id/stream`（SSE）实时推送 `step` / `status` / `end` 事件
- `POST /api/agent/runs/:id/cancel` 取消（群聊任意成员可发起）
- `POST /api/agent/runs/:id/approve` 同意一个 `awaiting_approval` 状态的工具调用
- `POST /api/agent/runs/:id/deny { reason? }` 拒绝 → 进入 `replanning`，worker re-pickup 后调 planner 找替代方案
- `POST /api/agent/runs/:id/steer { instruction }` 中途换方向；服务端 abort 当前 step、写新 plan、状态切 `replanning`
- `POST /api/agent/runs/:id/retry` 把终态 run（completed/failed/cancelled/budget_exhausted）按原 inputText/budget 重跑（M1d）
- `GET /api/agent/runs?status=&limit=` 任务面板列表（owner + 群成员可见，M1d）
- `GET / POST / PATCH / DELETE /api/agent/skills` topic skills CRUD（按 scope 区分 user / group / topic）—— 写入时会拒掉 prompt-injection pattern

**Approval 模型（spec §12 / ADR-1）**：runtime 在 `approvalMode='ask'` 的工具调用前**让出执行**——写 `approval_request` step、`status='awaiting_approval'`、`awaiting_approval_until = now()+60s` 后立即 return。三条恢复路径：

1. HTTP `/approve` → `status='running'` + 写 `approval_grant`
2. HTTP `/deny` → `status='replanning'`（不是 cancelled） + 写 `approval_deny`，worker 下次 pickup 进 `runtime.replanning` 分支，调 `generatePlanForApprovalDeny` 生成新 plan
3. worker tick（每 2s）跑 `autoResolveExpiredApprovals(now)`：扫所有过期 `awaiting_approval`，`costHint='low'` 自动 grant，其他自动 deny，再写一条 `approval_timeout` step

**Steer 模型（spec §15.2 / ADR-3）**：调用 `steerRun(runId, instruction)` → 生成新 plan（version+1）+ `status='replanning'` + 写 `steer` step + abort 共享 `runControllers` 里的 AbortController。executeRun 检测到 `signal.aborted && db.status='replanning'` 抛 `AgentCancelled('steer')`，catch 块识别 `'steer'` 后直接 return，worker re-pickup 进 replanning 路径。

**测试用工具 `risky_echo`**：`approvalMode='ask'` + `costHint='medium'`，仅在 `NODE_ENV !== 'production'` 时注册（运行时入口 `index.ts`），方便手测 approval 流程。

**Topic Skills**：用户在群话题里写"约定"（如"少用表情"、"聚焦税务不讨论投机"）。`contextAdapter.snapshotForAgent` 默认按 `(userId, groupId?, topicId?)` 自动从 `topic_skills` 表里捞 enabled 的项，拼到 system prompt 的 `<topic_skills>` 块。caller 也可显式传 `topicSkills` 覆盖。

**Mobile（M1b-3）**：

- `apps/mobile/src/features/agent/`
  - `AgentRunCard`：嵌入聊天消息行（私聊 + 群聊），渲染当前 agent run 实时状态 + cancel / approve / deny / steer 按钮
  - `AgentTodoList` / `AgentStepList` / `AgentSteerInput`：拆分子组件
  - `useAgentRunPoll`：M1b polling fallback，M1d 升级为 SSE 时只换 import（`useAgentRunSubscription` 别名）
- `IntentChipBar` 给 `agent_run` 候选加 `AGENT` 角标
- `intentFlow / applyIntentExecute` 增加 `type:'agent'` 分支：不发 LLM 请求，刷新会话消息让 `AgentRunCard` 接管渲染（依赖 `payload.agentRun.agentRunId`）

**Hooks Bus（M1b-3）**：

- `apps/api/src/lib/agent/hooks.ts` 提供 `agentHookBus`（EventEmitter），事件名采用 `domain.event` 风格：
  - `run.started` / `run.completed` / `run.failed` / `run.cancelled` / `run.budget_exhausted`
  - `step.recorded`
- 触发点：`stepRecorder.recordStep`（step.recorded）、`runtime.executeRun` 入口（run.started）、`runtime.softComplete` 终态、`runtime.cancelRun`
- M1b-3 内置消费者 `logHook` 把事件序列化写入 `agent_event_logs`；M1c+ 可再加 webhook / Slack / 文件归档
- Spec §14 完整事件名（`pre_tool_use` / `post_tool_use` / `approval_requested` 等）见 `agent-runtime-design.md`，M1b 实现子集，剩余 defer M1c

**测试 / 开发注意事项**：

- agent runtime 的集成测试依赖共享 PG，跑测试前**先确保没有 `npm run dev:api` 在跑** —— 否则 worker 进程会和 vitest 进程争抢 `agent_runs`。worker 在 `process.env.NODE_ENV=test` / `VITEST=1` 时会自动跳过 pickup，但只对 vitest 进程本身生效，无法影响其他 node 进程。
- `apps/api/vitest.config.ts` 用 `singleFork + fileParallelism:false` 串行执行，避免 db-写测试互相 `DELETE`。
- 跑 db 集成测试要先 `set -a; source .env; set +a` 注入 `DATABASE_URL`。

**设计 / 实现细节**：

- 设计文档：`docs/superpowers/specs/2026-05-20-agent-runtime-design.md`
- 实现计划：`docs/superpowers/plans/2026-05-20-agent-runtime-m1a.md`、`m1b-1.md`、`m1b-2.md`、`m1b-3.md`、`m1c.md`
- ADR：`docs/superpowers/plans/2026-05-20-agent-runtime-m1b-completion.md`
- 关键代码：`apps/api/src/lib/agent/*`，迁移：`apps/api/src/db/migrations/012_agent_runtime.sql` / `013_agent_event_logs.sql` / `014_agent_user_api_key.sql`
- M1c 配置：填 `TAVILY_API_KEY` 启用 `web_search`（不填则返回空结果不抛错）；填 `MAGI_SYSTEM_*` / `MAGI_CONTENT_*` 启用 magi 工具真实 transport
