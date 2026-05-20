ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_display_key TEXT,
  ADD COLUMN IF NOT EXISTS avatar_original_key TEXT;

CREATE TABLE IF NOT EXISTS user_display_name_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_display_name_history_user
  ON user_display_name_history (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_avatar_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_storage_key TEXT NOT NULL,
  display_storage_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_avatar_history_user
  ON user_avatar_history (user_id, created_at DESC);
