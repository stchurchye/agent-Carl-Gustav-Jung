/**
 * Agent 初始 plan 生成入口 —— 决定走 echo plan 还是 LLM planner。
 *
 * M1e task 1：从原 `runtime.ts.buildInitialPlan` 拆出，零行为变更。
 * M1e task 11d 之后会改成接收 `LlmChatClient | null` 而非 raw `apiKey`。
 * M1e task 13.4 之后 LLM 失败会 emit `PLANNER_LLM_FALLBACK` notice + recordStep('system_error')。
 */
import { snapshotForAgent } from './contextAdapter.js';
import { generatePlanForEcho, generatePlanWithLlm } from './planner.js';
import type { AgentRun, AgentStep, Plan, TodoItem } from './types.js';
import { resolveLlmClient, resolveEffectiveApiKeyForProvider } from './runLlmClient.js';
import { runControllers } from './runtimeRegistry.js';
import { recordStep } from './stepRecorder.js';
import { emitNotice } from './notices.js';
import { listSteps } from './store.js';

/**
 * M1f polish #1：把最近的 step 失败摘要给 planner 看，避免 replan 复现同样错。
 *
 * 优先级：`tool_error` step（hard throw 后落地的）+ `tool_call` step 带非空 error
 * （M1f #5 soft-fail：ok=false 但没 throw）。最近 3 个就够，再多 token 浪费。
 *
 * 设计：吃 steps 数组而不是 runId —— caller（`buildInitialPlan`）已经 listSteps
 * 过一次，避免重复 DB roundtrip。
 *
 * 返回 undefined（不是空串）以匹配 planner.ts `previousFailure?: string` 的
 * "未传 ↔ 没失败" 语义；`buildPlannerUserPrompt` 在 undefined 时不会渲染相关段落。
 */
export function buildPreviousFailureSummary(
  steps: AgentStep[],
): string | undefined {
  const failed = steps
    .filter(
      (s) =>
        s.kind === 'tool_error' ||
        (s.kind === 'tool_call' && s.error !== null && s.error.length > 0),
    )
    .slice(-3);
  if (failed.length === 0) return undefined;
  return failed
    .map(
      (s, i) =>
        `${i + 1}. tool=${s.toolName ?? '<unknown>'} error=${s.error ?? '<no message>'}`,
    )
    .join('\n');
}

/**
 * issue 0001 B2+B3：续跑(continuation-replan)重建时的「进展摘要」——已完成 todo +
 * 成功步骤的观察。让新 plan 接着未完成的干、不重做已完成的，并基于已得到的结果规划。
 * 两者都空时返回 undefined（与 `progress?: string` 的 "未传 ↔ 没进展" 语义一致）。
 */
export function buildProgressSummary(
  steps: AgentStep[],
  todos: TodoItem[],
): string | undefined {
  const doneTodos = todos.filter((t) => t.status === 'completed');
  const okObservations = steps
    .filter((s) => s.kind === 'tool_call' && (s.error === null || s.error.length === 0))
    .slice(-4);
  if (doneTodos.length === 0 && okObservations.length === 0) return undefined;
  const lines: string[] = [];
  if (doneTodos.length > 0) {
    lines.push('已完成的 todo（不要重做）：');
    for (const t of doneTodos) lines.push(`- ${t.text}`);
  }
  if (okObservations.length > 0) {
    lines.push('已得到的结果：');
    for (const s of okObservations) {
      let out = '';
      try {
        out = JSON.stringify(s.output ?? {}).slice(0, 200);
      } catch {
        out = '[unserializable]';
      }
      lines.push(`- ${s.toolName ?? '<tool>'}: ${out}`);
    }
  }
  return lines.join('\n');
}

/**
 * issue 0001 review #2+#4：从 step 历史里读「续跑触发时塞进 replan step 的进展摘要」。
 * 续跑触发(runExecute loop 尾)在 todos 还完整时调 buildProgressSummary 算好进展、
 * recordStep 进 `{reason:'continuation', progress}`；本函数取最近一条这样的 step。
 * 只认 continuation replan → critique/merge/steer replan 不会带进展。
 */
export function readStashedContinuationProgress(
  steps: AgentStep[],
): string | undefined {
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (s.kind !== 'replan') continue;
    const out = s.output as { reason?: unknown; progress?: unknown } | null;
    if (out?.reason !== 'continuation') continue;
    return typeof out.progress === 'string' && out.progress.length > 0
      ? out.progress
      : undefined;
  }
  return undefined;
}

/**
 * M1c：选择初始 plan 来源。
 * - 测试 env / 缺少 LLM key 时走老的 `generatePlanForEcho`，保证 CI 不依赖外部 LLM。
 * - `echo` 关键词短路仅在显式 dev flag(AGENT_ECHO_KEYWORD=1)下生效（issue 0004：
 *   否则生产里含 "echo" 的真实消息会被误旁路）。
 * - 其余调 `generatePlanWithLlm`（内部失败会再 fallback echo）。
 */
export async function buildInitialPlan(run: AgentRun): Promise<Plan> {
  const text = run.inputText ?? '';
  const isTestEnv =
    process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
  // issue 0004：关键词 echo-fallback 只在显式 dev flag(AGENT_ECHO_KEYWORD=1)下生效。
  // 否则生产里含 "echo" 的真实消息(如"echo 命令怎么用")会被旁路掉 LLM planner、
  // 跑写死的 echo 计划。无 LLM key 时仍有下面的 `if (!llm)` 兜底到 echo。
  const devEchoKeyword = process.env.AGENT_ECHO_KEYWORD === '1';
  const looksLikeEcho = devEchoKeyword && /echo/i.test(text);
  if (isTestEnv || looksLikeEcho) {
    return generatePlanForEcho(text);
  }
  const llm = await resolveLlmClient(run);
  if (!llm) {
    // resolveLlmClient 已 emit NO_API_KEY notice
    return generatePlanForEcho(text);
  }
  try {
    // snapshotForAgent 仍然要一个 DeepSeek key 做摘要（独立链路，不属于 LlmChatClient 抽象）。
    // 取 DeepSeek server/user key 走 per-provider 解析；拿不到就传空串让 snapshot 自己降级。
    const snapshotKey =
      (await resolveEffectiveApiKeyForProvider(run, 'deepseek')) ?? '';
    const snapshot = await snapshotForAgent({
      runId: run.id,
      userId: run.ownerId,
      channel: run.channel,
      sessionId: run.sessionId ?? undefined,
      groupId: run.groupId ?? undefined,
      topicId: run.topicId ?? undefined,
      pendingUser: text,
      apiKey: snapshotKey,
    });
    // cancel 路径：从 runtimeRegistry 取该 run 的 AbortController；如果没有就用一个永不 abort 的（防御）
    const signal =
      runControllers.get(run.id)?.signal ?? new AbortController().signal;
    // M1f polish #1：把上一轮 step failures 拼成摘要传给 planner。
    // initial fresh run（无任何 step）→ helper 返回 undefined → planner 用旧 prompt，
    // 行为完全等价 M1f 之前；replan 场景才会真正起作用。
    // 不区分 run.status：applyReplanningIfNeeded 已经把 status 改回 'running'，
    // 这里没法靠 status 判断；改成"有 failed step 就传"，语义更稳。
    const stepsForPrompt = await listSteps(run.id);
    const previousFailure = buildPreviousFailureSummary(stepsForPrompt);
    // issue 0001 B2+B3（review #2+#4 修复）：进展摘要在续跑触发时(todos 还在)就算好、
    // 塞进 continuation replan step。这里从最近一条 continuation replan 读 —— 既扛过
    // applyReplanningIfNeeded 清空 run.todos（否则"已完成 todo"段永远空），又只有续跑
    // 带进展（不泄漏到 critique/merge/steer replan）。
    const progress = readStashedContinuationProgress(stepsForPrompt);
    return await generatePlanWithLlm({
      inputText: text,
      snapshot,
      llm,
      signal,
      previousFailure,
      progress,
      isSubagent: !!run.parentRunId,
      mergedInputs: run.mergedInputs ?? [], // M7 P1a
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
