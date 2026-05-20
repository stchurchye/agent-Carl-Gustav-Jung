CREATE TABLE IF NOT EXISTS llm_request_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  response_time_ms INT,
  context_ratio REAL,
  session_id TEXT,
  group_id TEXT,
  topic_id TEXT,
  document_id TEXT,
  request_id TEXT,
  meta_line TEXT NOT NULL DEFAULT '',
  list_preview TEXT NOT NULL DEFAULT '',
  error_message TEXT,
  record JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_llm_request_logs_user_created
  ON llm_request_logs(user_id, created_at DESC);
