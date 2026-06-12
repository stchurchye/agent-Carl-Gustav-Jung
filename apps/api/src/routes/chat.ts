import { Hono } from 'hono';
import type { AppVariables } from '../types.js';
import { jsonError } from '../lib/errors.js';
import { log } from '../lib/logger.js';
import { summarizeChatSessionTitle, parseReplyDialect } from '../lib/deepseek.js';
import { getZenMuxKey, handleZenMuxError } from '../lib/zenmux-handler.js';
import { zenmuxChatFromMessages } from '../lib/zenmux.js';
import { resolveZenmuxChatModel, CHAT_LLM_MODEL_HEADER } from '@xzz/shared';
import {
  prepareChatContext,
  previewChatContextPreview,
  previewChatContextUsage,
} from '../lib/contextPipeline.js';
import {
  parseContextSelectionFromBody,
  parseContextSelectionFromQuery,
} from '../lib/contextSelectionParse.js';
import {
  cancelChatMessageLlmExclude,
  markChatMessageLlmExclude,
} from '../lib/llmExclude.js';
import * as pg from '../store/pg.js';
import { formatChatSessionExportMarkdown } from '../store/pg-social.js';
import { requireAuth } from '../middleware/auth.js';
import { ErrorCodes, REPLY_DIALECT_HEADER } from '@xzz/shared';

export const chatRouter = new Hono<{ Variables: AppVariables }>();

chatRouter.use('*', requireAuth);

chatRouter.get('/sessions', async (c) => {
  const userId = c.get('userId')!;
  const data = await pg.listChatSessions(userId);
  return c.json({ ok: true, data, requestId: c.get('requestId') });
});

chatRouter.post('/sessions', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json<{ title?: string }>();
  const session = await pg.createChatSession(
    userId,
    body.title?.trim() || '和 Bow Wow 聊聊',
  );
  return c.json({ ok: true, data: session, requestId: c.get('requestId') }, 201);
});

chatRouter.patch('/sessions/:id', async (c) => {
  const userId = c.get('userId')!;
  const sessionId = c.req.param('id');
  const body = await c.req.json<{ title?: string }>();
  const title = body.title?.trim();
  if (!title) return jsonError(c, ErrorCodes.VALIDATION, 400);
  const session = await pg.updateChatSessionTitle(userId, sessionId, title);
  if (!session) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  return c.json({ ok: true, data: session, requestId: c.get('requestId') });
});

chatRouter.get('/sessions/:id/messages', async (c) => {
  const userId = c.get('userId')!;
  const sessionId = c.req.param('id');
  const messages = await pg.getChatMessages(userId, sessionId);
  if (messages.length === 0 && !(await pg.getChatSession(userId, sessionId))) {
    return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  }
  return c.json({ ok: true, data: messages, requestId: c.get('requestId') });
});

chatRouter.get('/sessions/:id/export', async (c) => {
  const userId = c.get('userId')!;
  const sessionId = c.req.param('id');
  const session = await pg.getChatSession(userId, sessionId);
  if (!session) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  const messages = await pg.getChatMessages(userId, sessionId);
  const markdown = formatChatSessionExportMarkdown(session, messages);
  return c.json({
    ok: true,
    data: { markdown, messageCount: messages.length },
    requestId: c.get('requestId'),
  });
});

chatRouter.get('/sessions/:id/context-preview', async (c) => {
  const userId = c.get('userId')!;
  const sessionId = c.req.param('id');
  if (!(await pg.getChatSession(userId, sessionId))) {
    return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  }
  const pending = c.req.query('pending') ?? '';
  const dialect = parseReplyDialect(c.req.header(REPLY_DIALECT_HEADER));
  const contextSelection = parseContextSelectionFromQuery(c);
  try {
    const data = await previewChatContextPreview({
      userId,
      sessionId,
      pendingUser: pending,
      dialect,
      contextSelection,
    });
    return c.json({ ok: true, data, requestId: c.get('requestId') });
  } catch {
    return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  }
});

chatRouter.get('/sessions/:id/context-usage', async (c) => {
  const userId = c.get('userId')!;
  const sessionId = c.req.param('id');
  if (!(await pg.getChatSession(userId, sessionId))) {
    return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  }
  const pending = c.req.query('pending') ?? '';
  const dialect = parseReplyDialect(c.req.header(REPLY_DIALECT_HEADER));
  const contextSelection = parseContextSelectionFromQuery(c);
  try {
    const usage = await previewChatContextUsage({
      userId,
      sessionId,
      pendingUser: pending,
      dialect,
      contextSelection,
    });
    return c.json({ ok: true, data: usage, requestId: c.get('requestId') });
  } catch {
    return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  }
});

chatRouter.post('/sessions/:id/messages/:messageId/llm-exclude', async (c) => {
  const userId = c.get('userId')!;
  const sessionId = c.req.param('id');
  const messageId = c.req.param('messageId');
  if (!(await pg.getChatSession(userId, sessionId))) {
    return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  }
  try {
    const data = await markChatMessageLlmExclude(userId, sessionId, messageId);
    return c.json({ ok: true, data, requestId: c.get('requestId') });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (msg === 'NOT_FOUND') return jsonError(c, ErrorCodes.NOT_FOUND, 404);
    throw e;
  }
});

chatRouter.post('/sessions/:id/messages/:messageId/llm-exclude/cancel', async (c) => {
  const userId = c.get('userId')!;
  const sessionId = c.req.param('id');
  const messageId = c.req.param('messageId');
  if (!(await pg.getChatSession(userId, sessionId))) {
    return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  }
  try {
    const data = await cancelChatMessageLlmExclude(userId, sessionId, messageId);
    return c.json({ ok: true, data, requestId: c.get('requestId') });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (msg === 'NOT_FOUND') return jsonError(c, ErrorCodes.NOT_FOUND, 404);
    throw e;
  }
});

chatRouter.post('/sessions/:id/messages', async (c) => {
  const userId = c.get('userId')!;
  const sessionId = c.req.param('id');
  const body = await c.req.json<{
    content: string;
    model?: string;
    askAi?: boolean;
    contextSelection?: import('@xzz/shared').ContextSelection;
  }>();
  const content = body.content?.trim();
  if (!content) return jsonError(c, ErrorCodes.VALIDATION, 400);

  if (!(await pg.getChatSession(userId, sessionId))) {
    return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  }

  let apiKey: string;
  try {
    apiKey = getZenMuxKey(c);
  } catch (e) {
    return handleZenMuxError(c, e);
  }

  const model = resolveZenmuxChatModel(
    body.model ?? c.req.header(CHAT_LLM_MODEL_HEADER),
  );
  const dialect = parseReplyDialect(c.req.header(REPLY_DIALECT_HEADER));
  let prepared;
  try {
    prepared = await prepareChatContext({
      userId,
      apiKey,
      sessionId,
      pendingUser: content,
      dialect,
      contextSelection: parseContextSelectionFromBody(body),
    });
  } catch (e) {
    return handleZenMuxError(c, e);
  }

  let reply: string;
  let llmUsage: { totalTokens: number; promptTokens: number; completionTokens: number };
  let responseTimeMs = 0;
  try {
    const llmStarted = Date.now();
    const llm = await zenmuxChatFromMessages(apiKey, model, prepared.messages, {
      log: {
        userId,
        channel: 'workbench_chat',
        requestId: c.get('requestId'),
        sessionId,
        contextRatio: prepared.usage.ratio,
      },
    });
    responseTimeMs = Date.now() - llmStarted;
    reply = llm.content;
    llmUsage = llm.usage;
  } catch (e) {
    return handleZenMuxError(c, e);
  }

  const llmInvoke =
    body.askAi === true
      ? {
          model,
          totalTokens: llmUsage.totalTokens,
          promptTokens: llmUsage.promptTokens,
          completionTokens: llmUsage.completionTokens,
        }
      : undefined;

  log('info', 'chat.reply', {
    sessionId,
    model,
    dialect,
    contextRatio: prepared.usage.ratio,
    requestId: c.get('requestId'),
  });

  const userMsg = (await pg.addChatMessage(userId, sessionId, 'user', content, {
    llmInvoke,
  }))!;
  const assistantMsg = (await pg.addChatMessage(userId, sessionId, 'assistant', reply, {
    llmReply: {
      model,
      totalTokens: llmUsage.totalTokens,
      promptTokens: llmUsage.promptTokens,
      completionTokens: llmUsage.completionTokens,
      responseTimeMs,
    },
  }))!;

  let sessionTitle = prepared.session;
  try {
    const title = await summarizeChatSessionTitle({
      apiKey,
      messages: (await pg.getChatMessages(userId, sessionId)).map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      lastUserMessage: content,
      dialect,
    });
    sessionTitle =
      (await pg.updateChatSessionTitle(userId, sessionId, title)) ?? sessionTitle;
    log('info', 'chat.session.title', { sessionId, title, requestId: c.get('requestId') });
  } catch (e) {
    log('warn', 'chat.session.title.fail', {
      sessionId,
      error: String(e),
      requestId: c.get('requestId'),
    });
    const fallback = content.replace(/\s+/g, ' ').slice(0, 28);
    if (fallback) {
      sessionTitle =
        (await pg.updateChatSessionTitle(userId, sessionId, fallback)) ?? sessionTitle;
    }
  }

  return c.json({
    ok: true,
    data: {
      user: userMsg,
      assistant: assistantMsg,
      session: sessionTitle,
      contextUsage: prepared.usage,
    },
    requestId: c.get('requestId'),
  });
});
