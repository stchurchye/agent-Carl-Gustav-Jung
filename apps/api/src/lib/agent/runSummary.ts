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
import { toolRegistry, type ToolDef } from './toolRegistry.js';
import { collectReplyRefs } from './replyGen.js';

const NOISE_KINDS: StepKind[] = ['heartbeat', 'reclaim', 'system_error'];

export function buildRunSummary(
  steps: AgentStep[],
  /** P0-S7:refCount 改并集(citations + 结构化 ReplyRef);测试可注入,默认取注册表。 */
  toolMap: Map<string, ToolDef> = new Map(toolRegistry.list().map((t) => [t.name, t])),
): RunSummary {
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
  // P0-S7:此前 refCount 只数 deep_research 式 citations,搜索/文档的结构化 ReplyRef
  // (extractRef/extractRefs)完全不计 —— 改为并集(两类来源相加;ReplyRef 内部已按 kind:id 去重)。
  refCount += collectReplyRefs(useful, toolMap).length;
  return {
    stepCount: useful.length,
    toolCount: Object.keys(toolBreakdown).length,
    toolBreakdown,
    refCount,
  };
}
