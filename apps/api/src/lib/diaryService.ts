import {
  formatDiaryTranscript,
  personaAssistantDisplayName,
  type DiaryEntry,
  type DiaryScope,
  type ReplyDialect,
} from '@xzz/shared';
import { getPersonaSettings } from '../store/pg-profile.js';
import { getPrivateMessagesForDay } from '../store/pg.js';
import { getGroupMessagesForDay, getGroupName } from '../store/pg-social.js';
import { getDiaryEntry, upsertDiaryEntry, setDiarySummary } from '../store/pg-diary.js';
import { generateDiarySummary, refineDiarySummary } from './diaryGenerate.js';

/** 当日消息上限:超出只取最近的若干条,避免把一整天的群聊喂爆 LLM 上下文。 */
const MAX_DIARY_MESSAGES = 300;

export interface GenerateDiaryForDayParams {
  userId: string;
  scope: DiaryScope;
  scopeId: string; // self: ''; group: groupId
  dayKey: string;
  dayStartIso: string;
  dayEndIso: string;
  apiKey: string;
  dialect?: ReplyDialect | null;
}

/**
 * 生成(或重生成)某天某 scope 的日记:取当日消息 → 格式化 transcript → Bow Wow 语气总结 → upsert。
 * - 群篇:非成员返回 null(调用方转 403)。
 * - 已 confirmed/distilled 的篇不重生成,原样返回(避免覆盖已定稿正文)。
 */
export async function generateDiaryForDay(
  p: GenerateDiaryForDayParams,
): Promise<DiaryEntry | null> {
  const existing = await getDiaryEntry(p.userId, p.scope, p.scopeId, p.dayKey);
  if (existing && existing.status !== 'draft') return existing;

  const persona = await getPersonaSettings(p.userId);
  const assistantName = personaAssistantDisplayName(persona);

  let lines: Array<{ speaker: string; content: string }>;
  let scopeName: string | null = null;
  let totalCount: number;

  if (p.scope === 'group') {
    const msgs = await getGroupMessagesForDay(p.userId, p.scopeId, p.dayStartIso, p.dayEndIso);
    if (msgs === null) return null; // 非成员
    scopeName = await getGroupName(p.scopeId);
    totalCount = msgs.length;
    lines = msgs.slice(-MAX_DIARY_MESSAGES).map((m) => ({
      speaker:
        m.kind === 'ai'
          ? m.invokerAssistantName?.trim() || 'Bow Wow'
          : m.authorId === p.userId
            ? '我'
            : m.authorDisplayName?.trim() || '群友',
      content: m.content,
    }));
  } else {
    const msgs = await getPrivateMessagesForDay(p.userId, p.dayStartIso, p.dayEndIso);
    totalCount = msgs.length;
    lines = msgs.slice(-MAX_DIARY_MESSAGES).map((m) => ({
      speaker: m.role === 'user' ? '我' : assistantName,
      content: m.content,
    }));
  }

  const summary = await generateDiarySummary({
    apiKey: p.apiKey,
    persona,
    dialect: p.dialect,
    scope: p.scope,
    scopeName,
    transcript: formatDiaryTranscript(lines),
  });

  return upsertDiaryEntry(p.userId, {
    scope: p.scope,
    scopeId: p.scopeId,
    scopeName,
    dayKey: p.dayKey,
    summary,
    status: 'draft',
    sourceCount: totalCount,
  });
}

export interface RefineDiaryForDayParams {
  userId: string;
  scope: DiaryScope;
  scopeId: string;
  dayKey: string;
  instruction: string;
  apiKey: string;
  dialect?: ReplyDialect | null;
}

/**
 * 矫正:用户「跟 bow wow 聊着改」—— 拿现有这篇日记 + 用户意见让狗狗重写,改写正文并回 draft。
 * 篇不存在返回 null(调用方转 404)。矫正的是 owner 自己的私有篇,不需要群成员校验。
 */
export async function refineDiaryForDay(p: RefineDiaryForDayParams): Promise<DiaryEntry | null> {
  const existing = await getDiaryEntry(p.userId, p.scope, p.scopeId, p.dayKey);
  if (!existing) return null;
  // 空意见 → 不改、不动状态(守卫与状态变更同层,不依赖调用方/下游 no-op)
  const instruction = p.instruction.trim();
  if (!instruction) return existing;

  const persona = await getPersonaSettings(p.userId);
  const summary = await refineDiarySummary({
    apiKey: p.apiKey,
    persona,
    dialect: p.dialect,
    scope: p.scope,
    existingSummary: existing.summary,
    instruction,
  });
  return (await setDiarySummary(p.userId, p.scope, p.scopeId, p.dayKey, summary)) ?? existing;
}
