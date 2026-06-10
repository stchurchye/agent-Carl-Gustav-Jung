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
import { recordStep } from './stepRecorder.js';
import { toolRegistry, type ToolDef } from './toolRegistry.js';
import { buildCheckpoint } from './checkpoint.js';
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
 * Replanning 分支：steer / approval_deny / critique 三种触发后由 worker re-pickup 进入这里。
 *
 * 统一路径（M1c：steer/deny 已从 echo 桩升级为 LLM-driven，与 critique 同构）：
 * - steer / approval_deny: 记一条 replan{reason, directive}（steer=用户改向指令；deny=被拒工具）
 *   并把 plan 清成 null。
 * - critique（M1f polish #1）/ continuation / merge_trigger: 同样把 plan 清成 null
 *   （continuation/merge 的 replan step 已自带，本函数只清 plan 不重复 record）。
 *
 * 三者都靠 executeRun 的 `if (!run.plan)` 重跑 `buildInitialPlan` → 它从最近一条 replan step 读
 *   directive(readStashedReplanDirective) / progress(readStashedContinuationProgress) / 从 DB failed
 *   step 拼 previousFailure，一并喂 planner LLM → 拿到改向/避开被拒工具/纠正后的 plan。
 *
 *   设计说明：replan 时整个 plan 都丢掉、由 LLM 重新设计，而不是 patch 某一步。
 *   理由：steer/deny/soft-fail 通常意味着整体策略要变，LLM 更擅长"给定上下文重新设计"。
 *
 * replanning 后重置 usage.steps=0 → 让 for 循环从新 plan 第 0 步起。
 */
export async function applyReplanningIfNeeded(run: AgentRun): Promise<AgentRun> {
  if (run.status !== 'replanning') return run;

  const steps = await store.listSteps(run.id);

  // P0-S5:所有 replan 重进路径(steer/deny/critique/merge/unknown_tool)统一在清 plan 前
  // 累积机械版 checkpoint(不调 LLM,便宜)。此前只有 continuation 在 loop 尾算 ——
  // 其余 replan 读到 contextCheckpoint=null,planner 看不到早期发现 → 重复搜索。
  // 注:steer 路径 steerRun 已先清 plan/todos → remainingPlan 为空可接受(findings 是核心)。
  // fail-open:checkpoint 是增益,失败不挡 replan 主流程。
  try {
    const successCount = steps.filter(
      (s) =>
        (s.kind === 'tool_call' && (s.error == null || s.error === '')) ||
        s.kind === 'observe',
    ).length;
    const checkpoint = buildCheckpoint(run.contextCheckpoint, steps, run.todos ?? [], {
      goal: run.inputText ?? '',
      intent: run.plan?.intentSummary ?? run.contextCheckpoint?.intent ?? '',
      successCount,
      toolMap: new Map(toolRegistry.list().map((t) => [t.name, t])),
    });
    await store.updateAgentRun(run.id, { contextCheckpoint: checkpoint });
    run = { ...run, contextCheckpoint: checkpoint };
  } catch (e) {
    console.warn('[applyReplanningIfNeeded] checkpoint 累积失败(忽略,不挡 replan)', e);
  }
  const lastSteer = [...steps].reverse().find((s) => s.kind === 'steer');
  // M1c：只认「真 deny」—— approval.ts denyRun(用户拒绝 / timeout 自动 deny)带 output{reason,by}；
  // 排除 exec-time approvalMode='never' 安全拦截 skip（只带 error、无 output、run 继续不进 replanning）。
  // 否则 critique replan 时残留的 'never' 拦截会被误当用户拒绝、伪造「用户拒绝工具 X」directive。(code-review #4)
  const lastDeny = [...steps]
    .reverse()
    .find((s) => s.kind === 'approval_deny' && s.output != null);
  let next = run;

  const denyIsNewest =
    !!lastDeny && (!lastSteer || lastDeny.idx > lastSteer.idx);
  const steerIsNewest =
    !!lastSteer && (!lastDeny || lastSteer.idx > lastDeny.idx);

  // M7 P1：P1 路径刚写过一条 replan(reason='merge_trigger')，这里别重复 record，
  // 但仍要清 plan 让 executeRun 重新规划（追问已进 merged_inputs / context）。
  // 关键：只看「最后一条 step」是否就是 merge_trigger replan —— 若其后又跑了步骤
  // 再因 critique 进 replanning，最后一条不再是它，critique 的审计 replan 不被误抑制。
  const lastStep = steps[steps.length - 1];
  // M7 P1 的 merge_trigger 与 issue 0001 的 continuation 都在进入 replanning 前
  // 已经自己写过一条 replan step；这里别再补记一条「critique_or_unspecified」幻影 replan
  // （否则审计日志把续跑/合并误算成 critique replan，污染信号）。
  const lastReplanReason =
    lastStep?.kind === 'replan'
      ? (lastStep.output as { reason?: string } | null)?.reason
      : undefined;
  // issue 0005:unknown_tool replan(exec 期未知工具门)也在进入 replanning 前自己写过
  // replan step,与 merge_trigger/continuation 同列 —— 否则会被误路由进 steer/deny 分支
  // 或补一条 critique_or_unspecified 幻影 replan。
  const alreadyReplanRecorded =
    lastReplanReason === 'merge_trigger' ||
    lastReplanReason === 'continuation' ||
    lastReplanReason === 'unknown_tool';

  if (alreadyReplanRecorded) {
    // continuation(issue 0001) / merge_trigger(M7 P1)：最新一步就是它们自己写的 replan，
    // 直接清 plan 让 executeRun 走 buildInitialPlan 重生成（progress / merged_inputs 已就绪）。
    // 必须优先于 deny/steer 检测 —— 否则历史里残留的 approval_deny / steer step 会被
    // denyIsNewest/steerIsNewest 误判成"最新"，把续跑/合并错误路由到 deny 重规划或 steer no-op，
    // 丢掉 stashed progress / 重放同一 plan。(review round-3 finding)
    next = (await store.updateAgentRun(run.id, {
      plan: null,
      todos: [],
    }))!;
  } else if (steerIsNewest) {
    // M1c：steer → 清 plan，让 executeRun 走 buildInitialPlan 用 LLM 真重规划。
    // 改向指令的**权威源是持久字段 run.steerDirective**(steerRun 写入,跨后续 continuation replan
    // 不丢；buildInitialPlan 据此注入 planner)。这条 replan step **仅作审计**(记触发改向的指令 + reason)，
    // buildInitialPlan 对 steer 不读 stash directive。替代旧 M1b echo 桩 generatePlanForSteer。
    // 不记 prevPlanVersion —— steerRun 已先清 plan，此处 run.plan 恒 null（记了也只是 null，误导审计）。
    const directive =
      (lastSteer!.input as { instruction?: string } | null)?.instruction ?? '';
    await recordStep({
      runId: run.id,
      kind: 'replan',
      output: { reason: 'steer', directive },
    });
    next = (await store.updateAgentRun(run.id, {
      plan: null,
      todos: [],
    }))!;
  } else if (denyIsNewest) {
    // M1c：deny → append 被拒工具到持久 run.deniedTools(去重) + 清 plan，让 buildInitialPlan 每次
    // 重规划都注入「不要调用 X」（持久,跨后续 continuation replan 不丢；权威源是该列，非 stash）。
    // replan step 的 directive 仅作审计。替代旧 M1b echo 桩 generatePlanForApprovalDeny。
    const deniedTool = lastDeny!.toolName ?? 'unknown';
    const directive = `用户拒绝了工具 \`${deniedTool}\`。请改用其他工具或方式达成原任务目标，不要再调用该工具。`;
    const deniedTools = Array.from(new Set([...(run.deniedTools ?? []), deniedTool]));
    await recordStep({
      runId: run.id,
      kind: 'replan',
      output: { reason: 'approval_deny', directive, deniedTool },
    });
    next = (await store.updateAgentRun(run.id, {
      plan: null,
      todos: [],
      deniedTools,
    }))!;
  } else {
    // critique 触发（或其他非 steer / 非 deny 的 replan 源）→ 清 plan，
    // 让 executeRun 走 buildInitialPlan 重生成；previousFailure 由
    // buildPreviousFailureSummary 从 DB 取最近 failed step 拼出。
    await recordStep({
      runId: run.id,
      kind: 'replan',
      output: {
        reason: 'critique_or_unspecified',
        clearedPlan: true,
        prevPlanVersion: run.plan?.version ?? null,
      },
    });
    next = (await store.updateAgentRun(run.id, {
      plan: null,
      todos: [],
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
  // M3-S0：subagent_tool_denied(白名单护栏跳过该 step)同样推进 plan 指针,一并计入。
  const dbAdvancing = allStepsForReclaim.filter(
    (s) =>
      s.kind === 'tool_call' ||
      s.kind === 'observe' ||
      s.kind === 'approval_deny' ||
      s.kind === 'subagent_tool_denied',
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
