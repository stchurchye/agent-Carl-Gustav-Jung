import * as store from './store.js';
import { generatePlanForSteer } from './planner.js';
import { recordStep } from './stepRecorder.js';
import { runControllers } from './runtimeRegistry.js';

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
 * 1) 校验 run 非终态，且 plan 已存在
 * 2) 生成新 plan（version+1）写入
 * 3) status → 'replanning'，lastHeartbeatAt=null 让 worker 优先 pickup
 * 4) 写一条 steer step，记 byUserId + instruction + newPlanVersion
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

  const newPlan = generatePlanForSteer(
    run.plan,
    input.instruction,
    run.usage.steps,
  );
  await store.updateAgentRun(input.runId, {
    plan: newPlan,
    todos: newPlan.todos,
    status: 'replanning',
    lastHeartbeatAt: null,
  });
  await recordStep({
    runId: input.runId,
    kind: 'steer',
    byUserId: input.byUserId,
    input: { instruction: input.instruction, newPlanVersion: newPlan.version },
  });

  const controller = runControllers.get(input.runId);
  if (controller && !controller.signal.aborted) {
    controller.abort();
  }
  return { accepted: true };
}
