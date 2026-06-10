# [0005] plan 含未注册 toolName → run 永停 planning 无终态

## Parent
EPIC: 0000-epic-agent-loop-deepening(独立防御性修复,与深化主线无依赖;源自 E2E campaign 候选 finding F-A)

## What to build
现状:planner 产出的 plan 步骤若引用**未注册的 toolName**(LLM 幻造工具名),run 不产 step、status **永停 planning**(>1min 无终态、无 error)。`toolRegistry.require` 只在 dispatch 时抛 `unknown tool`,planning 阶段接受 plan 前无校验,也没有兜底把悬挂 run 打进终态。prompt 里虽禁止幻造工具名,但真实 LLM 偶发幻觉即触发——这是一条生产环境"run 静默悬挂"的路径。

实测证据:campaign 2026-06-08 用 test-only 的 `risky_echo`(未注册)注入 plan 复现(docs/reports/test-campaign-2026-06-08.md「候选 finding F-A」)。

修法:接受 plan 前(buildInitialPlan / 重规划同路径)校验所有 `step.toolName ∈ toolRegistry`;含未知工具 → 带失败原因触发一次 replan(planner 可见"工具 X 不存在,只能用注册表内工具");replan 后仍未知 → run 进 `failed`(终态),不悬挂。

## Acceptance criteria
- [ ] plan 含未注册 toolName → 不再停 planning:先触发一次带原因的 replan。
- [ ] replan 后仍含未知工具 → run 进 `failed` 终态,error 写明未知工具名。
- [ ] 合法 plan 行为不变(657 存量 vitest 不回归)。
- [ ] 测试:① 未知 toolName → replan 路径;② 二次仍未知 → failed;③ 子 agent run(角色裁剪后的工具表)同样适用。

## Blocked by
None - can start immediately
