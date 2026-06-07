-- M7 子项目 B：群聊 Agent 并发协调
-- 包含：自动合并 + 排队 + ask_user 群聊扩展 + 两个 partial index。
--
-- 字段语义：
--   merged_inputs                    JSONB[]  追问数组 [{ text, byUserId, byUsername, at }]
--   merged_inputs_consumed_count     INT      runExecute 已注入到 planner / replan 的追问条数
--   queue_position                   INT      queued 时记位次（UI hint，非真源）
--   ask_user_target_user_id          TEXT     当前 ask_user 期待谁答（默认 = owner_id）
--   ask_user_started_at              TIMESTAMPTZ  本次 ask_user 进入 awaiting 的时刻
--                                                （独立于 last_heartbeat_at，后者被 worker 持续刷新）
--   ask_user_opened_for_all_at       TIMESTAMPTZ  worker checker 升级后 set
ALTER TABLE agent_runs
  ADD COLUMN merged_inputs JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN merged_inputs_consumed_count INT DEFAULT 0,
  ADD COLUMN queue_position INT,
  ADD COLUMN ask_user_target_user_id TEXT,
  ADD COLUMN ask_user_started_at TIMESTAMPTZ,
  ADD COLUMN ask_user_opened_for_all_at TIMESTAMPTZ;

-- blocking：真在跑的（不含 queued），acquireTopicSlot 用
CREATE INDEX IF NOT EXISTS idx_agent_runs_topic_blocking
  ON agent_runs(topic_id, created_at DESC)
  WHERE status IN ('draft','planning','running','replanning',
                   'awaiting_approval','awaiting_user_input');

-- queued：dequeueNextOnTopic 用，按入队时间升序
CREATE INDEX IF NOT EXISTS idx_agent_runs_topic_queued
  ON agent_runs(topic_id, created_at ASC)
  WHERE status = 'queued';
