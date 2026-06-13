import { expect, it, beforeAll, vi } from 'vitest';

vi.mock('../../lib/diaryGenerate.js', () => ({
  generateDiarySummary: vi.fn().mockResolvedValue('汪!测试日记。'),
  refineDiarySummary: vi.fn().mockResolvedValue('汪!矫正后的日记。'),
}));

import { Hono } from 'hono';
import { describeDb } from '../../testUtils/dbGuard.js';
import { runMigrations } from '../../db/migrate.js';
import { diaryRouter } from '../diary.js';
import { ensureUser, ensureGroup } from '../../lib/agent/__tests__/_groupFixture.js';
import { signAccessToken } from '../../lib/auth.js';
import type { AppVariables } from '../../types.js';

function makeApp() {
  return new Hono<{ Variables: AppVariables }>().route('/api/diary', diaryRouter);
}

function req(
  path: string,
  opts: { method?: string; token?: string; body?: unknown; key?: boolean } = {},
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.key) headers['X-ZenMux-Api-Key'] = 'test-key';
  return makeApp().fetch(
    new Request(`http://x${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
}

const DAY = '2026-06-20';
const WINDOW = { dayStartIso: '2026-06-20T00:00:00.000Z', dayEndIso: '2026-06-21T00:00:00.000Z' };

describeDb('diary routes', { timeout: 20000 }, () => {
  beforeAll(async () => {
    await runMigrations();
  });

  it('无 Authorization → 401', async () => {
    const res = await req('/api/diary/self');
    expect(res.status).toBe(401);
  });

  it('GET 非法 dayKey → 400', async () => {
    const u = await ensureUser('r-bad');
    const { accessToken } = await signAccessToken(u);
    const res = await req('/api/diary/self/2026-13-45', { token: accessToken });
    expect(res.status).toBe(400);
  });

  it('GET 不存在的某天 → 404', async () => {
    const u = await ensureUser('r-404');
    const { accessToken } = await signAccessToken(u);
    const res = await req(`/api/diary/self/${DAY}`, { token: accessToken });
    expect(res.status).toBe(404);
  });

  it('POST generate 缺窗口 → 400', async () => {
    const u = await ensureUser('r-nowin');
    const { accessToken } = await signAccessToken(u);
    const res = await req(`/api/diary/self/${DAY}/generate`, {
      method: 'POST', token: accessToken, key: true, body: {},
    });
    expect(res.status).toBe(400);
  });

  it('POST generate 非法 ISO 窗口 → 400', async () => {
    const u = await ensureUser('r-badwin');
    const { accessToken } = await signAccessToken(u);
    const res = await req(`/api/diary/self/${DAY}/generate`, {
      method: 'POST', token: accessToken, key: true,
      body: { dayStartIso: '2026-13-45', dayEndIso: 'nope' },
    });
    expect(res.status).toBe(400);
  });

  it('POST generate 群·非成员 → 403', async () => {
    const owner = await ensureUser('r-go');
    const { groupId } = await ensureGroup(owner.id);
    const stranger = await ensureUser('r-st');
    const { accessToken } = await signAccessToken(stranger);
    const res = await req(`/api/diary/group/${groupId}/${DAY}/generate`, {
      method: 'POST', token: accessToken, key: true, body: WINDOW,
    });
    expect(res.status).toBe(403);
  });

  it('POST generate self·happy → 200,返回 draft 篇;GET 能读回', async () => {
    const u = await ensureUser('r-ok');
    const { accessToken } = await signAccessToken(u);
    const gen = await req(`/api/diary/self/${DAY}/generate`, {
      method: 'POST', token: accessToken, key: true, body: WINDOW,
    });
    expect(gen.status).toBe(200);
    const genJson = (await gen.json()) as { data: { summary: string; status: string } };
    expect(genJson.data.summary).toBe('汪!测试日记。');
    expect(genJson.data.status).toBe('draft');

    const got = await req(`/api/diary/self/${DAY}`, { token: accessToken });
    expect(got.status).toBe(200);
  });

  it('POST refine 缺 instruction → 400', async () => {
    const u = await ensureUser('r-rf0');
    const { accessToken } = await signAccessToken(u);
    const res = await req(`/api/diary/self/${DAY}/refine`, {
      method: 'POST', token: accessToken, key: true, body: {},
    });
    expect(res.status).toBe(400);
  });

  it('POST refine 篇不存在 → 404', async () => {
    const u = await ensureUser('r-rf404');
    const { accessToken } = await signAccessToken(u);
    const res = await req(`/api/diary/self/${DAY}/refine`, {
      method: 'POST', token: accessToken, key: true, body: { instruction: '改改' },
    });
    expect(res.status).toBe(404);
  });

  it('POST refine happy:先 generate 再 refine → 200,正文换成矫正结果、回 draft', async () => {
    const u = await ensureUser('r-rf-ok');
    const { accessToken } = await signAccessToken(u);
    await req(`/api/diary/self/${DAY}/generate`, { method: 'POST', token: accessToken, key: true, body: WINDOW });
    const res = await req(`/api/diary/self/${DAY}/refine`, {
      method: 'POST', token: accessToken, key: true, body: { instruction: '写温暖点' },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { summary: string; status: string } };
    expect(json.data.summary).toBe('汪!矫正后的日记。');
    expect(json.data.status).toBe('draft');
  });
});
