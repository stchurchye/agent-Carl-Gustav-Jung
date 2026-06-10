import type { LlmRequestLogContext } from '@xzz/shared';
import { lastNonEmptyLine } from '@xzz/shared';
import type { LlmChatClient } from './llm/types.js';
import {
  markTruthAgentMemory,
  searchAgentMemory,
  writeAgentMemory,
  type MemorySource,
} from './integrations/magi.js';
import { statusForConfidence } from './memoryStatus.js';
import { isAbortError } from './memoryAbort.js';
import type { ReplyRef } from './agent/types.js';

/**
 * K5:研究蒸馏 —— 把 completed run 的终稿 + 终稿真引用(artifact.refs)蒸成
 * 带出处的 findings(单条 claim + sources),写 MAGI 情景层供跨会话再检索。
 *
 * 反幻觉设计:LLM 只输出 sourceIdx(指向编号 refs 清单),**永远不写 URL** ——
 * 代码侧做 idx→source 映射,越界/空 idx 整条丢弃。比 URL 字符串白名单干净
 * (免规范化比对的坑)。
 *
 * 与 fact 蒸馏(memoryEpisodicDistill)是**独立的第二次调用**:两个 prompt 判别线
 * 不互相污染;仅 refs 非空的父 run 触发,每天几次,成本可忽略。
 */

export type ResearchFinding = {
  text: string;
  confidence: number;
  sources: MemorySource[];
};

/** 每 run findings 上限(评审队列防淹的四道闸之一)。 */
export const MAX_FINDINGS_PER_RUN = 4;
const TEXT_MAX = 300;

/** ref label 形如 "Title (1992)" —— 拆出 title 与 year。 */
function parseLabel(label: string | undefined, url: string): { title?: string; year?: number } {
  if (!label || label === url) return {};
  const m = label.match(/^(.*)\s\((\d{4})\)$/);
  if (m) {
    const year = Number(m[2]);
    if (year >= 1500 && year <= 2100) return { title: m[1]!.trim(), year };
  }
  return { title: label };
}

/** url 类 ref → MemorySource(document/diagram 是产物不是出处,不进清单)。 */
export function refsToSources(refs: ReplyRef[]): MemorySource[] {
  return refs
    .filter((r) => r.kind === 'url')
    .map((r) => {
      const { title, year } = parseLabel(r.label, r.id);
      return {
        url: r.id,
        ...(title ? { title } : {}),
        ...(year ? { year } : {}),
      };
    });
}

const SYSTEM_PROMPT = `从研究终稿中提炼 0~${MAX_FINDINGS_PER_RUN} 条值得长期记住的**研究结论(finding)**。
每条 = 一句独立的、可复用的结论(不是来源罗列、不是过程描述),并标注它依据的来源编号。
只收:有明确来源支撑的实质结论。跳过:背景常识、方法论、无来源支撑的推测。
sourceIdx 必须取自给出的资源清单编号 [1..N];一条结论可有多个来源。
输出单独一行 JSON,不要代码块:
{"findings":[{"text":"结论(≤300字)","confidence":0.0-1.0,"sourceIdx":[1]}]}
无值得记住的 → {"findings":[]}`;

type RawFinding = { text?: unknown; confidence?: unknown; sourceIdx?: unknown };

function parseFindings(rawOut: string, sources: MemorySource[]): ResearchFinding[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(lastNonEmptyLine(rawOut));
  } catch {
    return [];
  }
  const raw = (parsed as { findings?: RawFinding[] } | null)?.findings;
  if (!Array.isArray(raw)) return [];
  const out: ResearchFinding[] = [];
  for (const f of raw) {
    if (out.length >= MAX_FINDINGS_PER_RUN) break;
    const text = typeof f?.text === 'string' ? f.text.trim().slice(0, TEXT_MAX) : '';
    const confidence = typeof f?.confidence === 'number' ? f.confidence : NaN;
    const idxs = Array.isArray(f?.sourceIdx)
      ? f.sourceIdx.filter((i): i is number => typeof i === 'number')
      : [];
    if (!text || !(confidence >= 0 && confidence <= 1)) continue;
    // 反幻觉:idx 越界或为空 → 整条丢弃(无真出处的结论不进库,不降级保留)
    if (idxs.length === 0 || idxs.some((i) => !Number.isInteger(i) || i < 1 || i > sources.length)) {
      continue;
    }
    out.push({
      text,
      confidence,
      sources: [...new Set(idxs)].map((i) => sources[i - 1]!),
    });
  }
  return out;
}

export async function distillResearchFindings(
  llm: LlmChatClient,
  finalContent: string,
  refs: ReplyRef[],
  opts: { signal?: AbortSignal; log?: LlmRequestLogContext },
): Promise<ResearchFinding[]> {
  const sources = refsToSources(refs);
  if (sources.length === 0) return [];
  const listing = sources
    .map((s, i) => `[${i + 1}] ${s.title ?? s.url}${s.year ? ` (${s.year})` : ''} — ${s.url}`)
    .join('\n');
  const result = await llm.chat(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `资源清单:\n${listing}\n\n研究终稿:\n${finalContent}` },
    ],
    {
      temperature: 0.2,
      maxTokens: 1024,
      log: opts.log,
      signal: opts.signal ?? new AbortController().signal,
    },
  );
  return parseFindings(result.content, sources);
}

/** 机械近重门:语义分 ≥0.92 且同源 → 重复。 */
const NEAR_DUP_SCORE = 0.92;
/** 争议判官门:语义分 ≥0.85 的近邻才值得花一次 LLM 判 duplicate/contradicts/distinct。 */
const DISPUTE_JUDGE_SCORE = 0.85;

const DISPUTE_PROMPT = `你在维护研究知识库。给你一条**新结论**和一条**已有近似结论**(各带来源)。
判断两者关系,输出单行 JSON:{"verdict":"duplicate|contradicts|distinct","reason":"一句话"}
- duplicate:同一结论的近义重述(无论来源异同),无新信息。
- contradicts:两条结论互相矛盾(一真则另一伪)。
- distinct:相关但不矛盾的不同结论。
注意:来源不同、结论冲突的两条都是证据,不要把 contradicts 误判成 duplicate。`;

type DisputeVerdict = { verdict: 'duplicate' | 'contradicts' | 'distinct'; reason: string };

function parseVerdict(raw: string): DisputeVerdict {
  try {
    const p = JSON.parse(lastNonEmptyLine(raw)) as { verdict?: unknown; reason?: unknown };
    const v = p.verdict;
    if (v === 'duplicate' || v === 'contradicts' || v === 'distinct') {
      return { verdict: v, reason: typeof p.reason === 'string' ? p.reason : '' };
    }
  } catch {
    // fallthrough
  }
  return { verdict: 'distinct', reason: '' };
}

export type PersistFindingsResult = { written: number; deduped: number; disputed: number };

/**
 * K5:findings 持久化 —— 逐条:机械近重门(≥0.92 同源跳过)→ 近邻 ≥0.85 跑争议判官
 * (duplicate 跳过 / contradicts 写新 + 旧条标 disputed 带反证 / distinct 并存)→ 写入。
 *
 * **不走 reconcile 自动失效**:来源不同、结论冲突的 finding 是科研信息本身,自动失效
 * = 销毁证据;判官只升到 disputed(人裁决 refuted)。判官失败按 distinct 处理
 * (宁并存不误标)。逐条 fail-open;AbortError 透传。
 */
export async function persistResearchFindings(
  llm: LlmChatClient,
  ownerId: string,
  findings: ResearchFinding[],
  opts: {
    sourceRunId?: string | null;
    topicId?: string | null;
    signal?: AbortSignal;
    log?: LlmRequestLogContext;
  },
): Promise<PersistFindingsResult> {
  const result: PersistFindingsResult = { written: 0, deduped: 0, disputed: 0 };
  for (const f of findings) {
    try {
      const near = await searchAgentMemory(ownerId, f.text, 1, opts.signal, true, ['finding']);
      const top = near[0];
      if (
        top &&
        top.score >= NEAR_DUP_SCORE &&
        (top.sources ?? []).some((s) => f.sources.some((ns) => ns.url === s.url))
      ) {
        result.deduped += 1;
        continue;
      }

      let disputeTarget: { id: number; reason: string } | null = null;
      if (top && top.score >= DISPUTE_JUDGE_SCORE) {
        try {
          const r = await llm.chat(
            [
              { role: 'system', content: DISPUTE_PROMPT },
              {
                role: 'user',
                content:
                  `新结论:${f.text}\n来源:${f.sources.map((s) => s.url).join(' ')}\n\n` +
                  `已有近似:[id=${top.id}] ${top.text}\n来源:${(top.sources ?? []).map((s) => s.url).join(' ') || '(无)'}`,
              },
            ],
            {
              temperature: 0,
              maxTokens: 256,
              log: opts.log,
              signal: opts.signal ?? new AbortController().signal,
            },
          );
          const verdict = parseVerdict(r.content);
          if (verdict.verdict === 'duplicate') {
            result.deduped += 1;
            continue;
          }
          if (verdict.verdict === 'contradicts') {
            disputeTarget = { id: top.id, reason: verdict.reason };
          }
        } catch (e) {
          if (isAbortError(e, opts.signal)) throw e;
          // 判官失败 → 按 distinct 并存(宁并存不误标)
        }
      }

      await writeAgentMemory(
        {
          ownerId,
          text: f.text,
          confidence: f.confidence,
          status: statusForConfidence(f.confidence),
          kind: 'finding',
          sources: f.sources,
          sourceRunId: opts.sourceRunId ?? null,
          topicId: opts.topicId ?? null,
        },
        opts.signal,
      );
      result.written += 1;

      if (disputeTarget) {
        try {
          await markTruthAgentMemory(
            ownerId,
            disputeTarget.id,
            'disputed',
            {
              ...(disputeTarget.reason ? { truthNote: disputeTarget.reason } : {}),
              counterSources: f.sources,
            },
            opts.signal,
          );
          result.disputed += 1;
        } catch (e) {
          if (isAbortError(e, opts.signal)) throw e;
          // 标争议失败不阻断(新条已写,争议提示下次再补)
        }
      }
    } catch (e) {
      if (isAbortError(e, opts.signal)) throw e;
      // 逐条 fail-open:单条失败不影响其他
    }
  }
  return result;
}
