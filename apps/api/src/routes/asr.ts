import { Hono } from 'hono';
import { ErrorCodes } from '@xzz/shared';
import { jsonError } from '../lib/errors.js';
import type { AppVariables } from '../types.js';
import { getZenMuxKey, handleZenMuxError } from '../lib/zenmux-handler.js';
import { hasZenMuxKeyConfigured, zenmuxTranscribe, ZenMuxError } from '../lib/zenmux.js';
import { log } from '../lib/logger.js';
import { requireAuth } from '../middleware/auth.js';

export const asrRouter = new Hono<{ Variables: AppVariables }>();

asrRouter.use('*', requireAuth);

/** 语音转文字：ZenMux · google/gemini-2.5-flash-lite */
asrRouter.post('/', async (c) => {
  const body = await c.req.json<{
    audioBase64?: string;
    format?: string;
  }>();

  const zenHeader = c.req.header('X-ZenMux-Api-Key');

  log('info', 'asr.request', {
    requestId: c.get('requestId'),
    format: body.format ?? 'mp4',
    hasZenMux: hasZenMuxKeyConfigured(zenHeader),
  });

  const audioBase64 = body.audioBase64?.trim();
  if (!audioBase64 || audioBase64.length < 32) {
    return jsonError(c, ErrorCodes.VALIDATION, 400);
  }
  if (audioBase64.length > 25_000_000) {
    return jsonError(c, ErrorCodes.VALIDATION, 400);
  }

  const format = body.format ?? 'm4a';

  try {
    const apiKey = getZenMuxKey(c);
    const text = await zenmuxTranscribe({
      apiKey,
      audioBase64,
      format,
    });
    if (!text || text === '（未听清）') {
      return jsonError(c, ErrorCodes.ASR_EMPTY, 422);
    }
    log('info', 'asr.ok', {
      requestId: c.get('requestId'),
      provider: 'zenmux',
      model: 'google/gemini-2.5-flash-lite',
      chars: text.length,
    });
    return c.json({ ok: true, data: { text }, requestId: c.get('requestId') });
  } catch (e) {
    if (e instanceof ZenMuxError && e.message === 'ZENMUX_KEY_MISSING') {
      return jsonError(c, ErrorCodes.ZENMUX_KEY_MISSING, 400);
    }
    return handleZenMuxError(c, e);
  }
});
