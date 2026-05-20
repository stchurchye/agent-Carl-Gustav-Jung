import { toolRegistry, type ToolDef } from '../toolRegistry.js';
import { queryMagiSystem, magiSystemEnabled } from '../../integrations/magi.js';

type MagiSystemReadInput = {
  question: string;
};

type MagiSystemReadOutput = {
  answer: string;
  enabled: boolean;
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
  computeIdempotencyKey: (input) =>
    `q:${(input as MagiSystemReadInput).question.trim().slice(0, 256)}`,
  async handler(input) {
    const enabled = magiSystemEnabled();
    try {
      const answer = await queryMagiSystem(input.question);
      return { answer, enabled };
    } catch (e) {
      // 网络/上游故障 → 给 planner 一个明确信号但不让 run 整体失败
      return {
        answer: `MAGI 查询失败：${e instanceof Error ? e.message : String(e)}`,
        enabled,
      };
    }
  },
};

export function registerMagiSystemRead(): void {
  if (!toolRegistry.get(magiSystemReadTool.name)) {
    toolRegistry.register(magiSystemReadTool);
  }
}
