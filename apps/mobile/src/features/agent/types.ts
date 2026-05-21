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

// 必须与后端 `apps/api/src/lib/agent/types.ts` 的 StepKind 联合类型对齐（M1e task 6/7）。
export type AgentStepKind =
  | 'plan'
  | 'replan'
  | 'tool_call'
  | 'tool_error'
  | 'observe'
  | 'critique'
  | 'reply'
  | 'steer'
  | 'approval_request'
  | 'approval_grant'
  | 'approval_deny'
  | 'approval_timeout'
  | 'cancel'
  | 'reclaim'
  | 'heartbeat' // 老 run 兼容
  | 'system_error';

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

// M1e task 2：user-facing notice，来自后端 agent_event_logs(event_type='user_facing_notice')。
// 与后端 NoticeCode 联合类型对齐。
export type NoticeCode =
  | 'USER_KEY_MISSING'
  | 'USER_KEY_DECRYPT_FAILED'
  | 'NO_API_KEY'
  | 'RETRY_DEDUPED'
  | 'PLANNER_LLM_FALLBACK'
  | 'REPLY_LLM_FALLBACK'
  | 'SKILL_WARN_KEYWORD'
  | 'SKILL_DROPPED'
  | 'DOC_EXPORT_VERSIONED'
  | 'TOOL_PAYLOAD_TOO_LARGE'
  | 'MCP_HANDSHAKE_FAILED';

export type AgentNoticeSeverity = 'info' | 'warn' | 'error';

export type AgentNotice = {
  id: string;
  runId: string;
  severity: AgentNoticeSeverity;
  code: NoticeCode;
  message: string;
  context?: Record<string, unknown> | null;
  createdAt: string;
};

export type AgentRunWithSteps = {
  run: AgentRun;
  steps: AgentStep[];
  // M1e task 2：可选，老后端无此字段时 UI 走空数组渲染。
  notices?: AgentNotice[];
};
