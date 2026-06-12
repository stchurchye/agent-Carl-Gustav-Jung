import { ErrorCodes } from '@xzz/shared';
import type { Context } from 'hono';
import type { AppVariables } from '../types.js';
import { DeepSeekError, getApiKeyFromRequest } from './deepseek.js';
import { jsonError } from './errors.js';

export function getDeepSeekKey(c: Context<{ Variables: AppVariables }>): string {
  try {
    return getApiKeyFromRequest(c.req.header('X-DeepSeek-Api-Key'));
  } catch (e) {
    if (e instanceof DeepSeekError && e.message === 'API_KEY_MISSING') {
      throw e;
    }
    throw e;
  }
}

/**
 * M1e review followup：legacy `getDeepSeekKey` 把 header-key 和 server-env-key
 * 都返回成 `string`，调用方无法分辨。对 agent_run 路径来说这会让 server 的 env key
 * 被当作 user key 加密落到 `agent_runs.user_api_key_enc`（owner=user）。
 *
 * 这个新 helper 显式返回 source。**仅 agent intent 路径用**，老的 chat / writing
 * 入口继续用 getDeepSeekKey 保持行为不变。
 */
export type ResolvedApiKey = {
  key: string;
  /** 'user' = 来自请求 header；'server' = 来自服务端 env */
  source: 'user' | 'server';
};

export function getDeepSeekKeyWithSource(
  c: Context<{ Variables: AppVariables }>,
): ResolvedApiKey | null {
  const headerKey = c.req.header('X-DeepSeek-Api-Key')?.trim();
  if (headerKey) return { key: headerKey, source: 'user' };
  const envKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (envKey) return { key: envKey, source: 'server' };
  return null;
}

export function handleAiError(c: Context<{ Variables: AppVariables }>, e: unknown) {
  if (e instanceof DeepSeekError) {
    if (e.message === 'API_KEY_MISSING') {
      return jsonError(c, ErrorCodes.API_KEY_MISSING, 400);
    }
    if (e.status === 401 || e.status === 403) {
      return c.json(
        {
          ok: false,
          message: '密钥不对或已失效，请在「我的」里重新填写',
          hint: '请检查 DeepSeek 控制台里的密钥是否有效',
          code: 'DEEPSEEK_AUTH',
          requestId: c.get('requestId'),
          retryable: true,
        },
        401,
      );
    }
    return c.json(
      {
        ok: false,
        message: e.message || 'Bow Wow 这会儿有点忙，请稍后再试',
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
