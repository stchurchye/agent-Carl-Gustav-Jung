import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as store from '../store.js';
import { acquireSandbox, killSandboxForRun } from '../sandbox.js';

vi.mock('@e2b/code-interpreter', () => {
  const sandboxes = new Map<string, { killed: boolean }>();
  let nextId = 0;
  return {
    Sandbox: {
      create: vi.fn(async (_opts?: unknown) => {
        const id = `sbx_${++nextId}`;
        const entry = { killed: false };
        sandboxes.set(id, entry);
        return { sandboxId: id, kill: vi.fn(async () => { entry.killed = true; }) };
      }),
      connect: vi.fn(async (sandboxId: string) => {
        const entry = sandboxes.get(sandboxId);
        if (!entry || entry.killed) throw new Error('sandbox not found');
        return { sandboxId, kill: vi.fn(async () => { entry.killed = true; }) };
      }),
      kill: vi.fn(async (sandboxId: string) => {
        const entry = sandboxes.get(sandboxId);
        if (entry) entry.killed = true;
      }),
    },
  };
});

vi.mock('../store.js', () => ({
  getAgentRun: vi.fn(),
  updateAgentRun: vi.fn(),
}));

describe('sandbox lifecycle', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('acquireSandbox creates a new sandbox when run.sandboxId is null', async () => {
    process.env.E2B_API_KEY = 'test-key';
    (store.getAgentRun as any).mockResolvedValue({ id: 'r1', sandboxId: null });
    (store.updateAgentRun as any).mockResolvedValue({ id: 'r1', sandboxId: 'sbx_1' });

    const sbx = await acquireSandbox('r1');
    expect(sbx.sandboxId).toBe('sbx_1');
    expect(store.updateAgentRun).toHaveBeenCalledWith('r1', { sandboxId: 'sbx_1' });
    delete process.env.E2B_API_KEY;
  });

  it('acquireSandbox reconnects when run.sandboxId is set', async () => {
    (store.getAgentRun as any).mockResolvedValue({ id: 'r1', sandboxId: 'sbx_existing' });
    const { Sandbox } = await import('@e2b/code-interpreter');
    (Sandbox.connect as any).mockResolvedValueOnce({
      sandboxId: 'sbx_existing',
      kill: vi.fn(),
    });

    const sbx = await acquireSandbox('r1');
    expect(sbx.sandboxId).toBe('sbx_existing');
    expect(store.updateAgentRun).not.toHaveBeenCalled();
  });

  it('acquireSandbox falls back to create if connect fails', async () => {
    process.env.E2B_API_KEY = 'test-key';
    (store.getAgentRun as any).mockResolvedValue({ id: 'r1', sandboxId: 'sbx_dead' });
    (store.updateAgentRun as any).mockResolvedValue({ id: 'r1', sandboxId: 'sbx_2' });
    const { Sandbox } = await import('@e2b/code-interpreter');
    (Sandbox.connect as any).mockRejectedValueOnce(new Error('sandbox not found'));

    const sbx = await acquireSandbox('r1');
    expect(sbx.sandboxId).toBe('sbx_2');
    expect(store.updateAgentRun).toHaveBeenCalledWith('r1', { sandboxId: 'sbx_2' });
    delete process.env.E2B_API_KEY;
  });

  it('killSandboxForRun calls Sandbox.kill and clears the column', async () => {
    (store.getAgentRun as any).mockResolvedValue({ id: 'r1', sandboxId: 'sbx_alive' });
    (store.updateAgentRun as any).mockResolvedValue({ id: 'r1', sandboxId: null });

    await killSandboxForRun('r1');
    const { Sandbox } = await import('@e2b/code-interpreter');
    expect(Sandbox.kill).toHaveBeenCalledWith('sbx_alive');
    expect(store.updateAgentRun).toHaveBeenCalledWith('r1', { sandboxId: null });
  });

  it('killSandboxForRun is a no-op when run.sandboxId is null', async () => {
    (store.getAgentRun as any).mockResolvedValue({ id: 'r1', sandboxId: null });
    await killSandboxForRun('r1');
    const { Sandbox } = await import('@e2b/code-interpreter');
    expect(Sandbox.kill).not.toHaveBeenCalled();
  });

  it('killSandboxForRun swallows kill errors (best-effort)', async () => {
    (store.getAgentRun as any).mockResolvedValue({ id: 'r1', sandboxId: 'sbx_gone' });
    (store.updateAgentRun as any).mockResolvedValue({ id: 'r1', sandboxId: null });
    const { Sandbox } = await import('@e2b/code-interpreter');
    (Sandbox.kill as any).mockRejectedValueOnce(new Error('already gone'));
    await expect(killSandboxForRun('r1')).resolves.toBeUndefined();
    expect(store.updateAgentRun).toHaveBeenCalledWith('r1', { sandboxId: null });
  });
});
