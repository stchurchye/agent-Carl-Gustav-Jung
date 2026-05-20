import { Hono } from 'hono';
import { ErrorCodes } from '@xzz/shared';
import type { AppVariables } from '../types.js';
import { jsonError } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { getLlmRequestLog, listLlmRequestLogs } from '../lib/llmRequestLog.js';

export const llmLogsRouter = new Hono<{ Variables: AppVariables }>();

llmLogsRouter.use('*', requireAuth);

llmLogsRouter.get('/', async (c) => {
  const userId = c.get('userId')!;
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? 50)));
  const data = await listLlmRequestLogs(userId, limit);
  return c.json({ ok: true, data, requestId: c.get('requestId') });
});

llmLogsRouter.get('/:id', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const detail = await getLlmRequestLog(userId, id);
  if (!detail) {
    return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  }
  return c.json({ ok: true, data: detail, requestId: c.get('requestId') });
});
