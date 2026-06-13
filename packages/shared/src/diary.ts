/**
 * 每日日记(Diary)—— 统一 scope 模型。
 *
 * Bow Wow 每天把当天的对话总结成一篇日记,每人每天每个 scope 至多一篇:
 * - 个人日记:scope='self',总结「我和 bow wow」的私聊。
 * - 群日记:scope='group',scopeId=群 id,是「我眼中今天这个群」——私有、只有我可见、
 *   喂我自己的记忆(per-owner 隔离),不是全群共享的一篇。
 *
 * 生命周期:draft(已生成,可重写/矫正) → confirmed(用户确认) → distilled(已蒸馏进记忆)。
 */
/** scope/status 的运行时常量与类型单一来源(供 DB CHECK 之外的应用层校验/遍历复用) */
export const DIARY_SCOPES = ['self', 'group'] as const;
export type DiaryScope = (typeof DIARY_SCOPES)[number];

export const DIARY_STATUSES = ['draft', 'confirmed', 'distilled'] as const;
export type DiaryStatus = (typeof DIARY_STATUSES)[number];

export interface DiaryEntry {
  id: string;
  scope: DiaryScope;
  /** self 篇为 ''; group 篇为 groupId(软引用,退群后仍保留这篇私有快照) */
  scopeId: string;
  /** group 篇的群名快照,退群/删群后仍能展示「我眼中的{群名}」 */
  scopeName?: string | null;
  /** 'YYYY-MM-DD',按 owner 本地时区切分 */
  dayKey: string;
  summary: string;
  status: DiaryStatus;
  /** 生成时纳入的消息条数(0 = 当天无对话) */
  sourceCount: number;
  createdAt: string;
  updatedAt: string;
}

/** 矫正请求:用户「跟 bow wow 聊着改」时给出的自然语言指令 */
export interface DiaryRefineRequest {
  instruction: string;
}

/**
 * day_key 校验:'YYYY-MM-DD' 且必须是真实存在的日历日。
 * 只查格式会放过 2026-13-45 / 2026-02-30 这类不存在的日期,故回填比对剔除溢出。
 */
export function isValidDiaryDayKey(dayKey: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return false;
  const [y, m, d] = dayKey.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
