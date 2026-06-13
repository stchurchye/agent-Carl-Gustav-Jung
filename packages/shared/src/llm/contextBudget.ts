/** 上下文 token 预算与组装（问答 / 写作小助手共用） */

export type ContextChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type ContextUsageBreakdown = {
  system: number;
  summary: number;
  history: number;
  document: number;
  pendingUser: number;
  outputReserve: number;
};

export type ContextBreakdownKey = keyof ContextUsageBreakdown;

export type ContextBreakdownMeta = {
  key: ContextBreakdownKey;
  labelZh: string;
  color: string;
};

/** 上下文分类展示顺序与配色（弹窗图例 / 分段条） */
export const CONTEXT_BREAKDOWN_META: readonly ContextBreakdownMeta[] = [
  { key: 'system', labelZh: '通讯系统', color: '#9CA3AF' },
  { key: 'summary', labelZh: '对话摘要', color: '#F472B6' },
  { key: 'history', labelZh: '维持', color: '#60A5FA' },
  { key: 'document', labelZh: '文档内容', color: '#34D399' },
  // pendingUser 仍计入 usedTokens(buildUsage),图例必须同列,否则各行之和对不上表头总数。
  { key: 'pendingUser', labelZh: '待发送', color: '#FBBF24' },
  { key: 'outputReserve', labelZh: '预留空间', color: '#6B7280' },
] as const;

export type ContextUsage = {
  usedTokens: number;
  limitTokens: number;
  ratio: number;
  breakdown: ContextUsageBreakdown;
  compacted: boolean;
  droppedVerbatimTurns: number;
};

export const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;
export const DEFAULT_OUTPUT_RESERVE_TOKENS = 2048;
export const COMPACT_THRESHOLD_RATIO = 0.8;
export const ESTIMATE_CHARS_PER_TOKEN = 1.6;

export const SUMMARY_PREFIX = '【此前对话摘要】\n';

export function getContextWindowTokens(): number {
  const raw = typeof process !== 'undefined' ? process.env.CONTEXT_WINDOW_TOKENS : undefined;
  const n = raw ? Number.parseInt(raw, 10) : DEFAULT_CONTEXT_WINDOW_TOKENS;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CONTEXT_WINDOW_TOKENS;
}

/**
 * S7：CJK/ASCII 分别估 token，比裸 `len/1.6` 准。
 * - CJK（含日文假名/韩文/全角）≈ 1 token/char（保守，DeepSeek 实测多在 ~1/char）。
 * - 其余（ASCII/拉丁/数字/空白）≈ 1 token / ASCII_CHARS_PER_TOKEN（旧 1.6 对英文高估 ~3.5x）。
 * 偏保守 = 估高一点 → 早压更安全。留 seam：日后可用 provider 返回的真实 prompt_tokens 校准。
 */
export const ASCII_CHARS_PER_TOKEN = 3.5;
// U+2E80–U+9FFF 一段覆盖 部首/注音/CJK 符号/假名/汉字；另加 Hangul(AC00–D7AF) + 全角(FF00–FFEF)。
const CJK_RE = /[⺀-鿿가-힯＀-￯]/g;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjkCount = (text.match(CJK_RE) ?? []).length;
  const nonCjk = text.length - cjkCount;
  return cjkCount + Math.ceil(nonCjk / ASCII_CHARS_PER_TOKEN);
}

export function formatTokenCount(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return k >= 10 ? `${Math.round(k)}k` : `${k.toFixed(1).replace(/\.0$/, '')}k`;
  }
  return String(n);
}

export function tokensToEstimatedChars(tokens: number): number {
  return Math.round(tokens * ESTIMATE_CHARS_PER_TOKEN);
}

export function formatCharCount(n: number): string {
  if (n >= 10_000) {
    const wan = n / 10_000;
    return wan >= 10 ? `${Math.round(wan)}万` : `${wan.toFixed(1).replace(/\.0$/, '')}万`;
  }
  if (n >= 1000) {
    const k = n / 1000;
    return k >= 10 ? `${Math.round(k)}k` : `${k.toFixed(1).replace(/\.0$/, '')}k`;
  }
  return String(n);
}

export function getContextBreakdownSegments(
  breakdown: ContextUsageBreakdown,
): { key: ContextBreakdownKey; tokens: number; labelZh: string; color: string }[] {
  return CONTEXT_BREAKDOWN_META.map((meta) => ({
    key: meta.key,
    tokens: breakdown[meta.key],
    labelZh: meta.labelZh,
    color: meta.color,
  })).filter((s) => s.tokens > 0);
}

type HistoryTurn = { role: 'user' | 'assistant'; content: string };

function fitHistoryFromEnd(
  history: HistoryTurn[],
  budgetTokens: number,
): { fitted: HistoryTurn[]; omitted: HistoryTurn[]; used: number } {
  if (budgetTokens <= 0 || history.length === 0) {
    return { fitted: [], omitted: [...history], used: 0 };
  }
  const fittedRev: HistoryTurn[] = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i];
    const cost = estimateTokens(turn.content);
    if (used + cost > budgetTokens && fittedRev.length > 0) {
      return {
        fitted: fittedRev.reverse(),
        omitted: history.slice(0, i + 1),
        used,
      };
    }
    if (used + cost > budgetTokens) {
      return { fitted: [], omitted: [...history], used: 0 };
    }
    fittedRev.push(turn);
    used += cost;
  }
  return { fitted: fittedRev.reverse(), omitted: [], used };
}

function buildUsage(
  limitTokens: number,
  breakdown: ContextUsageBreakdown,
  compacted: boolean,
  droppedVerbatimTurns: number,
): ContextUsage {
  const usedTokens =
    breakdown.system +
    breakdown.summary +
    breakdown.history +
    breakdown.document +
    breakdown.pendingUser +
    breakdown.outputReserve;
  return {
    usedTokens,
    limitTokens,
    ratio: Math.min(1, usedTokens / limitTokens),
    breakdown,
    compacted,
    droppedVerbatimTurns,
  };
}

export type AssembleChatResult = {
  messages: ContextChatMessage[];
  usage: ContextUsage;
  needsCompact: boolean;
  messagesToCompact: HistoryTurn[];
};

export function assembleChatContext(params: {
  systemPrompt: string;
  summary?: string | null;
  history: HistoryTurn[];
  pendingUser: string;
  limitTokens?: number;
  outputReserve?: number;
}): AssembleChatResult {
  const limitTokens = params.limitTokens ?? getContextWindowTokens();
  const outputReserve = params.outputReserve ?? DEFAULT_OUTPUT_RESERVE_TOKENS;

  const breakdown: ContextUsageBreakdown = {
    system: estimateTokens(params.systemPrompt),
    summary: 0,
    history: 0,
    document: 0,
    pendingUser: estimateTokens(params.pendingUser),
    outputReserve,
  };

  const summaryText = params.summary?.trim()
    ? `${SUMMARY_PREFIX}${params.summary.trim()}`
    : '';
  breakdown.summary = estimateTokens(summaryText);

  const fixed =
    breakdown.system +
    breakdown.summary +
    breakdown.pendingUser +
    breakdown.outputReserve;
  const historyBudget = Math.max(0, limitTokens - fixed);

  const { fitted, omitted, used } = fitHistoryFromEnd(params.history, historyBudget);
  breakdown.history = used;

  const messages: ContextChatMessage[] = [{ role: 'system', content: params.systemPrompt }];
  if (summaryText) {
    messages.push({ role: 'user', content: summaryText });
  }
  for (const turn of fitted) {
    messages.push(turn);
  }
  messages.push({ role: 'user', content: params.pendingUser });

  const needsCompact = omitted.length > 0;
  const usage = buildUsage(
    limitTokens,
    breakdown,
    Boolean(params.summary?.trim()) || needsCompact,
    omitted.length,
  );

  return {
    messages,
    usage,
    needsCompact,
    messagesToCompact: omitted,
  };
}

export type AssembleWritingIntentResult = {
  messages: ContextChatMessage[];
  usage: ContextUsage;
  needsCompact: boolean;
  messagesToCompact: HistoryTurn[];
  documentBlockForModel: string;
};

export function assembleWritingIntentContext(params: {
  systemPrompt: string;
  summary?: string | null;
  history: HistoryTurn[];
  chapterBlock: string;
  documentBlock: string;
  userMessage: string;
  limitTokens?: number;
  outputReserve?: number;
}): AssembleWritingIntentResult {
  const limitTokens = params.limitTokens ?? getContextWindowTokens();
  const outputReserve = params.outputReserve ?? DEFAULT_OUTPUT_RESERVE_TOKENS;

  const breakdown: ContextUsageBreakdown = {
    system: estimateTokens(params.systemPrompt),
    summary: 0,
    history: 0,
    document: estimateTokens(params.chapterBlock) + estimateTokens(params.documentBlock),
    pendingUser: estimateTokens(`用户说：${params.userMessage}`),
    outputReserve,
  };

  const summaryText = params.summary?.trim()
    ? `${SUMMARY_PREFIX}${params.summary.trim()}`
    : '';
  breakdown.summary = estimateTokens(summaryText);

  let documentBlockForModel = params.documentBlock;
  const fixedWithoutDoc =
    breakdown.system +
    breakdown.summary +
    breakdown.pendingUser +
    breakdown.outputReserve;

  let historyBudget = Math.max(0, limitTokens - fixedWithoutDoc - breakdown.document);
  let { fitted, omitted, used } = fitHistoryFromEnd(params.history, historyBudget);

  if (omitted.length > 0 && params.documentBlock) {
    // pendingUser 已含在 fixedWithoutDoc 里，这里不能再减一次
    const docBudget = Math.max(
      600,
      limitTokens -
        fixedWithoutDoc -
        used -
        estimateTokens(params.chapterBlock) -
        500,
    );
    const prefix = '全篇节选（供理解意图；实际改稿仍只改上面这一段）：\n';
    documentBlockForModel = params.documentBlock.startsWith('全篇')
      ? trimTextToTokenBudget(params.documentBlock, docBudget)
      : trimTextToTokenBudget(`${prefix}${params.documentBlock}`, docBudget);
    breakdown.document =
      estimateTokens(params.chapterBlock) + estimateTokens(documentBlockForModel);
    historyBudget = Math.max(0, limitTokens - fixedWithoutDoc - breakdown.document);
    const retry = fitHistoryFromEnd(params.history, historyBudget);
    fitted = retry.fitted;
    omitted = retry.omitted;
    used = retry.used;
  }

  breakdown.history = used;

  const finalUserContent = [
    params.chapterBlock,
    documentBlockForModel,
    `用户说：${params.userMessage}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const messages: ContextChatMessage[] = [{ role: 'system', content: params.systemPrompt }];
  if (summaryText) {
    messages.push({ role: 'user', content: summaryText });
  }
  for (const turn of fitted) {
    messages.push(turn);
  }
  messages.push({ role: 'user', content: finalUserContent });

  breakdown.document =
    estimateTokens(params.chapterBlock) + estimateTokens(documentBlockForModel);

  const needsCompact = omitted.length > 0;
  const usage = buildUsage(
    limitTokens,
    breakdown,
    Boolean(params.summary?.trim()) || needsCompact,
    omitted.length,
  );

  return {
    messages,
    usage,
    needsCompact,
    messagesToCompact: omitted,
    documentBlockForModel,
  };
}

export function assembleWritingExecuteContext(params: {
  systemPrompt: string;
  userParts: string[];
  limitTokens?: number;
  outputReserve?: number;
}): { messages: ContextChatMessage[]; usage: ContextUsage; userContent: string } {
  const limitTokens = params.limitTokens ?? getContextWindowTokens();
  const outputReserve = params.outputReserve ?? DEFAULT_OUTPUT_RESERVE_TOKENS;

  let userContent = params.userParts.filter(Boolean).join('\n\n');
  const systemTokens = estimateTokens(params.systemPrompt);
  const maxUser = limitTokens - systemTokens - outputReserve - 200;
  if (estimateTokens(userContent) > maxUser) {
    userContent = trimTextToTokenBudget(userContent, maxUser);
  }

  const userTokens = estimateTokens(userContent);
  const breakdown: ContextUsageBreakdown = {
    system: systemTokens,
    summary: 0,
    history: 0,
    document: userTokens,
    pendingUser: 0,
    outputReserve,
  };

  return {
    messages: [
      { role: 'system', content: params.systemPrompt },
      { role: 'user', content: userContent },
    ],
    usage: buildUsage(limitTokens, breakdown, false, 0),
    userContent,
  };
}

const TRIM_SUFFIX = '\n…（下文已按上下文预算压缩）';

export function trimTextToTokenBudget(text: string, maxTokens: number): string {
  if (maxTokens <= 0) return '';
  if (estimateTokens(text) <= maxTokens) return text;
  // S7：用文本自身的 char/token 密度换算初始字符数（CJK≈1、ASCII≈3.5），再校验收紧到
  // 「裁后正文 + 后缀」整体真 <= maxTokens —— 旧版固定按 1.6 chars/token，CJK 文本会超填
  // ~60%、撑爆真实窗口；且要把后缀本身的 token 也算进预算。
  const density = text.length / Math.max(1, estimateTokens(text));
  let maxChars = Math.floor(maxTokens * density);
  while (
    maxChars > 0 &&
    estimateTokens(text.slice(0, maxChars) + TRIM_SUFFIX) > maxTokens
  ) {
    maxChars = Math.floor(maxChars * 0.9);
  }
  // 预算连后缀(≈14 token)都放不下 → 全裁返回空串，绝不返回仅后缀的超预算串。
  if (maxChars <= 0) return '';
  return `${text.slice(0, maxChars)}${TRIM_SUFFIX}`;
}

export function shouldCompact(usage: ContextUsage): boolean {
  return usage.ratio >= COMPACT_THRESHOLD_RATIO || usage.droppedVerbatimTurns > 0;
}
