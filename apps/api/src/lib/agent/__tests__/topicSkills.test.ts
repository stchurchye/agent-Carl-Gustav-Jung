import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import * as topicSkills from '../topicSkills.js';
import { ensureUser, ensureGroup } from './_groupFixture.js';
import { createTopic } from '../../../store/pg-social.js';

describe('topicSkills CRUD', () => {
  beforeAll(async () => await runMigrations());
  beforeEach(async () => {
    await getPool().query('DELETE FROM topic_skills');
  });

  it('creates user-scope skill', async () => {
    const u = await ensureUser('ts1');
    const s = await topicSkills.upsertSkill({
      scope: 'user',
      ownerId: u.id,
      groupId: null,
      topicId: null,
      title: '我喜欢公正客观',
      content: '回答时少用表情',
      enabled: true,
      updatedByUserId: u.id,
    });
    expect(s.id).toBeDefined();
    expect(s.scope).toBe('user');
  });

  it('listForAgent merges user + group + topic scopes', async () => {
    const u = await ensureUser('ts2');
    const { groupId, topicId } = await ensureGroup(u.id);
    await topicSkills.upsertSkill({
      scope: 'user',
      ownerId: u.id,
      groupId: null,
      topicId: null,
      title: 'user-rule',
      content: 'A',
      enabled: true,
      updatedByUserId: u.id,
    });
    await topicSkills.upsertSkill({
      scope: 'group',
      ownerId: u.id,
      groupId,
      topicId: null,
      title: 'group-rule',
      content: 'B',
      enabled: true,
      updatedByUserId: u.id,
    });
    await topicSkills.upsertSkill({
      scope: 'topic',
      ownerId: u.id,
      groupId,
      topicId,
      title: 'topic-rule',
      content: 'C',
      enabled: true,
      updatedByUserId: u.id,
    });

    const skills = await topicSkills.listForAgent({
      userId: u.id,
      groupId,
      topicId,
    });
    const titles = skills.map((s) => s.title);
    expect(titles).toEqual(
      expect.arrayContaining(['user-rule', 'group-rule', 'topic-rule']),
    );
    expect(skills.every((s) => s.enabled)).toBe(true);
  });

  it('disabled skill not returned by listForAgent', async () => {
    const u = await ensureUser('ts3');
    await topicSkills.upsertSkill({
      scope: 'user',
      ownerId: u.id,
      groupId: null,
      topicId: null,
      title: 'off',
      content: 'x',
      enabled: false,
      updatedByUserId: u.id,
    });
    const skills = await topicSkills.listForAgent({ userId: u.id });
    expect(skills.length).toBe(0);
  });

  it('delete removes the skill', async () => {
    const u = await ensureUser('ts4');
    const s = await topicSkills.upsertSkill({
      scope: 'user',
      ownerId: u.id,
      groupId: null,
      topicId: null,
      title: 'rm',
      content: 'x',
      enabled: true,
      updatedByUserId: u.id,
    });
    await topicSkills.deleteSkill(s.id, u.id);
    const skills = await topicSkills.listForAgent({ userId: u.id });
    expect(skills.find((x) => x.id === s.id)).toBeUndefined();
  });

  it('T13: topic-scope skills are isolated across topics', async () => {
    const u = await ensureUser('ts-iso');
    const { groupId, topicId: tA } = await ensureGroup(u.id, 'topic-A');
    const topicB = await createTopic(u.id, groupId, 'topic-B');
    if (!topicB) throw new Error('failed to create topic-B');
    const tB = topicB.id;

    await topicSkills.upsertSkill({
      scope: 'topic',
      ownerId: u.id,
      groupId,
      topicId: tA,
      title: 'A-only',
      content: 'A-rule',
      enabled: true,
      updatedByUserId: u.id,
    });

    const listB = await topicSkills.listForAgent({
      userId: u.id,
      groupId,
      topicId: tB,
    });
    expect(listB.find((x) => x.title === 'A-only')).toBeUndefined();

    const listA = await topicSkills.listForAgent({
      userId: u.id,
      groupId,
      topicId: tA,
    });
    expect(listA.find((x) => x.title === 'A-only')).toBeDefined();
  });

  it('upsert with same id updates fields', async () => {
    const u = await ensureUser('ts-upsert');
    const id = randomUUID();
    await topicSkills.upsertSkill({
      id,
      scope: 'user',
      ownerId: u.id,
      groupId: null,
      topicId: null,
      title: 'v1',
      content: 'A',
      enabled: true,
      updatedByUserId: u.id,
    });
    await topicSkills.upsertSkill({
      id,
      scope: 'user',
      ownerId: u.id,
      groupId: null,
      topicId: null,
      title: 'v2',
      content: 'B',
      enabled: false,
      updatedByUserId: u.id,
    });
    const s = await topicSkills.getSkill(id);
    expect(s?.title).toBe('v2');
    expect(s?.content).toBe('B');
    expect(s?.enabled).toBe(false);
  });
});
