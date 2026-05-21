export type AgentRole = 'generalist';

export type AgentRunStatus =
  | 'draft'
  | 'planning'
  | 'awaiting_confirm'
  | 'awaiting_approval'
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

export const DEFAULT_BUDGET: AgentBudget = {
  maxSteps: 20,
  maxSeconds: 600,
  maxTokens: 100_000,
};
