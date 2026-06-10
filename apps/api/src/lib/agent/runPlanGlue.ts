/**
 * Agent 初始 plan 生成入口 —— 决定走 echo plan 还是 LLM planner。
 *
 * M1e task 1：从原 `runtime.ts.buildInitialPlan` 拆出，零行为变更。
 * M1e task 11d 之后会改成接收 `LlmChatClient | null` 而非 raw `apiKey`。
 * M1e task 13.4 之后 LLM 失败会 emit `PLANNER_LLM_FALLBACK` notice + recordStep('system_error')。
 */
import { snapshotForAgent } from './contextAdapter.js';
import {
  generatePlanForEcho,
  generatePlanWithLlm,
  PlannerUnknownToolError,
} from './planner.js';
import type { AgentRun, AgentStep, Plan, TodoItem } from './types.js';
import { resolveLlmClient, resolveEffectiveApiKeyForProvider } from './runLlmClient.js';
import { runControllers } from './runtimeRegistry.js';
import { recordStep } from './stepRecorder.js';
import { emitNotice } from './notices.js';
import { listSteps } from './store.js';
import { redactSecrets } from './redact.js';
import { buildListFinding } from './checkpoint.js';

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
        // R2-2:list 类输出(搜索结果等)结构化为 title+url 摘录 —— 原 200 字 JSON 截断
        // 会碎在 snippet 中间,planner 只见乱码、看不见"搜到什么"。其余形状仍走截断 JSON。
        const inner = (s.output as { result?: unknown } | null)?.result ?? s.output;
        const structured = buildListFinding(inner);
        // 送 planner 的投影 → 脱敏（与 digestTail/findings/summarizeStepOutput 一致；
        // 持久化的 step.output 保持原始）。此前漏脱敏，密钥会经 progress 摘要泄给 planner。
        out = structured ?? JSON.stringify(redactSecrets(s.output) ?? {}).slice(0, 200);
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
/**
 * S3：最近一条 replan 是否是 continuation（续跑）。用于只在续跑时给 planner 注入
 * checkpoint 的「自动续跑中」框架 —— steer / merge_trigger / approval_deny 等用户/系统
 * 驱动的 replan 不该被注入"不要问是否继续"的陈旧续跑框架。
 */
export function latestReplanIsContinuation(steps: AgentStep[]): boolean {
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].kind !== 'replan') continue;
    const out = steps[i].output as { reason?: unknown } | null;
    return out?.reason === 'continuation';
  }
  return false;
}

export function readStashedContinuationProgress(
  steps: AgentStep[],
): string | undefined {
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (s.kind !== 'replan') continue;
    const out = s.output as { reason?: unknown; progress?: unknown } | null;
    // 只认**最近一条** replan：若它不是 continuation（如更新的 steer/deny replan）→ undefined，
    // 别越过它去取更旧 continuation 的 progress（否则 stale progress 污染 steer/deny 重规划）。
    // 与 readStashedReplanDirective / latestReplanIsContinuation 的「最近一条」语义对齐。
    if (out?.reason !== 'continuation') return undefined;
    return typeof out.progress === 'string' && out.progress.length > 0
      ? out.progress
      : undefined;
  }
  return undefined;
}

/**
 * M1c steer/deny → LLM 重规划：从最近一条 replan step 读 steer/deny 的 directive。
 * applyReplanningIfNeeded 在 steer/deny 触发时 record `{reason:'steer'|'approval_deny', directive}`
 * 并清 plan；buildInitialPlan 据此把 directive 喂给 planner（替代旧 M1b echo 桩）。
 *
 * 只认**最近一条 replan**：若它是 steer/deny → 返 directive；是 continuation/critique → undefined
 * （避免历史里残留的旧 steer/deny directive 污染后续续跑/critique 重规划）。
 */
export function readStashedReplanDirective(
  steps: AgentStep[],
): { reason: 'steer' | 'approval_deny'; directive: string } | undefined {
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].kind !== 'replan') continue;
    const out = steps[i].output as { reason?: unknown; directive?: unknown } | null;
    if (out?.reason !== 'steer' && out?.reason !== 'approval_deny') return undefined;
    return typeof out.directive === 'string' && out.directive.length > 0
      ? { reason: out.reason, directive: out.directive }
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
  // M1c steer/deny directive：最近一条 replan 若是 steer/deny，取其 directive(强制改向/避开被拒工具)。
  // 测试环境 / 无 LLM key 时 echo fallback 用 directive 文本(≈ 旧 M1b echo 桩,保留可测性);
  // 有 LLM 时作为 replanDirective 进 planner prompt(最高优先级)。allSteps 一次取、下面复用。
  const allSteps = await listSteps(run.id);
  // stashed 仅用于 previousFailure 抑制（判断最近一条 replan 是否 steer/deny 触发）；
  // directive 内容不从此读 —— steer/deny 都已持久化到 run 级列。
  const stashed = readStashedReplanDirective(allSteps);
  // M1c：steer 改向 = 持久 run.steerDirective；deny 避坑 = 持久 run.deniedTools。两者都跨后续
  // continuation replan 不丢（权威源是 run 级列）。并存时合并注入（改的目标 + 避开被拒工具）。
  const persistentSteer = run.steerDirective ?? undefined;
  const deniedTools = run.deniedTools ?? [];
  const deniedConstraint = deniedTools.length
    ? `不要调用以下已被用户拒绝的工具：${deniedTools.map((t) => '`' + t + '`').join('、')}。改用其他工具或方式达成原任务目标。`
    : undefined;
  const replanDirective =
    [persistentSteer, deniedConstraint].filter(Boolean).join('\n\n') || undefined;
  // echo fallback(无 LLM / 测试)：steer = 新方向 → echo 从 directive；deny/无 → 原 inputText
  // （deny 是约束、不替代原任务）。
  const echoText = persistentSteer ?? text;
  const isTestEnv =
    process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
  // issue 0004：关键词 echo-fallback 只在显式 dev flag(AGENT_ECHO_KEYWORD=1)下生效。
  // 否则生产里含 "echo" 的真实消息(如"echo 命令怎么用")会被旁路掉 LLM planner、
  // 跑写死的 echo 计划。无 LLM key 时仍有下面的 `if (!llm)` 兜底到 echo。
  const devEchoKeyword = process.env.AGENT_ECHO_KEYWORD === '1';
  const looksLikeEcho = devEchoKeyword && /echo/i.test(text);
  if (isTestEnv || looksLikeEcho) {
    return generatePlanForEcho(echoText);
  }
  const llm = await resolveLlmClient(run);
  if (!llm) {
    // resolveLlmClient 已 emit NO_API_KEY notice
    return generatePlanForEcho(echoText);
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
    const stepsForPrompt = allSteps;
    // M1c：只在**紧接的 steer replan** 抑制 previousFailure —— steer 改向**放弃原任务**，旧任务
    // 的失败是噪声。deny 不抑制：deny 是约束、**原任务仍在**，任务上的真失败 critique/replan 仍需要。
    // 持久 steer 单独存在的后续 replan（stash 已被 continuation/critique 覆盖）也带 previousFailure。
    const previousFailure =
      stashed?.reason === 'steer'
        ? undefined
        : buildPreviousFailureSummary(stepsForPrompt);
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
      replanDirective, // M1c：steer/deny 强制改向指令(最高优先级)
      // P0-S5：只要有 checkpoint 就传(applyReplanningIfNeeded 已在所有 replan 路径累积)——
      // steer/deny/critique/merge 重规划不再丢早期发现(防重复搜索)。框架按是否续跑分流:
      // continuation 用「自动续跑中」;其余用中性「已有任务进展(供参考,新指令优先)」。
      checkpoint: run.contextCheckpoint,
      checkpointIsContinuation: latestReplanIsContinuation(stepsForPrompt),
      isSubagent: !!run.parentRunId,
      role: run.role, // M3-S1：子 agent 按 role 取工具子集

      mergedInputs: run.mergedInputs ?? [], // M7 P1a
    });
  } catch (e) {
    // issue 0005 AC②:generatePlanWithLlm 已带原因重试过一次、仍引用未知工具 →
    // **不再 echo 降级**(降级会让用户拿到无意义 echo 回复、错误不可见)。
    // 记 system_error + notice 后透传,由 executeRun 外层 catch 收尾 failed(终态,error 写明工具名)。
    if (e instanceof PlannerUnknownToolError) {
      const toolList = e.unknownTools.join('、');
      try {
        await recordStep({
          runId: run.id,
          kind: 'system_error',
          error: `planner_unknown_tool: ${toolList}(重试一次后仍引用未注册工具)`,
        });
      } catch (recordErr) {
        console.warn('[buildInitialPlan] recordStep failed (suppressed)', recordErr);
      }
      await emitNotice({
        runId: run.id,
        severity: 'error',
        code: 'PLANNER_UNKNOWN_TOOL',
        message: `AI 规划反复引用不存在的工具(${toolList}),本次任务终止。`,
        context: { unknownTools: e.unknownTools },
      });
      throw e;
    }
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
    // M1c：LLM 失败时 echo fallback 也用 echoText(steer 走 directive)，否则 steer 改向会被静默丢、
    // 退回原 inputText 跑老目标（且 plan 非空不再重进 replanning，用户的中途改向永久丢失）。
    return generatePlanForEcho(echoText);
  }
}
