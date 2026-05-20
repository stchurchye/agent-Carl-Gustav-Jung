import { formatRevisionTime } from '@xzz/shared';

/** 与上一条消息间隔超过 5 分钟，或跨自然日，则显示居中时间条（微信规则） */
export const CHAT_TIMESTAMP_GAP_MS = 5 * 60 * 1000;

export function shouldShowChatTimestamp(
  currentIso: string,
  previousIso?: string,
): boolean {
  if (!previousIso) return true;
  const cur = new Date(currentIso).getTime();
  const prev = new Date(previousIso).getTime();
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return true;
  if (cur - prev >= CHAT_TIMESTAMP_GAP_MS) return true;
  const curKey = formatRevisionTime(currentIso).dateKey;
  const prevKey = formatRevisionTime(previousIso).dateKey;
  return curKey !== prevKey;
}

function clock24(iso: string): string {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${hour}:${minute}`;
}

/** 消息列表居中时间条文案 */
export function formatChatMessageTime(iso: string, now: Date = new Date()): string {
  const time = clock24(iso);
  const { groupTitle } = formatRevisionTime(iso, now);
  if (groupTitle === '今天') return time;
  if (groupTitle === '昨天') return `昨天 ${time}`;
  return `${groupTitle} ${time}`;
}

export function attachChatTimeFlags<T extends { createdAt: string }>(
  items: T[],
): Array<T & { showTimestamp: boolean; timeLabel: string }> {
  return items.map((item, index) => {
    const prev = items[index - 1];
    const showTimestamp = shouldShowChatTimestamp(item.createdAt, prev?.createdAt);
    return {
      ...item,
      showTimestamp,
      timeLabel: formatChatMessageTime(item.createdAt),
    };
  });
}
