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
export type DiaryScope = 'self' | 'group';

export type DiaryStatus = 'draft' | 'confirmed' | 'distilled';

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

/** day_key 格式校验:'YYYY-MM-DD' */
export function isValidDiaryDayKey(dayKey: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dayKey);
}
