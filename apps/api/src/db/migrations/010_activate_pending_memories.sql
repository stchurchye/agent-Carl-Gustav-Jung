-- 记忆策略：自动提炼默认生效，历史 pending 一并激活
UPDATE memory_fragments
SET status = 'active', updated_at = NOW()
WHERE status = 'pending';
