import { toolRegistry, type ToolDef } from '../toolRegistry.js';
import * as store from '../store.js';
import { runChildSubagent, subagentCitationsToRefs, type SubagentCitation } from '../spawnSubagent.js';
import { docExportMarkdownTool } from './docExportMarkdown.js';

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
  /** K7:报告自动存档到写作区的文档 id/标题(存档失败时缺省 —— fail-open)。 */
  reportDocumentId?: string;
  reportTitle?: string;
  error?: string;
};

/** K7:报告存档标题 —— 统一前缀,写作页可按前缀归拢/批量隐藏。readDocument 复用此常量。 */
export const REPORT_TITLE_PREFIX = '研究报告：';
const REPORT_TITLE_QUESTION_MAX = 40;

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
    // K1:合成报告类发现 —— checkpoint 折叠时不被"引用全已见"吞掉(报告是新内容)。
    checkpointFindingKind: 'synthesis',
    // K1:子 run 的真引用(已过 filterCitedRefs、url 类、≤MAX_CITATIONS)回流父资源清单。
    extractRefs: (output) => subagentCitationsToRefs(output as DeepResearchOutput | null),
    // K7:存档的报告文档进资源清单(产物类 ref 恒保留;与上面的 url 引用并存)。
    extractRef: (output) => {
      const o = output as DeepResearchOutput | null;
      if (!o?.ok || !o.reportDocumentId) return null;
      return { kind: 'document' as const, id: o.reportDocumentId, label: o.reportTitle };
    },
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
      const result = await runChildSubagent({
        parentRun,
        task: input.question,
        role: 'researcher',
        maxSteps,
        signal: ctx.signal,
      });
      if (!result.ok || !result.report.trim()) return result;

      // K7:报告自动存档(行业头号抱怨:深研报告滚走即不可复访)。复用 doc_export 的
      // upsert + 用户编辑保护(同名 v2 版本化);失败 fail-open —— 报告照常返回。
      try {
        // review#1/#14:两个问题前 40 字相同会 upsert 同标题、静默覆盖前一份报告。
        // 问题超 40 字时附 run 短 id 消歧,确保不同研究各存一份。
        const q = input.question.trim();
        const qPart = q.slice(0, REPORT_TITLE_QUESTION_MAX);
        const disambig = q.length > REPORT_TITLE_QUESTION_MAX ? ` (${ctx.runId.slice(0, 8)})` : '';
        const title = `${REPORT_TITLE_PREFIX}${qPart}${disambig}`;
        const archived = await docExportMarkdownTool.handler(
          { title, markdown: result.report },
          ctx,
        );
        if (archived.ok) {
          return { ...result, reportDocumentId: archived.documentId, reportTitle: archived.title };
        }
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') throw e;
        // 存档失败不影响报告返回
      }
      return result;
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
