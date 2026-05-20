import { Hono } from 'hono';
import { ErrorCodes, REPLY_DIALECT_HEADER } from '@xzz/shared';
import type { AppVariables } from '../types.js';
import { jsonError } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { getDeepSeekKey, handleAiError } from '../lib/ai-handler.js';
import { chatPersonaSystem, personaAssistantDisplayName } from '@xzz/shared';
import { deepseekChatFromMessages, parseReplyDialect } from '../lib/deepseek.js';
import * as intel from '../store/pg-intelligence.js';
import * as profilePg from '../store/pg-profile.js';

export const btwRouter = new Hono<{ Variables: AppVariables }>();

btwRouter.use('*', requireAuth);

btwRouter.post('/', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json<{
    question?: string;
    groupId?: string;
    topicId?: string;
  }>();
  const question = body.question?.trim();
  if (!question) return jsonError(c, ErrorCodes.VALIDATION, 400);

  let apiKey: string;
  try {
    apiKey = getDeepSeekKey(c);
  } catch (e) {
    return handleAiError(c, e);
  }

  const persona = await profilePg.getPersonaSettings(userId);
  const assistantName = personaAssistantDisplayName(persona);
  const dialect = parseReplyDialect(c.req.header(REPLY_DIALECT_HEADER));

  const answer = await deepseekChatFromMessages(
    apiKey,
    [
      {
        role: 'system',
        content: `${chatPersonaSystem(persona, dialect)}

你是「${assistantName}」旁路助手。本回答 **不会** 写入主话题上下文，仅供发起人私下查看。`,
      },
      { role: 'user', content: question },
    ],
    {
      log: {
        userId,
        channel: 'btw',
        requestId: c.get('requestId'),
        groupId: body.groupId ?? undefined,
        topicId: body.topicId ?? undefined,
      },
    },
  );

  const exchange = await intel.createBtwExchange({
    userId,
    groupId: body.groupId ?? null,
    topicId: body.topicId ?? null,
    question,
    answer,
  });

  return c.json({ ok: true, data: exchange, requestId: c.get('requestId') });
});
