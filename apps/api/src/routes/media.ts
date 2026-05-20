import { Hono } from 'hono';
import { ErrorCodes } from '@xzz/shared';
import type { AppVariables } from '../types.js';
import { jsonError } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import * as social from '../store/pg-social.js';

const MAX_BYTES = 12 * 1024 * 1024;

export const mediaRouter = new Hono<{ Variables: AppVariables }>();

mediaRouter.use('*', requireAuth);

mediaRouter.post('/upload', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json<{
    mimeType?: string;
    dataUrl?: string;
  }>();
  const mimeType = body.mimeType?.trim() || 'image/jpeg';
  const dataUrl = body.dataUrl?.trim();
  if (!dataUrl?.startsWith('data:')) {
    return jsonError(c, ErrorCodes.VALIDATION, 400);
  }
  if (dataUrl.length > MAX_BYTES * 1.4) {
    return jsonError(c, ErrorCodes.VALIDATION, 413);
  }
  const attachment = await social.saveMediaAttachment(userId, mimeType, dataUrl);
  return c.json({ ok: true, data: attachment, requestId: c.get('requestId') }, 201);
});
