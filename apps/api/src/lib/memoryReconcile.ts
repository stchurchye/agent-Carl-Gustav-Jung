import type { LlmRequestLogContext } from '@xzz/shared';
import { lastNonEmptyLine } from '@xzz/shared';
import type { LlmChatClient } from './llm/types.js';
import {
  searchAgentMemory,
  writeAgentMemory,
  invalidateAgentMemory,
  type MemoryHit,
} from './integrations/magi.js';
import { statusForConfidence } from './memoryStatus.js';

const NEAR_TOP_K = 5;

export type ReconcileResult = {
  action: 'new' | 'supersede' | 'duplicate';
  writtenId?: number;
  invalidatedIds: number[];
};

type Judgment = { supersededIds: number[]; duplicate: boolean };

const JUDGE_PROMPT = `你在维护用户的长期记忆。给你一条**新事实**和若干条**已有近似事实**(带 id)。
判断新事实与已有的关系,输出单行 JSON:
{"supersededIds":[被新事实取代/作废的旧 id],"duplicate":新事实是否只是已有的近义重述}
规则:
- 新事实与某旧事实**矛盾/更新了它**(如"改用 Rust" vs 旧"用 Python")→ 该旧 id 进 supersededIds。
- 新事实只是已有的**近义重述**、无新信息 → duplicate=true(supersededIds 可空)。
- 新事实是**全新**信息 → duplicate=false 且 supersededIds=[]。`;

function parseJudgment(raw: string): Judgment {
  try {
    const p = JSON.parse(lastNonEmptyLine(raw)) as {
      supersededIds?: unknown;
      duplicate?: unknown;
    };
    const ids = Array.isArray(p.supersededIds)
      ? p.supersededIds.filter((x): x is number => typeof x === 'number')
      : [];
    return { supersededIds: ids, duplicate: p.duplicate === true };
  } catch {
    return { supersededIds: [], duplicate: false };
  }
}

async function judgeSupersession(
  llm: LlmChatClient,
  newText: string,
  candidates: MemoryHit[],
  signal: AbortSignal,
  log?: LlmRequestLogContext,
): Promise<Judgment> {
  const listing = candidates.map((c) => `[id=${c.id}] ${c.text}`).join('\n');
  const result = await llm.chat(
    [
      { role: 'system', content: JUDGE_PROMPT },
      { role: 'user', content: `新事实:${newText}\n\n已有近似:\n${listing}` },
    ],
    { maxTokens: 256, temperature: 0, log, signal },
  );
  return parseJudgment(result.content);
}

/**
 * 时序失效("会更新",plan §M3)。写新 fact 前对同 owner 做语义近邻 → agent 侧 LLM 判:
 * - 取代(矛盾) → 写新 + 失效旧(valid_until,不删)
 * - 近重复     → 跳过写入(防累积,洞C)
 * - 全新       → 直接写
 * invalidate 逐条 fail-open(失败不阻断;AbortError 透传)。
 *
 * 注(洞D):search 当前只返 approved,故只对 approved 旧 fact 失效;pending 覆盖待 M1
 * 加 pending-inclusive 模式后跟进。
 */
export async function reconcileMemoryWrite(
  llm: LlmChatClient,
  ownerId: string,
  newFact: { text: string; confidence: number },
  opts: {
    sourceRunId?: string | null;
    sourceSessionId?: string | null;
    topicId?: string | null;
    signal?: AbortSignal;
    log?: LlmRequestLogContext;
  },
): Promise<ReconcileResult> {
  const status = statusForConfidence(newFact.confidence);
  const writeNew = () =>
    writeAgentMemory(
      {
        ownerId,
        text: newFact.text,
        confidence: newFact.confidence,
        status,
        sourceRunId: opts.sourceRunId ?? null,
        sourceSessionId: opts.sourceSessionId ?? null,
        topicId: opts.topicId ?? null,
      },
      opts.signal,
    );

  const near = await searchAgentMemory(ownerId, newFact.text, NEAR_TOP_K, opts.signal);
  if (near.length === 0) {
    const { id } = await writeNew();
    return { action: 'new', writtenId: id, invalidatedIds: [] };
  }

  const judgment = await judgeSupersession(
    llm,
    newFact.text,
    near,
    opts.signal ?? new AbortController().signal,
    opts.log,
  );
  if (judgment.duplicate && judgment.supersededIds.length === 0) {
    return { action: 'duplicate', invalidatedIds: [] };
  }

  const { id } = await writeNew();
  const invalidatedIds: number[] = [];
  for (const oldId of judgment.supersededIds) {
    try {
      await invalidateAgentMemory(ownerId, oldId, opts.signal);
      invalidatedIds.push(oldId);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      // 逐条 fail-open:失效失败不阻断;新 fact 已写,旧条暂留,下次对账
    }
  }
  return {
    action: invalidatedIds.length > 0 ? 'supersede' : 'new',
    writtenId: id,
    invalidatedIds,
  };
}
