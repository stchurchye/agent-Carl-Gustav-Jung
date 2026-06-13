import { expect, it, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { describeDb } from '../testUtils/dbGuard.js';
import { getPool } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { createUser, createChatSession, getPrivateMessagesForDay } from './pg.js';
import { getGroupMessagesForDay } from './pg-social.js';
import { upsertDiaryEntry, getDiaryEntry, listDiaryEntries, setDiaryStatus } from './pg-diary.js';
import { hashPassword } from '../lib/auth.js';
import { ensureGroup } from '../lib/agent/__tests__/_groupFixture.js';

async function mkUser(name: string) {
  return createUser({
    username: name + '-' + randomUUID().slice(0, 8),
    passwordHash: await hashPassword('xxxxxxxx'),
    displayName: name,
  });
}

const DAY = '2026-06-13';
const DAY_START = '2026-06-13T00:00:00.000Z';
const DAY_END = '2026-06-14T00:00:00.000Z';

async function insertPrivateMsg(
  sessionId: string,
  ownerId: string,
  content: string,
  createdAt: string,
  opts?: { llmExclude?: unknown },
) {
  const id = randomUUID();
  const payload = { id, sessionId, role: 'user', content, createdAt, llmExclude: opts?.llmExclude ?? null };
  await getPool().query(
    `INSERT INTO private_chat_messages (id, session_id, owner_id, payload, created_at)
     VALUES ($1,$2,$3,$4::jsonb,$5)`,
    [id, sessionId, ownerId, JSON.stringify(payload), createdAt],
  );
  return id;
}

const EXCLUDE_ACTIVE = { active: true, markers: [], everCanceled: false };
const EXCLUDE_CANCELED = { active: false, markers: [], canceledBy: null, everCanceled: true };

async function insertGroupMsg(
  groupId: string,
  topicId: string,
  authorId: string,
  content: string,
  createdAt: string,
  opts?: { llmExclude?: unknown; kind?: string },
) {
  const id = randomUUID();
  const payload = { content, contentMode: 'text', llmExclude: opts?.llmExclude ?? null };
  await getPool().query(
    `INSERT INTO group_messages (id, group_id, topic_id, author_id, kind, payload, created_at)
     VALUES ($1,$2,$3,$4,$7,$5::jsonb,$6)`,
    [id, groupId, topicId, authorId, JSON.stringify(payload), createdAt, opts?.kind ?? 'human'],
  );
  return id;
}

describeDb('pg-diary store', { timeout: 20000 }, () => {
  beforeAll(async () => {
    await runMigrations();
  });
  beforeEach(async () => {
    await getPool().query('DELETE FROM diary_entries');
  });

  // ---------- diary CRUD ----------
  it('upsert + get:写入并取回一篇个人日记', async () => {
    const u = await mkUser('d1');
    const e = await upsertDiaryEntry(u.id, { scope: 'self', scopeId: '', dayKey: DAY, summary: '今天聊了读书', sourceCount: 3 });
    expect(e.scope).toBe('self');
    expect(e.status).toBe('draft');
    expect(e.sourceCount).toBe(3);
    const got = await getDiaryEntry(u.id, 'self', '', DAY);
    expect(got?.summary).toBe('今天聊了读书');
  });

  it('upsert 幂等:同 (owner,scope,scope_id,day_key) 更新而非新增', async () => {
    const u = await mkUser('d2');
    await upsertDiaryEntry(u.id, { scope: 'self', scopeId: '', dayKey: DAY, summary: 'v1' });
    await upsertDiaryEntry(u.id, { scope: 'self', scopeId: '', dayKey: DAY, summary: 'v2', sourceCount: 5 });
    const list = await listDiaryEntries(u.id, { scope: 'self' });
    expect(list).toHaveLength(1);
    expect(list[0].summary).toBe('v2');
    expect(list[0].sourceCount).toBe(5);
  });

  it('个人篇与群篇同一天并存(scope 区分)', async () => {
    const u = await mkUser('d3');
    await upsertDiaryEntry(u.id, { scope: 'self', scopeId: '', dayKey: DAY, summary: 'self' });
    await upsertDiaryEntry(u.id, { scope: 'group', scopeId: 'g123', scopeName: '读书会', dayKey: DAY, summary: 'group' });
    expect(await listDiaryEntries(u.id)).toHaveLength(2);
    const grp = await listDiaryEntries(u.id, { scope: 'group', scopeId: 'g123' });
    expect(grp).toHaveLength(1);
    expect(grp[0].scopeName).toBe('读书会');
  });

  it('listDiaryEntries 按 day_key 倒序', async () => {
    const u = await mkUser('d4');
    await upsertDiaryEntry(u.id, { scope: 'self', scopeId: '', dayKey: '2026-06-11', summary: 'a' });
    await upsertDiaryEntry(u.id, { scope: 'self', scopeId: '', dayKey: '2026-06-13', summary: 'c' });
    await upsertDiaryEntry(u.id, { scope: 'self', scopeId: '', dayKey: '2026-06-12', summary: 'b' });
    const list = await listDiaryEntries(u.id);
    expect(list.map((e) => e.dayKey)).toEqual(['2026-06-13', '2026-06-12', '2026-06-11']);
  });

  it('setDiaryStatus 改状态 + 打 distilledAt', async () => {
    const u = await mkUser('d5');
    await upsertDiaryEntry(u.id, { scope: 'self', scopeId: '', dayKey: DAY, summary: 's' });
    expect((await setDiaryStatus(u.id, 'self', '', DAY, 'confirmed'))?.status).toBe('confirmed');
    expect((await setDiaryStatus(u.id, 'self', '', DAY, 'distilled', { distilledAt: '2026-06-13T12:00:00.000Z' }))?.status).toBe('distilled');
  });

  it('日记按 owner 隔离', async () => {
    const a = await mkUser('da');
    const b = await mkUser('db');
    await upsertDiaryEntry(a.id, { scope: 'self', scopeId: '', dayKey: DAY, summary: 'A的' });
    expect(await getDiaryEntry(b.id, 'self', '', DAY)).toBeUndefined();
    expect(await listDiaryEntries(b.id)).toHaveLength(0);
  });

  // ---------- getPrivateMessagesForDay ----------
  it('getPrivateMessagesForDay 取 [start,end) 含下界、不含上界、按时间升序', async () => {
    const u = await mkUser('pm');
    const s = await createChatSession(u.id, 's');
    await insertPrivateMsg(s.id, u.id, '下界', DAY_START); // [start 含
    await insertPrivateMsg(s.id, u.id, '窗口内', '2026-06-13T20:00:00.000Z');
    await insertPrivateMsg(s.id, u.id, '前一天', '2026-06-12T23:59:59.000Z');
    await insertPrivateMsg(s.id, u.id, '上界', DAY_END); // end) 不含
    const msgs = await getPrivateMessagesForDay(u.id, DAY_START, DAY_END);
    expect(msgs.map((m) => m.content)).toEqual(['下界', '窗口内']);
  });

  it('getPrivateMessagesForDay 排除 llmExclude.active=true,取消排除(active=false)重新计入', async () => {
    const u = await mkUser('pmx');
    const s = await createChatSession(u.id, 's');
    await insertPrivateMsg(s.id, u.id, '正常', '2026-06-13T01:00:00.000Z');
    await insertPrivateMsg(s.id, u.id, '已排除', '2026-06-13T02:00:00.000Z', { llmExclude: EXCLUDE_ACTIVE });
    await insertPrivateMsg(s.id, u.id, '取消排除', '2026-06-13T03:00:00.000Z', { llmExclude: EXCLUDE_CANCELED });
    const msgs = await getPrivateMessagesForDay(u.id, DAY_START, DAY_END);
    expect(msgs.map((m) => m.content)).toEqual(['正常', '取消排除']);
  });

  // ---------- getGroupMessagesForDay ----------
  it('getGroupMessagesForDay:非成员 null;成员只取入群后/窗口内/未排除', async () => {
    const owner = await mkUser('go');
    const { groupId, topicId } = await ensureGroup(owner.id);
    const diarist = await mkUser('gd');
    await getPool().query(
      `INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES ($1,$2,'member',$3) ON CONFLICT DO NOTHING`,
      [groupId, diarist.id, '2026-06-13T08:00:00.000Z'],
    );
    await insertGroupMsg(groupId, topicId, owner.id, '入群前', '2026-06-13T07:00:00.000Z'); // < joined → 排除
    const inWin = await insertGroupMsg(groupId, topicId, owner.id, '入群后窗口内', '2026-06-13T10:00:00.000Z'); // 命中
    await insertGroupMsg(groupId, topicId, owner.id, '已排除', '2026-06-13T11:00:00.000Z', { llmExclude: EXCLUDE_ACTIVE }); // active=true → 排除
    const canceled = await insertGroupMsg(groupId, topicId, owner.id, '取消排除', '2026-06-13T11:30:00.000Z', { llmExclude: EXCLUDE_CANCELED }); // active=false → 计入
    await insertGroupMsg(groupId, topicId, owner.id, '某人加入了群聊', '2026-06-13T11:45:00.000Z', { kind: 'system' }); // system → 剔除
    await insertGroupMsg(groupId, topicId, owner.id, '前一天', '2026-06-12T10:00:00.000Z'); // 窗口外

    const stranger = await mkUser('gs');
    expect(await getGroupMessagesForDay(stranger.id, groupId, DAY_START, DAY_END)).toBeNull();

    const msgs = await getGroupMessagesForDay(diarist.id, groupId, DAY_START, DAY_END);
    expect(msgs?.map((m) => m.id)).toEqual([inWin, canceled]);
  });

  it('upsert 命中冲突保留既有 status(不把 confirmed 打回 draft)', async () => {
    const u = await mkUser('dst');
    await upsertDiaryEntry(u.id, { scope: 'self', scopeId: '', dayKey: DAY, summary: 'v1' });
    await setDiaryStatus(u.id, 'self', '', DAY, 'confirmed');
    // 重生成(默认 status=draft)不应覆盖 confirmed
    const re = await upsertDiaryEntry(u.id, { scope: 'self', scopeId: '', dayKey: DAY, summary: 'v2' });
    expect(re.status).toBe('confirmed');
    expect(re.summary).toBe('v2');
  });
});
