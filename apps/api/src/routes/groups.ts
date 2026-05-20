import { Hono } from 'hono';
import { ErrorCodes } from '@xzz/shared';
import type { AppVariables } from '../types.js';
import { jsonError } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import * as pg from '../store/pg.js';
import * as social from '../store/pg-social.js';

export const groupsRouter = new Hono<{ Variables: AppVariables }>();

groupsRouter.use('*', requireAuth);

groupsRouter.get('/', async (c) => {
  const groups = await social.listGroupsWithPreview(c.get('userId')!);
  return c.json({ ok: true, data: groups, requestId: c.get('requestId') });
});

groupsRouter.post('/', async (c) => {
  const body = await c.req.json<{ name?: string }>();
  const name = body.name?.trim();
  if (!name) return jsonError(c, ErrorCodes.VALIDATION, 400);
  const userId = c.get('userId')!;
  const group = await pg.createGroup(userId, name);
  await social.createTopic(userId, group.id, '默认话题');
  return c.json({ ok: true, data: group, requestId: c.get('requestId') }, 201);
});

groupsRouter.post('/join', async (c) => {
  const body = await c.req.json<{ inviteCode?: string }>();
  const code = body.inviteCode?.trim().toUpperCase();
  if (!code) return jsonError(c, ErrorCodes.VALIDATION, 400);
  const group = await pg.joinGroupByInvite(c.get('userId')!, code);
  if (!group) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  return c.json({ ok: true, data: group, requestId: c.get('requestId') });
});

groupsRouter.get('/:id/members', async (c) => {
  const members = await pg.listGroupMembers(c.get('userId')!, c.req.param('id'));
  if (!members) return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);
  return c.json({ ok: true, data: members, requestId: c.get('requestId') });
});
