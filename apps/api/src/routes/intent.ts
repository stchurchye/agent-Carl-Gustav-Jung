import { Hono } from 'hono';
import {
  CHAT_LLM_MODEL_HEADER,
  ErrorCodes,
  REPLY_DIALECT_HEADER,
  resolveZenmuxChatModel,
} from '@xzz/shared';
import type { IntentKind, MemoryIntentSlots } from '@xzz/shared';
import type { AppVariables } from '../types.js';
import { jsonError } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { getDeepSeekKey } from '../lib/ai-handler.js';
import { getZenMuxKey, handleZenMuxError } from '../lib/zenmux-handler.js';
import { parseReplyDialect } from '../lib/deepseek.js';
import {
  analyzeIntentUnified,
  type IntentChannel,
} from '../lib/intentAnalyzer.js';
import { executeIntent } from '../lib/intentExecute.js';
import {
  parseContextSelectionFromBody,
} from '../lib/contextSelectionParse.js';

export const intentRouter = new Hono<{ Variables: AppVariables }>();

intentRouter.use('*', requireAuth);

intentRouter.post('/analyze', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json<{
    text?: string;
    channel?: IntentChannel;
    aiMode?: boolean;
    hasAttachments?: boolean;
    sessionId?: string;
    groupId?: string;
    topicId?: string;
  }>();

  const text = body.text?.trim() ?? '';
  if (!text) return jsonError(c, ErrorCodes.VALIDATION, 400);

  let deepseekApiKey: string | undefined;
  try {
    deepseekApiKey = getDeepSeekKey(c);
  } catch {
    deepseekApiKey = undefined;
  }

  const result = await analyzeIntentUnified({
    text,
    channel: body.channel ?? 'private',
    aiMode: body.aiMode !== false,
    hasAttachments: body.hasAttachments,
    apiKey: deepseekApiKey,
    userId,
    sessionId: body.sessionId,
    groupId: body.groupId,
    topicId: body.topicId,
  });

  return c.json({ ok: true, data: result, requestId: c.get('requestId') });
});

intentRouter.post('/execute', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json<{
    text?: string;
    kind?: IntentKind;
    slots?: MemoryIntentSlots;
    targetFragmentId?: string;
    channel?: IntentChannel;
    sessionId?: string;
    groupId?: string;
    topicId?: string;
    model?: string;
    selectedMessageIds?: string[];
    contextSelection?: import('@xzz/shared').ContextSelection;
  }>();

  const text = body.text?.trim() ?? '';
  const kind = body.kind;
  if (!text || !kind) return jsonError(c, ErrorCodes.VALIDATION, 400);

  let apiKey: string;
  try {
    apiKey = getZenMuxKey(c);
  } catch (e) {
    return handleZenMuxError(c, e);
  }

  let deepseekApiKey: string | undefined;
  try {
    deepseekApiKey = getDeepSeekKey(c);
  } catch {
    deepseekApiKey = undefined;
  }

  const dialect = parseReplyDialect(c.req.header(REPLY_DIALECT_HEADER));
  const model = resolveZenmuxChatModel(
    body.model ?? c.req.header(CHAT_LLM_MODEL_HEADER),
  );

  try {
    const data = await executeIntent({
      userId,
      text,
      kind,
      slots: body.slots,
      targetFragmentId: body.targetFragmentId,
      channel: body.channel ?? 'private',
      sessionId: body.sessionId,
      groupId: body.groupId,
      topicId: body.topicId,
      apiKey,
      deepseekApiKey,
      model,
      dialect,
      contextSelection: parseContextSelectionFromBody(body),
      selectedMessageIds: body.selectedMessageIds,
    });
    return c.json({ ok: true, data, requestId: c.get('requestId') });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (msg === 'MEMORY_TARGET_REQUIRED' || msg === 'MEMORY_CONTENT_REQUIRED') {
      return jsonError(c, ErrorCodes.VALIDATION, 400);
    }
    if (msg === 'MEMORY_NOT_FOUND') {
      return jsonError(c, ErrorCodes.NOT_FOUND, 404);
    }
    return handleZenMuxError(c, e);
  }
});
