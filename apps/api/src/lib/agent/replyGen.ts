import type { LlmChatClient, LlmChatMessage } from '../llm/types.js';
import type { AgentRun, AgentStep, Plan, ReplyRef } from './types.js';
import { sanitizeMergedUsername } from './types.js';
import { toolRegistry, type ToolDef, type ToolReplyMeta } from './toolRegistry.js';
import { redactSecrets } from './redact.js';

export type { ReplyRef };

const REPLY_SYSTEM = `你是 agent 任务的收尾发言人。
读取已完成的工具调用结果，用 1-3 段中文给用户回复：
- 简要总结做了什么、得到什么
- 如果 user 段里"已写入资源"非空，明确告知每个资源的 label
- 别复述全部 raw 数据，只给关键结论
- 末尾不需要 emoji 或客套话`;

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
  // M1f followup：runtime 里 tool_call + observe 两条 step 可能引用同一份 output，
  // 不去重的话 ref 清单会出现重复。按 `${kind}:${id}` 维护一个 seen Set。
  const seen = new Set<string>();
  for (const s of steps) {
    if (!s.toolName) continue;
    const tool = toolMap.get(s.toolName);
    const extractRef = tool?.replyMeta?.extractRef;
    // P0-S7:复数版 —— 搜索类工具一次产多个 url ref。两者都消费,统一脱敏+去重。
    const extractRefs = tool?.replyMeta?.extractRefs;
    if (!extractRef && !extractRefs) continue;
    const raw =
      (s.output as { result?: unknown } | null)?.result ?? s.output;
    // M1f polish #3：ok=false 的 output 永远不产生 ref —— 这是一条失败
    // observation，不是已落地的资源。把契约钉在 runtime 而不是依赖每个 tool
    // 的 extractRef 自己防御性 check ok（docExport throws, magiIngest 清
    // videoUrl 都是当前实现的偶然护城河，新 tool 作者很容易踩坑）。
    if (raw != null && typeof raw === 'object' && (raw as { ok?: unknown }).ok === false) {
      continue;
    }
    try {
      // P0-S7:单数 + 复数统一收集后走同一条脱敏/去重管线。
      const rawRefs = [
        ...(extractRef ? [extractRef(raw)] : []),
        ...(extractRefs ? extractRefs(raw) : []),
      ].filter((r): r is NonNullable<typeof r> => r != null);
      for (const rawRef of rawRefs) {
        // S0 followup（整体 review #1）：ref 从原始 output 抽取（未脱敏）—— url id/label
        // 可能带密钥（如 ?api_key=… 的链接）。脱敏 id/label，避免泄进 checkpoint 列与终稿。
        const ref = {
          ...rawRef,
          id: redactSecrets(rawRef.id) as string,
          ...(rawRef.label ? { label: redactSecrets(rawRef.label) as string } : {}),
        };
        const key = `${ref.kind}:${ref.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        refs.push(ref);
      }
    } catch (e) {
      // tool extractRef/extractRefs throw 不应让 reply 整体崩;但要留痕,
      // 否则实现 bug 会让该工具的 ref 静默消失、排查无据(review S7)。
      console.warn(`[collectReplyRefs] extractRef(s) 抛错被忽略 tool=${s.toolName}`, e);
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
  rawOut: unknown,
  kind: ToolReplyMeta['summaryKind'] = 'text',
): string {
  // S2d：送 LLM 的投影脱敏（持久化的 step.output 保持原始；密钥不进终稿/摘要）。
  const out = redactSecrets(rawOut);
  if (kind === 'silent') return '';
  if (kind === 'export_ref') return '[已写入资源，详见下方资源清单]';
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

  // S2：有累积 checkpoint 时，从 checkpoint.completed（跨全 run 累积、不丢早期发现）
  // + digestTail（近窗细节）取摘要与 refs，而非只看 last-6 步。否则退回 last-6。
  const cp = run.contextCheckpoint;
  let stepDigest: string;
  let refs: ReplyRef[];
  // 整体 review #6：completed 空但 digestTail 有内容（成功步全是 ref-less/silent）也走
  // checkpoint 分支，否则会退回 last-6 把 digestTail 的近窗结论丢掉。
  if (cp && (cp.completed.length > 0 || cp.digestTail)) {
    // 跳过空 finding（silent 工具如 render_diagram，其价值在 refs 里、非摘要文本），
    // 与 last-6 分支的 `if(!summary)` 过滤对齐，避免终稿出现 "N. tool: " 噪声行。
    const lines = cp.completed
      .filter((c) => c.finding)
      .map((c, i) => `${i + 1}. ${c.text}: ${c.finding}`);
    // digestTail v4 扩容到 32K 字；reply writer 只需"做了什么"的线索，不需要读全量原始 output。
    // 截到 8000 字（约 2K token），保留近窗细节但不浪费 reply LLM 的上下文预算。
    const tailForReply = cp.digestTail ? cp.digestTail.slice(0, 8000) : '';
    stepDigest =
      lines.join('\n') +
      (tailForReply ? `\n\n最近步骤详情：\n${tailForReply}` : '');
    const seen = new Set<string>();
    refs = [];
    for (const r of [
      ...cp.completed.flatMap((c) => c.refs),
      ...collectReplyRefs(steps, toolMap),
    ]) {
      const k = `${r.kind}:${r.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      refs.push(r);
    }
  } else {
    const recent = steps
      .filter((s) => s.kind === 'tool_call' || s.kind === 'observe')
      .slice(-6);
    stepDigest = recent
      .map((s, i) => {
        const tool = s.toolName ?? 'unknown';
        const kind = toolMap.get(s.toolName ?? '')?.replyMeta?.summaryKind ?? 'text';
        const summary = summarizeStepOutput(s.output, kind);
        if (!summary) return null; // silent
        return `${i + 1}. ${tool}: ${summary}`;
      })
      .filter((line): line is string => line !== null)
      .join('\n');
    refs = collectReplyRefs(steps, toolMap);
  }
  const refLines = refs.length
    ? '\n\n已写入资源：\n' +
      refs.map((r) => `- [${r.kind}] ${r.label ?? r.id} (id: ${r.id})`).join('\n')
    : '';

  // M7 P2：合并的追问 → 终稿需统一回应。
  const merged = run.mergedInputs ?? [];
  const mergedSection =
    merged.length > 0
      ? `\n\n# 后续追问列表（共 ${merged.length} 条，需在 reply 中统一回应）\n` +
        merged.map((m) => `- @${sanitizeMergedUsername(m.byUsername)}: ${m.text}`).join('\n')
      : '';

  const user = `用户原始请求：${run.inputText}

执行目标：${plan.intentSummary}

工具调用摘要：
${stepDigest || '（无工具调用）'}${refLines}${mergedSection}

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
