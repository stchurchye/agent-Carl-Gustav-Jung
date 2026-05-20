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
