import { randomUUID } from 'crypto';
import type {
  ChatMessage,
  ChatSession,
  GroupListItem,
  GroupMessage,
  GroupMessageKind,
  Topic,
  ChatAttachment,
} from '@xzz/shared';
import { formatChapterTitle } from '@xzz/shared';
import { getPool } from '../db/client.js';
import { listGroupMembers } from './pg.js';

function now() {
  return new Date().toISOString();
}

function rowTopic(row: {
  id: string;
  group_id: string;
  title: string;
  sort_order: number;
  summary: string;
  created_at: Date;
  updated_at: Date;
}): Topic {
  return {
    id: row.id,
    groupId: row.group_id,
    title: row.title,
    order: row.sort_order,
    summary: row.summary,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function rowMessage(
  row: {
    id: string;
    group_id: string;
    topic_id: string | null;
    author_id: string;
    kind: string;
    payload: GroupMessage;
    created_at: Date;
  },
  authorDisplayName?: string,
): GroupMessage {
  const payload = row.payload;
  return {
    ...payload,
    id: row.id,
    groupId: row.group_id,
    topicId: row.topic_id,
    authorId: row.author_id,
    authorDisplayName,
    kind: row.kind as GroupMessage['kind'],
    createdAt: row.created_at.toISOString(),
  };
}

function truncate(text: string, max = 80): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

export function formatGroupMessagePreview(msg: {
  kind: GroupMessageKind;
  content: string;
  authorDisplayName: string;
  invokerAssistantName?: string | null;
  attachments?: ChatAttachment[];
}): string {
  if (msg.attachments?.length && !msg.content.trim()) return '[图片]';
  const body = truncate(msg.content || (msg.attachments?.length ? '[图片]' : ''));
  if (msg.kind === 'ai') {
    const assistant = msg.invokerAssistantName?.trim() || 'AI';
    return `${msg.authorDisplayName}：${assistant} ${body}`;
  }
  if (msg.kind === 'system') return body || '系统消息';
  return `${msg.authorDisplayName}：${body}`;
}

export async function listGroupsWithPreview(userId: string): Promise<GroupListItem[]> {
  const pool = getPool();
  const { rows: groupRows } = await pool.query(
    `SELECT g.*,
            (SELECT COUNT(*)::int FROM group_members gm WHERE gm.group_id = g.id) AS member_count
     FROM groups g
     INNER JOIN group_members m ON m.group_id = g.id
     WHERE m.user_id = $1`,
    [userId],
  );

  if (groupRows.length === 0) return [];

  const groupIds = groupRows.map((r) => r.id as string);
  const { rows: lastRows } = await pool.query(
    `SELECT DISTINCT ON (m.group_id)
            m.id, m.group_id, m.kind, m.payload, m.created_at,
            u.display_name AS author_display_name
     FROM group_messages m
     INNER JOIN users u ON u.id = m.author_id
     WHERE m.group_id = ANY($1::text[])
     ORDER BY m.group_id, m.created_at DESC`,
    [groupIds],
  );

  const lastByGroup = new Map(
    lastRows.map((r) => {
      const payload = r.payload as GroupMessage;
      const authorDisplayName = (r.author_display_name as string) || '成员';
      const preview = formatGroupMessagePreview({
        kind: r.kind as GroupMessageKind,
        content: payload.content ?? '',
        authorDisplayName,
        invokerAssistantName: payload.invokerAssistantName,
        attachments: payload.attachments,
      });
      return [
        r.group_id as string,
        {
          id: r.id as string,
          kind: r.kind as GroupMessageKind,
          content: payload.content ?? '',
          preview,
          authorDisplayName,
          createdAt: (r.created_at as Date).toISOString(),
        },
      ];
    }),
  );

  const items: GroupListItem[] = groupRows.map((r) => ({
    id: r.id,
    name: r.name,
    inviteCode: r.invite_code,
    ownerId: r.owner_id,
    createdAt: (r.created_at as Date).toISOString(),
    memberCount: r.member_count as number,
    lastMessage: lastByGroup.get(r.id) ?? null,
  }));

  items.sort((a, b) => {
    const ta = a.lastMessage?.createdAt ?? a.createdAt;
    const tb = b.lastMessage?.createdAt ?? b.createdAt;
    return tb.localeCompare(ta);
  });

  return items;
}

export async function isGroupMember(
  userId: string,
  groupId: string,
): Promise<boolean> {
  // K9b F4:只要布尔 → 专门 SELECT 1,不走 listGroupMembers 的全员名册 JOIN
  // (后者为面板取整名册用;群评审端点每请求只问"是不是成员")。
  const { rows } = await getPool().query(
    `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1`,
    [groupId, userId],
  );
  return rows.length > 0;
}

export async function listTopics(
  userId: string,
  groupId: string,
): Promise<Topic[] | null> {
  if (!(await isGroupMember(userId, groupId))) return null;
  const { rows } = await getPool().query(
    `SELECT * FROM topics WHERE group_id = $1 ORDER BY sort_order, created_at`,
    [groupId],
  );
  return rows.map(rowTopic);
}

export async function createTopic(
  userId: string,
  groupId: string,
  title?: string,
): Promise<Topic | null> {
  if (!(await isGroupMember(userId, groupId))) return null;
  const { rows: countRows } = await getPool().query(
    'SELECT COUNT(*)::int AS c FROM topics WHERE group_id = $1',
    [groupId],
  );
  const order = countRows[0].c as number;
  const id = randomUUID();
  const topicTitle = title?.trim() || formatChapterTitle(order);
  const ts = now();
  await getPool().query(
    `INSERT INTO topics (id, group_id, title, sort_order, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)`,
    [id, groupId, topicTitle, order, ts],
  );
  const { rows } = await getPool().query('SELECT * FROM topics WHERE id = $1', [id]);
  return rowTopic(rows[0]);
}

export async function getTopic(
  userId: string,
  groupId: string,
  topicId: string,
): Promise<Topic | null> {
  if (!(await isGroupMember(userId, groupId))) return null;
  const { rows } = await getPool().query(
    'SELECT * FROM topics WHERE id = $1 AND group_id = $2',
    [topicId, groupId],
  );
  return rows[0] ? rowTopic(rows[0]) : null;
}

export async function updateTopicTitle(
  userId: string,
  groupId: string,
  topicId: string,
  title: string,
): Promise<Topic | null> {
  if (!(await isGroupMember(userId, groupId))) return null;
  const cleaned = title.trim().replace(/\s+/g, ' ').slice(0, 32);
  if (!cleaned) return null;
  const ts = now();
  await getPool().query(
    `UPDATE topics SET title = $3, updated_at = $4 WHERE id = $1 AND group_id = $2`,
    [topicId, groupId, cleaned, ts],
  );
  return getTopic(userId, groupId, topicId);
}

export async function listGroupMessages(
  userId: string,
  groupId: string,
  topicId: string,
  opts?: { after?: string; since?: string; limit?: number },
): Promise<GroupMessage[] | null> {
  if (!(await isGroupMember(userId, groupId))) return null;
  const limit = Math.min(opts?.limit ?? 100, 200);
  let query = `
    SELECT m.*, u.display_name
    FROM group_messages m
    INNER JOIN users u ON u.id = m.author_id
    WHERE m.group_id = $1 AND m.topic_id = $2`;
  const params: unknown[] = [groupId, topicId];

  // 锚点不存在(无效/已删)时,子查询 NULL 会让元组比较整体为 NULL → 静默空结果;
  // 先查锚点,查不到则忽略游标退化为从头列出(等价首次拉取,客户端按 id 去重)。
  let afterAnchor: string | null = null;
  if (opts?.after) {
    const anchor = await getPool().query(
      'SELECT created_at FROM group_messages WHERE id = $1 AND group_id = $2 AND topic_id = $3',
      [opts.after, groupId, topicId],
    );
    if (anchor.rows[0]) afterAnchor = opts.after;
  }

  if (afterAnchor) {
    // 同毫秒 tiebreak:created_at 由服务端 toISOString() 生成(毫秒精度),同毫秒落库的
    // 多条消息 created_at 相等。游标用 (created_at, id) 复合比较 + 复合排序构成全序,
    // 否则严格 > 只比 created_at 会漏掉与锚点同毫秒、id 排在后面的消息。
    query += ` AND (m.created_at, m.id) > ((SELECT created_at FROM group_messages WHERE id = $3), $3)`;
    params.push(afterAnchor);
    query += ` ORDER BY m.created_at ASC, m.id ASC LIMIT $${params.length + 1}`;
    params.push(limit);
  } else if (opts?.since) {
    query += ` AND m.created_at > $3::timestamptz ORDER BY m.created_at ASC, m.id ASC LIMIT $4`;
    params.push(opts.since, limit);
  } else {
    query += ` ORDER BY m.created_at ASC, m.id ASC LIMIT $3`;
    params.push(limit);
  }

  const { rows } = await getPool().query(query, params);
  return rows.map((r) => rowMessage(r, r.display_name));
}

export async function addGroupMessage(
  userId: string,
  groupId: string,
  topicId: string,
  input: {
    kind?: GroupMessage['kind'];
    content: string;
    attachments?: ChatAttachment[];
    invokerUserId?: string;
    invokerAssistantName?: string;
    jobId?: string;
    llmInvoke?: GroupMessage['llmInvoke'];
    llmReply?: GroupMessage['llmReply'];
  },
): Promise<GroupMessage | null> {
  if (!(await isGroupMember(userId, groupId))) return null;
  const id = randomUUID();
  const ts = now();
  const msg: GroupMessage = {
    id,
    groupId,
    topicId,
    authorId: userId,
    kind: input.kind ?? 'human',
    content: input.content,
    attachments: input.attachments,
    contentMode: input.attachments?.length ? 'multimodal' : 'text',
    invokerUserId: input.invokerUserId ?? null,
    invokerAssistantName: input.invokerAssistantName ?? null,
    jobId: input.jobId ?? null,
    llmInvoke: input.llmInvoke ?? null,
    llmReply: input.llmReply ?? null,
    createdAt: ts,
  };
  await getPool().query(
    `INSERT INTO group_messages (id, group_id, topic_id, author_id, kind, payload, created_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [id, groupId, topicId, userId, msg.kind, JSON.stringify(msg), ts],
  );
  const members = await listGroupMembers(userId, groupId);
  const name = members?.find((m) => m.userId === userId)?.displayName;
  return { ...msg, authorDisplayName: name };
}

export async function getGroupMessage(
  userId: string,
  groupId: string,
  topicId: string,
  messageId: string,
): Promise<GroupMessage | null> {
  const list = await listGroupMessages(userId, groupId, topicId, { limit: 500 });
  if (!list) return null;
  return list.find((m) => m.id === messageId) ?? null;
}

export async function updateGroupMessage(
  userId: string,
  groupId: string,
  topicId: string,
  messageId: string,
  patch: Partial<GroupMessage>,
): Promise<GroupMessage | null> {
  if (!(await isGroupMember(userId, groupId))) return null;
  const existing = await getGroupMessage(userId, groupId, topicId, messageId);
  if (!existing) return null;
  const updated: GroupMessage = { ...existing, ...patch };
  await getPool().query(
    `UPDATE group_messages SET payload = $4::jsonb, kind = $5
     WHERE id = $1 AND group_id = $2 AND topic_id = $3`,
    [messageId, groupId, topicId, JSON.stringify(updated), updated.kind],
  );
  const members = await listGroupMembers(userId, groupId);
  const name = members?.find((m) => m.userId === updated.authorId)?.displayName;
  return { ...updated, authorDisplayName: name };
}

export async function saveMediaAttachment(
  userId: string,
  mimeType: string,
  storageKey: string,
  meta?: Record<string, unknown>,
): Promise<ChatAttachment> {
  const id = randomUUID();
  await getPool().query(
    `INSERT INTO media_attachments (id, owner_id, mime_type, storage_key, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [id, userId, mimeType, storageKey, JSON.stringify(meta ?? {})],
  );
  return { id, kind: 'image', mimeType, storageKey };
}

export async function getMediaAttachment(
  userId: string,
  attachmentId: string,
): Promise<ChatAttachment | null> {
  const { rows } = await getPool().query(
    'SELECT * FROM media_attachments WHERE id = $1 AND owner_id = $2',
    [attachmentId, userId],
  );
  if (!rows[0]) return null;
  return {
    id: rows[0].id,
    kind: 'image',
    mimeType: rows[0].mime_type,
    storageKey: rows[0].storage_key,
  };
}

export function formatTopicExportMarkdown(
  topic: Topic,
  messages: GroupMessage[],
): string {
  const lines = [`# ${topic.title}`, '', topic.summary ? `> ${topic.summary}` : '', ''];
  for (const m of messages) {
    const who =
      m.kind === 'ai' && m.invokerAssistantName
        ? `${m.authorDisplayName ?? '成员'} 的 ${m.invokerAssistantName}`
        : m.authorDisplayName ?? '成员';
    lines.push(`**${who}** (${m.createdAt}):`, m.content, '');
  }
  return lines.filter((l) => l !== undefined).join('\n');
}

export function formatChatSessionExportMarkdown(
  session: ChatSession,
  messages: ChatMessage[],
): string {
  const lines = [`# ${session.title}`, ''];
  for (const m of messages) {
    const who = m.role === 'assistant' ? 'Bow wow' : '我';
    lines.push(`**${who}** (${m.createdAt}):`, m.content, '');
  }
  return lines.join('\n');
}
