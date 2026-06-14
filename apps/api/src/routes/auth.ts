import { Hono } from 'hono';
import { ErrorCodes, validateProfileDisplayName } from '@xzz/shared';
import type { AppVariables } from '../types.js';
import { jsonError } from '../lib/errors.js';
import {
  hashPassword,
  signAccessToken,
  verifyPasswordOrDummy,
} from '../lib/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { loginThrottle } from '../lib/loginThrottle.js';
import * as pg from '../store/pg.js';

export const authRouter = new Hono<{ Variables: AppVariables }>();

const authRateLimit = rateLimit({
  keyPrefix: 'auth',
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 30),
});

function isPublicRegistrationAllowed(): boolean {
  const flag = process.env.ALLOW_PUBLIC_REGISTRATION?.trim().toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'no') return false;
  return true;
}

authRouter.post(
  '/register',
  rateLimit({
    keyPrefix: 'auth-register',
    windowMs: 60 * 60 * 1000,
    max: Number(process.env.AUTH_REGISTER_RATE_LIMIT_MAX ?? 5),
  }),
  async (c) => {
    if (!isPublicRegistrationAllowed()) {
      return jsonError(c, ErrorCodes.AUTH_REGISTRATION_DISABLED, 403);
    }
    const body = await c.req.json<{
      username?: string;
      password?: string;
      displayName?: string;
    }>();
    const username = body.username?.trim().toLowerCase();
    const password = body.password ?? '';
    if (!username || username.length < 2) {
      return jsonError(c, ErrorCodes.VALIDATION, 400);
    }
    if (password.length < 6) {
      return jsonError(c, ErrorCodes.VALIDATION, 400);
    }

    const existing = await pg.findUserByUsername(username);
    if (existing) {
      return jsonError(c, ErrorCodes.AUTH_CONFLICT, 409);
    }

    const rawName = body.displayName?.trim() || username;
    const nameCheck = validateProfileDisplayName(rawName);
    if (!nameCheck.ok) {
      return jsonError(c, ErrorCodes.VALIDATION, 400);
    }
    const displayName = nameCheck.value;
    const passwordHash = await hashPassword(password);
    const user = await pg.createUser({ username, passwordHash, displayName });
    const tokens = await signAccessToken(user);
    await pg.seedDemoForUser(user.id);

    return c.json(
      { ok: true, data: { user, tokens }, requestId: c.get('requestId') },
      201,
    );
  },
);

authRouter.post('/login', authRateLimit, async (c) => {
  const body = await c.req.json<{ username?: string; password?: string }>();
  const username = body.username?.trim().toLowerCase();
  const password = body.password ?? '';
  if (!username || !password) {
    return jsonError(c, ErrorCodes.VALIDATION, 400);
  }

  // 按账号防爆破:同一用户名失败过多则冷却。对存在/不存在的用户名一视同仁,
  // 不泄露账号是否存在(与下面的恒时 bcrypt 同理)。IP 限流挡不住换 IP 死磕。
  const gate = loginThrottle.check(username);
  if (!gate.allowed) {
    c.header('Retry-After', String(gate.retryAfterSec));
    return jsonError(c, ErrorCodes.RATE_LIMITED, 429);
  }

  const row = await pg.findUserByUsername(username);
  // 恒时:用户不存在也跑一次 bcrypt,防响应时间枚举用户名(review P2)
  const passwordOk = await verifyPasswordOrDummy(password, row?.passwordHash);
  if (!row || !passwordOk) {
    loginThrottle.recordFailure(username);
    return jsonError(c, ErrorCodes.AUTH_UNAUTHORIZED, 401);
  }

  loginThrottle.recordSuccess(username);
  const { passwordHash: _, ...user } = row;
  const tokens = await signAccessToken(user);
  return c.json({ ok: true, data: { user, tokens }, requestId: c.get('requestId') });
});

authRouter.get('/me', requireAuth, async (c) => {
  const userId = c.get('userId')!;
  const user = await pg.getUserById(userId);
  if (!user) return jsonError(c, ErrorCodes.AUTH_UNAUTHORIZED, 401);
  return c.json({ ok: true, data: user, requestId: c.get('requestId') });
});
