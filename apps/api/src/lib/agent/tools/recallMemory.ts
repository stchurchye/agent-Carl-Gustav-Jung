import { toolRegistry, type ToolDef } from '../toolRegistry.js';
import {
  magiSystemEnabled,
  type MemorySource,
} from '../../integrations/magi.js';
import { searchMemoryPools } from '../../memoryPools.js';

type RecallMemoryInput = {
  query: string;
};

/**
 * 输出 results[] 形状刻意匹配 replyGen 的 'list' 摘要契约(results 数组 + 每项 .title)。
 * review#15:title 保持**短**(真伪标 + claim)—— 'list' 摘要器把 title 截到 60 字,
 * URL 塞进去会被切掉。来源/真伪走**结构化字段**(sources/truthStatus/...),LLM 经
 * digestTail 全文(每步 ≤4000 字)读到完整出处,可在终稿引用 URL。
 */
type RecalledMemory = {
  title: string;
  id: number;
  score: number;
  sourceRunId: string | null;
  createdAt: string | null;
  /** review#15:结构化出处 —— 不挤进被截断的 title。 */
  sources: MemorySource[] | null;
  truthStatus: 'unverified' | 'disputed' | 'refuted';
  truthNote: string | null;
  counterSources: MemorySource[] | null;
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
      // 双池(修订三读侧):群聊 run 额外查 group:{gid} 共享池,个人池强制 findings-only
      // (隐私:个人 facts 不进群上下文);私聊查个人池全 kind。去重/排序在 helper 内。
      const hits = await searchMemoryPools(ctx.ownerId, ctx.channel, ctx.groupId, input.query, {
        topK: 12,
        signal: ctx.signal,
      });
      const results = hits.map((h) => ({
        // title 短(真伪标 + claim);'list' 摘要器截 60 字,URL 走结构化字段免被切。
        title: `${h.truthStatus === 'refuted' ? '【已证伪】' : h.truthStatus === 'disputed' ? '【有争议】' : ''}${h.text}`,
        id: h.id,
        score: h.score,
        sourceRunId: h.sourceRunId,
        createdAt: h.createdAt,
        sources: h.sources,
        truthStatus: h.truthStatus,
        truthNote: h.truthNote,
        counterSources: h.counterSources,
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
