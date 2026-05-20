import type { MiddlewareHandler } from 'hono';
import { ErrorCodes } from '@xzz/shared';
import { jsonError } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/auth.js';
import type { AppVariables } from '../types.js';

export const requireAuth: MiddlewareHandler<{ Variables: AppVariables }> = async (
  c,
  next,
) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return jsonError(c, ErrorCodes.AUTH_UNAUTHORIZED, 401);
  }
  try {
    const claims = await verifyAccessToken(header.slice(7));
    c.set('userId', claims.userId);
    c.set('username', claims.username);
    c.set('displayName', claims.displayName);
    await next();
  } catch {
    return jsonError(c, ErrorCodes.AUTH_UNAUTHORIZED, 401);
  }
};
