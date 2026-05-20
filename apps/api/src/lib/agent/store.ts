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
  api_key_owner_id, api_key_source, result_message_id, invoke_message_id,
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
};

export async function insertAgentRun(
  input: InsertAgentRunInput,
): Promise<AgentRun> {
  const id = input.id ?? randomUUID();
  const { rows } = await getPool().query(
    `INSERT INTO agent_runs (
       id, owner_id, channel, session_id, group_id, topic_id,
       intent_turn_id, role, status, input_text, budget,
       api_key_owner_id, api_key_source
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
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
    ],
  );
  return parseRun(rows[0]);
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
