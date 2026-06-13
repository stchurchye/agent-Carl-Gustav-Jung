import { ErrorCodes } from '@xzz/shared';
import type { Context } from 'hono';
import type { AppVariables } from '../types.js';
import { jsonError } from './errors.js';
import { DashScopeError, getDashScopeKeyFromRequest } from './dashscope.js';

export function getDashScopeKey(c: Context<{ Variables: AppVariables }>): string {
  try {
    return getDashScopeKeyFromRequest(c.req.header('X-DashScope-Api-Key'));
  } catch (e) {
    if (e instanceof DashScopeError && e.message === 'DASHSCOPE_KEY_MISSING') {
      throw e;
    }
    throw e;
  }
}

export function handleDashScopeError(c: Context<{ Variables: AppVariables }>, e: unknown) {
  if (e instanceof DashScopeError) {
    if (e.message === 'DASHSCOPE_KEY_MISSING') {
      return jsonError(c, ErrorCodes.DASHSCOPE_KEY_MISSING, 400);
    }
    if (e.status === 401 || e.status === 403) {
      return c.json(
        {
          ok: false,
          message: '百炼密钥不对或已失效，请在「我的」里重新填写',
          hint: '请前往阿里云百炼控制台核对 API Key',
          code: 'DASHSCOPE_AUTH',
          requestId: c.get('requestId'),
          retryable: true,
        },
        400,
      );
    }
    return c.json(
      {
        ok: false,
        message: e.message || '朗读服务暂时不可用，请稍后再试',
        hint: '文稿还在，不会丢',
        code: ErrorCodes.AI_BUSY,
        requestId: c.get('requestId'),
        retryable: true,
      },
      502,
    );
  }
  return jsonError(c, ErrorCodes.SERVER_ERROR, 500);
}
