import { toolRegistry, type ToolDef } from '../toolRegistry.js';
import { queryMagiSystem, magiSystemEnabled } from '../../integrations/magi.js';

type MagiSystemReadInput = {
  question: string;
};

type MagiSystemReadOutput = {
  ok: boolean;
  answer: string;
  enabled: boolean;
  error?: string;
};

/**
 * MAGI 知识库只读查询。Tier A：auto + idempotent。
 *
 * - 未开启 MAGI_SYSTEM_ENABLED 时，返回友好 stub 文本而非抛错，
 *   方便 planner 改用其他工具继续 plan。
 * - idempotencyKey 用 question 文本做去重；同 run 内重复问同一句立即命中缓存。
 */
export const magiSystemReadTool: ToolDef<MagiSystemReadInput, MagiSystemReadOutput> = {
  name: 'magi_system_read',
  description:
    'Query the user\'s MAGI knowledge base. Use for "what does the user already know about X" type questions.',
  inputSchema: {
    type: 'object',
    required: ['question'],
    properties: {
      question: { type: 'string', description: '自然语言问题' },
    },
  },
  approvalMode: 'auto',
  costHint: 'low',
  hasSideEffects: false,
  idempotent: true,
  replyMeta: {
    summaryKind: 'text',
    failureHint: 'MAGI 内部 API 故障或未开启。可改用 web_search 走公开来源，或直接告诉用户 MAGI 暂不可用。',
  },
  computeIdempotencyKey: (input) =>
    `q:${(input as MagiSystemReadInput).question.trim().slice(0, 256)}`,
  async handler(input, ctx) {
    const enabled = magiSystemEnabled();
    try {
      const answer = await queryMagiSystem(input.question, ctx.signal);
      return { ok: true, answer, enabled };
    } catch (e) {
      // M1f #5：AbortError 透传，让 runtime 看到 cancel；其它错误 soft-fail。
      if (e instanceof Error && e.name === 'AbortError') throw e;
      const msg = e instanceof Error ? e.message : String(e);
      // M1f Task 3 followup（reviewer F2）：原本 answer = `MAGI 查询失败：${msg}`
      // 会被 replyGen text-summary 拉进用户终稿（"已为你做了：MAGI 查询失败：connection refused"），
      // 把内部 upstream 错误暴露给用户。soft-fail 的语义是"planner 看 error 决定 replan"，
      // 用户不该看到原始上游错误。这里 answer 改空串：replyGen 的 default-text kind 会
      // 把空字符串截到长度 0，等价 silent；planner 仍通过 step.error 看到原因。
      return {
        ok: false,
        answer: '',
        enabled,
        error: msg,
      };
    }
  },
};

export function registerMagiSystemRead(): void {
  if (!toolRegistry.get(magiSystemReadTool.name)) {
    toolRegistry.register(magiSystemReadTool);
  }
}
