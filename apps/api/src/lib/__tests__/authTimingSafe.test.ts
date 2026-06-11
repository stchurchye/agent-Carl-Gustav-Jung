import { describe, expect, it } from 'vitest';
import { verifyPasswordOrDummy } from '../auth.js';

/**
 * Review 2026-06-11 [P2][security] routes/auth.ts:85
 * 登录对不存在的用户名短路跳过 bcrypt(~1-10ms vs ~100ms),响应时间可枚举用户名。
 * 修后:用户不存在也对 dummy hash 跑一次 bcrypt.compare,耗时同量级。
 */
describe('verifyPasswordOrDummy 恒时校验', () => {
  it('hash 为 null(用户不存在)→ 返回 false,但仍消耗一次 bcrypt 比较', async () => {
    const t0 = process.hrtime.bigint();
    const ok = await verifyPasswordOrDummy('whatever', null);
    const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
    expect(ok).toBe(false);
    // bcrypt cost=10 一次比较远超 5ms(实测 ~50-100ms);短路实现会 <1ms
    expect(elapsedMs).toBeGreaterThan(5);
  });

  it('真实 hash 正常通过/拒绝', async () => {
    const { hashPassword } = await import('../auth.js');
    const hash = await hashPassword('correct-horse');
    expect(await verifyPasswordOrDummy('correct-horse', hash)).toBe(true);
    expect(await verifyPasswordOrDummy('wrong', hash)).toBe(false);
  });
});
