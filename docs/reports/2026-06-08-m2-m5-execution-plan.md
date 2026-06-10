# 开发排期计划 · agent-Carl-Gustav-Jung(M2–M5)

> 基于**对抗核验后**的真实情况。四项 analysis 的 `overallSound` 均为 true,但有若干 **fresh-explore 的措辞/引用被推翻或修正**,已在下文显式标注并据此调整排期。

---

## 0. 核验推翻 / 修正的关键判断(影响排期)

| # | fresh-explore 原判断 | 核验结论 | 对计划的影响 |
|---|---|---|---|
| R1 | M2「藏 mode flag」暗示脚手架已预留 | **推翻**。`mode/plan_once/react` 全仓 0 命中,`types.ts`/schema/env 全无,`exists=false`,从 0 开始 | M2 不是「填坑」而是「从零建」。但首切片是 throwaway,**不动这些**——脚手架成本推迟到 go 之后 |
| R2 | M2 prototype 脚本放 `apps/api/scripts/react-latency-prototype.ts` | **修正**。该目录不存在;仓库约定是 `apps/api/src/scripts/`(实测含 `llmSpike.ts`/`seed.ts`)或根 `./scripts/` | 脚本落 `apps/api/src/scripts/`,否则新建非常规目录 |
| R3 | M3 白名单是 enforcement | **修正/收紧**。白名单**仅 planner-time 软约束**;`runExecute` 执行前**零** parentRunId/role/whitelist 校验(grep=0) | M3 第一切片**必须是安全前置**(exec-time 护栏),不是 role 泛化。这是最高风险项 |
| R4 | M4「MCP 多 transport」 | **存疑/需澄清**。仓库内 `2026-05-22-agent-runtime-m4.md` 的 M4 是任务面板/cost/SSE,**与本路线图项不是同一个 M4**;且该 spec 把 MCP client **显式 defer**(`m4-design.md:26 ❌ MCP client adapter——留后续`) | M4 命名冲突 = **排期前需 owner 澄清优先级与归属**,否则可能做了非当期里程碑。**[2026-06-10 已澄清]** 本期 M4=MCP 多 transport,已落地(PR #18/#19,httpTransport + registerFromConfig);2026-05-22 旧 spec 的「M4 任务面板」是另一里程碑的旧编号 |
| R5 | M4「MCP server 侧」(暴露本项目为 MCP server) | **价值存疑**。需 hono endpoint + 鉴权 + 只读子集,工作量/收益不成比例 | 明确**划出 scope**,本期不做 |
| R6 | M5 `navigateBrainTab` 在 `navigation/navigateBrain.ts` | **修正**。实际在 `apps/mobile/src/lib/navigateBrain.ts`;`BrainStackParamList` 才在 `navigation/types.ts:30` | 新屏作者按修正路径找 helper,避免空转 |
| R7 | M5 技能 PATCH/DELETE 挂 `/api/agent/skills` | **修正**。带 path param:`/api/agent/skills/:id`。前端 `patchSkill/deleteSkill` 须拼 `:id` | 前端 api 方法别误当无 id 集合端点 |
| R8 | M2 budget「maxSteps 兜得住」 | **确认风险**。`applyReplanningIfNeeded` reset `usage.steps=0`,maxSteps 兜不住;plan-once 靠 `CONTINUATION_ROUND_CAP=2` 显式封顶 | react 循环**必须自带步数硬顶**,不能复用 maxSteps |

---

## 1. 推荐执行顺序(及理由)

```
[阶段 0 · 解阻塞]  M4 归属澄清(owner 决策,非编码)         ── 并行,不挡别的
                   [2026-06-10 已澄清] 本期 M4=MCP 多 transport,已落地(PR #18/#19)
[阶段 1 · 安全地基] M3-S0  exec-time 工具护栏              ── 先做,堵已存在的越权洞
[阶段 2 · 探测]     M2-S0  react 延迟 prototype(go/no-go) ── 纯探针,产数字
[阶段 3 · 高价值]   M5-S1  建议技能评审屏                  ── 后端已就绪,纯 mobile,价值高风险低
[阶段 4 · 分叉]
   ├─ if M2=go:  M2-S1  react 共存落地(TDD)
   ├─ M3-S1+:    AgentRole 泛化 + spawn_subagent
   └─ if M4=go:  M4-S1  Transport 帧层抽象
```

**为什么是这个序:**

1. **M3-S0(安全护栏)排第一,先于一切 role 工作**:核验确认这是一个**当前就存在**的 defense-in-depth 洞(R3)——白名单只在 planner-time 生效,续跑/steer/缓存 plan 可绕过裁剪让子 run 执行越权工具(含有副作用的 `run_python`/`deep_research`)。它**不依赖任何 role 泛化**、可独立交付独立回归,且是 M3 后续所有切片的安全前提。低成本、高价值、解未来阻塞 → 第一。

2. **M2「先测延迟」是 0000 的硬性前置,必须显式排在任何 react 共存代码之前**(R8 + 核验 confirmed):0000 明文「上之前先估算延迟…卡临界再 prototype 实测…放弃直接替换核心循环」。prototype 是 **go/no-go gate**,产出可能是「不做 react 共存」。把它放在 M3-S0 之后:因为它是纯 throwaway 脚本、零生产改动、零回归面,可与 M5 并行,但**不能跳过直接写共存逻辑**。

3. **M5-S1 排在价值交付位**:后端两条链路(技能蒸馏→评审 CRUD、记忆升格)**均已真实就绪**,缺口全在 mobile + 一小段 api 客户端方法。纯增量、风险低、用户可见价值高、不挡任何后端演进 → 高优先。

4. **M4 归属澄清(阶段 0)是非编码解阻塞项,并行启动**:R4 命名冲突未解前不该投入 MCP 编码,否则可能做了非当期里程碑。这一步是 owner 决策,不占工程带宽。

5. **阶段 4 三条线可并行**(M2-S1 取决于 prototype、M3-S1 取决于 S0 已合、M4-S1 取决于澄清=go),互不阻塞,按团队带宽铺开。

---

## 2. 每项明细

### M2 · ReAct Phase-2 原型
- **一句话目标**:用 throwaway 脚本实测 react(每步一次 LLM)延迟,产出 go/no-go,替代 0000 的 15-30s 粗估。
- **核验后现状**:主循环是 plan-once + continuation-replan(`runPlanGlue.ts:127`→`planner.ts:173` 单次 LLM 出 N 步;`runExecute.ts:182` 顺序执行,步内不调 LLM)。`mode` flag **完全不存在,从 0 开始**(R1)。延迟测量基建**已就位**:`agent_steps.duration_ms` 列 + `recordStep` 已落 tool_call 时长;只缺给 planner LLM 往返单独计时。
- **最小首切片(PR 级)**:`apps/api/src/scripts/react-latency-prototype.ts`(**注意路径修正 R2**)。手搓最小 react 小循环,`import` 现有 `toolRegistry` + `resolveLlmClient` + planner,对 3-5 个代表任务(单步/多步/带工具失败)各跑数次,打印端到端 p50/p95、每步 planner-LLM 往返、总步数、tokens/cost,并与 plan-once 同任务对比。**零生产代码改动**。产 go/no-go + findings(直接作 PR 描述,不写 .md 报告)。
- **关键风险/前置**:① 达标阈值未定(0000 只有粗估)——**落地探测前需 owner 给多步任务可接受上限**,否则测完无法判 go/no-go。② 固定 provider/model(`deepseek|zenmux`)并记录,否则数字不可比。③ react 循环**必须自带步数硬顶**(R8)。④ prototype 阶段**绝不碰** `runExecute`/worker/`agent_runs`。
- **工作量**:**M**(脚本 S,但代表任务设计 + 多轮实测 + 对比抬到 M)。

### M3 · 通用子 agent 角色化
- **一句话目标**:把固定 generalist + 单一 deep_research + 单一全局白名单,泛化成「可指定 role + per-role 工具子集 + 通用 spawn_subagent」。
- **核验后现状**:底座就位(`childExecutor` 并发池、`deepResearch` spawn 入口、`SUBAGENT_TOOL_WHITELIST` 9 工具、`AgentRole='generalist'` 单值 union + DB 列无 CHECK + store 已参数化),但**写入端恒传 `generalist`**(`runLifecycle.ts:125` 硬编码)。**关键(R3)**:白名单仅 planner-time 生效,`runExecute` 执行前**无任何** parentRunId/role/whitelist 校验。**[已落地 f2a0237]** M3-S0 exec-time 护栏已合入(runExecute.ts:243-256,测试 runtime.subagentGuard.test.ts),此「零校验」表述已成历史。
- **最小首切片(PR 级)= 切片 0 安全前置(不引入任何新 role)**:在 `runExecute.ts` 执行循环、`tool.handler` 调用前补**exec-time 工具护栏**——若 `run.parentRunId` 非空且 `planStep.toolName ∉ SUBAGENT_TOOL_WHITELIST`,写 tool_error/deny step 并跳过(复用 `approvalMode==='never'` 现成跳过路径)。把白名单从软约束升级为硬约束。文件:`runExecute.ts`、`subagentTools.ts`、`__tests__/`。
- **关键风险/前置**:① **最高风险=运行期越权**(本切片正是为堵它)。② 递归 spawn 语义未定(`deepResearch.ts:58` 当前 parentRunId 一刀切硬禁)——泛化前要定是否允许 N 层。③ role→工具子集**产品清单缺**:除 generalist 外没有第二个 role,「泛化」目前是空壳,**落地 role 前需产品给至少一个真实 role + 工具差异**。④ 子 run token/成本是否回算父 budget **未核实**(保持开放)。⑤ `planner.ts:104 role?:string` 与 `AgentRole` union 类型不一致,泛化时收紧。
- **工作量**:**L**(S0 护栏本身 S/M;完整 role 泛化 + spawn_subagent + 双层递归护栏抬到 L)。

### M4 · MCP 扩展(多 transport)

> **[2026-06-10 已澄清]** 本期 M4=MCP 多 transport,已落地(PR #18/#19:`apps/api/src/lib/agent/mcp/` httpTransport + registerFromConfig,测试 mcp.httpTransport.test.ts / mcp.registerFromConfig.test.ts)。下文「核验后现状」为 2026-06-08 时点的历史判断。

- **一句话目标**:在现有最小 stdio MCP client 之外支持第二种 transport(SSE/HTTP),且生产可接线。
- **核验后现状**:只有最小 stdio client 骨架,**生产零接线**(`registerMcpServer`/`McpStdioClient` 生产调用方=0,仅测试)。**无独立 Transport 抽象**(`McpClient` 把传输与 MCP 语义耦在一起)、**无 initialize 握手**、无 SSE/HTTP、无 `@modelcontextprotocol/sdk`、无 config 入口。`MCP_HANDSHAKE_FAILED` notice 两侧声明但**从不 emit(死代码)**。`fetchUrl` 无 SSRF 防护,**无现成出网安全层可复用**。
- **最小首切片(PR 级)**:**先抽 Transport 帧层接口,不加新 transport**。把 `McpStdioClient` 的 JSON-RPC 帧逻辑(nextId/pending map/sendRequest/abort/close)抽成 transport-agnostic 的 `McpTransport`(`request(method,params,signal)` + `close()`),`McpStdioClient` 改为基于它实现。**零行为变更**,现有 `stdioTransport.test.ts` + `_demoEchoServer.mjs` 作回归网,新增 mock-transport 单测。
- **关键风险/前置**:① **(R4)归属冲突未解前不开工**——先 owner 澄清本「M4」指哪个里程碑、当期优先级。② 强烈建议引 `@modelcontextprotocol/sdk`(自写 SSE/HTTP 帧层+握手易错)——先确认依赖政策/体积。③ **(R5)** MCP server 侧(暴露本项目)**划出 scope,本期不做**。④ SSRF allowlist 是真实安全面;⑤ `toolRegistry` 全局单例「注册即永久」,per-user/per-server 动态注册需先想清生命周期;⑥ 实测 api 进程能否外连 MCP endpoint(curl/fetch smoke)。
- **工作量**:**L**(帧层抽象 S/M;真正多 transport + SDK 迁移 + SSRF + 接线抬到 L)。

### M5 · 技能·记忆升格闭环 + 评审 UI
- **一句话目标**:给 mobile 加「建议技能评审」屏,让 auto_distilled 的 disabled 建议技能可被审阅/启用/忽略。
- **核验后现状**:后端**两条链路均真实就绪**——技能蒸馏 `upsertSkill({enabled:false, source:'auto_distilled'})`(`skillDistill.ts:141-151`)+ CRUD 路由 `/api/agent/skills`(GET/POST + `PATCH/DELETE /:id`,R7)、`listOwnSkills` 不按 enabled 过滤(disabled 建议技能会一并返回);记忆升格 `promoteMemoryToNative` + `POST /api/agent-memory/promote` 已上线,`BrainEpisodicMemoryScreen` 已是上线的情景记忆评审屏(可作模板)。**mobile 技能屏/路由/api 方法/locale 完全不存在**(grep=0)。**[已实现 25cb797]** M5-S1 已落地:apps/mobile/src/screens/brain/BrainSkillReviewScreen.tsx + 测试,此「完全不存在」表述已成历史。
- **最小首切片(PR 级)**:`BrainSkillReviewScreen` —— 复用 episodic 屏卡片结构,调新增 `api.listSkills()`,前端按 `source==='auto_distilled'` 分「待评审(enabled=false)」/「已启用」两组,每条给「启用」(PATCH enabled=true)/「忽略」(DELETE)。登记 `BrainStackParamList` + `BrainStack`,Hub `SECONDARY_ROUTES` 加入口。后端零改;仅 `api.ts` 补 `listSkills/patchSkill/deleteSkill`(**拼 `:id`,R7**)+ `TopicSkill` 前端 type。
- **关键风险/前置**:① **别强求后端聚合**技能+记忆为「一个面」——撞两套 owner/decide 语义,范围爆炸;**先两屏并列、后合并**。② 散色铁律:**别照抄 `BrainEpisodicMemoryScreen` 的 `#d9534f`**,reject 用 `colors.danger`。③ 深链铁律:登记 `BrainStackParamList`、用 `navigateBrainTab`(**helper 在 `apps/mobile/src/lib/navigateBrain.ts`**,R6),不裸 navigate。④ auto_distilled 与手写技能同流,前端必须用 source 字段正确区分。⑤ locale 进 `zh-CN.ts`(`zh.brain.sections.skillReview`)。⑥「忽略」语义:当前后端只有物理 DELETE,无 `dismissed` 状态(可能重复打扰)——首切片接受,记为 open question。
- **工作量**:**M**。

---

## 3. 跨项依赖图(谁挡谁)

```
[owner: M4 归属澄清] ──blocks──> M4-S1(帧层抽象)──blocks──> M4-S2(SSE/HTTP + SDK + 接线)
[owner: M2 延迟阈值] ──blocks──> M2-S0(prototype 判 go/no-go)──gate──> M2-S1(react 共存落地)
[product: 第二个 role 清单] ──blocks──> M3-S1(role 泛化)

M3-S0(exec-time 护栏) ──blocks──> M3-S1(role 泛化 / spawn_subagent)   ★安全前置
M2-S0(prototype)       ──go/no-go gate──> M2-S1                          ★可能 no-go=不落地
M5-S1(技能评审屏)      ── 无上游依赖(后端就绪)，不挡任何人 ──

跨项:四个里程碑工程上相互独立。唯一隐性耦合 —— M2-S1 与 M3-S1
若都要进生产 runExecute,会争用同一段 for 循环(:182-486),
需串行或在 review 时显式协调(避免 react 分叉与 role 护栏互相回归)。
```

**关键链**:`M3-S0` 是唯一一个「内部硬阻塞」(挡 M3 后续);`M2-S0`/`M4-S1` 是「gate/解阻塞型」;`M5-S1` 是叶子节点(可任意时刻插入)。

---

## 4. 总体风险登记

| ID | 风险 | 来源 | 等级 | 缓解 |
|---|---|---|---|---|
| RISK-1 | **子 run 运行期越权**:白名单仅 planner-time,`runExecute` 无 exec-time 校验;续跑/steer/缓存 plan 可绕过执行有副作用工具 | R3(核验 confirmed) | **高** | M3-S0 第一切片即堵;TDD 断言越权工具被跳过且 handler 未调用 |
| RISK-2 | **react 落地误以为脚手架已预留**(fresh-explore 措辞「藏 flag」),实际从 0;若不先测延迟直接落地,多步任务可能慢到不可用 | R1 + 0000 前置 | 高 | 强制 M2-S0 prototype 先行;阈值未定前不进 S1 |
| RISK-3 | **M4 命名冲突**:本「M4」≠ 仓库 `2026-05-22-agent-runtime-m4.md`,且该 spec 显式 defer MCP | R4 | 中-高 | 阶段 0 owner 澄清归属 + 当期优先级,**未澄清不开工** |
| RISK-4 | **react budget 兜底**:`applyReplanningIfNeeded` reset `usage.steps=0`,maxSteps 兜不住;react 无独立步数硬顶会烧到 maxTokens | R8 | 高 | react 循环自带步数硬顶(prototype 与落地都要) |
| RISK-5 | **M3 role 是空壳**:除 generalist 无第二个 role,无工具差异清单 | M3 prereq | 中 | role 泛化前要产品给 ≥1 真实 role + 工具子集差异 |
| RISK-6 | **递归 spawn 失控**:若 spawn_subagent 进某 role 工具集而护栏只靠 handler if,子 agent 无限 spawn 打满并发池(3)+ 预算放大 | M3 risk | 中 | 双层护栏(工具集不含 spawn + exec-time 校验),不只靠 `deepResearch.ts:58` if。**[执行期护栏已落地 f2a0237,残余=深度上限纵深,见 P0-S8]** |
| RISK-7 | **M5 范围爆炸**:强求后端聚合「一个评审面」撞两套 owner/decide 语义 | M5 risk | 中 | 拆成先两屏并列、后合并 |
| RISK-8 | **散色/深链铁律回归**:照抄 episodic 屏带进 `#d9534f`、裸 navigate | M5 prereq | 低 | review 卡令牌(`colors.danger`)+ `navigateBrainTab`(`lib/navigateBrain.ts`) |
| RISK-9 | **子 run usage 不回算父 budget**(deep_research 现状未核实);role 化多子 run 会放大成本 | M3 openQ | 中(未验) | 落地前核实父 budget 扣减策略,保持 open |
| RISK-10 | **路径/行号微偏**(prototype 脚本目录、`navigateBrainTab` 路径、PATCH `:id`)导致作者空转 | R2/R6/R7 | 低 | 已在各切片用修正后路径标注 |

---

## 5. 建议的下一步(具体到第一个 PR + 第一切片)

**先开 PR:`M3-S0 · exec-time 子 agent 工具护栏`**(理由:堵一个当前就存在的安全洞,低成本、解 M3 后续阻塞、零 role 依赖)。

**第一切片具体做什么(TDD,遵守 always-TDD + code-review-after-every-step):**
1. **红**:在 `runExecute` 测试里构造 `parentRunId` 非空的子 run,塞一个含越权工具(`run_python` 或 `deep_research`)的 plan step;断言该步被跳过/记 tool_error 且 `tool.handler` 未被调用(spy);再断言白名单工具正常执行。复用 `__tests__/tools.deepResearch.test.ts` / `planner.subagent.test.ts` 同款 in-memory store + tool spy 脚手架。
2. **绿**:在 `runExecute.ts` `tool.handler` 调用前插入护栏:`run.parentRunId && !SUBAGENT_TOOL_WHITELIST.has(planStep.toolName)` → 走现成 `approvalMode==='never'` 跳过路径,记 deny/tool_error step。
3. **重构 + `/code-review`**:只修验证为真的问题;确认 `mode=plan_once`(即非 subagent)路径零回归——现有全部 `runExecute` 测试必须全绿。

**并行启动(非编码,解阻塞):**
- 向 owner 抛两个决策问题:**(a)** M4 归属——本「MCP 多 transport」是否当期里程碑、与 `agent-runtime-m4`(任务面板/cost)的优先级关系;**(b)** M2 react 延迟**达标阈值**(尤其多步任务可接受上限),否则 prototype 测完无法判 go/no-go。

**M3-S0 合入后**,按团队带宽并行铺开:`M2-S0` prototype(阈值到位后)→ `M5-S1` 技能评审屏(随时可插)→ `M4-S1` 帧层抽象(归属=go 后)。

---

相关文件路径(均绝对):
- 0000 前置:`/Users/church/claude/agent-Carl-Gustav-Jung/docs/issues/0000-epic-agent-loop-deepening.md`
- M2 prototype 落点(修正):`/Users/church/claude/agent-Carl-Gustav-Jung/apps/api/src/scripts/react-latency-prototype.ts`
- M3-S0 护栏:`/Users/church/claude/agent-Carl-Gustav-Jung/apps/api/src/lib/agent/runExecute.ts` · `/Users/church/claude/agent-Carl-Gustav-Jung/apps/api/src/lib/agent/subagentTools.ts`
- M4 帧层:`/Users/church/claude/agent-Carl-Gustav-Jung/apps/api/src/lib/agent/mcp/stdioTransport.ts` · `/Users/church/claude/agent-Carl-Gustav-Jung/apps/api/src/lib/agent/mcp/types.ts`
- M5 新屏:`/Users/church/claude/agent-Carl-Gustav-Jung/apps/mobile/src/screens/brain/BrainSkillReviewScreen.tsx` · navigateBrainTab helper 在 `/Users/church/claude/agent-Carl-Gustav-Jung/apps/mobile/src/lib/navigateBrain.ts`(修正)