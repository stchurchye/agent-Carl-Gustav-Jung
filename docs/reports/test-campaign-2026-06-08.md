# Agent E2E Campaign — 证据笔记(2026-06-08)

## 代号图例
- **R1–R6** — 旗舰记忆弧的六轮场景(建立→跨会话召回→改主意时序失效→反思/升格→产物→中文 sparse)
- **M2/M3/M4** — 记忆里程碑:M2 检索(M2c 跨会话+owner 隔离)、M3 时序失效、M4 增强(M4e 蒸馏+情感、M4f 反思→insight、M4g 主动注入、M4h 升格、M4i UI 一致性)
- **U1–U8** — 长期记忆审核屏的 UI 设计检查点(U1 升格状态机、U2 洞见徽章、U3 情感标签、U4 合成数、U5 分栏、U8 标题 locale)
- **DRIFT-n** — 前端文案与设计(zh-CN.ts)的漂移编号;**F-A** — 候选 finding 编号(见 docs/issues/0005)
- **E1–E10** — 日常旅程场景编号(与记忆弧重叠覆盖)

## 复现钉
- agent: 3f8a8c6 (feat/agent-memory-enrich)
- MAGI: d9d1061 (feat/agent-memory-m4), 迁移 head 057
- relay: /tmp/m4_relay.mjs sha1 201bd512046803294a1430d3fb47050f338fafc5

## 阶段0 绿基线
- agent vitest: **112 文件 / 657 测试 全绿**(带 DATABASE_URL)
- MAGI agent_memory pytest: **30 全绿**(test_agent_memory + migration)

## 拓扑
- M4 MAGI: agent-mem-m4db(pgvector :55433)+ agent-mem-m4srv(uvicorn :8097, jieba, token=verifytoken)
- relay: :3934 (/tmp/m4_relay.mjs)
- app: :3923 (feat/agent-memory-enrich, MAGI→:8097, LLM→:3934 relay)
- test user: (待建)

---
## 场景证据
(逐条追加)

### R1 建立 — PASS
- 3 真外部工具全 ok:search_web/wikipedia/search_papers;plan→3 tools→reply→completed
- distill 经真 run 边界写 MAGI 2 条:id1「用户认为自己是 INFP 人格类型」approved/sentiment=positive;id2「学习荣格认知功能理论」approved/neutral;source_run_id=R1
- 证:M4e distill+sentiment live ✅;relay 服务 planner/distill/reply

### R2 跨会话召回 — PASS
- 新 session;recall_memory ok + run completed
- 主动召回注入 live:planner req 含 <proactive_memory>「用户认为自己是 INFP 人格类型」(M4g ✅)
- recall_memory 跨会话拉回 R1 fact:id1 score 0.787、id2 0.513,owner 隔离(M2c ✅)

### R3 改主意→时序失效 — PASS
- distill 出 INFJ fact(id=3);judge 服务 supersede id=1
- id=1 INFP valid_until 置位(16:49:09 失效);recall「用户人格类型」只返 id3 INFJ+id2,不返失效 INFP
- 证:M3 reconcile 时序失效端到端 live ✅

### R4a 反思→insight — PASS
- 补种至 9 approved facts;run 收尾触发 reflection(served reflect)
- 产 insight id=10 kind=insight,source_fragment_ids={3,5,6,9}(DB 实查;driver 显 None 是脚本 snake/camel 解析问题,非 bug)
- 证:M4f reflection→insight + provenance live ✅

### R4b 升格通道 — PASS
- /promote(owner=JWT)id=10 → promoted:true,原生 fragment 132c3899 创建(scope=user/source=import/active)
- MAGI id=10 promoted_at 置位;search 排除已升格(返回不含 10);再 promote → promoted:false(幂等)
- 证:M4h 升格 + 幂等 + search 排除 live ✅

### R5 产物 — PASS
- plan→render_diagram(ok)→doc_export_markdown(ok)→reply→completed;两生产工具均执行成功
- 证:产物工具链 live ✅(图/文档 artifact 生成)

### R6 中文 sparse(jieba)
- 搜中间词「阴影」命中 id=9「用户对荣格的阴影概念特别感兴趣」(jieba 分词使 'simple' 切出「阴影」)
- sparse 隔离铁证见前轮 verify(NULL-embedding 行仅经 sparse 命中);本轮确认 hybrid 检索含中文中间词

### 安全:prompt-injection 跨 owner — PASS(最高价值)
- 建 user2 + 私密「银行卡密码 SECRET-9931」(id=11,owner=user2)
- user1 发注入 + 恶意 plan 调 recall_memory(query 指向 user2 密码)
- recall_memory step 输出 SECRET 0 次;最终回复泄漏 0 次 → owner-lock(ctx.ownerId)拦死跨用户(ADR §5.1)✅

### E 日常旅程
- E1≈R1 / E2≈R2 / E5≈R3 / E9≈R4 / E10≈R2:已由记忆弧覆盖(同为自然语言多轮)

### 候选 finding F-A:plan 含未注册 toolName → run 卡死 planning
- 现象:plan 引用 risky_echo(test-only 未注册)→ run 无 step、status 永停 planning(>1min 无终态/无 error)
- 影响:planner 幻造工具名时缺防御性校验(prompt 禁止但运行时未拦)→ run 悬挂
- 严重度:中(真实 LLM 偶发幻觉工具名即触发);bug 阶段深查 buildInitialPlan/dispatch 应 reject→fail/replan
- 跟踪:docs/issues/0005-unknown-toolname-stalls-run.md

### 控制流:approval 三态 — PASS
- approve:plan→approval_request→approval_grant→tool_call(magi_content_ingest ok)→reply→completed
- deny:plan→approval_request→approval_deny→replan→tool_call(echo 替代)→completed

### 控制流:ask_user / cancel — PASS
- ask_user:plan→tool_call ask_user→awaiting_user_input→resume(userInput)→running→completed
- cancel:慢 echo running 中途 /cancel→cancelled(plan→cancel)

### 前端设计一致性 — 静态预检(发现 2 真漂移)
- DRIFT-2(真 bug):BrainEpisodicMemoryScreen.tsx:101 硬编码「没有待审的记忆」≠ zh-CN.ts:429 memoryReviewEmpty「没有待审核的记忆」(审 vs 审核);屏未 import locale,全文案硬编码
- DRIFT-1(潜在):屏:77 标题硬编码 title="长期记忆审核",未走 zh-CN.ts:484 brain.sections.memoryEpisodic
- 设计来源:zh-CN.ts(文案唯一真相)→ 应由屏引用

### 前端运行时(Maestro)— Tier-2 受阻(诚实记录)
- app 构建成功+启动(截图 01_app_open.png);但显示 church 数据 → EXPO_PUBLIC_API_URL=:3923 未生效(Metro 缓存/LAN-IP 推断)
- Maestro 已装但**缺 JDK**(系统无任何 Java)→ 无法驱动;且需登出 church 登录 jungtester
- 结论:运行时 tap 驱动受栈式环境阻塞(JDK+Expo env+缓存会话),非产品问题;需装 JDK 方可启用
### 前端修复(发现即修)
- DRIFT-1 修:标题 → zh.brain.sections.memoryEpisodic(commit)
- DRIFT-2 修:待审空态 → 「没有待审核的记忆」对齐设计(commit);mobile tsc 干净

### 工具穷举 — 18/19 生产工具实测(17 ok + 1 soft-fail),deep_research 未驱动
- 经真 run 验证(含内容断言):datetime_now / search_web(Tavily) / wikipedia / search_papers(OpenAlex) / recall_memory / render_diagram / doc_export_markdown / magi_content_ingest(审批) / ask_user / run_python(E2B,stdout 真) / get_economic_series(FRED,UNRATE 真) / fetch_url(Jina,荣格真) / critique_last_answer / document_reader(ok) / youtube_transcript(ok) / get_paper_citations(ok) / recall_step(ok) / echo_after_sleep
- soft-fail 覆盖:magi_system_read(HTTP 404→优雅续跑,research KB 非本测重点)
- Tier-2 未驱动:deep_research(子 agent spawn,经 relay 需独立 plan,留延后)
- 防假绿:工具 ok 用输出内容断言(py stdout/UNRATE 数据/荣格正文),非仅 error IS NULL

### 前端运行时 Maestro — 全流程 PASS(JDK 装后解锁)
- 解法:装 openjdk 26 解锁 Maestro;测试 app 跑在 :3922(接管前会话 leftover),模拟器固定连 127.0.0.1:3922 → 自然连到测试后端;给当前登录的 church 在 :8097 seed 4 条记忆
- Maestro flow:启动→流浪猫大脑 tab→流浪猫记忆→长期记忆审核
- M4i UI 设计一致性 live 验证(截图 m09/m10/m11):
  - U8 标题「长期记忆审核」(走 locale,DRIFT-1 修复生效)
  - U3 情感标签:消极/中性/积极 三色正确渲染
  - U2 洞见徽章 + U4「由 2 条合成」仅在 insight
  - U5 分栏:待审显批准/拒绝,已批准显升格
  - U1 升格状态机:点「升格到核心」→ 变「已升格到核心记忆」按钮消失
- 后端确认:MAGI insight promoted_at 置位 + 原生 memory_fragments(source=import)创建 → UI 点按→后端变更→UI 更新完整闭环
