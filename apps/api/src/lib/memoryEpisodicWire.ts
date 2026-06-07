import type { LlmRequestLogContext } from '@xzz/shared';
import type { LlmChatClient } from './llm/types.js';
import { magiSystemEnabled } from './integrations/magi.js';
import { distillEpisodicMemories } from './memoryEpisodicDistill.js';
import { reconcileMemoryWrite } from './memoryReconcile.js';
import { runReflection } from './memoryReflect.js';
import { isAbortError } from './memoryAbort.js';

/** 太短的转录不值得花一次 LLM 蒸馏(仿 autoExtract 的 min 门);只挡"在""好的"这种 trivial ack,
 *  保留有内容的短对话。 */
const MIN_TRANSCRIPT_CHARS = 20;

/**
 * 情景记忆 wiring(plan §M2b/M3)。在 run 收尾调用:
 *   蒸馏转录 → 逐 fact reconcile(写新 / 取代旧 / 跳过重复)。
 *
 * 全程 **fail-open**:任何失败都不抛(绝不影响 run finalize)。owner 锁 run-owner
 * (群聊不跨成员 §5.2)。MAGI 未启用 / 转录过短 → 直接跳过(不浪费 LLM)。
 */
export async function runEpisodicMemory(params: {
  ownerId: string;
  runId: string;
  sessionId: string | null;
  topicId: string | null;
  transcript: string;
  llm: LlmChatClient;
  signal: AbortSignal;
  log?: LlmRequestLogContext;
}): Promise<void> {
  if (!magiSystemEnabled()) return;
  if (params.transcript.trim().length < MIN_TRANSCRIPT_CHARS) return;

  let facts;
  try {
    facts = await distillEpisodicMemories(params.llm, params.transcript, {
      signal: params.signal,
      log: params.log,
    });
  } catch {
    return; // fail-open:蒸馏失败不影响 finalize
  }

  for (const fact of facts) {
    try {
      await reconcileMemoryWrite(params.llm, params.ownerId, fact, {
        sourceRunId: params.runId,
        sourceSessionId: params.sessionId,
        topicId: params.topicId,
        signal: params.signal,
        log: params.log,
      });
    } catch {
      // 逐条 fail-open:单条 reconcile 失败不影响其他、不抛
    }
  }

  // reflection→insight(M4f):节流触发,自上条 insight 以来新增事实够多才合成。内部 fail-open。
  try {
    await runReflection({
      ownerId: params.ownerId,
      llm: params.llm,
      signal: params.signal,
      log: params.log,
      sourceRunId: params.runId,
      sourceSessionId: params.sessionId,
      topicId: params.topicId,
    });
  } catch (e) {
    if (isAbortError(e, params.signal)) throw e;
    // fail-open:反思失败不影响 finalize
  }
}
