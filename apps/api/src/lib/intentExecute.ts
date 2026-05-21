import type {
  ContextSelection,
  IntentExecuteResult,
  IntentKind,
  MemoryIntentSlots,
} from '@xzz/shared';
import { resolveZenmuxChatModel } from '@xzz/shared';
import { applyMemoryIntent } from './memoryApply.js';
import { prepareChatContext } from './contextPipeline.js';
import { invokeGroupLlm } from './groupLlm.js';
import { zenmuxChatFromMessages } from './zenmux.js';
import { compactHistoryViaLlm } from './contextCompact.js';
import { salvageMemoriesBeforeCompact } from './memoryPreCompact.js';
import { ingestMagiContent, queryMagiSystem } from './integrations/magi.js';
import type { IntentChannel } from './intentAnalyzer.js';
import * as pg from '../store/pg.js';
import * as social from '../store/pg-social.js';

export type { IntentExecuteResult };

export type AgentOptions = {
  /** M1e Task 12：per-run LLM provider 选型，由 mobile "我的"页设置传过来 */
  providerId?: 'deepseek' | 'zenmux';
  /** modelId 必须是该 provider 的合法 id（前端校验，后端透传） */
  modelId?: string;
};

export type ExecuteIntentInput = {
  userId: string;
  text: string;
  kind: IntentKind;
  channel: IntentChannel;
  slots?: MemoryIntentSlots;
  targetFragmentId?: string;
  sessionId?: string;
  groupId?: string;
  topicId?: string;
  apiKey: string;
  deepseekApiKey?: string;
  /**
   * M1e Task 12: user-provided ZenMux key 同 deepseekApiKey 一道走 sealed 落库。
   * 当 agentOptions.providerId='zenmux' 时优先用这个。
   */
  zenmuxApiKey?: string;
  model?: string;
  dialect?: import('@xzz/shared').ReplyDialect;
  contextSelection?: ContextSelection;
  selectedMessageIds?: string[];
  /** M1e Task 12: agent-only options (per-run provider/model). */
  agentOptions?: AgentOptions;
};

async function persistPrivateToolReply(
  userId: string,
  sessionId: string,
  userText: string,
  confirmation: string,
): Promise<IntentExecuteResult> {
  const userMsg = (await pg.addChatMessage(userId, sessionId, 'user', userText))!;
  const assistantMsg = (await pg.addChatMessage(
    userId,
    sessionId,
    'assistant',
    confirmation,
  ))!;
  return {
    type: 'tool',
    userMessage: userMsg,
    assistantMessage: assistantMsg,
    confirmation,
  };
}

async function persistGroupToolReply(
  userId: string,
  groupId: string,
  topicId: string,
  userText: string,
  confirmation: string,
): Promise<IntentExecuteResult> {
  const userMsg = await social.addGroupMessage(userId, groupId, topicId, {
    kind: 'human',
    content: userText,
  });
  if (!userMsg) {
    throw new Error('Failed to persist user group message');
  }
  const sysMsg = await social.addGroupMessage(userId, groupId, topicId, {
    kind: 'system',
    content: confirmation,
  });
  if (!sysMsg) {
    throw new Error('Failed to persist system confirmation');
  }
  return {
    type: 'tool',
    groupMessages: [userMsg, sysMsg],
    confirmation,
  };
}

async function compactPrivateSession(
  userId: string,
  sessionId: string,
  apiKey: string,
  dialect?: import('@xzz/shared').ReplyDialect,
): Promise<string> {
  const session = await pg.getChatSession(userId, sessionId);
  if (!session) throw new Error('SESSION_NOT_FOUND');
  const allMessages = await pg.getChatMessages(userId, sessionId);
  if (allMessages.length === 0) {
    return '当前对话还没有可压缩的历史消息。';
  }
  const turns = allMessages.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
    id: m.id,
  }));
  await salvageMemoriesBeforeCompact({
    apiKey,
    userId,
    messages: turns,
    scope: 'session',
    sessionId,
    log: { userId, channel: 'memory_extract', sessionId },
  });
  const summary = await compactHistoryViaLlm({
    apiKey,
    messages: turns,
    existingSummary: session.contextSummary ?? null,
    dialect,
  });
  const lastId = allMessages[allMessages.length - 1]?.id ?? null;
  await pg.updateChatSessionContext(userId, sessionId, summary, lastId);
  return '已整理并压缩对话上下文，后续回复会优先参考摘要。';
}

export async function executeIntent(
  input: ExecuteIntentInput,
): Promise<IntentExecuteResult> {
  const slots: MemoryIntentSlots = {
    ...input.slots,
    targetFragmentId: input.targetFragmentId ?? input.slots?.targetFragmentId,
  };

  const memCtx = {
    userId: input.userId,
    sessionId: input.sessionId,
    groupId: input.groupId,
    topicId: input.topicId,
    apiKey: input.deepseekApiKey,
  };

  if (
    input.kind === 'persona_open_settings' ||
    input.kind === 'app_navigate'
  ) {
    return { type: 'skipped', reason: 'CLIENT_NAVIGATE' };
  }

  if (input.kind === 'agent_run') {
    const { createAgentRun } = await import('./agent/runtime.js');
    const providerId = input.agentOptions?.providerId; // undefined → DB default 'deepseek'
    // 根据 providerId 选 user key 字段：zenmux 用 zenmuxApiKey，否则用 deepseekApiKey。
    const userKey =
      providerId === 'zenmux' ? input.zenmuxApiKey : input.deepseekApiKey;
    const apiKey = userKey ?? input.apiKey;
    const apiKeySource = userKey ? 'user' : 'server';
    const modelId = input.agentOptions?.modelId;

    if (input.channel === 'private') {
      if (!input.sessionId) {
        return { type: 'skipped', reason: 'AGENT_PRIVATE_REQUIRES_SESSION' };
      }
      const r = await createAgentRun({
        ownerId: input.userId,
        channel: 'private',
        sessionId: input.sessionId,
        inputText: input.text,
        apiKey,
        apiKeySource,
        providerId,
        modelId,
      });
      return {
        type: 'agent',
        runId: r.run.id,
        userMessageId: r.userMessageId,
        placeholderMessageId: r.placeholderMessageId,
      };
    }

    if (input.channel === 'group') {
      if (!input.groupId || !input.topicId) {
        return { type: 'skipped', reason: 'AGENT_GROUP_REQUIRES_GROUP_TOPIC' };
      }
      const r = await createAgentRun({
        ownerId: input.userId,
        channel: 'group',
        groupId: input.groupId,
        topicId: input.topicId,
        inputText: input.text,
        apiKey,
        apiKeySource,
        providerId,
        modelId,
      });
      return {
        type: 'agent',
        runId: r.run.id,
        userMessageId: r.userMessageId,
        placeholderMessageId: r.placeholderMessageId,
      };
    }

    return { type: 'skipped', reason: 'AGENT_UNSUPPORTED_CHANNEL' };
  }

  if (
    input.kind === 'memory_remember' ||
    input.kind === 'memory_correct' ||
    input.kind === 'memory_forget'
  ) {
    const { confirmation } = await applyMemoryIntent(input.kind, slots, memCtx);

    if (input.channel === 'private' && input.sessionId) {
      const userMsg = (await pg.addChatMessage(
        input.userId,
        input.sessionId,
        'user',
        input.text,
      ))!;
      const assistantMsg = (await pg.addChatMessage(
        input.userId,
        input.sessionId,
        'assistant',
        confirmation,
      ))!;
      return {
        type: 'memory',
        userMessage: userMsg,
        assistantMessage: assistantMsg,
        confirmation,
      };
    }

    if (input.channel === 'group' && input.groupId && input.topicId) {
      const groupResult = await persistGroupToolReply(
        input.userId,
        input.groupId,
        input.topicId,
        input.text,
        confirmation,
      );
      if (groupResult.type === 'tool') {
        return {
          type: 'memory',
          groupMessages: groupResult.groupMessages,
          confirmation,
        };
      }
      return { type: 'memory', confirmation };
    }

    return { type: 'memory', confirmation };
  }

  if (input.kind === 'context_compact') {
    if (!input.sessionId || input.channel !== 'private') {
      return { type: 'skipped', reason: 'COMPACT_PRIVATE_ONLY' };
    }
    const dsKey = input.deepseekApiKey ?? input.apiKey;
    const confirmation = await compactPrivateSession(
      input.userId,
      input.sessionId,
      dsKey,
      input.dialect,
    );
    return persistPrivateToolReply(
      input.userId,
      input.sessionId,
      input.text,
      confirmation,
    );
  }

  if (input.kind === 'magi_system_query') {
    const answer = await queryMagiSystem(input.text);
    const confirmation = answer?.trim()
      ? `知识库查询结果：\n${answer.trim()}`
      : '知识库暂无相关结果。';
    if (input.channel === 'private' && input.sessionId) {
      return persistPrivateToolReply(
        input.userId,
        input.sessionId,
        input.text,
        confirmation,
      );
    }
    if (input.channel === 'group' && input.groupId && input.topicId) {
      return persistGroupToolReply(
        input.userId,
        input.groupId,
        input.topicId,
        input.text,
        confirmation,
      );
    }
    return { type: 'tool', confirmation };
  }

  if (input.kind === 'magi_content_link') {
    const url = input.text.match(/https?:\/\/\S+/)?.[0];
    if (!url) return { type: 'skipped', reason: 'NO_URL' };
    const card = await ingestMagiContent(url);
    const confirmation = card?.title
      ? `已处理链接：${card.title}`
      : '链接已提交处理。';
    if (input.channel === 'private' && input.sessionId) {
      return persistPrivateToolReply(
        input.userId,
        input.sessionId,
        input.text,
        confirmation,
      );
    }
    if (input.channel === 'group' && input.groupId && input.topicId) {
      return persistGroupToolReply(
        input.userId,
        input.groupId,
        input.topicId,
        input.text,
        confirmation,
      );
    }
    return { type: 'tool', confirmation };
  }

  if (input.kind === 'human_group_message') {
    if (!input.groupId || !input.topicId) {
      return { type: 'skipped', reason: 'MISSING_GROUP' };
    }
    const msg = await social.addGroupMessage(
      input.userId,
      input.groupId,
      input.topicId,
      { kind: 'human', content: input.text },
    );
    if (!msg) return { type: 'skipped', reason: 'FORBIDDEN' };
    return { type: 'group_human', message: msg };
  }

  if (input.kind === 'chat_group_llm') {
    if (!input.groupId || !input.topicId) {
      return { type: 'skipped', reason: 'MISSING_GROUP' };
    }
    const model = resolveZenmuxChatModel(input.model);
    const { message, invokeMessage } = await invokeGroupLlm({
      userId: input.userId,
      groupId: input.groupId,
      topicId: input.topicId,
      apiKey: input.apiKey,
      model,
      instruction: input.text,
      selectedMessageIds: input.selectedMessageIds,
      contextSelection: input.contextSelection,
      dialect: input.dialect,
    });
    return { type: 'group', invokeMessage, aiMessage: message };
  }

  if (input.kind === 'chat_private_llm') {
    if (!input.sessionId) return { type: 'skipped', reason: 'MISSING_SESSION' };
    const model = resolveZenmuxChatModel(input.model);
    const prepared = await prepareChatContext({
      userId: input.userId,
      apiKey: input.apiKey,
      sessionId: input.sessionId,
      pendingUser: input.text,
      dialect: input.dialect,
      contextSelection: input.contextSelection,
    });
    const llmStarted = Date.now();
    const llm = await zenmuxChatFromMessages(input.apiKey, model, prepared.messages, {
      log: {
        userId: input.userId,
        channel: 'intent_execute',
        sessionId: input.sessionId,
        contextRatio: prepared.usage.ratio,
      },
    });
    const responseTimeMs = Date.now() - llmStarted;
    const userMsg = (await pg.addChatMessage(
      input.userId,
      input.sessionId,
      'user',
      input.text,
    ))!;
    const assistantMsg = (await pg.addChatMessage(
      input.userId,
      input.sessionId,
      'assistant',
      llm.content,
      {
        llmReply: {
          model,
          totalTokens: llm.usage.totalTokens,
          promptTokens: llm.usage.promptTokens,
          completionTokens: llm.usage.completionTokens,
          responseTimeMs,
        },
      },
    ))!;
    return { type: 'chat', userMessage: userMsg, assistantMessage: assistantMsg };
  }

  return { type: 'skipped', reason: 'UNSUPPORTED_KIND' };
}
