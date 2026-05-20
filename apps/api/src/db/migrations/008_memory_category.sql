ALTER TABLE memory_fragments
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'general';

ALTER TABLE memory_fragments
  DROP CONSTRAINT IF EXISTS memory_fragments_category_check;

ALTER TABLE memory_fragments
  ADD CONSTRAINT memory_fragments_category_check
  CHECK (category IN ('user_profile', 'project_note', 'general'));

CREATE INDEX IF NOT EXISTS idx_memory_category
  ON memory_fragments (owner_id, scope, category, updated_at DESC)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS user_memory_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  auto_extract_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
