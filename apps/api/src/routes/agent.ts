import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { ErrorCodes } from '@xzz/shared';
import type { AppVariables } from '../types.js';
import { jsonError } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { getPool } from '../db/client.js';
import * as store from '../lib/agent/store.js';
import { cancelRun, confirmRun, createAgentRun } from '../lib/agent/runtime.js';
import type { AgentRun } from '../lib/agent/types.js';
import * as topicSkills from '../lib/agent/topicSkills.js';

export const agentRouter = new Hono<{ Variables: AppVariables }>();

agentRouter.use('*', requireAuth);

/**
 * 私聊：仅 owner 可访问。群聊：owner 或群成员可访问（任意成员可看/取消，对齐 spec §8.5 + AC2）。
 * Exported for unit tests (T12).
 */
export async function canAccessRun(run: AgentRun, userId: string): Promise<boolean> {
  if (run.ownerId === userId) return true;
  if (run.channel === 'group' && run.groupId) {
    const { rows } = await getPool().query(
      `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1`,
      [run.groupId, userId],
    );
    return rows.length > 0;
  }
  return false;
}

agentRouter.get('/runs/:id', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const run = await store.getAgentRun(id);
  if (!run) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  if (!(await canAccessRun(run, userId)))
    return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);
  const steps = await store.listSteps(id);
  return c.json({
    ok: true,
    data: { run, steps },
    requestId: c.get('requestId'),
  });
});

agentRouter.get('/runs/:id/stream', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const run = await store.getAgentRun(id);
  if (!run) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  if (!(await canAccessRun(run, userId)))
    return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);

  return streamSSE(c, async (stream) => {
    let lastStepIdx = -1;
    let lastStatus = run.status;
    let alive = true;
    stream.onAbort(() => {
      alive = false;
    });

    while (alive) {
      const current = await store.getAgentRun(id);
      if (!current) break;
      const steps = await store.listSteps(id);
      const newSteps = steps.filter((s) => s.idx > lastStepIdx);
      for (const s of newSteps) {
        await stream.writeSSE({
          event: 'step',
          data: JSON.stringify(s),
        });
        lastStepIdx = s.idx;
      }
      if (current.status !== lastStatus) {
        await stream.writeSSE({
          event: 'status',
          data: JSON.stringify({ status: current.status, runId: id }),
        });
        lastStatus = current.status;
      }
      const terminal =
        current.status === 'completed' ||
        current.status === 'failed' ||
        current.status === 'cancelled' ||
        current.status === 'budget_exhausted';
      if (terminal) {
        await stream.writeSSE({
          event: 'end',
          data: JSON.stringify({ runId: id, finalStatus: current.status }),
        });
        break;
      }
      await new Promise<void>((r) => setTimeout(r, 1_000));
    }
  });
});

agentRouter.post('/runs/:id/cancel', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const run = await store.getAgentRun(id);
  if (!run) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  if (!(await canAccessRun(run, userId)))
    return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);
  await cancelRun(id, userId);
  return c.json({ ok: true, requestId: c.get('requestId') });
});

/**
 * M1d Task 3：把一个终态 run 重跑——克隆 inputText / channel / budget，
 * 创建一个新的 run（不复用旧 run id、不接续 step），返回新 runId。
 * 只允许 terminal 状态调用；非 terminal 状态返回 409。
 */
agentRouter.post('/runs/:id/retry', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const run = await store.getAgentRun(id);
  if (!run) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  if (!(await canAccessRun(run, userId)))
    return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);
  const isTerminal =
    run.status === 'completed' ||
    run.status === 'failed' ||
    run.status === 'cancelled' ||
    run.status === 'budget_exhausted';
  if (!isTerminal) return jsonError(c, ErrorCodes.VALIDATION, 409);

  const result = await createAgentRun({
    ownerId: run.ownerId,
    channel: run.channel,
    sessionId: run.sessionId ?? undefined,
    groupId: run.groupId ?? undefined,
    topicId: run.topicId ?? undefined,
    inputText: run.inputText,
    // Worker 自己根据 apiKeySource 解析 key（M1d Task 6 才接 per-user key 取用）。
    apiKey: '',
    apiKeySource: run.apiKeySource,
    budget: run.budget,
  });
  return c.json({
    ok: true,
    data: {
      runId: result.run.id,
      placeholderMessageId: result.placeholderMessageId,
      userMessageId: result.userMessageId,
    },
    requestId: c.get('requestId'),
  });
});

agentRouter.post('/runs/:id/confirm', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const run = await store.getAgentRun(id);
  if (!run) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  if (!(await canAccessRun(run, userId)))
    return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);
  await confirmRun(id);
  return c.json({ ok: true, requestId: c.get('requestId') });
});

// --------- Approval / Steer (M1b-2) ---------

agentRouter.post('/runs/:id/approve', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const run = await store.getAgentRun(id);
  if (!run) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  if (!(await canAccessRun(run, userId)))
    return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);
  const { approveRun } = await import('../lib/agent/approval.js');
  const ok = await approveRun(id, userId);
  return c.json({ ok, requestId: c.get('requestId') });
});

agentRouter.post('/runs/:id/deny', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const run = await store.getAgentRun(id);
  if (!run) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  if (!(await canAccessRun(run, userId)))
    return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);
  const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
  const { denyRun } = await import('../lib/agent/approval.js');
  const ok = await denyRun(id, userId, body.reason);
  return c.json({ ok, requestId: c.get('requestId') });
});

agentRouter.post('/runs/:id/steer', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const run = await store.getAgentRun(id);
  if (!run) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  if (!(await canAccessRun(run, userId)))
    return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);
  const body = await c.req
    .json<{ instruction?: string }>()
    .catch(() => ({}) as { instruction?: string });
  const instruction = body.instruction?.trim();
  if (!instruction) return jsonError(c, ErrorCodes.VALIDATION, 400);
  const { steerRun } = await import('../lib/agent/steer.js');
  const res = await steerRun({
    runId: id,
    byUserId: userId,
    instruction,
  });
  return c.json({
    ok: res.accepted,
    reason: res.reason,
    requestId: c.get('requestId'),
  });
});

// --------- Topic skills CRUD (M1b-1) ---------

async function canManageGroupSkill(
  userId: string,
  groupId: string | null,
): Promise<boolean> {
  if (!groupId) return true;
  const { rows } = await getPool().query(
    `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1`,
    [groupId, userId],
  );
  return rows.length > 0;
}

agentRouter.get('/skills', async (c) => {
  const userId = c.get('userId')!;
  const skills = await topicSkills.listOwnSkills(userId);
  return c.json({ ok: true, data: { skills }, requestId: c.get('requestId') });
});

agentRouter.post('/skills', async (c) => {
  const userId = c.get('userId')!;
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return jsonError(c, ErrorCodes.VALIDATION, 400);
  }
  const scope = body.scope as 'user' | 'group' | 'topic';
  const title = (body.title as string | undefined)?.trim();
  const content = (body.content as string | undefined)?.trim();
  if (!scope || !['user', 'group', 'topic'].includes(scope)) {
    return jsonError(c, ErrorCodes.VALIDATION, 400);
  }
  if (!title || !content) {
    return jsonError(c, ErrorCodes.VALIDATION, 400);
  }
  const groupId = (body.groupId as string | null) ?? null;
  const topicId = (body.topicId as string | null) ?? null;
  if ((scope === 'group' || scope === 'topic') && !groupId) {
    return jsonError(c, ErrorCodes.VALIDATION, 400);
  }
  if (scope === 'topic' && !topicId) {
    return jsonError(c, ErrorCodes.VALIDATION, 400);
  }
  if (!(await canManageGroupSkill(userId, groupId))) {
    return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);
  }
  const skill = await topicSkills.upsertSkill({
    id: body.id,
    scope,
    ownerId: scope === 'user' ? userId : userId,
    groupId,
    topicId,
    title,
    content,
    enabled: body.enabled !== false,
    updatedByUserId: userId,
  });
  return c.json({ ok: true, data: { skill }, requestId: c.get('requestId') });
});

agentRouter.patch('/skills/:id', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const existing = await topicSkills.getSkill(id);
  if (!existing) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  if (!(await canManageGroupSkill(userId, existing.groupId))) {
    return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);
  }
  const body = await c.req.json().catch(() => ({}));
  const skill = await topicSkills.upsertSkill({
    id,
    scope: existing.scope,
    ownerId: existing.ownerId,
    groupId: existing.groupId,
    topicId: existing.topicId,
    title: (body.title as string | undefined)?.trim() || existing.title,
    content: (body.content as string | undefined)?.trim() || existing.content,
    enabled: typeof body.enabled === 'boolean' ? body.enabled : existing.enabled,
    updatedByUserId: userId,
  });
  return c.json({ ok: true, data: { skill }, requestId: c.get('requestId') });
});

agentRouter.delete('/skills/:id', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const existing = await topicSkills.getSkill(id);
  if (!existing) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  if (!(await canManageGroupSkill(userId, existing.groupId))) {
    return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);
  }
  await topicSkills.deleteSkill(id, userId);
  return c.json({ ok: true, requestId: c.get('requestId') });
});
