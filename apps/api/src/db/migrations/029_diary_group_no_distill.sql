-- 隐私不变式 DB 级兜底:群日记永不蒸馏进记忆(含群友实名言行,不写进任何人的持久记忆),
-- 故 scope='group' 的篇 status 不得为 'distilled'。把「群篇只到 confirmed」从应用层逻辑
-- 提升为 schema 约束,杜绝未来回归/脏数据绕过 confirmDiaryForDay 的 self-only 守卫。
ALTER TABLE diary_entries
  ADD CONSTRAINT diary_group_not_distilled
  CHECK (scope <> 'group' OR status <> 'distilled');
