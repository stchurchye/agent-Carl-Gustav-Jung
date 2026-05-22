-- M3 Task 1: parent_run_id (for deep_research child runs)
--          + pending_user_prompt + pending_user_step_idx (for ask_user resume)
ALTER TABLE agent_runs
  ADD COLUMN parent_run_id TEXT NULL REFERENCES agent_runs(id) ON DELETE SET NULL,
  ADD COLUMN pending_user_prompt TEXT NULL,
  ADD COLUMN pending_user_step_idx INTEGER NULL;
CREATE INDEX idx_agent_runs_parent ON agent_runs(parent_run_id) WHERE parent_run_id IS NOT NULL;
