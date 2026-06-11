import { expect, it, beforeAll } from 'vitest';
import { describeDb } from '../../testUtils/dbGuard.js';
import { runMigrations } from '../../db/migrate.js';
import { executeIntent } from '../intentExecute.js';
import { ensureUser } from '../agent/__tests__/_groupFixture.js';
import { getPersonaSettings } from '../../store/pg-profile.js';
import { createChatSession, getChatMessages } from '../../store/pg.js';

describeDb('executeIntent: persona_rename', () => {
  beforeAll(async () => await runMigrations());

  async function exec(
    userId: string,
    sessionId: string | undefined,
    text: string,
    slots: { renameTarget: 'assistant' | 'user'; renameName: string },
  ) {
    return executeIntent({
      userId,
      text,
      kind: 'persona_rename',
      channel: 'private',
      sessionId,
      slots,
      apiKey: '',
    });
  }

  it('给狗改名:persona.identity.assistantName 落库,确认消息入会话,带回 personaUpdated', async () => {
    const user = await ensureUser('rn-a');
    const session = await createChatSession(user.id, '和小助手聊聊');
    const res = await exec(user.id, session.id, '你以后就叫旺财', {
      renameTarget: 'assistant',
      renameName: '旺财',
    });
    expect(res.type).toBe('tool');
    if (res.type !== 'tool') return;
    expect(res.confirmation).toContain('旺财');
    expect(res.personaUpdated?.identity?.assistantName).toBe('旺财');

    const persona = await getPersonaSettings(user.id);
    expect(persona.identity?.assistantName).toBe('旺财');

    const msgs = await getChatMessages(user.id, session.id);
    expect(msgs[msgs.length - 2]?.content).toBe('你以后就叫旺财');
    expect(msgs[msgs.length - 1]?.role).toBe('assistant');
    expect(msgs[msgs.length - 1]?.content).toContain('旺财');
  });

  it('改我的称呼:persona.user.preferredName 落库', async () => {
    const user = await ensureUser('rn-b');
    const session = await createChatSession(user.id, 't');
    const res = await exec(user.id, session.id, '以后叫我老王', {
      renameTarget: 'user',
      renameName: '老王',
    });
    expect(res.type).toBe('tool');
    const persona = await getPersonaSettings(user.id);
    expect(persona.user?.preferredName).toBe('老王');
  });

  it('超长名字截断到 20 字', async () => {
    const user = await ensureUser('rn-c');
    const session = await createChatSession(user.id, 't');
    await exec(user.id, session.id, 'x', {
      renameTarget: 'assistant',
      renameName: '汪'.repeat(30),
    });
    const persona = await getPersonaSettings(user.id);
    expect(persona.identity?.assistantName?.length).toBeLessThanOrEqual(20);
  });

  it('缺 sessionId → skipped,不落任何东西', async () => {
    const user = await ensureUser('rn-d');
    const res = await exec(user.id, undefined, 'x', {
      renameTarget: 'assistant',
      renameName: '旺财',
    });
    expect(res.type).toBe('skipped');
  });
});
