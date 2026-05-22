import { toolRegistry, type ToolDef } from '../toolRegistry.js';
import * as store from '../store.js';
import { createAgentRun, cancelRun } from '../runLifecycle.js';
import { dispatchChildRun } from '../childExecutor.js';

type DeepResearchInput = {
  question: string;
  maxSteps?: number;
};

type DeepResearchOutput = {
  ok: boolean;
  report: string;
  citations: Array<{ kind: string; id: string; label?: string }>;
  stepsUsed: number;
  childRunId: string;
  error?: string;
};

const POLL_INTERVAL_MS = 500;
const MAX_WAIT_MS = 5 * 60_000;
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'budget_exhausted']);

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
  async handler(input, ctx) {
    // 防递归：父 run 本身就是子 run
    const parentRun = await store.getAgentRun(ctx.runId);
    if (!parentRun) {
      return {
        ok: false,
        report: '',
        citations: [],
        stepsUsed: 0,
        childRunId: '',
        error: 'parent run not found',
      };
    }
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
      // 1. 创建子 run（parentRunId 指向父 run，budget 限制）
      const childResult = await createAgentRun({
        ownerId: parentRun.ownerId,
        channel: 'private',
        inputText: input.question,
        apiKey: '',
        apiKeySource: parentRun.apiKeySource,
        providerId: parentRun.providerId,
        modelId: parentRun.modelId,
        parentRunId: parentRun.id,
        budget: { maxSteps, maxSeconds: 120, maxTokens: 50_000 },
      });
      const childRunId = childResult.run.id;

      // 2. 父取消 → 子取消（用 cancelRun 确保同时 abort 子 run 的活跃 controller）
      const onAbort = () => {
        void cancelRun(childRunId, parentRun.ownerId);
      };
      ctx.signal.addEventListener('abort', onAbort, { once: true });

      // 3. 派子 run 入独立 child executor
      await dispatchChildRun(childRunId);

      // 4. 轮询直到子 run 达到终态
      const startedAt = Date.now();
      let childRun = childResult.run;
      while (Date.now() - startedAt < MAX_WAIT_MS) {
        await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
        if (ctx.signal.aborted) {
          ctx.signal.removeEventListener('abort', onAbort);
          const err = new Error('aborted');
          err.name = 'AbortError';
          throw err;
        }
        const reloaded = await store.getAgentRun(childRunId);
        if (!reloaded) break;
        childRun = reloaded;
        if (TERMINAL_STATUSES.has(reloaded.status)) break;
      }
      ctx.signal.removeEventListener('abort', onAbort);

      if (childRun.status !== 'completed') {
        return {
          ok: false,
          report: '',
          citations: [],
          stepsUsed: childRun.usage.steps,
          childRunId,
          error: `child run ended with status: ${childRun.status}`,
        };
      }

      // 5. 聚合子 run 结果
      const steps = await store.listSteps(childRunId);
      const replyStep =
        [...steps].reverse().find((s) => s.kind === 'reply') ?? steps[steps.length - 1];
      const report: string =
        (replyStep?.output as { content?: string; text?: string } | undefined)?.content ??
        (replyStep?.output as { content?: string; text?: string } | undefined)?.text ??
        '(子 agent 未生成文字报告)';

      const citations: DeepResearchOutput['citations'] = [];
      for (const s of steps) {
        const ref = (s.output as { ref?: unknown } | undefined)?.ref;
        if (ref && typeof ref === 'object' && (ref as Record<string, unknown>).kind) {
          citations.push(ref as DeepResearchOutput['citations'][number]);
        }
      }

      return { ok: true, report, citations, stepsUsed: childRun.usage.steps, childRunId };
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
