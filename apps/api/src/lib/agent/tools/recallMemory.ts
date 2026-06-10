import { toolRegistry, type ToolDef } from '../toolRegistry.js';
import {
  searchAgentMemory,
  magiSystemEnabled,
  type MemoryHit,
} from '../../integrations/magi.js';
import { groupPoolOwner } from '../../memoryOwner.js';

type RecallMemoryInput = {
  query: string;
};

/**
 * 输出 results[] 形状刻意匹配 replyGen 的 'list' 摘要契约(results 数组 + 每项 .title);
 * title = fact 文本(可读标签)。否则召回结果在终稿里会被 fallback 成 JSON 串。
 */
type RecalledMemory = {
  title: string;
  id: number;
  score: number;
  sourceRunId: string | null;
  createdAt: string | null;
};

type RecallMemoryOutput = {
  ok: boolean;
  results: RecalledMemory[];
  enabled: boolean;
  error?: string;
};

/**
 * Agent 长期记忆(情景/语义层)按需召回。Tier A:auto + idempotent + 只读。
 *
 * - owner 锁定:**只用 ctx.ownerId**(run-owner),绝不信 input —— 群聊 run 不跨成员(plan §5.2)。
 * - fail-open:MAGI 未启用/HTTP 错 → 返空 + 不抛(仿 magi_system_read),让 planner 不依赖历史继续。
 * - AbortError 透传,让 runtime 看到 cancel。
 * - 与 magi_system_read 不混:后者打研究知识库,本工具打 agent 自己的情景记忆表。
 */
/**
 * K6:召回条目渲染 —— finding 带来源行(LLM 可直接复引 URL);真伪标前置
 * (【已证伪】/【有争议】+ 反证),"记得它是伪的"和结论本身同样是知识。
 */
function renderHitTitle(h: MemoryHit): string {
  const truthTag =
    h.truthStatus === 'refuted' ? '【已证伪】' : h.truthStatus === 'disputed' ? '【有争议】' : '';
  const srcLine =
    h.sources && h.sources.length > 0
      ? ` —— 来源: ${h.sources
          .map((s) => `${s.title ?? ''}${s.year ? ` (${s.year})` : ''} ${s.url}`.trim())
          .join('; ')}`
      : '';
  const truthLine =
    truthTag && (h.truthNote || h.counterSources?.length)
      ? `(${[h.truthNote, h.counterSources?.map((c) => c.url).join(' ')].filter(Boolean).join(' 反证: ')})`
      : '';
  return `${truthTag}${h.text}${srcLine}${truthLine ? ` ${truthLine}` : ''}`;
}

export const recallMemoryTool: ToolDef<RecallMemoryInput, RecallMemoryOutput> = {
  name: 'recall_memory',
  description:
    "Recall the user's long-term memory: past conversations, learned facts, AND prior research conclusions with their sources (papers/URLs). Use for \"did we discuss/research X before / what do I already know\" questions. Refuted/disputed findings are returned with warning tags — treat them accordingly.",
  inputSchema: {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string', description: '自然语言检索词' },
    },
  },
  approvalMode: 'auto',
  costHint: 'low',
  hasSideEffects: false,
  idempotent: true,
  replyMeta: {
    summaryKind: 'list',
    failureHint: '长期记忆暂不可用(MAGI 未开启或故障)。可不依赖历史记忆继续。',
  },
  computeIdempotencyKey: (input) =>
    `recall:${(input as RecallMemoryInput).query.trim().slice(0, 256)}`,
  async handler(input, ctx) {
    const enabled = magiSystemEnabled();
    try {
      // owner 锁定 ctx.ownerId —— 绝不用 input 里的 owner。
      // K6 双池(修订三读侧):群聊 run 额外查 group:{gid} 共享池(成员触发的研究互相可见),
      // 按 score 归并去重;私聊只查个人池(谁也看不到别人的群池)。
      const pools: Promise<MemoryHit[]>[] = [
        searchAgentMemory(ctx.ownerId, input.query, 12, ctx.signal),
      ];
      if (ctx.channel === 'group' && ctx.groupId) {
        pools.push(
          searchAgentMemory(groupPoolOwner(ctx.groupId), input.query, 12, ctx.signal),
        );
      }
      const seen = new Set<string>();
      const hits = (await Promise.all(pools))
        .flat()
        .sort((a, b) => b.score - a.score)
        .filter((h) => {
          const key = `${h.id}:${h.text}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 12);
      const results = hits.map((h) => ({
        title: renderHitTitle(h), // 'list' 摘要器取 .title 渲染
        id: h.id,
        score: h.score,
        sourceRunId: h.sourceRunId,
        createdAt: h.createdAt,
      }));
      return { ok: true, results, enabled };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      const error = e instanceof Error ? e.message : String(e);
      return { ok: false, results: [], enabled, error };
    }
  },
};

export function registerRecallMemory(): void {
  if (!toolRegistry.get(recallMemoryTool.name)) {
    toolRegistry.register(recallMemoryTool);
  }
}
