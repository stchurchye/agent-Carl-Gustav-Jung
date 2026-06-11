import { Hono } from 'hono';
import { ErrorCodes } from '@xzz/shared';
import { jsonError } from '../lib/errors.js';
import type { AppVariables } from '../types.js';
import {
  DeepSeekError,
  getApiKeyFromRequest,
  hasApiKeyConfigured,
  verifyDeepSeekKey,
} from '../lib/deepseek.js';
import {
  hasZenMuxKeyConfigured,
  verifyZenMuxKey,
  ZenMuxError,
  getZenMuxKeyFromRequest,
} from '../lib/zenmux.js';
import {
  hasDashScopeKeyConfigured,
  verifyDashScopeKey,
  DashScopeError,
  getDashScopeKeyFromRequest,
} from '../lib/dashscope.js';
import {
  ZENMUX_MODEL_FLASH_LITE,
  QWEN_TTS_MODEL,
  ZENMUX_CHAT_MODELS,
  ZENMUX_CHAT_DEFAULT_MODEL,
} from '@xzz/shared';
import { log } from '../lib/logger.js';
import { requireAuth } from '../middleware/auth.js';

export const settingsRouter = new Hono<{ Variables: AppVariables }>();

settingsRouter.use('*', requireAuth);

settingsRouter.get('/deepseek', (c) => {
  const headerKey = c.req.header('X-DeepSeek-Api-Key');
  const configured = hasApiKeyConfigured(headerKey);
  const source = headerKey?.trim()
    ? 'app'
    : process.env.DEEPSEEK_API_KEY?.trim()
      ? 'server'
      : 'none';
  return c.json({
    ok: true,
    data: {
      configured,
      source,
      model: 'deepseek-v4-pro',
      displayName: 'DeepSeek Pro',
    },
    requestId: c.get('requestId'),
  });
});

settingsRouter.post('/deepseek/verify', async (c) => {
  let apiKey: string;
  try {
    apiKey = getApiKeyFromRequest(c.req.header('X-DeepSeek-Api-Key'));
  } catch {
    return jsonError(c, ErrorCodes.API_KEY_MISSING, 400);
  }

  try {
    await verifyDeepSeekKey(apiKey);
    log('info', 'deepseek.verify.ok', { requestId: c.get('requestId') });
    return c.json({
      ok: true,
      data: { valid: true, message: '密钥可用，Bow wow 随时待命' },
      requestId: c.get('requestId'),
    });
  } catch (e) {
    const msg =
      e instanceof DeepSeekError
        ? e.message
        : '密钥验证失败，请检查是否复制完整';
    log('warn', 'deepseek.verify.fail', {
      requestId: c.get('requestId'),
      error: msg,
    });
    return c.json({
      ok: false,
      message: msg,
      hint: '请前往 platform.deepseek.com 申请或核对密钥',
      code: 'DEEPSEEK_AUTH',
      requestId: c.get('requestId'),
      retryable: true,
    }, 401);
  }
});

settingsRouter.get('/zenmux', (c) => {
  const headerKey = c.req.header('X-ZenMux-Api-Key');
  const configured = hasZenMuxKeyConfigured(headerKey);
  const source = headerKey?.trim()
    ? 'app'
    : process.env.ZENMUX_API_KEY?.trim()
      ? 'server'
      : 'none';
  return c.json({
    ok: true,
    data: {
      configured,
      source,
      model: ZENMUX_MODEL_FLASH_LITE,
      displayName: 'ZenMux · Gemini 2.5 Flash Lite',
    },
    requestId: c.get('requestId'),
  });
});

settingsRouter.post('/zenmux/verify', async (c) => {
  let apiKey: string;
  try {
    apiKey = getZenMuxKeyFromRequest(c.req.header('X-ZenMux-Api-Key'));
  } catch {
    return jsonError(c, ErrorCodes.ZENMUX_KEY_MISSING, 400);
  }

  try {
    await verifyZenMuxKey(apiKey);
    log('info', 'zenmux.verify.ok', { requestId: c.get('requestId') });
    return c.json({
      ok: true,
      data: { valid: true, message: '密钥可用，识图和云端听写已准备好' },
      requestId: c.get('requestId'),
    });
  } catch (e) {
    const msg =
      e instanceof ZenMuxError ? e.message : '密钥验证失败，请检查是否复制完整';
    log('warn', 'zenmux.verify.fail', { requestId: c.get('requestId'), error: msg });
    return c.json(
      {
        ok: false,
        message: msg,
        hint: '请前往 zenmux.ai 申请或核对密钥',
        code: 'ZENMUX_AUTH',
        requestId: c.get('requestId'),
        retryable: true,
      },
      401,
    );
  }
});

settingsRouter.get('/dashscope', (c) => {
  const headerKey = c.req.header('X-DashScope-Api-Key');
  const configured = hasDashScopeKeyConfigured(headerKey);
  const source = headerKey?.trim()
    ? 'app'
    : process.env.DASHSCOPE_API_KEY?.trim()
      ? 'server'
      : 'none';
  return c.json({
    ok: true,
    data: {
      configured,
      source,
      model: QWEN_TTS_MODEL,
      displayName: 'Qwen3-TTS',
    },
    requestId: c.get('requestId'),
  });
});

settingsRouter.post('/dashscope/verify', async (c) => {
  let apiKey: string;
  try {
    apiKey = getDashScopeKeyFromRequest(c.req.header('X-DashScope-Api-Key'));
  } catch {
    return jsonError(c, ErrorCodes.DASHSCOPE_KEY_MISSING, 400);
  }

  try {
    await verifyDashScopeKey(apiKey);
    log('info', 'dashscope.verify.ok', { requestId: c.get('requestId') });
    return c.json({
      ok: true,
      data: { valid: true, message: '密钥可用，Qwen3 朗读已准备好' },
      requestId: c.get('requestId'),
    });
  } catch (e) {
    const msg =
      e instanceof DashScopeError ? e.message : '密钥验证失败，请检查是否复制完整';
    log('warn', 'dashscope.verify.fail', { requestId: c.get('requestId'), error: msg });
    return c.json(
      {
        ok: false,
        message: msg,
        hint: '请前往阿里云百炼控制台申请或核对 API Key',
        code: 'DASHSCOPE_AUTH',
        requestId: c.get('requestId'),
        retryable: true,
      },
      401,
    );
  }
});

settingsRouter.get('/chat-models', (c) => {
  return c.json({
    ok: true,
    data: {
      models: ZENMUX_CHAT_MODELS,
      defaultModel: ZENMUX_CHAT_DEFAULT_MODEL,
    },
    requestId: c.get('requestId'),
  });
});
