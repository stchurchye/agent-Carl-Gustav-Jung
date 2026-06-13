-- 每日日记 diary_entries:统一 scope 模型(个人 self + 群私有视角 group),每人每天每 scope 至多一篇。
-- 每篇唯一归 owner、私有;生成/矫正/蒸馏复用个人日记同一流程。group 篇是「我眼中的群」,不共享。
CREATE TABLE IF NOT EXISTS diary_entries (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'self' CHECK (scope IN ('self', 'group')),
  scope_id TEXT NOT NULL DEFAULT '',           -- self: ''; group: groupId(软引用,不硬外键 → 退群保留快照)
  scope_name TEXT,                             -- 群名快照,退群/删群后仍能展示「我眼中的{群名}」
  day_key TEXT NOT NULL,                        -- 'YYYY-MM-DD',按 owner 本地时区切分
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'distilled')),
  source_count INT NOT NULL DEFAULT 0,          -- 生成时纳入的消息条数(0 = 当天无对话)
  source_max_msg_id TEXT,                       -- 见过的最后一条消息 id(增量重算水位)
  distilled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, scope, scope_id, day_key)
);

CREATE INDEX IF NOT EXISTS idx_diary_owner_day ON diary_entries(owner_id, day_key DESC);

-- 个人日记按「owner 当天所有私聊消息」查询,而现有索引只按 session 维度。
-- 补 (owner_id, created_at) 索引,支持高效的按天聚合。
CREATE INDEX IF NOT EXISTS idx_private_messages_owner_created
  ON private_chat_messages(owner_id, created_at);
