/**
 * runExecute.ts 的内部 helpers：把主 loop 之外的 3 段较长逻辑抽出去，
 * 让 main loop 聚焦在"plan step 顺序执行 + 工具 dispatch"。
 *
 * M1e task 1：拆出，零行为变更。
 * - resolveToolCallKey：idempotency key 拼接
 * - applyReplanningIfNeeded：进入 replanning 状态时重写 plan + reset usage.steps
 * - recordReclaimIfNeeded：M1d T5 reclaim 检测 + 写 heartbeat step
 * - detectPendingGrantBypass：approve 后 re-pickup 跳过 approval gate 一次
 */
import * as store from './store.js';
import { generatePlanForApprovalDeny } from './planner.js';
import { recordStep } from './stepRecorder.js';
import type { ToolDef } from './toolRegistry.js';
import type { AgentRun, PlanStep } from './types.js';

/**
 * M1c：拼出 `tool_call_key`，用于 runtime idempotency 缓存。
 * 命中规则与 store 表 `agent_steps_tool_call_key_unique (run_id, tool_call_key)` 对齐。
 * 跨 run 共享 / 全局缓存 defer 到 M1d（实际仍未做，M2 议程）。
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

/**
 * Replanning 分支：steer 或 approval_deny 后由 worker re-pickup 进入这里。
 * 注：steerRun 已经把新 plan 写入 db，所以 steer 路径不重新生成 plan；
 * approval_deny 路径需要这里调 planner 选替代方案。
 *
 * M1b 简化：replanning 后重置 usage.steps=0 → 让 for 循环从新 plan 第 0 步起。
 * 防止无限 replan 由 plan.version 自带（同 instruction 多次 steer 不会变化 → 测试不会撞死循环）。
 */
export async function applyReplanningIfNeeded(run: AgentRun): Promise<AgentRun> {
  if (run.status !== 'replanning') return run;

  const steps = await store.listSteps(run.id);
  const lastSteer = [...steps].reverse().find((s) => s.kind === 'steer');
  const lastDeny = [...steps].reverse().find((s) => s.kind === 'approval_deny');
  let next = run;
  if (lastDeny && (!lastSteer || lastDeny.idx > lastSteer.idx)) {
    const newPlan = generatePlanForApprovalDeny(
      run.plan!,
      lastDeny.toolName ?? 'unknown',
      run.inputText,
    );
    await recordStep({ runId: run.id, kind: 'replan', output: newPlan });
    next = (await store.updateAgentRun(run.id, {
      plan: newPlan,
      todos: newPlan.todos,
    }))!;
  }
  const resetUsage = { ...next.usage, steps: 0 };
  return (await store.updateAgentRun(run.id, {
    status: 'running',
    usage: resetUsage,
  }))!;
}

/**
 * M1d T5：reclaim 检测。Worker A 写了 tool_call 后崩溃、usage 没追上时，
 * DB 实际 step 数比 usage.steps 大；用 DB 数推断 completedCount，避免 worker B
 * 重复执行非幂等工具。
 *
 * 不适用场景：
 *   - 来自 replanning 的 re-pickup：usage 被显式 reset 到 0，DB 历史 step 属于旧 plan，
 *     不能算作"新 plan 已完成"。
 *   - 同 run 内多次 executeRun (approve 后续跑)：plan 不变，usage 也单调递增，逻辑成立。
 */
export async function recordReclaimIfNeeded(
  run: AgentRun,
  enteredViaReplanning: boolean,
): Promise<{ run: AgentRun; completedCount: number }> {
  if (enteredViaReplanning) {
    return { run, completedCount: run.usage.steps };
  }
  const allStepsForReclaim = await store.listSteps(run.id);
  const dbAdvancing = allStepsForReclaim.filter(
    (s) => s.kind === 'tool_call' || s.kind === 'observe',
  ).length;
  if (dbAdvancing <= run.usage.steps) {
    return { run, completedCount: run.usage.steps };
  }
  await recordStep({
    runId: run.id,
    kind: 'heartbeat',
    output: {
      reclaim: true,
      prevUsageSteps: run.usage.steps,
      dbAdvancing,
      lastHeartbeatAt: run.lastHeartbeatAt?.toISOString() ?? null,
    },
  });
  const usage = { ...run.usage, steps: dbAdvancing };
  const updated = (await store.updateAgentRun(run.id, { usage }))!;
  return { run: updated, completedCount: dbAdvancing };
}

/**
 * 让 approve 后 re-pickup 时跳过 approval gate 一次：
 * 如果上次让出后最新写入的是 approval_grant（手动 approve 或 timeout 自动 grant），
 * 下一个工具调用应直接进 handler 而非再次触发 gate。autoResolveExpiredApprovals
 * 在 approve 后又写了一条 approval_timeout，所以这里要忽略它。
 */
export async function detectPendingGrantBypass(runId: string): Promise<boolean> {
  const stepsForBypass = await store.listSteps(runId);
  const lastMeaningful = [...stepsForBypass]
    .reverse()
    .find(
      (s) =>
        s.kind !== 'heartbeat' &&
        s.kind !== 'approval_timeout',
    );
  return lastMeaningful?.kind === 'approval_grant';
}
