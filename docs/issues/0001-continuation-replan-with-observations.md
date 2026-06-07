# [0001] 续跑且带观察(continuation-replan + scratchpad)

## Parent
EPIC: 0000-epic-agent-loop-deepening

## What to build
当一个 agent run 的 plan 全部跑完(steps 耗尽)、但仍有未完成的 todo 时,agent **再进一轮重规划继续**,而不是早早 `softComplete('completed')`。这一轮的重规划 prompt 带上:① 已完成的 todo / 已跑过步骤的标记(让新计划**接着干、不重做**);② 前序工具观察的**滚动摘要**(复用现有 `summarizeStepOutput`),让续跑是"带着学到的东西"规划的。

效果:运行时从"规划一次、步数用完就收尾"变为"规划一批 → 执行 → 目标没达成就带观察续规划",即 observe-then-act 的务实版(CONTEXT.md 的 continuation-replan)。这是整个 epic 的拱心石。

## Acceptance criteria
- [ ] 一个首版 plan 覆盖不全的多段请求,现在能通过续跑把剩余 todo 完成(用中继测试台实测验证,见记忆 agent-llm-relay-test-harness)。
- [ ] 续跑重规划 prompt 含"前序观察滚动摘要 + 已完成 todo";新计划**不重做**已完成的活。
- [ ] **M7 不受影响**:G1 合并、G2 排队/出队实测仍通过;`merged_inputs_consumed_count` 记账不被污染;续跑触发**不与 merge 触发的重规划双触发**。
- [ ] 受现有 budget(maxSteps/maxSeconds/maxTokens)兜底,即使在 0002 的智能停之前也不会无限续跑。
- [ ] RED→GREEN:测试"plan 耗尽 + todo 未完 → 续跑一轮";测试"已完成 todo 不重做"。

## Blocked by
None - can start immediately

---

## Code-review 待办（B1/B2/B3 实现后,2 个 finder 确认;#1 已修,其余待跟进）

- [x] **#1 续跑无上限(严重)** —— `applyReplanningIfNeeded` 每轮重置 `usage.steps=0`,maxSteps 兜不住续跑循环;确定性 soft-fail 工具会续跑到 maxSeconds/maxTokens 烧完。**已修**:加 `CONTINUATION_ROUND_CAP=2` 硬上限 + 测试。
- [ ] **#2 B3 在生产路径未生效(高)** —— 真实路径 `applyReplanningIfNeeded` 先清 `todos=[]`/`plan=null` 再调 `buildInitialPlan`,故"已完成 todo"段**永远空**(只有观察经 steps 幸存)。`runPlanGlue.progress.test.ts` 直调 buildInitialPlan 绕过了这步,**给了假信心**。修:跨 replan 保留已完成 todo 上下文,并让测试走 executeRun→re-pickup 真实路径。
- [ ] **#3 续跑 replan 被误分类(中)** —— `applyReplanningIfNeeded` 把 `reason='continuation'` 当 `critique_or_unspecified`,每轮多写一条幻影 replan step。修:在 helper 里识别 `continuation` reason。
- [ ] **#4 进展段泄漏到其它 replan(中)** —— `buildInitialPlan` 对所有清 plan 的 replan(critique/merge)都拼"# 已完成进展",可能诱导 LLM 保留 critique 本想放弃的工作。修:进展段只在 continuation replan 时拼。
- [ ] **#5 never-审批工具的 todo 永不完成(中)** —— `approvalMode='never'` 的 step 被拒但不标 todo 完成 → 永远"未完成",会武装续跑(现已被 CAP 兜住,但仍是噪声源)。修:被拒/不可执行的 todo 单独标记,排除出 attempted-unfinished。

### Code-review 第二轮(cap 修复后,新发现)

- [ ] **#6 撞 cap 后标成 'completed'(高)** —— hasUnfinishedAttempted&&hadSoftFail 仍 true 时落 softComplete('completed'),真失败显示成功。无 partial 状态;考虑用 'failed' 或新增状态 + 在 fallback 文案说明。
- [ ] **#7 attemptedTodoIds 只取当前 plan(高)** —— 被 replan 丢掉的未完成 todo 不被算进 → 静默以 completed 收尾。需跨 plan 统计 attempted todoIds。
- [ ] **#8 hadSoftFail 扫全历史(中)** —— 陈旧 soft-fail + 别因(如 never-审批 skip)的未完成 todo → 误触发续跑。应只看上次 replan 边界后的 step。
- [ ] **#9 续跑触发无 budget/subagent 守卫(中)** —— 续跑前缺 checkBudget;子 agent(deep_research)也续跑,可能被父超时孤儿化。触发前加 budget 检查 + 子 agent 跳过续跑。

**meta 结论**:多轮 review 反复证明——机械续跑信号(未完成 attempted todo + soft-fail)边界太多(陈旧失败/丢 todo/错标成功/prod 进展空)。**0001 当前不可合并**;深层正解指回让 reflection/planner 显式表态"完成没"(候选 B/0003),而非纯机械推断。建议:要么逐条修 #2/#6–#9,要么重排把 0003(Reflection)提前做、由它定续跑。

### 逐条修复记录（2026-06-03）

- [x] **#2 B2/B3 生产失效** —— 改为续跑触发时(todos 还在)算好进展、塞进 `continuation` replan step；`buildInitialPlan` 用 `readStashedContinuationProgress` 从 step 读，扛过 applyReplanningIfNeeded 清空 todos。测试改走真实读取路径(todos 已清),不再假信心。
- [x] **#3 幻影 replan** —— `applyReplanningIfNeeded` 现在同等对待 `continuation`(同 merge_trigger),不再补记 `critique_or_unspecified` 幻影。
- [x] **#4 进展泄漏到其它 replan** —— 进展只塞进 continuation replan step、只从那读 → critique/merge/steer replan 不再带进展。
- [x] **#5 never-tool todo** —— attemptedTodoIds 只取有 step 的 todoId,纯标签/无 step todo 天然排除(已缓解)。
- [x] **#8 hadSoftFail 扫全历史** —— 改为只看「上次 replan 之后」的 step(`lastReplanIdx` 切片),陈旧失败不再误触发。
- [x] **#9 无 budget/subagent 守卫** —— 续跑条件加 `!run.parentRunId`(子 agent 不自行续跑)+ `budgetLeft`(token/秒未耗尽)。
- [ ] **#6 撞 cap 标 'completed'** —— **缓解不改**:与 0001 前"soft-fail→completed"语义一致(非本票引入);LLM 终稿会如实报告失败。新增 'partial' 状态是更大的产品改动,**推迟**。
- [ ] **#7 attemptedTodoIds 只取当前 plan** —— **设计限制,推迟**:被 replan 丢掉的 todo 静默退出,需要跨 replan 的稳定 todo 身份(现状 todo 每轮重生成、id 复用)。正解指向 0003(Reflection 语义判完成),而非 todo-id 匹配。

**结论**:7 条里 **6 条已修**(#2/#3/#4/#5/#8/#9),422/422 全绿、tsc 干净。剩 #6(缓解)/#7(设计限制)如实推迟到 0003。0001 从"多处 bug"收敛到"机制健全 + 2 个已记录的已知限制"。

### Code-review 第三轮（修复后复审,2026-06-03）

验证 #2/#3/#8/#9 修复正确(2 finder 确认)。又抓到并修了 1 个真 bug:
- [x] **#10 续跑被残留 deny/steer 误路由** —— `applyReplanningIfNeeded` 的 denyIsNewest/steerIsNewest 在全历史找 last deny/steer,没跟刚写的 continuation replan 比。若 run 里有过 never-审批工具(approval_deny)或更早 steer,续跑会被错误路由到 deny 重规划 / steer no-op,丢掉 stashed progress。**已修**:`alreadyReplanRecorded`(最新步是 continuation/merge replan)优先短路到清 plan 分支 + 测试。
- [ ] **#2b 已完成 todo 不跨轮累积** —— buildProgressSummary 只见当前轮 run.todos,readStashedContinuationProgress 只读最新一条 → round2 重建丢了 round1 的已完成 todo。被 CAP=2 限住、观察(全历史 slice-4)部分弥补。同 #7 族,正解在 0003。
- 备注:idempotency 缓存命中记的是 `observe` step,buildProgressSummary 只收 `tool_call` → 缓存成功的观察不进进展(低影响)。

**0001 现状:7+1 条 review findings,7 条已修(#2/#3/#4/#5/#8/#9/#10),423/423 全绿。剩 #6(缓解)/#7/#2b(设计限制,指向 0003)如实推迟。**
