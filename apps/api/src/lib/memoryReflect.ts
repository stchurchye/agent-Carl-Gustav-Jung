import type { LlmRequestLogContext } from '@xzz/shared';
import { lastNonEmptyLine } from '@xzz/shared';
import type { LlmChatClient } from './llm/types.js';
import {
  listAgentMemory,
  writeAgentMemory,
  type MemoryListItem,
} from './integrations/magi.js';
import { statusForConfidence } from './memoryStatus.js';
import { isAbortError } from './memoryAbort.js';

/** 默认节流:自上条 insight 以来累计 ≥ 这么多条新 approved 事实才反思一次(起步保守,见 ADR M4-2)。 */
const REFLECT_MIN_NEW_FACTS = 8;
/** 合成输入的宽窗口:取最近 N 条 approved 事实(非仅增量,保洞见质量,见 ADR M4-2)。 */
const REFLECT_WINDOW = 30;

export type Insight = {
  text: string;
  confidence: number;
  sourceFragmentIds: number[];
};

const SYNTH_PROMPT = `你在为用户做长期记忆的"反思"。给你若干条带 id 的事实,综合出 0～3 条更高层的**洞见**
(跨多条事实的模式/结论/画像),每条标注由哪些事实 id 合成。
不要简单复述单条事实;只在能跨条归纳时才产出。拿不准就少产或不产。
输出单独一行 JSON,不要代码块:
{"insights":[{"text":"洞见","confidence":0.0-1.0,"source_fragment_ids":[1,2]}]}
无可归纳 → {"insights":[]}`;

function parseInsights(raw: string): Insight[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(lastNonEmptyLine(raw));
  } catch {
    return [];
  }
  const arr = (parsed as { insights?: unknown[] } | null)?.insights;
  if (!Array.isArray(arr)) return [];
  const out: Insight[] = [];
  for (const x of arr) {
    const text = (x as { text?: unknown })?.text;
    const confidence = (x as { confidence?: unknown })?.confidence;
    const ids = (x as { source_fragment_ids?: unknown })?.source_fragment_ids;
    if (typeof text !== 'string' || !text.trim()) continue;
    if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) continue;
    const sourceFragmentIds = Array.isArray(ids)
      ? ids.filter((n): n is number => typeof n === 'number')
      : [];
    out.push({ text: text.trim(), confidence, sourceFragmentIds });
  }
  return out;
}

async function synthesize(
  llm: LlmChatClient,
  facts: MemoryListItem[],
  signal: AbortSignal,
  log?: LlmRequestLogContext,
): Promise<Insight[]> {
  const listing = facts.map((f) => `[id=${f.id}] ${f.text}`).join('\n');
  const result = await llm.chat(
    [
      { role: 'system', content: SYNTH_PROMPT },
      { role: 'user', content: listing },
    ],
    { temperature: 0.3, maxTokens: 1024, log, signal },
  );
  return parseInsights(result.content);
}

/**
 * reflection→insight(plan §M4f / ADR M4-2)。在 run 收尾边界**节流**触发:
 * 自上条 insight 以来新增 approved 事实 ≥ 阈值,才对最近一窗事实做 LLM 合成 → 写 kind='insight'
 * (带 source_fragment_ids provenance,经 statusForConfidence 分流)。
 *
 * 全程 **fail-open**:任何失败都不抛(绝不影响 run finalize);AbortError 透传。owner 锁传入值。
 * 合成产出的 source_fragment_ids 只保留落在合成窗口内的 id(挡 LLM 幻觉引用)。
 */
export async function runReflection(params: {
  ownerId: string;
  llm: LlmChatClient;
  signal: AbortSignal;
  log?: LlmRequestLogContext;
  sourceRunId?: string | null;
  sourceSessionId?: string | null;
  topicId?: string | null;
  minNewFacts?: number;
  window?: number;
}): Promise<{ reflected: boolean; written: number; newFactCount: number }> {
  const minNew = params.minNewFacts ?? REFLECT_MIN_NEW_FACTS;
  const windowSize = params.window ?? REFLECT_WINDOW;
  try {
    // 全量(各 status/kind):用 insight 找节流基线,用 approved fact 做合成。list 按 created_at DESC。
    const items = await listAgentMemory(params.ownerId, undefined, params.signal);
    // 用毫秒数值比较时间戳,不用字典序:isoformat() 在 microsecond=0 时省略小数位,
    // 同实例内精度可能不一('…:00+00:00' vs '…:00.123456+00:00'),字典序会误排(`.`>`+`)。
    const ms = (s: string | null): number => (s ? Date.parse(s) : NaN);
    let lastInsightMs = -Infinity;
    for (const it of items) {
      if (it.kind === 'insight') {
        const t = ms(it.createdAt);
        if (!Number.isNaN(t) && t > lastInsightMs) lastInsightMs = t;
      }
    }
    const hasInsight = lastInsightMs > -Infinity;
    const approvedFacts = items.filter((i) => i.kind === 'fact' && i.status === 'approved');
    const newFacts = hasInsight
      ? approvedFacts.filter((f) => {
          const t = ms(f.createdAt);
          return !Number.isNaN(t) && t > lastInsightMs;
        })
      : approvedFacts;
    if (newFacts.length < minNew) {
      return { reflected: false, written: 0, newFactCount: newFacts.length };
    }

    const windowFacts = approvedFacts.slice(0, windowSize); // DESC → 最近 N 条
    const windowIds = new Set(windowFacts.map((f) => f.id));
    const insights = await synthesize(params.llm, windowFacts, params.signal, params.log);

    let written = 0;
    for (const ins of insights) {
      const sources = ins.sourceFragmentIds.filter((id) => windowIds.has(id));
      try {
        await writeAgentMemory(
          {
            ownerId: params.ownerId,
            text: ins.text,
            confidence: ins.confidence,
            status: statusForConfidence(ins.confidence),
            kind: 'insight',
            sourceFragmentIds: sources.length ? sources : undefined,
            sourceRunId: params.sourceRunId ?? null,
            sourceSessionId: params.sourceSessionId ?? null,
            topicId: params.topicId ?? null,
          },
          params.signal,
        );
        written += 1;
      } catch (e) {
        if (isAbortError(e, params.signal)) throw e;
        // 逐条 fail-open:单条 insight 写失败不影响其他
      }
    }
    return { reflected: true, written, newFactCount: newFacts.length };
  } catch (e) {
    if (isAbortError(e, params.signal)) throw e;
    return { reflected: false, written: 0, newFactCount: 0 };
  }
}
