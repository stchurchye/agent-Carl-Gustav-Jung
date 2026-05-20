import { Hono } from 'hono';
import { ErrorCodes, OCR_RECOGNITION_PURPOSE } from '@xzz/shared';
import { jsonError } from '../lib/errors.js';
import type { AppVariables } from '../types.js';
import { getZenMuxKey, handleZenMuxError } from '../lib/zenmux-handler.js';
import { zenmuxOcr, ZenMuxError } from '../lib/zenmux.js';
import { log } from '../lib/logger.js';
import { requireAuth } from '../middleware/auth.js';

export const ocrRouter = new Hono<{ Variables: AppVariables }>();

ocrRouter.use('*', requireAuth);

ocrRouter.post('/', async (c) => {
  const body = await c.req.json<{
    imageBase64?: string;
    mimeType?: string;
    purpose?: string;
  }>();

  const imageBase64 = body.imageBase64?.trim();
  if (!imageBase64 || imageBase64.length < 32) {
    return jsonError(c, ErrorCodes.VALIDATION, 400);
  }
  if (imageBase64.length > 12_000_000) {
    return jsonError(c, ErrorCodes.VALIDATION, 400);
  }

  try {
    const apiKey = getZenMuxKey(c);
    const text = await zenmuxOcr({
      apiKey,
      imageBase64,
      mimeType: body.mimeType,
      purpose: OCR_RECOGNITION_PURPOSE,
    });
    log('info', 'ocr.ok', { requestId: c.get('requestId'), chars: text.length });
    return c.json({ ok: true, data: { text }, requestId: c.get('requestId') });
  } catch (e) {
    if (e instanceof ZenMuxError && e.message === 'ZENMUX_KEY_MISSING') {
      return jsonError(c, ErrorCodes.ZENMUX_KEY_MISSING, 400);
    }
    if (e instanceof ZenMuxError) {
      return jsonError(c, ErrorCodes.OCR_FAIL, 502);
    }
    return handleZenMuxError(c, e);
  }
});
