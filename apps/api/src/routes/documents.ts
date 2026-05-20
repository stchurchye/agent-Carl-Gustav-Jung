import { Hono } from 'hono';
import { jsonError } from '../lib/errors.js';
import type { AppVariables } from '../types.js';
import { log } from '../lib/logger.js';
import {
  chatCompletionRaw,
  deepseekWriting,
  deepseekWritingIntentFromMessages,
  deepseekWritingRetry,
  parseReplyDialect,
} from '../lib/deepseek.js';
import {
  prepareWritingExecuteContext,
  prepareWritingIntentContext,
  previewWritingIntentContextPreview,
  previewWritingIntentContextUsage,
} from '../lib/contextPipeline.js';
import {
  parseContextSelectionFromBody,
  parseContextSelectionFromQuery,
} from '../lib/contextSelectionParse.js';
import { getDeepSeekKey, handleAiError } from '../lib/ai-handler.js';
import {
  cancelWritingMessageLlmExclude,
  markWritingMessageLlmExclude,
} from '../lib/llmExcludeWriting.js';
import * as pg from '../store/pg.js';
import { requireAuth } from '../middleware/auth.js';
import {
  ErrorCodes,
  REPLY_DIALECT_HEADER,
  assistantWelcomeLine,
  assistantRejectConfirmLine,
  assistantWorkingLine,
  assistantRevisionReadyLine,
  writingDoneComment,
} from '@xzz/shared';

export const documentsRouter = new Hono<{ Variables: AppVariables }>();

documentsRouter.use('*', requireAuth);

function replyDialectFromRequest(c: { req: { header: (name: string) => string | undefined } }) {
  return parseReplyDialect(c.req.header(REPLY_DIALECT_HEADER));
}

documentsRouter.get('/', async (c) => {
  const userId = c.get('userId')!;
  return c.json({
    ok: true,
    data: await pg.listDocuments(userId),
    requestId: c.get('requestId'),
  });
});

documentsRouter.post('/', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json<{ title?: string }>();
  const title = body.title?.trim() || '未命名文稿';
  const doc = await pg.createDocument(userId, title);
  log('info', 'document.created', { documentId: doc.id, requestId: c.get('requestId') });
  return c.json({ ok: true, data: doc, requestId: c.get('requestId') }, 201);
});

documentsRouter.get('/:id', async (c) => {
  const userId = c.get('userId')!;
  const doc = await pg.getDocument(userId, c.req.param('id'));
  if (!doc) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  return c.json({ ok: true, data: doc, requestId: c.get('requestId') });
});

documentsRouter.patch('/:id', async (c) => {
  const userId = c.get('userId')!;
  const doc = await pg.updateDocument(userId, c.req.param('id'), await c.req.json());
  if (!doc) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  return c.json({ ok: true, data: doc, requestId: c.get('requestId') });
});

documentsRouter.post('/:id/chapters', async (c) => {
  const userId = c.get('userId')!;
  const documentId = c.req.param('id');
  if (!(await pg.getDocument(userId, documentId))) {
    return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  }
  const body = (await c.req.json<{ title?: string }>().catch(() => ({}))) as {
    title?: string;
  };
  const doc = await pg.addChapter(userId, documentId, body.title);
  if (!doc) {
    return jsonError(c, ErrorCodes.VALIDATION, 400);
  }
  log('info', 'chapter.added', { documentId, requestId: c.get('requestId') });
  return c.json({ ok: true, data: doc, requestId: c.get('requestId') }, 201);
});

documentsRouter.get('/:id/revisions', async (c) => {
  const userId = c.get('userId')!;
  const doc = await pg.getDocument(userId, c.req.param('id'));
  if (!doc) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  return c.json({
    ok: true,
    data: await pg.listRevisions(userId, c.req.param('id')),
    requestId: c.get('requestId'),
  });
});

documentsRouter.post('/:id/ai', async (c) => {
  const userId = c.get('userId')!;
  const documentId = c.req.param('id');
  const doc = await pg.getDocument(userId, documentId);
  if (!doc) return jsonError(c, ErrorCodes.NOT_FOUND, 404);

  const body = await c.req.json<{
    action: string;
    blockId: string;
    instruction?: string;
    retry?: {
      baseInstruction: string;
      previousSuggestion: string;
      additionalFeedback: string;
      priorFeedback?: string[];
    };
  }>();

  const found = pg.findBlock(doc, body.blockId);
  if (!found) return jsonError(c, ErrorCodes.NOT_FOUND, 404);

  const { block } = found;
  const oldText = block.content;
  const action = body.action || '润色';

  let apiKey: string;
  try {
    apiKey = getDeepSeekKey(c);
  } catch (e) {
    return handleAiError(c, e);
  }

  const dialect = replyDialectFromRequest(c);
  let suggested: string;
  let comment: string;
  try {
    if (body.retry) {
      const feedback = body.retry.additionalFeedback?.trim();
      if (!feedback) {
        return jsonError(c, ErrorCodes.VALIDATION, 400);
      }
      const result = await deepseekWritingRetry({
        apiKey,
        action,
        oldText,
        baseInstruction: body.retry.baseInstruction ?? '',
        previousSuggestion: body.retry.previousSuggestion,
        additionalFeedback: feedback,
        priorFeedback: body.retry.priorFeedback,
        styleGuide: doc.styleGuide,
        dialect,
      });
      suggested = result.text;
      comment = result.comment;
    } else {
      const result = await deepseekWriting({
        apiKey,
        action,
        oldText,
        instruction: body.instruction,
        styleGuide: doc.styleGuide,
        dialect,
      });
      suggested = result.text;
      comment = result.comment;
    }
  } catch (e) {
    return handleAiError(c, e);
  }

  log('info', 'ai.suggest', {
    documentId,
    action,
    model: 'deepseek-v4-pro',
    requestId: c.get('requestId'),
  });

  const revision = await pg.createRevision(userId, {
    documentId,
    blockId: body.blockId,
    parentRevisionId: block.currentRevisionId,
    snapshot: suggested,
    previousSnapshot: oldText,
    summary:
      action === '续写'
        ? `续写了${found.chapter.title}的一段`
        : `润色了${found.chapter.title}的一段`,
    source: 'ai',
    status: 'pending',
  });

  return c.json({
    ok: true,
    data: {
      revision,
      oldText,
      newText: suggested,
      comment,
    },
    requestId: c.get('requestId'),
  });
});

documentsRouter.post('/:id/revisions/:revisionId/accept', async (c) => {
  const userId = c.get('userId')!;
  const rev = await pg.getRevision(userId, c.req.param('revisionId'));
  if (!rev || rev.documentId !== c.req.param('id')) {
    return jsonError(c, ErrorCodes.REVISION_NOT_FOUND, 404);
  }
  if (rev.status !== 'pending') {
    return jsonError(c, ErrorCodes.REVISION_EXPIRED, 400);
  }

  let editedSnapshot: string | undefined;
  try {
    const body = await c.req.json<{ editedSnapshot?: string }>();
    if (body.editedSnapshot !== undefined) {
      const trimmed = body.editedSnapshot.trim();
      if (!trimmed) {
        return jsonError(c, ErrorCodes.VALIDATION, 400);
      }
      editedSnapshot = trimmed;
    }
  } catch {
    // 无请求体时与旧版行为一致
  }

  const accepted = await pg.acceptRevision(
    userId,
    c.req.param('revisionId'),
    editedSnapshot,
  );
  if (!accepted) return jsonError(c, ErrorCodes.REVISION_EXPIRED, 400);
  return c.json({
    ok: true,
    data: await pg.getDocument(userId, c.req.param('id')),
    requestId: c.get('requestId'),
  });
});

documentsRouter.post('/:id/revisions/:revisionId/reject', async (c) => {
  const userId = c.get('userId')!;
  const rev = await pg.getRevision(userId, c.req.param('revisionId'));
  if (!rev || rev.documentId !== c.req.param('id')) {
    return jsonError(c, ErrorCodes.REVISION_NOT_FOUND, 404);
  }
  if (rev.status !== 'pending') {
    return jsonError(c, ErrorCodes.REVISION_EXPIRED, 400);
  }
  const rejected = await pg.rejectRevision(userId, c.req.param('revisionId'));
  if (!rejected) return jsonError(c, ErrorCodes.REVISION_NOT_FOUND, 404);
  return c.json({ ok: true, data: rejected, requestId: c.get('requestId') });
});

documentsRouter.post('/:id/rollback', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json<{ revisionId: string }>();
  const target = await pg.getRevision(userId, body.revisionId);
  const doc = await pg.getDocument(userId, c.req.param('id'));
  if (!target || !doc) return jsonError(c, ErrorCodes.NOT_FOUND, 404);

  if (target.blockId) {
    const found = pg.findBlock(doc, target.blockId);
    if (found) {
      await pg.saveDocumentContent(
        userId,
        doc.id,
        found.chapter.id,
        target.blockId,
        target.snapshot,
      );
    }
  }

  const rollback = await pg.createRevision(userId, {
    documentId: doc.id,
    blockId: target.blockId,
    parentRevisionId: doc.currentRevisionId,
    snapshot: target.snapshot,
    previousSnapshot: null,
    summary: `恢复到 ${target.summary}`,
    source: 'rollback',
    status: 'accepted',
  });

  return c.json({ ok: true, data: rollback, requestId: c.get('requestId') });
});

documentsRouter.get('/:id/assistant/messages', async (c) => {
  const userId = c.get('userId')!;
  const documentId = c.req.param('id');
  const doc = await pg.getDocument(userId, documentId);
  if (!doc) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  await pg.ensureWritingAssistantWelcome(
    userId,
    documentId,
    assistantWelcomeLine(replyDialectFromRequest(c)),
  );
  return c.json({
    ok: true,
    data: await pg.getWritingAssistantMessages(userId, documentId),
    requestId: c.get('requestId'),
  });
});

documentsRouter.get('/:id/assistant/context-preview', async (c) => {
  const userId = c.get('userId')!;
  const documentId = c.req.param('id');
  const doc = await pg.getDocument(userId, documentId);
  if (!doc) return jsonError(c, ErrorCodes.NOT_FOUND, 404);

  const chapterTitle = c.req.query('chapterTitle') ?? '';
  const chapterContent = c.req.query('chapterContent') ?? '';
  const documentExcerpt = c.req.query('documentExcerpt') ?? '';
  const pending = c.req.query('pending') ?? '';
  const dialect = replyDialectFromRequest(c);
  const contextSelection = parseContextSelectionFromQuery(c);

  const chapterBlock = chapterTitle
    ? `当前待改段：${chapterTitle}\n本段内容：\n${chapterContent || '（本段尚无正文）'}`
    : `本段内容：\n${chapterContent || '（本段尚无正文）'}`;
  const documentBlock = documentExcerpt
    ? `全篇节选（供理解意图；实际改稿仍只改上面这一段）：\n${documentExcerpt}`
    : '';

  const data = await previewWritingIntentContextPreview({
    userId,
    document: doc,
    allMessages: await pg.getWritingAssistantMessages(userId, documentId),
    chapterBlock,
    documentBlock,
    pendingUser: pending,
    dialect,
    contextSelection,
  });

  return c.json({ ok: true, data, requestId: c.get('requestId') });
});

documentsRouter.get('/:id/assistant/context-usage', async (c) => {
  const userId = c.get('userId')!;
  const documentId = c.req.param('id');
  const doc = await pg.getDocument(userId, documentId);
  if (!doc) return jsonError(c, ErrorCodes.NOT_FOUND, 404);

  const chapterTitle = c.req.query('chapterTitle') ?? '';
  const chapterContent = c.req.query('chapterContent') ?? '';
  const documentExcerpt = c.req.query('documentExcerpt') ?? '';
  const pending = c.req.query('pending') ?? '';
  const dialect = replyDialectFromRequest(c);

  const chapterBlock = chapterTitle
    ? `当前待改段：${chapterTitle}\n本段内容：\n${chapterContent || '（本段尚无正文）'}`
    : `本段内容：\n${chapterContent || '（本段尚无正文）'}`;
  const documentBlock = documentExcerpt
    ? `全篇节选（供理解意图；实际改稿仍只改上面这一段）：\n${documentExcerpt}`
    : '';

  const contextSelection = parseContextSelectionFromQuery(c);
  const usage = await previewWritingIntentContextUsage({
    userId,
    document: doc,
    allMessages: await pg.getWritingAssistantMessages(userId, documentId),
    chapterBlock,
    documentBlock,
    pendingUser: pending,
    dialect,
    contextSelection,
  });

  return c.json({ ok: true, data: usage, requestId: c.get('requestId') });
});

documentsRouter.post('/:id/assistant/messages/:messageId/llm-exclude', async (c) => {
  const userId = c.get('userId')!;
  const documentId = c.req.param('id');
  const messageId = c.req.param('messageId');
  try {
    const data = await markWritingMessageLlmExclude(userId, documentId, messageId);
    return c.json({ ok: true, data, requestId: c.get('requestId') });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (msg === 'NOT_FOUND') return jsonError(c, ErrorCodes.NOT_FOUND, 404);
    if (msg === 'INVALID_MESSAGE_KIND') return jsonError(c, ErrorCodes.VALIDATION, 400);
    return jsonError(c, ErrorCodes.VALIDATION, 400);
  }
});

documentsRouter.post('/:id/assistant/messages/:messageId/llm-exclude/cancel', async (c) => {
  const userId = c.get('userId')!;
  const documentId = c.req.param('id');
  const messageId = c.req.param('messageId');
  try {
    const data = await cancelWritingMessageLlmExclude(userId, documentId, messageId);
    return c.json({ ok: true, data, requestId: c.get('requestId') });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (msg === 'NOT_FOUND') return jsonError(c, ErrorCodes.NOT_FOUND, 404);
    if (msg === 'INVALID_MESSAGE_KIND') return jsonError(c, ErrorCodes.VALIDATION, 400);
    return jsonError(c, ErrorCodes.VALIDATION, 400);
  }
});

documentsRouter.post('/:id/assistant/messages', async (c) => {
  const userId = c.get('userId')!;
  const documentId = c.req.param('id');
  const doc = await pg.getDocument(userId, documentId);
  if (!doc) return jsonError(c, ErrorCodes.NOT_FOUND, 404);

  const body = await c.req.json<{
    content: string;
    articleExcerpt?: string;
    chapterId?: string;
    chapterTitle?: string;
    chapterContent?: string;
    documentExcerpt?: string;
    contextSelection?: import('@xzz/shared').ContextSelection;
  }>();
  const content = body.content?.trim();
  if (!content) return jsonError(c, ErrorCodes.VALIDATION, 400);

  let apiKey: string;
  try {
    apiKey = getDeepSeekKey(c);
  } catch (e) {
    return handleAiError(c, e);
  }

  const dialect = replyDialectFromRequest(c);
  const chapterTitle = body.chapterTitle?.trim() ?? '';
  const chapterContent = body.chapterContent?.trim() ?? '';
  const documentExcerpt = body.documentExcerpt?.trim() ?? '';
  const chapterBlock = chapterTitle
    ? `当前待改段：${chapterTitle}\n本段内容：\n${chapterContent || '（本段尚无正文）'}`
    : `本段内容：\n${chapterContent || body.articleExcerpt?.trim() || '（本段尚无正文）'}`;
  const documentBlock = documentExcerpt
    ? `全篇节选（供理解意图；实际改稿仍只改上面这一段）：\n${documentExcerpt}`
    : '';

  let prepared;
  try {
    prepared = await prepareWritingIntentContext({
      userId,
      apiKey,
      documentId,
      document: doc,
      allMessages: await pg.getWritingAssistantMessages(userId, documentId),
      chapterBlock,
      documentBlock,
      userMessage: content,
      dialect,
      contextSelection: parseContextSelectionFromBody(body),
    });
  } catch (e) {
    return handleAiError(c, e);
  }

  let intent;
  try {
    intent = await deepseekWritingIntentFromMessages(apiKey, prepared.messages, {
      log: {
        userId,
        channel: 'writing_intent',
        requestId: c.get('requestId'),
        documentId,
        contextRatio: prepared.usage.ratio,
      },
    });
  } catch (e) {
    return handleAiError(c, e);
  }

  const userMsg = (await pg.addWritingAssistantMessage(userId, {
    documentId,
    role: 'user',
    content,
    kind: 'chat',
  }))!;

  const assistantMsg = (await pg.addWritingAssistantMessage(userId, {
    documentId,
    role: 'assistant',
    content: intent.displayText,
    kind: intent.ready ? 'intent_confirm' : 'chat',
    pendingAction: intent.ready ? intent.action : undefined,
    pendingInstruction: intent.ready ? intent.instruction : undefined,
    confirmStatus: intent.ready ? 'pending' : undefined,
  }))!;

  return c.json({
    ok: true,
    data: { user: userMsg, assistant: assistantMsg, contextUsage: prepared.usage },
    requestId: c.get('requestId'),
  });
});

documentsRouter.post('/:id/assistant/confirm', async (c) => {
  const userId = c.get('userId')!;
  const documentId = c.req.param('id');
  const doc = await pg.getDocument(userId, documentId);
  if (!doc) return jsonError(c, ErrorCodes.NOT_FOUND, 404);

  const body = await c.req.json<{
    messageId: string;
    approved: boolean;
    blockId: string;
    articleExcerpt?: string;
    chapterId?: string;
    chapterTitle?: string;
    chapterContent?: string;
    documentExcerpt?: string;
    understandingScope?: 'chapter' | 'document';
  }>();

  const pending = await pg.getWritingAssistantMessage(userId, documentId, body.messageId);
  if (!pending || pending.kind !== 'intent_confirm' || pending.confirmStatus !== 'pending') {
    return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  }

  const found = pg.findBlock(doc, body.blockId);
  if (!found) return jsonError(c, ErrorCodes.NOT_FOUND, 404);

  const dialect = replyDialectFromRequest(c);

  if (!body.approved) {
    await pg.updateWritingAssistantMessage(userId, documentId, body.messageId, {
      confirmStatus: 'rejected',
    });
    const assistantMsg = (await pg.addWritingAssistantMessage(userId, {
      documentId,
      role: 'assistant',
      content: assistantRejectConfirmLine(dialect),
      kind: 'chat',
    }))!;
    return c.json({ ok: true, data: { assistant: assistantMsg }, requestId: c.get('requestId') });
  }

  let apiKey: string;
  try {
    apiKey = getDeepSeekKey(c);
  } catch (e) {
    return handleAiError(c, e);
  }

  await pg.updateWritingAssistantMessage(userId, documentId, body.messageId, {
    confirmStatus: 'approved',
  });

  await pg.addWritingAssistantMessage(userId, {
    documentId,
    role: 'assistant',
    content: assistantWorkingLine(dialect),
    kind: 'notice',
  });

  const action = pending.pendingAction || '润色';
  const instruction = pending.pendingInstruction || '';
  const oldText = found.block.content;
  const understandingScope =
    body.understandingScope === 'document' ? 'document' : 'chapter';

  const { messages: execMessages, usage: contextUsage } = await prepareWritingExecuteContext({
    userId,
    action,
    oldText,
    instruction,
    styleGuide: doc.styleGuide,
    dialect,
    chapterTitle: body.chapterTitle?.trim() || found.chapter.title,
    understandingScope,
    documentExcerpt: body.documentExcerpt?.trim(),
    documentContextSummary: doc.documentContextSummary,
  });

  let suggested: string;
  let comment: string;
  try {
    const raw = await chatCompletionRaw(apiKey, execMessages, {
      log: {
        userId,
        channel: 'writing_execute',
        requestId: c.get('requestId'),
        documentId,
        contextRatio: contextUsage.ratio,
      },
    });
    const isContinue = action === '续写';
    suggested = isContinue ? oldText + raw : raw;
    comment = writingDoneComment(action, dialect);
  } catch (e) {
    return handleAiError(c, e);
  }

  const revision = await pg.createRevision(userId, {
    documentId,
    blockId: body.blockId,
    parentRevisionId: found.block.currentRevisionId,
    snapshot: suggested,
    previousSnapshot: oldText,
    summary: `润色了${found.chapter.title}的一段`,
    source: 'ai',
    status: 'pending',
  });

  await pg.addWritingAssistantMessage(userId, {
    documentId,
    role: 'assistant',
    content: assistantRevisionReadyLine(dialect),
    kind: 'revision_ready',
    revisionId: revision?.id,
  });

  return c.json({
    ok: true,
    data: {
      revision,
      oldText,
      newText: suggested,
      comment,
      contextUsage,
    },
    requestId: c.get('requestId'),
  });
});
