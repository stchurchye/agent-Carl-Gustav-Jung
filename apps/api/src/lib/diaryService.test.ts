import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('./diaryGenerate.js', () => ({ generateDiarySummary: vi.fn(), refineDiarySummary: vi.fn() }));

import { randomUUID } from 'crypto';
import { describeDb } from '../testUtils/dbGuard.js';
import { getPool } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { createUser, createChatSession } from '../store/pg.js';
import { getDiaryEntry, setDiaryStatus, upsertDiaryEntry } from '../store/pg-diary.js';
import { hashPassword } from './auth.js';
import { ensureGroup } from './agent/__tests__/_groupFixture.js';
import { generateDiarySummary, refineDiarySummary } from './diaryGenerate.js';
import { generateDiaryForDay, refineDiaryForDay } from './diaryService.js';

const mockGen = generateDiarySummary as unknown as ReturnType<typeof vi.fn>;
const mockRefine = refineDiarySummary as unknown as ReturnType<typeof vi.fn>;

const DAY = '2026-06-20';
const DAY_START = '2026-06-20T00:00:00.000Z';
const DAY_END = '2026-06-21T00:00:00.000Z';

async function mkUser(name: string) {
  return createUser({
    username: name + '-' + randomUUID().slice(0, 8),
    passwordHash: await hashPassword('xxxxxxxx'),
    displayName: name,
  });
}

async function insertPrivateMsg(
  sessionId: string,
  ownerId: string,
  role: 'user' | 'assistant',
  content: string,
  createdAt: string,
) {
  const id = randomUUID();
  await getPool().query(
    `INSERT INTO private_chat_messages (id, session_id, owner_id, payload, created_at)
     VALUES ($1,$2,$3,$4::jsonb,$5)`,
    [id, sessionId, ownerId, JSON.stringify({ id, sessionId, role, content, createdAt }), createdAt],
  );
}

describeDb('diaryService.generateDiaryForDay', { timeout: 20000 }, () => {
  beforeAll(async () => {
    await runMigrations();
  });
  beforeEach(async () => {
    await getPool().query('DELETE FROM diary_entries');
    mockGen.mockReset();
    mockGen.mockResolvedValue('汪!今天的小结。');
    mockRefine.mockReset();
    mockRefine.mockResolvedValue('汪!改好了的小结。');
  });

  it('self:取当日私聊 → 喂 transcript → upsert draft', async () => {
    const u = await mkUser('ds');
    const s = await createChatSession(u.id, 's');
    await insertPrivateMsg(s.id, u.id, 'user', '今天好累', '2026-06-20T03:00:00.000Z');
    await insertPrivateMsg(s.id, u.id, 'assistant', '抱抱主人', '2026-06-20T03:01:00.000Z');
    await insertPrivateMsg(s.id, u.id, 'user', '前一天的话', '2026-06-19T03:00:00.000Z'); // 窗外

    const entry = await generateDiaryForDay({
      userId: u.id, scope: 'self', scopeId: '', dayKey: DAY,
      dayStartIso: DAY_START, dayEndIso: DAY_END, apiKey: 'k',
    });
    expect(entry?.summary).toBe('汪!今天的小结。');
    expect(entry?.status).toBe('draft');
    expect(entry?.sourceCount).toBe(2);
    const transcript = mockGen.mock.calls[0][0].transcript as string;
    expect(transcript).toContain('今天好累');
    expect(transcript).not.toContain('前一天的话');
    expect((await getDiaryEntry(u.id, 'self', '', DAY))?.summary).toBe('汪!今天的小结。');
  });

  it('已 confirmed 的篇不重生成,原样返回,不调 LLM', async () => {
    const u = await mkUser('dc');
    await upsertDiaryEntry(u.id, { scope: 'self', scopeId: '', dayKey: DAY, summary: '定稿正文' });
    await setDiaryStatus(u.id, 'self', '', DAY, 'confirmed');
    const entry = await generateDiaryForDay({
      userId: u.id, scope: 'self', scopeId: '', dayKey: DAY,
      dayStartIso: DAY_START, dayEndIso: DAY_END, apiKey: 'k',
    });
    expect(entry?.status).toBe('confirmed');
    expect(entry?.summary).toBe('定稿正文');
    expect(mockGen).not.toHaveBeenCalled();
  });

  it('group:非成员返回 null,不调 LLM', async () => {
    const owner = await mkUser('go');
    const { groupId } = await ensureGroup(owner.id);
    const stranger = await mkUser('st');
    const entry = await generateDiaryForDay({
      userId: stranger.id, scope: 'group', scopeId: groupId, dayKey: DAY,
      dayStartIso: DAY_START, dayEndIso: DAY_END, apiKey: 'k',
    });
    expect(entry).toBeNull();
    expect(mockGen).not.toHaveBeenCalled();
  });

  it('group 成员:带群名快照落库,sourceCount 计数', async () => {
    const owner = await mkUser('go2');
    const { groupId, topicId } = await ensureGroup(owner.id);
    await getPool().query(
      `INSERT INTO group_messages (id,group_id,topic_id,author_id,kind,payload,created_at)
       VALUES ($1,$2,$3,$4,'human',$5::jsonb,$6)`,
      [randomUUID(), groupId, topicId, owner.id, JSON.stringify({ content: '今天聊了书', contentMode: 'text', llmExclude: null }), '2026-06-20T05:00:00.000Z'],
    );
    const entry = await generateDiaryForDay({
      userId: owner.id, scope: 'group', scopeId: groupId, dayKey: DAY,
      dayStartIso: DAY_START, dayEndIso: DAY_END, apiKey: 'k',
    });
    expect(entry?.scope).toBe('group');
    expect(entry?.scopeName).toBeTruthy();
    expect(entry?.sourceCount).toBe(1);
  });

  it('refine:改写正文并回 draft(即便原先已 confirmed)', async () => {
    const u = await mkUser('dr');
    await upsertDiaryEntry(u.id, { scope: 'self', scopeId: '', dayKey: DAY, summary: '原始正文' });
    await setDiaryStatus(u.id, 'self', '', DAY, 'confirmed');
    const entry = await refineDiaryForDay({
      userId: u.id, scope: 'self', scopeId: '', dayKey: DAY,
      instruction: '写温暖点', apiKey: 'k',
    });
    expect(entry?.summary).toBe('汪!改好了的小结。');
    expect(entry?.status).toBe('draft'); // 内容变了,回 draft 待重新确认
    expect(mockRefine).toHaveBeenCalledTimes(1);
  });

  it('refine:篇不存在 → null,不调 LLM', async () => {
    const u = await mkUser('dr2');
    const entry = await refineDiaryForDay({
      userId: u.id, scope: 'self', scopeId: '', dayKey: DAY,
      instruction: '改改', apiKey: 'k',
    });
    expect(entry).toBeNull();
    expect(mockRefine).not.toHaveBeenCalled();
  });

  it('refine 已蒸馏的篇:回 draft 且清掉 distilled_at(防与记忆背离)', async () => {
    const u = await mkUser('drd');
    await upsertDiaryEntry(u.id, { scope: 'self', scopeId: '', dayKey: DAY, summary: '蒸馏过的正文' });
    await setDiaryStatus(u.id, 'self', '', DAY, 'distilled', { distilledAt: '2026-06-20T12:00:00.000Z' });
    await refineDiaryForDay({
      userId: u.id, scope: 'self', scopeId: '', dayKey: DAY, instruction: '改改', apiKey: 'k',
    });
    const { rows } = await getPool().query(
      `SELECT status, distilled_at FROM diary_entries WHERE owner_id=$1 AND scope='self' AND scope_id='' AND day_key=$2`,
      [u.id, DAY],
    );
    expect(rows[0].status).toBe('draft');
    expect(rows[0].distilled_at).toBeNull();
  });

  it('refine 空意见 → 原样返回,不改状态、不调 LLM', async () => {
    const u = await mkUser('dre');
    await upsertDiaryEntry(u.id, { scope: 'self', scopeId: '', dayKey: DAY, summary: '原文' });
    await setDiaryStatus(u.id, 'self', '', DAY, 'confirmed');
    const entry = await refineDiaryForDay({
      userId: u.id, scope: 'self', scopeId: '', dayKey: DAY, instruction: '   ', apiKey: 'k',
    });
    expect(entry?.status).toBe('confirmed'); // 未被打回 draft
    expect(entry?.summary).toBe('原文');
    expect(mockRefine).not.toHaveBeenCalled();
  });
});
