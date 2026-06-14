import { describe, expect, it } from 'vitest';
import { createLoginThrottle } from '../loginThrottle.js';

/**
 * 按账号(用户名)的失败登录节流:同一用户名窗口内连续失败达阈值即冷却,
 * 成功登录清零。IP 限流挡不住"换 IP 死磕同一账号"的爆破,这一层补上。
 * 注入时钟做确定性测试,不用 fake timers。
 */
function fixedClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

describe('loginThrottle 按账号失败节流', () => {
  it('默认放行', () => {
    const c = fixedClock();
    const th = createLoginThrottle({ maxFailures: 3, windowMs: 1000, lockMs: 5000, now: c.now });
    expect(th.check('alice').allowed).toBe(true);
  });

  it('窗口内连续失败达阈值 → 锁定,check 返回不放行 + retryAfterSec', () => {
    const c = fixedClock();
    const th = createLoginThrottle({ maxFailures: 3, windowMs: 10_000, lockMs: 5_000, now: c.now });
    th.recordFailure('alice');
    th.recordFailure('alice');
    expect(th.check('alice').allowed).toBe(true); // 2 次还没到阈值
    th.recordFailure('alice'); // 第 3 次达阈值 → 锁
    const g = th.check('alice');
    expect(g.allowed).toBe(false);
    expect(g.retryAfterSec).toBe(5); // 5000ms 向上取整到秒
  });

  it('成功登录清零失败计数', () => {
    const c = fixedClock();
    const th = createLoginThrottle({ maxFailures: 3, windowMs: 10_000, lockMs: 5_000, now: c.now });
    th.recordFailure('alice');
    th.recordFailure('alice');
    th.recordSuccess('alice');
    th.recordFailure('alice');
    th.recordFailure('alice');
    expect(th.check('alice').allowed).toBe(true); // 清零后只累计了 2 次
  });

  it('失败间隔超过窗口 → 计数重置,不会累积到锁定', () => {
    const c = fixedClock();
    const th = createLoginThrottle({ maxFailures: 3, windowMs: 1_000, lockMs: 5_000, now: c.now });
    th.recordFailure('alice');
    c.advance(1_500);
    th.recordFailure('alice'); // 超窗口,重置为 1
    c.advance(1_500);
    th.recordFailure('alice'); // 再次重置为 1
    expect(th.check('alice').allowed).toBe(true);
  });

  it('锁定到期后重新放行,并重新开始计数', () => {
    const c = fixedClock();
    const th = createLoginThrottle({ maxFailures: 2, windowMs: 10_000, lockMs: 3_000, now: c.now });
    th.recordFailure('alice');
    th.recordFailure('alice'); // 锁
    expect(th.check('alice').allowed).toBe(false);
    c.advance(3_001);
    expect(th.check('alice').allowed).toBe(true);
  });

  it('锁定期内的失败不会无限延长锁定', () => {
    const c = fixedClock();
    const th = createLoginThrottle({ maxFailures: 2, windowMs: 10_000, lockMs: 3_000, now: c.now });
    th.recordFailure('alice');
    th.recordFailure('alice'); // 锁到 t+3000
    c.advance(1_000);
    th.recordFailure('alice'); // 锁定期内,不应把锁延到 t+4000
    c.advance(2_001); // 距首次锁定已 3001ms
    expect(th.check('alice').allowed).toBe(true);
  });

  it('按账号隔离:锁住 alice 不影响 bob', () => {
    const c = fixedClock();
    const th = createLoginThrottle({ maxFailures: 2, windowMs: 10_000, lockMs: 3_000, now: c.now });
    th.recordFailure('alice');
    th.recordFailure('alice');
    expect(th.check('alice').allowed).toBe(false);
    expect(th.check('bob').allowed).toBe(true);
  });

  it('用户名大小写/首尾空格归一化为同一账号', () => {
    const c = fixedClock();
    const th = createLoginThrottle({ maxFailures: 2, windowMs: 10_000, lockMs: 3_000, now: c.now });
    th.recordFailure(' Alice ');
    th.recordFailure('alice');
    expect(th.check('ALICE').allowed).toBe(false);
  });

  it('过期条目会被清理,避免攻击者用海量假用户名灌爆内存', () => {
    const c = fixedClock();
    const th = createLoginThrottle({
      maxFailures: 5,
      windowMs: 1_000,
      lockMs: 1_000,
      now: c.now,
      sweepEvery: 1,
    });
    for (let i = 0; i < 100; i++) th.recordFailure(`u${i}`);
    expect(th.size()).toBe(100);
    c.advance(2_001); // 全部既过窗口又过锁定
    th.recordFailure('trigger-sweep'); // 任一操作触发清理
    expect(th.size()).toBeLessThan(100);
  });
});
