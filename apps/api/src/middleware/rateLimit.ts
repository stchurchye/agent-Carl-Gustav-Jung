import type { MiddlewareHandler } from 'hono';
import { ErrorCodes } from '@xzz/shared';
import { jsonError } from '../lib/errors.js';
import type { AppVariables } from '../types.js';

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** 简易内存限流（单实例）；多副本部署请改用 Redis 等共享存储 */
export function rateLimit(options: {
  windowMs: number;
  max: number;
  keyPrefix: string;
  keyFromRequest?: (c: Parameters<MiddlewareHandler>[0]) => string;
}): MiddlewareHandler<{ Variables: AppVariables }> {
  const keyFromRequest =
    options.keyFromRequest ??
    ((c) => c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown');

  return async (c, next) => {
    const now = Date.now();
    const key = `${options.keyPrefix}:${keyFromRequest(c)}`;
    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > options.max) {
      return jsonError(c, ErrorCodes.RATE_LIMITED, 429);
    }
    await next();
  };
}
