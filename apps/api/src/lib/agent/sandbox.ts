/**
 * M2 Task 1B: E2B Firecracker sandbox lifecycle.
 * One sandbox per agent_run — cross-step Python variable persistence.
 * softComplete (any terminal status) kills the sandbox best-effort.
 */
import { Sandbox } from '@e2b/code-interpreter';
import * as store from './store.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export type SandboxHandle = Awaited<ReturnType<typeof Sandbox.create>>;

export async function acquireSandbox(runId: string): Promise<SandboxHandle> {
  const run = await store.getAgentRun(runId);
  if (!run) throw new Error(`acquireSandbox: run ${runId} not found`);

  if (run.sandboxId) {
    try {
      return await Sandbox.connect(run.sandboxId);
    } catch {
      // sandbox was idle-reclaimed by E2B — fall through to create a new one
    }
  }

  const apiKey = process.env.E2B_API_KEY?.trim();
  if (!apiKey) throw new Error('E2B_API_KEY is not configured');
  const sbx = await Sandbox.create({ apiKey, timeoutMs: DEFAULT_TIMEOUT_MS });
  await store.updateAgentRun(runId, { sandboxId: sbx.sandboxId });
  return sbx;
}

export async function killSandboxForRun(runId: string): Promise<void> {
  const run = await store.getAgentRun(runId);
  if (!run?.sandboxId) return;
  try {
    await Sandbox.kill(run.sandboxId);
  } catch {
    // best-effort: sandbox may already be dead / network error — don't fail softComplete
  }
  try {
    await store.updateAgentRun(runId, { sandboxId: null });
  } catch {
    /* ignore */
  }
}
