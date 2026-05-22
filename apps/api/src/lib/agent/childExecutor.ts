import { executeRun } from './runtime.js';

const DEFAULT_CONCURRENCY = 3;
let concurrency = DEFAULT_CONCURRENCY;
const childInFlight = new Set<string>();
const pendingQueue: Array<{ runId: string; resolve: () => void }> = [];

export function setChildConcurrency(n: number): void {
  concurrency = Math.max(1, n);
}

/**
 * 把子 run 派入 child executor pool。
 * 返回的 Promise 在子 run 进入 inFlight 后立即 resolve（不等执行完）。
 * 外层调用者用 store.getAgentRun 轮询子 run 终态。
 */
export async function dispatchChildRun(runId: string): Promise<void> {
  return new Promise<void>((resolve) => {
    pendingQueue.push({ runId, resolve });
    drain();
  });
}

function drain(): void {
  while (childInFlight.size < concurrency && pendingQueue.length > 0) {
    const job = pendingQueue.shift()!;
    childInFlight.add(job.runId);
    job.resolve();
    void executeRun(job.runId)
      .catch((e) => {
        // AbortError in a fire-and-forget context: swallow silently (no caller to propagate to)
        if (e instanceof Error && e.name === 'AbortError') return;
        console.error('[child executor] run failed', job.runId, e);
      })
      .finally(() => {
        childInFlight.delete(job.runId);
        drain();
      });
  }
}

/** 仅用于测试 */
export function _childExecutorStats() {
  return { inFlight: childInFlight.size, pending: pendingQueue.length, concurrency };
}

/** 仅用于测试：重置模块状态，避免用例间串扰 */
export function _resetChildExecutor(): void {
  childInFlight.clear();
  pendingQueue.length = 0;
  concurrency = DEFAULT_CONCURRENCY;
}
