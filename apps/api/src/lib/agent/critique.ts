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
 * M1b-2 规则化 stub（spec §9.4 接口 1:1 保持，M1c 接入 LLM 时仅替换实现）：
 * - reason='consecutive_failures'：最近 4 step 内 >= 2 次 tool_error → shouldReplan
 * - reason='periodic'：M1b 始终返回 false（缺真 LLM 评估能力）
 */
export function runCritique(input: CritiqueInput): CritiqueOutput {
  if (input.reason === 'consecutive_failures') {
    const tail = input.recentSteps.slice(-4);
    const failures = tail.filter((s) => s.kind === 'tool_error');
    if (failures.length >= 2) {
      return {
        shouldReplan: true,
        reason: '连续两次工具失败,建议重规划',
      };
    }
  }
  return { shouldReplan: false, reason: 'no action needed' };
}
