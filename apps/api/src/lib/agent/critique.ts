import type { AgentStep, MergedInput, Plan } from './types.js';

export type CritiqueReason = 'periodic' | 'consecutive_failures' | 'low_signal_search';

export type CritiqueInput = {
  plan: Plan;
  recentSteps: AgentStep[];
  reason: CritiqueReason;
  /** M7 P3：未消化的追问；当前实现仅 append 到 output.reason 字符串便于调试。 */
  mergedInputs?: MergedInput[];
};

export type CritiqueOutput = {
  shouldReplan: boolean;
  reason: string;
  adjustment?: Partial<Plan>;
};

/**
 * M1f Task 3 followup（review blocker 1）：统一"工具失败"判定。
 *
 * 历史上 critique gate 只看 `kind === 'tool_error'`，但 M1f #5 引入 soft-fail
 * 后，HTTP 4xx/5xx 等可恢复错误改写到 `kind: 'tool_call'` + `error` 字段。
 * 如果 gate 还只 count `tool_error`，soft-failed 步骤永远进不了 critique，
 * planner 也就没机会 replan —— 多步全 soft-fail 会一路 completed。
 *
 * 这个谓词把两种都算上：
 * - 老 hard-fail：runtime 抛错且重试 2 次仍失败 → `kind: 'tool_error'`
 * - 新 soft-fail：tool 返回 `{ ok: false, error }` → `kind: 'tool_call'` + 非空 error
 */
export function isToolFailure(s: AgentStep): boolean {
  if (s.kind === 'tool_error') return true;
  if (s.kind === 'tool_call' && s.error != null && s.error !== '') return true;
  return false;
}

/**
 * R2-3:低信号搜索步 —— 工具调用本身成功(无 error,不与 isToolFailure 重叠),
 * 但 R1-2 质量信号判定结果不可用:empty(0 结果)/ low_relevance(全是 score<0.3 垃圾)。
 * fallback_loose 不算:CrossRef 宽匹配结果可能仍相关,由 LLM 自行核对。
 */
export function isLowSignalSearch(s: AgentStep): boolean {
  if (s.kind !== 'tool_call') return false;
  if (s.error != null && s.error !== '') return false; // soft-fail 归 isToolFailure 管
  const inner = (s.output as { result?: unknown } | null)?.result ?? s.output;
  const quality = (inner as { quality?: unknown } | null)?.quality;
  return quality === 'empty' || quality === 'low_relevance';
}

/**
 * M1b-2 规则化 stub（spec §9.4 接口 1:1 保持，M1c 接入 LLM 时仅替换实现）：
 * - reason='consecutive_failures'：最近 4 step 内 >= 2 次 tool 失败（hard or soft）
 *   → shouldReplan
 * - reason='periodic'：M1b 始终返回 false（缺真 LLM 评估能力）
 */
export function runCritique(input: CritiqueInput): CritiqueOutput {
  // M7 P3：仅作调试提示，不改变现有规则判定。
  const mergedHint =
    input.mergedInputs && input.mergedInputs.length > 0
      ? ` [merged_inputs=${input.mergedInputs.length}]`
      : '';
  if (input.reason === 'consecutive_failures') {
    const tail = input.recentSteps.slice(-4);
    const failures = tail.filter(isToolFailure);
    if (failures.length >= 2) {
      return {
        shouldReplan: true,
        reason: '连续两次工具失败,建议重规划' + mergedHint,
      };
    }
  }
  // R2-3:连续低信号搜索(空/低相关垃圾)→ 重规划改写查询,别把剩余步骤浪费在错误的关键词上。
  if (input.reason === 'low_signal_search') {
    const tail = input.recentSteps.slice(-4);
    const lowSignal = tail.filter(isLowSignalSearch);
    if (lowSignal.length >= 2) {
      return {
        shouldReplan: true,
        reason:
          '连续搜索无有效结果(0 结果或全为低相关垃圾),需改写查询:换关键词/同义词/另一种语言再规划' +
          mergedHint,
      };
    }
  }
  return { shouldReplan: false, reason: 'no action needed' + mergedHint };
}
