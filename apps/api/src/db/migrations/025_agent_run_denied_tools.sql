-- M1c：被拒工具持久列(与 steer_directive 对称)。
-- deny 接 M1c LLM planner 后,被拒工具的「避开」指令原本只 stash 在紧接的一条 replan step,
-- 之后 continuation/critique replan 覆盖最近 replan → buildInitialPlan 读不到 → LLM 可重规划
-- 被拒工具 → 再撞审批门 → (高成本)60s 自动 deny → 反复。持久成 run 级列:deny 时 append,
-- buildInitialPlan 每次都注入「不要调用 X」,直到 run 结束。JSONB 字符串数组;null = 无被拒工具。
ALTER TABLE agent_runs
  ADD COLUMN denied_tools JSONB;
