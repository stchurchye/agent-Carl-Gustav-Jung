-- M1d Task 6: store per-user DeepSeek API key on agent_runs so the background
-- worker can use the same key the user typed at chip-confirm time, instead of
-- silently falling back to the server key (which may belong to a different
-- account / billing).
--
-- Key is stored encrypted as base64 of: iv (12B) || authTag (16B) || ciphertext.
-- Encryption key is derived from env $AGENT_KEY_SECRET via SHA-256. If the env
-- var is not set, the API refuses to store user keys (server key path still
-- works, like before).

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS user_api_key_enc TEXT;
