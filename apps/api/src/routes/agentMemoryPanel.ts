import { Hono } from 'hono';
import {
  listAgentMemory,
  decideAgentMemory,
  revalidateAgentMemory,
  markTruthAgentMemory,
  type MemorySource,
} from '../lib/integrations/magi.js';
import { promoteMemoryToNative } from '../lib/memoryPromote.js';
import { groupPoolOwner } from '../lib/memoryOwner.js';
import { isGroupMember } from '../store/pg-social.js';
import type { AppVariables } from '../types.js';

/**
 * P5 审核面板的 agent 侧代理(mobile 调)。
 * **owner 解析**:
 * - scope=me(默认):owner = JWT userId(个人池,绝不信 body)。
 * - scope=group:owner = `group:{groupId}`,**先校验 JWT user 是该群成员**(K8 修订三)——
 *   群池条目任何群成员可审,但非成员 403。
 * 下游打 MAGI /api/agent-memory/{list,decide,revalidate,mark-truth,promote}(service token)。
 */
export const agentMemoryPanelRouter = new Hono<{ Variables: AppVariables }>();

/** 安全解析 JSON body:畸形 → null(调用方返 400,而非让 Hono 抛成 500)。 */
async function safeJson<T>(c: { req: { json: () => Promise<unknown> } }): Promise<T | null> {
  try {
    return (await c.req.json()) as T;
  } catch {
    return null;
  }
}

/**
 * 解析评审 owner(个人 or 群池),含群成员校验。
 * 返回 owner 字符串;非法/越权返回 { error, status }。
 * scope 仅接受 undefined/'me'(个人池)或 'group'(群池);其它值 → 400(不静默落个人池)。
 */
async function resolveReviewOwner(
  userId: string,
  scope: string | undefined,
  groupId: string | undefined,
): Promise<{ owner: string } | { error: string; status: 403 | 400 }> {
  if (scope === 'group') {
    if (!groupId) return { error: 'groupId required for scope=group', status: 400 };
    if (!(await isGroupMember(userId, groupId))) {
      return { error: '非该群成员,无权访问群组记忆', status: 403 };
    }
    return { owner: groupPoolOwner(groupId) };
  }
  if (scope !== undefined && scope !== 'me') {
    return { error: `invalid scope '${scope}' (expected me|group)`, status: 400 };
  }
  return { owner: userId };
}

agentMemoryPanelRouter.get('/list', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ ok: false, message: '请先登录' }, 401);
  const status = c.req.query('status') as 'pending' | 'approved' | 'rejected' | undefined;
  const resolved = await resolveReviewOwner(userId, c.req.query('scope'), c.req.query('groupId'));
  if ('error' in resolved) return c.json({ ok: false, message: resolved.error }, resolved.status);
  const items = await listAgentMemory(resolved.owner, status);
  return c.json({ ok: true, data: { items }, requestId: c.get('requestId') });
});

agentMemoryPanelRouter.post('/decide', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ ok: false, message: '请先登录' }, 401);
  const body = await safeJson<{
    id: number;
    decision: 'approve' | 'reject';
    scope?: string;
    groupId?: string;
  }>(c);
  if (!body) return c.json({ ok: false, message: '请求体不是合法 JSON' }, 400);
  const resolved = await resolveReviewOwner(userId, body.scope, body.groupId);
  if ('error' in resolved) return c.json({ ok: false, message: resolved.error }, resolved.status);
  const result = await decideAgentMemory(resolved.owner, body.id, body.decision);
  return c.json({ ok: true, data: { updated: result.updated }, requestId: c.get('requestId') });
});

agentMemoryPanelRouter.post('/promote', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ ok: false, message: '请先登录' }, 401);
  const body = await safeJson<{ id: number }>(c);
  if (!body) return c.json({ ok: false, message: '请求体不是合法 JSON' }, 400);
  // 升格只针对**个人**记忆(原生核心是 per-user always-on);群池不升格。owner=JWT。
  const result = await promoteMemoryToNative(userId, body.id);
  return c.json({ ok: true, data: result, requestId: c.get('requestId') });
});

agentMemoryPanelRouter.post('/revalidate', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ ok: false, message: '请先登录' }, 401);
  const body = await safeJson<{ id: number; scope?: string; groupId?: string }>(c);
  if (!body) return c.json({ ok: false, message: '请求体不是合法 JSON' }, 400);
  const resolved = await resolveReviewOwner(userId, body.scope, body.groupId);
  if ('error' in resolved) return c.json({ ok: false, message: resolved.error }, resolved.status);
  const result = await revalidateAgentMemory(resolved.owner, body.id);
  return c.json({ ok: true, data: result, requestId: c.get('requestId') });
});

agentMemoryPanelRouter.post('/mark-truth', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ ok: false, message: '请先登录' }, 401);
  const body = await safeJson<{
    id: number;
    truthStatus: 'unverified' | 'disputed' | 'refuted';
    truthNote?: string;
    counterSources?: MemorySource[];
    scope?: string;
    groupId?: string;
  }>(c);
  if (!body) return c.json({ ok: false, message: '请求体不是合法 JSON' }, 400);
  const resolved = await resolveReviewOwner(userId, body.scope, body.groupId);
  if ('error' in resolved) return c.json({ ok: false, message: resolved.error }, resolved.status);
  const opts: { truthNote?: string; counterSources?: MemorySource[] } = {};
  if (body.truthNote !== undefined) opts.truthNote = body.truthNote;
  if (body.counterSources !== undefined) opts.counterSources = body.counterSources;
  const result = await markTruthAgentMemory(resolved.owner, body.id, body.truthStatus, opts);
  return c.json({ ok: true, data: { updated: result.updated }, requestId: c.get('requestId') });
});
