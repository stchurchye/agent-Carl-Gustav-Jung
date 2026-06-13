import { Hono, type Context } from 'hono';
import type { AppVariables } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { jsonError } from '../lib/errors.js';
import {
  ErrorCodes,
  REPLY_DIALECT_HEADER,
  isValidDiaryDayKey,
  type DiaryScope,
} from '@xzz/shared';
import { parseReplyDialect } from '../lib/deepseek.js';
import { getZenMuxKey, handleZenMuxError } from '../lib/zenmux-handler.js';
import { getDiaryEntry, listDiaryEntries } from '../store/pg-diary.js';
import { generateDiaryForDay, refineDiaryForDay } from '../lib/diaryService.js';

export const diaryRouter = new Hono<{ Variables: AppVariables }>();

diaryRouter.use('*', requireAuth);

// ---------- 列表 ----------
diaryRouter.get('/self', async (c) => {
  const data = await listDiaryEntries(c.get('userId')!, { scope: 'self', scopeId: '' });
  return c.json({ ok: true, data, requestId: c.get('requestId') });
});

diaryRouter.get('/group/:groupId', async (c) => {
  const data = await listDiaryEntries(c.get('userId')!, {
    scope: 'group',
    scopeId: c.req.param('groupId'),
  });
  return c.json({ ok: true, data, requestId: c.get('requestId') });
});

// ---------- 取某天一篇 ----------
async function handleGet(c: Context<{ Variables: AppVariables }>, scope: DiaryScope, scopeId: string) {
  const dayKey = c.req.param('dayKey');
  if (!dayKey || !isValidDiaryDayKey(dayKey)) return jsonError(c, ErrorCodes.VALIDATION, 400);
  const entry = await getDiaryEntry(c.get('userId')!, scope, scopeId, dayKey);
  if (!entry) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  return c.json({ ok: true, data: entry, requestId: c.get('requestId') });
}
diaryRouter.get('/self/:dayKey', (c) => handleGet(c, 'self', ''));
diaryRouter.get('/group/:groupId/:dayKey', (c) => handleGet(c, 'group', c.req.param('groupId')));

// ---------- 生成/重生成(client 传本地时区算出的 UTC 窗口) ----------
async function handleGenerate(
  c: Context<{ Variables: AppVariables }>,
  scope: DiaryScope,
  scopeId: string,
) {
  const dayKey = c.req.param('dayKey');
  if (!dayKey || !isValidDiaryDayKey(dayKey)) return jsonError(c, ErrorCodes.VALIDATION, 400);
  const body = await c.req
    .json<{ dayStartIso?: string; dayEndIso?: string }>()
    .catch(() => ({}) as { dayStartIso?: string; dayEndIso?: string });
  if (!body.dayStartIso || !body.dayEndIso) return jsonError(c, ErrorCodes.VALIDATION, 400);
  // 校验是合法 ISO 时间且 start < end —— 否则非法时间戳会进 SQL created_at 比较、被 PG 拒绝
  const startMs = Date.parse(body.dayStartIso);
  const endMs = Date.parse(body.dayEndIso);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || startMs >= endMs) {
    return jsonError(c, ErrorCodes.VALIDATION, 400);
  }

  let apiKey: string;
  try {
    apiKey = getZenMuxKey(c);
  } catch (e) {
    return handleZenMuxError(c, e);
  }
  const dialect = parseReplyDialect(c.req.header(REPLY_DIALECT_HEADER));
  try {
    const entry = await generateDiaryForDay({
      userId: c.get('userId')!,
      scope,
      scopeId,
      dayKey,
      dayStartIso: body.dayStartIso,
      dayEndIso: body.dayEndIso,
      apiKey,
      dialect,
    });
    if (!entry) return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403); // 群非成员
    return c.json({ ok: true, data: entry, requestId: c.get('requestId') });
  } catch (e) {
    return handleZenMuxError(c, e);
  }
}
diaryRouter.post('/self/:dayKey/generate', (c) => handleGenerate(c, 'self', ''));
diaryRouter.post('/group/:groupId/:dayKey/generate', (c) =>
  handleGenerate(c, 'group', c.req.param('groupId')),
);

// ---------- 矫正(跟 bow wow 聊着改) ----------
async function handleRefine(
  c: Context<{ Variables: AppVariables }>,
  scope: DiaryScope,
  scopeId: string,
) {
  const dayKey = c.req.param('dayKey');
  if (!dayKey || !isValidDiaryDayKey(dayKey)) return jsonError(c, ErrorCodes.VALIDATION, 400);
  const body = await c.req
    .json<{ instruction?: string }>()
    .catch(() => ({}) as { instruction?: string });
  const instruction = body.instruction?.trim();
  if (!instruction) return jsonError(c, ErrorCodes.VALIDATION, 400);

  let apiKey: string;
  try {
    apiKey = getZenMuxKey(c);
  } catch (e) {
    return handleZenMuxError(c, e);
  }
  const dialect = parseReplyDialect(c.req.header(REPLY_DIALECT_HEADER));
  try {
    const entry = await refineDiaryForDay({
      userId: c.get('userId')!,
      scope,
      scopeId,
      dayKey,
      instruction,
      apiKey,
      dialect,
    });
    if (!entry) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
    return c.json({ ok: true, data: entry, requestId: c.get('requestId') });
  } catch (e) {
    return handleZenMuxError(c, e);
  }
}
diaryRouter.post('/self/:dayKey/refine', (c) => handleRefine(c, 'self', ''));
diaryRouter.post('/group/:groupId/:dayKey/refine', (c) =>
  handleRefine(c, 'group', c.req.param('groupId')),
);
