CREATE INDEX IF NOT EXISTS idx_private_messages_content_gin
  ON private_chat_messages
  USING gin (to_tsvector('simple', coalesce(payload->>'content', '')));

CREATE INDEX IF NOT EXISTS idx_group_messages_content_gin
  ON group_messages
  USING gin (to_tsvector('simple', coalesce(payload->>'content', '')));
