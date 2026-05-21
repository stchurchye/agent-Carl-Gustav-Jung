/**
 * Agent 初始 plan 生成入口 —— 决定走 echo plan 还是 LLM planner。
 *
 * M1e task 1：从原 `runtime.ts.buildInitialPlan` 拆出，零行为变更。
 * M1e task 11d 之后会改成接收 `LlmChatClient | null` 而非 raw `apiKey`。
 * M1e task 13.4 之后 LLM 失败会 emit `PLANNER_LLM_FALLBACK` notice + recordStep('system_error')。
 */
import { snapshotForAgent } from './contextAdapter.js';
import { generatePlanForEcho, generatePlanWithLlm } from './planner.js';
import type { AgentRun, Plan } from './types.js';
import { resolveEffectiveApiKey } from './runtimeShared.js';
import { recordStep } from './stepRecorder.js';
import { emitNotice } from './notices.js';

/**
 * M1c：选择初始 plan 来源。
 * - 测试 / `echo` 关键词 / 缺少 LLM key 时走老的 `generatePlanForEcho`，保证 CI 不依赖外部 LLM。
 * - 其余调 `generatePlanWithLlm`（内部失败会再 fallback echo）。
 */
export async function buildInitialPlan(run: AgentRun): Promise<Plan> {
  const text = run.inputText ?? '';
  const isTestEnv =
    process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
  const looksLikeEcho = /echo/i.test(text);
  const effectiveKey = await resolveEffectiveApiKey(run);
  if (isTestEnv || looksLikeEcho || !effectiveKey) {
    return generatePlanForEcho(text);
  }
  try {
    const snapshot = await snapshotForAgent({
      runId: run.id,
      userId: run.ownerId,
      channel: run.channel,
      sessionId: run.sessionId ?? undefined,
      groupId: run.groupId ?? undefined,
      topicId: run.topicId ?? undefined,
      pendingUser: text,
      apiKey: effectiveKey,
    });
    return await generatePlanWithLlm({
      inputText: text,
      snapshot,
      apiKey: effectiveKey,
    });
  } catch (e) {
    // M1e Task 13.4：之前 catch 后静默 fallback echo plan，用户毫无感知。现在写一条
    // system_error step（便于排查）+ emit PLANNER_LLM_FALLBACK notice（让用户在
    // UI 看到 "AI 规划不可用，已退回到 echo 计划"）。
    const errMsg = e instanceof Error ? e.message : String(e);
    try {
      await recordStep({
        runId: run.id,
        kind: 'system_error',
        error: `planner_llm_fallback: ${errMsg}`,
      });
    } catch (recordErr) {
      console.warn('[buildInitialPlan] recordStep failed (suppressed)', recordErr);
    }
    await emitNotice({
      runId: run.id,
      severity: 'warn',
      code: 'PLANNER_LLM_FALLBACK',
      message: 'AI 规划暂时不可用，已退回到 echo 计划。建议稍后重试或检查 DeepSeek key 配置。',
      context: { error: errMsg },
    });
    return generatePlanForEcho(text);
  }
}
