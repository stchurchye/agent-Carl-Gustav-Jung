CREATE TABLE IF NOT EXISTS llm_invoke_jobs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
  topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  session_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  invoker_user_id TEXT NOT NULL REFERENCES users(id),
  payload JSONB NOT NULL DEFAULT '{}',
  result_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_llm_jobs_group ON llm_invoke_jobs(group_id, created_at DESC);

CREATE TABLE IF NOT EXISTS intent_turns (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orchestration_runs (
  id TEXT PRIMARY KEY,
  intent_turn_id TEXT REFERENCES intent_turns(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS btw_exchanges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
  topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_btw_user ON btw_exchanges(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS context_compactions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memory_fragments (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
  topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  current_version_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_scope ON memory_fragments(scope, owner_id, group_id);

CREATE TABLE IF NOT EXISTS memory_fragment_versions (
  id TEXT PRIMARY KEY,
  fragment_id TEXT NOT NULL REFERENCES memory_fragments(id) ON DELETE CASCADE,
  version INT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'ai',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (fragment_id, version)
);

CREATE TABLE IF NOT EXISTS memory_provenance_links (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES memory_fragment_versions(id) ON DELETE CASCADE,
  message_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memory_usage_logs (
  id TEXT PRIMARY KEY,
  fragment_id TEXT NOT NULL REFERENCES memory_fragments(id) ON DELETE CASCADE,
  version_id TEXT REFERENCES memory_fragment_versions(id) ON DELETE SET NULL,
  job_id TEXT REFERENCES llm_invoke_jobs(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
