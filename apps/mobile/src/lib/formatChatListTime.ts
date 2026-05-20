import { formatRevisionTime } from '@xzz/shared';

/** 工作室列表右侧时间（类似微信会话列表） */
export function formatChatListTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const { groupTitle, itemTime } = formatRevisionTime(iso, now);

  if (groupTitle === '今天') {
    const match = itemTime.match(/(\d{1,2})点(?:(\d{1,2})分)?/);
    if (match) {
      const hour = Number(match[1]);
      const minute = match[2] ? Number(match[2]) : 0;
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
    const h = date.getHours();
    const m = date.getMinutes();
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  if (groupTitle === '昨天') return '昨天';

  if (groupTitle.includes('月') && !groupTitle.includes('年')) {
    return groupTitle;
  }

  if (groupTitle.includes('年')) {
    const short = groupTitle.replace(/年/, '/').replace(/月/, '/').replace(/日$/, '');
    return short;
  }

  return groupTitle;
}
