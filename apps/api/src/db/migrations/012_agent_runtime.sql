CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('private','group')),
  session_id TEXT REFERENCES private_chat_sessions(id) ON DELETE CASCADE,
  group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
  topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  intent_turn_id TEXT REFERENCES intent_turns(id) ON DELETE SET NULL,
  role TEXT NOT NULL DEFAULT 'generalist',
  status TEXT NOT NULL,
  input_text TEXT NOT NULL,
  plan JSONB,
  todos JSONB NOT NULL DEFAULT '[]'::jsonb,
  budget JSONB NOT NULL,
  usage JSONB NOT NULL DEFAULT '{}'::jsonb,
  api_key_owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  api_key_source TEXT NOT NULL CHECK (api_key_source IN ('user','server')),
  result_message_id TEXT,
  invoke_message_id TEXT,
  last_heartbeat_at TIMESTAMPTZ,
  awaiting_approval_until TIMESTAMPTZ,
  awaiting_approval_step_idx INT,
  pending_approval_tool_name TEXT,
  cancelled_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  cancel_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_pickup
  ON agent_runs(status, last_heartbeat_at)
  WHERE status IN ('draft','planning','running','replanning');

CREATE INDEX IF NOT EXISTS idx_agent_runs_topic
  ON agent_runs(group_id, topic_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_runs_owner
  ON agent_runs(owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_runs_session
  ON agent_runs(session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  idx INT NOT NULL,
  kind TEXT NOT NULL,
  tool_name TEXT,
  tool_call_key TEXT,
  input JSONB,
  output JSONB,
  tokens INT NOT NULL DEFAULT 0,
  duration_ms INT NOT NULL DEFAULT 0,
  error TEXT,
  by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, idx)
);

CREATE INDEX IF NOT EXISTS idx_agent_steps_run ON agent_steps(run_id, idx);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_steps_tool_call_key
  ON agent_steps(run_id, tool_call_key)
  WHERE tool_call_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS topic_skills (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('topic','user','group')),
  owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
  topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by_user_id TEXT NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_topic_skills_scope
  ON topic_skills(scope, owner_id, group_id, topic_id)
  WHERE enabled = TRUE;
