-- M2 Task 1A: per-run sandbox state + JSONB bag for new user-provided API keys.
--
-- sandbox_id: ID of the E2B sandbox spawned by run_python; first call creates,
--   later calls reconnect. NULL after softComplete (we best-effort kill on
--   completed/failed/cancelled).
--
-- user_api_keys_enc: encrypted (secretBox v1) JSONB map of
--   { e2b?: string; exa?: string; fred?: string; jina?: string }.
--   Each value is the AES-256-GCM ciphertext envelope (same format as
--   user_api_key_enc / user_zenmux_key_enc). M2 forward-only: never replaces
--   the existing per-key columns; future migrations may consolidate.

ALTER TABLE agent_runs
  ADD COLUMN sandbox_id TEXT NULL,
  ADD COLUMN user_api_keys_enc JSONB NOT NULL DEFAULT '{}'::jsonb;
