import type { LlmRequestLogContext } from '@xzz/shared';
import { lastNonEmptyLine } from '@xzz/shared';
import { chatCompletionRaw, type ChatMessageInput } from './deepseek.js';
import { writeAgentMemory } from './integrations/magi.js';

export type EpisodicFact = {
  text: string;
  confidence: number;
};

/** 高置信(≥0.85,仿原生 autoExtract 阈值)自动 approved;否则 pending 待人工审。
 *  待校准参数(plan §M2b 洞E):LLM 自评校准差,MVP 起步保守。 */
const AUTO_APPROVE_THRESHOLD = 0.85;

/**
 * 情景蒸馏(plan §M2b)。**独立于**原生 autoExtract:只抽"非稳定核心"的情景/语义记忆
 * (讨论过的领域事实、学到的东西、个人日常事件),**排除**稳定个人特质(身份/偏好/习惯
 * —— 那些归原生 always-on 核心)。两轴判别线见 CONTEXT「情景蒸馏」。
 *
 * 输出单行 JSON {"facts":[{"text","confidence"}]};拿不准默认收(不对称安全默认偏 MAGI)。
 */
const SYSTEM_PROMPT = `从对话中提炼 0～5 条值得长期记住的**情景/语义**事实。
只抽:讨论过的领域事实、学到的结论、用户的日常事件经历(如"上周面试了 X""在调试 Y 模块")。
**排除**(这些归核心个人记忆,不在这里抽):用户的稳定身份/称呼、长期偏好、固定习惯。
判别:这条 fact 的主语是"用户本人的稳定特质"→ 跳过;是"世界/工作/某次经历"→ 收。
跳过琐碎、一次性调试细节、易搜索的常识。
输出单独一行 JSON,不要代码块:
{"facts":[{"text":"事实","confidence":0.0-1.0}]}
无值得记住的 → {"facts":[]}`;

function parseFacts(rawOut: string): EpisodicFact[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(lastNonEmptyLine(rawOut));
  } catch {
    return [];
  }
  const facts = (parsed as { facts?: unknown[] } | null)?.facts;
  if (!Array.isArray(facts)) return [];
  const out: EpisodicFact[] = [];
  for (const f of facts) {
    const text = (f as { text?: unknown })?.text;
    const confidence = (f as { confidence?: unknown })?.confidence;
    if (typeof text !== 'string' || !text.trim()) continue;
    if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) continue;
    out.push({ text: text.trim(), confidence });
  }
  return out;
}

export async function distillEpisodicMemories(
  apiKey: string,
  transcript: string,
  log?: LlmRequestLogContext,
): Promise<EpisodicFact[]> {
  const raw = await chatCompletionRaw(
    apiKey,
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: transcript },
    ] as ChatMessageInput[],
    { maxTokens: 1024, temperature: 0.2, log },
  );
  return parseFacts(raw);
}

/**
 * 把蒸馏出的情景 fact 写入 MAGI。confidence→status 分流(plan §M2b)。
 * **逐条 fail-open**:单条写失败不影响其他、不抛(边界 best-effort)。返回成功写入数。
 */
export async function persistEpisodicMemories(
  ownerId: string,
  facts: EpisodicFact[],
  opts: {
    sourceRunId?: string | null;
    sourceSessionId?: string | null;
    topicId?: string | null;
    signal?: AbortSignal;
  },
): Promise<number> {
  let written = 0;
  for (const f of facts) {
    const status = f.confidence >= AUTO_APPROVE_THRESHOLD ? 'approved' : 'pending';
    try {
      await writeAgentMemory(
        {
          ownerId,
          text: f.text,
          confidence: f.confidence,
          status,
          sourceRunId: opts.sourceRunId ?? null,
          sourceSessionId: opts.sourceSessionId ?? null,
          topicId: opts.topicId ?? null,
        },
        opts.signal,
      );
      written += 1;
    } catch (e) {
      // 逐条 fail-open:边界 best-effort,丢一条不影响其他;AbortError 仍透传以让 runtime 看到 cancel
      if (e instanceof Error && e.name === 'AbortError') throw e;
    }
  }
  return written;
}
