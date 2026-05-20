import { randomUUID } from 'crypto';
import { getPool } from '../../../db/client.js';
import { createUser, createGroup } from '../../../store/pg.js';
import { createTopic } from '../../../store/pg-social.js';
import { hashPassword } from '../../auth.js';

/**
 * 共享测试 fixture：避免 messageBridge.group / contextAdapter.group / runtime.group / topicSkills
 * 多文件重复 ensureGroup 代码。
 */
export async function ensureUser(displayName: string) {
  return createUser({
    username: displayName + '-' + randomUUID().slice(0, 6),
    passwordHash: await hashPassword('xxxxxxxx'),
    displayName,
  });
}

export async function ensureGroup(
  ownerId: string,
  topicTitle = 'topic-1',
): Promise<{ groupId: string; topicId: string }> {
  const group = await createGroup(ownerId, 'tg-' + randomUUID().slice(0, 4));
  const topic = await createTopic(ownerId, group.id, topicTitle);
  if (!topic) throw new Error('failed to create topic');
  return { groupId: group.id, topicId: topic.id };
}

export async function addMember(
  groupId: string,
  userId: string,
  role: 'owner' | 'admin' | 'member' = 'member',
): Promise<void> {
  await getPool().query(
    `INSERT INTO group_members (group_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [groupId, userId, role],
  );
}
