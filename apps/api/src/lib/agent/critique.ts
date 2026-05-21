import type { AgentStep, Plan } from './types.js';

export type CritiqueReason = 'periodic' | 'consecutive_failures';

export type CritiqueInput = {
  plan: Plan;
  recentSteps: AgentStep[];
  reason: CritiqueReason;
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
 * M1b-2 规则化 stub（spec §9.4 接口 1:1 保持，M1c 接入 LLM 时仅替换实现）：
 * - reason='consecutive_failures'：最近 4 step 内 >= 2 次 tool 失败（hard or soft）
 *   → shouldReplan
 * - reason='periodic'：M1b 始终返回 false（缺真 LLM 评估能力）
 */
export function runCritique(input: CritiqueInput): CritiqueOutput {
  if (input.reason === 'consecutive_failures') {
    const tail = input.recentSteps.slice(-4);
    const failures = tail.filter(isToolFailure);
    if (failures.length >= 2) {
      return {
        shouldReplan: true,
        reason: '连续两次工具失败,建议重规划',
      };
    }
  }
  return { shouldReplan: false, reason: 'no action needed' };
}
