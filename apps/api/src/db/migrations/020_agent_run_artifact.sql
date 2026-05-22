-- M5A Task 1：agent_runs.artifact JSONB NULL —— 終態産物（finalContent + 結構化 refs + 模型快照）
-- 與 summary 平級；softComplete 在同一次 update 寫入，避免讀取順序競態。
ALTER TABLE agent_runs
  ADD COLUMN artifact JSONB NULL;
