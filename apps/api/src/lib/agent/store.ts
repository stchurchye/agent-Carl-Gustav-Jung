import { randomUUID } from 'crypto';
import type { PoolClient } from 'pg';
import { getPool } from '../../db/client.js';
import {
  type AgentCheckpoint,
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
  type MergedInput,
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
    mergedInputs: (row.merged_inputs as MergedInput[] | null) ?? [],
    mergedInputsConsumedCount:
      (row.merged_inputs_consumed_count as number | null) ?? 0,
    queuePosition: (row.queue_position as number | null) ?? null,
    askUserTargetUserId: (row.ask_user_target_user_id as string | null) ?? null,
    askUserStartedAt: (row.ask_user_started_at as Date | null) ?? null,
    askUserOpenedForAllAt:
      (row.ask_user_opened_for_all_at as Date | null) ?? null,
    contextCheckpoint:
      (row.context_checkpoint as AgentCheckpoint | null) ?? null,
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

/**
 * M6 T3：JSONB 字段写入 helper。
 * undefined → 不更新；null → SQL NULL；其他 → JSON.stringify。
 *
 * 历史 bug：M5 review 发现 summary 等字段把 null 写成字符串 "null"，
 * IS NULL 判断不命中。artifact 在 M5A 已修；本 helper 统一所有 JSONB 字段。
 */
function jsonbOrNull<T>(v: T | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return JSON.stringify(v);
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
  created_at, started_at, ended_at,
  merged_inputs, merged_inputs_consumed_count, queue_position,
  ask_user_target_user_id, ask_user_started_at, ask_user_opened_for_all_at,
  context_checkpoint`;

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
  /** M7：默认 'draft'（SQL COALESCE）。T3 queue 分支传 'queued'。 */
  status?: AgentRunStatus;
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
  /** M7：queued 时记录入队位次。 */
  queuePosition?: number | null;
};

// M1e Task 11d：provider_id / model_id 走 DB DEFAULT（'deepseek' / 'deepseek-v4-pro'）。
// 只有 caller 传了非 undefined 才覆盖默认；undefined 让 DB 决定，避免 backend
// 双重默认值漂移。
// M7：status COALESCE 默认 'draft'；新增 queue_position（$20）。
const INSERT_AGENT_RUN_SQL = `INSERT INTO agent_runs (
     id, owner_id, channel, session_id, group_id, topic_id,
     intent_turn_id, role, status, input_text, budget,
     api_key_owner_id, api_key_source, user_api_key_enc,
     user_zenmux_key_enc, provider_id, model_id, user_api_keys_enc,
     parent_run_id, queue_position
   ) VALUES (
     $1,$2,$3,$4,$5,$6,$7,$8, COALESCE($9, 'draft'), $10, $11,$12,$13,$14,$15,
     COALESCE($16, 'deepseek'),
     COALESCE($17, 'deepseek-v4-pro'),
     COALESCE($18::jsonb, '{}'),
     $19,
     $20
   )
   RETURNING ${RUN_COLUMNS}`;

function buildInsertAgentRunParams(input: InsertAgentRunInput): unknown[] {
  return [
    input.id ?? randomUUID(),
    input.ownerId,
    input.channel,
    input.sessionId,
    input.groupId,
    input.topicId,
    input.intentTurnId,
    input.role,
    input.status ?? null,
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
    input.queuePosition ?? null,
  ];
}

export async function insertAgentRun(
  input: InsertAgentRunInput,
): Promise<AgentRun> {
  const { rows } = await getPool().query(
    INSERT_AGENT_RUN_SQL,
    buildInsertAgentRunParams(input),
  );
  return parseRun(rows[0]);
}

/**
 * M7：与 insertAgentRun 完全等价，但跑在 caller 提供的事务 client 上
 * （withTopicCoordination 的持锁连接）。R13：决策 + INSERT 必须同事务。
 */
export async function insertAgentRunInTx(
  client: PoolClient,
  input: InsertAgentRunInput,
): Promise<AgentRun> {
  const { rows } = await client.query(
    INSERT_AGENT_RUN_SQL,
    buildInsertAgentRunParams(input),
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
  /** M7 P1 推进 consumed_count；与 status 一起 update 时 jsonb 走 jsonbOrNull。 */
  mergedInputs: MergedInput[] | null;
  mergedInputsConsumedCount: number;
  queuePosition: number | null;
  askUserTargetUserId: string | null;
  askUserStartedAt: Date | null;
  askUserOpenedForAllAt: Date | null;
  contextCheckpoint: AgentCheckpoint | null;
}>;

/** M7：spec 引用类型别名，方便调用方写具名类型而非 Parameters<typeof updateAgentRun>[1]。 */
export type UpdateAgentRunPatch = UpdateAgentRunInput;

export async function updateAgentRun(
  id: string,
  patch: UpdateAgentRunInput,
): Promise<AgentRun | null> {
  const map: Record<string, [string, unknown]> = {
    status: ['status', patch.status],
    plan: ['plan', jsonbOrNull(patch.plan)],
    todos: ['todos', jsonbOrNull(patch.todos)],
    usage: ['usage', jsonbOrNull(patch.usage)],
    sandboxId: ['sandbox_id', patch.sandboxId],
    userApiKeysEnc: ['user_api_keys_enc', jsonbOrNull(patch.userApiKeysEnc)],
    pendingUserPrompt: ['pending_user_prompt', patch.pendingUserPrompt],
    pendingUserStepIdx: ['pending_user_step_idx', patch.pendingUserStepIdx],
    pendingUserInputExpiresAt: ['pending_user_input_expires_at', patch.pendingUserInputExpiresAt],
    summary: ['summary', jsonbOrNull(patch.summary)],
    artifact: ['artifact', jsonbOrNull(patch.artifact)],
    resultMessageId: ['result_message_id', patch.resultMessageId],
    invokeMessageId: ['invoke_message_id', patch.invokeMessageId],
    lastHeartbeatAt: ['last_heartbeat_at', patch.lastHeartbeatAt],
    awaitingApprovalUntil: ['awaiting_approval_until', patch.awaitingApprovalUntil],
    awaitingApprovalStepIdx: ['awaiting_approval_step_idx', patch.awaitingApprovalStepIdx],
    pendingApprovalToolName: ['pending_approval_tool_name', patch.pendingApprovalToolName],
    cancelledByUserId: ['cancelled_by_user_id', patch.cancelledByUserId],
    cancelReason: ['cancel_reason', patch.cancelReason],
    startedAt: ['started_at', patch.startedAt],
    endedAt: ['ended_at', patch.endedAt],
    mergedInputs: ['merged_inputs', jsonbOrNull(patch.mergedInputs)],
    mergedInputsConsumedCount: [
      'merged_inputs_consumed_count',
      patch.mergedInputsConsumedCount,
    ],
    queuePosition: ['queue_position', patch.queuePosition],
    askUserTargetUserId: ['ask_user_target_user_id', patch.askUserTargetUserId],
    askUserStartedAt: ['ask_user_started_at', patch.askUserStartedAt],
    askUserOpenedForAllAt: [
      'ask_user_opened_for_all_at',
      patch.askUserOpenedForAllAt,
    ],
    contextCheckpoint: ['context_checkpoint', jsonbOrNull(patch.contextCheckpoint)],
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

/**
 * 定向取单步（按 run + idx）—— recall_step 用。避免 listSteps 把整 run（可能含多个
 * 数十 KB output）全量载入只为取一行。idx 在 run 内唯一（maxStepIdx+1，不重排）。
 */
export async function getStepByIdx(
  runId: string,
  idx: number,
): Promise<AgentStep | null> {
  const { rows } = await getPool().query(
    `SELECT ${STEP_COLUMNS}
     FROM agent_steps WHERE run_id = $1 AND idx = $2 LIMIT 1`,
    [runId, idx],
  );
  return rows[0] ? parseStep(rows[0]) : null;
}

/**
 * M7：只取某一 kind 的 step（定向过滤推到 DB，避免热路径全表扫）。
 * contextAdapter 每次群聊快照取 user_message_appended 用。
 */
export async function listStepsByKind(
  runId: string,
  kind: StepKind,
): Promise<AgentStep[]> {
  const { rows } = await getPool().query(
    `SELECT ${STEP_COLUMNS}
     FROM agent_steps WHERE run_id = $1 AND kind = $2 ORDER BY idx ASC`,
    [runId, kind],
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

// ============================================================
// M7：topic slot 查询 + 合并/排队事务原语
//
// 设计约束（ADR-M7-14 + R13）：本节所有可能与 acquireTopicSlot 写入冲突的函数
// 都接受 `client?: PoolClient`，调用方（withTopicCoordination）持有 advisory lock
// 的事务客户端会原样透传；不传 client 时退回独立连接（旧路径 / 非协调场景）。
// ============================================================

const BLOCKING_STATUSES_SQL = `('draft','planning','running','replanning','awaiting_approval','awaiting_user_input')`;

function exec(client: PoolClient | undefined) {
  return client ?? getPool();
}

/**
 * M7：找 topic 上正在跑（不含 queued）的最新 run。
 * acquireTopicSlot 判定 merge / queue 时用。
 */
export async function findBlockingActiveOnTopic(
  topicId: string,
  client?: PoolClient,
): Promise<AgentRun | null> {
  const { rows } = await exec(client).query(
    `SELECT ${RUN_COLUMNS} FROM agent_runs
     WHERE topic_id = $1
       AND status IN ${BLOCKING_STATUSES_SQL}
       AND parent_run_id IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [topicId],
  );
  return rows[0] ? parseRun(rows[0]) : null;
}

/**
 * M7：拿 topic 上 status='queued' 的队首（FIFO）。
 * dequeueNextOnTopic 用。
 */
export async function findQueuedHeadOnTopic(
  topicId: string,
  client?: PoolClient,
): Promise<AgentRun | null> {
  const { rows } = await exec(client).query(
    `SELECT ${RUN_COLUMNS} FROM agent_runs
     WHERE topic_id = $1 AND status = 'queued'
     ORDER BY created_at ASC
     LIMIT 1`,
    [topicId],
  );
  return rows[0] ? parseRun(rows[0]) : null;
}

/**
 * M7：blocking + queued 总数。queue 分支算 precedingCount 用。
 */
export async function countBlockingPlusQueuedOnTopic(
  topicId: string,
  client?: PoolClient,
): Promise<number> {
  const { rows } = await exec(client).query(
    `SELECT COUNT(*)::int AS c FROM agent_runs
     WHERE topic_id = $1
       AND parent_run_id IS NULL
       AND (status IN ${BLOCKING_STATUSES_SQL} OR status = 'queued')`,
    [topicId],
  );
  return (rows[0]?.c as number | null) ?? 0;
}

const TERMINAL_STATUSES = new Set<string>([
  'completed',
  'failed',
  'cancelled',
  'budget_exhausted',
]);

/**
 * M7：merge target 已经 terminal 时抛此错；上层 retry-once 重判。
 */
export class MergeTargetTerminalError extends Error {
  constructor(public readonly targetRunId: string) {
    super(`merge target run ${targetRunId} is already terminal`);
    this.name = 'MergeTargetTerminalError';
  }
}

/**
 * M7：在事务内合并写 user_message_appended step + agent_runs.merged_inputs JSONB。
 *
 * - 传入 `client` 时：复用调用方事务（withTopicCoordination 持锁场景），不自己 BEGIN/COMMIT。
 * - 不传 `client` 时：自管理短事务（向后兼容）。
 *
 * 防并发（为何 MAX(idx)+1 在这里是安全的）：先 `SELECT ... FOR UPDATE` 锁目标 run 行。
 * 往 agent_steps 插一行会对父表 agent_runs 的该行取 FOR KEY SHARE 锁（FK 约束），
 * 而 FOR KEY SHARE 与 FOR UPDATE 冲突 —— 所以 merge 持锁期间，worker 的 recordStep
 * 插 step 会被阻塞，反之亦然。两侧因此串行，MAX(idx)+1 不会撞 UNIQUE(run_id, idx)。
 * （已用双连接经验验证：FOR UPDATE 确实阻塞并发 agent_steps INSERT。）
 */
export async function applyMergeInTx(
  targetRunId: string,
  entry: MergedInput,
  client?: PoolClient,
): Promise<void> {
  const ownClient = !client;
  const c = client ?? (await getPool().connect());
  try {
    if (ownClient) await c.query('BEGIN');
    const lockRes = await c.query(
      `SELECT status FROM agent_runs WHERE id = $1 FOR UPDATE`,
      [targetRunId],
    );
    if (lockRes.rowCount === 0) {
      if (ownClient) await c.query('ROLLBACK');
      throw new MergeTargetTerminalError(targetRunId);
    }
    const status = lockRes.rows[0].status as string;
    if (TERMINAL_STATUSES.has(status)) {
      if (ownClient) await c.query('ROLLBACK');
      throw new MergeTargetTerminalError(targetRunId);
    }

    const { rows: idxRows } = await c.query(
      `SELECT COALESCE(MAX(idx), -1) AS m FROM agent_steps WHERE run_id = $1`,
      [targetRunId],
    );
    const nextIdx = ((idxRows[0]?.m as number | null) ?? -1) + 1;
    await c.query(
      `INSERT INTO agent_steps (id, run_id, idx, kind, input, output, tokens, duration_ms)
         VALUES ($1, $2, $3, 'user_message_appended', $4::jsonb, NULL, 0, 0)`,
      [randomUUID(), targetRunId, nextIdx, JSON.stringify(entry)],
    );
    // 注：agent_runs 无 updated_at 列（live schema 核实），故只更新 merged_inputs + status。
    // M7 holistic review fix：若 run 当前在 awaiting_user_input（暂停等答 ask_user），
    // merge 会把它 flip 到 replanning —— 那个 pending 的问题被放弃，必须同时清掉
    // pending_user_* / ask_user_* —— 否则 resumeAgentRun（要求 status=awaiting_user_input）
    // 会对残留的问题报错，群聊里也会留一张已废弃的 ask_user 卡片。
    await c.query(
      `UPDATE agent_runs
         SET merged_inputs = COALESCE(merged_inputs, '[]'::jsonb) || $1::jsonb,
             status = CASE
                        WHEN status IN ('planning','running','awaiting_approval','awaiting_user_input')
                          THEN 'replanning'
                        ELSE status
                      END,
             pending_user_prompt = CASE WHEN status = 'awaiting_user_input' THEN NULL ELSE pending_user_prompt END,
             pending_user_step_idx = CASE WHEN status = 'awaiting_user_input' THEN NULL ELSE pending_user_step_idx END,
             pending_user_input_expires_at = CASE WHEN status = 'awaiting_user_input' THEN NULL ELSE pending_user_input_expires_at END,
             ask_user_target_user_id = CASE WHEN status = 'awaiting_user_input' THEN NULL ELSE ask_user_target_user_id END,
             ask_user_started_at = CASE WHEN status = 'awaiting_user_input' THEN NULL ELSE ask_user_started_at END,
             ask_user_opened_for_all_at = CASE WHEN status = 'awaiting_user_input' THEN NULL ELSE ask_user_opened_for_all_at END
       WHERE id = $2`,
      [JSON.stringify([entry]), targetRunId],
    );
    if (ownClient) await c.query('COMMIT');
  } catch (e) {
    if (ownClient) await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    if (ownClient) c.release();
  }
}

/**
 * M7：仅查 merged_inputs 长度 + consumed_count，避免 runExecute 每步全表 SELECT（R12）。
 */
export async function getMergedInputCounts(
  runId: string,
  client?: PoolClient,
): Promise<{ total: number; consumed: number } | null> {
  const { rows } = await exec(client).query(
    `SELECT jsonb_array_length(COALESCE(merged_inputs, '[]'::jsonb))::int AS total,
            COALESCE(merged_inputs_consumed_count, 0)::int AS consumed
       FROM agent_runs WHERE id = $1`,
    [runId],
  );
  if (!rows[0]) return null;
  return { total: Number(rows[0].total), consumed: Number(rows[0].consumed) };
}
