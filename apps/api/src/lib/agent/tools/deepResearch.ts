import { toolRegistry, type ToolDef } from '../toolRegistry.js';
import * as store from '../store.js';
import { runChildSubagent, type SubagentCitation } from '../spawnSubagent.js';

type DeepResearchInput = {
  question: string;
  maxSteps?: number;
};

type DeepResearchOutput = {
  ok: boolean;
  report: string;
  citations: SubagentCitation[];
  stepsUsed: number;
  childRunId: string;
  error?: string;
};

export const deepResearchTool: ToolDef<DeepResearchInput, DeepResearchOutput> = {
  name: 'deep_research',
  description:
    'Spawn a sub-agent to deeply research a focused question (literature reviews, empirical support for a theory, controversial claims). The sub-agent uses search_papers/wikipedia/fetch_url/document_reader and returns a markdown report with citations. Use ONCE per sub-question; do NOT nest deep_research inside deep_research.',
  inputSchema: {
    type: 'object',
    required: ['question'],
    properties: {
      question: { type: 'string', minLength: 5 },
      maxSteps: { type: 'integer', minimum: 1, maximum: 8 },
    },
  },
  approvalMode: 'auto',
  costHint: 'high',
  hasSideEffects: true,
  idempotent: false,
  replyMeta: {
    summaryKind: 'text',
    failureHint:
      'deep_research 失败：子 agent 超时/工具不可用/子任务范围太大。可改用 search_papers + fetch_url 串行，或缩小问题范围重试。',
  },
  // M3-S1：deep_research = spawn_subagent(role='researcher') 的便捷形态；spawn 逻辑共用 runChildSubagent。
  async handler(input, ctx) {
    const parentRun = await store.getAgentRun(ctx.runId);
    if (!parentRun) {
      return { ok: false, report: '', citations: [], stepsUsed: 0, childRunId: '', error: 'parent run not found' };
    }
    // 防递归：父 run 本身就是子 run。
    if (parentRun.parentRunId) {
      return {
        ok: false,
        report: '',
        citations: [],
        stepsUsed: 0,
        childRunId: '',
        error: 'deep_research cannot be nested (run is already a sub-agent)',
      };
    }
    const maxSteps = Math.max(1, Math.min(input.maxSteps ?? 5, 8));
    try {
      return await runChildSubagent({
        parentRun,
        task: input.question,
        role: 'researcher',
        maxSteps,
        signal: ctx.signal,
      });
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      return {
        ok: false,
        report: '',
        citations: [],
        stepsUsed: 0,
        childRunId: '',
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
};

export function registerDeepResearch(): void {
  if (!toolRegistry.get(deepResearchTool.name)) toolRegistry.register(deepResearchTool);
}
