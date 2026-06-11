import { expect, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { describeDb, itDb } from '../../testUtils/dbGuard.js';
import { runMigrations } from '../../db/migrate.js';
import { getPool } from '../../db/client.js';
import { insertLlmRequestLog, listLlmRequestLogs } from '../pg-llm-logs.js';
import type { LlmRequestLogDetail } from '@xzz/shared';

/**
 * Review 2026-06-11 [P1][security] llmRequestLog 配套:
 * 调试日志含用户消息,不该无限期留存 —— 每用户条数上限之外补 14 天 TTL。
 */
function makeDetail(id: string, createdAt: string): LlmRequestLogDetail {
  return {
    id,
    createdAt,
    channel: 'chat',
    channelLabel: '聊天',
    provider: 'deepseek',
    model: 'deepseek-chat',
    status: 'ok',
    metaLine: 'meta',
    listPreview: 'preview',
    messages: [{ role: 'user', content: 'hello' }],
    displayTurns: [],
    rawJson: '{}',
  } as unknown as LlmRequestLogDetail;
}

describeDb('llm_request_logs 时间留存(TTL)', () => {
  const userId = randomUUID();

  beforeAll(async () => {
    await runMigrations();
    await getPool().query(
      `INSERT INTO users (id, username, password_hash, display_name, created_at)
       VALUES ($1, $2, 'x', 'ttl-user', now()) ON CONFLICT DO NOTHING`,
      [userId, `ttl-${userId.slice(0, 8)}`],
    );
  });

  beforeEach(async () => {
    await getPool().query('DELETE FROM llm_request_logs WHERE user_id = $1', [userId]);
  });

  itDb('插入新日志时,超过 14 天的旧日志被清理;14 天内的保留', async () => {
    const old = new Date(Date.now() - 15 * 24 * 3600 * 1000).toISOString();
    const recent = new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString();
    await insertLlmRequestLog(userId, makeDetail(randomUUID(), old));
    await insertLlmRequestLog(userId, makeDetail(randomUUID(), recent));
    await insertLlmRequestLog(userId, makeDetail(randomUUID(), new Date().toISOString()));

    const rows = await listLlmRequestLogs(userId);
    expect(rows).toHaveLength(2); // 15 天前的那条被 TTL 清掉
  });
});
