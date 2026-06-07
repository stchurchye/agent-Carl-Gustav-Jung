import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

vi.mock('../../lib/integrations/magi.js', () => ({
  listAgentMemory: vi.fn(),
  decideAgentMemory: vi.fn(),
}));

import { listAgentMemory, decideAgentMemory } from '../../lib/integrations/magi.js';
import { agentMemoryPanelRouter } from '../agentMemoryPanel.js';
import type { AppVariables } from '../../types.js';

const listMem = vi.mocked(listAgentMemory);
const decideMem = vi.mocked(decideAgentMemory);

/** 挂一个把 userId 设成给定值的桩中间件(模拟鉴权中间件),再挂面板路由。 */
function appAs(userId: string | null) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    if (userId) c.set('userId', userId);
    await next();
  });
  app.route('/api/agent-memory', agentMemoryPanelRouter);
  return app;
}

describe('agent-memory panel routes (owner = JWT user)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('GET /list 用 JWT userId 作 owner,转发 status', async () => {
    listMem.mockResolvedValue([
      { id: 1, text: 'fact', status: 'pending', confidence: 0.5, createdAt: null, validUntil: null, sourceRunId: null },
    ]);
    const res = await appAs('userA').request('/api/agent-memory/list?status=pending');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.items[0].text).toBe('fact');
    expect(listMem).toHaveBeenCalledWith('userA', 'pending');
  });

  it('POST /decide 用 JWT userId 作 owner,忽略 body 里的 owner(防越权)', async () => {
    decideMem.mockResolvedValue({ updated: 1 });
    const res = await appAs('userA').request('/api/agent-memory/decide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // 客户端塞 owner_id=evil,必须被忽略
      body: JSON.stringify({ owner_id: 'evil', id: 7, decision: 'approve' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data.updated).toBe(1);
    expect(decideMem).toHaveBeenCalledWith('userA', 7, 'approve');
  });

  it('无 userId(未登录)→ 401', async () => {
    const res = await appAs(null).request('/api/agent-memory/list');
    expect(res.status).toBe(401);
    expect(listMem).not.toHaveBeenCalled();
  });
});
