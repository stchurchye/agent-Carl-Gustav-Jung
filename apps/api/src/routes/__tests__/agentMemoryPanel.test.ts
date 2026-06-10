import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

vi.mock('../../lib/integrations/magi.js', () => ({
  listAgentMemory: vi.fn(),
  decideAgentMemory: vi.fn(),
  revalidateAgentMemory: vi.fn(),
  markTruthAgentMemory: vi.fn(),
}));
vi.mock('../../store/pg-social.js', () => ({ isGroupMember: vi.fn() }));

import {
  listAgentMemory, decideAgentMemory, revalidateAgentMemory, markTruthAgentMemory,
} from '../../lib/integrations/magi.js';
import { isGroupMember } from '../../store/pg-social.js';
import { agentMemoryPanelRouter } from '../agentMemoryPanel.js';
import type { AppVariables } from '../../types.js';

const listMem = vi.mocked(listAgentMemory);
const decideMem = vi.mocked(decideAgentMemory);
const revalidateMem = vi.mocked(revalidateAgentMemory);
const markTruthMem = vi.mocked(markTruthAgentMemory);
const isMember = vi.mocked(isGroupMember);

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

// ───────────── K8:群池 scope + 纠错/真伪 代理端点 ─────────────

describe('agent-memory panel · K8 群池 scope + 纠错/真伪', () => {
  beforeEach(() => vi.clearAllMocks());

  it('?scope=group&groupId= 非成员 → 403,不打 MAGI', async () => {
    isMember.mockResolvedValue(false);
    const res = await appAs('userB').request('/api/agent-memory/list?scope=group&groupId=g1');
    expect(res.status).toBe(403);
    expect(listMem).not.toHaveBeenCalled();
  });

  it('?scope=group 成员 → owner=group:{gid} 转发 list', async () => {
    isMember.mockResolvedValue(true);
    listMem.mockResolvedValue([]);
    const res = await appAs('userA').request('/api/agent-memory/list?scope=group&groupId=g1&status=pending');
    expect(res.status).toBe(200);
    expect(listMem).toHaveBeenCalledWith('group:g1', 'pending');
  });

  it('scope=group 缺 groupId → 400', async () => {
    const res = await appAs('userA').request('/api/agent-memory/list?scope=group');
    expect(res.status).toBe(400);
    expect(listMem).not.toHaveBeenCalled();
  });

  it('decide 群池:成员校验后 owner=group:{gid}', async () => {
    isMember.mockResolvedValue(true);
    decideMem.mockResolvedValue({ updated: 1 });
    const res = await appAs('userA').request('/api/agent-memory/decide', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 7, decision: 'reject', scope: 'group', groupId: 'g1' }),
    });
    expect(res.status).toBe(200);
    expect(decideMem).toHaveBeenCalledWith('group:g1', 7, 'reject');
  });

  it('decide 群池非成员 → 403', async () => {
    isMember.mockResolvedValue(false);
    const res = await appAs('userB').request('/api/agent-memory/decide', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 7, decision: 'reject', scope: 'group', groupId: 'g1' }),
    });
    expect(res.status).toBe(403);
    expect(decideMem).not.toHaveBeenCalled();
  });

  it('POST /revalidate 个人池:owner=JWT,回传 {revalidated,status}', async () => {
    revalidateMem.mockResolvedValue({ revalidated: 1, status: 'rejected' });
    const res = await appAs('userA').request('/api/agent-memory/revalidate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 3 }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ revalidated: 1, status: 'rejected' });
    expect(revalidateMem).toHaveBeenCalledWith('userA', 3);
  });

  it('POST /mark-truth 个人池:转发 truth_status + note + counterSources', async () => {
    markTruthMem.mockResolvedValue({ updated: 1 });
    const res = await appAs('userA').request('/api/agent-memory/mark-truth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 3, truthStatus: 'refuted', truthNote: '已证伪', counterSources: [{ url: 'https://x.com/c' }] }),
    });
    expect(res.status).toBe(200);
    expect(markTruthMem).toHaveBeenCalledWith('userA', 3, 'refuted', {
      truthNote: '已证伪', counterSources: [{ url: 'https://x.com/c' }],
    });
  });

  it('mark-truth 群池非成员 → 403', async () => {
    isMember.mockResolvedValue(false);
    const res = await appAs('userB').request('/api/agent-memory/mark-truth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 3, truthStatus: 'refuted', scope: 'group', groupId: 'g1' }),
    });
    expect(res.status).toBe(403);
    expect(markTruthMem).not.toHaveBeenCalled();
  });
});
