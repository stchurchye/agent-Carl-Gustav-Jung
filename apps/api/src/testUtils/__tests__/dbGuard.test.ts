import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('dbGuard(P0-S1 测试两档分层)', () => {
  it('无/空白 DATABASE_URL → hasDb=false,describeDb/itDb 为 skip 档', async () => {
    for (const v of ['', '   ']) {
      vi.stubEnv('DATABASE_URL', v);
      vi.resetModules();
      const mod = await import('../dbGuard.js');
      expect(mod.hasDb).toBe(false);
      // describe.skip 每次访问返回新函数,无法比身份;本断言只防 false 分支,
      // true 分支由下一个用例的 toBe(describe) 钉住 —— 两个方向合起来才防三元写反。
      expect(mod.describeDb).not.toBe(describe);
      expect(mod.itDb).not.toBe(it);
    }
  });

  it('有 DATABASE_URL → hasDb=true,describeDb/itDb 即 describe/it', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://localhost:5432/x');
    vi.resetModules();
    const mod = await import('../dbGuard.js');
    expect(mod.hasDb).toBe(true);
    expect(mod.describeDb).toBe(describe);
    expect(mod.itDb).toBe(it);
  });

  it('空白串 DATABASE_URL 视同未配置(trim)', async () => {
    vi.stubEnv('DATABASE_URL', '   ');
    vi.resetModules();
    const mod = await import('../dbGuard.js');
    expect(mod.hasDb).toBe(false);
  });
});
