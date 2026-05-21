import type { LlmChatClient, LlmChatMessage } from '../llm/types.js';
import type { AgentRun, AgentStep, Plan } from './types.js';
import { toolRegistry, type ToolDef, type ToolReplyMeta } from './toolRegistry.js';

const REPLY_SYSTEM = `你是 agent 任务的收尾发言人。
读取已完成的工具调用结果，用 1-3 段中文给用户回复：
- 简要总结做了什么、得到什么
- 如果生成了文档（doc_export_markdown），明确告知文档标题
- 别复述全部 raw 数据，只给关键结论
- 末尾不需要 emoji 或客套话`;

export type ReplyRef = {
  kind: 'document' | 'url' | 'magi_card';
  id: string;
  label?: string;
};

/**
 * M1f：取代原 `collectExportedDocs` 的硬编码 toolName 判断。遍历 steps，
 * 用每个 tool 的 `replyMeta.extractRef` 取结构化 ref。
 *
 * @param steps 一次 run 的所有 step（caller 通常已 filter 出 observe/tool_call）
 * @param toolMap toolName → ToolDef 的映射。生产里 caller 传
 *   `new Map(toolRegistry.list().map(t => [t.name, t]))`；测试可手 mock。
 */
export function collectReplyRefs(
  steps: AgentStep[],
  toolMap: Map<string, ToolDef>,
): ReplyRef[] {
  const refs: ReplyRef[] = [];
  for (const s of steps) {
    if (!s.toolName) continue;
    const tool = toolMap.get(s.toolName);
    const extractRef = tool?.replyMeta?.extractRef;
    if (!extractRef) continue;
    const raw =
      (s.output as { result?: unknown } | null)?.result ?? s.output;
    try {
      const ref = extractRef(raw);
      if (ref) refs.push(ref);
    } catch {
      // tool extractRef throw 不应让 reply 整体崩
    }
  }
  return refs;
}

/**
 * M1f：按 replyMeta.summaryKind 分发 step output 摘要策略。
 * - text（默认）：JSON.stringify 截断 200 字符
 * - list：尝试取 output.results / output.items 数组，列前 5 项 title
 * - export_ref：只返回短标记，详细信息在 ReplyRef 里
 * - silent：返回空串（caller 应跳过该行）
 */
export function summarizeStepOutput(
  out: unknown,
  kind: ToolReplyMeta['summaryKind'] = 'text',
): string {
  if (kind === 'silent') return '';
  if (kind === 'export_ref') return '[已写入文档，详见下方文档清单]';
  if (kind === 'list') {
    const arr =
      (out as { results?: unknown[]; items?: unknown[] } | null)?.results ??
      (out as { items?: unknown[] } | null)?.items;
    if (Array.isArray(arr)) {
      const titles = arr
        .slice(0, 5)
        .map((it) => {
          if (typeof it === 'string') return it.slice(0, 60);
          const t = (it as { title?: string })?.title;
          return typeof t === 'string' ? t.slice(0, 60) : '[item]';
        })
        .join('、');
      return titles || '(空列表)';
    }
    // fallback 到 text
  }
  if (out == null) return '(无输出)';
  if (typeof out === 'string') return out.slice(0, 200);
  try {
    return JSON.stringify(out).slice(0, 200);
  } catch {
    return '[unserializable]';
  }
}

/**
 * 拼终稿 LLM 输入：plan.intentSummary + 最近若干 tool_call output 摘要 + ref 清单 + plan.finalReplyHint。
 */
export function buildReplyMessages(params: {
  run: AgentRun;
  plan: Plan;
  steps: AgentStep[];
  /** M1f：测试 / 调用方可注入；默认从 toolRegistry 取。 */
  toolMap?: Map<string, ToolDef>;
}): LlmChatMessage[] {
  const { run, plan, steps } = params;
  const toolMap =
    params.toolMap ?? new Map(toolRegistry.list().map((t) => [t.name, t]));

  const toolSteps = steps.filter(
    (s) => s.kind === 'tool_call' || s.kind === 'observe',
  );
  const recent = toolSteps.slice(-6);

  const stepDigest = recent
    .map((s, i) => {
      const tool = s.toolName ?? 'unknown';
      const kind = toolMap.get(s.toolName ?? '')?.replyMeta?.summaryKind ?? 'text';
      const summary = summarizeStepOutput(s.output, kind);
      if (!summary) return null; // silent
      return `${i + 1}. ${tool}: ${summary}`;
    })
    .filter((line): line is string => line !== null)
    .join('\n');

  const refs = collectReplyRefs(steps, toolMap);
  const refLines = refs.length
    ? '\n\n已写入资源：\n' +
      refs.map((r) => `- [${r.kind}] ${r.label ?? r.id} (id: ${r.id})`).join('\n')
    : '';

  const user = `用户原始请求：${run.inputText}

执行目标：${plan.intentSummary}

工具调用摘要：
${stepDigest || '（无工具调用）'}${refLines}

最终回复风格提示：${plan.finalReplyHint || '简明、对话风格'}`;

  return [
    { role: 'system', content: REPLY_SYSTEM },
    { role: 'user', content: user },
  ];
}

/**
 * 让 LLM 生成 agent run 的最终回复内容。LLM 不可用 / 出错时返回 fallback 文本。
 */
export async function generateFinalReply(params: {
  run: AgentRun;
  plan: Plan;
  steps: AgentStep[];
  llm: LlmChatClient;
  signal: AbortSignal;
  toolMap?: Map<string, ToolDef>;
}): Promise<string> {
  const messages = buildReplyMessages(params);
  try {
    const result = await params.llm.chat(messages, {
      temperature: 0.4,
      maxTokens: 800,
      signal: params.signal,
    });
    return result.content;
  } catch {
    const toolMap =
      params.toolMap ?? new Map(toolRegistry.list().map((t) => [t.name, t]));
    const refs = collectReplyRefs(params.steps, toolMap);
    const refLine = refs.length
      ? `\n\n已写入：${refs.map((r) => r.label ?? r.id).join('、')}`
      : '';
    return `已完成 ${params.plan.intentSummary}。${refLine}`;
  }
}
