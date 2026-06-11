/**
 * Agent runtime 执行主循环 —— reclaim / approval gate / idempotency gate / tool dispatch / critique。
 *
 * M1e task 1：从原 `runtime.ts.executeRun + resolveToolCallKey` 拆出，零行为变更。
 * 拆分细节：reclaim / approval / replanning 三段长 helper 抽到 `runExecuteHelpers.ts`，
 * 主文件保留 main loop。
 *
 * 依赖关系：
 *   runExecute → runLifecycle.softComplete（terminal 状态收尾）
 *   runExecute → runPlanGlue.buildInitialPlan（首次进入时生成 plan）
 *   runExecute → runtimeShared.withTimeout（tool handler 兜底超时）
 *   runExecute → runtimeRegistry.runControllers（cancel / steer 共享 AbortController）
 */
import { randomUUID } from 'crypto';
import * as store from './store.js';
import { PlannerUnknownToolError } from './planner.js';
import {
  AgentBudgetExhausted,
  AgentCancelled,
  type AgentCheckpoint,
  type AgentRun,
  type AgentStep,
  type Plan,
  type TodoItem,
} from './types.js';
import { runCritique, isToolFailure, isLowSignalSearch } from './critique.js';
import { agentHookBus } from './hooks.js';
import { recordStep, incrementUsage, startHeartbeat } from './stepRecorder.js';
import { toolRegistry } from './toolRegistry.js';
import { checkBudget } from './budget.js';
import { runControllers } from './runtimeRegistry.js';
import { TOOL_TIMEOUT_MS, HIGH_COST_TOOL_TIMEOUT_MS, withTimeout } from './runtimeShared.js';
import { softComplete } from './runLifecycle.js';
import { buildInitialPlan, buildProgressSummary } from './runPlanGlue.js';
import {
  buildCheckpoint,
  checkpointNeedsCompaction,
  compactCheckpointViaLlm,
  countProgressSteps,
} from './checkpoint.js';
import { resolveLlmClient } from './runLlmClient.js';
import { reflectGoalCompletion } from './reflection.js';
import { pickFallbackFinalContent } from './runReply.js';
import { subagentToolsForRole } from './subagentTools.js';
import {
  resolveToolCallKey,
  applyReplanningIfNeeded,
  recordReclaimIfNeeded,
  detectPendingGrantBypass,
} from './runExecuteHelpers.js';

export { resolveToolCallKey } from './runExecuteHelpers.js';

/**
 * M1f Task 3 followup（review blocker 2）：把任意 tool-returned error 安全
 * 落到 step.error TEXT 列。
 *
 * 历史 cast `(o as { error?: string }).error` 只是编译期断言：buggy 工具
 * 返回 `{ ok: false, error: { code: 500, msg: 'x' } }` 时，对象会被 pg
 * driver 直接 `toString()` 成 `[object Object]`，遮蔽真因；某些 driver
 * 版本甚至抛 type 错。
 *
 * 这里强制把 `error` 抹平成 string，并截断 2000 chars 防意外巨型 stack
 * （chars，不是 bytes —— CJK 实际字节数会更大；如需严格 byte cap 用
 * `Buffer.byteLength`，目前 2000 chars 兜底已够）。
 */
function coerceErrorToString(raw: unknown, fallback: string): string {
  const CAP = 2000;
  if (typeof raw === 'string') return raw.slice(0, CAP);
  if (raw == null) return fallback;
  if (raw instanceof Error) {
    return (raw.message && raw.message.length > 0 ? raw.message : fallback).slice(
      0,
      CAP,
    );
  }
  try {
    return JSON.stringify(raw).slice(0, CAP);
  } catch {
    return fallback;
  }
}

/**
 * S1：reload-before-update 地重算累积 checkpoint。续跑点与收尾点共用，避免重复。
 * 拿最新 contextCheckpoint 作 prior（防 reclaim 重拾竞态），从全量 finalSteps 折叠
 * idx>producedAtIdx 的新步。返回 checkpoint，由调用方连同 status 一起 updateAgentRun。
 */
async function computeCheckpoint(
  runId: string,
  fallbackRun: AgentRun,
  plan: Plan,
  finalSteps: AgentStep[],
  liveTodos: TodoItem[],
  successCount: number,
  signal: AbortSignal,
  /** S5：仅续跑点压缩（压缩成果喂下一轮 planner）；收尾点是末轮、压缩纯属浪费延迟 → false。 */
  allowCompaction: boolean,
): Promise<AgentCheckpoint> {
  const latest = (await store.getAgentRun(runId)) ?? fallbackRun;
  const mechanical = buildCheckpoint(latest.contextCheckpoint, finalSteps, liveTodos, {
    goal: fallbackRun.inputText,
    intent: plan.intentSummary,
    successCount,
    toolMap: new Map(toolRegistry.list().map((t) => [t.name, t])),
  });
  // S5：仅在续跑、completed 过大、非测试 env、且未超预算时才 LLM 压缩列表。
  const isTestEnv =
    process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
  const overBudget = latest.usage.tokens >= latest.budget.maxTokens;
  if (
    !allowCompaction ||
    isTestEnv ||
    overBudget ||
    !checkpointNeedsCompaction(mechanical)
  ) {
    return mechanical;
  }
  const llm = await resolveLlmClient(latest);
  if (!llm) return mechanical;
  try {
    // compactCheckpointViaLlm 内部 fail-open；坏输出/出错 → 返回机械版。
    return await compactCheckpointViaLlm({ checkpoint: mechanical, llm, signal });
  } catch (e) {
    // abort 透传：包成 AgentCancelled，让收尾正确标 cancelled（而非 system_error/failed）。
    if (signal.aborted) throw new AgentCancelled('user');
    throw e;
  }
}

/**
 * 收尾兜底(2026-06-10 review,预存在):收尾点 computeCheckpoint→updateAgentRun 抛错
 * (网络超时/DB 抖动)时,外层 catch 此前只 softComplete 不补 checkpoint →
 * contextCheckpoint 停留在续跑时刻旧值,末轮发现丢失。这里在 catch 里 best-effort
 * 补写**机械版** checkpoint(无 LLM、不压缩,与 applyReplanningIfNeeded/steerRun 同款):
 * - prior = DB 最新 contextCheckpoint,buildCheckpoint 按 producedAtIdx 只折新步 →
 *   与 reclaim/续跑增量语义一致,重复补写幂等、producedAtIdx 单调不回退。
 * - fail-open:补写自身再失败(DB 仍坏)只能放弃 —— 吞错,绝不反向炸掉收尾流程。
 */
async function backfillCheckpointBestEffort(
  runId: string,
  fallbackRun: AgentRun,
): Promise<void> {
  try {
    const latest = (await store.getAgentRun(runId)) ?? fallbackRun;
    const steps = await store.listSteps(runId);
    const sinceIdx = latest.contextCheckpoint?.producedAtIdx ?? -1;
    if (!steps.some((s) => s.idx > sinceIdx)) return; // 无新步 → 无可补的发现
    const todos =
      latest.todos.length > 0 ? latest.todos : (latest.plan?.todos ?? []);
    const checkpoint = buildCheckpoint(latest.contextCheckpoint, steps, todos, {
      goal: latest.inputText,
      intent: latest.plan?.intentSummary ?? latest.contextCheckpoint?.intent ?? '',
      successCount: countProgressSteps(steps),
      toolMap: new Map(toolRegistry.list().map((t) => [t.name, t])),
    });
    await store.updateAgentRun(runId, { contextCheckpoint: checkpoint });
  } catch (e) {
    console.warn(
      `[executeRun] 收尾兜底 checkpoint 补写失败(忽略,不挡收尾) run=${runId}`,
      e,
    );
  }
}

export async function executeRun(runId: string): Promise<void> {
  const fetched = await store.getAgentRun(runId);
  if (!fetched) throw new Error(`run not found: ${runId}`);
  let run = fetched;
  if (
    run.status === 'completed' ||
    run.status === 'failed' ||
    run.status === 'cancelled' ||
    run.status === 'budget_exhausted'
  ) {
    return;
  }
  // ADR-1：awaiting_approval 状态绝对不能进入 tool loop——
  // 等 /approve、/deny 或 worker timeout checker 触发后再 re-pickup。
  if (run.status === 'awaiting_approval') return;
  // M3 Task 2：awaiting_user_input 同样必须等 resume API 把 status 切回
  // 'running' 之后 worker 才会再 pickup；提前进入会再问一次同样的问题。
  if (run.status === 'awaiting_user_input') return;

  // 标记本次 executeRun 是否来自 replanning：replanning 会主动 reset usage.steps=0，
  // 这种"假性的 usage 落后于 DB"不应触发 T5 reclaim 逻辑。
  const enteredViaReplanning = run.status === 'replanning';

  run = await applyReplanningIfNeeded(run);

  const abortController = new AbortController();
  runControllers.set(runId, abortController);
  const stopHb = startHeartbeat(runId, 10_000);
  const startedAt = run.startedAt ?? new Date();
  // 每次 executeRun 实际开跑都 emit 一次 run.started；
  // M1c 可细化为仅首次（区分 draft → running vs replanning → running）。
  agentHookBus.emitEvent({ type: 'run.started', run });

  try {
    if (!run.plan) {
      await store.updateAgentRun(runId, { status: 'planning', startedAt });
      const plan = await buildInitialPlan(run);
      await recordStep({ runId, kind: 'plan', output: plan });
      run = (await store.updateAgentRun(runId, {
        plan,
        todos: plan.todos,
        status: 'running',
      }))!;
    }

    const plan = run.plan!;

    const reclaimResult = await recordReclaimIfNeeded(run, enteredViaReplanning);
    run = reclaimResult.run;
    let completedCount = reclaimResult.completedCount;

    // 让 approve 后 re-pickup 时跳过 approval gate 一次。
    let pendingGrantBypass = await detectPendingGrantBypass(runId);

    // M3-S0：本轮是否有 step 被子 agent 工具白名单护栏拦截。用于收尾时区分
    // 「整条 plan 越权、零工作」与「正常完成」—— 前者不应向父 run 报 completed。
    let subagentToolDenied = false;

    for (let i = completedCount; i < plan.steps.length; i++) {
      // === M7 P1：检查未消化追问 → 触发 replan，让 worker re-pickup 走 applyReplanningIfNeeded ===
      // 仅 SELECT 2 列，<1ms（R12）。inputText 永不改写（ADR-M7-13），追问只进 merged_inputs。
      const mergedCounts = await store.getMergedInputCounts(runId);
      if (mergedCounts && mergedCounts.total > mergedCounts.consumed) {
        // 并发 steer 可能已把 status 写成 replanning(steer 竞态,review P1):
        // 此时只标记追问已消化(重规划的 planner 读 run.mergedInputs 全量,不丢),
        // 不再重复写 status、也不发假的 running→replanning 事件污染审计。
        const cur = await store.getAgentRun(runId);
        if (cur?.status === 'replanning') {
          await store.updateAgentRun(runId, {
            mergedInputsConsumedCount: mergedCounts.total,
          });
          return;
        }
        const fromStatus = run.status;
        await recordStep({
          runId,
          kind: 'replan',
          output: {
            reason: 'merge_trigger',
            mergedTotal: mergedCounts.total,
            previouslyConsumed: mergedCounts.consumed,
          },
        });
        await store.updateAgentRun(runId, {
          mergedInputsConsumedCount: mergedCounts.total,
          status: 'replanning',
        });
        const latest = (await store.getAgentRun(runId))!;
        agentHookBus.emitEvent({
          type: 'run.status_changed',
          run: latest,
          from: fromStatus,
          to: 'replanning',
        });
        return;
      }
      // === End M7 P1 ===

      if (abortController.signal.aborted) {
        // 区分 steer vs user cancel：steerRun 已经写了 status='replanning'
        const cur = await store.getAgentRun(runId);
        if (cur?.status === 'replanning') throw new AgentCancelled('steer');
        throw new AgentCancelled('user');
      }

      const elapsedSeconds = Math.floor(
        (Date.now() - startedAt.getTime()) / 1000,
      );
      checkBudget(run.budget, { ...run.usage, elapsedSeconds });

      const planStep = plan.steps[i];

      // === issue 0005 exec 期:plan 含未注册 toolName ===
      // parse 期(parsePlannerJsonDetailed)已拒未知工具,这里兜的是缓存/陈旧 plan
      // 漏过校验的残余路径。不悬挂、不立即 failed:记 tool_error(让重规划 prompt 经
      // buildPreviousFailureSummary 看到「工具 X 不存在」)+ replan 一次;
      // 已经为未知工具 replan 过一次仍遇到 → 抛错由外层 catch 收尾 failed(error 点名工具)。
      const tool = toolRegistry.get(planStep.toolName);
      if (!tool) {
        // 只取 replan 步(listStepsByKind 在 SQL 层过滤,免全量拉 output 大列);
        // **按 toolName 计数**:每个未知工具各允许一次 replan 纠正,别的工具的历史
        // 重试不连坐(review #3)。新 plan 经 parse 校验,不会无限循环。
        const priorReplans = await store.listStepsByKind(runId, 'replan');
        const priorUnknownReplans = priorReplans.filter((s) => {
          const out = s.output as { reason?: string; toolName?: string } | null;
          return out?.reason === 'unknown_tool' && out?.toolName === planStep.toolName;
        }).length;
        await recordStep({
          runId,
          kind: 'tool_error',
          toolName: planStep.toolName,
          input: planStep.input,
          error: `unknown tool: \`${planStep.toolName}\` 不在工具注册表内,只能使用已注册工具`,
        });
        if (priorUnknownReplans >= 1) {
          throw new Error(
            `unknown tool in plan: ${planStep.toolName}(已为未知工具重规划一次,仍引用未注册工具,终止)`,
          );
        }
        const fromStatus = run.status;
        await recordStep({
          runId,
          kind: 'replan',
          output: { reason: 'unknown_tool', toolName: planStep.toolName },
        });
        await store.updateAgentRun(runId, { status: 'replanning' });
        const latest = (await store.getAgentRun(runId))!;
        agentHookBus.emitEvent({
          type: 'run.status_changed',
          run: latest,
          from: fromStatus,
          to: 'replanning',
        });
        return;
      }
      // === End issue 0005 exec 期 ===

      // === M3-S0 subagent tool whitelist (exec-time hard guard) ===
      // 白名单此前只在 planner-time 裁剪工具；但续跑(continuation-replan)、steer、
      // 缓存 plan 等路径能复用未经裁剪的 plan step,绕过 planner 让子 run 执行白名单外
      // 工具(含副作用的 run_python / deep_research)。这里在 handler 调用前的唯一咽喉
      // 处再校验一次:子 run(parentRunId 非空)只能跑白名单内工具,否则记一条
      // subagent_tool_denied step 并跳过。
      //
      // 关键:用专用 kind 'subagent_tool_denied' 而非复用 'approval_deny'。
      // 复用会让 applyReplanningIfNeeded 在该子 run 后续进入 replanning(steer / merge_trigger /
      // critique)时把这条护栏拦截误判成 denyIsNewest,走 deny 重规划分支(记 directive「用户拒绝了
      // 工具 X」+ 清 plan → LLM 重规划),把「安全越权拦截」混淆成「用户拒绝审批,换个方案」。
      if (run.parentRunId && !subagentToolsForRole(run.role).has(tool.name)) {
        await recordStep({
          runId,
          kind: 'subagent_tool_denied',
          toolName: tool.name,
          input: planStep.input,
          error: 'subagent tool not in whitelist (M3-S0 exec-time guard)',
        });
        subagentToolDenied = true;
        // 跳过本步:usage.steps+1 让 for 推进。
        const usage = incrementUsage(run, { steps: 1 });
        run = (await store.updateAgentRun(runId, { usage }))!;
        continue;
      }
      // === End M3-S0 subagent tool whitelist ===

      // === M1c：被拒工具执行期硬门 ===
      // run.deniedTools 是软 prompt 约束（planner 被告知「不要调用 X」）；若 LLM 无视、plan 里
      // 仍排了 X，这里在 handler 调用前**硬拦**：跳过该步（像 approvalMode='never'），免得它再次
      // 撞 approvalMode='ask' 审批门 → 60s 自动 deny → 重规划循环。记 approval_deny + error、
      // **无 output** —— 与 'never' 跳过同形，被 applyReplanningIfNeeded 的 lastDeny(output!=null)
      // 排除，不会被误当「新的用户拒绝」再触发 deny 分支。
      if ((run.deniedTools ?? []).includes(tool.name)) {
        await recordStep({
          runId,
          kind: 'approval_deny',
          toolName: tool.name,
          input: planStep.input,
          error: 'denied tool (exec-time guard: user denied this tool earlier in the run)',
        });
        // 跳过本步：usage.steps+1 让 for 推进。
        const usage = incrementUsage(run, { steps: 1 });
        run = (await store.updateAgentRun(runId, { usage }))!;
        continue;
      }
      // === End 被拒工具硬门 ===

      // === Approval gate (ADR-1) ===
      if (tool.approvalMode === 'never') {
        await recordStep({
          runId,
          kind: 'approval_deny',
          toolName: tool.name,
          input: planStep.input,
          error: 'approvalMode=never',
        });
        // 跳过本步：usage.steps+1 让 for 推进
        const usage = incrementUsage(run, { steps: 1 });
        run = (await store.updateAgentRun(runId, { usage }))!;
        continue;
      }
      if (tool.approvalMode === 'ask') {
        if (pendingGrantBypass) {
          // 已 grant，跳过 gate 一次（消耗）
          pendingGrantBypass = false;
        } else {
          await recordStep({
            runId,
            kind: 'approval_request',
            toolName: tool.name,
            input: planStep.input,
          });
          const stepIdxNow = await store.maxStepIdx(runId);
          await store.updateAgentRun(runId, {
            status: 'awaiting_approval',
            // 工具审批等待窗:给用户更充裕的反应时间(移动端可能没盯着屏),原 60s 易自动超时。
            awaitingApprovalUntil: new Date(Date.now() + 180_000),
            awaitingApprovalStepIdx: stepIdxNow,
            pendingApprovalToolName: tool.name,
          });
          // 让出：不抛错，直接 return；worker 在 approve/deny/timeout 后会 re-pickup
          return;
        }
      }
      // === End approval gate ===

      // === Idempotency gate (M1c, T10; M1e Task 13.3 ownerId 名空间) ===
      const toolCallKey = resolveToolCallKey(tool, planStep, run);
      if (toolCallKey) {
        const cached = await store.findStepByToolCallKey(runId, toolCallKey);
        if (cached && cached.kind === 'tool_call' && cached.output != null) {
          // 命中缓存：写一条 observe step 留痕，不再调外部 handler。
          // observe step 不带 toolCallKey,避免触犯 unique 索引；
          // idempotency 元信息留在 input.idempotencyKey 字段里。
          await recordStep({
            runId,
            kind: 'observe',
            toolName: tool.name,
            input: { cached: true, idempotencyKey: toolCallKey },
            output: cached.output,
          });
          const newTodosC: TodoItem[] = (run.todos.length > 0
            ? run.todos
            : plan.todos
          ).map((t) =>
            t.id === planStep.todoId ? { ...t, status: 'completed' as const } : t,
          );
          const elapsedC = Math.floor(
            (Date.now() - startedAt.getTime()) / 1000,
          );
          // M4 review fix：从 DB 拉最新 run，避免用旧 usage 基准覆盖
          // wrapWithCostAccounting 刚写入的 costCny / tokens。
          // idempotency 命中路径不会触发 LLM，但统一 reload 保持一致。
          const runLatestC = (await store.getAgentRun(runId)) ?? run;
          const usageC = incrementUsage(runLatestC, {
            steps: 1,
            tokens: 0,
            elapsedSeconds: elapsedC - runLatestC.usage.elapsedSeconds,
          });
          run = (await store.updateAgentRun(runId, {
            todos: newTodosC,
            usage: usageC,
          }))!;
          continue;
        }
      }
      // === End idempotency gate ===

      const stepId = randomUUID();
      const ctx = {
        runId,
        stepId,
        ownerId: run.ownerId,
        channel: run.channel,
        sessionId: run.sessionId ?? undefined,
        groupId: run.groupId ?? undefined,
        topicId: run.topicId ?? undefined,
        signal: abortController.signal,
      };

      // M3 hotfix: costHint='high' 的工具（如 deep_research）内部轮询时间可能超过
      // 标准 60s 超时；用更长的超时窗口避免父 run 误触重试并孤儿化子 run。
      const effectiveTimeout =
        tool.costHint === 'high' ? HIGH_COST_TOOL_TIMEOUT_MS : TOOL_TIMEOUT_MS;

      const t0 = Date.now();
      let output: unknown;
      let retried = false;
      try {
        output = await withTimeout(
          tool.handler(planStep.input as never, ctx),
          effectiveTimeout,
        );
      } catch (err) {
        if (abortController.signal.aborted) {
          const cur = await store.getAgentRun(runId);
          if (cur?.status === 'replanning') throw new AgentCancelled('steer');
          throw new AgentCancelled('user');
        }
        try {
          output = await withTimeout(
            tool.handler(planStep.input as never, ctx),
            effectiveTimeout,
          );
          retried = true;
        } catch (err2) {
          await recordStep({
            runId,
            kind: 'tool_error',
            toolName: tool.name,
            input: planStep.input,
            error: String(err2),
          });
          // recordStep await 期间 steer/cancel 可能已落地:此时再抛 err2 会被外层
          // catch 当普通错误 softComplete('failed'),把 steer 设好的 replanning 覆盖掉。
          if (abortController.signal.aborted) {
            const cur = await store.getAgentRun(runId);
            if (cur?.status === 'replanning') throw new AgentCancelled('steer');
            throw new AgentCancelled('user');
          }
          throw err2;
        }
      }
      const durationMs = Date.now() - t0;

      // M1f #5：tool output { ok: false, error } 视为 soft-fail。
      // 不抛错（避免触发 hard-retry / fail run），但把 error 写到 step.error，
      // 下一轮 planner / critique 能在 snapshot 里看到，从而 replan 或跳过。
      //
      // M1f Task 3 followup（review blocker 2）：error 字段经过 coerceErrorToString
      // 兜底，防止 buggy 工具返回 `{ error: SomeObject }` 把 TEXT 列污染成
      // `[object Object]`。
      const softFailed =
        output != null &&
        typeof output === 'object' &&
        'ok' in (output as Record<string, unknown>) &&
        (output as { ok: unknown }).ok === false;
      const softError = softFailed
        ? coerceErrorToString(
            (output as { error?: unknown }).error,
            'soft-fail (tool returned ok=false)',
          )
        : null;

      await recordStep({
        runId,
        kind: 'tool_call',
        toolName: tool.name,
        toolCallKey,
        input: planStep.input,
        output: { result: output, retried },
        durationMs,
        error: softError,
      });

      // issue 0001：soft-fail 的 step 不应把 todo 标 completed —— 否则"没干成的活"
      // 被当作做完,continuation-replan 与 UI todos 卡片都会被误导。
      const newTodos: TodoItem[] = (run.todos.length > 0
        ? run.todos
        : plan.todos
      ).map((t) =>
        t.id === planStep.todoId && !softFailed
          ? { ...t, status: 'completed' as const }
          : t,
      );
      const elapsedFinal = Math.floor(
        (Date.now() - startedAt.getTime()) / 1000,
      );
      // M4 review fix：tool handler 可能内部调用 LLM（如 critique_last_answer），
      // wrapWithCostAccounting 会把 costCny/tokens 写入 DB。
      // 必须先 reload 最新 run，再 incrementUsage，避免旧 usage 覆盖已累加的 cost。
      const runAfterTool = (await store.getAgentRun(runId)) ?? run;
      const usage = incrementUsage(runAfterTool, {
        steps: 1,
        tokens: 0,
        elapsedSeconds: elapsedFinal - runAfterTool.usage.elapsedSeconds,
      });
      run = (await store.updateAgentRun(runId, {
        todos: newTodos,
        usage,
      }))!;

      // === M3 Task 2: ask_user 暂停语义 ===
      // 工具返回 { ok: true, paused: true } 视为"请求用户介入"。
      // 目前只有 ask_user 这么做；把 run 切到 'awaiting_user_input'，
      // 记下问题文本和 stepIdx，跳出主循环 + return executeRun。
      // worker 不会再 pickup（awaiting_user_input 与 awaiting_approval
      // 并列在 workerPickup 跳过列表里）；mobile 端用 resume API 写回
      // 答案后会把 status 切回 'running'。
      const obsObj =
        output != null && typeof output === 'object'
          ? (output as { ok?: unknown; paused?: unknown })
          : null;
      if (
        tool.name === 'ask_user' &&
        obsObj?.ok === true &&
        obsObj?.paused === true
      ) {
        const question = (planStep.input as { question?: unknown })?.question;
        const fromStatus = run.status; // ADR-M7-12：update 前 capture
        // M4 Task 5：写 24h timeout 戳。worker tick 的
        // autoExpireAwaitingUserInput 会自动 cancel('user_timeout')。
        const patch: store.UpdateAgentRunPatch = {
          status: 'awaiting_user_input',
          pendingUserPrompt: typeof question === 'string' ? question : '',
          pendingUserStepIdx: i,
          pendingUserInputExpiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        };
        // M7 T6c：群聊扩展 —— 记录 owner 30s 独占应答的起点。
        if (run.channel === 'group') {
          patch.askUserTargetUserId = run.ownerId;
          patch.askUserStartedAt = new Date();
          patch.askUserOpenedForAllAt = null;
        }
        const updated = (await store.updateAgentRun(runId, patch))!;
        agentHookBus.emitEvent({
          type: 'run.status_changed',
          run: updated,
          from: fromStatus,
          to: 'awaiting_user_input',
        });
        return;
      }

      // === Critique (M1b-2 stub) ===
      const stepsDone = run.usage.steps;
      if (stepsDone > 0 && stepsDone % 5 === 0) {
        const recentTail = (await store.listSteps(runId)).slice(-5);
        const c = runCritique({
          plan,
          recentSteps: recentTail,
          reason: 'periodic',
          mergedInputs: run.mergedInputs, // M7 P3
        });
        await recordStep({ runId, kind: 'critique', output: c });
      }
      const allSteps = await store.listSteps(runId);
      // M1f Task 3 followup（review blocker 1）：用 isToolFailure 把 soft-fail
      // （kind='tool_call' + 非空 error）也算进 critique gate；否则 soft-fail
      // 链路永远进不了 replan，多步全 soft-fail 会一路 completed。
      const recentFailures = allSteps.slice(-4).filter(isToolFailure).length;
      if (recentFailures >= 2) {
        const c = runCritique({
          plan,
          recentSteps: allSteps.slice(-4),
          reason: 'consecutive_failures',
          mergedInputs: run.mergedInputs, // M7 P3
        });
        await recordStep({ runId, kind: 'critique', output: c });
        if (c.shouldReplan) {
          await store.updateAgentRun(runId, { status: 'replanning' });
          return;
        }
      }

      // === R2-3 refine 门:连续低信号搜索(空/低相关垃圾)→ 重规划改写查询 ===
      // 每 run 只触发一次:重规划后若 LLM 换词仍搜垃圾,继续靠 budget/stall guard 兜底,
      // 防 refine↔垃圾结果死循环(与 unknown_tool 的"一次纠正"同精神)。
      const recentLowSignal = allSteps.slice(-4).filter(isLowSignalSearch).length;
      if (recentLowSignal >= 2) {
        // review 修正:用结构化 gate 字段判定,不再 includes 文案(措辞变更/LLM 化不破坏门)。
        const alreadyRefined = allSteps.some(
          (s) =>
            s.kind === 'critique' &&
            (s.output as { gate?: unknown } | null)?.gate === 'low_signal_search',
        );
        if (!alreadyRefined) {
          const c = runCritique({
            plan,
            recentSteps: allSteps.slice(-4),
            reason: 'low_signal_search',
            mergedInputs: run.mergedInputs,
          });
          await recordStep({ runId, kind: 'critique', output: c });
          if (c.shouldReplan) {
            await store.updateAgentRun(runId, { status: 'replanning' });
            return;
          }
        }
      }
      // === End R2-3 refine 门 ===
    }

    // issue 0001 continuation-replan：plan 跑完，但仍有"有 step 却没完成"的 todo
    // （其 step soft-fail 了，且失败数 < critique 的 ≥2 阈值，所以没被 critique 提前
    // replan）→ 续跑一轮而非直接收尾。纯标签 todo（无对应 step）不计入，避免误触发。
    const attemptedTodoIds = new Set(
      plan.steps
        .map((s) => s.todoId)
        .filter((id): id is string => id != null),
    );
    const liveTodos = run.todos.length > 0 ? run.todos : plan.todos;
    const hasUnfinishedAttempted = liveTodos.some(
      (t) => attemptedTodoIds.has(t.id) && t.status !== 'completed',
    );
    // 仅当确有 soft-fail 留下没干成的活才续跑。reclaim / idempotency 命中的成功 step
    // 也可能让 todo 暂为 pending（worker A 崩在标完成前、或缓存跳过标记），但它们没有
    // error，不该误触发续跑 —— 用"存在 soft-fail step"把这两种情况区分开。
    // review #8：只看「上次 replan 之后」的 step，避免上一轮的陈旧 soft-fail 误触发本轮续跑。
    const finalSteps = await store.listSteps(runId);
    const lastReplanIdx = finalSteps.map((s) => s.kind).lastIndexOf('replan');
    const stepsSinceReplan =
      lastReplanIdx >= 0 ? finalSteps.slice(lastReplanIdx + 1) : finalSteps;
    const hadSoftFail = stepsSinceReplan.some(
      (s) => s.kind === 'tool_call' && s.error != null && s.error !== '',
    );
    // 续跑轮数硬上限：replan 会把 usage.steps 重置为 0（applyReplanningIfNeeded），
    // 所以 maxSteps 兜不住续跑循环 —— 确定性 soft-fail 的工具会一直续跑到 maxSeconds/
    // maxTokens 烧完。必须按"已续跑次数"显式封顶。智能"无进展停" = issue 0002。
    const CONTINUATION_ROUND_CAP = 2;
    const continuationRounds = finalSteps.filter(
      (s) =>
        s.kind === 'replan' &&
        (s.output as { reason?: unknown } | null)?.reason === 'continuation',
    ).length;
    // review #9：子 agent 不自行续跑（父 agent 管其生命周期，避免被父超时孤儿化）；
    // budget(token/秒)已耗尽则不再发起续跑（续跑要多一次 planner LLM 调用）。
    const budgetLeft =
      run.usage.tokens < run.budget.maxTokens &&
      run.usage.elapsedSeconds < run.budget.maxSeconds;
    // issue 0003 A：统一收尾决策。生产 + 有 LLM 时，由 reflectGoalCompletion 单点拍板
    // "用户目标达成没"——它从 finalSteps（含 tool_error 硬失败）语义判断，**同时涵盖**
    // 「没干完」(#7：被 replan 丢掉的 todo / #2b：跨轮 todo) 和「关键步骤失败」。
    // test env / 无 LLM / 无工具时回退机械信号（hasUnfinishedAttempted && hadSoftFail），
    // 机械信号从"决策者"降为 fallback。
    const isTestEnvReflect =
      process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
    const didToolWork = finalSteps.some(
      (s) => s.kind === 'tool_call' || s.kind === 'tool_error',
    );
    const canContinue =
      !run.parentRunId &&
      budgetLeft &&
      continuationRounds < CONTINUATION_ROUND_CAP;

    let shouldContinue = false;
    let reflectionReason: string | undefined;
    if (canContinue) {
      if (isTestEnvReflect || !didToolWork) {
        // test env（确定性、无 LLM）/ 没跑过工具的 run：用机械信号兜底。
        shouldContinue = hasUnfinishedAttempted && hadSoftFail;
      } else {
        // 生产 + 跑过工具：由 reflection 单点拍板。拿不到 LLM（无 key）或 reflection 报错
        // → fail-open 收尾，**不**回退机械信号续跑 —— 续跑要 LLM 重规划，没 working
        // reflection 时续跑只会空转烧续跑轮数，直接收尾更稳（review：两条 fail 路径统一）。
        const reflectLlm = await resolveLlmClient(run);
        if (reflectLlm) {
          try {
            const reflection = await reflectGoalCompletion({
              inputText: run.inputText,
              steps: finalSteps,
              llm: reflectLlm,
              signal: abortController.signal,
              // S2：prior 累积 checkpoint + 本轮 tail = 让评审看到整 run。
              checkpoint: run.contextCheckpoint,
            });
            shouldContinue = !reflection.goalMet;
            reflectionReason = reflection.reason;
          } catch {
            // 取消 → 重抛 AgentCancelled，别让外层误标 failed；其它错 → fail-open 收尾。
            if (abortController.signal.aborted) {
              const cur = await store.getAgentRun(runId);
              if (cur?.status === 'replanning') throw new AgentCancelled('steer');
              throw new AgentCancelled('user');
            }
            shouldContinue = false;
          }
        }
        // reflectLlm 为 null（生产无 key）→ shouldContinue 保持 false → 收尾。
      }
    }

    // issue 0002 stall guard：无进展检测。续跑若没产生**新的成功步骤**（累计成功
    // tool_call 数没比上一轮续跑时多），就提前收尾，不傻等到 CONTINUATION_ROUND_CAP。
    // review：observe（idempotency 缓存命中 = 成功复用上一步结果）也算进展，否则
    // 全靠缓存推进的一轮会被误判无进展、提前收尾（还会盖掉 reflection 的"没完成"）。
    const successCount = countProgressSteps(finalSteps);
    const lastContinuation = [...finalSteps]
      .reverse()
      .find(
        (s) =>
          s.kind === 'replan' &&
          (s.output as { reason?: unknown } | null)?.reason === 'continuation',
      );
    const priorSuccessCount = (
      lastContinuation?.output as { successCount?: unknown } | null
    )?.successCount;
    const madeProgress =
      typeof priorSuccessCount !== 'number' || successCount > priorSuccessCount;

    if (shouldContinue && madeProgress) {
      // review #2：在 todos 还完整时算好进展、塞进 continuation replan step；
      // buildInitialPlan 从这条 step 读，扛过 applyReplanningIfNeeded 清空 run.todos。
      const progress = buildProgressSummary(finalSteps, liveTodos);
      await recordStep({
        runId,
        kind: 'replan',
        output: {
          reason: 'continuation',
          progress: progress ?? null,
          reflection: reflectionReason ?? null,
          // 0002：存当前累计成功步数，下一轮续跑用它判有无进展。
          successCount,
        },
      });
      // S1：把累积式结构化 checkpoint 写进 run 列（单一真相源）。
      const checkpoint = await computeCheckpoint(
        runId,
        run,
        plan,
        finalSteps,
        liveTodos,
        successCount,
        abortController.signal,
        true, // 续跑点：允许压缩（喂下一轮 planner）
      );
      await store.updateAgentRun(runId, {
        status: 'replanning',
        contextCheckpoint: checkpoint,
      });
      return;
    }

    // S1：收尾前也写一次 checkpoint —— 否则续跑一轮后在末轮完成的 run，其最后
    // （决定性的）发现永远不会进 checkpoint。供 S2 终稿 / 后续读取拿到最新状态。
    const finalCheckpoint = await computeCheckpoint(
      runId,
      run,
      plan,
      finalSteps,
      liveTodos,
      successCount,
      abortController.signal,
      false, // 收尾点：末轮，不压缩（压缩成果无后续 planner 消费，只会徒增延迟）
    );
    await store.updateAgentRun(runId, { contextCheckpoint: finalCheckpoint });
    // 同步本地 run，让下游 softComplete→buildFinalContent→buildReplyMessages 读到最新 checkpoint。
    run.contextCheckpoint = finalCheckpoint;

    // M3-S0：整条 plan 被白名单护栏拦截、零工作的子 run 不能向父 run 报
    // 'completed'——否则父 agent 拿到「子任务成功完成」的误导信号,而实际什么都
    // 没干、越权尝试也没被向上 surface。仅当本轮确有 step 被护栏拦截、且整 run
    // 零成功步(successCount===0:既无成功 tool_call 也无 observe 缓存命中)时硬失败。
    // 有成功步则正常收尾(部分越权被挡、其余有产出的子 run 仍算完成)。
    if (subagentToolDenied && successCount === 0) {
      await softComplete(
        run,
        'failed',
        'subagent: all plan steps blocked by tool whitelist (M3-S0 guard)',
      );
      return;
    }

    // M1c：终稿在 softComplete 里走 buildFinalContent（含 LLM 终稿）；
    // 这里仍记一条 reply step，但内容直接用 fallback 概要——
    // 真正写到 placeholder 的是 buildFinalContent 的返回值。
    const replyDigest = pickFallbackFinalContent(run, plan);
    await recordStep({ runId, kind: 'reply', output: { content: replyDigest } });
    await softComplete(run, 'completed');
  } catch (e) {
    if (e instanceof AgentCancelled && e.reason === 'steer') {
      // steer 已经把 status 设为 'replanning'，worker 下次 pickup 会进 replanning 分支。
      // checkpoint 不需要这里补:steerRun + applyReplanningIfNeeded(P0-S5)已在 replan 咽喉累积。
      return;
    }
    // 收尾兜底:任何异常路径(收尾点 checkpoint 写失败/预算耗尽/取消/硬错)先 best-effort
    // 把已产出的发现补进 checkpoint,再 softComplete —— 让 buildFinalContent/后续读取
    // 拿到末轮发现而非续跑旧值。先补写再取 latest,softComplete 才读得到新 checkpoint。
    await backfillCheckpointBestEffort(runId, run);
    const latest = (await store.getAgentRun(runId)) ?? run;
    if (e instanceof AgentCancelled) {
      await recordStep({ runId, kind: 'cancel', error: e.reason });
      await softComplete(latest, 'cancelled', e.reason);
    } else if (e instanceof AgentBudgetExhausted) {
      await softComplete(latest, 'budget_exhausted', e.dimension);
    } else {
      // PlannerUnknownToolError:buildInitialPlan 已记过更详细的 system_error + notice,
      // 这里不再补记第二条(review #4:同一失败双 system_error 污染审计)。
      if (!(e instanceof PlannerUnknownToolError)) {
        await recordStep({ runId, kind: 'system_error', error: String(e) });
      }
      await softComplete(latest, 'failed', String(e).slice(0, 200));
    }
  } finally {
    stopHb();
    runControllers.delete(runId);
  }
}
