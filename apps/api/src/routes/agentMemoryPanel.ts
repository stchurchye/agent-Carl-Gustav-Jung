import { Hono } from 'hono';
import {
  listAgentMemory,
  decideAgentMemory,
} from '../lib/integrations/magi.js';
import { promoteMemoryToNative } from '../lib/memoryPromote.js';
import type { AppVariables } from '../types.js';

/**
 * P5 审核面板的 agent 侧代理(mobile 调)。
 * **owner 一律取 JWT 的 userId,绝不信 body** —— 用户只能看/审自己的记忆(多租户隔离)。
 * 下游打 MAGI /api/agent-memory/{list,decide}(service token + owner)。
 */
export const agentMemoryPanelRouter = new Hono<{ Variables: AppVariables }>();

agentMemoryPanelRouter.get('/list', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ ok: false, message: '请先登录' }, 401);
  const status = c.req.query('status') as
    | 'pending'
    | 'approved'
    | 'rejected'
    | undefined;
  const items = await listAgentMemory(userId, status);
  return c.json({ ok: true, data: { items }, requestId: c.get('requestId') });
});

agentMemoryPanelRouter.post('/decide', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ ok: false, message: '请先登录' }, 401);
  const body = await c.req.json<{ id: number; decision: 'approve' | 'reject' }>();
  const result = await decideAgentMemory(userId, body.id, body.decision);
  return c.json({
    ok: true,
    data: { updated: result.updated },
    requestId: c.get('requestId'),
  });
});

agentMemoryPanelRouter.post('/promote', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ ok: false, message: '请先登录' }, 401);
  const body = await c.req.json<{ id: number }>();
  // owner=JWT(绝不信 body);text 由 MAGI 权威拿回 → 写原生核心。幂等。
  const result = await promoteMemoryToNative(userId, body.id);
  return c.json({ ok: true, data: result, requestId: c.get('requestId') });
});
