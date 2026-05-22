import { randomUUID } from 'crypto';
import { getPool } from '../../db/client.js';
import {
  type AgentRun,
  type AgentRunStatus,
  type AgentStep,
  type AgentBudget,
  type AgentUsage,
  type CancelReason,
  type Plan,
  type TodoItem,
  type StepKind,
  type ApiKeySource,
  type AgentChannel,
  type AgentRole,
  type RunSummary,
  type RunArtifact,
} from './types.js';

type Row = Record<string, unknown>;

function parseRun(row: Row): AgentRun {
  return {
    id: row.id as string,
    ownerId: row.owner_id as string,
    channel: row.channel as AgentChannel,
    sessionId: (row.session_id as string | null) ?? null,
    groupId: (row.group_id as string | null) ?? null,
    topicId: (row.topic_id as string | null) ?? null,
    intentTurnId: (row.intent_turn_id as string | null) ?? null,
    role: row.role as AgentRole,
    status: row.status as AgentRunStatus,
    inputText: row.input_text as string,
    plan: (row.plan as Plan | null) ?? null,
    todos: (row.todos as TodoItem[]) ?? [],
    budget: row.budget as AgentBudget,
    usage: {
      steps: 0,
      elapsedSeconds: 0,
      tokens: 0,
      costCny: 0,
      ...((row.usage as Partial<AgentUsage> | null) ?? {}),
    },
    apiKeyOwnerId: (row.api_key_owner_id as string | null) ?? null,
    apiKeySource: row.api_key_source as ApiKeySource,
    providerId: (row.provider_id as 'deepseek' | 'zenmux' | null) ?? 'deepseek',
    modelId: (row.model_id as string | null) ?? 'deepseek-v4-pro',
    sandboxId: (row.sandbox_id as string | null) ?? null,
    userApiKeysEnc: (row.user_api_keys_enc as Record<string, string>) ?? {},
    parentRunId: (row.parent_run_id as string | null) ?? null,
    pendingUserPrompt: (row.pending_user_prompt as string | null) ?? null,
    pendingUserStepIdx: (row.pending_user_step_idx as number | null) ?? null,
    pendingUserInputExpiresAt: (row.pending_user_input_expires_at as Date | null) ?? null,
    summary: (row.summary as RunSummary | null) ?? null,
    artifact: (row.artifact as RunArtifact | null) ?? null,
    resultMessageId: (row.result_message_id as string | null) ?? null,
    invokeMessageId: (row.invoke_message_id as string | null) ?? null,
    lastHeartbeatAt: (row.last_heartbeat_at as Date | null) ?? null,
    awaitingApprovalUntil: (row.awaiting_approval_until as Date | null) ?? null,
    awaitingApprovalStepIdx:
      (row.awaiting_approval_step_idx as number | null) ?? null,
    pendingApprovalToolName:
      (row.pending_approval_tool_name as string | null) ?? null,
    cancelledByUserId: (row.cancelled_by_user_id as string | null) ?? null,
    cancelReason: (row.cancel_reason as CancelReason | null) ?? null,
    createdAt: row.created_at as Date,
    startedAt: (row.started_at as Date | null) ?? null,
    endedAt: (row.ended_at as Date | null) ?? null,
  };
}

function parseStep(row: Row): AgentStep {
  return {
    id: row.id as string,
    runId: row.run_id as string,
    idx: row.idx as number,
    kind: row.kind as StepKind,
    toolName: (row.tool_name as string | null) ?? null,
    toolCallKey: (row.tool_call_key as string | null) ?? null,
    input: row.input ?? null,
    output: row.output ?? null,
    tokens: (row.tokens as number) ?? 0,
    durationMs: (row.duration_ms as number) ?? 0,
    error: (row.error as string | null) ?? null,
    byUserId: (row.by_user_id as string | null) ?? null,
    createdAt: row.created_at as Date,
  };
}

const RUN_COLUMNS = `id, owner_id, channel, session_id, group_id, topic_id,
  intent_turn_id, role, status, input_text, plan, todos, budget, usage,
  api_key_owner_id, api_key_source, provider_id, model_id,
  sandbox_id, user_api_keys_enc,
  parent_run_id, pending_user_prompt, pending_user_step_idx,
  pending_user_input_expires_at, summary, artifact,
  result_message_id, invoke_message_id,
  last_heartbeat_at, awaiting_approval_until, awaiting_approval_step_idx,
  pending_approval_tool_name, cancelled_by_user_id, cancel_reason,
  created_at, started_at, ended_at`;

const STEP_COLUMNS = `id, run_id, idx, kind, tool_name, tool_call_key,
  input, output, tokens, duration_ms, error, by_user_id, created_at`;

export type InsertAgentRunInput = {
  id?: string;
  ownerId: string;
  channel: AgentChannel;
  sessionId: string | null;
  groupId: string | null;
  topicId: string | null;
  intentTurnId: string | null;
  role: AgentRole;
  status: AgentRunStatus;
  inputText: string;
  budget: AgentBudget;
  apiKeyOwnerId: string | null;
  apiKeySource: ApiKeySource;
  /**
   * M1d Task 6：user key 在 route 层用 `sealUserApiKey` 加密后传进来。
   * worker 用 `openUserApiKey` 解开。可选；缺省时 worker 退回 server key。
   *
   * M1e Task 11d 之后，这个字段语义 = user DeepSeek key（per-provider 字段）。
   * ZenMux 走 userZenmuxKeyEnc 列。
   */
  userApiKeyEnc?: string | null;
  /**
   * M1e Task 11d: user ZenMux key (sealed)。和 userApiKeyEnc 是 per-provider 独立字段。
   */
  userZenmuxKeyEnc?: string | null;
  /** M1e Task 11d: per-run LLM provider。不传走 DB default 'deepseek'。 */
  providerId?: 'deepseek' | 'zenmux';
  /** M1e Task 11d: per-run LLM model id。不传走 DB default 'deepseek-v4-pro'。 */
  modelId?: string;
  /** M2 Task 7A: sealed JSONB bag of per-service user API keys (E2B/FRED/Jina etc.). */
  userApiKeysEnc?: Record<string, string>;
  /** M3 Task 1: parent run id for deep_research child runs。顶层 run 留空。 */
  parentRunId?: string | null;
};

export async function insertAgentRun(
  input: InsertAgentRunInput,
): Promise<AgentRun> {
  const id = input.id ?? randomUUID();
  // M1e Task 11d：provider_id / model_id 走 DB DEFAULT（'deepseek' / 'deepseek-v4-pro'）。
  // 只有 caller 传了非 undefined 才覆盖默认；undefined 让 DB 决定，避免 backend
  // 双重默认值漂移。
  const { rows } = await getPool().query(
    `INSERT INTO agent_runs (
       id, owner_id, channel, session_id, group_id, topic_id,
       intent_turn_id, role, status, input_text, budget,
       api_key_owner_id, api_key_source, user_api_key_enc,
       user_zenmux_key_enc, provider_id, model_id, user_api_keys_enc,
       parent_run_id
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
       COALESCE($16, 'deepseek'),
       COALESCE($17, 'deepseek-v4-pro'),
       COALESCE($18::jsonb, '{}'),
       $19
     )
     RETURNING ${RUN_COLUMNS}`,
    [
      id,
      input.ownerId,
      input.channel,
      input.sessionId,
      input.groupId,
      input.topicId,
      input.intentTurnId,
      input.role,
      input.status,
      input.inputText,
      JSON.stringify(input.budget),
      input.apiKeyOwnerId,
      input.apiKeySource,
      input.userApiKeyEnc ?? null,
      input.userZenmuxKeyEnc ?? null,
      input.providerId ?? null,
      input.modelId ?? null,
      input.userApiKeysEnc ? JSON.stringify(input.userApiKeysEnc) : null,
      input.parentRunId ?? null,
    ],
  );
  return parseRun(rows[0]);
}

/**
 * M1e Task 11d：取出 user-provided ZenMux key（sealed）。和 getUserApiKeyEnc 对称。
 */
export async function getUserZenmuxKeyEnc(runId: string): Promise<string | null> {
  const { rows } = await getPool().query(
    `SELECT user_zenmux_key_enc FROM agent_runs WHERE id = $1`,
    [runId],
  );
  return (rows[0]?.user_zenmux_key_enc as string | null) ?? null;
}

/**
 * M1d Task 6：worker 内部用，单独取 sealed user key（不放进 AgentRun
 * 主类型避免泄漏到 SSE / API）。
 */
export async function getUserApiKeyEnc(runId: string): Promise<string | null> {
  const { rows } = await getPool().query(
    `SELECT user_api_key_enc FROM agent_runs WHERE id = $1`,
    [runId],
  );
  return (rows[0]?.user_api_key_enc as string | null) ?? null;
}

export async function getAgentRun(id: string): Promise<AgentRun | null> {
  const { rows } = await getPool().query(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = $1`,
    [id],
  );
  return rows[0] ? parseRun(rows[0]) : null;
}

/**
 * M1d Task 4：列表查询。返回用户作为 owner 的 run + 用户群里 owner 不是自己但
 * 是群成员的 run。按 createdAt DESC。
 *
 * 不做分页 cursor（朋友量级，limit 100 够），按 status 过滤可选。
 */
export async function listAgentRunsForUser(
  userId: string,
  opts?: { status?: AgentRunStatus; limit?: number },
): Promise<AgentRun[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 100);
  const params: unknown[] = [userId];
  let statusFilter = '';
  if (opts?.status) {
    params.push(opts.status);
    statusFilter = `AND r.status = $${params.length}`;
  }
  params.push(limit);
  const { rows } = await getPool().query(
    `
    SELECT ${RUN_COLUMNS}
    FROM agent_runs r
    WHERE (
      r.owner_id = $1
      OR (
        r.channel = 'group'
        AND r.group_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM group_members gm
          WHERE gm.group_id = r.group_id AND gm.user_id = $1
        )
      )
    )
    ${statusFilter}
    ORDER BY r.created_at DESC
    LIMIT $${params.length}
    `,
    params,
  );
  return rows.map(parseRun);
}

export type UpdateAgentRunInput = Partial<{
  status: AgentRunStatus;
  plan: Plan | null;
  todos: TodoItem[];
  usage: AgentUsage;
  /** M2 Task 1A: E2B sandbox ID — set on first run_python call, cleared to null in softComplete. */
  sandboxId: string | null;
  /** M2 Task 1A: encrypted JSONB bag of user-supplied API keys. */
  userApiKeysEnc: Record<string, string>;
  /** M3 Task 1: ask_user 暂停时记录的问题文本。清空时传 null。 */
  pendingUserPrompt: string | null;
  /** M3 Task 1: ask_user 暂停时停在第几步。清空时传 null。 */
  pendingUserStepIdx: number | null;
  /** M4 Task 1: ask_user 暂停的 24h 超时戳。清空时传 null。 */
  pendingUserInputExpiresAt: Date | null;
  /** M4 Task 4: run summary 聚合摘要。 */
  summary: RunSummary | null;
  /** M5A Task 1: run 終態産物。softComplete 同步寫入。 */
  artifact?: RunArtifact | null;
  resultMessageId: string | null;
  invokeMessageId: string | null;
  lastHeartbeatAt: Date | null;
  awaitingApprovalUntil: Date | null;
  awaitingApprovalStepIdx: number | null;
  pendingApprovalToolName: string | null;
  cancelledByUserId: string | null;
  cancelReason: CancelReason | null;
  startedAt: Date | null;
  endedAt: Date | null;
}>;

export async function updateAgentRun(
  id: string,
  patch: UpdateAgentRunInput,
): Promise<AgentRun | null> {
  const map: Record<string, [string, unknown]> = {
    status: ['status', patch.status],
    plan: [
      'plan',
      patch.plan === undefined ? undefined : JSON.stringify(patch.plan),
    ],
    todos: [
      'todos',
      patch.todos === undefined ? undefined : JSON.stringify(patch.todos),
    ],
    usage: [
      'usage',
      patch.usage === undefined ? undefined : JSON.stringify(patch.usage),
    ],
    sandboxId: ['sandbox_id', patch.sandboxId],
    userApiKeysEnc: [
      'user_api_keys_enc',
      patch.userApiKeysEnc === undefined
        ? undefined
        : JSON.stringify(patch.userApiKeysEnc),
    ],
    pendingUserPrompt: ['pending_user_prompt', patch.pendingUserPrompt],
    pendingUserStepIdx: ['pending_user_step_idx', patch.pendingUserStepIdx],
    pendingUserInputExpiresAt: ['pending_user_input_expires_at', patch.pendingUserInputExpiresAt],
    summary: [
      'summary',
      patch.summary === undefined ? undefined : JSON.stringify(patch.summary),
    ],
    artifact: [
      'artifact',
      patch.artifact === undefined
        ? undefined
        : patch.artifact === null
          ? null
          : JSON.stringify(patch.artifact),
    ],
    resultMessageId: ['result_message_id', patch.resultMessageId],
    invokeMessageId: ['invoke_message_id', patch.invokeMessageId],
    lastHeartbeatAt: ['last_heartbeat_at', patch.lastHeartbeatAt],
    awaitingApprovalUntil: ['awaiting_approval_until', patch.awaitingApprovalUntil],
    awaitingApprovalStepIdx: [
      'awaiting_approval_step_idx',
      patch.awaitingApprovalStepIdx,
    ],
    pendingApprovalToolName: [
      'pending_approval_tool_name',
      patch.pendingApprovalToolName,
    ],
    cancelledByUserId: ['cancelled_by_user_id', patch.cancelledByUserId],
    cancelReason: ['cancel_reason', patch.cancelReason],
    startedAt: ['started_at', patch.startedAt],
    endedAt: ['ended_at', patch.endedAt],
  };

  const sets: string[] = [];
  const values: unknown[] = [];
  for (const key of Object.keys(patch) as Array<keyof UpdateAgentRunInput>) {
    const entry = map[key];
    if (!entry) continue;
    const [column, value] = entry;
    if (value === undefined) continue;
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  }
  if (sets.length === 0) return getAgentRun(id);
  values.push(id);
  const { rows } = await getPool().query(
    `UPDATE agent_runs SET ${sets.join(', ')} WHERE id = $${values.length}
     RETURNING ${RUN_COLUMNS}`,
    values,
  );
  return rows[0] ? parseRun(rows[0]) : null;
}

export type InsertStepInput = {
  id?: string;
  runId: string;
  idx: number;
  kind: StepKind;
  toolName?: string | null;
  toolCallKey?: string | null;
  input?: unknown;
  output?: unknown;
  tokens?: number;
  durationMs?: number;
  error?: string | null;
  byUserId?: string | null;
};

export async function insertStep(input: InsertStepInput): Promise<AgentStep> {
  const id = input.id ?? randomUUID();
  const { rows } = await getPool().query(
    `INSERT INTO agent_steps (
       id, run_id, idx, kind, tool_name, tool_call_key,
       input, output, tokens, duration_ms, error, by_user_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING ${STEP_COLUMNS}`,
    [
      id,
      input.runId,
      input.idx,
      input.kind,
      input.toolName ?? null,
      input.toolCallKey ?? null,
      input.input === undefined ? null : JSON.stringify(input.input),
      input.output === undefined ? null : JSON.stringify(input.output),
      input.tokens ?? 0,
      input.durationMs ?? 0,
      input.error ?? null,
      input.byUserId ?? null,
    ],
  );
  return parseStep(rows[0]);
}

export async function listSteps(runId: string): Promise<AgentStep[]> {
  const { rows } = await getPool().query(
    `SELECT ${STEP_COLUMNS}
     FROM agent_steps WHERE run_id = $1 ORDER BY idx ASC`,
    [runId],
  );
  return rows.map(parseStep);
}

export async function findStepByToolCallKey(
  runId: string,
  toolCallKey: string,
): Promise<AgentStep | null> {
  const { rows } = await getPool().query(
    `SELECT ${STEP_COLUMNS}
     FROM agent_steps
     WHERE run_id = $1 AND tool_call_key = $2
     LIMIT 1`,
    [runId, toolCallKey],
  );
  return rows[0] ? parseStep(rows[0]) : null;
}

export async function maxStepIdx(runId: string): Promise<number> {
  const { rows } = await getPool().query(
    `SELECT MAX(idx) AS m FROM agent_steps WHERE run_id = $1`,
    [runId],
  );
  return (rows[0]?.m as number | null) ?? -1;
}

/**
 * 在事务内挑一条可运行的 run，加 FOR UPDATE SKIP LOCKED 锁，
 * 顺手把 last_heartbeat_at 写到 now() 以阻止其他 worker 抢同一行。
 */
/**
 * M3 hotfix: 将父 run 的加密 LLM key（user_api_key_enc、user_zenmux_key_enc）
 * 直接复制到子 run，使子 run 继承父 run 的用户密钥配置。
 *
 * 背景：createAgentRun 只接收明文 apiKey，而子 run 创建时（deepResearch）无法
 * 获得父 run 的解密密钥；直接在 DB 层 SQL COPY 是最安全的做法，不让密文离开 DB。
 */
export async function copyLlmKeysFromParent(
  childRunId: string,
  parentRunId: string,
): Promise<void> {
  await getPool().query(
    `UPDATE agent_runs AS child
       SET user_api_key_enc     = parent.user_api_key_enc,
           user_zenmux_key_enc  = parent.user_zenmux_key_enc
       FROM agent_runs AS parent
       WHERE child.id = $1 AND parent.id = $2`,
    [childRunId, parentRunId],
  );
}

export async function pickupNextRun(): Promise<AgentRun | null> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT ${RUN_COLUMNS} FROM agent_runs
       WHERE status IN ('draft','planning','running','replanning')
         AND (last_heartbeat_at IS NULL
              OR last_heartbeat_at < now() - interval '30 seconds')
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
    );
    if (rows.length === 0) {
      await client.query('COMMIT');
      return null;
    }
    const run = parseRun(rows[0]);
    await client.query(
      `UPDATE agent_runs SET last_heartbeat_at = now() WHERE id = $1`,
      [run.id],
    );
    await client.query('COMMIT');
    return { ...run, lastHeartbeatAt: new Date() };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
