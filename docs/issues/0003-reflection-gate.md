# [0003] Reflection gate:合并两个 critic + Finalize 检查

## Parent
EPIC: 0000-epic-agent-loop-deepening

> 状态:已完成并合并(2026-06-10 核实,commit 0e517a9;reflection.ts + reflection.test.ts,统一收尾决策已落地)。本文其余为历史设计记录。

## What to build
现状有两个互不相识的 critic:`runCritique`(规则 stub,只在"最近4步失败≥2"时驱动重规划,周期路径永远 false)与 `critique_last_answer`(真 LLM 学术 critic,但只能被 plan 当工具调,**没接进重规划闸门**)。

合并为**一个 LLM 兜底的 Reflection 模块**,接口保持 `→ {shouldReplan, adjustment}`,供重规划闸门调用。Reflection 不只看工具失败,还判**答案质量 + 目标是否真完成**;另外在 **Finalize 前**加一道"真的完成了吗?"检查 —— 没完成且 budget 还有,就续跑。

## Acceptance criteria
- [x] 重规划闸门调的是 LLM 兜底的 Reflection(不再只是"≥2失败"规则);一个"没报错但答得不完整/不对"的结果能被送回再续一轮。
- [x] Finalize 前跑"done?"检查;判定未完成且 budget 充足 → 继续而非收尾。(reflectGoalCompletion,runExecute loop 尾)
- [x] 两个旧 critic 合一,无重复 critic 逻辑;复用 `critique_last_answer` 的 critic 提示/逻辑。(在收尾决策层达成;mid-loop ≥2 失败规则 gate 与 critique_last_answer 工具作为 fast-path/工具有意保留,见下「critic 完全合并」)
- [x] **HITL**:Reflection 的接口与决策策略先经人评审,再进 AFK 实现。(多轮 2-finder code-review 记录见下)
- [x] 测试:质量/完整性缺陷时 Reflection 返回 shouldReplan;Finalize 检查能拦住过早收尾。(reflection.test.ts)

## Blocked by
- [0001] 续跑且带观察(Reflection 需要续跑循环 + 观察 scratchpad 才有发挥空间)

---

## 实现进度（MVP,2026-06-03,TDD）

- [x] **reflectGoalCompletion**（新 `reflection.ts`）—— LLM 兜底判"用户目标达成没",返回 `{goalMet, reason}`;解析失败 fail-open(goalMet:true,放行收尾,不卡续跑)。
- [x] **接进收尾 gate**（runExecute loop 尾）—— 机械续跑信号没响时,问 Reflection;`goalMet:false` 且(非子agent/budget足/未达CAP)→ 续跑。`!isTestEnv` 守卫保护现有测试。
- [x] **解 #7**（被 replan 丢掉的 todo）—— 机械信号沉默但 Reflection 从语义判出目标没达成 → 续跑。已测。
- [x] **解 #2b**（跨轮 todo 身份不稳）—— Reflection 读**全历史 finalSteps** 语义判完成,不依赖逐轮 todo。同一机制覆盖。
- [ ] **未做（非 #7/#2b 必需,后续）**：把 `runCritique` 规则 stub 与 `critique_last_answer` 工具**完全合并**进 Reflection(目前 reflectGoalCompletion 只管收尾判完成;mid-loop 的 ≥2 失败 gate 仍是规则 stub)。**[2026-06-10 注:后续已在收尾决策层达成统一,剩余两项为有意保留的 fast-path/工具,见下「critic 完全合并」]**
- ⚠️ **成本/调参点**：Reflection 在每个非测试 run 的收尾 +1 次 LLM 调用;可加"仅当有 tool_call 才跑"的门减少琐碎 run 的开销。效果依赖 LLM 判断质量(误判会多/少续跑,被 CAP=2 限住)。

测试：`reflection.test.ts`（行为1 函数判定 + 行为2 收尾续跑）。425/425 全绿。

### Code-review（reflection 实现后,2 finder）+ 逐条修

高优先关注点验证为非 bug:token 记账正确(resolveLlmClient 已包 cost wrapper)、无限循环有 CAP=2 界、交互顺序对(reflection 只在正常收尾跑)、无 import 环、extra 字段无害。

修的 3 条:
- [x] **#1 取消被误标 'failed'** —— reflection LLM 调用期间取消 → AbortError 漏过 AgentCancelled。**已修**:try/catch 包住 reflection,abort→重抛 AgentCancelled,其它错→fail-open(goalMet:true 正常收尾)。
- [x] **#2 硬失败 tool_error 对 reflection 不可见** —— digest 只 filter tool_call,漏掉重试耗尽的硬失败(最该判没完成的那类)→ 误判 goalMet:true。**已修**:digest 纳入 tool_error + 测试。
- [x] **#3 琐碎 run 也跑 reflection** —— 纯聊天无工具也 +1 调用。**已修**:加 `didToolWork`(有 tool_call/tool_error 才 reflect)门。
- [ ] **#4 slice(-8) 丢早轮成功步骤(低)** —— 多轮长 run 里早轮的成功 step 掉出窗口,reflection 可能误判没完成。被 CAP=2 限住;后续可加摘要/扩窗。
- [ ] **#5 生产路径覆盖窄(smell)** —— in-loop reflection 被 !isTestEnv 守卫,只有 reflection.test(生产 env)走到。behavior-2 确实驱动 executeRun 过了该路径,但覆盖窄。

测试 426/426 全绿,tsc 干净。

### critic 完全合并（选项 A：统一收尾决策,2026-06-03）

- [x] **统一 loop 收尾决策** —— 把"机械续跑块 + reflectGoalCompletion 块"合成**一个决策**:生产+有 LLM 时由 `reflectGoalCompletion` 单点拍板"目标达成没"(它从 finalSteps 含 tool_error 语义判,**同时涵盖**没干完 #7/#2b + 关键步骤失败);test env/无 LLM/无工具回退机械信号。机械信号从"决策者"降为 fallback。
- [x] **统一价值实测** —— 生产里 soft-fail 但 Reflection 判"目标已达成"(失败可恢复)→ 收尾,不再机械盲目续跑。已测。
- [x] **refactor**:合并揭示 `reflectShouldReplan` 冗余(goalMet 已涵盖失败判断)→ 删除,避免死代码。
- [ ] **仍独立(非必需)**:mid-loop 的 ≥2 失败 `runCritique` 规则 gate(作为早弃 fast-path 保留;接 reflection 被 loop 收尾遮蔽,无可观测收益)+ `critique_last_answer` 工具(agent 可调,不同用途)。"完全合并"在**收尾决策层达成**;这两个是 fast-path/工具,非冗余。

reflection.ts = 统一 Reflection 模块(reflectGoalCompletion + 共享 buildStepDigest)。427/427 全绿,tsc 干净。

### Code-review（统一收尾后,2 finder）

无 crash bug。修 1 个不一致 + 几个 nit:
- [x] **fail-open 路径不一致** —— 旧版生产里 reflection **报错→收尾**,但**拿不到 LLM(无 key)→走机械信号可能续跑**(而续跑要 LLM 重规划=空转烧轮数)。统一为:**生产无 working reflection(null 或报错)一律 fail-open 收尾**,机械信号只留 test env。+ 测试(生产无 key → 收尾)。
- [x] nit:`catch (e)` 未用 e → `catch {`;reflection.ts 过时注释("两个 reflect 函数")已删。
- 接受(非 bug):#1 每个生产工具 run +1 reflection 调用 = 解 #7 的既定代价(不能短路否则漏掉"被丢 todo");false-negative 误续跑被 CAP=2 限住。

reflection 测试 5 个,428/428 全绿,tsc 干净。
