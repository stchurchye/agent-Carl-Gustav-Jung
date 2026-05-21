import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runPythonTool, registerRunPython } from '../tools/runPython.js';
import { toolRegistry } from '../toolRegistry.js';

const fakeCtx = {
  runId: 'r1',
  stepId: 's1',
  ownerId: 'u1',
  channel: 'private' as const,
  signal: new AbortController().signal,
};

vi.mock('../sandbox.js', () => ({
  acquireSandbox: vi.fn(),
}));

import { acquireSandbox } from '../sandbox.js';

function makeSandbox(runResultByCode: Record<string, any>) {
  return {
    sandboxId: 'sbx_1',
    runCode: vi.fn(async (code: string) => {
      const r = runResultByCode[code];
      if (!r) throw new Error(`unexpected code in test: ${code}`);
      return r;
    }),
  };
}

describe('run_python tool', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('registers idempotently', () => {
    registerRunPython();
    registerRunPython();
    expect(toolRegistry.get('run_python')).toBeDefined();
  });

  it('happy path: stdout returned, ok:true', async () => {
    const sbx = makeSandbox({
      'print(1+2)': {
        logs: { stdout: ['3\n'], stderr: [] },
        results: [],
        error: undefined,
      },
    });
    (acquireSandbox as any).mockResolvedValue(sbx);
    const out = await runPythonTool.handler({ code: 'print(1+2)' }, fakeCtx);
    expect(out.ok).toBe(true);
    expect(out.stdout).toBe('3\n');
    expect(out.stderr).toBe('');
  });

  it('Python exception → ok:true + stderr (code bug not tool bug)', async () => {
    const sbx = makeSandbox({
      'raise ValueError("nope")': {
        logs: { stdout: [], stderr: [] },
        results: [],
        error: { name: 'ValueError', value: 'nope', traceback: 'Traceback...\nValueError: nope' },
      },
    });
    (acquireSandbox as any).mockResolvedValue(sbx);
    const out = await runPythonTool.handler({ code: 'raise ValueError("nope")' }, fakeCtx);
    expect(out.ok).toBe(true);
    expect(out.stderr).toContain('ValueError');
  });

  it('sandbox-level error → ok:false', async () => {
    (acquireSandbox as any).mockRejectedValue(new Error('sandbox timeout'));
    const out = await runPythonTool.handler({ code: 'print(1)' }, fakeCtx);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/sandbox timeout/);
  });

  it('AbortError re-throws so runtime sees cancel', async () => {
    (acquireSandbox as any).mockImplementation(() => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    });
    await expect(
      runPythonTool.handler({ code: 'print(1)' }, fakeCtx),
    ).rejects.toThrow(/aborted/);
  });

  it('code over 16KB → ok:false with size-limit error', async () => {
    (acquireSandbox as any).mockResolvedValue(makeSandbox({}));
    const huge = 'x = 1\n'.repeat(3000); // ~18 KB
    const out = await runPythonTool.handler({ code: huge }, fakeCtx);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/code too large/);
  });

  it('stdout truncated to 8KB', async () => {
    const longStdout = 'a'.repeat(10_000);
    const sbx = makeSandbox({
      'print("a"*10000)': {
        logs: { stdout: [longStdout], stderr: [] },
        results: [],
        error: undefined,
      },
    });
    (acquireSandbox as any).mockResolvedValue(sbx);
    const out = await runPythonTool.handler({ code: 'print("a"*10000)' }, fakeCtx);
    expect(out.stdout.length).toBeLessThanOrEqual(8 * 1024);
  });
});
