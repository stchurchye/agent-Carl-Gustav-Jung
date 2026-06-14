import { describe, expect, it, beforeEach, vi } from 'vitest';

// mock 数据库层,避免依赖真实 Postgres——本测试只验证登录路由的防爆破接线
vi.mock('../../store/pg.js', () => ({
  findUserByUsername: vi.fn(),
  createUser: vi.fn(),
  seedDemoForUser: vi.fn(),
  getUserById: vi.fn(),
}));

import { Hono } from 'hono';
import { authRouter } from '../auth.js';
import { loginThrottle } from '../../lib/loginThrottle.js';
import { hashPassword } from '../../lib/auth.js';
import * as pg from '../../store/pg.js';
import type { AppVariables } from '../../types.js';

const findUserByUsername = vi.mocked(pg.findUserByUsername);

function makeApp() {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('requestId', 'test-req');
    await next();
  });
  return app.route('/api/auth', authRouter);
}

function login(username: string, password: string, ip: string) {
  return makeApp().fetch(
    new Request('http://x/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ username, password }),
    }),
  );
}

describe('登录路由 · 按账号防爆破', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loginThrottle.reset(); // 默认阈值 5 次失败 / 锁 15min
  });

  it('同一用户名连续失败达阈值后,即便密码正确也被锁(429 + Retry-After)', async () => {
    const passwordHash = await hashPassword('correct-password');
    findUserByUsername.mockResolvedValue({
      id: 'u1',
      username: 'victim',
      displayName: 'V',
      passwordHash,
    } as never);

    for (let i = 0; i < 5; i++) {
      const res = await login('victim', 'wrong', '10.0.0.1');
      expect(res.status).toBe(401);
    }

    const locked = await login('victim', 'correct-password', '10.0.0.1');
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('中途登录成功会清零失败计数', async () => {
    const passwordHash = await hashPassword('correct-password');
    findUserByUsername.mockResolvedValue({
      id: 'u2',
      username: 'alice',
      displayName: 'A',
      passwordHash,
    } as never);

    for (let i = 0; i < 4; i++) {
      expect((await login('alice', 'wrong', '10.0.0.2')).status).toBe(401);
    }
    // 第 5 次用正确密码 → 成功(若没清零,这次本会是第 5 次失败→锁)
    expect((await login('alice', 'correct-password', '10.0.0.2')).status).toBe(200);
    // 清零后再错 4 次仍不被锁
    for (let i = 0; i < 4; i++) {
      expect((await login('alice', 'wrong', '10.0.0.2')).status).toBe(401);
    }
  });

  it('锁定 victim 不影响其他账号登录', async () => {
    const passwordHash = await hashPassword('correct-password');
    findUserByUsername.mockImplementation(async (username: string) =>
      username === 'someone-else'
        ? ({ id: 'u3', username, displayName: 'S', passwordHash } as never)
        : ({ id: 'u1', username, displayName: 'V', passwordHash } as never),
    );

    for (let i = 0; i < 5; i++) await login('victim', 'wrong', '10.0.0.3');
    expect((await login('victim', 'wrong', '10.0.0.3')).status).toBe(429);
    // 另一个账号不受影响
    expect((await login('someone-else', 'correct-password', '10.0.0.3')).status).toBe(200);
  });
});
