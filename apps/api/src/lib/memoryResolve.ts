import { formatMemoryContextSections } from '@xzz/shared';
import { retrieveMemoriesForContext } from './memoryRetrieve.js';
import type { MemoryScope } from '@xzz/shared';
import * as intel from '../store/pg-intelligence.js';

export async function resolveMemoriesForContext(params: {
  userId: string;
  query?: string;
  sessionId?: string | null;
  groupId?: string | null;
  topicId?: string | null;
}): Promise<string> {
  const sections = await retrieveMemoriesForContext(params);
  return formatMemoryContextSections(sections);
}

export async function listMemoryTargetsForUser(params: {
  userId: string;
  sessionId?: string | null;
  groupId?: string | null;
  topicId?: string | null;
}): Promise<
  Array<{ fragmentId: string; title: string; contentPreview: string; label: string }>
> {
  const scopes: Array<{
    scope: MemoryScope;
    opts: { groupId?: string; topicId?: string; sessionId?: string };
  }> = [{ scope: 'user', opts: {} }];

  if (params.topicId && params.groupId) {
    scopes.push({ scope: 'topic', opts: { groupId: params.groupId, topicId: params.topicId } });
  }
  if (params.sessionId) {
    scopes.push({ scope: 'session', opts: { sessionId: params.sessionId } });
  }

  const seen = new Set<string>();
  const out: Array<{
    fragmentId: string;
    title: string;
    contentPreview: string;
    label: string;
  }> = [];

  for (const { scope, opts } of scopes) {
    const items = await intel.listMemoryFragments(params.userId, scope, {
      ...opts,
      withContent: true,
      limit: 20,
    });
    for (const f of items) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      const preview = (f.content ?? '').trim();
      const short =
        preview.length <= 36 ? preview : `${[...preview].slice(0, 36).join('')}…`;
      const scopeLabel =
        scope === 'user' ? '全局' : scope === 'topic' ? '本话题' : '本会话';
      out.push({
        fragmentId: f.id,
        title: f.title,
        contentPreview: short,
        label: `${scopeLabel}：${f.title}`,
      });
    }
  }
  return out;
}
