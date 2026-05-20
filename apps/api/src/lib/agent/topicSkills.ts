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

/**
 * M1d Task 7：prompt-injection 防御。topic skill 会被注入到 agent system
 * prompt 里（snapshotForAgent / planner），所以任何看起来像"override
 * instructions"、"忽略上面"、"reveal API key" 的 pattern 都要拒掉。
 *
 * 这是 defense-in-depth：planner system prompt 自己也带 anti-jailbreak
 * 段落；但 skill 是 *持久化* 的危险源，宁可在写入时拦截。
 *
 * 触发即抛 SkillValidationError，上层路由把它映射成 400 + 可读消息。
 */
export class SkillValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillValidationError';
  }
}

const SUSPICIOUS_PATTERNS: { re: RegExp; reason: string }[] = [
  // 中英文 "忽略上面 / 忘掉之前 / 不要听 system / disregard prior"
  { re: /忽略(以上|上面|之前|前面|系统)|忘[掉记]/i, reason: 'IGNORE_INSTRUCTIONS_ZH' },
  { re: /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions|prompt|messages)/i, reason: 'IGNORE_INSTRUCTIONS_EN' },
  { re: /disregard\s+(all\s+)?(prior|previous|above|system)/i, reason: 'DISREGARD_EN' },
  { re: /system\s*[:：]/i, reason: 'INJECT_SYSTEM_ROLE' },
  // 让 LLM 角色互换 / 拒绝过滤
  { re: /(扮演|装作|你现在是).{0,12}(管理员|开发者|无审查|jailbreak)/i, reason: 'ROLE_OVERRIDE_ZH' },
  { re: /you\s+are\s+now\s+(?:an?\s+)?(?:dan|jailbroken|uncensored|developer\s+mode)/i, reason: 'ROLE_OVERRIDE_EN' },
  // 直接索要敏感字段
  { re: /(api[_\- ]?key|deepseek\s*key|access[_\- ]?token|secret)/i, reason: 'SECRET_DISCLOSURE' },
  // 强制执行任意工具（特别是 magi_content_ingest / doc_export 这种有副作用的）
  { re: /(必须|一定要|always|must)\s*(执行|调用|call|invoke|run).{0,20}(magi_content_ingest|doc_export|tool)/i, reason: 'FORCE_TOOL_CALL' },
];

const MAX_TITLE_LEN = 80;
const MAX_CONTENT_LEN = 2000;

/**
 * 公开导出：路由 / 测试可单独验证 input。返回错误数组（空数组即通过）。
 */
export function validateSkillInput(input: { title: string; content: string }): { reason: string; field: 'title' | 'content' }[] {
  const errors: { reason: string; field: 'title' | 'content' }[] = [];
  const title = input.title ?? '';
  const content = input.content ?? '';
  if (title.trim().length === 0) errors.push({ reason: 'EMPTY_TITLE', field: 'title' });
  if (title.length > MAX_TITLE_LEN) errors.push({ reason: 'TITLE_TOO_LONG', field: 'title' });
  if (content.length > MAX_CONTENT_LEN) errors.push({ reason: 'CONTENT_TOO_LONG', field: 'content' });
  for (const { re, reason } of SUSPICIOUS_PATTERNS) {
    if (re.test(title)) errors.push({ reason, field: 'title' });
    if (re.test(content)) errors.push({ reason, field: 'content' });
  }
  return errors;
}

export async function upsertSkill(input: UpsertSkillInput): Promise<TopicSkill> {
  const errs = validateSkillInput(input);
  if (errs.length > 0) {
    throw new SkillValidationError(
      `topic skill rejected: ${errs.map((e) => `${e.field}:${e.reason}`).join(', ')}`,
    );
  }
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
