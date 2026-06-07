# EPIC · Agent 运行时深化(plan-once → Agent Loop)

把对话/任务 agent 从"一次规划→全执行→收尾"的工作流引擎,深化为会"边做边看、按需续跑"的真 agent。设计与术语见仓库根 **CONTEXT.md**(Agent Loop / continuation-replan / trace store / Reflection gate / stall guard)。

## 来历
经 `improve-codebase-architecture` review → grilling → 二次 review 收敛而来。终态是 Agent Loop(`next(state, observation) → Act/Replan/Pause/Finalize`),但**第一步走务实增量**(continuation-replan),纯 ReAct 留作 Phase 2。

## 子票
- **[0001] 续跑且带观察(continuation-replan + scratchpad)** — 拱心石,AFK
- **[0002] stall guard:无进展检测** — AFK,blocked by 0001
- **[0003] Reflection gate:合并两个 critic + Finalize 检查** — HITL→AFK,blocked by 0001
- **[0004] 修 `/echo` 输入旁路** — 题外独立 bug,AFK

## Phase 2(暂缓,不发子票)
纯 ReAct(每步一次 LLM)藏 `mode: plan_once | react` flag 共存。**上之前先估算延迟**(典型任务 1–5 步 × 每次 LLM ~2–4s ≈ 15–30s),卡临界再 `prototype` 实测。放弃"直接替换核心循环"。

## 不可动约束
M7 topic coordination(合并/排队/出队)、approval/ask_user 暂停语义、budget 硬顶、worker pickup 模型。
