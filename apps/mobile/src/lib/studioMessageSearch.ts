import type { GroupListItem } from '@xzz/shared';
import { api } from './api';
import { ASSISTANT_FALLBACK_NAME, DEFAULT_SESSION_TITLE, isDefaultSessionTitle } from './brand';
import { formatChatListTime } from './formatChatListTime';

export type StudioMessageSearchHit = {
  id: string;
  kind: 'group' | 'privateChat';
  title: string;
  topicId?: string;
  topicTitle?: string;
  groupId?: string;
  groupName?: string;
  sessionId?: string;
  messageId: string;
  preview: string;
  matchCount: number;
  timeLabel: string;
};

type ConversationBucket = {
  hit: StudioMessageSearchHit;
  matchCount: number;
  latestAt: string;
};

function includesQuery(text: string, query: string): boolean {
  return text.toLowerCase().includes(query.toLowerCase());
}

function truncate(text: string, max = 72): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function messageSearchText(msg: { content: string; kind?: string }): string {
  if (!msg.content?.trim()) return '';
  if (msg.kind === 'system') return '';
  return msg.content;
}

function upsertBucket(
  map: Map<string, ConversationBucket>,
  key: string,
  next: Omit<StudioMessageSearchHit, 'matchCount'>,
  createdAt: string,
) {
  const existing = map.get(key);
  if (!existing) {
    map.set(key, {
      hit: { ...next, matchCount: 1 },
      matchCount: 1,
      latestAt: createdAt,
    });
    return;
  }
  existing.matchCount += 1;
  existing.hit.matchCount = existing.matchCount;
  if (createdAt > existing.latestAt) {
    existing.latestAt = createdAt;
    existing.hit = {
      ...existing.hit,
      messageId: next.messageId,
      preview: next.preview,
      timeLabel: next.timeLabel,
    };
  }
}

export async function searchStudioChatMessages(
  query: string,
  groups: GroupListItem[],
): Promise<StudioMessageSearchHit[]> {
  const q = query.trim();
  if (!q) return [];

  const buckets = new Map<string, ConversationBucket>();
  const sessionsRes = await api.listChatSessions();
  const sessions = sessionsRes.data;

  await Promise.all(
    groups.map(async (group) => {
      try {
        const topicsRes = await api.listTopics(group.id);
        await Promise.all(
          topicsRes.data.map(async (topic) => {
            const msgsRes = await api.listGroupMessages(group.id, topic.id);
            for (const msg of msgsRes.data) {
              const body = messageSearchText(msg);
              if (!body || !includesQuery(body, q)) continue;
              const author =
                msg.kind === 'ai'
                  ? msg.invokerAssistantName?.trim() || 'AI'
                  : msg.authorDisplayName?.trim() || '成员';
              const preview = truncate(`${author}: ${body}`);
              const key = `group:${group.id}:${topic.id}`;
              upsertBucket(
                buckets,
                key,
                {
                  id: key,
                  kind: 'group',
                  title: group.name,
                  topicId: topic.id,
                  topicTitle: topic.title,
                  groupId: group.id,
                  groupName: group.name,
                  messageId: msg.id,
                  preview,
                  timeLabel: formatChatListTime(msg.createdAt),
                },
                msg.createdAt,
              );
            }
          }),
        );
      } catch {
        // skip inaccessible group
      }
    }),
  );

  await Promise.all(
    sessions.map(async (session) => {
      try {
        const msgsRes = await api.getChatMessages(session.id);
        const rawTitle = session.title?.trim();
        const title = rawTitle && !isDefaultSessionTitle(rawTitle) ? rawTitle : DEFAULT_SESSION_TITLE;
        for (const msg of msgsRes.data) {
          const body = msg.content?.trim() ?? '';
          if (!body || !includesQuery(body, q)) continue;
          const author = msg.role === 'user' ? '我' : ASSISTANT_FALLBACK_NAME;
          const preview = truncate(`${author}: ${body}`);
          const key = `chat:${session.id}`;
          upsertBucket(
            buckets,
            key,
            {
              id: key,
              kind: 'privateChat',
              title,
              sessionId: session.id,
              messageId: msg.id,
              preview,
              timeLabel: formatChatListTime(msg.createdAt),
            },
            msg.createdAt,
          );
        }
      } catch {
        // skip
      }
    }),
  );

  return [...buckets.values()]
    .sort((a, b) => b.latestAt.localeCompare(a.latestAt))
    .map((b) => b.hit);
}
