/**
 * M3-S1：派生子 agent 的共享逻辑（从 deep_research 抽出，供 deep_research + spawn_subagent 共用）。
 *
 * 流程：建子 run(parentRunId + role + budget) → 继承父加密 key → 接父 abort → dispatchChildRun
 * (独立 child executor pool) → 轮询子 run 终态 → 聚合 reply 报告 + citations。
 *
 * 子 run 的可用工具由 run.role 决定(planner 裁剪 + runExecute exec 守卫,见 subagentTools.ts)。
 * 递归(deep_research/spawn_subagent)、暂停(ask_user)不在任何角色子集 → 子 agent 无法再派子 agent。
 */
import { TERMINAL_RUN_STATUSES, type AgentRole, type AgentRun } from './types.js';
import * as store from './store.js';
import { createAgentRun, cancelRun } from './runLifecycle.js';
import { dispatchChildRun } from './childExecutor.js';

export type SubagentCitation = { kind: string; id: string; label?: string };

export type RunChildSubagentResult = {
  ok: boolean;
  report: string;
  citations: SubagentCitation[];
  stepsUsed: number;
  childRunId: string;
  error?: string;
};

const POLL_INTERVAL_MS = 500;
const MAX_WAIT_MS = 5 * 60_000;

function fail(error: string, childRunId = '', stepsUsed = 0): RunChildSubagentResult {
  return { ok: false, report: '', citations: [], stepsUsed, childRunId, error };
}

/**
 * 派一个子 agent 跑 `task`，等其终态，聚合报告。防递归三道防线:工具 handler 检查 +
 * 角色白名单不含 spawn 类 + **本函数入口的深度守卫**(P0-S8,兜上游漂移)。
 * AbortError 透传给 caller(让 runtime 看到 cancel)。其余失败返回 {ok:false,error}。
 */
export async function runChildSubagent(params: {
  parentRun: AgentRun;
  task: string;
  role: AgentRole;
  maxSteps: number;
  signal: AbortSignal;
}): Promise<RunChildSubagentResult> {
  const { parentRun, task, role, maxSteps, signal } = params;

  // P0-S8 递归深度守卫(纵深):工具 handler 的 parentRunId 检查 + 角色白名单不含 spawn 类
  // 是前两道防线;这里是 spawn 唯一咽喉的最后一道 —— 即便上游漂移(白名单误加/新调用方
  // 忘检查),也不会建出孙 run。当前语义 = 最大深度 1 层(父→子);要放开多层时改为沿
  // parentRunId 链数深度并设上限,而不是删掉本守卫。
  if (parentRun.parentRunId) {
    return fail(
      `subagent depth cap: run ${parentRun.id} is already a sub-agent (nested spawn refused)`,
    );
  }

  // 群聊父 → 子也落同 group/topic，走无 invoker 的子卡片占位。
  const isParentGroup =
    parentRun.channel === 'group' && !!parentRun.groupId && !!parentRun.topicId;
  const childResult = await createAgentRun({
    ownerId: parentRun.ownerId,
    channel: isParentGroup ? 'group' : 'private',
    groupId: isParentGroup ? parentRun.groupId! : undefined,
    topicId: isParentGroup ? parentRun.topicId! : undefined,
    inputText: task,
    apiKey: '',
    apiKeySource: parentRun.apiKeySource,
    providerId: parentRun.providerId,
    modelId: parentRun.modelId,
    parentRunId: parentRun.id,
    role, // M3-S1：子 run 角色决定工具子集
    budget: { maxSteps, maxSeconds: 120, maxTokens: 50_000 },
    surfaceMode: isParentGroup ? 'child_card' : 'default',
  });
  const childRunId = childResult.run.id;

  // 子 run 继承父 run 的加密 LLM 密钥（user-key 场景；密文 DB-level COPY，不过 Node）。
  await store.copyLlmKeysFromParent(childRunId, parentRun.id);

  // 父取消 → 子取消（cancelRun 同时 abort 子 run 活跃 controller）。
  const onAbort = () => {
    void cancelRun(childRunId, parentRun.ownerId);
  };
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    await dispatchChildRun(childRunId);

    const startedAt = Date.now();
    let childRun = childResult.run;
    while (Date.now() - startedAt < MAX_WAIT_MS) {
      await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
      if (signal.aborted) {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }
      const reloaded = await store.getAgentRun(childRunId);
      if (!reloaded) break;
      childRun = reloaded;
      if (TERMINAL_RUN_STATUSES.has(reloaded.status)) break;
    }

    if (childRun.status !== 'completed') {
      return fail(`child run ended with status: ${childRun.status}`, childRunId, childRun.usage.steps);
    }

    // 聚合：softComplete 对子 run(无 resultMessageId)追加 synthesized=true reply step。
    const steps = await store.listSteps(childRunId);
    const synthesizedReply = [...steps]
      .reverse()
      .find(
        (s) =>
          s.kind === 'reply' &&
          (s.output as { synthesized?: boolean } | undefined)?.synthesized,
      );
    const replyStep =
      synthesizedReply ??
      ([...steps].reverse().find((s) => s.kind === 'reply') ?? steps[steps.length - 1]);
    const report: string =
      (replyStep?.output as { content?: string; text?: string } | undefined)?.content ??
      (replyStep?.output as { content?: string; text?: string } | undefined)?.text ??
      '(子 agent 未生成文字报告)';

    const citations: SubagentCitation[] = [];
    for (const s of steps) {
      const ref = (s.output as { ref?: unknown } | undefined)?.ref;
      if (ref && typeof ref === 'object' && (ref as Record<string, unknown>).kind) {
        citations.push(ref as SubagentCitation);
      }
    }

    return { ok: true, report, citations, stepsUsed: childRun.usage.steps, childRunId };
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}
