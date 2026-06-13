/**
 * mulberry32:快、确定、够用的种子 PRNG。同种子 → 同序列,用于可复现的关卡生成。
 * 返回 [0, 1) 浮点。
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 从非空数组按 rng 等概率取一个 */
export function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

/** 一个新的随机种子(开局/重开用);各小游戏共用 */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}
