import * as store from './store.js';
import { agentHookBus } from './hooks.js';
import { redactSecrets } from './redact.js';
import type { AgentRun, StepKind } from './types.js';

export type RecordStepInput = {
  runId: string;
  kind: StepKind;
  toolName?: string | null;
  toolCallKey?: string | null;
  input?: unknown;
  output?: unknown;
  tokens?: number;
  durationMs?: number;
  error?: string | null;
  byUserId?: string | null;
};

/**
 * 写一条 step,自动取下一 idx.
 * 并发场景下 idx 由 db unique 约束兜底,调用方应捕获并 retry.
 */
export async function recordStep(input: RecordStepInput) {
  const nextIdx = (await store.maxStepIdx(input.runId)) + 1;
  // S0：落库前脱敏 step.input（用户可能把 API key 误粘进工具入参）。
  // 只动 input —— 幂等 key 在 runExecute 里早已用原始 input 算好并经 toolCallKey 传入；
  // output 保持原始（幂等 replay / extractRef 结构化读它，到投影点再脱敏）。
  const safeInput =
    input.input === undefined ? input.input : redactSecrets(input.input);
  const step = await store.insertStep({ ...input, input: safeInput, idx: nextIdx });
  agentHookBus.emitEvent({ type: 'step.recorded', runId: input.runId, step });
  return step;
}

/**
 * 启动心跳：每 intervalMs 写一次 last_heartbeat_at = now()。
 * 返回 stop fn。
 */
export function startHeartbeat(
  runId: string,
  intervalMs = 10_000,
): () => void {
  // 立即写一次,占住 pickupNextRun 的"30 秒陈旧"窗口,避免本进程刚起跑、
  // 另一个 worker 就抢走同一行的竞态.
  void store
    .updateAgentRun(runId, { lastHeartbeatAt: new Date() })
    .catch(() => {});
  const timer = setInterval(() => {
    void store
      .updateAgentRun(runId, { lastHeartbeatAt: new Date() })
      .catch(() => {});
  }, intervalMs);
  return () => clearInterval(timer);
}

/** 用 run.usage + delta 写回新 usage */
export function incrementUsage(
  run: AgentRun,
  delta: {
    steps?: number;
    elapsedSeconds?: number;
    tokens?: number;
    costCny?: number;
  },
) {
  return {
    steps: run.usage.steps + (delta.steps ?? 0),
    elapsedSeconds: run.usage.elapsedSeconds + (delta.elapsedSeconds ?? 0),
    tokens: run.usage.tokens + (delta.tokens ?? 0),
    costCny: run.usage.costCny + (delta.costCny ?? 0),
  };
}
