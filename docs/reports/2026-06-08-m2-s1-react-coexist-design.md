# M2-S1 ReAct 共存 —— 设计 + 对抗 review(ultracode 产出,2026-06-08)

> 设计经 4 路真码核验产出,再经 3 路对抗 review。**review 抓出 2 blocker + 4 major,设计未达实现就绪**。本文档存档分析 + 阻塞,供后续 design v2。

I have full verification of the load-bearing code. The recon matches reality on every anchor I checked (re-entry guards 141-146, reclaim dbAdvancing filter 161-167, idempotency gate 298-337, tool dispatch 357-418, StepKind union 161-189, detectPendingGrantBypass 193-204). I now have enough to produce the design.

---

# M2-S1 设计文档：ReAct 模式与 plan-once 共存

**目标**:在不替换核心循环、不回归 plan-once 的前提下,藏一个 `mode: plan_once | react` flag,让 react run 每步现场调一次 LLM 决策下一动作。`mode=plan_once` 必须零回归。

**前置已确认**:deepseek-chat ~300ms/step,延迟可行(0000 line 14-15 的 go/no-go 已过)。

---

## 1. mode flag:作用域选型

### 选型:**per-run 列**,`agent_runs.mode TEXT NOT NULL DEFAULT 'plan_once'`

照 `providerId/modelId` 先例(types.ts:116-117,migration 015 给老 run 加 `NOT NULL DEFAULT`,backend 保证永不空)。

| 选项 | 否决理由 |
|---|---|
| **per-env**(`AGENT_LOOP_MODE`) | 无法灰度/混跑;所有 run 同 mode,无法 A/B,无法按场景选。 |
| **per-user**(join user 表) | 致命冲突:M7 跨 owner 30s 窗合并(`acquireTopicSlot` topicCoord.ts:104)会把两个不同 owner 的 run 合到同一目标 run。两 owner mode 不同时,目标 run 的 mode 无法定值。 |
| **per-run 列** ✅ | 合并目标 run 上是单值,语义清晰;对 schema/pickup 影响最小。 |

### 对 schema / worker pickup 的影响

- **migration**:`ALTER TABLE agent_runs ADD COLUMN mode TEXT NOT NULL DEFAULT 'plan_once'`。老 run 自动得 `plan_once`,零回归。
- **store.ts**:`RUN_COLUMNS` 加 `mode`,`parseRun` 加读取,`createAgentRun` 写入(默认 `plan_once`,react 显式传 `react`)。
- **pickupNextRun**(store.ts:551-558):SQL 的 `status IN (...)` **不变**——mode 不影响 pickup 资格。pickup 后在 `executeRun` 入口按 `run.mode` 分叉到 `executeRunReact` 或现有 plan-once body。这是关键:**pickup 模型对 react 无感知,分叉只发生在 executeRun 内部**,worker 状态机完全复用。
- **M7 合并的 mode 归属**(★留给实现的开放问题,见 §5):两个不同 mode 的 run 命中 merge 时,目标 run 的 mode 以**活动(被合并到的)run** 为准——合并是「追问进 merged_inputs」,不改目标 run 的执行模式。S1 不需要解决跨 mode 合并的最优语义,只需保证 merge 不破坏目标 run 的 mode 字段。

---

## 2. react 执行循环

### 落地点:**另起 `executeRunReact(run)`**,在 `executeRun` 入口按 `run.mode` 分叉

理由(对照 recon 的 mainloop openQuestion):plan-once 的 `for (i=completedCount; i<plan.steps.length; i++)` 循环边界与 react「LLM 说 done 才停」根本不同;改造现有 for 风险高、易回归。**分叉点放在 executeRun 顶部**(在 re-entry 护栏 141-146 之后、`if(!run.plan)` 之前):

```
executeRun(runId):
  reload run; terminal/paused 护栏(141-146 不变)
  if (run.mode === 'react') return executeRunReact(run, abortController, ...)
  ...现有 plan-once body 原样...
```

入口护栏(141-146)、heartbeat、AbortController 注册、`run.started` emit 在分叉**之前**,两路共享。

### react 循环结构(plan→act→observe→repeat)

```
executeRunReact(run):
  iterationCount = countReactIterations(run)   // 从 DB step 历史重算,见 §3
  pendingGrantBypass = detectPendingGrantBypass(runId)  // 原样复用
  loop:
    1. 检查 M7 merge_trigger(复用 getMergedInputCounts)→ 有未消化追问则
       写 replan(reason:'merge_trigger') + status='replanning' + return(语义同 plan-once)
    2. 检查 abort signal(区分 steer/user,复用 217-222 逻辑)
    3. checkBudget(三维硬顶,复用)
    4. ★ react 自带步数硬顶:if (iterationCount >= REACT_MAX_ITERATIONS) → softComplete('budget_exhausted','react_iterations') 收尾
    5. transcript = rebuildReactTranscript(run)   // 从 listSteps 重放,见 §3
    6. decision = decideNextAction(transcript, goal, tools)  // 每步一次 LLM
       记一条 react_step(kind 新增,记 thought + chosen action,见下)
    7. if (decision.done) → softComplete + reply,break
    8. tool = toolRegistry.require(decision.toolName)
       --- 原样按 plan-once 顺序过四道 gate(见下),复用 per-step body ---
    9. iterationCount++(并 usage.steps+1,见 §3 计数源讨论)
```

### react 自带步数硬顶(R8,不复用 maxSteps)

R8 实证(已核验 runExecuteHelpers.ts:132 + runExecute.ts:544-547):`applyReplanningIfNeeded` 每进 replanning `reset usage.steps=0`,所以 `maxSteps=20` 是 **per-plan 计数,兜不住跨 replan 的循环**;plan-once 靠 `CONTINUATION_ROUND_CAP=2` 显式封顶。

react 同理需独立硬顶:**新增常量 `REACT_MAX_ITERATIONS`**(默认值待实现期按延迟实测定,起始建议 20)。计数源必须**从 DB step 历史重算**(每次 re-pickup 都重算,不依赖内存计数器),否则 crash-resume 会把迭代预算重置为 0,react 会无限烧到 `maxSeconds/maxTokens`。计数定义见 §3。越界走 `softComplete('budget_exhausted', 'react_iterations')`,复用现有收尾路径。

### 逐个复用现有 gate(react 每步 dispatch 前,顺序同 plan-once)

| Gate | 真实代码 | react 怎么接 |
|---|---|---|
| **M3-S0 子 agent 白名单**(exec-time) | runExecute.ts:244-258 | **原样**:`run.parentRunId && !SUBAGENT_TOOL_WHITELIST.has(tool.name)` → 记专用 kind `subagent_tool_denied`(不复用 approval_deny,见 types.ts:177-181 注)+ 跳过。react 子 run 绕过 planner-time 裁剪(planner.ts:158),exec-time 这道是**唯一咽喉**,价值更高,务必保留。白名单仍禁 `ask_user/deep_research/run_python`。 |
| **approval gate** | runExecute.ts:260-296 | **原样**:`approvalMode==='never'`→记 approval_deny 跳过;`==='ask'` 且无 grant bypass→记 approval_request + `status='awaiting_approval'` + `awaitingApprovalUntil=+60s` + **return 让出**。re-pickup 后复用 `detectPendingGrantBypass`(193-204,已核验:看最后 meaningful step 是否 approval_grant)放行一次。**★ react 特例见 §3**:bypass 需绑定到具体 action。 |
| **idempotency gate** | runExecute.ts:298-337 | **原样且价值更高**:`resolveToolCallKey`(ownerId 名空间) → 命中写 `observe`(不带 toolCallKey 避 unique 索引,见 :304)、不调 handler。react 反复 LLM 更易重发同一调用,这道 gate 兜住 crash-resume 重复执行幂等工具。 |
| **budget** | runExecute.ts:227 | **原样**:每轮顶 `checkBudget`,三维任一越界抛 `AgentBudgetExhausted` → `softComplete('budget_exhausted',dimension)`。react 步多,token/秒烧得更快,这道更早触发。 |
| **M7 topic coordination** | topicCoord.ts:43-138 | **正交,原样**:在 run 创建期(`withTopicCoordination`/`acquireTopicSlot`)+ 收尾期(`dequeueNextOnTopic` on softComplete/cancel)起作用,**不进 step 内循环**。react run 走同一 `createAgentRun` + `softComplete/cancelRun` 出口即复用。唯一需等价实现的是 **merge_trigger**(循环内 check `getMergedInputCounts`),已在循环结构 step 1 接入。 |

### ask_user 暂停(approval 的姊妹)

`ask_user` 工具返 `{ok:true,paused:true}` → `status='awaiting_user_input'` + `pendingUserPrompt` + `pendingUserInputExpiresAt=+24h` + return(runExecute.ts:447-487)。react 原样复用状态机。**关键差异**(见 §3):resume 写的 `user_input` step,在 react 下必须作为 ask_user 的 observation 重放进 transcript,否则 LLM 看不到用户答案会重复提问。

### 新 step kind:`react_step`

需进三处枚举(已核验都按 kind 过滤):
1. `StepKind` union(types.ts:161-189)——加 `react_step`,记 `{thought, chosenTool, chosenInput, done}`。
2. `recordReclaimIfNeeded` 的 `dbAdvancing` 过滤(runExecuteHelpers.ts:161-167)——**`react_step` 不算 advancing**(它是「决策」不是「完成的动作」;tool_call/observe 才推进)。
3. RunSummary useful-step 统计 / checkpoint success 过滤——`react_step` 不计入 useful。

`tool_call/observe/tool_error/reply` 直接复用,审计链不断。

---

## 3. ★ re-pickup 状态重建(最难点)

### 核心断裂

plan-once 的恢复定位 = `for(i=completedCount)` + `recordReclaimIfNeeded` 用 DB advancing step 数**反推 plan 指针**(已核验 runExecuteHelpers.ts:149-185)。**循环计数器 i 不落库**,`awaitingApprovalStepIdx`/`pendingUserStepIdx` 只写不回读(grep 确认仅写)。这套「数 step 反推位置」**在 react 下不直接成立**:react 无预生成 `plan.steps[]`,「下一步」是 LLM 现场决策,不存在静态指针。

### 方案:**agent_steps 即 ReAct transcript;re-pickup 时重放 step 历史重建上下文 + 重调 LLM 决策**(不新增表)

已核验的依据:
- `agent_steps` 有 `UNIQUE(run_id, idx)`、不可变、`listSteps ORDER BY idx ASC` 给确定性全历史(migration 012:44-65, store.ts:459-520)。这**就是** react 的 thought/action/observation 真相源。
- `recall_step` 工具(recallStep.ts:36-93)已提供分页全保真重读,是 react 上下文超窗时的「re-Read」机制。
- `contextCheckpoint`(checkpoint.ts)**不足以**单独恢复 react:它只 fold **成功** finding(checkpoint.ts:53-58 丢 soft-fail/error),digestTail 只留最近 8 条成功输出。react 需要**含失败 + 模型 reasoning 的完整链**。

#### re-pickup 重建流程

```
executeRunReact(run):  // 每次 pickup 都重新进入,无内存状态跨 pickup
  steps = listSteps(runId)              // 全量有序历史
  transcript = rebuildReactTranscript(steps):
    for s in steps (idx 序):
      react_step       → [Thought] + [Action: tool(input)]
      tool_call/observe→ [Observation: output]   (含 recall_step 提示供超窗重读)
      tool_error       → [Observation: error]     ★ 失败也要喂(与 plan-once checkpoint 不同)
      approval_request → [我请求批准 X]
      approval_grant   → [已获批]                  ★ 让 LLM 知道这次 action 已放行
      user_input       → [用户回答: ...]           ★ 作为 ask_user 的 observation 注入,否则重复提问
      subagent_tool_denied → [工具 X 被白名单拒绝]
  iterationCount = count(steps where kind == 'react_step' && done==false)  // react 迭代硬顶计数源
  pendingGrantBypass = detectPendingGrantBypass(runId)   // 原样复用(193-204)
  → 回到 §2 循环,从 transcript 重调 decideNextAction LLM 继续
```

### 为什么可行(逐项对照真实代码)

1. **无内存状态跨 pickup**:`executeRun` 每次从 `getAgentRun` + step 行重建(已核验 130-152 无内存 carry)。react 沿用同一假设——一切从 `listSteps` 重放。
2. **暂停/恢复无需新列**:pending action(tool+input)已经**持久化在最后一条 react_step / approval_request 的列里**。resume 后重放 transcript,LLM 看到「我请求批准 X、已获批」,会重新决策出同一 action;`detectPendingGrantBypass` 让它跳 gate 一次直接 dispatch。awaiting_user_input 同理——`user_input` step 作为 observation 喂回。**step 历史 + `*_step_idx` 标记已足够**。
3. **迭代硬顶 crash-safe**:`iterationCount` 从 DB `react_step` 计数重算,不靠 `usage.steps`(后者会被 replan reset 为 0)。crash-resume 不会把预算清零。
4. **幂等保护 crash 窗口**:`resolveToolCallKey` + `findStepByToolCallKey` + 部分 `UNIQUE(run_id,tool_call_key)`(298-337)已在 re-pickup 间去重幂等工具——react 重决策出同一幂等 action 会命中 observe 缓存,不双执行。
5. **reclaim 仍有用,语义重解释**:`recordReclaimIfNeeded` 的 `dbAdvancing` 计数(161-167)对**非幂等工具**的「handler 成功但 usage 没 bump 就崩」窗口仍提供窄保护——保留它,但 react 下「advancing」重解释为「完成一个 tool dispatch」,`react_step`(决策)不计入。

### 复用 contextCheckpoint 的边界

**不**用 checkpoint 单独恢复 react(它丢失败 + reasoning)。checkpoint **仅**作为**上下文窗口压缩层**:当 transcript 超窗,用 `digestTail` + `recall_step` 投影旧 observation(与今日 plan-once 用法一致)。这把「恢复正确性」(靠 step 重放,精确)和「窗口管理」(靠 checkpoint,有损但够用)解耦。

### 跨进程 steer/cancel 竞态(react 更易踩)

react 单轮 LLM 调用可能较长,abort 信号若发给已换 worker 的 run 会落空,只能靠 DB `status` 兜底(steer.ts:59-61 + runExecute.ts:217-222 双通道)。react 每轮 LLM **前后**都 check abort + 读 DB status 区分 steer/user。abort 命中 LLM 流式中途时,未落库的半个 action 直接丢弃(decision 未写 react_step 即视为未发生,重放时不存在)——**先写 react_step 决策,再 dispatch tool**,保证中断点干净。

---

## 4. 安全切片拆解(各自 TDD,plan-once 零回归)

每片独立交付、独立测试、`mode=plan_once` 路径不被触碰。

### **S1a(地基,最安全):per-run mode flag,纯数据层,无行为改变**
- migration 加 `mode DEFAULT 'plan_once'`;`RUN_COLUMNS`/`parseRun`/`createAgentRun` 加列。
- `executeRun` 入口加分叉**桩**:`if (run.mode==='react') { ...暂时走 plan-once 或 throw NotImplemented... }`。
- TDD:老 run 读出 `mode='plan_once'`;新 run 默认 `plan_once`;显式建 react run 字段持久化。**plan-once 行为字节级不变**(分叉对 plan_once 是 no-op)。
- **为什么第一**:零行为改变,纯加列 + 先例已验证(migration 015),最小回归面。所有后续片都依赖这个 flag 存在。

### **S1b:抽取可复用的 per-step「dispatch + 四道 gate」单元**
- 把 runExecute.ts:244-418 的 per-step body(子agent guard → approval → idempotency → tool dispatch+retry → recordStep)抽成函数 `runToolStep(run, toolName, input, ctx)`,返回 `{ kind: 'dispatched'|'paused'|'denied'|'cached', ... }`。
- plan-once for 循环改调这个函数(**行为不变**,纯重构)。
- TDD:plan-once 全套既有测试绿(重构无回归);新单元测试覆盖四道 gate 各分支。
- **为什么第二**:这是 react 与 plan-once 的**共享地基**;先在 plan-once 上证明抽取无回归,react 才能安全复用。

### **S1c:`executeRunReact` 最小循环(无暂停、无续跑),只走 happy path**
- 新增 `react_step` kind(三处枚举同步)、`REACT_MAX_ITERATIONS`、`decideNextAction` LLM 契约、`rebuildReactTranscript`、`countReactIterations`。
- 循环:transcript → LLM → react_step → `runToolStep`(S1b) → observe → repeat;`done` 或 iteration cap 收尾。
- **跑通一条无 approval/无 ask_user 的 react run**。
- TDD:用 LLM relay harness 驱动(见 MEMORY 的 agent-llm-relay-test-harness)。断言 step 序列、iteration cap、budget check。

### **S1d:react re-pickup / crash recovery**
- transcript 从 `listSteps` 重放;crash 后(heartbeat stale)worker 重 pickup → 重建 transcript → 继续。
- TDD:跑 N 步后杀进程(模拟 stale heartbeat)→ 重 pickup → 断言不重复执行幂等工具、iterationCount 不归零、transcript 含全历史。

### **S1e:react 暂停点(approval + ask_user)resume**
- approval=ask 让出 + `detectPendingGrantBypass` 复用 + approval_grant 注入 transcript;ask_user 让出 + `user_input` 注入 transcript。
- ★ bypass 精确性:grant 绑定到 `pendingApprovalToolName`(已存,见 :289)校验放行,避免误放不同 action(见 §5 RISK)。
- TDD:react run 命中 ask 工具 → awaiting_approval → approve → re-pickup → 同一 action dispatch(不重复挂起);ask_user → resume → LLM 看到答案不重复提问。

### **S1f:react 与 replan/steer/merge 的状态机共存收尾**
- steer/merge_trigger 在 react 下:写 replan + status='replanning' → re-pickup。`applyReplanningIfNeeded` 的 plan 三分支对 react 大半失效——react 路径**旁路 plan 重写**,只重置 react 轮次计数源解释 + 把触发原因(steer 指令 / merge 追问)注入下一轮 transcript。
- 决定 react 是否参与 continuation-replan/reflection(见 §5 开放问题)——S1 建议 react **自带 done 判定,关掉 loop-end 的 reflectGoalCompletion+CONTINUATION_ROUND_CAP 段**,避免两套封顶互打。
- TDD:react run steer → 下一轮 LLM 看到新指令;两套硬顶(REACT_MAX_ITERATIONS vs CONTINUATION_ROUND_CAP)不同时生效。

---

## 5. 风险登记 + 每片回滚

| ID | 风险 | 缓解 | 回滚 |
|---|---|---|---|
| R-1 | S1b 重构 per-step body 引入 plan-once 回归 | 重构前后跑全套 plan-once 测试,字节级对照 step 序列 | revert S1b commit;plan-once for 循环回到内联 body |
| R-2 | react 无限循环烧 token(R8:maxSteps reset 兜不住) | `REACT_MAX_ITERATIONS` 从 DB step 重算(crash-safe);budget 三维硬顶仍在每轮顶 | cap 设极小值(如 5)或 mode 列全置 plan_once 关停 react |
| R-3 | crash-resume 重复执行非幂等工具(handler 成功但 usage 没 bump 即崩) | idempotency observe 缓存 + reclaim dbAdvancing 计数窄保护;**先写 react_step 再 dispatch** | 同 plan-once 现状(已有此窗口,react 不更差) |
| R-4 | approval grant bypass 误放行**不同** action(re-pickup 后 LLM 重决策可能选别的 ask 工具) | bypass 绑定 `pendingApprovalToolName` 校验(S1e),不只看「最后是 grant」 | S1e 内可回退到 plan-once 式宽松 bypass(但有误放风险,故标 RISK) |
| R-5 | M7 跨 owner 合并两 run mode 冲突 | 目标 run mode 以活动 run 为准,merge 只进 merged_inputs 不改 mode | merge 路径对 react 暂禁(react run 不参与跨 owner merge),退化为 queue |
| R-6 | 新 `react_step` kind 漏改某处 kind 过滤(reclaim/checkpoint/summary) | S1c 显式审计三处枚举 + 测试覆盖 | revert S1c;react_step kind 移除 |
| R-7 | 跨进程 steer abort 落空,react 长轮次让出 | 每轮 LLM 前后 check abort + 读 DB status 兜底 | 缩短 react 单轮超时;依赖下次 pickup 的 status 兜底 |

**全局回滚开关**:任何阶段把 `agent_runs.mode` 全置 `plan_once`(或 `createAgentRun` 强制 `plan_once`),react 路径完全休眠,系统回到今日行为。这是 per-run flag 选型的最大收益。

---

## 诚实标注:仍未解的设计风险(留给实现阶段)

1. **★ react re-pickup 是否每次重调 LLM(全量重放 transcript)还是持久化「下一个意图动作」**(新 react_decision step/列)以省一次往返?S1 默认**前者**(简单、复用 listSteps 重放、无新状态形状)。后者省 crash-resume 的延迟/成本但加持久状态,留作 S1d 后的优化,**非 S1 必需**。
2. **`decideNextAction` 的 LLM 契约未定**:复用 `planner.ts` prompt 还是新建?observations 历史投影方式(逐字 digestTail vs checkpoint findings vs recall_step 按需)?done 信号编码(`{done:true}` vs 选 reply 工具)?`reflection.ts` 只判 goalMet 不选 tool,**不能直接复用**。这是 S1c 的核心未知,需 prototype 实测 prompt 质量后定。
3. **`REACT_MAX_ITERATIONS` 默认值**:需按延迟实测(0000 要求先估 15-30s 卡临界)定,起始 20 是占位。
4. **react 是否参与 continuation-replan/reflection 收尾**:S1 建议关掉(react 自带 Finalize),但若长任务需要 checkpoint 压缩兜底,二者共存时 `CONTINUATION_ROUND_CAP` 与 react 步数顶如何不互打,**留 S1f 定**。
5. **单写者不变量**:`maxStepIdx+1` 读后写假设一 run 一写者(靠 SKIP LOCKED + 30s heartbeat)。react 长单轮(>30s 高成本工具)可能让第二 worker 在第一仍活时 pickup;heartbeat 每 10s 通常防住,但**「stalled-but-not-crashed」worker 是残留 hazard**。若未来要并行 action,`idx` 需移到 DB sequence——S1 单步串行**不触发**,但标注为边界。
6. **跨进程 steer 命中 LLM 流式中途**的半动作回滚:S1 靠「先写 react_step 再 dispatch」保证中断点干净,但流式 token 已产生的 cost 记账时机需 S1f 验证。

---

**关键文件锚点**(全绝对路径):
- `/Users/church/claude/agent-Carl-Gustav-Jung/apps/api/src/lib/agent/runExecute.ts`(executeRun 入口护栏 141-146、per-step body 244-418、approval/ask_user 让出 260-296/447-487、budget 227、CONTINUATION_ROUND_CAP 544-547)
- `/Users/church/claude/agent-Carl-Gustav-Jung/apps/api/src/lib/agent/runExecuteHelpers.ts`(recordReclaimIfNeeded 149-185、detectPendingGrantBypass 193-204、applyReplanningIfNeeded 63-137、usage.steps reset 132)
- `/Users/church/claude/agent-Carl-Gustav-Jung/apps/api/src/lib/agent/store.ts`(pickupNextRun 547-577、RUN_COLUMNS/parseRun、listSteps/getStepByIdx/maxStepIdx 459-520)
- `/Users/church/claude/agent-Carl-Gustav-Jung/apps/api/src/lib/agent/types.ts`(StepKind union 161-189、AgentRun 字段 94-139、DEFAULT_BUDGET 236-240、AgentCheckpoint 262-277)
- `/Users/church/claude/agent-Carl-Gustav-Jung/apps/api/src/lib/agent/topicCoord.ts`(M7 withTopicCoordination/acquireTopicSlot/dequeueNextOnTopic 43-138)
- `/Users/church/claude/agent-Carl-Gustav-Jung/apps/api/src/lib/agent/tools/recallStep.ts`(36-93,react 超窗重读机制)
- `/Users/church/claude/agent-Carl-Gustav-Jung/apps/api/src/lib/agent/checkpoint.ts`(buildCheckpoint,react 仅作压缩层复用)
- `/Users/church/claude/agent-Carl-Gustav-Jung/apps/api/src/lib/agent/subagentTools.ts`(SUBAGENT_TOOL_WHITELIST 4-14)
- `/Users/church/claude/agent-Carl-Gustav-Jung/apps/api/src/db/migrations/012_agent_runtime.sql`(agent_steps UNIQUE 约束)

---

# 对抗 review 发现

## 角度:re-pickup 可行性:对 runExecute.ts re-entry + pickup + reclaim +  — flaws_found

### [MAJOR] §3 第 4 点 + R-3:幂等保护兜住 crash-resume 重复执行;先写 react_step 再 dispatch 保证中断点干净,react 不比 plan-onc
- **问题**:幂等缓存只对实现了 computeIdempotencyKey 的工具生效,且命中条件是 cached.kind==='tool_call' && output!=null。大量工具根本没有 idempotency key,ask_user 也没有(grep 列表里没有它)。对这类无 key 工具,react 的 crash-resume 防重保护退化为只剩 recordReclaimIfNeeded 的 dbAdvancing 计数。但该计数在 react 下 *仍能工作* 的前提是『react_step 决策已落库 → tool dispatch 成功 → tool_call 落库 → 崩在 usage.bump 前』这一窄窗;真正危险的是『react_step 已落库(决策出非幂等工具)→ handler 已执行副作用 → 崩在 tool_call 落库前』。此时 DB 里只有 react_step,无 tool_call,dbAdvancing 不增,re-pickup 重放 transcript 看到的是『有 Thought/Action 但无 Observation』,LLM 会重新决策很可能重发同一非幂等动作 → 双执行。这正是 plan-once 用『先 dispatch 再 recordStep』+ reclaim 计数覆盖的窗口,而 react『先写 react_step 再 dispatch』把决策与执行拆成两条 step 后,中间崩溃的语义反而比 plan-once 单条 tool_call 更脆弱——决策已持久但执行结果未持久,无法判定副作用是否已发生。
- **证据**:runExecute.ts:300-302 (cached && cached.kind==='tool_call' && cached.output!=null 才命中);runExecuteHelpers.ts:161-167 (dbAdvancing 只数 tool_call/observe/approval_deny/subagent_tool_denied,不含 react_step);tools/askUser.ts 无 computeIdempotencyKey;runExecute.ts:409-418 (plan-once 在 handler 返回后才写 tool_call,handler 成功+崩在写 step 前是已知窗口,reclaim 用 dbAdvancing 反推)

### [MAJOR] §3 第 2 点 + R-4:approval resume 位置能精确恢复;detectPendingGrantBypass 复用即可放行一次,S1e 再把 bypass 绑定 
- **问题**:detectPendingGrantBypass 的真实实现只判断『最后一条 meaningful step 是否 == approval_grant』,完全不看工具名/动作。plan-once 下这是安全的,因为 grant 后 for 循环必然回到同一个 plan.steps[i](静态指针),放行的就是被批的那一步。react 没有静态指针:re-pickup 后 LLM 看完整 transcript 重新决策,完全可能选一个 *不同的* 需审批工具,而 bypass=true 会无条件放行它——一次未经批准的副作用执行。设计在 R-4 承认了这点并推给 S1e『绑定 pendingApprovalToolName』,但 detectPendingGrantBypass 当前签名只返回 boolean、不返回工具名,且 §2 的循环结构 step 8 仍写『复用 detectPendingGrantBypass(193-204)放行一次』。这意味着 S1c/S1d 的 happy-path 与 crash-recovery 切片若先落地、S1e 未到,react 就带着这个误放行洞在跑。这不是『留给实现』的优化,是 react 共存的正确性前提,应是 S1e 的 blocker 级约束而非可选收紧。
- **证据**:runExecuteHelpers.ts:193-204 (lastMeaningful?.kind === 'approval_grant',无 toolName 比较,返回 boolean);runExecute.ts:181 + 274-294 (plan-once 靠 for 循环回到同一 plan.steps[i] 保证放行的是被批步骤);runExecute.ts:290 (pendingApprovalToolName 已持久化,但 detectPendingGrantBypass 未读它)

### [MAJOR] §3 第 1 点:无内存状态跨 pickup,react 沿用同一假设,一切从 listSteps 重放即可重建。单写者不变量(§5 item5)被标为 S1 不触发的边界。
- **问题**:recordStep 用的是非事务的『读 maxStepIdx 再 insertStep』两步(stepRecorder.ts:24+30 是两次独立 getPool().query,中间无 FOR UPDATE 锁)。store.ts:671-674 注释里那套『SELECT FOR UPDATE 锁 run 行保证 MAX(idx)+1 不撞 UNIQUE』的保护是 appendMergedInput 专属(store.ts:701-708 在持锁事务里),recordStep 路径并不在该事务内。plan-once 单轮 step 短(~亚秒~数十秒),30s heartbeat + SKIP LOCKED 实践上守住单写者。react §0 自述 deepseek ~300ms/step 看似更短,但 §5 item5 自己也承认 react 长单轮(高成本工具/慢 LLM 流式)会让第二 worker 在 heartbeat 失活窗(>30s)pickup。一旦两 worker 并发 recordStep 同一 run,二者读到同一 maxStepIdx → 都 insert idx=N → UNIQUE(run_id,idx) 让其一抛错。但 recordStep 没有 catch+retry(stepRecorder.ts:23-33 无 try/catch,注释 line 21 只是『调用方应捕获并 retry』而 executeRun 调用处并未包 retry)。react 因单轮更易超 heartbeat,触发该竞态的概率比 plan-once 高,且后果是 executeRun 抛未处理错 → run 可能误标 failed。这削弱了『re-pickup 重放即安全』的承重论断。
- **证据**:stepRecorder.ts:24 (const nextIdx = (await store.maxStepIdx)+1) 与 :30 (insertStep) 是分离的非事务调用;store.ts:671-674 注释的 FOR UPDATE 保护属 appendMergedInput(:701-708)不覆盖 recordStep;migration 012 的 UNIQUE(run_id,idx);runExecute.ts 各 recordStep 调用点无 retry 包裹

### [MINOR] §2 ask_user 暂停:react 原样复用状态机,resume 写的 user_input step 作为 ask_user observation 重放进 transcr
- **问题**:在 plan-once,ask_user 暂停时已经先写了一条 tool_call step(runExecute.ts:409,在 ask_user 判定 458 之前),该 tool_call output 是 {ok:true,paused:true}。react 若原样复用 per-step body,会在 transcript 里留下一条 ask_user 的 tool_call(Observation: paused) + 之后 resume 的 user_input step。rebuildReactTranscript(§3)把 tool_call/observe 映射为 [Observation],user_input 映射为 [用户回答];但 ask_user 的那条 tool_call output 是 paused 标记不是真答案,若被当成普通 Observation 喂给 LLM,可能与紧随的 user_input 答案产生『我已调用 ask_user 得到 paused / 用户回答 X』的双信号,设计未说明如何在 transcript 里折叠这条 paused tool_call。更关键:user_input step 不带 toolName 之外的关联到具体哪次提问的语义(output.resumedFromStepIdx 指向 pendingUserStepIdx,而 react 下该字段在 plan-once 是 plan 循环变量 i,见 runExecute.ts:470,react 无 i,需另存),设计未交代 react 下 pendingUserStepIdx 写什么。
- **证据**:runExecute.ts:409-418 (ask_user 先写 tool_call output={result:{ok,paused},retried});runExecute.ts:470 (pendingUserStepIdx: i —— i 是 plan-once for 循环变量,react 无此变量);runLifecycle.ts:401 (user_input output 带 resumedFromStepIdx: run.pendingUserStepIdx)

### [MINOR] §3 第 5 点:reclaim 语义重解释为『完成一个 tool dispatch』,react_step 不计入 advancing,保留 recordReclaimIfNee
- **问题**:recordReclaimIfNeeded 在 react 下语义不仅是『不计 react_step』那么简单。该函数用 dbAdvancing 与 run.usage.steps 比较来反推 completedCount(helpers.ts:168-184),而 react 没有 plan.steps[] 也不存在『completedCount 作为循环起点』的概念——design §2 的 react 循环 iterationCount 是另算的(count react_step where done==false)。也就是说 recordReclaimIfNeeded 返回的 completedCount 在 react 路径里无消费者,但它仍有 *副作用*:当 dbAdvancing > usage.steps 时它会写一条 reclaim step 并 updateAgentRun(usage.steps=dbAdvancing)(helpers.ts:172-183)。react 若沿用 usage.steps 作 budget 维度之一,这次 reset 会改变 budget 计账;若不沿用,则这条 reclaim step 进入 transcript 又需 rebuildReactTranscript 处理(设计的 transcript 映射表里没列 reclaim kind)。设计说『保留它,语义重解释』过于轻描淡写,实际需明确 react 是否调用它、调用后的 usage 副作用与 transcript 映射。
- **证据**:runExecuteHelpers.ts:168-184 (dbAdvancing>usage.steps 时写 reclaim step + updateAgentRun usage.steps=dbAdvancing);§3 设计 transcript 映射表未列 reclaim kind;§2 iterationCount 用 react_step 计数,与 recordReclaimIfNeeded 的 completedCount 无关联消费点

## 角度:gate 复用正确性:逐个核验 react 另起循环时 M7/approval/budget/idempotency/M — flaws_found

### [MAJOR] §4 S1b:把 runExecute.ts:244-418 per-step body 抽成 runToolStep(run,toolName,input,ctx),plan-o
- **问题**:per-step body 不是'纯 tool dispatch',它深度耦合 plan-once 专有状态,抽取面远大于设计暗示:(1) approval 让出处写 `pendingUserStepIdx: i`(470)与 awaiting_approval 都依赖 for-loop 索引 i / maxStepIdx,react 无 i;(2) idempotency 命中(313-318)与 tool_call 成功(422-429)都做 `planStep.todoId` 的 todo-completion 变异,react 无 todos/todoId;(3) critique(489-518)按 `run.usage.steps % 5` 触发并读 plan。要抽成对 react 也成立的单元,必须先把 todo 变异/critique/i-定位 这些 plan-once 专有逻辑从 body 里剥离出去——这不是'纯重构行为不变',而是真实的结构改动,R-1 回归风险被低估。
- **证据**:runExecute.ts:229-230(plan.steps[i]/planStep),:313-318 与 :422-429(planStep.todoId todo 变异),:470(pendingUserStepIdx: i),:489-518(critique 读 run.usage.steps + plan)

### [MAJOR] §2/§3 'react 自带步数硬顶 REACT_MAX_ITERATIONS,因 maxSteps(usage.steps)会被 replan reset 兜不住';并称 bu
- **问题**:承重前提自相矛盾。checkBudget(budget.ts:8)在 `usage.steps >= maxSteps(=20)` 时就抛 AgentBudgetExhausted('steps')。设计 §2 step9 又写 react 每步 `usage.steps+1`。于是:在单条不 replan 的 react 循环里,第 20 次 dispatch 就会被既有 budget steps 维度直接砍停,REACT_MAX_ITERATIONS 与之撞顶(两套硬顶同值 20 同时生效,违反 §4 S1f'两套硬顶不互打'目标)。若为避免撞顶让 react 的 react_step/dispatch 不 +usage.steps,则 reclaim 的 dbAdvancing<=usage.steps 比较(helpers:168)与 budget steps 维度全部失真。'maxSteps reset 兜不住'只在跨 replan 成立,但 react 设计 §4 S1f 又建议 react 旁路/关掉 replan——那么 react 主路径其实 usage.steps 不会被 reset,maxSteps 反而是有效硬顶,REACT_MAX_ITERATIONS 的必要性论证(R8)在 react 的实际形态下不成立。计数源/+1 语义未对齐是真实未决冲突,非占位。
- **证据**:budget.ts:7-9(usage.steps>=maxSteps 抛错),types.ts:237(maxSteps:20),runExecuteHelpers.ts:132(replanning reset steps:0),runExecuteHelpers.ts:168(dbAdvancing<=usage.steps 依赖 usage.steps 语义)

### [MINOR] §2 表格 + R-4:approval gate'原样复用',re-pickup 后 detectPendingGrantBypass(193-204)放行一次;R-4 仅作为'
- **问题**:在 react 下这不是可选风险而是正确性缺陷:detectPendingGrantBypass 只判'最后一条 meaningful step 是否 approval_grant'(:203),完全不校验工具名。plan-once 里 bypass 后立刻执行的是确定的 plan.steps[i](静态),所以放行哪个 action 是确定的;react 里 re-pickup 后 LLM 重新决策,可能选出与被批准 action 不同的工具,bypass 会误放一个从未被批准的 action。设计自己在 R-4 承认但只列为'RISK/回退宽松',而 §2 表格仍称 approval'原样复用'——'原样复用' detectPendingGrantBypass 在 react 路径直接破坏 approval 不变量,必须改实现(绑定 approval_grant.toolName,该字段已存于 grant step)。
- **证据**:runExecuteHelpers.ts:193-204(detectPendingGrantBypass 不读 toolName),approval.ts:44-45(approval_grant step 已带 toolName 可供绑定),runExecute.ts:290(pendingApprovalToolName 已持久化)

### [MINOR] §2 新 step kind react_step'需进三处枚举:StepKind union / recordReclaimIfNeeded dbAdvancing / RunS
- **问题**:RunSummary 的过滤是黑名单(NOISE_KINDS 白排除),不是白名单。runSummary.ts:12-15 仅排除 ['heartbeat','reclaim','system_error'],其余一律计入 useful。所以要让 react_step '不计入 useful',必须把 react_step 显式加进 NOISE_KINDS——设计文字说'react_step 不计入 useful'方向对,但没点明这是要改 NOISE_KINDS 黑名单(漏改即被错误计数,正是 R-6 担心的'漏改某处 kind 过滤')。属于枚举同步清单需精确到该常量。
- **证据**:runSummary.ts:12(NOISE_KINDS=['heartbeat','reclaim','system_error']),:15(filter !NOISE_KINDS.includes —— 黑名单,默认计入)

### [MINOR] §2 表格:M3-S0 子 agent 白名单'原样':react 子 run 绕过 planner-time 裁剪,exec-time(244-258)是唯一咽喉,保留即可。
- **问题**:exec-time guard(:244)确实是纯 per-dispatch 检查(run.parentRunId && !whitelist.has(tool.name)),react 路由 chosen tool 过它即生效——这部分核验为真。但设计只保留 exec-time、未给 react 的 decideNextAction 复用 planner.ts:157-158 的工具白名单裁剪,意味着 react 子 run 会把全量工具呈给 LLM,LLM 反复提议白名单外工具→每次被 :244 拒(记 subagent_tool_denied)→白白消耗一次 react 迭代/向 REACT_MAX_ITERATIONS 推进。安全性保住了,但 react 子 run 的迭代预算会被无效提议蚕食;decideNextAction 应同样按 isSubagent 过滤工具列表。设计未提此点。
- **证据**:runExecute.ts:244(exec-time guard per-dispatch),planner.ts:157-158(planner-time 按 SUBAGENT_TOOL_WHITELIST 裁剪工具列表——react 路径无等价裁剪)

## 角度:约束不违反 + 切片安全性:逐条核对 0000 不可动约束、plan-once 零回归(共用路径是否被改)、切片可独立交 — flaws_found

### [BLOCKER] §2 react 循环 step 9『iterationCount++(并 usage.steps+1)』+ §3『advancing 重解释为完成一个 tool dispatch
- **问题**:budget 是 0000 line 18 明列的不可动约束,但设计让 react 同时(a)bump usage.steps 又(b)每轮跑 checkBudget。checkBudget(budget.ts:8)是 `usage.steps >= budget.maxSteps`,DEFAULT_BUDGET.maxSteps=20(types.ts:237)。于是 react 在第 20 步会被 AgentBudgetExhausted('steps') 提前砍掉 —— 与设计自定的 REACT_MAX_ITERATIONS=20 语义重叠且互相打架:要么 react 永远撞 maxSteps(REACT_MAX_ITERATIONS 形同虚设),要么实现期偷偷不 bump usage.steps / 抬高 maxSteps,那就是改了 budget 硬顶这条不可动约束。设计没有澄清 react 下 maxSteps 维度怎么处理,把一个直接触碰 0000 约束的冲突留成了隐含矛盾。
- **证据**:/Users/church/claude/agent-Carl-Gustav-Jung/apps/api/src/lib/agent/budget.ts:7-8 (usage.steps >= budget.maxSteps);  types.ts:236-240 (maxSteps:20);  runExecute.ts:227 (checkBudget 每轮顶);  设计 §2 step 3+9 与 §3 advancing 重解释

### [BLOCKER] S1b『把 runExecute.ts:244-418 的 per-step body 抽成 runToolStep(run,toolName,input,ctx),plan-on
- **问题**:被抽取的 body 实际范围远不止 244-418,且与 for 循环深度耦合,不是『纯重构、行为不变』:(1) per-step 逻辑实际延伸到 518 —— 244-518 里有 todo 标完成(用 planStep.todoId)、critique gate(读 run.usage.steps % 5)、consecutive_failures replan(listSteps slice 全 run)。(2) 四道 gate 与 ask_user 让出全部用 `continue`/`return` 直接操纵 for 循环控制流(256/272/293/335/486/516),抽成返回 {kind} 的函数后,调用方必须重新实现这套控制流分发 —— 这本身就是会改到 plan-once 共用路径的高风险改动,而 plan-once 零回归是核心要求。(3) `i`(循环变量)被写进 pendingUserStepIdx(:470),抽函数后该耦合要专门处理。称其『行为不变纯重构』低估了回归面,而这恰恰是 R-1 标的风险被设计自己说成可控。
- **证据**:/Users/church/claude/agent-Carl-Gustav-Jung/apps/api/src/lib/agent/runExecute.ts:256,272,293,335,486 (continue/return 操纵 for),:470 (pendingUserStepIdx: i),:490-518 (critique/failures gate 在 per-step 尾部,设计的 244-418 范围未覆盖)

### [MAJOR] S1f『react 自带 done 判定,关掉 loop-end 的 reflectGoalCompletion+CONTINUATION_ROUND_CAP 段,避免两套封顶互打
- **问题**:loop-end 收尾段(521-700)不是孤立的『可关』模块 —— 它承载了多个非 react 自备的关键收尾:computeCheckpoint 收尾写(667-677,供下游 buildFinalContent/softComplete 读最新 checkpoint)、subagent 零工作硬失败判定(686-693)、reply step + softComplete('completed')(698-700)。react 若『关掉这段』,必须自己重新实现 checkpoint 收尾 + softComplete 出口 + 子 run 越权硬失败,否则 react 子 run 越权场景会丢掉 686-693 的安全网(M3-S0 是 0000 体系外但已上线的安全约束)。设计把这当成 S1f 的轻量开关,实则是 react 收尾路径的完整重写,被严重低估且排到最后。
- **证据**:/Users/church/claude/agent-Carl-Gustav-Jung/apps/api/src/lib/agent/runExecute.ts:667-677 (finalCheckpoint 收尾写),:686-693 (subagent 零工作 softComplete failed),:698-700 (reply+softComplete completed)

### [MAJOR] §3『暂停/恢复无需新列…detectPendingGrantBypass(193-204)让它跳 gate 一次直接 dispatch』,并在 R-4 把『bypass 误放不同
- **问题**:detectPendingGrantBypass 真实实现只看『最后一条 meaningful step 是否 approval_grant』,完全 tool-agnostic(193-204)。plan-once 安全是因为 re-pickup 后 for 循环确定性重放同一个 plan.steps[i],bypass 必然消费在原 action 上;react 下『下一 action』是 LLM 现场重决策,可能选另一个 ask 工具,bypass 会放行一个从未被批准的 action。这是 react 把一个 0000 不可动约束(approval 暂停语义)的安全性实质削弱 —— 应是 blocker 级的语义违反,设计却靠『绑 pendingApprovalToolName 校验』的未实现缓解把它降为 S1e 的普通 RISK,且承认回退方案仍有误放风险。把削弱 approval 约束的修复留在第 5 片、且回退即破约束,是优先级与定级错误。
- **证据**:/Users/church/claude/agent-Carl-Gustav-Jung/apps/api/src/lib/agent/runExecuteHelpers.ts:193-204 (只判 lastMeaningful.kind==='approval_grant',无 toolName 校验);对比 runExecute.ts:187 for(i=completedCount) 确定性重放 plan.steps[i]

### [MAJOR] 切片拆解声称『每片独立交付、独立 TDD、plan-once 路径不被触碰』,S1a 是『零行为改变最安全地基』。
- **问题**:re-pickup/crash recovery(§3 自承是『最难点』)被拆进 S1d,但 S1c『最小循环 happy path』已经必须实现 rebuildReactTranscript + countReactIterations + iterationCount 从 DB 重算 —— 这些正是 re-pickup 重建的核心机制。crash-safe 计数(§3 第 3 条:从 DB react_step 重算而非 usage.steps)若不在 S1c 一并做对,S1c 的 happy-path run 一旦中途被 worker re-pickup(pickupNextRun 的 30s heartbeat stale 条件,store.ts:553-555,任何 >30s 的 run 都会触发)就会迭代计数归零、无限烧。即 re-pickup 的正确性无法真正推迟到 S1d:S1c 一落地就暴露在 re-pickup 下。设计把最难点藏进 S1d,但 S1c 已实质依赖它,违反『每片独立可交付』。
- **证据**:/Users/church/claude/agent-Carl-Gustav-Jung/apps/api/src/lib/agent/store.ts:553-555 (pickup 条件 heartbeat<now-30s,任何长 run 都会被再 pickup); 设计 §3 自承 re-pickup 是最难点 + S1c 已需 countReactIterations/rebuildReactTranscript

### [MINOR] S1c『新增 react_step kind…需进三处枚举』,R-6 缓解为『S1c 显式审计三处』。
- **问题**:RunSummary 的 useful-step 统计实际不是按 react_step 显式 filter,而是注释式白名单语义(types.ts:223-227『filter out heartbeat/reclaim/system_error』),且真正实现 buildRunSummary 在 runLifecycle 收尾被无条件调用(softComplete:267-268)。新增 react_step 后,若 buildRunSummary 用『排除黑名单』而非『包含白名单』,react_step 会被默认计入 stepCount/toolCount,污染面板摘要 —— 设计列的『三处枚举』(StepKind/dbAdvancing/summary)对 summary 的描述是『useful-step 统计需排除』,但没核对 buildRunSummary 到底是黑名单还是白名单实现,审计点定位不准,易漏。
- **证据**:/Users/church/claude/agent-Carl-Gustav-Jung/apps/api/src/lib/agent/types.ts:223-234 (RunSummary 注释黑名单语义);  runLifecycle.ts:267-268 (buildRunSummary 收尾无条件调用,设计未确认其黑/白名单实现)
