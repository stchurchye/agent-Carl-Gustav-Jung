-- S1（context compaction）：累积式结构化 checkpoint。
-- 跨步累积的任务状态（goal/intent/completed[含 refs]/remainingPlan/openQuestions/nextStep/
-- successCount/producedAtIdx），单一真相源放 run 级 jsonb 列：
--   - S1 引入并在续跑/收尾点写入此列；旧的「把进展塞进 continuation replan step」仍并存，
--     待 S2/S3 把消费方（replyGen/reflection/planner）切到此列后退役。最终此列成单一真相源；
--   - 单行 → reload-before-update 即可保证 reclaim 重拾安全；
--   - O(1) 读写，免 listSteps 全表重读。
-- null = 还没产生 checkpoint。
ALTER TABLE agent_runs
  ADD COLUMN context_checkpoint JSONB;
