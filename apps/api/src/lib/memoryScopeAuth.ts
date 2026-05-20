import * as pg from '../store/pg.js';
import * as social from '../store/pg-social.js';
import type { MemoryScope } from '@xzz/shared';

export async function assertMemoryScopeAccess(
  userId: string,
  scope: MemoryScope,
  ctx: {
    groupId?: string | null;
    topicId?: string | null;
    sessionId?: string | null;
  },
): Promise<void> {
  if (scope === 'user') return;

  if (scope === 'session') {
    const sid = ctx.sessionId?.trim();
    if (!sid) throw new Error('MEMORY_SCOPE_INVALID');
    const session = await pg.getChatSession(userId, sid);
    if (!session) throw new Error('MEMORY_SCOPE_FORBIDDEN');
    return;
  }

  if (scope === 'topic') {
    const gid = ctx.groupId?.trim();
    const tid = ctx.topicId?.trim();
    if (!gid || !tid) throw new Error('MEMORY_SCOPE_INVALID');
    const topic = await social.getTopic(userId, gid, tid);
    if (!topic) throw new Error('MEMORY_SCOPE_FORBIDDEN');
    return;
  }

  if (scope === 'group') {
    const gid = ctx.groupId?.trim();
    if (!gid) throw new Error('MEMORY_SCOPE_INVALID');
    const ok = await social.isGroupMember(userId, gid);
    if (!ok) throw new Error('MEMORY_SCOPE_FORBIDDEN');
  }
}
