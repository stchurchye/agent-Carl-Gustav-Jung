import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { ErrorCodes } from '@xzz/shared';
import type { AppVariables } from '../types.js';
import { jsonError } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import * as store from '../lib/agent/store.js';
import { cancelRun, confirmRun } from '../lib/agent/runtime.js';

export const agentRouter = new Hono<{ Variables: AppVariables }>();

agentRouter.use('*', requireAuth);

agentRouter.get('/runs/:id', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const run = await store.getAgentRun(id);
  if (!run) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  if (run.ownerId !== userId) return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);
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
  if (run.ownerId !== userId) return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);

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
  if (run.ownerId !== userId) return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);
  await cancelRun(id, userId);
  return c.json({ ok: true, requestId: c.get('requestId') });
});

agentRouter.post('/runs/:id/confirm', async (c) => {
  const userId = c.get('userId')!;
  const id = c.req.param('id');
  const run = await store.getAgentRun(id);
  if (!run) return jsonError(c, ErrorCodes.NOT_FOUND, 404);
  if (run.ownerId !== userId) return jsonError(c, ErrorCodes.AUTH_FORBIDDEN, 403);
  await confirmRun(id);
  return c.json({ ok: true, requestId: c.get('requestId') });
});
