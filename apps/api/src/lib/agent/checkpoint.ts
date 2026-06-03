import type { AgentCheckpoint, AgentRun, AgentStep, CheckpointFinding, ReplyRef, TodoItem } from './types.js';
import type { ToolDef } from './toolRegistry.js';
import type { LlmChatClient } from '../llm/types.js';
import { collectReplyRefs, summarizeStepOutput } from './replyGen.js';
import { isToolFailure } from './critique.js';
import { redactSecrets } from './redact.js';
import { extractJsonCandidate } from './planner.js';

/**
 * S1：累积式结构化 checkpoint。机械版（无 LLM）—— 每步把成功工具调用的发现 +ref
 * 折叠进 completed，跨步累积、不丢旧发现。LLM 压缩（S4）只在累积过大时压列表。
 * 类型定义在 types.ts（避免循环依赖），这里 re-export 方便调用方。
 */
export type { AgentCheckpoint, CheckpointFinding };

/** 读 run 上累积的 checkpoint（替代 readStashedContinuationProgress 的结构化版）。 */
export function readLatestCheckpoint(run: AgentRun): AgentCheckpoint | null {
  return run.contextCheckpoint ?? null;
}

export type BuildCheckpointOpts = {
  goal: string;
  intent: string;
  successCount: number;
  toolMap: Map<string, ToolDef>;
};

/** output 是否是 ok:false 的失败观察（error 列没填时的兜底）。 */
function isOkFalseOutput(output: unknown): boolean {
  const raw =
    (output as { result?: unknown } | null)?.result ?? output;
  return (
    raw != null && typeof raw === 'object' && (raw as { ok?: unknown }).ok === false
  );
}

/**
 * 机械累积：把 prior 之后的新成功工具步折叠成 findings，并进 prior.completed。
 * - 只取 idx > prior.producedAtIdx 的新步（不重复折叠）。
 * - 滤掉 soft-fail/失败步（isToolFailure）。
 * - finding.refs 复用 collectReplyRefs（已按 kind:id 去重、ok:false 不产 ref）。
 */
export function buildCheckpoint(
  prior: AgentCheckpoint | null,
  steps: AgentStep[],
  todos: TodoItem[],
  opts: BuildCheckpointOpts,
): AgentCheckpoint {
  const sinceIdx = prior?.producedAtIdx ?? -1;
  const newSteps = steps.filter((s) => s.idx > sinceIdx);
  // 成功的工具步：tool_call 或 observe（idempotency 缓存命中复用了真实结果），
  // 排除失败（isToolFailure 看 error 列）与 ok:false（error 列没填时兜底）。
  const successfulCalls = newSteps.filter(
    (s) =>
      (s.kind === 'tool_call' || s.kind === 'observe') &&
      !isToolFailure(s) &&
      !isOkFalseOutput(s.output),
  );
  // 同一 idempotency key 的原始执行 + 缓存命中重放（observe）是同一逻辑结果 —— 只折一次。
  // 注意：生产里缓存命中 observe 的 toolCallKey 列是 null，key 落在 input.idempotencyKey；
  // 原始 tool_call 的 key 在 toolCallKey 列。两处都取出来才能真正配上对（整体 review #2）。
  const idemKeyOf = (s: AgentStep): string | null =>
    s.toolCallKey ??
    ((s.input as { idempotencyKey?: unknown } | null)?.idempotencyKey as string | undefined) ??
    null;
  const seenKeys = new Set<string>();
  const dedupedCalls = successfulCalls.filter((s) => {
    const k = idemKeyOf(s);
    if (!k) return true;
    if (seenKeys.has(k)) return false;
    seenKeys.add(k);
    return true;
  });

  const newFindings: CheckpointFinding[] = dedupedCalls.map((s) => {
    const tool = s.toolName ? opts.toolMap.get(s.toolName) : undefined;
    return {
      text: s.toolName ?? '<tool>',
      finding: summarizeStepOutput(s.output, tool?.replyMeta?.summaryKind),
      refs: collectReplyRefs([s], opts.toolMap),
    };
  });

  // 累积 + 去重：按**全部** ref id 去重（不止 refs[0]）—— S4 压缩会把多条合并成一条带
  // [A,B,C] 的 finding，若只认首 ref，重抓 B/C 会被当新发现重折（整体 review #4）。
  // ref-less finding 全留（每步独立；缓存重放已在 dedupedCalls 按 idempotency key 去过）。
  const seenRefIds = new Set<string>();
  const completed: CheckpointFinding[] = [];
  for (const f of [...(prior?.completed ?? []), ...newFindings]) {
    const ids = f.refs.map((r) => `${r.kind}:${r.id}`);
    if (ids.length > 0 && ids.some((id) => seenRefIds.has(id))) continue;
    for (const id of ids) seenRefIds.add(id);
    completed.push(f);
  }

  const maxIdx = steps.reduce((m, s) => Math.max(m, s.idx), sinceIdx);

  const remainingPlan = todos
    .filter((t) => t.status !== 'completed')
    .map((t) => t.text);

  return {
    version: 1,
    goal: opts.goal,
    intent: opts.intent,
    completed,
    remainingPlan,
    openQuestions: prior?.openQuestions ?? [],
    // 机械版：下一步 = 第一个未完成的 todo（S4 的 LLM 版会写更准的 nextStep / FINALIZE）。
    nextStep: remainingPlan[0] ?? prior?.nextStep ?? '',
    successCount: opts.successCount,
    producedAtIdx: maxIdx,
    digestTail: buildDigestTail(steps),
  };
}

/** 每条近窗输出的较全上限（比 finding 摘要的 200 字富，但不致灌爆 planner）。 */
const DIGEST_TAIL_STEPS = 4;
const DIGEST_TAIL_PER_STEP = 1500;

/** 近窗高保真：取最近 K 步成功工具输出，各保留较全（≤1.5KB）摘要。 */
function buildDigestTail(steps: AgentStep[]): string {
  const recent = steps
    .filter(
      (s) =>
        (s.kind === 'tool_call' || s.kind === 'observe') &&
        !isToolFailure(s) &&
        !isOkFalseOutput(s.output),
    )
    .slice(-DIGEST_TAIL_STEPS);
  return recent
    .map((s) => {
      let out = '';
      try {
        // S2d：digestTail 是送 LLM 的投影 → 脱敏（持久化 step.output 保持原始）。
        out = JSON.stringify(redactSecrets(s.output) ?? {}).slice(0, DIGEST_TAIL_PER_STEP);
      } catch {
        out = '[unserializable]';
      }
      return `- ${s.toolName ?? '<tool>'}: ${out}`;
    })
    .join('\n');
}

/**
 * S4：当累积 checkpoint 过大时，用 LLM 压缩 completed 列表（合并/丢弃条目、保留 refs），
 * 并更新 nextStep/openQuestions。**不重写每条 finding 措辞**（避免摘要的摘要漂移）。
 * 用 resolveLlmClient 包好的 client（计入 run.usage、可被 cancel 中断）。
 * fail-open：解析失败/LLM 出错 → 返回原 checkpoint，绝不阻塞循环；abort 透传。
 */
const AGENT_CHECKPOINT_SYSTEM = `你是 agent 任务状态的压缩器。读取当前任务状态(JSON)，把它压缩得更短，但绝不丢关键信息。
严格输出单个 JSON（无代码块、无解释）：
{"completed":[{"text":"做了什么","finding":"关键结论","refs":[{"kind":"url","id":"…","label":"…"}]}],"remainingPlan":["…"],"openQuestions":["…"],"nextStep":"下一步最具体动作；目标已达成写 FINALIZE"}
规则：
- 压缩方式 = 合并相似/重复的 completed 条目、丢弃最不重要的旧条目；不要逐条重写已有 finding 的措辞（避免摘要的摘要漂移）。
- completed 压到最多 10 条以内。
- 必须保留每条 finding 的来源 refs（url/document/magi_card/diagram），refs 不得丢（合并条目时把各自的 refs 并上）。
- nextStep 必须可执行；目标已达成写 "FINALIZE"。
- 不编造状态里没有的内容。`;

/**
 * S5：累积 checkpoint 是否大到该 LLM 压缩。**只量 completed**（压缩能缩的部分；
 * digestTail 是近窗高保真、压缩不动它，算进去会让阈值被 digestTail 主导、几乎恒真→白压）。
 * 粗字符估算，超阈值即触发。S7 会把 token 估算换成 CJK 感知版。
 */
const CHECKPOINT_COMPACT_CHARS = 3500;
export function checkpointNeedsCompaction(cp: AgentCheckpoint): boolean {
  return JSON.stringify(cp.completed).length > CHECKPOINT_COMPACT_CHARS;
}

const REF_KINDS = new Set(['document', 'url', 'magi_card', 'diagram']);
function validRefs(v: unknown): ReplyRef[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (r): r is ReplyRef =>
      r != null &&
      typeof r === 'object' &&
      typeof (r as ReplyRef).id === 'string' &&
      REF_KINDS.has((r as ReplyRef).kind),
  );
}

export async function compactCheckpointViaLlm(params: {
  checkpoint: AgentCheckpoint;
  llm: LlmChatClient;
  signal: AbortSignal;
}): Promise<AgentCheckpoint> {
  const { checkpoint, llm, signal } = params;
  const userPrompt =
    `# 当前任务状态（JSON）\n` +
    JSON.stringify({
      goal: checkpoint.goal,
      completed: checkpoint.completed,
      remainingPlan: checkpoint.remainingPlan,
      openQuestions: checkpoint.openQuestions,
      nextStep: checkpoint.nextStep,
    }) +
    `\n\n请压缩 completed 列表并输出新状态 JSON。`;
  try {
    const result = await llm.chat(
      [
        { role: 'system', content: AGENT_CHECKPOINT_SYSTEM },
        { role: 'user', content: userPrompt },
      ],
      { temperature: 0.2, maxTokens: 1500, signal },
    );
    const candidate = extractJsonCandidate(result.content);
    if (!candidate) return checkpoint;
    const parsed = JSON.parse(candidate) as {
      completed?: unknown;
      remainingPlan?: unknown;
      openQuestions?: unknown;
      nextStep?: unknown;
    };
    if (!Array.isArray(parsed.completed)) return checkpoint; // 校验失败 → fail-open
    const compressed: CheckpointFinding[] = parsed.completed
      .filter((c): c is Record<string, unknown> => c != null && typeof c === 'object')
      .map((c) => ({
        text: typeof c.text === 'string' ? c.text : '',
        finding: typeof c.finding === 'string' ? c.finding : '',
        refs: validRefs(c.refs), // 只保留合法 {kind,id} ref，挡 undefined:undefined 引用
      }));
    // 压缩不该把发现清空：坏输出 → fail-open 保原。
    if (compressed.length === 0 && checkpoint.completed.length > 0) return checkpoint;

    // 来源神圣：把"refs 被压缩全丢掉的原始 ref-bearing 发现"补回，绝不丢来源。
    const keptRefIds = new Set(
      compressed.flatMap((c) => c.refs.map((r) => `${r.kind}:${r.id}`)),
    );
    const lost = checkpoint.completed.filter(
      (c) => c.refs.length > 0 && c.refs.every((r) => !keptRefIds.has(`${r.kind}:${r.id}`)),
    );
    const completed = [...compressed, ...lost];
    // 整体 review #3：缩小校验放在**补回之后** —— 否则补回后可能 >= 原始，但 needsCompaction
    // 仍真 → 每轮重压、永不收敛。补回后没变小 → 判这次压缩无效，fail-open 保原。
    if (completed.length >= checkpoint.completed.length) return checkpoint;
    const strArr = (v: unknown, fallback: string[]) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : fallback;
    return {
      ...checkpoint, // 保留 version/goal/intent/successCount/producedAtIdx/digestTail
      completed,
      remainingPlan: strArr(parsed.remainingPlan, checkpoint.remainingPlan),
      openQuestions: strArr(parsed.openQuestions, checkpoint.openQuestions),
      nextStep: typeof parsed.nextStep === 'string' ? parsed.nextStep : checkpoint.nextStep,
    };
  } catch (e) {
    if (signal.aborted) throw e; // 取消 → 透传，别误当压缩失败
    return checkpoint; // fail-open
  }
}
