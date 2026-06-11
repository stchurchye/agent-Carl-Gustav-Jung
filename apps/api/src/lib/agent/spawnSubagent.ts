/**
 * M3-S1：派生子 agent 的共享逻辑（从 deep_research 抽出，供 deep_research + spawn_subagent 共用）。
 *
 * 流程：建子 run(parentRunId + role + budget) → 继承父加密 key → 接父 abort → dispatchChildRun
 * (独立 child executor pool) → 轮询子 run 终态 → 聚合 reply 报告 + citations。
 *
 * 子 run 的可用工具由 run.role 决定(planner 裁剪 + runExecute exec 守卫,见 subagentTools.ts)。
 * 递归(deep_research/spawn_subagent)、暂停(ask_user)不在任何角色子集 → 子 agent 无法再派子 agent。
 */
import { isReplyRefKind, TERMINAL_RUN_STATUSES, type AgentRole, type AgentRun, type ReplyRef } from './types.js';
import * as store from './store.js';
import { createAgentRun, cancelRun } from './runLifecycle.js';
import { dispatchChildRun } from './childExecutor.js';
import { SUBAGENT_MAX_SECONDS } from './runtimeShared.js';

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
// 父轮询窗口需 > 子预算 SUBAGENT_MAX_SECONDS(300s),留余量观察子 run 终态;
// 且 < HIGH_COST_TOOL_TIMEOUT_MS(360s),避免父工具超时早于轮询结束。
const MAX_WAIT_MS = 330_000;
/** 子 run 回流父 run 的引用上限(防子报告/扇出聚合的引用洪水冲垮父资源清单)。 */
export const MAX_CITATIONS = 10;

function fail(error: string, childRunId = '', stepsUsed = 0): RunChildSubagentResult {
  return { ok: false, report: '', citations: [], stepsUsed, childRunId, error };
}

/**
 * 剥离子报告中的 [n] 引用标记 —— 它们按子 run 的资源清单编号,在父上下文中无意义
 * 且会被父 filterCitedRefs 错误解引。只匹配 1-2 位小整数,避免误伤 [2023] 之类年份。
 */
export function stripCitationMarkers(text: string): string {
  return text.replace(/ ?\[\d{1,2}\]/g, '');
}

/**
 * deep_research / spawn_subagent 共用的 replyMeta.extractRefs 实现:
 * 把工具输出里的 citations(已在 runChildSubagent 收敛为 url 类)映射为父 run refs。
 * 运行时守卫 kind/id —— extractRefs 跑在 DB 回读的历史 step output 上,形状不可信。
 */
export function subagentCitationsToRefs(
  output: { ok?: boolean; citations?: SubagentCitation[] } | null | undefined,
): ReplyRef[] {
  if (!output?.ok) return [];
  return (output.citations ?? [])
    .filter(
      (c): c is SubagentCitation & { kind: ReplyRef['kind'] } =>
        isReplyRefKind(c?.kind) && typeof c?.id === 'string' && c.id.length > 0,
    )
    .map((c) => ({ kind: c.kind, id: c.id, ...(c.label ? { label: c.label } : {}) }));
}

/** artifact 缺失时的降级路径:全量拉 steps 找 synthesized reply(旧行为)。 */
async function reportFromSteps(childRunId: string): Promise<string> {
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
  return (
    (replyStep?.output as { content?: string; text?: string } | undefined)?.content ??
    (replyStep?.output as { content?: string; text?: string } | undefined)?.text ??
    '(子 agent 未生成文字报告)'
  );
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
    budget: { maxSteps, maxSeconds: SUBAGENT_MAX_SECONDS, maxTokens: 50_000 },
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

    // 报告 = 子 run artifact.finalContent(softComplete 与 status 同一次 update 写入,无竞态;
    // 与 synthesized reply step 同源)。artifact 缺失(极端写失败)才退化为全量拉 steps 找 reply。
    const rawReport = childRun.artifact?.finalContent ?? (await reportFromSteps(childRunId));
    // 子报告里的 [n] 是按**子 run 自己的**资源清单编号的;父 run 的清单独立编号,
    // 标记泄漏进父上下文会被父 filterCitedRefs 错误解引(错引来源)→ 剥离。
    const report = stripCitationMarkers(rawReport);

    // 引用 = 子 run 终态 artifact.refs 中的 url 类(已过 filterCitedRefs,是"子终稿真引用")。
    // 只回流 url:diagram/document/magi_card 是**子 run 的**产物,挂在子 run 表面,
    // 上浮会让父资源清单宣称一个父界面渲染不出的交付物。限 MAX_CITATIONS 防洪。
    const citations: SubagentCitation[] = (childRun.artifact?.refs ?? [])
      .filter((r) => r.kind === 'url')
      .slice(0, MAX_CITATIONS)
      .map((r) => ({ kind: r.kind, id: r.id, ...(r.label ? { label: r.label } : {}) }));

    return { ok: true, report, citations, stepsUsed: childRun.usage.steps, childRunId };
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}
