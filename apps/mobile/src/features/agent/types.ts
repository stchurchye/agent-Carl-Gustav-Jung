export type AgentRunStatus =
  | 'draft'
  | 'awaiting_confirm'
  | 'planning'
  | 'running'
  | 'awaiting_approval'
  | 'replanning'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'budget_exhausted';

export type AgentStepKind =
  | 'plan'
  | 'tool_call'
  | 'tool_error'
  | 'observe'
  | 'critique'
  | 'reply'
  | 'steer'
  | 'approval_request'
  | 'approval_grant'
  | 'approval_deny'
  | 'approval_timeout';

export type AgentStep = {
  id: string;
  runId: string;
  idx: number;
  kind: AgentStepKind;
  toolName: string | null;
  input: unknown;
  output: unknown;
  error: string | null;
  byUserId: string | null;
  createdAt: string;
};

/**
 * 必须与后端 `apps/api/src/lib/agent/types.ts` 的 TodoItem 精确对齐。
 * 后端 M1a planner 已经使用：
 *   status: 'pending' | 'in_progress' | 'completed' | 'skipped' | 'failed'
 *   stepRefs: string[]   ← UUID 字符串
 */
export type AgentTodoStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'skipped'
  | 'failed';

export type AgentTodo = {
  id: string;
  text: string;
  status: AgentTodoStatus;
  stepRefs: string[];
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
  channel: 'private' | 'group';
  status: AgentRunStatus;
  inputText: string;
  todos: AgentTodo[];
  pendingApprovalToolName: string | null;
  awaitingApprovalUntil: string | null;
  // M1d T14：budget_exhausted UI 渲染需要 usage + budget。
  budget: AgentBudget;
  usage: AgentUsage;
  // 其他后端字段 (plan / cancelReason 等) 按需扩展。
};

export type AgentRunWithSteps = {
  run: AgentRun;
  steps: AgentStep[];
};
