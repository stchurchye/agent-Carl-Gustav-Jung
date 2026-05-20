import { describe, expect, it, beforeAll } from 'vitest';
import { getPool } from '../../../db/client.js';
import { runMigrations } from '../../../db/migrate.js';

describe('012_agent_runtime migration', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  it('creates agent_runs table with expected columns', async () => {
    const { rows } = await getPool().query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = 'agent_runs' ORDER BY ordinal_position`,
    );
    const names = rows.map((r) => r.column_name);
    expect(names).toEqual(
      expect.arrayContaining([
        'id', 'owner_id', 'channel', 'session_id', 'group_id', 'topic_id',
        'intent_turn_id', 'role', 'status', 'input_text', 'plan', 'todos',
        'budget', 'usage', 'api_key_owner_id', 'api_key_source',
        'result_message_id', 'invoke_message_id', 'last_heartbeat_at',
        'awaiting_approval_until', 'awaiting_approval_step_idx',
        'pending_approval_tool_name', 'cancelled_by_user_id', 'cancel_reason',
        'created_at', 'started_at', 'ended_at',
      ]),
    );
  });

  it('creates agent_steps table with expected columns', async () => {
    const { rows } = await getPool().query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'agent_steps' ORDER BY ordinal_position`,
    );
    const names = rows.map((r) => r.column_name);
    expect(names).toEqual(
      expect.arrayContaining([
        'id', 'run_id', 'idx', 'kind', 'tool_name', 'tool_call_key',
        'input', 'output', 'tokens', 'duration_ms', 'error', 'by_user_id',
        'created_at',
      ]),
    );
  });

  it('creates topic_skills table', async () => {
    const { rows } = await getPool().query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'topic_skills' ORDER BY ordinal_position`,
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('is idempotent — running migrations again does not throw', async () => {
    await expect(runMigrations()).resolves.toBeUndefined();
  });

  it('agent_steps has unique constraint on (run_id, tool_call_key)', async () => {
    const { rows } = await getPool().query(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'agent_steps'`,
    );
    const indexes = rows.map((r) => r.indexname);
    expect(indexes).toContain('idx_agent_steps_tool_call_key');
  });
});
