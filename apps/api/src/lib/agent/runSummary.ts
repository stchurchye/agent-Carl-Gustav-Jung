/**
 * M4 Task 4：run 完成时算的"一行摘要"。
 *
 * 调用点：runLifecycle.softComplete（completed / failed / cancelled / budget_exhausted
 * 都会跑），结果写到 agent_runs.summary JSONB 列（migration 019 添加）。
 *
 * 仅统计 useful step：heartbeat / reclaim / system_error 都是审计 / 故障维护类，
 * 用户不关心。tool_call 中 toolName=null 的不计入 toolBreakdown，但仍计入 stepCount。
 */
import type { AgentStep, StepKind, RunSummary } from './types.js';

const NOISE_KINDS: StepKind[] = ['heartbeat', 'reclaim', 'system_error'];

export function buildRunSummary(steps: AgentStep[]): RunSummary {
  const useful = steps.filter((s) => !NOISE_KINDS.includes(s.kind));
  const toolBreakdown: Record<string, number> = {};
  let refCount = 0;
  for (const s of useful) {
    if (s.kind === 'tool_call' && s.toolName) {
      toolBreakdown[s.toolName] = (toolBreakdown[s.toolName] ?? 0) + 1;
    }
    // Extract output.result.citations.length
    const out = s.output;
    if (out && typeof out === 'object') {
      const result = (out as { result?: unknown }).result;
      if (result && typeof result === 'object') {
        const citations = (result as { citations?: unknown }).citations;
        if (Array.isArray(citations)) {
          refCount += citations.length;
        }
      }
    }
  }
  return {
    stepCount: useful.length,
    toolCount: Object.keys(toolBreakdown).length,
    toolBreakdown,
    refCount,
  };
}
