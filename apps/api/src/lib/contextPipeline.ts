import {
  assembleChatContext,
  assembleWritingExecuteContext,
  assembleWritingIntentContext,
  blocksFromAssembleChatResult,
  blocksFromWritingIntent,
  chatPersonaSystem,
  defaultSelectedBlockIds,
  filterHistoryTurns,
  contextSelectionWithServerMarks,
  usesExclusionMode,
  shouldCompact,
  writingIntentPromptForDialect,
  writingIntentPersonaSystem,
  writingPersonaSystem,
  ACTION_PROMPTS,
  type ContextPreview,
  type ContextSelection,
  type ContextUsage,
  type ReplyDialect,
} from '@xzz/shared';
import type { ChatMessage, ChatSession, Document, WritingAssistantMessage } from '@xzz/shared';
import type { ChatMessageInput } from './deepseek.js';
import { compactHistoryViaLlm, compactDocumentExcerptViaLlm } from './contextCompact.js';
import * as pg from '../store/pg.js';
import * as profilePg from '../store/pg-profile.js';
import { resolveMemoriesForContext } from './memoryResolve.js';
import { salvageMemoriesBeforeCompact } from './memoryPreCompact.js';

const MAX_COMPACT_ROUNDS = 2;

type HistoryTurn = { role: 'user' | 'assistant'; content: string; id?: string };

export function applyContextSelection<T extends { id?: string; role: string; content: string }>(
  history: T[],
  selection?: ContextSelection | null,
): T[] {
  return filterHistoryTurns(history, selection);
}

function writingBlocksIncluded(
  preview: ContextPreview,
  selection?: ContextSelection | null,
): { chapter: boolean; document: boolean } {
  const chapterBlock = preview.blocks.find((b) => b.kind === 'document_chapter');
  const documentBlock = preview.blocks.find((b) => b.kind === 'document_excerpt');
  if (selection && usesExclusionMode(selection)) {
    const excluded = new Set(selection.excludedBlockIds ?? []);
    return {
      chapter: chapterBlock ? !excluded.has(chapterBlock.id) : true,
      document: documentBlock ? !excluded.has(documentBlock.id) : true,
    };
  }
  const selected = new Set(
    selection?.selectedBlockIds?.length
      ? selection.selectedBlockIds
      : defaultSelectedBlockIds(preview.blocks),
  );
  return {
    chapter: chapterBlock ? selected.has(chapterBlock.id) : true,
    document: documentBlock ? selected.has(documentBlock.id) : true,
  };
}

function chatHistoryAfterAnchor(
  messages: ChatMessage[],
  upToMessageId: string | null | undefined,
): ChatMessage[] {
  if (!upToMessageId) return messages;
  const idx = messages.findIndex((m) => m.id === upToMessageId);
  return idx >= 0 ? messages.slice(idx + 1) : messages;
}

function toTurns(messages: Array<{ role: string; content: string; id?: string }>): HistoryTurn[] {
  return messages.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
    id: m.id,
  }));
}

function writingMessagesForLlm(messages: WritingAssistantMessage[]): WritingAssistantMessage[] {
  return messages.filter((m) => m.kind !== 'notice' && m.kind !== 'revision_ready');
}

function chatContextSelectionWithServerMarks(
  allMessages: ChatMessage[],
  contextSelection?: ContextSelection | null,
): ContextSelection | undefined {
  return contextSelectionWithServerMarks(allMessages, contextSelection);
}

function writingContextSelectionWithServerMarks(
  allMessages: WritingAssistantMessage[],
  contextSelection?: ContextSelection | null,
): ContextSelection | undefined {
  return contextSelectionWithServerMarks(allMessages, contextSelection);
}

function messageLlmExcludeMap(
  messages: Array<{ id: string; llmExclude?: import('@xzz/shared').LlmExcludeMeta | null }>,
): Record<string, import('@xzz/shared').LlmExcludeMeta | undefined> {
  const map: Record<string, import('@xzz/shared').LlmExcludeMeta | undefined> = {};
  for (const m of messages) {
    if (m.llmExclude) map[m.id] = m.llmExclude;
  }
  return map;
}

function writingHistoryAfterAnchor(
  messages: WritingAssistantMessage[],
  upToMessageId: string | null | undefined,
): WritingAssistantMessage[] {
  const filtered = writingMessagesForLlm(messages);
  if (!upToMessageId) return filtered;
  const idx = filtered.findIndex((m) => m.id === upToMessageId);
  return idx >= 0 ? filtered.slice(idx + 1) : filtered;
}

export type PreparedChatContext = {
  messages: ChatMessageInput[];
  usage: ContextUsage;
  session: ChatSession;
};

export async function prepareChatContext(params: {
  userId: string;
  apiKey: string;
  sessionId: string;
  pendingUser: string;
  dialect?: ReplyDialect;
  contextSelection?: ContextSelection;
}): Promise<PreparedChatContext> {
  const session = await pg.getChatSession(params.userId, params.sessionId);
  if (!session) throw new Error('SESSION_NOT_FOUND');

  const allMessages = await pg.getChatMessages(params.userId, params.sessionId);
  const effectiveSelection = chatContextSelectionWithServerMarks(
    allMessages,
    params.contextSelection,
  );
  const persona = await profilePg.getPersonaSettings(params.userId);
  const memoryBlock = await resolveMemoriesForContext({
    userId: params.userId,
    sessionId: params.sessionId,
    query: params.pendingUser,
  });
  const systemPrompt =
    chatPersonaSystem(persona, params.dialect) +
    (memoryBlock ? `\n\n${memoryBlock}` : '');

  let summary = session.contextSummary ?? null;
  let upToId = session.contextSummaryUpToMessageId ?? null;

  for (let round = 0; round < MAX_COMPACT_ROUNDS; round++) {
    const historyMsgs = applyContextSelection(
      chatHistoryAfterAnchor(allMessages, upToId),
      effectiveSelection,
    );
    const history = toTurns(historyMsgs);
    const assembled = assembleChatContext({
      systemPrompt,
      summary,
      history,
      pendingUser: params.pendingUser,
    });

    if (!assembled.needsCompact && !shouldCompact(assembled.usage)) {
      return {
        messages: assembled.messages as ChatMessageInput[],
        usage: {
          ...assembled.usage,
          compacted: Boolean(summary?.trim()),
        },
        session: (await pg.getChatSession(params.userId, params.sessionId))!,
      };
    }

    const omitCount = assembled.messagesToCompact.length;
    if (omitCount === 0) break;

    const toCompact = historyMsgs.slice(0, omitCount);
    await salvageMemoriesBeforeCompact({
      apiKey: params.apiKey,
      userId: params.userId,
      messages: toTurns(toCompact),
      scope: 'session',
      sessionId: params.sessionId,
      log: {
        userId: params.userId,
        channel: 'memory_extract',
        sessionId: params.sessionId,
      },
    });
    const merged = await compactHistoryViaLlm({
      apiKey: params.apiKey,
      messages: toTurns(toCompact),
      existingSummary: summary,
      dialect: params.dialect,
    });
    summary = merged;
    const lastId = toCompact[toCompact.length - 1]?.id ?? upToId;
    upToId = lastId;
    await pg.updateChatSessionContext(params.userId, params.sessionId, summary, lastId);
  }

  const historyMsgs = applyContextSelection(
    chatHistoryAfterAnchor(allMessages, upToId),
    effectiveSelection,
  );
  const assembled = assembleChatContext({
    systemPrompt,
    summary,
    history: toTurns(historyMsgs),
    pendingUser: params.pendingUser,
  });

  return {
    messages: assembled.messages as ChatMessageInput[],
    usage: {
      ...assembled.usage,
      compacted: Boolean(summary?.trim()),
    },
    session: (await pg.getChatSession(params.userId, params.sessionId))!,
  };
}

export async function previewChatContextPreview(params: {
  userId: string;
  sessionId: string;
  pendingUser?: string;
  dialect?: ReplyDialect;
  contextSelection?: ContextSelection;
}): Promise<ContextPreview> {
  const session = await pg.getChatSession(params.userId, params.sessionId);
  if (!session) throw new Error('SESSION_NOT_FOUND');

  const allMessages = await pg.getChatMessages(params.userId, params.sessionId);
  const effectiveSelection = chatContextSelectionWithServerMarks(
    allMessages,
    params.contextSelection,
  );
  const historyMsgs = applyContextSelection(
    chatHistoryAfterAnchor(allMessages, session.contextSummaryUpToMessageId),
    effectiveSelection,
  );
  const persona = await profilePg.getPersonaSettings(params.userId);
  const memoryBlock = await resolveMemoriesForContext({
    userId: params.userId,
    sessionId: params.sessionId,
    query: params.pendingUser,
  });
  const assembled = assembleChatContext({
    systemPrompt:
      chatPersonaSystem(persona, params.dialect) +
      (memoryBlock ? `\n\n${memoryBlock}` : ''),
    summary: session.contextSummary,
    history: toTurns(historyMsgs),
    pendingUser: params.pendingUser?.trim() || '…',
  });
  const preview = blocksFromAssembleChatResult(assembled, {
    historyMessageIds: historyMsgs.map((m) => m.id),
    excludedMessageIds: usesExclusionMode(effectiveSelection)
      ? effectiveSelection!.excludedMessageIds
      : undefined,
    messageLlmExclude: messageLlmExcludeMap(allMessages),
  });
  return {
    ...preview,
    usage: {
      ...preview.usage,
      compacted: Boolean(session.contextSummary?.trim()) || assembled.needsCompact,
    },
  };
}

export async function previewChatContextUsage(params: {
  userId: string;
  sessionId: string;
  pendingUser?: string;
  dialect?: ReplyDialect;
  contextSelection?: ContextSelection;
}): Promise<ContextUsage> {
  const preview = await previewChatContextPreview(params);
  return preview.usage;
}

export type PreparedWritingIntentContext = {
  messages: ChatMessageInput[];
  usage: ContextUsage;
  document: Document;
};

export async function prepareWritingIntentContext(params: {
  userId: string;
  apiKey: string;
  documentId: string;
  document: Document;
  allMessages: WritingAssistantMessage[];
  chapterBlock: string;
  documentBlock: string;
  userMessage: string;
  dialect?: ReplyDialect;
  contextSelection?: ContextSelection;
}): Promise<PreparedWritingIntentContext> {
  const effectiveSelection = writingContextSelectionWithServerMarks(
    params.allMessages,
    params.contextSelection,
  );
  const persona = await profilePg.getPersonaSettings(params.userId);
  const memoryBlock = await resolveMemoriesForContext({
    userId: params.userId,
    query: params.userMessage,
  });
  const systemPrompt =
    writingIntentPersonaSystem(
      persona,
      writingIntentPromptForDialect(params.dialect),
    ) + (memoryBlock ? `\n\n${memoryBlock}` : '');
  let summary = params.document.writingContextSummary ?? null;
  let upToId = params.document.writingContextSummaryUpToMessageId ?? null;
  let doc = params.document;
  let documentBlock = params.documentBlock;
  let chapterBlock = params.chapterBlock;

  const draftPreview = blocksFromWritingIntent(
    assembleWritingIntentContext({
      systemPrompt,
      summary,
      history: toTurns(writingHistoryAfterAnchor(params.allMessages, upToId)),
      chapterBlock,
      documentBlock,
      userMessage: params.userMessage,
    }),
    { chapterBlock, documentBlock },
  );
  const included = writingBlocksIncluded(draftPreview, effectiveSelection);
  if (!included.chapter) chapterBlock = '';
  if (!included.document) documentBlock = '';

  for (let round = 0; round < MAX_COMPACT_ROUNDS; round++) {
    const historyMsgs = applyContextSelection(
      writingHistoryAfterAnchor(params.allMessages, upToId),
      effectiveSelection,
    );
    const history = toTurns(historyMsgs);
    const assembled = assembleWritingIntentContext({
      systemPrompt,
      summary,
      history,
      chapterBlock,
      documentBlock,
      userMessage: params.userMessage,
    });

    if (!assembled.needsCompact && !shouldCompact(assembled.usage)) {
      return {
        messages: assembled.messages as ChatMessageInput[],
        usage: {
          ...assembled.usage,
          compacted:
            Boolean(summary?.trim()) || Boolean(doc.documentContextSummary?.trim()),
        },
        document: doc,
      };
    }

    const omitCount = assembled.messagesToCompact.length;
    if (omitCount > 0) {
      const toCompact = historyMsgs.slice(0, omitCount);
      summary = await compactHistoryViaLlm({
        apiKey: params.apiKey,
        messages: toTurns(toCompact),
        existingSummary: summary,
        dialect: params.dialect,
      });
      const lastId = toCompact[toCompact.length - 1]?.id ?? upToId;
      upToId = lastId;
      doc =
        (await pg.updateDocumentContextFields(params.userId, params.documentId, {
          writingContextSummary: summary,
          writingContextSummaryUpToMessageId: lastId,
        })) ?? doc;
    } else if (documentBlock.length > 6000 && !doc.documentContextSummary?.trim()) {
      const compactDoc = await compactDocumentExcerptViaLlm({
        apiKey: params.apiKey,
        documentExcerpt: documentBlock,
        dialect: params.dialect,
      });
      doc =
        (await pg.updateDocumentContextFields(params.userId, params.documentId, {
          documentContextSummary: compactDoc,
        })) ?? doc;
      documentBlock = `全篇摘要（供理解，勿改其它章）：\n${compactDoc}`;
    } else {
      break;
    }
  }

  const historyMsgs = applyContextSelection(
    writingHistoryAfterAnchor(params.allMessages, upToId),
    effectiveSelection,
  );
  const docBlock =
    doc.documentContextSummary?.trim() &&
    !documentBlock.includes('全篇摘要') &&
    documentBlock.length > 4000
      ? `全篇摘要（供理解，勿改其它章）：\n${doc.documentContextSummary}`
      : documentBlock;

  const assembled = assembleWritingIntentContext({
    systemPrompt,
    summary,
    history: toTurns(historyMsgs),
    chapterBlock,
    documentBlock: docBlock,
    userMessage: params.userMessage,
  });

  return {
    messages: assembled.messages as ChatMessageInput[],
    usage: {
      ...assembled.usage,
      compacted:
        Boolean(summary?.trim()) ||
        Boolean(doc.documentContextSummary?.trim()) ||
        assembled.needsCompact,
    },
    document: doc,
  };
}

export async function prepareWritingExecuteContext(params: {
  userId: string;
  action: string;
  oldText: string;
  instruction?: string;
  styleGuide?: string;
  dialect?: ReplyDialect;
  chapterTitle?: string;
  understandingScope?: 'chapter' | 'document';
  documentExcerpt?: string;
  documentContextSummary?: string | null;
}): Promise<{ messages: ChatMessageInput[]; usage: ContextUsage }> {
  const actionPrompt = ACTION_PROMPTS[params.action] ?? ACTION_PROMPTS['润色'];
  const isContinue = params.action === '续写';
  const useFullDoc = params.understandingScope === 'document';
  const persona = await profilePg.getPersonaSettings(params.userId);
  const memoryBlock = await resolveMemoriesForContext({
    userId: params.userId,
    query: params.instruction,
  });

  const system = `${writingPersonaSystem(persona, params.dialect)}${
    memoryBlock ? `\n\n${memoryBlock}` : ''
  }

${actionPrompt}

要求：
- 每次只能修改「待改本段」的正文；其它段落仅供理解上下文，不得改写或输出其它段落内容。
${isContinue ? '- 只输出需要续写的新增段落，不要重复原文，不要加标题或说明' : '- 只输出修改后的完整段落正文，不要加标题、引号或解释'}
- 不要使用 markdown 格式`;

  const docPart =
    useFullDoc && params.documentContextSummary?.trim()
      ? `全篇摘要（仅供理解，勿改其它章）：\n${params.documentContextSummary.trim()}`
      : useFullDoc && params.documentExcerpt?.trim()
        ? `全篇节选（仅供理解，勿改其它章）：\n${params.documentExcerpt.trim()}`
        : '';

  const userParts = [
    params.styleGuide ? `写作风格：${params.styleGuide}` : '',
    params.chapterTitle ? `待改本段：${params.chapterTitle}` : '',
    useFullDoc
      ? '理解范围：可参考下方全篇理解上下文，但输出只能替换待改本段正文。'
      : '理解范围：仅根据待改本段正文理解，不要引用其它段落内容来改写。',
    `待改本段正文：\n${params.oldText || '（空）'}`,
    docPart,
    params.instruction ? `用户补充：${params.instruction}` : '',
  ].filter(Boolean);

  const { messages, usage } = assembleWritingExecuteContext({
    systemPrompt: system,
    userParts,
  });

  return { messages: messages as ChatMessageInput[], usage };
}

export async function previewWritingIntentContextPreview(params: {
  userId: string;
  document: Document;
  allMessages: WritingAssistantMessage[];
  chapterBlock: string;
  documentBlock: string;
  pendingUser?: string;
  dialect?: ReplyDialect;
  contextSelection?: ContextSelection;
}): Promise<ContextPreview> {
  const persona = await profilePg.getPersonaSettings(params.userId);
  const intentSystem = writingIntentPersonaSystem(
    persona,
    writingIntentPromptForDialect(params.dialect),
  );
  const effectiveSelection = writingContextSelectionWithServerMarks(
    params.allMessages,
    params.contextSelection,
  );
  const llmExcludeMap = messageLlmExcludeMap(params.allMessages);
  const historyMsgs = applyContextSelection(
    writingHistoryAfterAnchor(
      params.allMessages,
      params.document.writingContextSummaryUpToMessageId,
    ),
    effectiveSelection,
  );
  const docBlock =
    params.document.documentContextSummary?.trim() &&
    params.documentBlock.length > 4000
      ? `全篇摘要：\n${params.document.documentContextSummary}`
      : params.documentBlock;

  let chapterBlock = params.chapterBlock;
  let documentBlock = docBlock;
  const draftAssembled = assembleWritingIntentContext({
    systemPrompt: intentSystem,
    summary: params.document.writingContextSummary,
    history: toTurns(historyMsgs),
    chapterBlock,
    documentBlock,
    userMessage: params.pendingUser?.trim() || '…',
  });
  const draftPreview = blocksFromWritingIntent(draftAssembled, {
    chapterBlock,
    documentBlock,
    historyMessageIds: historyMsgs.map((m) => m.id),
  });
  const included = writingBlocksIncluded(draftPreview, effectiveSelection);
  if (!included.chapter) chapterBlock = '';
  if (!included.document) documentBlock = '';

  const assembled = assembleWritingIntentContext({
    systemPrompt: intentSystem,
    summary: params.document.writingContextSummary,
    history: toTurns(historyMsgs),
    chapterBlock,
    documentBlock,
    userMessage: params.pendingUser?.trim() || '…',
  });
  const exclusionOpts =
    effectiveSelection && usesExclusionMode(effectiveSelection)
      ? {
          excludedMessageIds: effectiveSelection.excludedMessageIds,
          excludedBlockIds: effectiveSelection.excludedBlockIds,
        }
      : {};
  const preview = blocksFromWritingIntent(assembled, {
    chapterBlock,
    documentBlock,
    historyMessageIds: historyMsgs.map((m) => m.id),
    messageLlmExclude: llmExcludeMap,
    ...exclusionOpts,
  });
  return {
    ...preview,
    usage: {
      ...preview.usage,
      compacted:
        Boolean(params.document.writingContextSummary?.trim()) || assembled.needsCompact,
    },
  };
}

export async function previewWritingIntentContextUsage(params: {
  userId: string;
  document: Document;
  allMessages: WritingAssistantMessage[];
  chapterBlock: string;
  documentBlock: string;
  pendingUser?: string;
  dialect?: ReplyDialect;
  contextSelection?: ContextSelection;
}): Promise<ContextUsage> {
  const preview = await previewWritingIntentContextPreview(params);
  return preview.usage;
}
