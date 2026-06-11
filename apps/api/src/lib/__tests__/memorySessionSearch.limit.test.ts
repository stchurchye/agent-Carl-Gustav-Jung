import { beforeAll, expect } from 'vitest';
import { describeDb, itDb } from '../../testUtils/dbGuard.js';
import { runMigrations } from '../../db/migrate.js';
import { searchSessionMessages } from '../memorySessionSearch.js';

/**
 * Review 2026-06-11 [P2][api-routes-store] memory.ts:98(PLAUSIBLE → 验证为真)
 * limit 只有上限钳制(Math.min(...,30)):?limit=-1 / ?limit=abc(NaN)直达
 * SQL LIMIT → PostgreSQL 报错 500。修后:钳到 [1,30],非数值回默认 15。
 */
describeDb('searchSessionMessages limit 钳制', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  itDb('limit=-1 不再 500,正常返回数组', async () => {
    const hits = await searchSessionMessages({
      userId: '00000000-0000-0000-0000-000000000000',
      query: '随便搜搜',
      limit: -1,
    });
    expect(Array.isArray(hits)).toBe(true);
  });

  itDb('limit=NaN 回默认,正常返回数组', async () => {
    const hits = await searchSessionMessages({
      userId: '00000000-0000-0000-0000-000000000000',
      query: '随便搜搜',
      limit: Number('abc'),
    });
    expect(Array.isArray(hits)).toBe(true);
  });
});
