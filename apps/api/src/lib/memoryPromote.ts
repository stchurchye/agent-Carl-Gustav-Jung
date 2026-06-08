import { promoteAgentMemory, unpromoteAgentMemory } from './integrations/magi.js';
import * as intel from '../store/pg-intelligence.js';

/**
 * 升格通道(plan §M4h / ADR M4-3)。把一条 MAGI 情景事实升格进**原生 always-on 核心记忆**。
 * 流程:MAGI compare-and-set promoted_at(权威拿回 text) → 写原生 user-scope fragment。
 *
 * - **text 一律来自 MAGI**(权威),不接受调用方传入 → 防注入任意原生记忆;owner 由可信调用方
 *   (JWT userId)传入。
 * - **幂等**靠 MAGI 的 promoted_at compare-and-set:已升格 → promoted=false,不重复写原生。
 * - 顺序 promote-first:promoted_at 一旦置上,该事实即从 episodic search 排除(M4d),不双重浮现。
 *   原生写入是本地 DB(可靠);极端"已 promote 但原生写失败"由本地 DB 故障导致,概率极低。
 */
export async function promoteMemoryToNative(
  userId: string,
  id: number,
  signal?: AbortSignal,
): Promise<{ promoted: boolean; fragmentId?: string }> {
  const { promoted, text } = await promoteAgentMemory(userId, id, signal);
  if (!promoted || !text) return { promoted: false };

  const title = text.length <= 24 ? text : `${[...text].slice(0, 24).join('')}…`;
  try {
    const { fragment } = await intel.createMemoryFragment({
      userId,
      scope: 'user',
      category: 'general',
      title,
      content: text,
      source: 'import',
      status: 'active',
    });
    return { promoted: true, fragmentId: fragment.id };
  } catch (e) {
    // 补偿(code-review #1):MAGI 已置 promoted_at 但原生写失败 → 回滚 promoted_at,
    // 使事实重回 episodic search 且可重升格,避免两层皆失、幂等锁死。回滚 best-effort。
    try {
      await unpromoteAgentMemory(userId, id, signal);
    } catch {
      // 回滚也失败:promoted_at 残留,需 ops 手工清(已尽力);仍抛原始错误让调用方知晓
    }
    throw e;
  }
}
