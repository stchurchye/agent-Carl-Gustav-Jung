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
  /** 023：手写技能为 null，自动蒸馏为 'auto_distilled'。UI 据此分组「建议技能」。 */
  source: string | null;
  /** 023：蒸馏来源 run id（手写为 null）。幂等去重 + 溯源。 */
  sourceRunId: string | null;
};

const COLS = `id, scope, owner_id, group_id, topic_id, title, content,
  enabled, updated_by_user_id, updated_at, source, source_run_id`;

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
    source: (row.source as string | null) ?? null,
    sourceRunId: (row.source_run_id as string | null) ?? null,
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
  /** 023：自动蒸馏的技能传 'auto_distilled'；手写路径(路由)不传，默认 null。 */
  source?: string | null;
  /** 023：蒸馏来源 run id；手写路径不传，默认 null。 */
  sourceRunId?: string | null;
};

/**
 * M1d Task 7 + M1e Task 5：prompt-injection 防御（high/low severity 分级）。
 *
 * 背景：M1d 实现的是 fail-closed，凡是命中 SUSPICIOUS_PATTERNS 一律 reject。Code-review
 * 反馈 false-positive 太多（例如 "记住客户的 API key 放 1Password"、"别忘记客户偏好"
 * 都被误杀），让用户根本写不进合法的 skill。
 *
 * M1e 改成两档：
 * - high：明显的 jailbreak 标志（role override、ignore previous instructions、inject
 *   system role 等）→ 仍然 reject 400
 * - low：仅关键词（如 "api[_- ]?key" / "secret"）→ warn-log 但不 reject，将来 task 10
 *   时由 `listForAgent` 二次过滤把含 high pattern 的 skill drop + emit notice。
 *
 * 收紧动作：
 * - 删 `/忘[掉记]/` 纯字符（误杀率太高）
 * - `IGNORE_INSTRUCTIONS_ZH` 加 "指令/要求/系统/提示" 名词限定
 *
 * 触发 high 即抛 SkillValidationError，上层路由把它映射成 400 + 可读消息。
 */
export class SkillValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillValidationError';
  }
}

export type SkillSeverity = 'high' | 'low';

const SUSPICIOUS_PATTERNS: { re: RegExp; reason: string; severity: SkillSeverity }[] = [
  // ===== HIGH severity：明显 jailbreak / role-override，必须 reject =====
  {
    // 中文 "忽略以上指令 / 忘掉前面的设定 / 忽略上面的人设"——加名词限定，不再裸匹配 "忘[掉记]"。
    // M1e review followup：补 规则/设定/人设/上下文/对话 等常见 jailbreak 用名词；同时允许动词与
    // 名词之间夹 ≤8 字符（覆盖 "前面的 / 以上所有 / 上面的"）。
    // 不放裸 "话"——会把 "忘记客户偏好这种话题" 之类合法句子误杀。
    re: /(忽略|忘[掉记]).{0,8}?(指令|要求|系统|提示|prompt|规则|设定|人设|上下文|对话)/i,
    reason: 'IGNORE_INSTRUCTIONS_ZH',
    severity: 'high',
  },
  {
    // M1e review followup：加 'any' 覆盖 "ignore any prior instructions" 这种常见变体。
    re: /ignore\s+(all|any)?\s*(previous|prior|above|earlier)\s+(instructions|prompt|messages|system|rules)/i,
    reason: 'IGNORE_INSTRUCTIONS_EN',
    severity: 'high',
  },
  {
    re: /disregard\s+(all\s+)?(prior|previous|above|system)/i,
    reason: 'DISREGARD_EN',
    severity: 'high',
  },
  {
    // 在 skill 内部假冒 system role 注入
    re: /^\s*system\s*[:：]/im,
    reason: 'INJECT_SYSTEM_ROLE',
    severity: 'high',
  },
  {
    re: /(扮演|装作|你现在是).{0,12}(管理员|开发者|无审查|jailbreak)/i,
    reason: 'ROLE_OVERRIDE_ZH',
    severity: 'high',
  },
  {
    re: /you\s+are\s+now\s+(?:an?\s+)?(?:dan|jailbroken|uncensored|developer\s+mode)/i,
    reason: 'ROLE_OVERRIDE_EN',
    severity: 'high',
  },
  {
    // 强制执行有副作用的工具（M1d 原来是 high，保留）
    re: /(必须|一定要|always|must)\s*(执行|调用|call|invoke|run).{0,20}(magi_content_ingest|doc_export|tool)/i,
    reason: 'FORCE_TOOL_CALL',
    severity: 'high',
  },

  // ===== LOW severity：仅关键词，warn-log 但不 reject =====
  {
    // 单独出现 api_key / deepseek key / secret 仍想留痕，但允许写入（用户可能在合法描述 secret 管理流程）
    re: /(api[_\- ]?key|deepseek\s*key|access[_\- ]?token|secret)/i,
    reason: 'SECRET_KEYWORD',
    severity: 'low',
  },
];

const MAX_TITLE_LEN = 80;
const MAX_CONTENT_LEN = 2000;

export type SkillValidationIssue = {
  reason: string;
  field: 'title' | 'content';
  severity: SkillSeverity;
};

/**
 * 公开导出：路由 / 测试可单独验证 input。返回 issue 数组（空数组即通过）。
 * 每条 issue 带 severity；length-violation 视为 high。
 */
export function validateSkillInput(input: { title: string; content: string }): SkillValidationIssue[] {
  const issues: SkillValidationIssue[] = [];
  const title = input.title ?? '';
  const content = input.content ?? '';
  if (title.trim().length === 0) {
    issues.push({ reason: 'EMPTY_TITLE', field: 'title', severity: 'high' });
  }
  if (title.length > MAX_TITLE_LEN) {
    issues.push({ reason: 'TITLE_TOO_LONG', field: 'title', severity: 'high' });
  }
  if (content.length > MAX_CONTENT_LEN) {
    issues.push({ reason: 'CONTENT_TOO_LONG', field: 'content', severity: 'high' });
  }
  for (const { re, reason, severity } of SUSPICIOUS_PATTERNS) {
    if (re.test(title)) issues.push({ reason, field: 'title', severity });
    if (re.test(content)) issues.push({ reason, field: 'content', severity });
  }
  return issues;
}

export async function upsertSkill(input: UpsertSkillInput): Promise<TopicSkill> {
  const issues = validateSkillInput(input);
  const highs = issues.filter((i) => i.severity === 'high');
  if (highs.length > 0) {
    throw new SkillValidationError(
      `topic skill rejected: ${highs.map((e) => `${e.field}:${e.reason}`).join(', ')}`,
    );
  }
  const lows = issues.filter((i) => i.severity === 'low');
  if (lows.length > 0) {
    // M1e Task 5：低风险关键词（如 "api_key"）允许写入但留痕。Task 10 之后
    // `listForAgent` 会再扫一遍含 high 的历史 skill 并 drop；low 不会被 drop。
    console.warn(
      '[topicSkill] low-severity match (allowed):',
      input.title.slice(0, 40),
      lows.map((l) => `${l.field}:${l.reason}`).join(', '),
    );
  }
  const id = input.id ?? randomUUID();
  const { rows } = await getPool().query(
    `INSERT INTO topic_skills (id, scope, owner_id, group_id, topic_id,
       title, content, enabled, updated_by_user_id, updated_at, source, source_run_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), $10, $11)
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       content = EXCLUDED.content,
       enabled = EXCLUDED.enabled,
       updated_by_user_id = EXCLUDED.updated_by_user_id,
       updated_at = now(),
       source = EXCLUDED.source,
       source_run_id = EXCLUDED.source_run_id
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
      input.source ?? null,
      input.sourceRunId ?? null,
    ],
  );
  return parseRow(rows[0]);
}

/**
 * 023 技能自蒸馏幂等：判断某个 run 是否已蒸馏过技能。softComplete 可能因 crash 重 finalize，
 * 命中即跳过，避免同一 run 重复写技能。
 */
export async function hasDistilledSkillForRun(ownerId: string, runId: string): Promise<boolean> {
  const { rows } = await getPool().query(
    `SELECT 1 FROM topic_skills
     WHERE owner_id = $1 AND source_run_id = $2 AND source = 'auto_distilled' LIMIT 1`,
    [ownerId, runId],
  );
  return rows.length > 0;
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
 *
 * M1e Task 10：read 路径 defense-in-depth —— 写入 path（`upsertSkill`）只在 task 5 后才
 * 严格 reject high；M1d 老数据可能含 high pattern。这里返回前再跑一次 `validateSkillInput`，
 * 若命中 high 则 drop + 若提供了 `runId` 就 emit 一条 `SKILL_DROPPED` notice，让用户能在
 * UI 看到"你那条危险 skill 被运行时丢了，请改一下"。
 *
 * `runId` optional：测试 / 非 agent run 路径调用时不需要 surface notice。
 */
export async function listForAgent(params: {
  userId: string;
  groupId?: string;
  topicId?: string;
  runId?: string;
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
  const all = rows.map(parseRow);

  // M1e Task 10：二次过滤。命中 high pattern 的 skill drop 掉、不向 LLM 注入。
  // 同时（如果有 runId）emit 一条 SKILL_DROPPED notice 给 UI banner 用。
  const safe: TopicSkill[] = [];
  const dropped: { skill: TopicSkill; issues: SkillValidationIssue[] }[] = [];
  for (const s of all) {
    const issues = validateSkillInput({ title: s.title, content: s.content });
    const highs = issues.filter((i) => i.severity === 'high');
    if (highs.length > 0) {
      dropped.push({ skill: s, issues: highs });
    } else {
      safe.push(s);
    }
  }
  if (dropped.length > 0 && params.runId) {
    const { emitNotice } = await import('./notices.js');
    await emitNotice({
      runId: params.runId,
      severity: 'warn',
      code: 'SKILL_DROPPED',
      message: `已丢弃 ${dropped.length} 条含 jailbreak 风险的 topic skill，请到设置里修改它们。`,
      context: {
        droppedSkills: dropped.map((d) => ({
          id: d.skill.id,
          title: d.skill.title.slice(0, 40),
          reasons: d.issues.map((i) => `${i.field}:${i.reason}`),
        })),
      },
    });
  } else if (dropped.length > 0) {
    console.warn(
      '[topicSkills.listForAgent] dropped',
      dropped.length,
      'high-pattern skills (no runId → no UI notice)',
    );
  }
  return safe;
}
