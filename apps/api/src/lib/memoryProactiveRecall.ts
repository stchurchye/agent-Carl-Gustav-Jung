import { searchAgentMemory } from './integrations/magi.js';

/** 主动召回(plan §M4g / ADR M4-4)。注入 context 前同步拉,故全部参数从严:小池 + 高阈值 + 紧超时。 */
const PROACTIVE_TOP_K = 3;
const PROACTIVE_MIN_SCORE = 0.6; // 余弦相似度阈值,滤掉弱匹配噪声
const PROACTIVE_TIMEOUT_MS = 800; // 热路径:MAGI 慢于此即放弃(不阻塞回复)

/**
 * 用当前用户消息主动召回 top-K approved 情景记忆,格式化为 `<proactive_memory>` 块注入 context。
 * 不需 agent 调工具(对比 recall_memory 是 pull)。已升格事实由 MAGI search 侧 promoted_at 排除。
 *
 * **绝不阻塞、绝不抛**:空 query / 未启用 / MAGI 慢或挂 / 取消 → 一律返回 ''(fail-open)。
 * 紧超时:proactive 是纯增益,慢了就跳过,不拖累用户回复延迟。
 */
export async function resolveProactiveRecall(
  ownerId: string,
  query: string | undefined,
  parentSignal?: AbortSignal,
): Promise<string> {
  if (!query || !query.trim()) return '';
  try {
    const timeout = AbortSignal.timeout(PROACTIVE_TIMEOUT_MS);
    const signal = parentSignal ? AbortSignal.any([parentSignal, timeout]) : timeout;
    const hits = await searchAgentMemory(ownerId, query, PROACTIVE_TOP_K, signal, false);
    const strong = hits.filter((h) => h.score >= PROACTIVE_MIN_SCORE);
    if (strong.length === 0) return '';
    const lines = strong.map((h) => `- ${h.text}`).join('\n');
    return `<proactive_memory>\n基于当前消息,可能相关的长期记忆:\n${lines}\n</proactive_memory>`;
  } catch {
    // fail-open:慢/挂/取消都不阻塞 context 组装(proactive 是纯增益)
    return '';
  }
}
