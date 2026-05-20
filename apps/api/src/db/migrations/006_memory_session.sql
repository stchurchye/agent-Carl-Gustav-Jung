ALTER TABLE memory_fragments
  ADD COLUMN IF NOT EXISTS session_id TEXT REFERENCES private_chat_sessions(id) ON DELETE CASCADE;

ALTER TABLE memory_fragments
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS idx_memory_session
  ON memory_fragments(scope, owner_id, session_id)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_memory_status
  ON memory_fragments(owner_id, status, updated_at DESC);
