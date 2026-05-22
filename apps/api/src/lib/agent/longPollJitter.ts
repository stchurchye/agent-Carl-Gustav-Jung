/**
 * M6 T1a：long-poll hold 时长 jitter。
 *
 * 25s 中心 ± 20%：均匀分布 [20000, 30000] ms。
 *
 * 设计要点（防 thundering herd）：
 *   - 每次 hold 独立 random，避免多客户端同频
 *   - 上界 30000 < Nginx/ALB 默认 60s，留余量
 *   - 下界 20000 远高于平均 step 推进（避免空响应抖动太频繁）
 */
const HOLD_CENTER_MS = 25000;
const HOLD_JITTER_FRACTION = 0.2;

export function computeHoldMs(): number {
  const jitter = 1 + (Math.random() * 2 - 1) * HOLD_JITTER_FRACTION;
  return Math.round(HOLD_CENTER_MS * jitter);
}

/** 测试用：NODE_ENV=test 时 ?_holdMs=N 可覆盖。 */
export function resolveHoldMs(override?: string | undefined): number {
  if (process.env.NODE_ENV === 'test' && override) {
    const n = Number(override);
    if (Number.isFinite(n) && n >= 100 && n <= 30000) return n;
  }
  return computeHoldMs();
}
