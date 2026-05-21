-- M1e Task 11d: per-run LLM provider + model selection + per-provider user key.
--
-- Why DEFAULT 'deepseek' / 'deepseek-v4-pro':
--   - existing rows will fill in safely without code-side `?? 'deepseek'` shims
--   - matches the existing prod behavior (M1c/M1d only used DeepSeek)
--
-- Why a separate user_zenmux_key_enc column instead of widening user_api_key_enc:
--   - User can supply a DeepSeek key AND a ZenMux key in the same run
--     (we won't always know at create time which provider the agent will pick)
--   - Reuses the same secretBox sealing pipeline (v1 format)
--
-- The agent_runs.user_api_key_enc column (added in 014) keeps its original
-- semantics = DeepSeek user key. No data migration needed.

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS provider_id TEXT NOT NULL DEFAULT 'deepseek',
  ADD COLUMN IF NOT EXISTS model_id    TEXT NOT NULL DEFAULT 'deepseek-v4-pro',
  ADD COLUMN IF NOT EXISTS user_zenmux_key_enc TEXT;
