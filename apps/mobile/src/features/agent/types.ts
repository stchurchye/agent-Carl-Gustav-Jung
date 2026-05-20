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

export type AgentRun = {
  id: string;
  ownerId: string;
  channel: 'private' | 'group';
  status: AgentRunStatus;
  inputText: string;
  todos: AgentTodo[];
  pendingApprovalToolName: string | null;
  awaitingApprovalUntil: string | null;
  // 其他后端字段 (plan / budget / usage 等) 按需扩展;
  // M1b-3 UI 暂时只依赖 status / inputText / todos / approval 字段。
};

export type AgentRunWithSteps = {
  run: AgentRun;
  steps: AgentStep[];
};
