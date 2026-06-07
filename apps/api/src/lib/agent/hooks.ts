import { EventEmitter } from 'events';
import type { AgentRun, AgentRunStatus, AgentStep } from './types.js';

/**
 * Agent 事件总线（spec §14 命名映射）：
 * - run.started        ↔ run_started
 * - run.completed      ↔ run_completed
 * - run.failed         ↔ run_failed
 * - run.cancelled      ↔ run_cancelled
 * - run.budget_exhausted ↔ run_budget_exhausted
 * - step.recorded      ↔ step_recorded
 *
 * 命名风格用 `domain.event`，方便 M1c 加 pre_tool_use / approval_requested 时
 * 保持过滤器友好。
 */
export type AgentHookEvent =
  | { type: 'run.started'; run: AgentRun }
  | { type: 'run.completed'; run: AgentRun }
  | { type: 'run.failed'; run: AgentRun; error: string }
  | { type: 'run.cancelled'; run: AgentRun; byUserId: string | null }
  | { type: 'run.budget_exhausted'; run: AgentRun; resource: string }
  | { type: 'step.recorded'; runId: string; step: AgentStep }
  // M7：状态-only 变化 + 出队 + ask_user 升级 + 追问入队
  | { type: 'run.status_changed'; run: AgentRun; from: AgentRunStatus; to: AgentRunStatus }
  | { type: 'run.dequeued'; run: AgentRun }
  | { type: 'ask_user.opened_for_all'; runId: string; run: AgentRun }
  | { type: 'run.merged_input_appended'; runId: string; mergedInputsCount: number };

class AgentHookBus extends EventEmitter {
  emitEvent(e: AgentHookEvent) {
    this.emit('agent.event', e);
  }
  onEvent(handler: (e: AgentHookEvent) => void): () => void {
    this.on('agent.event', handler);
    return () => this.off('agent.event', handler);
  }
}

export const agentHookBus = new AgentHookBus();
agentHookBus.setMaxListeners(50);
