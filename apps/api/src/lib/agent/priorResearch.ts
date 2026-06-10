import { searchAgentMemory, type MemoryHit } from '../integrations/magi.js';
import { groupPoolOwner } from '../memoryOwner.js';

/**
 * K6:prior_research 开局预取 —— "站在之前研究肩膀上"的唯一强制落点。
 * 靠 planner 自觉调 recall_memory 不可靠(要花一步、经常想不起来);首次规划前
 * 自动查 findings 注入 `<prior_research>` 块,planner 第 0 步就知道"上次查到哪了"。
 *
 * 仿 memoryProactiveRecall 成熟模式:小池 + 高阈值 + 紧超时;**绝不阻塞、绝不抛**
 * (空 query/未启用/慢/挂 → 一律 '')。只查 kind=finding(个人 facts 不污染研究上下文);
 * 群聊 run 双池(个人 + group:{gid})归并。refuted/disputed 条目带警示渲染 ——
 * 知道"这条路是错的"正是防止重复走弯路的价值。
 */
const PRIOR_TOP_K = 5;
const PRIOR_MIN_SCORE = 0.6;
const PRIOR_TIMEOUT_MS = 800;

function renderLine(h: MemoryHit): string {
  const truthTag =
    h.truthStatus === 'refuted' ? '【已证伪】' : h.truthStatus === 'disputed' ? '【有争议】' : '';
  const src =
    h.sources && h.sources.length > 0
      ? ` (来源: ${h.sources
          .map((s) => `${s.title ?? ''}${s.year ? ` (${s.year})` : ''} ${s.url}`.trim())
          .join('; ')})`
      : '';
  const note = truthTag && h.truthNote ? ` — ${h.truthNote}` : '';
  const at = h.createdAt ? ` [记录于 ${h.createdAt.slice(0, 10)}]` : '';
  return `- ${truthTag}${h.text}${src}${note}${at}`;
}

export async function resolvePriorResearch(
  ownerId: string,
  inputText: string | undefined,
  channel: 'private' | 'group',
  groupId?: string | null,
  parentSignal?: AbortSignal,
): Promise<string> {
  if (!inputText || !inputText.trim()) return '';
  try {
    const timeout = AbortSignal.timeout(PRIOR_TIMEOUT_MS);
    const signal = parentSignal ? AbortSignal.any([parentSignal, timeout]) : timeout;
    const pools = [
      searchAgentMemory(ownerId, inputText, PRIOR_TOP_K, signal, false, ['finding']),
    ];
    if (channel === 'group' && groupId) {
      pools.push(
        searchAgentMemory(groupPoolOwner(groupId), inputText, PRIOR_TOP_K, signal, false, [
          'finding',
        ]),
      );
    }
    const seen = new Set<number>();
    const strong = (await Promise.all(pools))
      .flat()
      .filter((h) => h.score >= PRIOR_MIN_SCORE)
      .sort((a, b) => b.score - a.score)
      .filter((h) => (seen.has(h.id) ? false : (seen.add(h.id), true)))
      .slice(0, PRIOR_TOP_K);
    if (strong.length === 0) return '';
    const lines = strong.map(renderLine).join('\n');
    return (
      `<prior_research>\n此前研究已沉淀的相关结论(可直接复用、避免重复检索;` +
      `仅供起点,关键结论需复核;带【已证伪】/【有争议】标记的按其警示对待):\n${lines}\n</prior_research>`
    );
  } catch {
    // fail-open:预取是纯增益,慢/挂不阻塞规划
    return '';
  }
}
