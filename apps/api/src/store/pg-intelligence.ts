import { randomUUID } from 'crypto';
import type {
  BtwExchange,
  LlmInvokeJob,
  LlmJobStatus,
  MemoryCategory,
  MemoryFragment,
  MemoryFragmentStatus,
  MemoryFragmentVersion,
  MemoryScope,
  UserMemorySettings,
} from '@xzz/shared';
import { getPool } from '../db/client.js';

function now() {
  return new Date().toISOString();
}

export async function createLlmJob(input: {
  ownerId: string;
  invokerUserId: string;
  groupId?: string | null;
  topicId?: string | null;
  sessionId?: string | null;
  payload?: Record<string, unknown>;
}): Promise<LlmInvokeJob> {
  const id = randomUUID();
  const ts = now();
  await getPool().query(
    `INSERT INTO llm_invoke_jobs
     (id, owner_id, group_id, topic_id, session_id, status, invoker_user_id, payload, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,'pending',$6,$7::jsonb,$8,$8)`,
    [
      id,
      input.ownerId,
      input.groupId ?? null,
      input.topicId ?? null,
      input.sessionId ?? null,
      input.invokerUserId,
      JSON.stringify(input.payload ?? {}),
      ts,
    ],
  );
  return getLlmJob(input.ownerId, id) as Promise<LlmInvokeJob>;
}

export async function updateLlmJob(
  ownerId: string,
  jobId: string,
  patch: Partial<Pick<LlmInvokeJob, 'status' | 'resultMessageId' | 'payload'>>,
): Promise<LlmInvokeJob | null> {
  const job = await getLlmJob(ownerId, jobId);
  if (!job) return null;
  const next = {
    ...job,
    ...patch,
    updatedAt: now(),
  };
  await getPool().query(
    `UPDATE llm_invoke_jobs SET status = $2, result_message_id = $3,
     payload = $4::jsonb, updated_at = $5 WHERE id = $1 AND owner_id = $6`,
    [
      jobId,
      next.status,
      next.resultMessageId,
      JSON.stringify(next.payload),
      next.updatedAt,
      ownerId,
    ],
  );
  return next;
}

export async function getLlmJob(
  ownerId: string,
  jobId: string,
): Promise<LlmInvokeJob | null> {
  const { rows } = await getPool().query(
    'SELECT * FROM llm_invoke_jobs WHERE id = $1 AND owner_id = $2',
    [jobId, ownerId],
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    id: r.id,
    ownerId: r.owner_id,
    groupId: r.group_id,
    topicId: r.topic_id,
    sessionId: r.session_id,
    status: r.status as LlmJobStatus,
    invokerUserId: r.invoker_user_id,
    payload: r.payload as Record<string, unknown>,
    resultMessageId: r.result_message_id,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

export async function createBtwExchange(input: {
  userId: string;
  groupId?: string | null;
  topicId?: string | null;
  question: string;
  answer: string;
}): Promise<BtwExchange> {
  const id = randomUUID();
  const ts = now();
  const payload = {
    question: input.question,
    answer: input.answer,
  };
  await getPool().query(
    `INSERT INTO btw_exchanges (id, user_id, group_id, topic_id, payload, created_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
    [id, input.userId, input.groupId ?? null, input.topicId ?? null, JSON.stringify(payload), ts],
  );
  return {
    id,
    userId: input.userId,
    groupId: input.groupId ?? null,
    topicId: input.topicId ?? null,
    question: input.question,
    answer: input.answer,
    createdAt: ts,
  };
}

function rowMemoryFragment(r: {
  id: string;
  scope: MemoryScope;
  owner_id: string;
  group_id: string | null;
  topic_id: string | null;
  session_id?: string | null;
  title: string;
  category?: string;
  current_version_id: string | null;
  status?: string;
  content?: string;
  created_at: Date;
  updated_at: Date;
}): MemoryFragment {
  const category = (r.category ?? 'general') as MemoryCategory;
  return {
    id: r.id,
    scope: r.scope,
    ownerId: r.owner_id,
    groupId: r.group_id,
    topicId: r.topic_id,
    sessionId: r.session_id ?? null,
    title: r.title,
    category:
      category === 'user_profile' || category === 'project_note'
        ? category
        : 'general',
    currentVersionId: r.current_version_id,
    status: (r.status ?? 'active') as MemoryFragmentStatus,
    content: r.content,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

export async function listMemoryFragments(
  userId: string,
  scope: MemoryScope,
  opts: {
    groupId?: string;
    topicId?: string;
    sessionId?: string;
    category?: MemoryCategory;
    status?: MemoryFragmentStatus | MemoryFragmentStatus[];
    includeSuppressed?: boolean;
    withContent?: boolean;
    limit?: number;
  },
): Promise<MemoryFragment[]> {
  let query = `SELECT f.*${
    opts.withContent
      ? ', v.content AS content'
      : ''
  } FROM memory_fragments f${
    opts.withContent
      ? ' LEFT JOIN memory_fragment_versions v ON v.id = f.current_version_id'
      : ''
  } WHERE f.owner_id = $1 AND f.scope = $2`;
  const params: unknown[] = [userId, scope];
  if (opts.status) {
    const statuses = Array.isArray(opts.status) ? opts.status : [opts.status];
    params.push(statuses);
    query += ` AND f.status = ANY($${params.length}::text[])`;
  } else if (!opts.includeSuppressed) {
    query += ` AND f.status = 'active'`;
  } else {
    query += ` AND f.status != 'deleted'`;
  }
  if (opts.category) {
    params.push(opts.category);
    query += ` AND f.category = $${params.length}`;
  }
  if (opts.groupId) {
    params.push(opts.groupId);
    query += ` AND f.group_id = $${params.length}`;
  }
  if (opts.topicId) {
    params.push(opts.topicId);
    query += ` AND f.topic_id = $${params.length}`;
  }
  if (opts.sessionId) {
    params.push(opts.sessionId);
    query += ` AND f.session_id = $${params.length}`;
  }
  query += ' ORDER BY f.updated_at DESC';
  if (opts.limit) {
    params.push(opts.limit);
    query += ` LIMIT $${params.length}`;
  }
  const { rows } = await getPool().query(query, params);
  return rows.map((r) => rowMemoryFragment(r));
}

export async function getMemoryFragment(
  userId: string,
  fragmentId: string,
): Promise<MemoryFragment | null> {
  const { rows } = await getPool().query(
    `SELECT f.*, v.content AS content
     FROM memory_fragments f
     LEFT JOIN memory_fragment_versions v ON v.id = f.current_version_id
     WHERE f.id = $1 AND f.owner_id = $2 AND f.status != 'deleted'`,
    [fragmentId, userId],
  );
  if (!rows[0]) return null;
  return rowMemoryFragment(rows[0]);
}

export async function sumUserScopeMemoryChars(userId: string): Promise<number> {
  const { rows } = await getPool().query(
    `SELECT COALESCE(SUM(LENGTH(v.content)), 0)::int AS total
     FROM memory_fragments f
     INNER JOIN memory_fragment_versions v ON v.id = f.current_version_id
     WHERE f.owner_id = $1 AND f.scope = 'user' AND f.status = 'active'`,
    [userId],
  );
  return Number(rows[0]?.total ?? 0);
}

export async function getUserMemorySettings(userId: string): Promise<UserMemorySettings> {
  const { rows } = await getPool().query(
    `SELECT auto_extract_enabled FROM user_memory_settings WHERE user_id = $1`,
    [userId],
  );
  if (!rows[0]) {
    return { autoExtractEnabled: true };
  }
  return { autoExtractEnabled: Boolean(rows[0].auto_extract_enabled) };
}

export async function setUserMemorySettings(
  userId: string,
  settings: UserMemorySettings,
): Promise<UserMemorySettings> {
  const ts = now();
  await getPool().query(
    `INSERT INTO user_memory_settings (user_id, auto_extract_enabled, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET
       auto_extract_enabled = EXCLUDED.auto_extract_enabled,
       updated_at = EXCLUDED.updated_at`,
    [userId, settings.autoExtractEnabled, ts],
  );
  return settings;
}

export async function createMemoryFragment(input: {
  userId: string;
  scope: MemoryScope;
  groupId?: string | null;
  topicId?: string | null;
  sessionId?: string | null;
  title: string;
  content: string;
  category?: MemoryCategory;
  status?: MemoryFragmentStatus;
  source?: 'ai' | 'user' | 'import';
  sourceMessageId?: string;
}): Promise<{ fragment: MemoryFragment; version: MemoryFragmentVersion }> {
  const fragmentId = randomUUID();
  const versionId = randomUUID();
  const ts = now();
  const source = input.source ?? 'ai';
  const category = input.category ?? 'general';
  const status = input.status ?? 'active';
  const reviewDismissedAt = source === 'user' ? ts : null;
  await getPool().query(
    `INSERT INTO memory_fragments
     (id, scope, owner_id, group_id, topic_id, session_id, title, category, current_version_id, status, review_dismissed_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)`,
    [
      fragmentId,
      input.scope,
      input.userId,
      input.groupId ?? null,
      input.topicId ?? null,
      input.sessionId ?? null,
      input.title,
      category,
      versionId,
      status,
      reviewDismissedAt,
      ts,
    ],
  );
  await getPool().query(
    `INSERT INTO memory_fragment_versions (id, fragment_id, version, content, source, created_by, created_at)
     VALUES ($1,$2,1,$3,$4,$5,$6)`,
    [versionId, fragmentId, input.content, source, input.userId, ts],
  );
  if (input.sourceMessageId) {
    await getPool().query(
      `INSERT INTO memory_provenance_links (id, version_id, message_id, payload)
       VALUES ($1,$2,$3,'{}'::jsonb)`,
      [randomUUID(), versionId, input.sourceMessageId],
    );
  }
  const fragment = (await getMemoryFragment(input.userId, fragmentId))!;
  const version: MemoryFragmentVersion = {
    id: versionId,
    fragmentId,
    version: 1,
    content: input.content,
    source,
    createdBy: input.userId,
    createdAt: ts,
  };
  return { fragment, version };
}

export async function appendMemoryVersion(input: {
  userId: string;
  fragmentId: string;
  content: string;
  source?: 'ai' | 'user' | 'import';
  sourceMessageId?: string;
}): Promise<{ fragment: MemoryFragment; version: MemoryFragmentVersion }> {
  const existing = await getMemoryFragment(input.userId, input.fragmentId);
  if (!existing) throw new Error('MEMORY_NOT_FOUND');
  const ts = now();
  const { rows: verRows } = await getPool().query(
    `SELECT COALESCE(MAX(version), 0) AS max_v FROM memory_fragment_versions WHERE fragment_id = $1`,
    [input.fragmentId],
  );
  const nextVersion = Number(verRows[0]?.max_v ?? 0) + 1;
  const versionId = randomUUID();
  const source = input.source ?? 'user';
  await getPool().query(
    `INSERT INTO memory_fragment_versions (id, fragment_id, version, content, source, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      versionId,
      input.fragmentId,
      nextVersion,
      input.content,
      source,
      input.userId,
      ts,
    ],
  );
  await getPool().query(
    `UPDATE memory_fragments SET current_version_id = $2, status = 'active', updated_at = $3 WHERE id = $1`,
    [input.fragmentId, versionId, ts],
  );
  if (input.sourceMessageId) {
    await getPool().query(
      `INSERT INTO memory_provenance_links (id, version_id, message_id, payload)
       VALUES ($1,$2,$3,'{}'::jsonb)`,
      [randomUUID(), versionId, input.sourceMessageId],
    );
  }
  const fragment = (await getMemoryFragment(input.userId, input.fragmentId))!;
  return {
    fragment,
    version: {
      id: versionId,
      fragmentId: input.fragmentId,
      version: nextVersion,
      content: input.content,
      source,
      createdBy: input.userId,
      createdAt: ts,
    },
  };
}

export async function setMemoryFragmentStatus(
  userId: string,
  fragmentId: string,
  status: MemoryFragmentStatus,
): Promise<MemoryFragment | null> {
  const ts = now();
  const dismissReview =
    status === 'suppressed' || status === 'deleted' ? ', review_dismissed_at = $5' : '';
  const params =
    status === 'suppressed' || status === 'deleted'
      ? [fragmentId, userId, status, ts, ts]
      : [fragmentId, userId, status, ts];
  const { rowCount } = await getPool().query(
    `UPDATE memory_fragments SET status = $3, updated_at = $4${dismissReview}
     WHERE id = $1 AND owner_id = $2`,
    params,
  );
  if (!rowCount) return null;
  return getMemoryFragment(userId, fragmentId);
}

/** AI 自动写入且未处理：审核收件箱 */
export async function listMemoryReviewQueue(
  userId: string,
  limit = 50,
): Promise<MemoryFragment[]> {
  const { rows } = await getPool().query(
    `SELECT f.*, v.content AS content
     FROM memory_fragments f
     INNER JOIN memory_fragment_versions v ON v.id = f.current_version_id
     WHERE f.owner_id = $1
       AND f.status = 'active'
       AND f.review_dismissed_at IS NULL
       AND v.source = 'ai'
     ORDER BY f.updated_at DESC
     LIMIT $2`,
    [userId, limit],
  );
  return rows.map((r) => rowMemoryFragment(r));
}

export async function countMemoryReviewQueue(userId: string): Promise<number> {
  const { rows } = await getPool().query(
    `SELECT COUNT(*)::int AS n
     FROM memory_fragments f
     INNER JOIN memory_fragment_versions v ON v.id = f.current_version_id
     WHERE f.owner_id = $1
       AND f.status = 'active'
       AND f.review_dismissed_at IS NULL
       AND v.source = 'ai'`,
    [userId],
  );
  return Number(rows[0]?.n ?? 0);
}

/** 保留：继续生效，仅从审核列表移除 */
export async function dismissMemoryReview(
  userId: string,
  fragmentId: string,
): Promise<MemoryFragment | null> {
  const ts = now();
  const { rowCount } = await getPool().query(
    `UPDATE memory_fragments
     SET review_dismissed_at = $3, updated_at = $3
     WHERE id = $1 AND owner_id = $2 AND status = 'active'`,
    [fragmentId, userId, ts],
  );
  if (!rowCount) return null;
  return getMemoryFragment(userId, fragmentId);
}

export async function logMemoryUsage(input: {
  userId: string;
  fragmentId: string;
  versionId?: string;
  jobId?: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  await getPool().query(
    `INSERT INTO memory_usage_logs (id, fragment_id, version_id, job_id, user_id, payload)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [
      randomUUID(),
      input.fragmentId,
      input.versionId ?? null,
      input.jobId ?? null,
      input.userId,
      JSON.stringify(input.payload ?? {}),
    ],
  );
}

export async function listMemoryVersions(
  userId: string,
  fragmentId: string,
): Promise<MemoryFragmentVersion[]> {
  const { rows } = await getPool().query(
    `SELECT v.* FROM memory_fragment_versions v
     INNER JOIN memory_fragments f ON f.id = v.fragment_id
     WHERE v.fragment_id = $1 AND f.owner_id = $2
     ORDER BY v.version`,
    [fragmentId, userId],
  );
  return rows.map((r) => ({
    id: r.id,
    fragmentId: r.fragment_id,
    version: r.version,
    content: r.content,
    source: r.source,
    createdBy: r.created_by,
    createdAt: r.created_at.toISOString(),
  }));
}
