import { Hono } from 'hono';
import { ErrorCodes, REPLY_DIALECT_HEADER } from '@xzz/shared';
import { jsonError } from '../lib/errors.js';
import type { AppVariables } from '../types.js';
import { getDashScopeKey, handleDashScopeError } from '../lib/dashscope-handler.js';
import { DashScopeError, qwen3TtsSynthesize } from '../lib/dashscope.js';
import { parseReplyDialect } from '../lib/deepseek.js';
import { log } from '../lib/logger.js';
import { requireAuth } from '../middleware/auth.js';

export const ttsRouter = new Hono<{ Variables: AppVariables }>();

ttsRouter.use('*', requireAuth);

ttsRouter.post('/', async (c) => {
  const body = await c.req.json<{
    text?: string;
    voice?: string;
    dialect?: string;
  }>();

  const text = body.text?.trim();
  if (!text) {
    return jsonError(c, ErrorCodes.VALIDATION, 400);
  }

  const dialect = parseReplyDialect(
    body.dialect ?? c.req.header(REPLY_DIALECT_HEADER),
  );

  log('info', 'tts.request', {
    requestId: c.get('requestId'),
    chars: text.length,
    voice: body.voice ?? 'default',
    dialect,
  });

  try {
    const apiKey = getDashScopeKey(c);
    const { audioUrl, audioBase64 } = await qwen3TtsSynthesize({
      apiKey,
      text,
      voice: body.voice,
      dialect,
    });
    log('info', 'tts.ok', { requestId: c.get('requestId'), chars: text.length, dialect });
    return c.json({
      ok: true,
      data: { audioUrl, audioBase64 },
      requestId: c.get('requestId'),
    });
  } catch (e) {
    if (e instanceof DashScopeError && e.message === 'DASHSCOPE_KEY_MISSING') {
      return jsonError(c, ErrorCodes.DASHSCOPE_KEY_MISSING, 400);
    }
    return handleDashScopeError(c, e);
  }
});
