export type AgentRole = 'generalist';

/**
 * Agent 任务状态。
 * M1f：移除 'awaiting_confirm' —— 该状态在 M1d 引入但 mobile 从未接对应 UI，
 * worker 处理逻辑永远进不去。删后 status 列在 DB 仍是 TEXT 无约束，老数据兼容。
 * 如未来需要"先确认参数再 run" → 重新加 enum value 即可（M1f spec ADR）。
 */
export type AgentRunStatus =
  | 'draft'
  | 'planning'
  | 'awaiting_approval'
  // M3 Task 1：ask_user 暂停。worker 把当前 step idx 和问题文本写到 pending_user_*，
  // 等待 mobile 端把回答通过 resume API 写回来 → status 切回 'running'。
  | 'awaiting_user_input'
  | 'running'
  | 'replanning'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'budget_exhausted';

export type AgentChannel = 'private' | 'group';

export type CancelReason = 'user' | 'steer' | 'budget' | 'crash_reclaim';

export type ApiKeySource = 'user' | 'server';

export type TodoStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'skipped'
  | 'failed';

export type TodoItem = {
  id: string;
  text: string;
  status: TodoStatus;
  stepRefs: string[];
};

export type PlanStep = {
  toolName: string;
  input: Record<string, unknown>;
  reason: string;
  todoId: string | null;
};

export type Plan = {
  intentSummary: string;
  steps: PlanStep[];
  todos: TodoItem[];
  finalReplyHint: string;
  reasoning: string | null;
  version: number;
};

export type AgentBudget = {
  maxSteps: number;
  maxSeconds: number;
  maxTokens: number;
};

export type AgentUsage = {
  steps: number;
  elapsedSeconds: number;
  tokens: number;
  costCny: number;
};

export type AgentRun = {
  id: string;
  ownerId: string;
  channel: AgentChannel;
  sessionId: string | null;
  groupId: string | null;
  topicId: string | null;
  intentTurnId: string | null;
  role: AgentRole;
  status: AgentRunStatus;
  inputText: string;
  plan: Plan | null;
  todos: TodoItem[];
  budget: AgentBudget;
  usage: AgentUsage;
  apiKeyOwnerId: string | null;
  apiKeySource: ApiKeySource;
  /**
   * M1e Task 11d：per-run 选 LLM provider + model。migration 015 给
   * 老 run 加了 NOT NULL DEFAULT 'deepseek' / 'deepseek-v4-pro'，
   * 所以这两个字段在 backend 永远非空。
   */
  providerId: 'deepseek' | 'zenmux';
  modelId: string;
  /** M2 Task 1A: E2B sandbox ID for run_python. NULL until first call; killed in softComplete. */
  sandboxId: string | null;
  /** M2 Task 1A: encrypted JSONB bag of user-supplied API keys keyed by service name. */
  userApiKeysEnc: Record<string, string>;
  /** M3 Task 1: 子 run 指向父 run（deep_research spawn 的）。null 表示这是顶层 run。 */
  parentRunId: string | null;
  /** M3 Task 1: ask_user 暂停时记录的问题文本，便于前端展示。 */
  pendingUserPrompt: string | null;
  /** M3 Task 1: ask_user 暂停时停在第几步（0-based），resume 时下一步从这里 +1 接续。 */
  pendingUserStepIdx: number | null;
  /** M4 Task 1: ask_user 暂停的 24h 超时戳；过期由 worker tick 自动 cancel。null 表示无限期等。 */
  pendingUserInputExpiresAt: Date | null;
  /** M4 Task 4: 任务完成时落的聚合摘要（步数 / 工具 / ref 数）；UI 在列表/详情都展示。 */
  summary: RunSummary | null;
  resultMessageId: string | null;
  invokeMessageId: string | null;
  lastHeartbeatAt: Date | null;
  awaitingApprovalUntil: Date | null;
  awaitingApprovalStepIdx: number | null;
  pendingApprovalToolName: string | null;
  cancelledByUserId: string | null;
  cancelReason: CancelReason | null;
  createdAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
};

export type StepKind =
  | 'plan'
  | 'replan'
  | 'critique'
  | 'tool_call'
  | 'tool_error'
  | 'observe'
  // M3 hotfix: 用户对 ask_user 的回答；不属于 plan step 推进，不应被 reclaim 计数。
  // 使用独立 kind 而非 'observe' 可让 recordReclaimIfNeeded 精确过滤。
  | 'user_input'
  | 'reply'
  | 'approval_request'
  | 'approval_grant'
  | 'approval_deny'
  | 'approval_timeout'
  | 'cancel'
  | 'steer'
  // 'reclaim' (M1e task 6) 替代旧的 'heartbeat'：worker 接管 crashed run 时写一条审计步。
  // 老 DB 行里仍可能存在 'heartbeat'，保留为合法值以便读取历史 run。
  | 'reclaim'
  | 'heartbeat'
  | 'system_error';

export type AgentStep = {
  id: string;
  runId: string;
  idx: number;
  kind: StepKind;
  toolName: string | null;
  toolCallKey: string | null;
  input: unknown | null;
  output: unknown | null;
  tokens: number;
  durationMs: number;
  error: string | null;
  byUserId: string | null;
  createdAt: Date;
};

export class AgentCancelled extends Error {
  constructor(public reason: CancelReason) {
    super(`agent run cancelled: ${reason}`);
  }
}

export class AgentBudgetExhausted extends Error {
  constructor(public dimension: 'steps' | 'seconds' | 'tokens') {
    super(`agent budget exhausted on ${dimension}`);
  }
}

/**
 * M4 Task 4：run 完成（含 failed / cancelled / budget_exhausted）时由 buildRunSummary
 * 计算并落到 agent_runs.summary。用于任务面板列表的「N 步 · M 工具 · K 引用」一行摘要。
 *
 * 仅统计 useful step：filter out heartbeat / reclaim / system_error，避免把审计步算进数。
 */
export type RunSummary = {
  /** useful step 总数（含 plan / tool_call / observe / reply / approval_* / steer / user_input） */
  stepCount: number;
  /** distinct tool name 数 */
  toolCount: number;
  /** tool name → call count */
  toolBreakdown: Record<string, number>;
  /** 各 step output.result.citations 累加 */
  refCount: number;
};

export const DEFAULT_BUDGET: AgentBudget = {
  maxSteps: 20,
  maxSeconds: 600,
  maxTokens: 100_000,
};
