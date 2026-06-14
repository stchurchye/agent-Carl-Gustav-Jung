import { afterEach, describe, expect, it } from 'vitest';
import { intEnv } from '../env.js';

/**
 * intEnv 守护一批"数字型"安全配置(限流上限、JWT 过期秒数…)。
 * 关键:非法值(NaN/负数/0/空)必须退回 fallback,绝不能让 NaN 流进去——
 * 比如 `bucket.count > NaN` 恒 false 会把限流静默关掉。
 */
describe('intEnv', () => {
  const KEY = 'XZZ_TEST_INTENV';
  afterEach(() => {
    delete process.env[KEY];
  });

  it('未设置 → fallback', () => {
    expect(intEnv(KEY, 30)).toBe(30);
  });

  it('合法正整数 → 采用', () => {
    process.env[KEY] = '7';
    expect(intEnv(KEY, 30)).toBe(7);
  });

  it('非数字字符串(NaN)→ fallback,不会泄漏 NaN', () => {
    process.env[KEY] = 'oops';
    const v = intEnv(KEY, 30);
    expect(v).toBe(30);
    expect(Number.isNaN(v)).toBe(false);
  });

  it('0 和负数 → fallback', () => {
    process.env[KEY] = '0';
    expect(intEnv(KEY, 30)).toBe(30);
    process.env[KEY] = '-5';
    expect(intEnv(KEY, 30)).toBe(30);
  });

  it('空字符串 → fallback', () => {
    process.env[KEY] = '';
    expect(intEnv(KEY, 30)).toBe(30);
  });
});
