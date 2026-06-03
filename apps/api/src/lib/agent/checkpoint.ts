import type { AgentCheckpoint, AgentRun, AgentStep, CheckpointFinding, TodoItem } from './types.js';
import type { ToolDef } from './toolRegistry.js';
import { collectReplyRefs, summarizeStepOutput } from './replyGen.js';
import { isToolFailure } from './critique.js';
import { redactSecrets } from './redact.js';

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
 * 去重键：只对**有 ref** 的 finding 去重（按首个 ref.kind:id —— 同一来源重复抓取应合一）。
 * 无 ref 的 finding 返回 null = 不去重：producedAtIdx 闸门已保证每步只折一次，
 * 不同步本就是不同发现（两次 run_python/导出不能因摘要相同被合掉）。
 */
function findingKey(f: CheckpointFinding): string | null {
  const first = f.refs[0];
  return first ? `${first.kind}:${first.id}` : null;
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
  // 同一 toolCallKey 的原始执行 + 缓存命中重放（observe）是同一逻辑结果 —— 只折一次。
  // （ref-bearing 后面还会按 ref 去重；这里专治 ref-less 工具的缓存重放双计。）
  const seenKeys = new Set<string>();
  const dedupedCalls = successfulCalls.filter((s) => {
    if (!s.toolCallKey) return true;
    if (seenKeys.has(s.toolCallKey)) return false;
    seenKeys.add(s.toolCallKey);
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

  // 累积 + 去重（仅 ref-bearing 去重；ref-less 全留）。
  const seen = new Set<string>();
  const completed: CheckpointFinding[] = [];
  for (const f of [...(prior?.completed ?? []), ...newFindings]) {
    const key = findingKey(f);
    if (key !== null) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
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
