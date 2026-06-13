/**
 * 日记的「本地时区」日期工具。
 * 后端按 created_at(UTC)过滤,但用户的「今天」是本地时区口径;故 day_key 与窗口都在客户端按
 * 本地时区算好再发给后端:day_key='YYYY-MM-DD'(本地),窗口 [start,end) 是该本地日的 UTC 边界。
 */
import { isValidDiaryDayKey } from '@xzz/shared';

/** 本地时区的 'YYYY-MM-DD'(默认今天)。 */
export function localDayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 给定本地 day_key,算出该本地日的 [dayStartIso, dayEndIso) UTC 窗口。
 * new Date(y, m-1, d) 按本地时区构造,.toISOString() 即得对应 UTC 边界
 * (如 UTC+8 的本地 06-20 00:00 → 06-19T16:00:00.000Z)。
 */
export function localDayWindow(dayKey: string): { dayStartIso: string; dayEndIso: string } {
  // 守卫:畸形/不存在的日历日提前抛清晰错误,而非 RangeError 或被 Date 溢出静默算错
  if (!isValidDiaryDayKey(dayKey)) {
    throw new Error(`localDayWindow: 非法 dayKey「${dayKey}」`);
  }
  const [y, m, d] = dayKey.split('-').map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
  return { dayStartIso: start.toISOString(), dayEndIso: end.toISOString() };
}
