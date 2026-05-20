import {
  blocksFromGroupMessages,
  groupPersonaSystem,
  personaAssistantDisplayName,
  resolveZenmuxChatModel,
  contextSelectionWithServerMarks,
  resolveIncludedMessages,
  usesExclusionMode,
  type ContextPreview,
  type ContextSelection,
  type LlmInvokeMeta,
  type LlmReplyMeta,
} from '@xzz/shared';
import type { GroupMessage, LlmInvokeJob } from '@xzz/shared';
import type { ReplyDialect } from '@xzz/shared';
import { zenmuxChatFromMessages } from './zenmux.js';
import * as social from '../store/pg-social.js';
import * as intel from '../store/pg-intelligence.js';
import * as profilePg from '../store/pg-profile.js';
import { resolveMemoriesForContext } from './memoryResolve.js';

export function resolveGroupHistoryMessages(
  messages: GroupMessage[],
  contextSelection?: ContextSelection | null,
  legacySelectedMessageIds?: string[],
): GroupMessage[] {
  const nonSystem = messages.filter((m) => m.kind !== 'system');
  const eligible = nonSystem.filter((m) => !m.llmExclude?.active);
  const effectiveSelection = contextSelectionWithServerMarks(messages, contextSelection);
  if (effectiveSelection && usesExclusionMode(effectiveSelection)) {
    return resolveIncludedMessages(eligible, effectiveSelection);
  }
  if (effectiveSelection?.selectedMessageIds?.length) {
    return resolveIncludedMessages(eligible, effectiveSelection);
  }
  if (legacySelectedMessageIds?.length) {
    const ids = new Set(legacySelectedMessageIds);
    return eligible.filter((m) => ids.has(m.id));
  }
  return eligible.slice(-12);
}

function groupMessageLlmExcludeMap(
  messages: GroupMessage[],
): Record<string, import('@xzz/shared').LlmExcludeMeta | undefined> {
  const map: Record<string, import('@xzz/shared').LlmExcludeMeta | undefined> = {};
  for (const m of messages) {
    if (m.llmExclude) map[m.id] = m.llmExclude;
  }
  return map;
}

function previewSelectionParams(selection?: ContextSelection) {
  if (!selection) return {};
  if (usesExclusionMode(selection)) {
    return { excludedMessageIds: selection.excludedMessageIds ?? [] };
  }
  if (selection.selectedMessageIds?.length) {
    return { selectedMessageIds: selection.selectedMessageIds };
  }
  return {};
}

export async function buildGroupLlmSystem(
  userId: string,
  dialect?: ReplyDialect,
  ctx?: { groupId?: string; topicId?: string; query?: string },
): Promise<string> {
  const persona = await profilePg.getPersonaSettings(userId);
  const memoryBlock = await resolveMemoriesForContext({
    userId,
    groupId: ctx?.groupId,
    topicId: ctx?.topicId,
    query: ctx?.query,
  });
  const base = groupPersonaSystem(persona, dialect);
  return memoryBlock ? `${base}\n\n${memoryBlock}` : base;
}

export async function previewGroupContext(params: {
  userId: string;
  groupId: string;
  topicId: string;
  instruction: string;
  selectedMessageIds?: string[];
  contextSelection?: ContextSelection;
  dialect?: ReplyDialect;
}): Promise<ContextPreview> {
  const messages =
    (await social.listGroupMessages(params.userId, params.groupId, params.topicId, {
      limit: 50,
    })) ?? [];
  const system = await buildGroupLlmSystem(params.userId, params.dialect, {
    groupId: params.groupId,
    topicId: params.topicId,
    query: params.instruction,
  });
  const effectiveSelection = contextSelectionWithServerMarks(messages, params.contextSelection);
  return blocksFromGroupMessages({
    messages: messages.map((m) => ({
      id: m.id,
      kind: m.kind,
      content: m.content,
      authorDisplayName: m.authorDisplayName,
      invokerAssistantName: m.invokerAssistantName,
    })),
    systemPrompt: system,
    instruction: params.instruction,
    ...previewSelectionParams(effectiveSelection),
    selectedMessageIds: effectiveSelection ? undefined : params.selectedMessageIds,
    messageLlmExclude: groupMessageLlmExcludeMap(messages),
  });
}

export async function invokeGroupLlm(params: {
  userId: string;
  groupId: string;
  topicId: string;
  apiKey: string;
  model: string;
  instruction: string;
  selectedMessageIds?: string[];
  contextSelection?: ContextSelection;
  dialect?: ReplyDialect;
}): Promise<{ job: LlmInvokeJob; message: GroupMessage; invokeMessage: GroupMessage }> {
  const model = resolveZenmuxChatModel(params.model);
  const persona = await profilePg.getPersonaSettings(params.userId);
  const assistantName = personaAssistantDisplayName(persona);
  const messages =
    (await social.listGroupMessages(params.userId, params.groupId, params.topicId, {
      limit: 50,
    })) ?? [];

  const selected = resolveGroupHistoryMessages(
    messages,
    params.contextSelection,
    params.selectedMessageIds,
  );

  const historyText = selected
    .map((m) => {
      const who =
        m.kind === 'ai' && m.invokerAssistantName
          ? `${m.authorDisplayName ?? '成员'} 的 ${m.invokerAssistantName}`
          : m.authorDisplayName ?? '成员';
      return `${who}: ${m.content}`;
    })
    .join('\n');

  const job = await intel.createLlmJob({
    ownerId: params.userId,
    invokerUserId: params.userId,
    groupId: params.groupId,
    topicId: params.topicId,
    payload: { selectedMessageIds: params.selectedMessageIds ?? [], model },
  });

  await intel.updateLlmJob(params.userId, job.id, { status: 'running' });

  const system = await buildGroupLlmSystem(params.userId, params.dialect, {
    groupId: params.groupId,
    topicId: params.topicId,
    query: params.instruction,
  });

  const llmStarted = Date.now();
  const llmMessages = [
    { role: 'system' as const, content: system },
    {
      role: 'user' as const,
      content: `【群聊记录】\n${historyText}\n\n【用户请你回复】\n${params.instruction}`,
    },
  ];
  const llm = await zenmuxChatFromMessages(params.apiKey, model, llmMessages, {
    maxTokens: 2048,
    temperature: 0.7,
    log: {
      userId: params.userId,
      channel: 'group_chat',
      groupId: params.groupId,
      topicId: params.topicId,
    },
  });
  const responseTimeMs = Date.now() - llmStarted;

  const llmReply: LlmReplyMeta = {
    model,
    totalTokens: llm.usage.totalTokens,
    promptTokens: llm.usage.promptTokens,
    completionTokens: llm.usage.completionTokens,
    responseTimeMs,
  };

  const llmInvoke: LlmInvokeMeta = {
    model,
    totalTokens: llm.usage.totalTokens,
    promptTokens: llm.usage.promptTokens,
    completionTokens: llm.usage.completionTokens,
  };

  const invokeMessage = await social.addGroupMessage(
    params.userId,
    params.groupId,
    params.topicId,
    {
      kind: 'human',
      content: params.instruction,
      llmInvoke,
      jobId: job.id,
    },
  );
  if (!invokeMessage) {
    await intel.updateLlmJob(params.userId, job.id, { status: 'failed' });
    throw new Error('Failed to persist invoke group message');
  }

  const aiMsg = await social.addGroupMessage(
    params.userId,
    params.groupId,
    params.topicId,
    {
      kind: 'ai',
      content: llm.content,
      invokerUserId: params.userId,
      invokerAssistantName: assistantName,
      jobId: job.id,
      llmReply,
    },
  );
  if (!aiMsg) {
    await intel.updateLlmJob(params.userId, job.id, { status: 'failed' });
    throw new Error('Failed to persist AI group message');
  }

  await intel.updateLlmJob(params.userId, job.id, {
    status: 'done',
    resultMessageId: aiMsg.id,
  });

  return { job, message: aiMsg, invokeMessage };
}
