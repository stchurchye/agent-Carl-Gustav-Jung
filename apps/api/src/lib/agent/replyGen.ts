import type { LlmChatClient, LlmChatMessage } from '../llm/types.js';
import type { AgentRun, AgentStep, Plan } from './types.js';

const REPLY_SYSTEM = `你是 agent 任务的收尾发言人。
读取已完成的工具调用结果，用 1-3 段中文给用户回复：
- 简要总结做了什么、得到什么
- 如果生成了文档（doc_export_markdown），明确告知文档标题
- 别复述全部 raw 数据，只给关键结论
- 末尾不需要 emoji 或客套话`;

/**
 * 拼终稿 LLM 输入：plan.intentSummary + 最近若干 tool_call output 摘要 + plan.finalReplyHint。
 */
export function buildReplyMessages(params: {
  run: AgentRun;
  plan: Plan;
  steps: AgentStep[];
}): LlmChatMessage[] {
  const { run, plan, steps } = params;
  const toolSteps = steps.filter(
    (s) => s.kind === 'tool_call' || s.kind === 'observe',
  );
  const recent = toolSteps.slice(-6); // 控制 prompt 体积

  const stepDigest = recent
    .map((s, i) => {
      const tool = s.toolName ?? 'unknown';
      const out = summarizeOutput(s.output);
      return `${i + 1}. ${tool}: ${out}`;
    })
    .join('\n');

  const docHint = collectExportedDocs(steps);
  const docLine = docHint.length
    ? '\n\n已写入文档：\n' +
      docHint.map((d) => `- ${d.title} (id: ${d.documentId})`).join('\n')
    : '';

  const user = `用户原始请求：${run.inputText}

执行目标：${plan.intentSummary}

工具调用摘要：
${stepDigest || '（无工具调用）'}${docLine}

最终回复风格提示：${plan.finalReplyHint || '简明、对话风格'}`;

  return [
    { role: 'system', content: REPLY_SYSTEM },
    { role: 'user', content: user },
  ];
}

function summarizeOutput(out: unknown): string {
  if (out == null) return '(无输出)';
  if (typeof out === 'string') return out.slice(0, 200);
  try {
    const json = JSON.stringify(out);
    return json.slice(0, 200);
  } catch {
    return '[unserializable]';
  }
}

function collectExportedDocs(steps: AgentStep[]): Array<{
  title: string;
  documentId: string;
}> {
  const docs: Array<{ title: string; documentId: string }> = [];
  for (const s of steps) {
    if (s.toolName !== 'doc_export_markdown') continue;
    const raw = (s.output as { result?: unknown } | null)?.result ?? s.output;
    const out = raw as { documentId?: string; title?: string } | null;
    if (out?.documentId && out?.title) {
      docs.push({ documentId: out.documentId, title: out.title });
    }
  }
  return docs;
}

/**
 * 让 LLM 生成 agent run 的最终回复内容（覆盖原来基于 plan.finalReplyHint 的拼接）。
 * LLM 不可用 / 出错时返回 fallback 文本。
 */
export async function generateFinalReply(params: {
  run: AgentRun;
  plan: Plan;
  steps: AgentStep[];
  /** M1e Task 11d：从 raw apiKey 升级为 provider-neutral client */
  llm: LlmChatClient;
  signal: AbortSignal;
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
    const docs = collectExportedDocs(params.steps);
    const docLine = docs.length
      ? `\n\n已写入文档：${docs.map((d) => d.title).join('、')}`
      : '';
    return `已完成 ${params.plan.intentSummary}。${docLine}`;
  }
}
