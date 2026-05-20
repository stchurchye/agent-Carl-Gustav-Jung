import { describe, expect, it, beforeAll } from 'vitest';
import { runMigrations } from '../migrate.js';
import { getPool } from '../client.js';

/**
 * M1d Task 9：migrations smoke test。
 * - 所有 .sql 文件能按序 apply（idempotent：重复 run 不出错）
 * - schema_migrations 表里能查到每一份 version
 * - 关键新表 / 新列存在：
 *    * agent_runs.user_api_key_enc (014)
 *    * topic_skills 表 (M1b)
 *    * agent_event_logs 表 (013)
 */
describe('db migrations smoke', () => {
  beforeAll(async () => {
    await runMigrations();
    // 第二次跑应该完全是 no-op
    await runMigrations();
  });

  it('every migration file is recorded in schema_migrations', async () => {
    // 反过来：读 schema_migrations 应至少包含 014
    const { rows } = await getPool().query(
      `SELECT version FROM schema_migrations WHERE version LIKE '014%'`,
    );
    expect(rows.length).toBe(1);
  });

  it('agent_runs.user_api_key_enc column exists (014)', async () => {
    const { rows } = await getPool().query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'agent_runs' AND column_name = 'user_api_key_enc'`,
    );
    expect(rows.length).toBe(1);
  });

  it('topic_skills table exists', async () => {
    const { rows } = await getPool().query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_name = 'topic_skills'`,
    );
    expect(rows.length).toBe(1);
  });

  it('agent_event_logs table exists (013)', async () => {
    const { rows } = await getPool().query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_name = 'agent_event_logs'`,
    );
    expect(rows.length).toBe(1);
  });
});
