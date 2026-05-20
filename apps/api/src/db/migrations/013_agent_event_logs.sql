-- Agent runtime hook bus event log (M1b-3).
-- 由 logHook 消费 agentHookBus，把每个事件落表，便于排查 / 后续 webhook 路由。
CREATE TABLE IF NOT EXISTS agent_event_logs (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  run_id TEXT,
  user_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_event_logs_run_created
  ON agent_event_logs(run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_event_logs_type_created
  ON agent_event_logs(event_type, created_at DESC);
