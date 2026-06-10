import * as store from './store.js';
import { recordStep } from './stepRecorder.js';
import { runControllers } from './runtimeRegistry.js';
import { buildCheckpoint, countProgressSteps } from './checkpoint.js';
import { toolRegistry } from './toolRegistry.js';

export type SteerInput = {
  runId: string;
  byUserId: string;
  instruction: string;
};

export type SteerResult = {
  accepted: boolean;
  reason?: string;
};

/**
 * 用户中途 steer（spec §15.2）。
 *
 * 1) 校验 run 非终态，且 plan 已存在（确保有进行中的任务可改向）
 * 2) M1c：清 plan + status → 'replanning'（不再同步生成 echo plan）。worker re-pickup 时
 *    applyReplanningIfNeeded 把本 step 的 instruction 记成 directive，buildInitialPlan 用 LLM
 *    据此真重规划（替代旧 M1b echo 桩 generatePlanForSteer —— 它 accepted 却不改向）。
 * 3) lastHeartbeatAt=null 让 worker 优先 pickup
 * 4) 写一条 steer step，记 byUserId + instruction
 * 5) 如果本进程当前在跑（runControllers 命中），abort 当前 AbortController
 *    → executeRun 在 abort 检查处会读 db status='replanning' 抛 AgentCancelled('steer')
 *    → runtime catch 'steer' 不 softFail，直接 return；worker 下次 pickup 进 replanning 分支
 */
export async function steerRun(input: SteerInput): Promise<SteerResult> {
  const run = await store.getAgentRun(input.runId);
  if (!run) return { accepted: false, reason: 'run_missing' };
  if (
    run.status === 'completed' ||
    run.status === 'failed' ||
    run.status === 'cancelled' ||
    run.status === 'budget_exhausted'
  ) {
    return { accepted: false, reason: 'terminal' };
  }
  if (!run.plan) return { accepted: false, reason: 'no_plan' };

  // P0-S5 review #5:清 todos 前先把当前轮进展(含已完成 todo)累积进 checkpoint ——
  // 否则首个 checkpoint(prior=null)在 applyReplanningIfNeeded 时只能读到已清空的 todos,
  // round1 完成项的 completedTodos 永久丢失。fail-open:失败不挡 steer。
  try {
    const steps = await store.listSteps(input.runId);
    const checkpoint = buildCheckpoint(run.contextCheckpoint, steps, run.todos ?? [], {
      goal: run.inputText ?? '',
      intent: run.plan?.intentSummary ?? run.contextCheckpoint?.intent ?? '',
      successCount: countProgressSteps(steps),
      toolMap: new Map(toolRegistry.list().map((t) => [t.name, t])),
    });
    await store.updateAgentRun(input.runId, { contextCheckpoint: checkpoint });
  } catch (e) {
    console.warn(`[steerRun] checkpoint 累积失败(忽略,不挡 steer) run=${input.runId}`, e);
  }

  // M1c：清 plan + 置 replanning（不再在此同步生成 echo plan）。worker re-pickup 时
  // applyReplanningIfNeeded 据本 steer step 的 instruction 记 directive，buildInitialPlan 走 LLM 重规划。
  await store.updateAgentRun(input.runId, {
    plan: null,
    todos: [],
    status: 'replanning',
    lastHeartbeatAt: null,
    // M1c：持久改向 —— 写 run 级字段，buildInitialPlan 每次重规划都注入，跨后续 continuation
    // replan 不丢（下次 steer 覆盖）。否则 directive 只在紧接的那条 replan 生效、之后漂回原主题。
    steerDirective: input.instruction,
  });
  await recordStep({
    runId: input.runId,
    kind: 'steer',
    byUserId: input.byUserId,
    input: { instruction: input.instruction },
  });

  const controller = runControllers.get(input.runId);
  if (controller && !controller.signal.aborted) {
    controller.abort();
  }
  return { accepted: true };
}
