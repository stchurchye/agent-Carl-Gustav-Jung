import * as store from './store.js';
import { executeRun } from './runtime.js';

export type WorkerHandle = {
  stop: () => void;
};

const inFlight = new Set<string>();

async function tick() {
  if (inFlight.size > 0) return;
  const run = await store.pickupNextRun().catch(() => null);
  if (!run) return;
  inFlight.add(run.id);
  executeRun(run.id)
    .catch(() => {})
    .finally(() => inFlight.delete(run.id));
}

export function startAgentWorker(
  opts: { concurrency?: number; intervalMs?: number } = {},
): WorkerHandle {
  // 在测试环境(NODE_ENV=test/vitest)下完全跳过 pickup,避免与 vitest 进程
  // 直接调用 executeRun 的测试争抢 agent_runs.
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
    return { stop: () => {} };
  }
  const interval = opts.intervalMs ?? 2_000;
  const timer = setInterval(() => {
    void tick();
  }, interval);
  return {
    stop: () => clearInterval(timer),
  };
}
