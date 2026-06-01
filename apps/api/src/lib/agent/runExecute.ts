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
import {
  AgentBudgetExhausted,
  AgentCancelled,
  type TodoItem,
} from './types.js';
import { runCritique, isToolFailure } from './critique.js';
import { agentHookBus } from './hooks.js';
import { recordStep, incrementUsage, startHeartbeat } from './stepRecorder.js';
import { toolRegistry } from './toolRegistry.js';
import { checkBudget } from './budget.js';
import { runControllers } from './runtimeRegistry.js';
import { TOOL_TIMEOUT_MS, HIGH_COST_TOOL_TIMEOUT_MS, withTimeout } from './runtimeShared.js';
import { softComplete } from './runLifecycle.js';
import { buildInitialPlan } from './runPlanGlue.js';
import { pickFallbackFinalContent } from './runReply.js';
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

    for (let i = completedCount; i < plan.steps.length; i++) {
      // === M7 P1：检查未消化追问 → 触发 replan，让 worker re-pickup 走 applyReplanningIfNeeded ===
      // 仅 SELECT 2 列，<1ms（R12）。inputText 永不改写（ADR-M7-13），追问只进 merged_inputs。
      const mergedCounts = await store.getMergedInputCounts(runId);
      if (mergedCounts && mergedCounts.total > mergedCounts.consumed) {
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
      const tool = toolRegistry.require(planStep.toolName);

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
            awaitingApprovalUntil: new Date(Date.now() + 60_000),
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

      const newTodos: TodoItem[] = (run.todos.length > 0
        ? run.todos
        : plan.todos
      ).map((t) =>
        t.id === planStep.todoId ? { ...t, status: 'completed' as const } : t,
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
        // M4 Task 5：写 24h timeout 戳。worker tick 的
        // autoExpireAwaitingUserInput 会自动 cancel('user_timeout')。
        await store.updateAgentRun(runId, {
          status: 'awaiting_user_input',
          pendingUserPrompt: typeof question === 'string' ? question : '',
          pendingUserStepIdx: i,
          pendingUserInputExpiresAt: new Date(Date.now() + 24 * 3600 * 1000),
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
        });
        await recordStep({ runId, kind: 'critique', output: c });
        if (c.shouldReplan) {
          await store.updateAgentRun(runId, { status: 'replanning' });
          return;
        }
      }
    }

    // M1c：终稿在 softComplete 里走 buildFinalContent（含 LLM 终稿）；
    // 这里仍记一条 reply step，但内容直接用 fallback 概要——
    // 真正写到 placeholder 的是 buildFinalContent 的返回值。
    const replyDigest = pickFallbackFinalContent(run, plan);
    await recordStep({ runId, kind: 'reply', output: { content: replyDigest } });
    await softComplete(run, 'completed');
  } catch (e) {
    const latest = (await store.getAgentRun(runId)) ?? run;
    if (e instanceof AgentCancelled && e.reason === 'steer') {
      // steer 已经把 status 设为 'replanning'，worker 下次 pickup 会进 replanning 分支。
      return;
    }
    if (e instanceof AgentCancelled) {
      await recordStep({ runId, kind: 'cancel', error: e.reason });
      await softComplete(latest, 'cancelled', e.reason);
    } else if (e instanceof AgentBudgetExhausted) {
      await softComplete(latest, 'budget_exhausted', e.dimension);
    } else {
      await recordStep({ runId, kind: 'system_error', error: String(e) });
      await softComplete(latest, 'failed', String(e).slice(0, 200));
    }
  } finally {
    stopHb();
    runControllers.delete(runId);
  }
}
