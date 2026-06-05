import { toolRegistry, type ToolDef } from '../toolRegistry.js';
import {
  searchAgentMemory,
  magiSystemEnabled,
  type MemoryHit,
} from '../../integrations/magi.js';

type RecallMemoryInput = {
  query: string;
};

type RecallMemoryOutput = {
  ok: boolean;
  hits: MemoryHit[];
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
    "Recall the user's long-term memory of past conversations and learned facts. Use for \"did we discuss X before / what do I already know about the user's history\" questions.",
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
      // owner 锁定 ctx.ownerId —— 绝不用 input 里的 owner
      const hits = await searchAgentMemory(ctx.ownerId, input.query, 12, ctx.signal);
      return { ok: true, hits, enabled };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      const error = e instanceof Error ? e.message : String(e);
      return { ok: false, hits: [], enabled, error };
    }
  },
};

export function registerRecallMemory(): void {
  if (!toolRegistry.get(recallMemoryTool.name)) {
    toolRegistry.register(recallMemoryTool);
  }
}
