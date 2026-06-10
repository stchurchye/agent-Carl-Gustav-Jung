import type { JSONSchema7 } from 'json-schema';
import type { AgentRole } from './types.js';

export type ApprovalMode = 'auto' | 'ask' | 'never';

export type ToolCtx = {
  runId: string;
  stepId: string;
  ownerId: string;
  channel: 'private' | 'group';
  /**
   * M3 Task 2：私聊 session id（来自 run.sessionId）。私聊 run 必有；
   * 群聊 run 为 undefined。ask_user 等需要往 private_chat_messages 写
   * 自定义消息的工具会用到；普通工具忽略即可。
   */
  sessionId?: string;
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
  /**
   * P0-S7:复数版 —— 一次输出产多个可引用 ref(搜索类工具:top-N 结果各一条 url ref)。
   * 与 extractRef 并存(纯增量),collectReplyRefs 两者都消费并按 kind:id 去重。
   * 实现方按需自行限量(如 top-3)防 ref 洪水。
   */
  extractRefs?: (output: unknown) => Array<{
    kind: 'document' | 'url' | 'magi_card' | 'diagram';
    id: string;
    label?: string;
  }>;
  /**
   * K1:checkpoint 折叠时的发现类别声明。'synthesis' = 输出是**合成报告**(spawn 类工具),
   * 引用了来源但不是任何单一来源的内容 —— 不参与"ref 全已见→整条丢弃"的内容去重,
   * 其 refs 只登记为"来源已提及"。缺省按 summaryKind 推断(list→列举,其余→内容)。
   */
  checkpointFindingKind?: 'synthesis';
  failureHint?: string;
};

/** P0-S7:搜索类工具 extractRefs 的统一限量(防 ref 洪水),三个搜索工具共用。 */
export const SEARCH_REF_TOP_N = 3;

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
