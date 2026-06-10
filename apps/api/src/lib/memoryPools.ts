import {
  searchAgentMemory,
  type MemoryHit,
  type MemoryKind,
} from './integrations/magi.js';
import { groupPoolOwner } from './memoryOwner.js';

/**
 * K 战役 review:记忆**读侧**池规则与渲染的单一真相(写侧在 memoryOwner.ts)。
 * 此前 recallMemory 与 priorResearch 各自内联一份双池+去重+渲染,已出现语义漂移
 * (去重键、反证渲染、score 排序)。集中到一处。
 */

/**
 * 双池检索 + 归并去重。
 * - 私聊:只查个人池(ownerId);**群聊:个人池 + group:{gid} 共享池**。
 * - **隐私底线**:群聊里个人池只取 findings(世界知识),个人 facts 绝不进群上下文渲染
 *   (facts 永远私有,见 memoryOwner)。私聊不限(facts+findings 都是自己的)。
 * - 去重按 `kind:text`(**非 id** —— 跨池同一结论是不同行不同 id,id 去重永不命中);
 *   按 score 降序保留高分。
 */
export async function searchMemoryPools(
  ownerId: string,
  channel: 'private' | 'group',
  groupId: string | null | undefined,
  query: string,
  opts: {
    topK: number;
    signal?: AbortSignal;
    includePending?: boolean;
    /** 私聊个人池的 kind 过滤(默认全 kind);群聊一律强制 findings-only(隐私)。 */
    kinds?: MemoryKind[];
    minScore?: number;
  },
): Promise<MemoryHit[]> {
  const isGroup = channel === 'group' && !!groupId;
  const personalKinds = isGroup ? (['finding'] as MemoryKind[]) : opts.kinds;
  const pools: Promise<MemoryHit[]>[] = [
    searchAgentMemory(ownerId, query, opts.topK, opts.signal, opts.includePending ?? false, personalKinds),
  ];
  if (isGroup) {
    pools.push(
      searchAgentMemory(groupPoolOwner(groupId!), query, opts.topK, opts.signal, opts.includePending ?? false, [
        'finding',
      ]),
    );
  }
  const seen = new Set<string>();
  return (await Promise.all(pools))
    .flat()
    .filter((h) => (opts.minScore == null ? true : h.score >= opts.minScore))
    .sort((a, b) => b.score - a.score)
    .filter((h) => {
      const key = `${h.kind}:${h.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, opts.topK);
}

/** 真伪标:refuted/disputed 前置警示,"记得它是伪的"和结论本身同样是知识。 */
export function truthTag(h: Pick<MemoryHit, 'truthStatus'>): string {
  return h.truthStatus === 'refuted' ? '【已证伪】' : h.truthStatus === 'disputed' ? '【有争议】' : '';
}

/** 来源行:`Title (1992) url; …`(无来源返空)。 */
export function renderSources(sources: MemoryHit['sources']): string {
  if (!sources || sources.length === 0) return '';
  return sources
    .map((s) => `${s.title ?? ''}${s.year ? ` (${s.year})` : ''} ${s.url}`.trim())
    .join('; ');
}

/**
 * 单条记忆命中渲染(recall 输出 / prior_research 注入共用)。
 * opts.withCounterSources:带反证(refuted/disputed 时);opts.withDate:带记录日期。
 */
export function renderMemoryHit(
  h: MemoryHit,
  opts?: { withCounterSources?: boolean; withDate?: boolean },
): string {
  const tag = truthTag(h);
  const src = renderSources(h.sources);
  const srcPart = src ? ` —— 来源: ${src}` : '';
  const counter =
    opts?.withCounterSources && tag && (h.truthNote || h.counterSources?.length)
      ? ` (${[h.truthNote, h.counterSources?.length ? `反证: ${renderSources(h.counterSources)}` : '']
          .filter(Boolean)
          .join(' ')})`
      : tag && h.truthNote
        ? ` — ${h.truthNote}`
        : '';
  const date = opts?.withDate && h.createdAt ? ` [记录于 ${h.createdAt.slice(0, 10)}]` : '';
  return `${tag}${h.text}${srcPart}${counter}${date}`;
}
