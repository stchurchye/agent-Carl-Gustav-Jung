-- M4 Task 1: pending_user_input_expires_at (24h timeout for ask_user)
--          + summary JSONB (一次性聚合 step / tool / ref 计数)
ALTER TABLE agent_runs
  ADD COLUMN pending_user_input_expires_at TIMESTAMPTZ NULL,
  ADD COLUMN summary JSONB NULL;

-- 加速 worker tick 的过期扫描：只对仍在 awaiting_user_input 的 run 建条件索引。
CREATE INDEX idx_agent_runs_pending_user_input_expires
  ON agent_runs(pending_user_input_expires_at)
  WHERE status = 'awaiting_user_input' AND pending_user_input_expires_at IS NOT NULL;
