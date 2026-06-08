-- 023_topic_skill_source.sql
-- 技能自蒸馏(self-improvement loop):成功多步 run 收尾时把"这类任务怎么做"蒸馏成一条
-- user-scope topic_skill(enabled=false 待人评审)。这两列用于:
--   source        — 区分手写(NULL)与自动蒸馏('auto_distilled');UI 可分组"建议技能"。
--   source_run_id — 幂等去重(同一 run 重 finalize 不重复蒸馏) + 溯源。
-- append-only(D14):沿 022 之后,永不修改已 applied 的迁移。
ALTER TABLE topic_skills ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE topic_skills ADD COLUMN IF NOT EXISTS source_run_id TEXT;

CREATE INDEX IF NOT EXISTS idx_topic_skills_source_run
  ON topic_skills(owner_id, source_run_id)
  WHERE source_run_id IS NOT NULL;
