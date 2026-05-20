import { randomUUID } from 'crypto';
import { getPool } from '../../db/client.js';
import * as store from './store.js';
import {
  AgentBudgetExhausted,
  AgentCancelled,
  DEFAULT_BUDGET,
  type AgentBudget,
  type AgentChannel,
  type AgentRun,
  type Plan,
  type TodoItem,
} from './types.js';
import {
  generatePlanForEcho,
  generatePlanForApprovalDeny,
  generatePlanWithLlm,
} from './planner.js';
import { snapshotForAgent } from './contextAdapter.js';
import { runCritique } from './critique.js';
import { agentHookBus } from './hooks.js';
import { recordStep, incrementUsage, startHeartbeat } from './stepRecorder.js';
import { toolRegistry, type ToolDef } from './toolRegistry.js';
import type { PlanStep } from './types.js';
import { checkBudget } from './budget.js';
import {
  writePrivatePlaceholder,
  finalizePrivatePlaceholder,
  writeGroupPlaceholder,
  finalizeGroupPlaceholder,
} from './messageBridge.js';

const TOOL_TIMEOUT_MS = 60_000;

// 共享 AbortController Map，与 steer.ts / cancelRun 同源（避免模块级私有 Map）。
import { runControllers } from './runtimeRegistry.js';

/**
 * M1c：拼出 `tool_call_key`，用于 runtime idempotency 缓存。
 * 命中规则与 store 表 `agent_steps_tool_call_key_unique (run_id, tool_call_key)` 对齐。
 * 跨 run 共享 / 全局缓存 defer 到 M1d。
 */
export function resolveToolCallKey(
  tool: ToolDef,
  planStep: PlanStep,
): string | null {
  if (!tool.computeIdempotencyKey) return null;
  const key = tool.computeIdempotencyKey(planStep.input);
  if (!key) return null;
  return `${tool.name}:${key}`;
}

export type CreateAgentRunInput = {
  ownerId: string;
  channel: AgentChannel;
  sessionId?: string;
  groupId?: string;
  topicId?: string;
  intentTurnId?: string;
  inputText: string;
  apiKey: string;
  apiKeySource: 'user' | 'server';
  budget?: AgentBudget;
};

export type CreateAgentRunResult = {
  run: AgentRun;
  userMessageId: string | null;
  placeholderMessageId: string | null;
  llmJobId: string | null;
};

export async function createAgentRun(
  input: CreateAgentRunInput,
): Promise<CreateAgentRunResult> {
  const run = await store.insertAgentRun({
    ownerId: input.ownerId,
    channel: input.channel,
    sessionId: input.sessionId ?? null,
    groupId: input.groupId ?? null,
    topicId: input.topicId ?? null,
    intentTurnId: input.intentTurnId ?? null,
    role: 'generalist',
    status: 'draft',
    inputText: input.inputText,
    budget: input.budget ?? DEFAULT_BUDGET,
    apiKeyOwnerId: input.apiKeySource === 'user' ? input.ownerId : null,
    apiKeySource: input.apiKeySource,
  });

  let userMessageId: string | null = null;
  let placeholderMessageId: string | null = null;
  let llmJobId: string | null = null;

  if (input.channel === 'private' && input.sessionId) {
    const bridge = await writePrivatePlaceholder({
      userId: input.ownerId,
      sessionId: input.sessionId,
      inputText: input.inputText,
      agentRunId: run.id,
    });
    userMessageId = bridge.userMessageId;
    placeholderMessageId = bridge.placeholderMessageId;
    const updated = await store.updateAgentRun(run.id, {
      resultMessageId: placeholderMessageId,
    });
    return {
      run: updated ?? run,
      userMessageId,
      placeholderMessageId,
      llmJobId,
    };
  }

  if (input.channel === 'group' && input.groupId && input.topicId) {
    const bridge = await writeGroupPlaceholder({
      userId: input.ownerId,
      groupId: input.groupId,
      topicId: input.topicId,
      inputText: input.inputText,
      agentRunId: run.id,
    });
    userMessageId = bridge.invokeMessageId;
    placeholderMessageId = bridge.placeholderAiMessageId;
    llmJobId = bridge.llmJobId;
    const updated = await store.updateAgentRun(run.id, {
      invokeMessageId: bridge.invokeMessageId,
      resultMessageId: placeholderMessageId,
    });
    return {
      run: updated ?? run,
      userMessageId,
      placeholderMessageId,
      llmJobId,
    };
  }

  return { run, userMessageId, placeholderMessageId, llmJobId };
}

/**
 * 群聊 finalize 需要 llmJobId。M1b-1 简化做法：从 group_messages.payload 反查
 * （writeGroupPlaceholder 把它写在 payload.agentRun.llmJobId）。
 */
async function lookupGroupLlmJobId(messageId: string): Promise<string | null> {
  const { rows } = await getPool().query(
    `SELECT payload->'agentRun'->>'llmJobId' AS job_id
     FROM group_messages WHERE id = $1`,
    [messageId],
  );
  return (rows[0]?.job_id as string | null) ?? null;
}

function pickFallbackFinalContent(run: AgentRun, plan: Plan | null): string {
  if (!plan) return '[任务未完成]';
  const todos = run.todos.length > 0 ? run.todos : plan.todos;
  const completed = todos.filter((t) => t.status === 'completed').length;
  return `已完成 ${completed} 步：${plan.intentSummary}\n${plan.finalReplyHint}`;
}

/**
 * M1d T14：budget_exhausted 软着陆。前端会单独把这段拆开渲染（usage 行），
 * 这里 backend 保留可读的纯文本 fallback：
 * - 第一行：已完成事项 + 用户的原始 intent（沿用 fallback final content）
 * - 二行起：明确说"预算到了"+ 已花费 vs 上限
 */
function formatBudgetExhaustedReply(run: AgentRun, detail: string | undefined): string {
  const base = pickFallbackFinalContent(run, run.plan);
  const u = run.usage;
  const b = run.budget;
  const dim = detail ?? 'unknown';
  const lines = [
    base,
    '',
    `[预算已用尽：${dim}]`,
    `已花费：步骤 ${u.steps}/${b.maxSteps}、tokens ${u.tokens}/${b.maxTokens}、用时 ${u.elapsedSeconds}s/${b.maxSeconds}s`,
    `如需继续，可在聊天里发"再试一次"或在任务面板点重试。`,
  ];
  return lines.join('\n');
}

/**
 * M1c：completed 状态下用 LLM 生成终稿；非 completed 走原占位文本。
 * 测试环境 / 缺 API key 时直接 fallback。
 */
async function buildFinalContent(
  run: AgentRun,
  status: 'completed' | 'budget_exhausted' | 'failed' | 'cancelled',
  detail: string | undefined,
): Promise<string> {
  if (status === 'budget_exhausted') {
    return formatBudgetExhaustedReply(run, detail);
  }
  if (status === 'cancelled') return `[任务已取消${detail ? '：' + detail : ''}]`;
  if (status === 'failed') return `[任务失败${detail ? '：' + detail : ''}]`;

  // completed: 尝试 LLM 终稿
  const text = run.inputText ?? '';
  const isTestEnv =
    process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
  const looksLikeEcho = /echo/i.test(text);
  const serverKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (isTestEnv || looksLikeEcho || !serverKey || !run.plan) {
    return pickFallbackFinalContent(run, run.plan);
  }
  const steps = await store.listSteps(run.id);
  const { generateFinalReply } = await import('./replyGen.js');
  return generateFinalReply({
    run,
    plan: run.plan,
    steps,
    apiKey: serverKey,
  });
}

async function softComplete(
  run: AgentRun,
  status: 'completed' | 'budget_exhausted' | 'failed' | 'cancelled',
  detail?: string,
) {
  const finalContent = await buildFinalContent(run, status, detail);

  if (run.resultMessageId) {
    if (run.channel === 'private') {
      await finalizePrivatePlaceholder({
        messageId: run.resultMessageId,
        finalContent,
        status,
      });
    } else if (run.channel === 'group') {
      const llmJobId = await lookupGroupLlmJobId(run.resultMessageId);
      if (llmJobId) {
        await finalizeGroupPlaceholder({
          ownerId: run.ownerId,
          llmJobId,
          placeholderAiMessageId: run.resultMessageId,
          finalContent,
          status,
        });
      }
    }
  }

  await store.updateAgentRun(run.id, {
    status,
    endedAt: new Date(),
  });

  // Emit terminal hook event with the latest run snapshot (including endedAt).
  const latest = (await store.getAgentRun(run.id)) ?? run;
  if (status === 'completed') {
    agentHookBus.emitEvent({ type: 'run.completed', run: latest });
  } else if (status === 'failed') {
    agentHookBus.emitEvent({
      type: 'run.failed',
      run: latest,
      error: detail ?? finalContent,
    });
  } else if (status === 'cancelled') {
    agentHookBus.emitEvent({
      type: 'run.cancelled',
      run: latest,
      byUserId: latest.cancelledByUserId,
    });
  } else if (status === 'budget_exhausted') {
    agentHookBus.emitEvent({
      type: 'run.budget_exhausted',
      run: latest,
      resource: detail ?? 'unknown',
    });
  }
}

/**
 * M1c：选择初始 plan 来源。
 * - 测试 / `echo` 关键词 / 缺少 LLM key 时走老的 `generatePlanForEcho`，保证 CI 不依赖外部 LLM。
 * - 其余调 `generatePlanWithLlm`（内部失败会再 fallback echo）。
 */
async function buildInitialPlan(run: AgentRun): Promise<Plan> {
  const text = run.inputText ?? '';
  const isTestEnv =
    process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
  const looksLikeEcho = /echo/i.test(text);
  const serverKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (isTestEnv || looksLikeEcho || !serverKey) {
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
      apiKey: serverKey,
    });
    return await generatePlanWithLlm({
      inputText: text,
      snapshot,
      apiKey: serverKey,
    });
  } catch {
    return generatePlanForEcho(text);
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

  // 标记本次 executeRun 是否来自 replanning：replanning 会主动 reset usage.steps=0，
  // 这种"假性的 usage 落后于 DB"不应触发 T5 reclaim 逻辑。
  const enteredViaReplanning = run.status === 'replanning';

  // Replanning 分支：steer 或 approval_deny 后由 worker re-pickup 进入这里。
  // 注：steerRun 已经把新 plan 写入 db，所以 steer 路径不重新生成 plan；
  // approval_deny 路径需要这里调 planner 选替代方案。
  if (run.status === 'replanning') {
    const steps = await store.listSteps(runId);
    const lastSteer = [...steps].reverse().find((s) => s.kind === 'steer');
    const lastDeny = [...steps].reverse().find((s) => s.kind === 'approval_deny');
    if (lastDeny && (!lastSteer || lastDeny.idx > lastSteer.idx)) {
      const newPlan = generatePlanForApprovalDeny(
        run.plan!,
        lastDeny.toolName ?? 'unknown',
        run.inputText,
      );
      await recordStep({ runId, kind: 'replan', output: newPlan });
      run = (await store.updateAgentRun(runId, {
        plan: newPlan,
        todos: newPlan.todos,
      }))!;
    }
    // M1b 简化：replanning 后重置 usage.steps=0 → 让 for 循环从新 plan 第 0 步起。
    // 防止无限 replan 由 plan.version 自带（同 instruction 多次 steer 不会变化 → 测试不会撞死循环）。
    const resetUsage = { ...run.usage, steps: 0 };
    run = (await store.updateAgentRun(runId, {
      status: 'running',
      usage: resetUsage,
    }))!;
  }

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

    // M1d T5：reclaim 检测。Worker A 写了 tool_call 后崩溃、usage 没追上时，
    // DB 实际 step 数比 usage.steps 大；用 DB 数推断 completedCount，避免 worker B
    // 重复执行非幂等工具。
    //
    // 不适用场景：
    //   - 来自 replanning 的 re-pickup：usage 被显式 reset 到 0，DB 历史 step 属于旧 plan，
    //     不能算作"新 plan 已完成"。
    //   - 同 run 内多次 executeRun (approve 后续跑)：plan 不变，usage 也单调递增，逻辑成立。
    let completedCount = run.usage.steps;
    if (!enteredViaReplanning) {
      const allStepsForReclaim = await store.listSteps(runId);
      const dbAdvancing = allStepsForReclaim.filter(
        (s) => s.kind === 'tool_call' || s.kind === 'observe',
      ).length;
      if (dbAdvancing > run.usage.steps) {
        await recordStep({
          runId,
          kind: 'heartbeat',
          output: {
            reclaim: true,
            prevUsageSteps: run.usage.steps,
            dbAdvancing,
            lastHeartbeatAt: run.lastHeartbeatAt?.toISOString() ?? null,
          },
        });
        const usage = { ...run.usage, steps: dbAdvancing };
        run = (await store.updateAgentRun(runId, { usage }))!;
        completedCount = dbAdvancing;
      }
    }

    // 让 approve 后 re-pickup 时跳过 approval gate 一次：
    // 如果上次让出后最新写入的是 approval_grant（手动 approve 或 timeout 自动 grant），
    // 下一个工具调用应直接进 handler 而非再次触发 gate。autoResolveExpiredApprovals
    // 在 approve 后又写了一条 approval_timeout，所以这里要忽略它。
    let pendingGrantBypass = false;
    {
      const stepsForBypass = await store.listSteps(runId);
      const lastMeaningful = [...stepsForBypass]
        .reverse()
        .find(
          (s) =>
            s.kind !== 'heartbeat' &&
            s.kind !== 'approval_timeout',
        );
      if (lastMeaningful?.kind === 'approval_grant') {
        pendingGrantBypass = true;
      }
    }

    for (let i = completedCount; i < plan.steps.length; i++) {
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

      // === Idempotency gate (M1c, T10) ===
      const toolCallKey = resolveToolCallKey(tool, planStep);
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
          const usageC = incrementUsage(run, {
            steps: 1,
            tokens: 0,
            elapsedSeconds: elapsedC - run.usage.elapsedSeconds,
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
        groupId: run.groupId ?? undefined,
        topicId: run.topicId ?? undefined,
        signal: abortController.signal,
      };

      const t0 = Date.now();
      let output: unknown;
      let retried = false;
      try {
        output = await withTimeout(
          tool.handler(planStep.input as never, ctx),
          TOOL_TIMEOUT_MS,
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
            TOOL_TIMEOUT_MS,
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

      await recordStep({
        runId,
        kind: 'tool_call',
        toolName: tool.name,
        toolCallKey,
        input: planStep.input,
        output: { result: output, retried },
        durationMs,
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
      const usage = incrementUsage(run, {
        steps: 1,
        tokens: 0,
        elapsedSeconds: elapsedFinal - run.usage.elapsedSeconds,
      });
      run = (await store.updateAgentRun(runId, {
        todos: newTodos,
        usage,
      }))!;

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
      const recentFailures = allSteps
        .slice(-4)
        .filter((s) => s.kind === 'tool_error').length;
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

export async function cancelRun(
  runId: string,
  byUserId: string,
): Promise<void> {
  const controller = runControllers.get(runId);
  if (controller) controller.abort('user_cancel');
  const run = await store.getAgentRun(runId);
  if (!run) return;
  if (
    run.status === 'completed' ||
    run.status === 'failed' ||
    run.status === 'cancelled' ||
    run.status === 'budget_exhausted'
  ) {
    return;
  }
  await store.updateAgentRun(runId, {
    status: 'cancelled',
    cancelledByUserId: byUserId,
    cancelReason: 'user',
    endedAt: new Date(),
  });
  const latest = (await store.getAgentRun(runId)) ?? run;
  agentHookBus.emitEvent({
    type: 'run.cancelled',
    run: latest,
    byUserId,
  });
  if (run.resultMessageId) {
    if (run.channel === 'private') {
      await finalizePrivatePlaceholder({
        messageId: run.resultMessageId,
        finalContent: '[任务已取消]',
        status: 'cancelled',
      });
    } else if (run.channel === 'group') {
      const llmJobId = await lookupGroupLlmJobId(run.resultMessageId);
      if (llmJobId) {
        await finalizeGroupPlaceholder({
          ownerId: run.ownerId,
          llmJobId,
          placeholderAiMessageId: run.resultMessageId,
          finalContent: '[任务已取消]',
          status: 'cancelled',
        });
      }
    }
  }
}

export async function confirmRun(runId: string): Promise<void> {
  const run = await store.getAgentRun(runId);
  if (!run || run.status !== 'awaiting_confirm') return;
  await store.updateAgentRun(runId, { status: 'running' });
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('tool timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
