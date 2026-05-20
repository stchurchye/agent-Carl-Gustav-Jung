import { ErrorCodes } from '@xzz/shared';
import type { Context } from 'hono';
import type { AppVariables } from '../types.js';
import { jsonError } from './errors.js';
import { getZenMuxKeyFromRequest, ZenMuxError } from './zenmux.js';

export function getZenMuxKey(c: Context<{ Variables: AppVariables }>): string {
  try {
    return getZenMuxKeyFromRequest(c.req.header('X-ZenMux-Api-Key'));
  } catch (e) {
    if (e instanceof ZenMuxError && e.message === 'ZENMUX_KEY_MISSING') {
      throw e;
    }
    throw e;
  }
}

export function handleZenMuxError(c: Context<{ Variables: AppVariables }>, e: unknown) {
  if (e instanceof ZenMuxError) {
    if (e.message === 'ZENMUX_KEY_MISSING') {
      return jsonError(c, ErrorCodes.ZENMUX_KEY_MISSING, 400);
    }
    if (e.status === 401 || e.status === 403) {
      return c.json(
        {
          ok: false,
          message: 'ZenMux 密钥不对或已失效，请在「我的」里重新填写',
          hint: '请前往 zenmux.ai 核对密钥',
          code: 'ZENMUX_AUTH',
          requestId: c.get('requestId'),
          retryable: true,
        },
        401,
      );
    }
    return c.json(
      {
        ok: false,
        message: e.message || '识图/听写服务暂时不可用，请稍后再试',
        hint: '文稿还在，不会丢',
        code: ErrorCodes.AI_BUSY,
        requestId: c.get('requestId'),
        retryable: true,
      },
      502,
    );
  }
  const msg =
    e instanceof Error && e.message
      ? e.message
      : '识图/听写服务暂时不可用，请稍后再试';
  return c.json(
    {
      ok: false,
      message: msg,
      hint: '真机可改用「按住说话」本机听写；或在「我的」核对 ZenMux 密钥',
      code: ErrorCodes.SERVER_ERROR,
      requestId: c.get('requestId'),
      retryable: true,
    },
    500,
  );
}
