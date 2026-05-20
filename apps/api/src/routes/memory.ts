import { Hono } from 'hono';
import type { MemoryCategory, MemoryScope, MemoryFragmentStatus } from '@xzz/shared';
import { ErrorCodes } from '@xzz/shared';
import type { AppVariables } from '../types.js';
import { jsonError } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { getDeepSeekKey } from '../lib/ai-handler.js';
import * as intel from '../store/pg-intelligence.js';
import {
  applyMemoryIntent,
  confirmPendingMemory,
} from '../lib/memoryApply.js';
import { assertMemoryScopeAccess } from '../lib/memoryScopeAuth.js';
import { memoryTitleFromContent } from '../lib/memoryText.js';
import { searchSessionMessages } from '../lib/memorySessionSearch.js';
import { runSessionAutoExtract, runTopicAutoExtract } from '../lib/memoryAutoExtract.js';

export const memoryRouter = new Hono<{ Variables: AppVariables }>();

memoryRouter.use('*', requireAuth);

memoryRouter.get('/settings', async (c) => {
  const userId = c.get('userId')!;
  const data = await intel.getUserMemorySettings(userId);
  return c.json({ ok: true, data, requestId: c.get('requestId') });
});

memoryRouter.patch('/settings', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json<{ autoExtractEnabled?: boolean }>();
  const current = await intel.getUserMemorySettings(userId);
  const data = await intel.setUserMemorySettings(userId, {
    autoExtractEnabled: body.autoExtractEnabled ?? current.autoExtractEnabled,
  });
  return c.json({ ok: true, data, requestId: c.get('requestId') });
});

memoryRouter.get('/review', async (c) => {
  const userId = c.get('userId')!;
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 50)));
  const data = await intel.listMemoryReviewQueue(userId, limit);
  return c.json({ ok: true, data, requestId: c.get('requestId') });
});

/** @deprecated 使用 GET /review */
memoryRouter.get('/pending', async (c) => {
  const userId = c.get('userId')!;
  const data = await intel.listMemoryReviewQueue(userId, 50);
  return c.json({ ok: true, data, requestId: c.get('requestId') });
});

memoryRouter.post('/review/:id/dismiss', async (c) => {
  const userId = c.get('userId')!;
  const fragment = await intel.dismissMemoryReview(userId, c.req.param('id'));
  if (!fragment) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  return c.json({ ok: true, data: { fragment }, requestId: c.get('requestId') });
});

memoryRouter.post('/pending/:id/confirm', async (c) => {
  const userId = c.get('userId')!;
  let apiKey: string | undefined;
  try {
    apiKey = getDeepSeekKey(c);
  } catch {
    apiKey = undefined;
  }
  try {
    const result = await confirmPendingMemory(userId, c.req.param('id'), apiKey);
    return c.json({ ok: true, data: result, requestId: c.get('requestId') });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (msg === 'MEMORY_NOT_FOUND') return jsonError(c, ErrorCodes.NOT_FOUND, 404);
    throw e;
  }
});

memoryRouter.post('/pending/:id/reject', async (c) => {
  const userId = c.get('userId')!;
  const fragment = await intel.setMemoryFragmentStatus(
    userId,
    c.req.param('id'),
    'deleted',
  );
  if (!fragment) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  return c.json({ ok: true, data: { fragment }, requestId: c.get('requestId') });
});

memoryRouter.get('/search-sessions', async (c) => {
  const userId = c.get('userId')!;
  const q = c.req.query('q')?.trim() ?? '';
  if (q.length < 2) return jsonError(c, ErrorCodes.VALIDATION, 400);
  const data = await searchSessionMessages({
    userId,
    query: q,
    sessionId: c.req.query('sessionId'),
    groupId: c.req.query('groupId'),
    topicId: c.req.query('topicId'),
    limit: Number(c.req.query('limit') ?? 15),
  });
  return c.json({ ok: true, data, requestId: c.get('requestId') });
});

memoryRouter.post('/topics/auto-extract', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json<{ groupId?: string; topicId?: string }>();
  const groupId = body.groupId?.trim();
  const topicId = body.topicId?.trim();
  if (!groupId || !topicId) return jsonError(c, ErrorCodes.VALIDATION, 400);
  let apiKey: string;
  try {
    apiKey = getDeepSeekKey(c);
  } catch {
    return jsonError(c, ErrorCodes.VALIDATION, 400);
  }
  const data = await runTopicAutoExtract({
    apiKey,
    userId,
    groupId,
    topicId,
    log: { userId, channel: 'memory_extract', groupId, topicId },
  });
  return c.json({ ok: true, data, requestId: c.get('requestId') });
});

memoryRouter.post('/sessions/:sessionId/auto-extract', async (c) => {
  const userId = c.get('userId')!;
  const sessionId = c.req.param('sessionId');
  let apiKey: string;
  try {
    apiKey = getDeepSeekKey(c);
  } catch {
    return jsonError(c, ErrorCodes.VALIDATION, 400);
  }
  const data = await runSessionAutoExtract({
    apiKey,
    userId,
    sessionId,
    log: { userId, channel: 'memory_extract', sessionId },
  });
  return c.json({ ok: true, data, requestId: c.get('requestId') });
});

memoryRouter.get('/', async (c) => {
  const userId = c.get('userId')!;
  const scope = (c.req.query('scope') ?? 'user') as MemoryScope;
  const groupId = c.req.query('groupId');
  const topicId = c.req.query('topicId');
  const sessionId = c.req.query('sessionId');
  const category = c.req.query('category') as MemoryCategory | undefined;
  const data = await intel.listMemoryFragments(userId, scope, {
    groupId: groupId || undefined,
    topicId: topicId || undefined,
    sessionId: sessionId || undefined,
    category:
      category === 'user_profile' || category === 'project_note' || category === 'general'
        ? category
        : undefined,
    withContent: true,
    includeSuppressed: c.req.query('includeSuppressed') === '1',
  });
  return c.json({ ok: true, data, requestId: c.get('requestId') });
});

memoryRouter.post('/', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json<{
    scope?: MemoryScope;
    groupId?: string;
    topicId?: string;
    sessionId?: string;
    title?: string;
    content?: string;
    category?: MemoryCategory;
    sourceMessageId?: string;
  }>();
  const content = body.content?.trim();
  if (!content) return jsonError(c, ErrorCodes.VALIDATION, 400);
  const scope = body.scope ?? 'user';
  try {
    await assertMemoryScopeAccess(userId, scope, {
      groupId: body.groupId ?? null,
      topicId: body.topicId ?? null,
      sessionId: body.sessionId ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (msg === 'MEMORY_SCOPE_FORBIDDEN' || msg === 'MEMORY_SCOPE_INVALID') {
      return jsonError(c, ErrorCodes.VALIDATION, 400);
    }
    throw e;
  }
  const result = await intel.createMemoryFragment({
    userId,
    scope,
    groupId: body.groupId ?? null,
    topicId: body.topicId ?? null,
    sessionId: body.sessionId ?? null,
    title: body.title?.trim() || memoryTitleFromContent(content),
    content,
    category: body.category ?? 'general',
    source: 'user',
    sourceMessageId: body.sourceMessageId,
  });
  return c.json({ ok: true, data: result, requestId: c.get('requestId') }, 201);
});

memoryRouter.post('/apply', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json<{
    kind?: 'memory_remember' | 'memory_correct' | 'memory_forget';
    slots?: import('@xzz/shared').MemoryIntentSlots;
    sessionId?: string;
    groupId?: string;
    topicId?: string;
  }>();
  if (!body.kind) return jsonError(c, ErrorCodes.VALIDATION, 400);
  let apiKey: string | undefined;
  try {
    apiKey = getDeepSeekKey(c);
  } catch {
    apiKey = undefined;
  }
  try {
    const result = await applyMemoryIntent(body.kind, body.slots ?? {}, {
      userId,
      sessionId: body.sessionId,
      groupId: body.groupId,
      topicId: body.topicId,
      apiKey,
    });
    return c.json({ ok: true, data: result, requestId: c.get('requestId') });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (msg === 'MEMORY_TARGET_REQUIRED' || msg === 'MEMORY_CONTENT_REQUIRED') {
      return jsonError(c, ErrorCodes.VALIDATION, 400);
    }
    if (msg === 'MEMORY_NOT_FOUND') return jsonError(c, ErrorCodes.NOT_FOUND, 404);
    if (msg === 'MEMORY_SCOPE_FORBIDDEN' || msg === 'MEMORY_SCOPE_INVALID') {
      return jsonError(c, ErrorCodes.VALIDATION, 400);
    }
    throw e;
  }
});

memoryRouter.patch('/:id', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json<{
    content?: string;
    status?: MemoryFragmentStatus;
  }>();
  const id = c.req.param('id');

  if (body.content?.trim()) {
    const result = await intel.appendMemoryVersion({
      userId,
      fragmentId: id,
      content: body.content.trim(),
      source: 'user',
    });
    return c.json({ ok: true, data: result, requestId: c.get('requestId') });
  }

  if (body.status) {
    const fragment = await intel.setMemoryFragmentStatus(userId, id, body.status);
    if (!fragment) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
    return c.json({ ok: true, data: { fragment }, requestId: c.get('requestId') });
  }

  return jsonError(c, ErrorCodes.VALIDATION, 400);
});

memoryRouter.delete('/:id', async (c) => {
  const userId = c.get('userId')!;
  const fragment = await intel.setMemoryFragmentStatus(
    userId,
    c.req.param('id'),
    'deleted',
  );
  if (!fragment) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  return c.json({ ok: true, data: { fragment }, requestId: c.get('requestId') });
});

memoryRouter.get('/:id/versions', async (c) => {
  const userId = c.get('userId')!;
  const versions = await intel.listMemoryVersions(userId, c.req.param('id'));
  return c.json({ ok: true, data: versions, requestId: c.get('requestId') });
});
