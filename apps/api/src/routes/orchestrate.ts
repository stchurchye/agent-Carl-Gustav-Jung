import { Hono } from 'hono';
import { ErrorCodes } from '@xzz/shared';
import type { AppVariables } from '../types.js';
import { jsonError } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { taskProfileForIntent } from '../lib/orchestrator.js';
import { DEFAULT_TASK_PROFILES } from '@xzz/shared';
import { getDeepSeekKey, handleAiError } from '../lib/ai-handler.js';
import { deepseekChatFromMessages } from '../lib/deepseek.js';
import * as intel from '../store/pg-intelligence.js';
import { ingestMagiContent, queryMagiSystem } from '../lib/integrations/magi.js';

export const orchestrateRouter = new Hono<{ Variables: AppVariables }>();

orchestrateRouter.use('*', requireAuth);

orchestrateRouter.post('/analyze', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json<{
    text?: string;
    scope?: 'private' | 'group';
    hasAttachments?: boolean;
    sessionId?: string;
    groupId?: string;
    topicId?: string;
  }>();
  let apiKey: string | undefined;
  try {
    apiKey = getDeepSeekKey(c);
  } catch {
    apiKey = undefined;
  }
  const { analyzeIntentUnified } = await import('../lib/intentAnalyzer.js');
  const result = await analyzeIntentUnified({
    text: body.text ?? '',
    channel: body.scope === 'group' ? 'group' : 'private',
    aiMode: true,
    hasAttachments: Boolean(body.hasAttachments),
    apiKey,
    userId,
    sessionId: body.sessionId,
    groupId: body.groupId,
    topicId: body.topicId,
  });
  return c.json({ ok: true, data: result, requestId: c.get('requestId') });
});

orchestrateRouter.get('/profiles', (c) => {
  return c.json({
    ok: true,
    data: DEFAULT_TASK_PROFILES,
    requestId: c.get('requestId'),
  });
});

orchestrateRouter.post('/execute', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json<{
    kind?: string;
    text?: string;
    hasAttachments?: boolean;
    scope?: 'private' | 'group';
    groupId?: string;
    topicId?: string;
    sessionId?: string;
  }>();
  const kind = body.kind ?? 'chat_private_llm';
  const profile = taskProfileForIntent(kind as never, Boolean(body.hasAttachments));

  if (kind === 'magi_system_query') {
    const answer = await queryMagiSystem(body.text ?? '');
    return c.json({ ok: true, data: { answer, profile }, requestId: c.get('requestId') });
  }

  if (kind === 'magi_content_link') {
    const url = (body.text ?? '').match(/https?:\/\/\S+/)?.[0];
    if (!url) return jsonError(c, ErrorCodes.VALIDATION, 400);
    const card = await ingestMagiContent(url);
    return c.json({ ok: true, data: { card, profile }, requestId: c.get('requestId') });
  }

  if (kind === 'memory_remember') {
    const scope =
      body.scope === 'group' ? 'topic' : body.scope === 'private' ? 'session' : 'user';
    const { fragment } = await intel.createMemoryFragment({
      userId,
      scope: scope as import('@xzz/shared').MemoryScope,
      groupId: body.groupId ?? null,
      topicId: body.topicId ?? null,
      sessionId: body.sessionId ?? null,
      title: '用户记忆',
      content: body.text ?? '',
      source: 'user',
    });
    return c.json({ ok: true, data: { fragment, profile }, requestId: c.get('requestId') });
  }

  if (profile.provider === 'none') {
    return c.json({
      ok: true,
      data: { skipped: true, profile },
      requestId: c.get('requestId'),
    });
  }

  let apiKey: string;
  try {
    apiKey = getDeepSeekKey(c);
  } catch (e) {
    return handleAiError(c, e);
  }

  const reply = await deepseekChatFromMessages(
    apiKey,
    [{ role: 'user', content: body.text ?? '' }],
    {
      log: {
        userId,
        channel: 'orchestrate',
        requestId: c.get('requestId'),
      },
    },
  );
  return c.json({ ok: true, data: { reply, profile }, requestId: c.get('requestId') });
});
