import { randomUUID } from 'crypto';
import type {
  ChatMessage,
  ChatSession,
  Document,
  Group,
  GroupMember,
  Revision,
  User,
  UserAiProfile,
  WritingAssistantMessage,
} from '@xzz/shared';
import {
  buildChapterTitle,
  formatChapterTitle,
  normalizeWritingDocument,
  personaAssistantDisplayName,
  sanitizePixelAvatarSettings,
} from '@xzz/shared';
import { getPool } from '../db/client.js';

function now() {
  return new Date().toISOString();
}

function rowUser(row: {
  id: string;
  username: string;
  display_name: string;
  created_at: Date;
  avatar_display_key?: string | null;
  pixel_avatar?: unknown;
}): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    createdAt: row.created_at.toISOString(),
    avatarDisplayUrl: row.avatar_display_key ?? null,
    pixelAvatar: sanitizePixelAvatarSettings(row.pixel_avatar),
  };
}

const USER_SELECT = 'id, username, display_name, created_at, avatar_display_key, pixel_avatar';

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// --- Users & auth ---

export async function createUser(input: {
  username: string;
  passwordHash: string;
  displayName: string;
}): Promise<User> {
  const id = randomUUID();
  const pool = getPool();
  await pool.query(
    `INSERT INTO users (id, username, password_hash, display_name)
     VALUES ($1, $2, $3, $4)`,
    [id, input.username, input.passwordHash, input.displayName],
  );
  await pool.query(
    `INSERT INTO user_ai_profiles (user_id) VALUES ($1)`,
    [id],
  );
  const { rows } = await pool.query(
    `SELECT ${USER_SELECT} FROM users WHERE id = $1`,
    [id],
  );
  const user = rowUser(rows[0]);
  const { appendDisplayNameHistory } = await import('./pg-profile.js');
  await appendDisplayNameHistory(user.id, user.displayName);
  return user;
}

export async function findUserByUsername(
  username: string,
): Promise<(User & { passwordHash: string }) | null> {
  const { rows } = await getPool().query(
    `SELECT ${USER_SELECT}, password_hash FROM users WHERE username = $1`,
    [username],
  );
  if (!rows[0]) return null;
  return {
    ...rowUser(rows[0]),
    passwordHash: rows[0].password_hash as string,
  };
}

export async function getUserById(userId: string): Promise<User | null> {
  const profile = await import('./pg-profile.js');
  return profile.getUserById(userId);
}

export async function getUserAiProfile(userId: string): Promise<UserAiProfile> {
  const profilePg = await import('./pg-profile.js');
  const persona = await profilePg.getPersonaSettings(userId);
  const assistantName = personaAssistantDisplayName(persona);
  return {
    userId,
    assistantName,
    stylePreset: 'custom',
    styleCustom: persona.soul?.tone ?? null,
    updatedAt: persona.updatedAt ?? new Date().toISOString(),
  };
}

export async function updateUserAiProfile(
  userId: string,
  patch: Partial<
    Pick<UserAiProfile, 'assistantName' | 'stylePreset' | 'styleCustom'>
  >,
): Promise<UserAiProfile> {
  const profilePg = await import('./pg-profile.js');
  const personaPatch: import('@xzz/shared').UserPersonaSettings = {};
  if (patch.assistantName !== undefined) {
    personaPatch.identity = { assistantName: patch.assistantName.trim() };
  }
  if (patch.styleCustom !== undefined || patch.stylePreset !== undefined) {
    personaPatch.soul = {
      tone: patch.styleCustom?.trim() || undefined,
    };
    if (patch.stylePreset?.trim()) {
      personaPatch.identity = {
        ...personaPatch.identity,
        styleTags:
          patch.stylePreset === 'warm' ? '友好、温暖' : patch.stylePreset.trim(),
      };
    }
  }
  await profilePg.updatePersonaSettings(userId, personaPatch);
  return getUserAiProfile(userId);
}

// --- Groups ---

export async function createGroup(
  ownerId: string,
  name: string,
): Promise<Group> {
  const id = randomUUID();
  let inviteCode = generateInviteCode();
  const pool = getPool();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await pool.query(
        `INSERT INTO groups (id, name, invite_code, owner_id) VALUES ($1, $2, $3, $4)`,
        [id, name, inviteCode, ownerId],
      );
      break;
    } catch (e: unknown) {
      const err = e as { code?: string };
      if (err.code === '23505') {
        inviteCode = generateInviteCode();
        continue;
      }
      throw e;
    }
  }
  await pool.query(
    `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'owner')`,
    [id, ownerId],
  );
  const { rows } = await pool.query('SELECT * FROM groups WHERE id = $1', [id]);
  return {
    id: rows[0].id,
    name: rows[0].name,
    inviteCode: rows[0].invite_code,
    ownerId: rows[0].owner_id,
    createdAt: rows[0].created_at.toISOString(),
  };
}

export async function joinGroupByInvite(
  userId: string,
  inviteCode: string,
): Promise<Group | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT * FROM groups WHERE invite_code = $1',
    [inviteCode.toUpperCase()],
  );
  if (!rows[0]) return null;
  const groupId = rows[0].id as string;
  await pool.query(
    `INSERT INTO group_members (group_id, user_id, role)
     VALUES ($1, $2, 'member')
     ON CONFLICT DO NOTHING`,
    [groupId, userId],
  );
  return {
    id: rows[0].id,
    name: rows[0].name,
    inviteCode: rows[0].invite_code,
    ownerId: rows[0].owner_id,
    createdAt: rows[0].created_at.toISOString(),
  };
}

export async function listGroupsForUser(userId: string): Promise<Group[]> {
  const { rows } = await getPool().query(
    `SELECT g.* FROM groups g
     INNER JOIN group_members m ON m.group_id = g.id
     WHERE m.user_id = $1
     ORDER BY g.created_at DESC`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    inviteCode: r.invite_code,
    ownerId: r.owner_id,
    createdAt: r.created_at.toISOString(),
  }));
}

export async function listGroupMembers(
  userId: string,
  groupId: string,
): Promise<GroupMember[] | null> {
  const member = await getPool().query(
    'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
    [groupId, userId],
  );
  if (member.rows.length === 0) return null;
  const { rows } = await getPool().query(
    `SELECT m.group_id, m.user_id, m.role, m.joined_at, u.display_name, u.pixel_avatar
     FROM group_members m
     INNER JOIN users u ON u.id = m.user_id
     WHERE m.group_id = $1
     ORDER BY m.joined_at`,
    [groupId],
  );
  return rows.map((r) => ({
    groupId: r.group_id,
    userId: r.user_id,
    role: r.role,
    displayName: r.display_name,
    pixelAvatar: sanitizePixelAvatarSettings(r.pixel_avatar),
    joinedAt: r.joined_at.toISOString(),
  }));
}

async function ownsDocument(userId: string, documentId: string): Promise<boolean> {
  const { rows } = await getPool().query(
    'SELECT 1 FROM documents WHERE id = $1 AND owner_id = $2',
    [documentId, userId],
  );
  return rows.length > 0;
}

async function ownsSession(userId: string, sessionId: string): Promise<boolean> {
  const { rows } = await getPool().query(
    'SELECT 1 FROM private_chat_sessions WHERE id = $1 AND owner_id = $2',
    [sessionId, userId],
  );
  return rows.length > 0;
}

function emptyChapter(order: number, title: string) {
  const blockId = randomUUID();
  return {
    id: randomUUID(),
    title,
    order,
    chapterSummary: '',
    blocks: [{ id: blockId, content: '', currentRevisionId: null }],
  };
}

// --- Documents ---

export async function createDocument(
  userId: string,
  title: string,
): Promise<Document> {
  const id = randomUUID();
  const ts = now();
  const doc: Document = {
    id,
    title,
    chapters: [emptyChapter(0, formatChapterTitle(0))],
    globalSummary: '',
    styleGuide: '',
    currentRevisionId: null,
    revisionCount: 0,
    updatedAt: ts,
    createdAt: ts,
    hiddenAt: null,
  };
  await getPool().query(
    `INSERT INTO documents (id, owner_id, payload, created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, $4)`,
    [id, userId, JSON.stringify(doc), ts],
  );
  return doc;
}

export async function listDocuments(userId: string): Promise<Document[]> {
  const { rows } = await getPool().query(
    `SELECT payload FROM documents WHERE owner_id = $1 ORDER BY updated_at DESC`,
    [userId],
  );
  return rows.map((r) => r.payload as Document);
}

export async function getDocument(
  userId: string,
  id: string,
): Promise<Document | undefined> {
  const { rows } = await getPool().query(
    'SELECT payload FROM documents WHERE id = $1 AND owner_id = $2',
    [id, userId],
  );
  if (!rows[0]) return undefined;
  const raw = rows[0].payload as Document;
  const { doc, changed } = normalizeWritingDocument(raw);
  if (changed) return saveDocument(userId, doc);
  return doc;
}

async function saveDocument(userId: string, doc: Document): Promise<Document> {
  const updated = { ...doc, updatedAt: now() };
  await getPool().query(
    `UPDATE documents SET payload = $3::jsonb, updated_at = $4
     WHERE id = $1 AND owner_id = $2`,
    [doc.id, userId, JSON.stringify(updated), updated.updatedAt],
  );
  return updated;
}

export async function updateDocument(
  userId: string,
  id: string,
  patch: Partial<Document>,
): Promise<Document | undefined> {
  const doc = await getDocument(userId, id);
  if (!doc) return undefined;
  return saveDocument(userId, { ...doc, ...patch });
}

export async function saveDocumentContent(
  userId: string,
  documentId: string,
  chapterId: string,
  blockId: string,
  content: string,
): Promise<Document | undefined> {
  const doc = await getDocument(userId, documentId);
  if (!doc) return undefined;
  const chapters = doc.chapters.map((ch) => {
    if (ch.id !== chapterId) return ch;
    return {
      ...ch,
      blocks: ch.blocks.map((b) => (b.id === blockId ? { ...b, content } : b)),
    };
  });
  return saveDocument(userId, { ...doc, chapters });
}

const MAX_CHAPTERS = 50;

export async function addChapter(
  userId: string,
  documentId: string,
  title?: string,
): Promise<Document | undefined> {
  const doc = await getDocument(userId, documentId);
  if (!doc || doc.chapters.length >= MAX_CHAPTERS) return undefined;
  const nextIndex = doc.chapters.length;
  const chapterTitle = title?.trim() || formatChapterTitle(nextIndex);
  const chapters = [...doc.chapters, emptyChapter(nextIndex, chapterTitle)];
  return saveDocument(userId, { ...doc, chapters });
}

async function applyRevisionToDocument(userId: string, rev: Revision) {
  const doc = await getDocument(userId, rev.documentId);
  if (!doc) return;
  await saveDocument(userId, {
    ...doc,
    currentRevisionId: rev.id,
    revisionCount: doc.revisionCount + 1,
  });
  if (rev.blockId) {
    const found = findBlock(doc, rev.blockId);
    if (found) {
      await saveDocumentContent(
        userId,
        rev.documentId,
        found.chapter.id,
        rev.blockId,
        rev.snapshot,
      );
    }
  }
}

export async function createRevision(
  userId: string,
  input: Omit<Revision, 'id' | 'createdAt' | 'timezone'>,
): Promise<Revision | undefined> {
  if (!(await ownsDocument(userId, input.documentId))) return undefined;
  const rev: Revision = {
    ...input,
    id: randomUUID(),
    createdAt: now(),
    timezone: 'Asia/Shanghai',
  };
  await getPool().query(
    `INSERT INTO revisions (id, owner_id, document_id, payload, created_at)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [rev.id, userId, rev.documentId, JSON.stringify(rev), rev.createdAt],
  );
  if (rev.status === 'accepted') {
    await applyRevisionToDocument(userId, rev);
  }
  return rev;
}

export async function getRevision(
  userId: string,
  id: string,
): Promise<Revision | undefined> {
  const { rows } = await getPool().query(
    'SELECT payload FROM revisions WHERE id = $1 AND owner_id = $2',
    [id, userId],
  );
  return rows[0] ? (rows[0].payload as Revision) : undefined;
}

export async function acceptRevision(
  userId: string,
  revisionId: string,
  editedSnapshot?: string,
): Promise<Revision | undefined> {
  const rev = await getRevision(userId, revisionId);
  if (!rev || rev.status !== 'pending') return undefined;
  const snapshot = editedSnapshot ?? rev.snapshot;
  const manuallyEdited =
    editedSnapshot != null && editedSnapshot !== rev.snapshot;
  let summary = rev.summary.startsWith('您同意了')
    ? rev.summary
    : `您同意了「${rev.summary}」`;
  if (manuallyEdited) {
    summary = `${summary}（采纳前您又改了几个字）`;
  }
  const updated: Revision = { ...rev, snapshot, status: 'accepted', summary };
  await getPool().query(
    'UPDATE revisions SET payload = $2::jsonb WHERE id = $1 AND owner_id = $3',
    [revisionId, JSON.stringify(updated), userId],
  );
  await applyRevisionToDocument(userId, updated);
  return updated;
}

export async function rejectRevision(
  userId: string,
  revisionId: string,
): Promise<Revision | undefined> {
  const rev = await getRevision(userId, revisionId);
  if (!rev) return undefined;
  const updated: Revision = { ...rev, status: 'rejected' };
  await getPool().query(
    'UPDATE revisions SET payload = $2::jsonb WHERE id = $1 AND owner_id = $3',
    [revisionId, JSON.stringify(updated), userId],
  );
  return updated;
}

export async function listRevisions(
  userId: string,
  documentId: string,
): Promise<Revision[]> {
  if (!(await ownsDocument(userId, documentId))) return [];
  const { rows } = await getPool().query(
    `SELECT payload FROM revisions
     WHERE owner_id = $1 AND document_id = $2
     ORDER BY created_at DESC`,
    [userId, documentId],
  );
  return rows
    .map((r) => r.payload as Revision)
    .filter((r) => r.status !== 'rejected');
}

// --- Private chat ---

export async function createChatSession(
  userId: string,
  title: string,
): Promise<ChatSession> {
  const session: ChatSession = {
    id: randomUUID(),
    title,
    createdAt: now(),
    updatedAt: now(),
  };
  await getPool().query(
    `INSERT INTO private_chat_sessions (id, owner_id, payload, created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, $4)`,
    [session.id, userId, JSON.stringify(session), session.createdAt],
  );
  return session;
}

export async function listChatSessions(userId: string): Promise<ChatSession[]> {
  const { rows } = await getPool().query(
    `SELECT payload FROM private_chat_sessions
     WHERE owner_id = $1 ORDER BY updated_at DESC`,
    [userId],
  );
  return rows.map((r) => r.payload as ChatSession);
}

export async function getChatSession(
  userId: string,
  sessionId: string,
): Promise<ChatSession | undefined> {
  const { rows } = await getPool().query(
    'SELECT payload FROM private_chat_sessions WHERE id = $1 AND owner_id = $2',
    [sessionId, userId],
  );
  return rows[0] ? (rows[0].payload as ChatSession) : undefined;
}

async function saveChatSession(userId: string, session: ChatSession) {
  const updated = { ...session, updatedAt: now() };
  await getPool().query(
    `UPDATE private_chat_sessions SET payload = $3::jsonb, updated_at = $4
     WHERE id = $1 AND owner_id = $2`,
    [session.id, userId, JSON.stringify(updated), updated.updatedAt],
  );
  return updated;
}

export async function updateChatSessionContext(
  userId: string,
  sessionId: string,
  contextSummary: string,
  contextSummaryUpToMessageId: string | null,
): Promise<ChatSession | undefined> {
  const session = await getChatSession(userId, sessionId);
  if (!session) return undefined;
  return saveChatSession(userId, {
    ...session,
    contextSummary: contextSummary.trim() || null,
    contextSummaryUpToMessageId,
  });
}

export async function updateDocumentContextFields(
  userId: string,
  documentId: string,
  fields: {
    writingContextSummary?: string | null;
    writingContextSummaryUpToMessageId?: string | null;
    documentContextSummary?: string | null;
  },
): Promise<Document | undefined> {
  const doc = await getDocument(userId, documentId);
  if (!doc) return undefined;
  return saveDocument(userId, { ...doc, ...fields });
}

export async function updateChatSessionTitle(
  userId: string,
  sessionId: string,
  title: string,
): Promise<ChatSession | undefined> {
  const session = await getChatSession(userId, sessionId);
  if (!session) return undefined;
  const cleaned = title.trim().replace(/\s+/g, ' ').slice(0, 32);
  if (!cleaned) return session;
  return saveChatSession(userId, { ...session, title: cleaned });
}

export async function getChatMessages(
  userId: string,
  sessionId: string,
): Promise<ChatMessage[]> {
  if (!(await ownsSession(userId, sessionId))) return [];
  const { rows } = await getPool().query(
    `SELECT payload FROM private_chat_messages
     WHERE session_id = $1 AND owner_id = $2
     ORDER BY created_at`,
    [sessionId, userId],
  );
  return rows.map((r) => r.payload as ChatMessage);
}

export async function addChatMessage(
  userId: string,
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
  opts?: { llmInvoke?: ChatMessage['llmInvoke']; llmReply?: ChatMessage['llmReply'] },
): Promise<ChatMessage | undefined> {
  const session = await getChatSession(userId, sessionId);
  if (!session) return undefined;
  const msg: ChatMessage = {
    id: randomUUID(),
    sessionId,
    role,
    content,
    llmInvoke: opts?.llmInvoke ?? null,
    llmReply: opts?.llmReply ?? null,
    createdAt: now(),
  };
  await getPool().query(
    `INSERT INTO private_chat_messages (id, session_id, owner_id, payload, created_at)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [msg.id, sessionId, userId, JSON.stringify(msg), msg.createdAt],
  );
  await saveChatSession(userId, session);
  return msg;
}

// --- Writing assistant ---

export async function getChatMessage(
  userId: string,
  sessionId: string,
  messageId: string,
): Promise<ChatMessage | undefined> {
  const list = await getChatMessages(userId, sessionId);
  return list.find((m) => m.id === messageId);
}

export async function updateChatMessage(
  userId: string,
  sessionId: string,
  messageId: string,
  patch: Partial<ChatMessage>,
): Promise<ChatMessage | undefined> {
  if (!(await ownsSession(userId, sessionId))) return undefined;
  const list = await getChatMessages(userId, sessionId);
  const idx = list.findIndex((m) => m.id === messageId);
  if (idx < 0) return undefined;
  const updated = { ...list[idx], ...patch };
  await getPool().query(
    `UPDATE private_chat_messages SET payload = $4::jsonb
     WHERE id = $1 AND session_id = $2 AND owner_id = $3`,
    [messageId, sessionId, userId, JSON.stringify(updated)],
  );
  return updated;
}

export async function getWritingAssistantMessages(
  userId: string,
  documentId: string,
): Promise<WritingAssistantMessage[]> {
  if (!(await ownsDocument(userId, documentId))) return [];
  const { rows } = await getPool().query(
    `SELECT payload FROM writing_assistant_messages
     WHERE document_id = $1 AND owner_id = $2
     ORDER BY created_at`,
    [documentId, userId],
  );
  return rows.map((r) => r.payload as WritingAssistantMessage);
}

export async function addWritingAssistantMessage(
  userId: string,
  input: Omit<WritingAssistantMessage, 'id' | 'createdAt'>,
): Promise<WritingAssistantMessage | undefined> {
  if (!(await ownsDocument(userId, input.documentId))) return undefined;
  const msg: WritingAssistantMessage = {
    ...input,
    id: randomUUID(),
    createdAt: now(),
  };
  await getPool().query(
    `INSERT INTO writing_assistant_messages (id, document_id, owner_id, payload, created_at)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [msg.id, input.documentId, userId, JSON.stringify(msg), msg.createdAt],
  );
  return msg;
}

export async function updateWritingAssistantMessage(
  userId: string,
  documentId: string,
  messageId: string,
  patch: Partial<WritingAssistantMessage>,
): Promise<WritingAssistantMessage | undefined> {
  const list = await getWritingAssistantMessages(userId, documentId);
  const idx = list.findIndex((m) => m.id === messageId);
  if (idx < 0) return undefined;
  const updated = { ...list[idx], ...patch };
  await getPool().query(
    `UPDATE writing_assistant_messages SET payload = $4::jsonb
     WHERE id = $1 AND document_id = $2 AND owner_id = $3`,
    [messageId, documentId, userId, JSON.stringify(updated)],
  );
  return updated;
}

export async function getWritingAssistantMessage(
  userId: string,
  documentId: string,
  messageId: string,
): Promise<WritingAssistantMessage | undefined> {
  const list = await getWritingAssistantMessages(userId, documentId);
  return list.find((m) => m.id === messageId);
}

export async function ensureWritingAssistantWelcome(
  userId: string,
  documentId: string,
  welcomeText: string,
): Promise<void> {
  const list = await getWritingAssistantMessages(userId, documentId);
  if (list.length > 0) return;
  await addWritingAssistantMessage(userId, {
    documentId,
    role: 'assistant',
    content: welcomeText,
    kind: 'chat',
  });
}

export function findBlock(
  doc: Document,
  blockId: string,
): { chapter: Document['chapters'][0]; block: Document['chapters'][0]['blocks'][0] } | undefined {
  for (const chapter of doc.chapters) {
    const block = chapter.blocks.find((b) => b.id === blockId);
    if (block) return { chapter, block };
  }
  return undefined;
}

const SEED_WRITING_CHAPTERS: Array<{
  type: string;
  index: string;
  note: string;
  content: string;
}> = [
  {
    type: '会议记录',
    index: '1',
    note: '产品周会',
    content: '讨论了写文章二级页：左侧类型、右侧编号与正文预览。决定去掉顶部标题切换。',
  },
  {
    type: '会议记录',
    index: '2',
    note: '',
    content: '行动项：更新测试数据；真机走一遍新建段落流程。',
  },
  {
    type: '日记',
    index: '1',
    note: '',
    content: '晴。把旧稿里「段、章、节」改成了更顺手的几类，写起来心里轻了些。',
  },
  {
    type: '笔记',
    index: '1',
    note: '灵感',
    content: '买菜式 UI：左栏选类型，右栏看编号和开头几句，点进去再写全文。',
  },
  {
    type: '随便写写',
    index: '1',
    note: '',
    content: '河边柳树发芽了，风一吹，枝条扫过水面，像谁在写字。',
  },
  {
    type: '记事本',
    index: '1',
    note: '购书',
    content: '《七日简史》——扉页上写着：记录不必工整，但要诚实。',
  },
  {
    type: '待办事项',
    index: '1',
    note: '',
    content: '□ 改种子数据\n□ 检查左侧六类是否齐全\n□ 给奶奶打电话',
  },
];

export async function seedDemoForUser(userId: string): Promise<void> {
  const docs = await listDocuments(userId);
  if (docs.length > 0) return;

  let doc = await createDocument(userId, '我的文稿');
  const [first, ...rest] = SEED_WRITING_CHAPTERS;
  if (!first) return;

  const firstChapter = doc.chapters[0];
  const firstBlock = firstChapter?.blocks[0];
  if (firstChapter && firstBlock) {
    const chapters = doc.chapters.map((ch, i) =>
      i === 0 ? { ...ch, title: buildChapterTitle(first) } : ch,
    );
    doc = (await saveDocument(userId, { ...doc, chapters }))!;
    await saveDocumentContent(userId, doc.id, firstChapter.id, firstBlock.id, first.content);
  }

  for (const sample of rest) {
    const title = buildChapterTitle(sample);
    const next = await addChapter(userId, doc.id, title);
    if (!next) break;
    doc = next;
    const chapter = doc.chapters.find((c) => c.title === title);
    const block = chapter?.blocks[0];
    if (chapter && block) {
      await saveDocumentContent(userId, doc.id, chapter.id, block.id, sample.content);
    }
  }
}
