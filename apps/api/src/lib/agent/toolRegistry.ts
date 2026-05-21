import type { JSONSchema7 } from 'json-schema';
import type { AgentRole } from './types.js';

export type ApprovalMode = 'auto' | 'ask' | 'never';

export type ToolCtx = {
  runId: string;
  stepId: string;
  ownerId: string;
  channel: 'private' | 'group';
  groupId?: string;
  topicId?: string;
  signal: AbortSignal;
  apiKey?: string;
};

/**
 * M1f：把 replyGen 里硬编码的 `if (toolName === 'doc_export_markdown')` 模式
 * 反转过来 —— tool 自己声明"我应该怎么进 final reply"。
 *
 * - `summaryKind`：摘要策略；replyGen 按这个决定如何渲染 step.output。
 * - `extractRef`：当 tool 产出可引用 artifact（document/url/magi_card）时，
 *   返回结构化 ref，replyGen 统一渲染成"已写入文档：xxx (id: yyy)"之类。
 * - `failureHint`：失败时给 planner 看的提示文本（M1f Task 2 planner prompt
 *   引用此字段告诉 LLM 失败常见原因）。
 */
export type ToolReplyMeta = {
  summaryKind?: 'text' | 'list' | 'export_ref' | 'silent';
  extractRef?: (output: unknown) => {
    kind: 'document' | 'url' | 'magi_card' | 'diagram';
    id: string;
    label?: string;
  } | null;
  failureHint?: string;
};

export type ToolDef<I = unknown, O = unknown> = {
  name: string;
  description: string;
  inputSchema: JSONSchema7;
  allowedRoles?: AgentRole[];
  approvalMode: ApprovalMode;
  costHint?: 'low' | 'medium' | 'high';
  hasSideEffects: boolean;
  idempotent: boolean;
  computeIdempotencyKey?: (input: I) => string;
  /** M1f：reply / planner prompt 用的工具元数据。可选，默认 'text'。 */
  replyMeta?: ToolReplyMeta;
  handler: (input: I, ctx: ToolCtx) => Promise<O>;
};

class ToolRegistry {
  private tools = new Map<string, ToolDef>();

  register<I, O>(tool: ToolDef<I, O>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`tool ${tool.name} already registered`);
    }
    this.tools.set(tool.name, tool as ToolDef);
  }

  get(name: string): ToolDef | undefined {
    return this.tools.get(name);
  }

  require(name: string): ToolDef {
    const t = this.tools.get(name);
    if (!t) throw new Error(`unknown tool: ${name}`);
    return t;
  }

  list(role: AgentRole = 'generalist'): ToolDef[] {
    return Array.from(this.tools.values()).filter(
      (t) => !t.allowedRoles || t.allowedRoles.includes(role),
    );
  }
}

export const toolRegistry = new ToolRegistry();
