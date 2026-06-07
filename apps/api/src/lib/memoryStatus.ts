/**
 * 情景记忆质量门:confidence → status 分流(plan §M2b 洞E)。
 * 阈值是**待校准参数**(LLM 自评校准差,MVP 起步保守);单点定义,distill/reconcile 共用,防漂移。
 */
export const AUTO_APPROVE_THRESHOLD = 0.85;

export function statusForConfidence(confidence: number): 'approved' | 'pending' {
  return confidence >= AUTO_APPROVE_THRESHOLD ? 'approved' : 'pending';
}
