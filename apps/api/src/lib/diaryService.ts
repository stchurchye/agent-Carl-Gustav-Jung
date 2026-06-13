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
import {
  getDiaryEntry,
  upsertDiaryEntry,
  setDiarySummary,
  markConfirmedIfDraft,
  markDistilledIfConfirmed,
} from '../store/pg-diary.js';
import { generateDiarySummary, refineDiarySummary } from './diaryGenerate.js';
import { buildLlmClient, DEFAULT_MODEL_FOR_PROVIDER } from './llm/factory.js';
import { runEpisodicMemory } from './memoryEpisodicWire.js';
import { magiSystemEnabled } from './integrations/magi.js';
import { log } from './logger.js';

/**
 * 蒸馏护栏(注入 transcript):日记蒸馏进 owner 自己的记忆时,只抽与用户本人相关的事,
 * 群友等他人的私事不作为「关于用户」的事实,避免把别人的隐私写进我的持久记忆。
 */
const DIARY_DISTILL_GUARDRAIL =
  '以下是用户的一篇日记。只抽取与「用户本人」直接相关的事(用户做了什么、经历了什么、学到或决定了什么);' +
  '日记里提到的其他人(群友等)的私事,不要作为关于用户的事实抽取。';

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

  if (p.scope === 'group') {
    const msgs = await getGroupMessagesForDay(p.userId, p.scopeId, p.dayStartIso, p.dayEndIso);
    if (msgs === null) return null; // 非成员
    scopeName = await getGroupName(p.scopeId);
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
    sourceCount: lines.length,
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

export interface ConfirmDiaryForDayParams {
  userId: string;
  scope: DiaryScope;
  scopeId: string;
  dayKey: string;
  apiKey: string;
}

/**
 * 确认:用户认可这篇日记 → 标 confirmed;若 MAGI 记忆系统启用,再把日记(带隐私护栏)蒸馏进
 * owner 自己的情景记忆(复用 runEpisodicMemory:distill→reconcile 去重→reflection,全程 fail-open)
 * 成功后标 distilled。蒸馏失败/MAGI 未启用 → 留 confirmed(不影响确认本身)。
 * 篇不存在 → null(404);已 distilled → 幂等返回。
 */
export async function confirmDiaryForDay(p: ConfirmDiaryForDayParams): Promise<DiaryEntry | null> {
  const existing = await getDiaryEntry(p.userId, p.scope, p.scopeId, p.dayKey);
  if (!existing) return null;
  // 原子确认:只有抢到 draft→confirmed 的请求继续蒸馏;非 draft(已确认/已蒸馏/被并发抢先)
  // 直接返回当前状态,杜绝重复蒸馏(TOCTOU 并发安全)。
  let entry = await markConfirmedIfDraft(p.userId, p.scope, p.scopeId, p.dayKey);
  if (!entry) return (await getDiaryEntry(p.userId, p.scope, p.scopeId, p.dayKey)) ?? existing;

  // 只有【个人日记】蒸馏进记忆:群日记是「我眼中的群」,含群友实名言行,不写进我的持久记忆
  // ——从结构上消除群友隐私进我记忆的风险(不依赖软文本护栏);记忆也聚焦于「我」。
  const summary = entry.summary.trim();
  if (p.scope === 'self' && summary && magiSystemEnabled()) {
    try {
      const llm = buildLlmClient({
        providerId: 'zenmux',
        modelId: DEFAULT_MODEL_FOR_PROVIDER.zenmux.modelId,
        apiKey: p.apiKey,
      });
      await runEpisodicMemory({
        ownerId: p.userId,
        runId: `diary:${entry.id}`,
        sessionId: null,
        topicId: null,
        transcript: `${DIARY_DISTILL_GUARDRAIL}\n\n${summary}`,
        llm,
        signal: new AbortController().signal,
      });
      // 条件转 distilled:蒸馏期间若被并发 refine 打回 draft,则不覆盖(防 stale distilled_at)
      const marked = await markDistilledIfConfirmed(
        p.userId,
        p.scope,
        p.scopeId,
        p.dayKey,
        new Date().toISOString(),
      );
      entry = marked ?? (await getDiaryEntry(p.userId, p.scope, p.scopeId, p.dayKey)) ?? entry;
    } catch (e) {
      // fail-open:蒸馏失败留在 confirmed(记一条 warn 便于排查,不影响确认)
      log('warn', 'diary distill failed (kept confirmed)', {
        ownerId: p.userId,
        dayKey: p.dayKey,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return entry;
}
