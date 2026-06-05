# CONTEXT — 领域术语表

> 架构 review / grilling 过程中固化的领域词汇。命名深化模块时优先复用这里的词,
> 不要漂移成 "service / handler / component"。架构词汇(module/seam/depth…)见 skill 的 LANGUAGE.md。

## Agent 运行时(apps/api/src/lib/agent/)

- **Agent Loop** — 把"执行一步 → 观察 → 决定下一步/重想/收尾/暂停"收进一处的深模块。取代现状中散落在 `runExecute.ts` 主循环 + 4 个外部重规划触发(merge / critique / deny / steer)的浅结构。接口即一个决策点 `next(state, lastObservation) → Decision`。

- **ReAct step(react 步)** — Agent Loop 的一次迭代:大脑一次 LLM 调用,产出 `{thought, action}`,执行一个动作,得到一条 observation,再进入下一次 `next()`。**粒度(修订后,分阶段)**:Phase 1 不按步触发,锚在 **[[continuation-replan]]** 这个明确信号上;**纯 ReAct(每步一次 LLM)是 Phase 2 终态**,验证收益+延迟可接受后再上。理由见末尾「Review 修正」。

- **continuation-replan(续跑重规划)** — Phase 1 的核心触发。现状:`plan.steps` 跑完但 todos 仍有未完成时,直接 `softComplete('completed')` 不续。改为:**plan 耗尽 + 还有未完成 todo → 触发一次"带观察"的重规划继续**。优点:① 以 plan 边界为界、**不按步触发**,无成本爆炸;② 信号明确("目标没达成 + 计划用完"),**不需要"观察有没有信息量"那种模糊启发式**;③ 天然给出 observe-then-act 的务实版(规划一批→执行→没完就带着学到的再规划)。配 **[[stall guard]]** 限续跑轮数防死循环。
  - **关键**:续跑重规划时,重建 prompt 必须带上**已完成的 todo + 已跑过的步骤摘要**,让新计划**接着干、不重做**已完成的活。
  - 注:它只在 plan **已耗尽(空)**时触发,所以现状"重规划整盘清空 plan"(`runExecuteHelpers.ts:112`)的浪费问题**不适用** —— 没有剩余步骤可丢。

- **next() / 决策点** — Agent Loop 的唯一接口。输入:goal(inputText)+ 轨迹引用 + merged_inputs + budget + lastObservation。输出之一:`Act(action)` / `Replan(reason)` / `Finalize` / `Pause(approval|ask_user)`。现状的 planner + critique 在这里合流。

- **trace store(轨迹存储)** — 候选 C 并入 A 后的形态。**Phase 1:滚动摘要(scratchpad)** —— 最近 K 步原文 + 老步骤压缩,够用且简单(避免 recall 的鸡生蛋成本)。**Phase 2(扩展时):观察存外 + 按需召回** —— 工具输出留 `agent_steps.output`,大脑只看短引用(沿用 `summarizeStepOutput`),调 `recall` 拉全文。带可换的检索 adapter seam。

- **recall(stepId)** — meta 工具。让大脑把某条只看到短引用的 observation 拉回全文。与 deep_research / ask_user 同类(框架级工具,不是业务工具)。

- **living plan(活计划)** — 纯 ReAct 没有前置整盘 plan,但 UI 仍要展示 todos 卡片。解法:大脑每个 react step 顺带吐一份更新后的 todo 列表,`plan` 从"一次性产物"变成"逐步修订的快照"。

- **Reflection gate(反思闸门)** — 候选 B。现状是两个互不相识的 critic:`runCritique`(规则 stub,驱动重规划)与 `critique_last_answer`(真 LLM critic,没接线)。合并为一个由 LLM 兜底的 `Reflection`,接口保持 `→ {shouldReplan, adjustment}`。纯 ReAct 下,大脑每步天然反思,Reflection 主要作为 **Finalize 前"真完成了吗"** 的显式检查。

- **stall guard(停滞防呆)** — 防"原地打转无进展"。**两处都用**:Phase 1 限 [[continuation-replan]] 的续跑轮数(如最多续 N 次);Phase 2 限纯 ReAct 反复 Act。统一靠 budget 硬顶(maxSteps=20 / 600s / 100k tokens)+ "无进展"检测(如同 tool+input 重复、或续跑后 todo 完成数没增加)兜底。

## Agent 记忆(memory 子系统 + MAGI 后端)

- **核心个人记忆(core personal memory)** — "用户是谁 + top 偏好"这类**高频、必需、轻量**的记忆。承载体是**原生** `memory_fragments`(已 always-on 注入、按 `owner_id` 天然隔离、零外部依赖)。每轮无条件进 systemPrompt(`contextAdapter` 注入点)。**不迁移、不外包**。

- **情景/语义记忆(episodic/semantic memory)** — "聊过什么 / 学到什么"的**大历史、按需召回**的记忆。承载体是 **MAGI-System**(bge 向量 + hybrid 检索 + 时序失效 + 可视化审核)。**按需**检索,不无条件注入。与「核心个人记忆」是两层、分工不重叠。

- **情景蒸馏(episodic distillation)** — run/会话收尾时,**独立于**原生 autoExtract 的第二条蒸馏路径,专抽原生 extractor 丢弃的[[情景/语义记忆]](讨论过的领域事实、学到的东西)→ 写 MAGI。原生 autoExtract 原样不动(只抽[[核心个人记忆]])。两路各自 prompt、各自阈值,互不串味(纯 additive)。复用 `salvageMemoriesBeforeCompact` 的边界触发时机。
  - **双写判别线 = 两轴(主体 × 稳定性)**:`关于用户本人` **且** `稳定/长期常驻值得`(身份、持久偏好、习惯)→ 原生 always-on 核心;**其余一切**(世界/工作/领域事实 + **个人日常事件**如"上周面试了 X""今天在调 Y")→ MAGI。**注意**:个人日常记忆**主要进 MAGI**,不是原生——因为原生是**有界 always-on 小核心**(硬 token 预算,仿 Hermes USER.md),装不下累积的日常流水;日常事件时间相关、会累积,塞 always-on 会撑爆注入预算。情景蒸馏 prompt:抽"非稳定核心"的一切值得记的。
  - **升格通道**:日常事件若反复出现、硬化成稳定偏好("最近在减肥"→"我吃素"),反思阶段(后置增量)再从 MAGI 升格进原生核心。
  - **不对称安全默认**:拿不准 → 默认 MAGI。MAGI 按需召回、owner 隔离,误分只多一次 recall(低危);误进原生会污染 always-on 注入预算(每轮吃)。错往安全侧错。

- **recall_memory(query)** — meta 工具。让大脑**按需**召回[[情景/语义记忆]](MAGI 的 agent_memory 表,bge 语义 + hybrid,owner 隔离)。与 [[recall]](stepId)、magi_system_read 同类(框架级工具)。**与 magi_system_read 不混**:后者打研究知识库(psychology 等 domain),recall_memory 打 agent 自己的情景记忆表。MAGI 情景层**不 always-on 预取**(原生核心记忆才 always-on);大脑刻意召回时才打,热路径零额外开销。漏调风险靠 planner prompt 显式描述缓解。

- **质量门(quality gate / 防脏)** — 情景蒸馏是 LLM 抽取,可能出错 fact。`agent_memory_fragment` 加 `status`(pending/approved/rejected,同 MAGI Fragment.status / 原生 memory status 模型):高置信(≥0.85)→ 直接 approved;低置信/被 flag → pending 等人工审。`recall_memory` 的 search 端点**只返 approved**(一行 `WHERE status='approved'`)。**不用第二个库**:脏→审→净是生命周期(status 字段),不是位置(搬表)。审核 UI 后续复用 MAGI review_queue + Next 前端(非 MVP)。**MAGI 自己书籍提取的脏 draft 数据污染不到这里**——独立表 + 自己的 search 端点,物理够不到 `fragments` 表。

- **时序失效(temporal invalidation)** — "记住且会更新"的机制。一条[[情景/语义记忆]]存成**自由文本 fact + embedding + valid_until**。写入新 fact 时对**同 owner** 做语义近邻搜 → LLM 判新 fact 是否取代某条旧的 → 旧行 `valid_until=now`(**不删**,保留时序);检索只取 `valid_until IS NULL`。**自建**在 agent_memory 表上(MAGI 现成的 contradiction 检测绑死 fragments/concepts + 为知识库审稿设计,形状不对、否复用)。

- **记忆后端职责切分(B vs C → 定 C)** — 裁决:不把 agent 记忆全搬 MAGI(B),而是**两层分工**(C)。原生承载[[核心个人记忆]],MAGI 承载[[情景/语义记忆]]。理由:原生子系统已比预期成熟(always-on 注入 + autoExtract + consolidate 自动巩固已在跑 + scopeAuth 天然 owner 隔离),硬实力只缺"大历史语义召回"——正好 MAGI 的强项。让 MAGI 只补这一件,避免赌 MAGI 多租户改造、避免废弃已工作的原生逻辑。

## 不可动的约束(necessarily fixed)

- **topic coordination / merged_inputs**(M7 并发:合并/排队/出队)—— 变成 `next()` 的输入,不丢。
- **暂停语义**:approval、ask_user 仍能挂起 run → `Pause`。
- **worker pickup**:状态机驱动 re-execute 的模型不变。

## 落地策略(修订后)

- **Phase 1:增量 · 触发 = continuation-replan**。在 `runExecute.ts` 主循环末尾(plan 耗尽处)加判断:todos 未完 → 进 replanning 续跑;重规划 prompt 带上 observation(scratchpad)。plan-once 仍是骨架。
  - **范围如实**(非单文件):① `runExecute.ts` 加续跑触发 + 续跑轮数上限;② `runPlanGlue.ts`/`planner.ts` 把 observation 喂进重规划 prompt;③ scratchpad 装配;④ **碰 M7 邻接代码** —— 续跑触发与 merge 共用 `applyReplanningIfNeeded`/`status='replanning'`,必须保证不污染 `merged_inputs_consumed_count`、不和 merge 双触发。
  - RED→GREEN:每个新触发 + 续跑上限各一个测试;M7 G1/G2 实测复跑确认 consumed_count 记账没乱。
- **Phase 2(若 Phase 1 验证收益够):flag 开关共存**。给 run 加 `mode: plan_once | react`,纯 ReAct 藏 flag 后,两循环共存,现有测试/M7 不动,新循环 opt-in。**放弃"直接替换"** —— 见下「Review 修正」。

## Review 修正(为什么从激进退到务实)

grilling 时每个岔路口都选了最激进项(纯 ReAct / 存外召回 / 直接替换),事后 review 发现三处风险:① 纯 ReAct = ~10× LLM 调用,群聊单 run 可能 60–100s,砸响应性;② 520 个测试为 plan-once 写死步骤结构,"直接替换"会让一大批测试因架构形状变化而红,"测试网"有洞;③ M7 的 merged_inputs_consumed_count 记账紧贴 plan-once 重规划模型,ReAct 下"消费一条追问"语义对不上。**结论:先做 Phase 1 增量(拿 ~80% observe-then-act 收益、1/10 风险),纯 ReAct 终态留作 Phase 2 且先 `prototype` 验延迟再上。**

二次 review 又修了 Phase 1 自身的两个洞:① 原"观察有信息量时重规划"是个没设计的模糊启发式(判断信息量本身就得问 LLM,循环依赖)→ 改锚到 **continuation-replan** 这个明确信号(plan 耗尽 + todo 未完);② "M7 管线不动"太干净 —— 续跑触发与 merge 共用同一套重规划机制,如实标为"碰 M7 邻接代码",范围从"单文件"修正为 ~3–4 文件 + 必须复跑 M7 实测验记账。
