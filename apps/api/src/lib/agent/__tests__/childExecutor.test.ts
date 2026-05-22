import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../runtime.js', () => ({
  executeRun: vi.fn(),
}));
import { executeRun } from '../runtime.js';
import {
  dispatchChildRun,
  setChildConcurrency,
  _childExecutorStats,
  _resetChildExecutor,
} from '../childExecutor.js';

describe('child executor pool', () => {
  beforeEach(() => {
    vi.mocked(executeRun).mockReset();
    _resetChildExecutor();
  });

  it('dispatches run into inFlight', async () => {
    let unblock!: () => void;
    vi.mocked(executeRun).mockImplementation(async () => {
      await new Promise<void>((r) => {
        unblock = r;
      });
    });
    void dispatchChildRun('run-1');
    await new Promise((r) => setTimeout(r, 10));
    expect(_childExecutorStats().inFlight).toBe(1);
    unblock();
    await new Promise((r) => setTimeout(r, 10));
    expect(_childExecutorStats().inFlight).toBe(0);
  });

  it('respects concurrency limit', async () => {
    setChildConcurrency(2);
    const resolvers: Array<() => void> = [];
    vi.mocked(executeRun).mockImplementation(async () => {
      await new Promise<void>((r) => resolvers.push(r));
    });
    void dispatchChildRun('r1');
    void dispatchChildRun('r2');
    void dispatchChildRun('r3');
    await new Promise((r) => setTimeout(r, 20));
    expect(_childExecutorStats().inFlight).toBe(2);
    expect(_childExecutorStats().pending).toBe(1);
    resolvers[0]!();
    await new Promise((r) => setTimeout(r, 20));
    expect(_childExecutorStats().inFlight).toBe(2); // r3 started, r2 still running
    resolvers[1]!();
    resolvers[2]?.();
    await new Promise((r) => setTimeout(r, 20));
    expect(_childExecutorStats().inFlight).toBe(0);
  });

  it('resolve fires before run completes', async () => {
    let runResolve!: () => void;
    vi.mocked(executeRun).mockImplementation(
      () => new Promise<void>((r) => { runResolve = r; }),
    );
    let dispatched = false;
    dispatchChildRun('run-x').then(() => { dispatched = true; });
    await new Promise((r) => setTimeout(r, 10));
    expect(dispatched).toBe(true);
    expect(_childExecutorStats().inFlight).toBe(1);
    runResolve();
    await new Promise((r) => setTimeout(r, 10));
    expect(_childExecutorStats().inFlight).toBe(0);
  });

  it('drain continues after run completes', async () => {
    setChildConcurrency(1);
    const resolvers: Array<() => void> = [];
    vi.mocked(executeRun).mockImplementation(
      () => new Promise<void>((r) => resolvers.push(r)),
    );
    void dispatchChildRun('a');
    void dispatchChildRun('b');
    await new Promise((r) => setTimeout(r, 10));
    expect(_childExecutorStats().inFlight).toBe(1);
    expect(_childExecutorStats().pending).toBe(1);
    resolvers[0]!();
    await new Promise((r) => setTimeout(r, 10));
    expect(_childExecutorStats().inFlight).toBe(1); // b started
    resolvers[1]!();
    await new Promise((r) => setTimeout(r, 10));
    expect(_childExecutorStats().inFlight).toBe(0);
  });
});
