import type { ContextUsage, ReplyDialect } from '@xzz/shared';
import { estimateTokens } from '@xzz/shared';
import type { ChatMessageInput } from '../deepseek.js';
import { prepareChatContext } from '../contextPipeline.js';
import { listGroupMessages } from '../../store/pg-social.js';
import { buildGroupLlmSystem } from '../groupLlm.js';
import {
  listForAgent as listTopicSkillsForAgent,
  type TopicSkill as DbTopicSkill,
} from './topicSkills.js';
import { sanitizeMergedUsername } from './types.js';

/**
 * snapshotForAgent 仅消费 skill 的展示字段。这是 db TopicSkill 的子集——
 * 用 Pick 派生避免类型漂移。
 */
export type TopicSkill = Pick<
  DbTopicSkill,
  | 'id'
  | 'scope'
  | 'ownerId'
  | 'groupId'
  | 'topicId'
  | 'title'
  | 'content'
  | 'enabled'
>;

export type AgentContextSnapshot = {
  systemPrompt: string;
  history: ChatMessageInput[];
  shortSummary: string;
  usage: ContextUsage;
  source: {
    channel: 'private' | 'group';
    sessionId?: string;
    groupId?: string;
    topicId?: string;
  };
};

function formatTopicSkillsAsSystemBlock(skills: TopicSkill[]): string {
  const enabled = skills.filter((s) => s.enabled);
  if (enabled.length === 0) return '';
  const items = enabled.map((s) => `### ${s.title}\n${s.content}`).join('\n\n');
  return `\n\n<topic_skills source="user_provided">\n${items}\n</topic_skills>`;
}

export type SnapshotForAgentParams = {
  runId: string;
  userId: string;
  channel: 'private' | 'group';
  sessionId?: string;
  groupId?: string;
  topicId?: string;
  pendingUser: string;
  apiKey: string;
  /** 不传则从 db 按 (userId, groupId?, topicId?) 自动拉 enabled=true skills。 */
  topicSkills?: TopicSkill[];
  dialect?: ReplyDialect;
};

export async function snapshotForAgent(
  params: SnapshotForAgentParams,
): Promise<AgentContextSnapshot> {
  const skills: TopicSkill[] =
    params.topicSkills ??
    (await listTopicSkillsForAgent({
      userId: params.userId,
      groupId: params.groupId,
      topicId: params.topicId,
      // M1e Task 10：让 listForAgent 二次过滤命中 high pattern 时能 emit 一条
      // SKILL_DROPPED notice 到当前 run。
      runId: params.runId,
    }));
  if (params.channel === 'private') {
    if (!params.sessionId) {
      throw new Error('snapshotForAgent: private channel requires sessionId');
    }
    const prepared = await prepareChatContext({
      userId: params.userId,
      apiKey: params.apiKey,
      sessionId: params.sessionId,
      pendingUser: params.pendingUser,
      dialect: params.dialect,
    });
    const systemMsg = prepared.messages.find((m) => m.role === 'system');
    const otherMsgs = prepared.messages.filter((m) => m.role !== 'system');
    const history =
      otherMsgs.length > 0 && otherMsgs[otherMsgs.length - 1].role === 'user'
        ? otherMsgs.slice(0, -1)
        : otherMsgs;
    const systemPrompt =
      (systemMsg?.content ?? '') + formatTopicSkillsAsSystemBlock(skills);
    const last6 = history
      .slice(-6)
      .map((m) => `${m.role}: ${m.content.slice(0, 80)}`)
      .join('\n');
    const shortSummary = `本会话最近交流：\n${last6}`;
    return {
      systemPrompt,
      history,
      shortSummary,
      usage: prepared.usage,
      source: { channel: 'private', sessionId: params.sessionId },
    };
  }

  if (!params.groupId || !params.topicId) {
    throw new Error('snapshotForAgent: group channel requires groupId+topicId');
  }
  const messages =
    (await listGroupMessages(params.userId, params.groupId, params.topicId, {
      limit: 50,
    })) ?? [];
  // S6：超出近窗(KEPT)的更早 turns 不再硬丢 —— 摘要后保留语义，并给出真 usage。
  // resolveGroupHistoryMessages 在无选择时内部 slice(-12)，会吃掉"更早"的部分；agent 路径
  // 永远传 null selection，故这里直接复制它的过滤（非 system / 非 llmExclude）但不 cap，
  // 自己切近窗/更早。
  const KEPT_GROUP_TURNS = 12;
  const eligible = messages.filter(
    (m) => m.kind !== 'system' && !m.llmExclude?.active,
  );
  const selected = eligible.slice(-KEPT_GROUP_TURNS);
  const older = eligible.slice(0, -KEPT_GROUP_TURNS);
  const systemBase = await buildGroupLlmSystem(params.userId, params.dialect, {
    groupId: params.groupId,
    topicId: params.topicId,
    query: params.pendingUser,
  });
  const systemPrompt = systemBase + formatTopicSkillsAsSystemBlock(skills);
  const speakerOf = (m: (typeof eligible)[number]) =>
    m.kind === 'ai' && m.invokerAssistantName
      ? `${m.authorDisplayName ?? '成员'} 的 ${m.invokerAssistantName}`
      : m.authorDisplayName ?? '成员';
  const history: ChatMessageInput[] = selected.map((m) => {
    const role: 'assistant' | 'user' = m.kind === 'ai' ? 'assistant' : 'user';
    return { role, content: `[${speakerOf(m)}] ${m.content}` };
  });
  // 更早 turns：**机械凝练**（每条取前 80 字、保留内容要点），不再硬丢成裸计数。
  // 不在此用 LLM 压缩 —— 快照每次 planner 调用都重建，无话题级持久化时会对同一批
  // older turns 反复调 LLM（净成本）。LLM + 话题级摘要持久化作为后续优化（需新列）。
  const olderSummary =
    older.length > 0
      ? older.map((m) => `[${speakerOf(m)}] ${m.content.slice(0, 80)}`).join('\n')
      : '';
  // M7 P4：把本 run 的 user_message_appended steps（合并进来的追问）拼到 history 末尾，
  // 让 planner / reply 的上下文里能看到追问原文。定向查询（仅该 kind），不全表扫。
  if (params.runId) {
    const { listStepsByKind } = await import('./store.js');
    const apSteps = await listStepsByKind(params.runId, 'user_message_appended');
    for (const s of apSteps) {
      const input = s.input as { text?: string; byUsername?: string } | null;
      if (!input?.text) continue;
      // byUsername 来自用户可改的 displayName；剥换行避免伪造段落标题注入。
      const speaker = sanitizeMergedUsername(input.byUsername);
      history.push({ role: 'user', content: `[${speaker}] ${input.text}` });
    }
  }
  const last6 = selected
    .slice(-6)
    .map((m) => `${m.authorDisplayName ?? '成员'}: ${m.content.slice(0, 80)}`)
    .join('\n');
  const shortSummary =
    (olderSummary ? `此前对话摘要：\n${olderSummary}\n\n` : '') +
    `群聊最近 ${selected.length} 条：\n${last6}`;
  // S6：真 usage —— 反映是否压缩了更早 turns（不再硬编码 compacted:false）。
  // 整体 review #7：用 S7 的 CJK 感知 estimateTokens（而非旧 chars/1.6），与全应用一致。
  const historyText = history.map((h) => h.content).join('');
  const sysTokens = estimateTokens(systemPrompt);
  const summaryTokens = estimateTokens(olderSummary);
  const historyTokens = estimateTokens(historyText);
  const pendingTokens = estimateTokens(params.pendingUser);
  const usedTokens = sysTokens + summaryTokens + historyTokens + pendingTokens;
  const limitTokens = 32_000; // agent planner 上下文目标窗口
  return {
    systemPrompt,
    history,
    shortSummary,
    usage: {
      usedTokens,
      limitTokens,
      ratio: usedTokens / limitTokens,
      breakdown: {
        system: sysTokens,
        summary: summaryTokens,
        history: historyTokens,
        document: 0,
        pendingUser: pendingTokens,
        outputReserve: 0,
      },
      compacted: older.length > 0,
      droppedVerbatimTurns: older.length,
    },
    source: {
      channel: 'group',
      groupId: params.groupId,
      topicId: params.topicId,
    },
  };
}
