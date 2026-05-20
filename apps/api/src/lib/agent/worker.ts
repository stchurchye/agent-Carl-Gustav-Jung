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
  const interval = opts.intervalMs ?? 2_000;
  const timer = setInterval(() => {
    void tick();
  }, interval);
  return {
    stop: () => clearInterval(timer),
  };
}
