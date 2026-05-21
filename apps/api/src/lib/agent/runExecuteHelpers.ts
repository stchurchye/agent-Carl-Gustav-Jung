/**
 * runExecute.ts 的内部 helpers：把主 loop 之外的 3 段较长逻辑抽出去，
 * 让 main loop 聚焦在"plan step 顺序执行 + 工具 dispatch"。
 *
 * M1e task 1：拆出，零行为变更。
 * - resolveToolCallKey：idempotency key 拼接
 * - applyReplanningIfNeeded：进入 replanning 状态时重写 plan + reset usage.steps
 * - recordReclaimIfNeeded：M1d T5 reclaim 检测 + 写 reclaim step（M1e task 6
 *   把 step kind 从 'heartbeat' 改成 'reclaim'，语义更准；老 DB 行的 'heartbeat'
 *   仍是合法 kind，read path 兼容）
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
 *
 * M1e Task 13.3：把 `ownerId` 纳入 key 前缀，避免不同 owner 用同一 input 时
 * 共享同一 tool_call_key（之前 docExport 按 title 一字段 hash，跨 user 同名 doc
 * 会撞 key）。M1d 实际未撞是因为 unique 约束按 (run_id, tool_call_key)，但跨 run
 * 共享缓存（M2 议程）一旦上线就会出问题；提前修正保 forward-compat。
 *
 * 注：这是在 tool.computeIdempotencyKey 输出之外加 ownerId 名空间，
 * tool 实现本身仍然可以只考虑 input；不需要修改每个 tool 的签名。
 */
export function resolveToolCallKey(
  tool: ToolDef,
  planStep: PlanStep,
  run?: AgentRun,
): string | null {
  if (!tool.computeIdempotencyKey) return null;
  const key = tool.computeIdempotencyKey(planStep.input);
  if (!key) return null;
  const ownerPrefix = run ? `${run.ownerId}:` : '';
  return `${ownerPrefix}${tool.name}:${key}`;
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
  // M1e task 6：approval_deny 在 approvalMode='never' 路径会推进 plan 指针（worker 跳过该
  // step 不调 tool），所以也应该算作 advancing。否则 worker A 写完 deny 崩溃后，worker B
  // 会 spurious-emit 一条 reclaim step，看起来像 B 在重写历史。
  const dbAdvancing = allStepsForReclaim.filter(
    (s) => s.kind === 'tool_call' || s.kind === 'observe' || s.kind === 'approval_deny',
  ).length;
  if (dbAdvancing <= run.usage.steps) {
    return { run, completedCount: run.usage.steps };
  }
  // M1e task 6：kind 从 'heartbeat' 改为 'reclaim'，更准确（heartbeat = 心跳，与此场景无关）。
  await recordStep({
    runId: run.id,
    kind: 'reclaim',
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
        s.kind !== 'reclaim' &&
        s.kind !== 'approval_timeout',
    );
  return lastMeaningful?.kind === 'approval_grant';
}
