-- AI 自动写入的记忆进入审核收件箱；用户「保留」后不再展示
ALTER TABLE memory_fragments
  ADD COLUMN IF NOT EXISTS review_dismissed_at TIMESTAMPTZ;

-- 历史 pending 已在 010 激活；未审核的 AI 记忆进入收件箱
UPDATE memory_fragments f
SET review_dismissed_at = NULL
WHERE f.status = 'active'
  AND f.review_dismissed_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM memory_fragment_versions v
    WHERE v.id = f.current_version_id
      AND v.source = 'ai'
  );
