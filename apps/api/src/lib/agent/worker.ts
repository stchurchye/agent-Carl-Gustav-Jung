import * as store from './store.js';
import { executeRun } from './runtime.js';
import { autoResolveExpiredApprovals } from './approval.js';
import { autoExpireAwaitingUserInput } from './expireAwaitingUserInput.js';
import { autoOpenAskUserForAll } from './openAskUserForAll.js';

export type WorkerHandle = {
  stop: () => void;
};

const inFlight = new Set<string>();

async function tick() {
  // 1) Approval timeout checker (M1b-2 ADR-1)：每个 tick 都扫一次过期 awaiting_approval。
  //    autoResolveExpiredApprovals 内部已写 approval_timeout + grant/deny step，
  //    且让对应 run 进入 'running' 或 'replanning' 状态，供下方 pickup 接力。
  try {
    await autoResolveExpiredApprovals(new Date());
  } catch (e) {
    console.error('[agent worker] autoResolveExpiredApprovals failed', e);
  }

  // 1.5) M4 Task 5：过期 awaiting_user_input → auto cancel('user_timeout')
  try {
    await autoExpireAwaitingUserInput(new Date());
  } catch (e) {
    console.error('[agent worker] autoExpireAwaitingUserInput failed', e);
  }

  // 1.6) M7 T6e：群聊 ask_user owner 独占 30s 后升级为任意群成员可答
  try {
    await autoOpenAskUserForAll(new Date());
  } catch (e) {
    console.error('[agent worker] autoOpenAskUserForAll failed', e);
  }

  // 2) Pickup 下一个 draft/running/replanning 待办 run。
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
