# 全貌剖析 · 五系统对比 · 补强路线图

> 2026-06-08。对 `agent-Carl-Gustav-Jung` 做一次全貌盘点，与 Hermes / OpenClaw /
> Claude Code / Codex / Cursor 五个参照系对比，定出补强点路线图。**M1（技能自蒸馏）已在本次落地**。

## Part A — 项目全貌与子系统职责

```
apps/mobile (Expo RN)        apps/api (Hono)                     packages/shared
─────────────────────        ──────────────────────────────     ────────────────
写作 Tab(多稿/diff/版本回滚)   routes/* (auth,chat,groupChat,      类型/错误文案/
问答 Tab(聊天/朗读)            intent,agent,memory,…)             时间格式/diff
我的 Tab(密钥/persona)         │
features/agent/*  ◀──SSE/poll─┤  lib/agent/ ◀══════ 核心运行时 ══════╗
 AgentRunCard/StepList/Todo   │   worker→runtime→runExecute (ReAct loop)
brain/* (记忆面板)             │   planner / reflection / critique
                              │   toolRegistry + tools/* (18 真工具)
                              │   approval / steer / askUser / budget
                              │   topicCoord (M7 群并发合并/排队)
                              │   childExecutor + deepResearch (子 agent)
                              │   mcp/* (client, stdio transport)
                              │   sandbox (E2B Python) / checkpoint / 幂等
                              ╚═ 记忆: 原生 always-on 核心 + MAGI 情景层 ═╝
```

- **对话基座**：私聊 `chat.ts`/群聊 `groupChat.ts` + 意图体系（`intentRules`→`intentClassify`→`intentAnalyzer`→`intentExecute`）。`agent_run` 是被「升格」的一个 intent。
- **Agent 运行时**：`worker.ts`（PG 队列 `FOR UPDATE SKIP LOCKED` + 心跳接管）→ `runtime.ts`/`runExecute.ts` 主循环 → `planner.ts`（LLM 生 JSON plan，失败 fallback echo）→ 工具循环 → `reflection.ts`（LLM 统一「目标达成没」收尾决策）→ `runLifecycle.softComplete` 终稿。
- **续跑/防呆**（epic 0001–0003 已完成）：plan 耗尽且 todo 未完 → continuation-replan 带观察续跑；`CONTINUATION_ROUND_CAP=2` + 无进展 stall-guard + reflection 兜底。
- **工具层**：web_search/fetch_url/wikipedia/search_papers/get_economic_series/youtube_transcript/document_reader（读）、run_python（E2B 沙箱）、render_diagram、doc_export_markdown/magi_content_ingest（写，approval=ask）、magi_system_read、deep_research（子 agent）、ask_user/recall_step/recall_memory/critique_last_answer/datetime_now（meta）。约定见 `tools/README.md`。
- **韧性**：每 step append-only 落库；副作用工具 `computeIdempotencyKey` + unique index；crash 后按 `tool_call/observe` 计数 reclaim 续跑；E2B 沙箱跨 step 持久、终态 best-effort kill。
- **控制面**：approval gate（ask/auto/never + costHint 超时）、steer（中途改向→replan）、ask_user（挂起 awaiting_user_input）、budget（20 步/600s/100k token 硬顶）。
- **群协调（M7）**：`topicCoord.ts` 同 topic 合并 merged_inputs / 排队 / 出队。
- **技能（topic_skills）**：user/group/topic 三层「群规」注入 system prompt；写入/读取两道注入防御。
- **记忆（两层，ADR-0001）**：原生 `memory_fragments` always-on 核心（autoExtract + consolidate + 升格）；MAGI 情景层（bge 向量 + hybrid + 时序失效 + 质量门 + proactive/recall）。
- **可扩展**：`mcp/`（client + stdioTransport）；hooks 总线 `agentHookBus` + `logHook`；`notices.ts` user-facing banner。

## Part B — 与五系统的区别

参照系两阵营：**个人助理型**（Hermes、OpenClaw：持久分层记忆 + 技能/自我改进 + soul + crons 常驻 + 宽执行面）与
**编码 agent**（Claude Code、Codex、Cursor：纯 ReAct + 文件/shell/代码库工具 + plan mode + hooks + subagents）。

| 维度 | 本项目 | Hermes | OpenClaw | Claude Code | Codex | Cursor |
|---|---|---|---|---|---|---|
| Agent 循环 | plan-once + continuation-replan（ReAct 为 flag 后 Phase 2） | ReAct | ReAct | 纯 ReAct | 纯 ReAct | 纯 ReAct |
| 后台/可恢复 | ✅ PG 队列 + 心跳接管 + 幂等 reclaim（**强项**） | 常驻进程 | 常驻 gateway | 会话级 | 会话级 | 会话级 |
| 记忆 | 原生核心 + MAGI 情景两层（**强项**） | 5 层 md+sqlite | SOUL.md+记忆 | CLAUDE.md | AGENTS.md | 规则/索引 |
| 技能 / 自我改进 | topic_skills + **自蒸馏(M1 新增)** | ✅ 任务→生成 skill | ✅ SOUL.md+模板 | skills/子代理 | — | — |
| Persona/Soul | ✅ persona | ✅ soul | ✅ SOUL.md | — | — | — |
| 定时/常驻主动 | ❌（推到 E 子项目） | ✅ crons | ✅ 常驻 | — | — | — |
| 执行面 | web/MAGI/文档 + **E2B Python 沙箱**；无 shell/文件/浏览器（刻意） | 宽 | shell/文件/浏览器/docker | 文件/shell/代码 | 沙箱代码 | 代码库多文件编辑 |
| 工具协议/MCP | Anthropic 风格 + **MCP client(stdio)**；无 server | — | 插件 | ✅ MCP c/s | 工具 | 工具 |
| 子 agent | deep_research 单一形态 + childExecutor 池 | — | — | ✅ 通用 subagents | — | — |
| approval/sandbox | ✅ ask/auto/never + costHint | — | 权限 | ✅ 权限模式 | ✅ 沙箱+审批 | — |
| hooks | ✅ 内部总线（不可用户配置） | — | 配置式 | ✅ 用户可配 | — | — |

**定位**：在「后台可恢复 + 记忆分层 + 群聊多人 agent」上已超过多数编码 agent；
落后处为「纯 ReAct（CC/Codex/Cursor 终态）、执行面宽度/MCP server/通用子 agent（OpenClaw/CC）」。
「自我改进/技能学习」缺口已由本次 M1 补上第一块。

## Part C — 补强路线图

```
M1 技能自蒸馏(自我改进)  ──┐  ← ✅ 本次完成
M2 ReAct Phase-2 原型     │  ← 深化 Agent Loop；先 prototype 测延迟(repo 既定前置)
   (mode:plan_once|react) │
M3 通用子 agent 角色化     │  ← deep_research→可配 role/工具子集 的通用 spawn
M4 MCP 扩展(多 transport) │  ← 补 SSE/HTTP transport + server 侧探索 [已落地 2026-06-09,PR #18/#19]
M5 技能·记忆升格闭环 + UI ─┘  ← mobile「建议技能/记忆」统一评审面
```

- **M1（已完成）**：成功多步 run 收尾时，把「这类任务怎么做」蒸馏成可复用 topic_skill（`enabled=false` 待人评审），对齐 Hermes「完成任务→生成 skill」。实现见下。
- **M2 ReAct Phase-2**：按 `docs/issues/0000`——藏 `mode` flag、先 `prototype` 实测延迟，达标再 opt-in 共存，不替换核心循环。
- **M3 通用子 agent**：把 `childExecutor`+`deepResearch` 泛化成带 `role`/工具子集的 `spawn_subagent`（`AgentRole` 字段已预留）。
- **M4 MCP 扩展**：`mcp/` 现有 stdio 之外补 SSE/HTTP transport；评估只读 MCP server。**[已落地 2026-06-09,PR #18/#19]**(httpTransport + registerFromConfig)
- **M5 闭环 + 评审 UI**：M1 蒸馏的 skill + 现有 episodic→core 升格，统一一个 mobile「建议技能/记忆」评审面（当前无 skills 屏）。

## M1 实现（本 PR：技能自蒸馏 self-improvement loop）

完全平行于现有「情景记忆蒸馏」（`memoryEpisodicWire.runEpisodicMemory`）。run 成功收尾、且做了真·多步工具工作
（成功 `tool_call` ≥ 2、非子 run）时，用一次 LLM 把方法蒸馏成一条 user-scope `topic_skill`，写入时 `enabled=false`、
`source='auto_distilled'`。用户在技能列表启用后，`listForAgent` 即注入后续同类 run 的 system prompt → 学习闭环成立。
全程 **fail-open**，仅取消透传。

**改动文件**：
- `apps/api/src/db/migrations/023_topic_skill_source.sql` —— `topic_skills` 加 `source` / `source_run_id`（append-only）。
- `apps/api/src/lib/agent/topicSkills.ts` —— 类型/COLS/parseRow/UpsertSkillInput/upsertSkill 带上两列；新增 `hasDistilledSkillForRun`（幂等）。
- `apps/api/src/lib/agent/skillDistill.ts` —— 新模块 `distillSkillFromRun`（门控 + prompt + 解析 + `upsertSkill(enabled:false)`）。
- `apps/api/src/lib/agent/runLifecycle.ts` —— `softComplete` 的 `completed` 块内、`runEpisodicMemory` 之后接上（复用同一 `llm`/`signal`/`stepsForSummary`，仅父 run）。
- `GET /api/agent/skills`（既有）自动透传 `source`，客户端可区分「建议技能」；启用走既有 `PATCH /skills/:id {enabled:true}`。

**验证**：`skillDistill.test.ts`（8 例：蒸馏/skip/门控/软失败不计/幂等/fail-open×2/取消透传）+ `migration.test.ts`（023 列）+
全量 `npm run test -w @xzz/api`（666 例全绿）+ `typecheck` 干净。

**后续（M5）**：mobile「建议技能」评审屏；跨 run 近似技能去重；蒸馏 prompt 调参与启用率观测。
