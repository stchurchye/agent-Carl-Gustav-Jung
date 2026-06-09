-- M1c：steer 持久改向字段。
-- steer 接到 M1c LLM planner 后,改向指令原本只 stash 在「紧接的一条 replan step」里,
-- 之后若 run 有剩余 todo → continuation replan 会覆盖最近 replan → buildInitialPlan 读不到
-- steer directive,加上原 input_text 的引力 → 漂回原主题(活体实测:终稿仍大段原主题)。
-- 持久化到 run 级列:steer 时写入,buildInitialPlan 每次都注入,直到下一次 steer 覆盖。
-- null = 该 run 未被 steer 过。deny 的对称持久化在迁移 025(denied_tools 列)。
ALTER TABLE agent_runs
  ADD COLUMN steer_directive TEXT;
