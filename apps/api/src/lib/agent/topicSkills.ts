import { randomUUID } from 'crypto';
import { getPool } from '../../db/client.js';

export type TopicSkillScope = 'topic' | 'user' | 'group';

export type TopicSkill = {
  id: string;
  scope: TopicSkillScope;
  ownerId: string | null;
  groupId: string | null;
  topicId: string | null;
  title: string;
  content: string;
  enabled: boolean;
  updatedByUserId: string;
  updatedAt: Date;
};

const COLS = `id, scope, owner_id, group_id, topic_id, title, content,
  enabled, updated_by_user_id, updated_at`;

function parseRow(row: Record<string, unknown>): TopicSkill {
  return {
    id: row.id as string,
    scope: row.scope as TopicSkillScope,
    ownerId: (row.owner_id as string | null) ?? null,
    groupId: (row.group_id as string | null) ?? null,
    topicId: (row.topic_id as string | null) ?? null,
    title: row.title as string,
    content: row.content as string,
    enabled: row.enabled as boolean,
    updatedByUserId: row.updated_by_user_id as string,
    updatedAt: row.updated_at as Date,
  };
}

export type UpsertSkillInput = {
  id?: string;
  scope: TopicSkillScope;
  ownerId: string | null;
  groupId: string | null;
  topicId: string | null;
  title: string;
  content: string;
  enabled: boolean;
  updatedByUserId: string;
};

export async function upsertSkill(input: UpsertSkillInput): Promise<TopicSkill> {
  const id = input.id ?? randomUUID();
  const { rows } = await getPool().query(
    `INSERT INTO topic_skills (id, scope, owner_id, group_id, topic_id,
       title, content, enabled, updated_by_user_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       content = EXCLUDED.content,
       enabled = EXCLUDED.enabled,
       updated_by_user_id = EXCLUDED.updated_by_user_id,
       updated_at = now()
     RETURNING ${COLS}`,
    [
      id,
      input.scope,
      input.ownerId,
      input.groupId,
      input.topicId,
      input.title,
      input.content,
      input.enabled,
      input.updatedByUserId,
    ],
  );
  return parseRow(rows[0]);
}

export async function getSkill(id: string): Promise<TopicSkill | null> {
  const { rows } = await getPool().query(
    `SELECT ${COLS} FROM topic_skills WHERE id = $1`,
    [id],
  );
  return rows[0] ? parseRow(rows[0]) : null;
}

export async function deleteSkill(id: string, byUserId: string): Promise<void> {
  // M1b 简化：谁创建 / 谁修改的可以删
  await getPool().query(
    `DELETE FROM topic_skills WHERE id = $1 AND (updated_by_user_id = $2 OR owner_id = $2)`,
    [id, byUserId],
  );
}

export async function listOwnSkills(userId: string): Promise<TopicSkill[]> {
  const { rows } = await getPool().query(
    `SELECT ${COLS} FROM topic_skills
     WHERE owner_id = $1 OR updated_by_user_id = $1
     ORDER BY updated_at DESC`,
    [userId],
  );
  return rows.map(parseRow);
}

/**
 * 列 agent run 应当应用的所有 skills：
 * - user-scope：owner_id = userId
 * - group-scope：group_id = groupId（不限 owner）
 * - topic-scope：topic_id = topicId（不限 owner）
 * 全部仅返回 enabled=true。
 */
export async function listForAgent(params: {
  userId: string;
  groupId?: string;
  topicId?: string;
}): Promise<TopicSkill[]> {
  const ors: string[] = [];
  const values: unknown[] = [];

  values.push(params.userId);
  ors.push(`(scope = 'user' AND owner_id = $${values.length})`);

  if (params.groupId) {
    values.push(params.groupId);
    ors.push(`(scope = 'group' AND group_id = $${values.length})`);
  }
  if (params.topicId) {
    values.push(params.topicId);
    ors.push(`(scope = 'topic' AND topic_id = $${values.length})`);
  }

  const { rows } = await getPool().query(
    `SELECT ${COLS} FROM topic_skills
     WHERE enabled = TRUE AND (${ors.join(' OR ')})
     ORDER BY updated_at DESC`,
    values,
  );
  return rows.map(parseRow);
}
