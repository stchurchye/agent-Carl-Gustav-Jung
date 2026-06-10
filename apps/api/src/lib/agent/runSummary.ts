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
  // P0-S7:refCount = citations + 结构化 ReplyRef 的**真并集**(按 kind:id 去重)。
  // 不能简单相加:get_paper_citations 同时有 citations 字段和 extractRefs(同一批论文)
  // 会双计(review S7 #1)。kind/id 缺失的 citation 用合成 key 仍计 1。
  const refKeys = new Set<string>();
  let syntheticIdx = 0;
  for (const s of useful) {
    if (s.kind === 'tool_call' && s.toolName) {
      toolBreakdown[s.toolName] = (toolBreakdown[s.toolName] ?? 0) + 1;
    }
    const out = s.output;
    if (out && typeof out === 'object') {
      const result = (out as { result?: unknown }).result;
      if (result && typeof result === 'object') {
        const citations = (result as { citations?: unknown }).citations;
        if (Array.isArray(citations)) {
          for (const c of citations) {
            const kind = (c as { kind?: unknown })?.kind;
            const id = (c as { id?: unknown })?.id;
            const url = (c as { url?: unknown })?.url;
            // key 优先级:kind:id(SubagentCitation 形)→ url:<url>(Paper 形,与 extractRefs
            // 的 url ref 同 key 空间,get_paper_citations 双源才能真去重)→ 合成 key 兜底计 1。
            refKeys.add(
              typeof kind === 'string' && typeof id === 'string'
                ? `${kind}:${id}`
                : typeof url === 'string' && url.length > 0
                  ? `url:${url}`
                  : `__synthetic:${syntheticIdx++}`,
            );
          }
        }
      }
    }
  }
  for (const r of collectReplyRefs(useful, toolMap)) {
    refKeys.add(`${r.kind}:${r.id}`);
  }
  return {
    stepCount: useful.length,
    toolCount: Object.keys(toolBreakdown).length,
    toolBreakdown,
    refCount: refKeys.size,
  };
}
