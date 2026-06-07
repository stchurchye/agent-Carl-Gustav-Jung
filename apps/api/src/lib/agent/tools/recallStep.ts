import { toolRegistry, type ToolDef } from '../toolRegistry.js';
import { getStepByIdx } from '../store.js';
import { redactSecrets } from '../redact.js';

/**
 * Fix 2（旧内容回取）：Claude-Code "re-Read" 的同款——按 stepIdx 取回本 run 某一步的
 * **原始结构化全文**。用于：某步已滚出近窗（digestTail 仅最近 8 步），但其完整细节
 * （精确数据/报错/返回结构）现在又需要时，模型据 digestTail 里的 [步骤 N] 标注重读。
 *
 * 为什么不建检索栈：agent_steps.output 已永久无损存全文，listSteps 已能按 idx 取——
 * 零迁移、零扩展、零 embedding，且拿到的是真·结构化全文（非脱敏纯文本投影）。
 *
 * 安全：output 落库未脱敏 → 返回前 redactSecrets；listSteps(ctx.runId) 天然限当前 run，
 * 绝不跨 run/跨用户。
 */

type RecallStepInput = { stepIdx: number; offset?: number };

type RecallStepOutput =
  | { ok: true; found: false; stepIdx: number; note: string }
  | {
      ok: true;
      found: true;
      stepIdx: number;
      toolName: string | null;
      kind: string;
      content: string;
      offset: number;
      hasMore: boolean;
      totalChars: number;
      note?: string;
    };

const RECALL_PAGE_CHARS = 3000;

export const recallStepTool: ToolDef<RecallStepInput, RecallStepOutput> = {
  name: 'recall_step',
  description:
    '重读本任务里某一步的完整原始输出（按步骤号 stepIdx）。当近窗"最近步骤"里某步已滚出、' +
    '但你现在需要它的精确细节（完整数据/报错/返回结构）时调用。stepIdx 取自任务状态里的 ' +
    '[步骤 N] 标注或"更早 N 条已略"提示。内容很长时用 offset 翻页。',
  inputSchema: {
    type: 'object',
    required: ['stepIdx'],
    properties: {
      stepIdx: { type: 'number', minimum: 0, description: '要重读的步骤号' },
      offset: { type: 'number', minimum: 0, description: '翻页起始字符偏移（默认 0）' },
    },
    additionalProperties: false,
  },
  approvalMode: 'auto',
  costHint: 'low',
  hasSideEffects: false,
  idempotent: true,
  computeIdempotencyKey: (input) => `recall_step:${input.stepIdx}:${input.offset ?? 0}`,
  replyMeta: { summaryKind: 'text', failureHint: '（内置只读工具，不应失败）' },
  async handler(input, ctx): Promise<RecallStepOutput> {
    // getStepByIdx 按 (runId, idx) 定向单查 → 只读当前 run（绝不串其它 run/用户），
    // 且不把整 run 的所有 step（可能含多个数十 KB output）全量载入只为取一行。
    const s = await getStepByIdx(ctx.runId, input.stepIdx);
    if (!s) {
      return { ok: true, found: false, stepIdx: input.stepIdx, note: `本任务无步骤 ${input.stepIdx}` };
    }
    // tool_call 步落库形态是 { result: <tool输出>, retried }；解 wrapper 拿内层真内容。
    const raw = (s.output as { result?: unknown } | null)?.result ?? s.output;
    let text: string;
    try {
      // output 落库未脱敏 → 返回前刮密钥（纵深防御：内容会经 digestTail 再脱敏一次）。
      text = JSON.stringify(redactSecrets(raw) ?? null);
    } catch {
      text = '[unserializable]';
    }
    const offset = Math.max(0, Math.floor(input.offset ?? 0));
    const content = text.slice(offset, offset + RECALL_PAGE_CHARS);
    // offset 越过内容末尾 → 显式 note，避免模型把空 content 误判成"该步没数据"。
    const note =
      offset >= text.length && text.length > 0
        ? `offset ${offset} 已越过内容末尾（共 ${text.length} 字），用更小的 offset 重读`
        : undefined;
    return {
      ok: true,
      found: true,
      stepIdx: s.idx,
      toolName: s.toolName ?? null,
      kind: s.kind,
      content,
      offset,
      hasMore: offset + RECALL_PAGE_CHARS < text.length,
      totalChars: text.length,
      ...(note ? { note } : {}),
    };
  },
};

export function registerRecallStep(): void {
  if (!toolRegistry.get(recallStepTool.name)) {
    toolRegistry.register(recallStepTool);
  }
}
