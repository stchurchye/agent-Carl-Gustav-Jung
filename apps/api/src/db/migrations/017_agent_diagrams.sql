-- M2 Task 5: agent_diagrams table
-- Stores mermaid diagram artifacts emitted by the render_diagram tool.
-- Kept separate from private_chat_messages / group_messages so mobile can
-- fetch diagram content by ID without re-parsing message payloads.

CREATE TABLE IF NOT EXISTS agent_diagrams (
  id        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  owner_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_id    TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
  step_id   TEXT,
  title     TEXT NOT NULL DEFAULT '',
  mermaid   TEXT NOT NULL,
  meta      JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_diagrams_owner ON agent_diagrams(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_diagrams_run ON agent_diagrams(run_id) WHERE run_id IS NOT NULL;
