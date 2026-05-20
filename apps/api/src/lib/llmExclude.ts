import {
  cancelLlmExclude,
  markLlmExclude,
  type ChatMessage,
  type GroupMessage,
  type LlmExcludeActor,
  type WritingAssistantMessage,
} from '@xzz/shared';
import * as pg from '../store/pg.js';
import * as social from '../store/pg-social.js';

export async function getLlmExcludeActor(userId: string): Promise<LlmExcludeActor> {
  const profile = await pg.getUserAiProfile(userId);
  return {
    userId,
    displayName: profile.assistantName?.trim() || '用户',
  };
}

const WRITING_MARKABLE_KINDS = new Set(['chat', 'notice']);

export async function markWritingMessageLlmExclude(
  userId: string,
  documentId: string,
  messageId: string,
): Promise<WritingAssistantMessage> {
  const msg = await pg.getWritingAssistantMessage(userId, documentId, messageId);
  if (!msg) throw new Error('NOT_FOUND');
  if (!WRITING_MARKABLE_KINDS.has(msg.kind)) throw new Error('INVALID_MESSAGE_KIND');

  const actor = await getLlmExcludeActor(userId);
  const updated = await pg.updateWritingAssistantMessage(userId, documentId, messageId, {
    llmExclude: markLlmExclude(msg.llmExclude, actor),
  });
  if (!updated) throw new Error('NOT_FOUND');
  return updated;
}

export async function cancelWritingMessageLlmExclude(
  userId: string,
  documentId: string,
  messageId: string,
): Promise<WritingAssistantMessage> {
  const msg = await pg.getWritingAssistantMessage(userId, documentId, messageId);
  if (!msg) throw new Error('NOT_FOUND');
  if (!WRITING_MARKABLE_KINDS.has(msg.kind)) throw new Error('INVALID_MESSAGE_KIND');

  const actor = await getLlmExcludeActor(userId);
  const updated = await pg.updateWritingAssistantMessage(userId, documentId, messageId, {
    llmExclude: cancelLlmExclude(msg.llmExclude, actor),
  });
  if (!updated) throw new Error('NOT_FOUND');
  return updated;
}

const GROUP_MARKABLE_KINDS = new Set<GroupMessage['kind']>(['human', 'ai']);

export async function markGroupMessageLlmExclude(
  userId: string,
  groupId: string,
  topicId: string,
  messageId: string,
): Promise<GroupMessage> {
  const msg = await social.getGroupMessage(userId, groupId, topicId, messageId);
  if (!msg) throw new Error('NOT_FOUND');
  if (!GROUP_MARKABLE_KINDS.has(msg.kind)) throw new Error('INVALID_MESSAGE_KIND');

  const actor = await getLlmExcludeActor(userId);
  const updated = await social.updateGroupMessage(userId, groupId, topicId, messageId, {
    llmExclude: markLlmExclude(msg.llmExclude, actor),
  });
  if (!updated) throw new Error('NOT_FOUND');
  return updated;
}

export async function cancelGroupMessageLlmExclude(
  userId: string,
  groupId: string,
  topicId: string,
  messageId: string,
): Promise<GroupMessage> {
  const msg = await social.getGroupMessage(userId, groupId, topicId, messageId);
  if (!msg) throw new Error('NOT_FOUND');
  if (!GROUP_MARKABLE_KINDS.has(msg.kind)) throw new Error('INVALID_MESSAGE_KIND');

  const actor = await getLlmExcludeActor(userId);
  const updated = await social.updateGroupMessage(userId, groupId, topicId, messageId, {
    llmExclude: cancelLlmExclude(msg.llmExclude, actor),
  });
  if (!updated) throw new Error('NOT_FOUND');
  return updated;
}

export async function markChatMessageLlmExclude(
  userId: string,
  sessionId: string,
  messageId: string,
): Promise<ChatMessage> {
  const msg = await pg.getChatMessage(userId, sessionId, messageId);
  if (!msg) throw new Error('NOT_FOUND');

  const actor = await getLlmExcludeActor(userId);
  const updated = await pg.updateChatMessage(userId, sessionId, messageId, {
    llmExclude: markLlmExclude(msg.llmExclude, actor),
  });
  if (!updated) throw new Error('NOT_FOUND');
  return updated;
}

export async function cancelChatMessageLlmExclude(
  userId: string,
  sessionId: string,
  messageId: string,
): Promise<ChatMessage> {
  const msg = await pg.getChatMessage(userId, sessionId, messageId);
  if (!msg) throw new Error('NOT_FOUND');

  const actor = await getLlmExcludeActor(userId);
  const updated = await pg.updateChatMessage(userId, sessionId, messageId, {
    llmExclude: cancelLlmExclude(msg.llmExclude, actor),
  });
  if (!updated) throw new Error('NOT_FOUND');
  return updated;
}
