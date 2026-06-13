import { mulberry32, pick, randomSeed } from './rng';

describe('mulberry32 种子随机', () => {
  it('同种子产生相同序列,不同种子不同,值落在 [0,1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(7);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    const seqC = [c(), c(), c()];
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
    for (const n of seqA) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    }
  });
});

describe('pick 从数组按 rng 取一个', () => {
  it('始终返回数组内元素,且确定性', () => {
    const arr = ['a', 'b', 'c', 'd'];
    const r1 = mulberry32(123);
    const r2 = mulberry32(123);
    const picks1 = [pick(arr, r1), pick(arr, r1), pick(arr, r1)];
    const picks2 = [pick(arr, r2), pick(arr, r2), pick(arr, r2)];
    expect(picks1).toEqual(picks2);
    for (const p of picks1) expect(arr).toContain(p);
  });
});

describe('randomSeed', () => {
  it('返回 [0, 2^31) 的非负整数', () => {
    for (let i = 0; i < 20; i++) {
      const s = randomSeed();
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(0x7fffffff);
    }
  });
});
