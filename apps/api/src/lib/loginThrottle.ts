/**
 * 按账号(用户名)的失败登录节流。
 *
 * IP 限流(middleware/rateLimit.ts)只挡得住"单 IP 高频请求",挡不住攻击者
 * 用代理池换 IP 死磕同一个账号。这一层按"提交的用户名"累计失败次数:窗口内
 * 连续失败达阈值即冷却一段时间;成功登录立即清零。
 *
 * 关键:无论该用户名是否真实存在,都一视同仁地节流——既能防爆破,又不会因
 * "存在的账号才被锁"而泄露用户名是否存在(与 verifyPasswordOrDummy 的恒时
 * 防枚举保持一致)。
 *
 * 单实例内存实现;多副本部署各算各的,需要全局一致时改用 Redis 等共享存储。
 */

import { intEnv } from './env.js';

export interface LoginThrottleOptions {
  /** 窗口内连续失败多少次后锁定 */
  maxFailures: number;
  /** 失败计数的滑动窗口(毫秒);间隔超过它则计数重置 */
  windowMs: number;
  /** 达阈值后的锁定时长(毫秒) */
  lockMs: number;
  /** 注入时钟,便于测试;默认 Date.now */
  now?: () => number;
  /** 每多少次操作做一次过期清理(默认 256);防内存无限增长 */
  sweepEvery?: number;
  /** 条目数超过此上限时强制清理(默认 50000) */
  maxEntries?: number;
}

export interface LoginThrottleGate {
  allowed: boolean;
  /** 不放行时,建议客户端多少秒后重试 */
  retryAfterSec: number;
}

export interface LoginThrottle {
  /** 尝试登录前调用:被锁则 allowed=false */
  check(username: string): LoginThrottleGate;
  /** 登录失败后调用 */
  recordFailure(username: string): void;
  /** 登录成功后调用:清零该账号 */
  recordSuccess(username: string): void;
  /** 当前跟踪的账号数(测试/监控用) */
  size(): number;
  /** 清空(测试用) */
  reset(): void;
}

type Entry = { failures: number; windowStart: number; lockedUntil: number };

function normalize(username: string): string {
  return username.trim().toLowerCase();
}

export function createLoginThrottle(opts: LoginThrottleOptions): LoginThrottle {
  const now = opts.now ?? Date.now;
  const sweepEvery = opts.sweepEvery ?? 256;
  const maxEntries = opts.maxEntries ?? 50_000;
  const entries = new Map<string, Entry>();
  let opsSinceSweep = 0;

  /** 条目"已死":既不在锁定期,失败窗口也已过——可安全删除 */
  function isDead(e: Entry, t: number): boolean {
    return e.lockedUntil <= t && t - e.windowStart >= opts.windowMs;
  }

  function sweep(t: number): void {
    for (const [k, e] of entries) {
      if (isDead(e, t)) entries.delete(k);
    }
  }

  function maybeSweep(t: number): void {
    opsSinceSweep += 1;
    if (opsSinceSweep >= sweepEvery || entries.size > maxEntries) {
      opsSinceSweep = 0;
      sweep(t);
    }
  }

  return {
    check(username) {
      const t = now();
      maybeSweep(t);
      const e = entries.get(normalize(username));
      if (e && e.lockedUntil > t) {
        return { allowed: false, retryAfterSec: Math.ceil((e.lockedUntil - t) / 1000) };
      }
      return { allowed: true, retryAfterSec: 0 };
    },

    recordFailure(username) {
      const t = now();
      maybeSweep(t);
      const key = normalize(username);
      const e = entries.get(key);
      // 锁定期内的失败不再累加、不延长锁定——否则攻击者持续打就成了永久锁(自伤)
      if (e && e.lockedUntil > t) return;
      if (!e || t - e.windowStart >= opts.windowMs) {
        // 新账号,或上一窗口已过 → 开新窗口
        entries.set(key, { failures: 1, windowStart: t, lockedUntil: 0 });
        return;
      }
      e.failures += 1;
      if (e.failures >= opts.maxFailures) {
        e.lockedUntil = t + opts.lockMs;
      }
    },

    recordSuccess(username) {
      entries.delete(normalize(username));
    },

    size() {
      return entries.size;
    },

    reset() {
      entries.clear();
      opsSinceSweep = 0;
    },
  };
}

/** 进程级单例,登录路由用它。阈值/窗口/锁定时长可经环境变量调。 */
export const loginThrottle: LoginThrottle = createLoginThrottle({
  maxFailures: intEnv('LOGIN_THROTTLE_MAX_FAILURES', 5),
  windowMs: intEnv('LOGIN_THROTTLE_WINDOW_MS', 15 * 60 * 1000),
  lockMs: intEnv('LOGIN_THROTTLE_LOCK_MS', 15 * 60 * 1000),
});
