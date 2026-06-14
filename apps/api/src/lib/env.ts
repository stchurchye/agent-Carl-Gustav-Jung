/**
 * 读取"数字型"环境变量,带防御:非法值(NaN/非有限/<=0/空)一律退回 fallback。
 *
 * 为什么必须防 NaN:像 `bucket.count > Number(process.env.X)` 这种,若 X 被误设成
 * 非数字串,Number()→NaN,任何比较恒为 false → 限流被静默关掉。安全配置尤其忌讳。
 */
export function intEnv(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}
