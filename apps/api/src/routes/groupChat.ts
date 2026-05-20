import { Hono } from 'hono';
import { ErrorCodes, REPLY_DIALECT_HEADER } from '@xzz/shared';
import type { AppVariables } from '../types.js';
import { jsonError } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { getZenMuxKey, handleZenMuxError } from '../lib/zenmux-handler.js';
import { resolveZenmuxChatModel, CHAT_LLM_MODEL_HEADER } from '@xzz/shared';
import { parseReplyDialect } from '../lib/deepseek.js';
import {
  cancelGroupMessageLlmExclude,
  markGroupMessageLlmExclude,
} from '../lib/llmExclude.js';
import { invokeGroupLlm, previewGroupContext } from '../lib/groupLlm.js';
import {
  parseContextSelectionFromBody,
  parseContextSelectionFromQuery,
} from '../lib/contextSelectionParse.js';
import * as social from '../store/pg-social.js';
import * as intel from '../store/pg-intelligence.js';

export const groupChatRouter = new Hono<{ Variables: AppVariables }>();

groupChatRouter.use('*', requireAuth);

groupChatRouter.get('/:groupId/topics', async (c) => {
  const userId = c.get('userId')!;
  const topics = await social.listTopics(userId, c.req.param('groupId'));
  if (!topics) return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);
  return c.json({ ok: true, data: topics, requestId: c.get('requestId') });
});

groupChatRouter.post('/:groupId/topics', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json<{ title?: string }>();
  const topic = await social.createTopic(
    userId,
    c.req.param('groupId'),
    body.title,
  );
  if (!topic) return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);
  return c.json({ ok: true, data: topic, requestId: c.get('requestId') }, 201);
});

groupChatRouter.patch('/:groupId/topics/:topicId', async (c) => {
  const userId = c.get('userId')!;
  const groupId = c.req.param('groupId');
  const topicId = c.req.param('topicId');
  const body = await c.req.json<{ title?: string }>();
  const title = body.title?.trim();
  if (!title) return jsonError(c, ErrorCodes.VALIDATION, 400);
  const topic = await social.updateTopicTitle(userId, groupId, topicId, title);
  if (!topic) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  return c.json({ ok: true, data: topic, requestId: c.get('requestId') });
});

groupChatRouter.get('/:groupId/topics/:topicId/messages', async (c) => {
  const userId = c.get('userId')!;
  const groupId = c.req.param('groupId');
  const topicId = c.req.param('topicId');
  const after = c.req.query('after');
  const since = c.req.query('since');
  const messages = await social.listGroupMessages(userId, groupId, topicId, {
    after: after || undefined,
    since: since || undefined,
  });
  if (!messages) return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);
  return c.json({ ok: true, data: messages, requestId: c.get('requestId') });
});

groupChatRouter.post('/:groupId/topics/:topicId/messages', async (c) => {
  const userId = c.get('userId')!;
  const groupId = c.req.param('groupId');
  const topicId = c.req.param('topicId');
  const body = await c.req.json<{
    content?: string;
    attachmentIds?: string[];
  }>();
  const content = body.content?.trim() ?? '';
  const attachments = [];
  for (const id of body.attachmentIds ?? []) {
    const a = await social.getMediaAttachment(userId, id);
    if (a) attachments.push(a);
  }
  if (!content && attachments.length === 0) {
    return jsonError(c, ErrorCodes.VALIDATION, 400);
  }
  const msg = await social.addGroupMessage(userId, groupId, topicId, {
    content,
    attachments,
  });
  if (!msg) return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);
  return c.json({ ok: true, data: msg, requestId: c.get('requestId') }, 201);
});

groupChatRouter.get('/:groupId/topics/:topicId/export', async (c) => {
  const userId = c.get('userId')!;
  const groupId = c.req.param('groupId');
  const topicId = c.req.param('topicId');
  const topic = await social.getTopic(userId, groupId, topicId);
  if (!topic) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  const messages =
    (await social.listGroupMessages(userId, groupId, topicId, { limit: 500 })) ?? [];
  const markdown = social.formatTopicExportMarkdown(topic, messages);
  return c.json({
    ok: true,
    data: { markdown, messageCount: messages.length },
    requestId: c.get('requestId'),
  });
});

groupChatRouter.post('/:groupId/topics/:topicId/llm/invoke', async (c) => {
  const userId = c.get('userId')!;
  const groupId = c.req.param('groupId');
  const topicId = c.req.param('topicId');
  const body = await c.req.json<{
    instruction?: string;
    selectedMessageIds?: string[];
    contextSelection?: import('@xzz/shared').ContextSelection;
    model?: string;
  }>();
  const instruction = body.instruction?.trim();
  if (!instruction) return jsonError(c, ErrorCodes.VALIDATION, 400);

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
  try {
    const result = await invokeGroupLlm({
      userId,
      groupId,
      topicId,
      apiKey,
      model,
      instruction,
      selectedMessageIds: body.selectedMessageIds,
      contextSelection: parseContextSelectionFromBody(body),
      dialect,
    });
    return c.json({ ok: true, data: result, requestId: c.get('requestId') });
  } catch (e) {
    return handleZenMuxError(c, e);
  }
});

groupChatRouter.get('/:groupId/topics/:topicId/context-preview', async (c) => {
  const userId = c.get('userId')!;
  const groupId = c.req.param('groupId');
  const topicId = c.req.param('topicId');
  const pending = c.req.query('pending') ?? '…';
  const dialect = parseReplyDialect(c.req.header(REPLY_DIALECT_HEADER));
  const selection = parseContextSelectionFromQuery(c);
  try {
    const data = await previewGroupContext({
      userId,
      groupId,
      topicId,
      instruction: pending,
      contextSelection: selection,
      dialect,
    });
    return c.json({ ok: true, data, requestId: c.get('requestId') });
  } catch {
    return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  }
});

groupChatRouter.get('/:groupId/topics/:topicId/context-usage', async (c) => {
  const userId = c.get('userId')!;
  const groupId = c.req.param('groupId');
  const topicId = c.req.param('topicId');
  const pending = c.req.query('pending') ?? '…';
  const dialect = parseReplyDialect(c.req.header(REPLY_DIALECT_HEADER));
  const selection = parseContextSelectionFromQuery(c);
  try {
    const preview = await previewGroupContext({
      userId,
      groupId,
      topicId,
      instruction: pending,
      contextSelection: selection,
      dialect,
    });
    return c.json({
      ok: true,
      data: preview.usage,
      requestId: c.get('requestId'),
    });
  } catch {
    return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  }
});

groupChatRouter.post(
  '/:groupId/topics/:topicId/messages/:messageId/llm-exclude',
  async (c) => {
    const userId = c.get('userId')!;
    const groupId = c.req.param('groupId');
    const topicId = c.req.param('topicId');
    const messageId = c.req.param('messageId');
    try {
      const data = await markGroupMessageLlmExclude(userId, groupId, topicId, messageId);
      return c.json({ ok: true, data, requestId: c.get('requestId') });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg === 'NOT_FOUND') return jsonError(c, ErrorCodes.NOT_FOUND, 404);
      if (msg === 'INVALID_MESSAGE_KIND') return jsonError(c, ErrorCodes.VALIDATION, 400);
      throw e;
    }
  },
);

groupChatRouter.post(
  '/:groupId/topics/:topicId/messages/:messageId/llm-exclude/cancel',
  async (c) => {
    const userId = c.get('userId')!;
    const groupId = c.req.param('groupId');
    const topicId = c.req.param('topicId');
    const messageId = c.req.param('messageId');
    try {
      const data = await cancelGroupMessageLlmExclude(userId, groupId, topicId, messageId);
      return c.json({ ok: true, data, requestId: c.get('requestId') });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg === 'NOT_FOUND') return jsonError(c, ErrorCodes.NOT_FOUND, 404);
      if (msg === 'INVALID_MESSAGE_KIND') return jsonError(c, ErrorCodes.VALIDATION, 400);
      throw e;
    }
  },
);

groupChatRouter.get('/llm/jobs/:jobId', async (c) => {
  const userId = c.get('userId')!;
  const job = await intel.getLlmJob(userId, c.req.param('jobId'));
  if (!job) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  return c.json({ ok: true, data: job, requestId: c.get('requestId') });
});
