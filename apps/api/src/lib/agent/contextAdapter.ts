import type { ContextUsage, ReplyDialect } from '@xzz/shared';
import type { ChatMessageInput } from '../deepseek.js';
import { prepareChatContext } from '../contextPipeline.js';
import { listGroupMessages } from '../../store/pg-social.js';
import { buildGroupLlmSystem, resolveGroupHistoryMessages } from '../groupLlm.js';
import {
  listForAgent as listTopicSkillsForAgent,
  type TopicSkill as DbTopicSkill,
} from './topicSkills.js';

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

function emptyContextUsage(): ContextUsage {
  return {
    usedTokens: 0,
    limitTokens: 0,
    ratio: 0,
    breakdown: {
      system: 0,
      summary: 0,
      history: 0,
      document: 0,
      pendingUser: 0,
      outputReserve: 0,
    },
    compacted: false,
    droppedVerbatimTurns: 0,
  };
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
  const selected = resolveGroupHistoryMessages(messages, null, undefined).slice(-12);
  const systemBase = await buildGroupLlmSystem(params.userId, params.dialect, {
    groupId: params.groupId,
    topicId: params.topicId,
    query: params.pendingUser,
  });
  const systemPrompt = systemBase + formatTopicSkillsAsSystemBlock(skills);
  const history: ChatMessageInput[] = selected.map((m) => {
    const role: 'assistant' | 'user' = m.kind === 'ai' ? 'assistant' : 'user';
    const speaker =
      m.kind === 'ai' && m.invokerAssistantName
        ? `${m.authorDisplayName ?? '成员'} 的 ${m.invokerAssistantName}`
        : m.authorDisplayName ?? '成员';
    return { role, content: `[${speaker}] ${m.content}` };
  });
  const last6 = selected
    .slice(-6)
    .map((m) => `${m.authorDisplayName ?? '成员'}: ${m.content.slice(0, 80)}`)
    .join('\n');
  return {
    systemPrompt,
    history,
    shortSummary: `群聊最近 6 条：\n${last6}`,
    usage: emptyContextUsage(),
    source: {
      channel: 'group',
      groupId: params.groupId,
      topicId: params.topicId,
    },
  };
}
