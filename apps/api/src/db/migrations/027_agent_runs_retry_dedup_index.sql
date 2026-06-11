-- review P2(agent.ts:390):retry 10s 去重查询按 (owner_id, input_text, created_at) 过滤,
-- 此前只能靠 idx_agent_runs_owner 范围扫后过滤 input_text。
-- 注意:不直接索引 input_text —— 超长文本会撞 btree 单行上限(~2704B)导致插入失败,
-- 用 md5(input_text) 表达式索引;查询侧配合 md5(input_text)=md5($2) 等值命中。
CREATE INDEX IF NOT EXISTS idx_agent_runs_retry_dedup
  ON agent_runs (owner_id, md5(input_text), created_at DESC);
