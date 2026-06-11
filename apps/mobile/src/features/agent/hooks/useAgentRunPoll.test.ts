import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import type { AgentRun, AgentStep } from '../types';

// W1a 共享 run 订阅层:同 runId 多消费方共享一条 long-poll 与一份缓存。
// 行为(经公共接口 useAgentRunPoll 验证):
//   1. 两个实例同 runId → 只 bootstrap 一次、同一时刻最多一条 long-poll 在途
//   2. terminal run 的缓存:重新挂载即时拿到数据,不重新 bootstrap
//   3. 全部卸载 → 在途请求被 abort,不再发新请求
//   4. AppState 进后台 → 暂停轮询;回前台 → 恢复

const mockFetchAgentRun = jest.fn();
const mockLongPoll = jest.fn();
jest.mock('../agentApi', () => ({
  fetchAgentRun: (...a: unknown[]) => mockFetchAgentRun(...a),
  longPollAgentRun: (...a: unknown[]) => mockLongPoll(...a),
}));

import { useAgentRunPoll } from './useAgentRunPoll';
import { __resetRunStoreForTests } from '../runStore';

function makeRun(status: AgentRun['status']): AgentRun {
  return { id: 'r1', status } as AgentRun;
}
function makeStep(idx: number): AgentStep {
  return { id: `s${idx}`, idx, kind: 'observe' } as AgentStep;
}

type Pending = {
  resolve: (b: unknown) => void;
  reject: (e: unknown) => void;
  signal: AbortSignal;
};
let pendingPolls: Pending[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  __resetRunStoreForTests();
  pendingPolls = [];
  mockFetchAgentRun.mockResolvedValue({
    run: makeRun('running'),
    steps: [makeStep(0)],
    notices: [],
  });
  // 仿真 fetch 行为:signal abort 时 reject(AbortError)
  mockLongPoll.mockImplementation((_id: string, _after: number, signal: AbortSignal) => {
    return new Promise((resolve, reject) => {
      const abort = () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      if (signal.aborted) return abort();
      signal.addEventListener('abort', abort);
      pendingPolls.push({ resolve, reject, signal });
    });
  });
});

const flush = () => act(async () => {});

it('two subscribers of the same run share one bootstrap and one in-flight long-poll', async () => {
  const a = renderHook(() => useAgentRunPoll('r1'));
  const b = renderHook(() => useAgentRunPoll('r1'));
  await flush();

  expect(mockFetchAgentRun).toHaveBeenCalledTimes(1);
  expect(mockLongPoll).toHaveBeenCalledTimes(1);
  expect(a.result.current.run?.status).toBe('running');
  expect(b.result.current.run?.status).toBe('running');
  expect(a.result.current.steps).toHaveLength(1);
  expect(b.result.current.steps).toHaveLength(1);

  a.unmount();
  b.unmount();
});

it('terminal run is served from cache on remount without a second bootstrap', async () => {
  const a = renderHook(() => useAgentRunPoll('r1'));
  await flush();
  // long-poll 返回 terminal batch → loop 结束
  await act(async () => {
    pendingPolls[0].resolve({
      type: 'batch',
      run: makeRun('completed'),
      steps: [makeStep(1)],
      notices: [],
    });
  });
  expect(a.result.current.run?.status).toBe('completed');
  a.unmount();

  const b = renderHook(() => useAgentRunPoll('r1'));
  // 挂载即有缓存(同步),且不再 bootstrap/轮询
  expect(b.result.current.run?.status).toBe('completed');
  expect(b.result.current.steps).toHaveLength(2);
  await flush();
  expect(mockFetchAgentRun).toHaveBeenCalledTimes(1);
  expect(mockLongPoll).toHaveBeenCalledTimes(1);
  b.unmount();
});

it('unmounting the last subscriber aborts the in-flight poll and stops the loop', async () => {
  const a = renderHook(() => useAgentRunPoll('r1'));
  await flush();
  const inflight = pendingPolls[0];
  expect(inflight.signal.aborted).toBe(false);

  a.unmount();
  await flush();
  expect(inflight.signal.aborted).toBe(true);
  // abort 拒绝后 loop 退出,不再发起新请求
  await flush();
  expect(mockLongPoll).toHaveBeenCalledTimes(1);
});

it('stops polling permanently when the run does not exist (404), exposing missing=true', async () => {
  // 旧行为:404 当瞬时错误 1s 退避无限重试(聊天里引用已删除的 run 时狂打接口+永远「加载中」)。
  const err404 = Object.assign(new Error('not found'), { status: 404 });
  mockFetchAgentRun.mockRejectedValue(err404);
  mockLongPoll.mockRejectedValue(Object.assign(new Error('long-poll failed: 404'), {}));
  const a = renderHook(() => useAgentRunPoll('r1'));
  await flush();
  await flush();
  expect(a.result.current.missing).toBe(true);
  const calls = mockLongPoll.mock.calls.length;
  await flush();
  expect(mockLongPoll.mock.calls.length).toBe(calls); // 不再重试
  a.unmount();
});

it('pauses polling in background and resumes on foreground', async () => {
  const addSpy = jest.spyOn(AppState, 'addEventListener');
  const a = renderHook(() => useAgentRunPoll('r1'));
  await flush();
  expect(mockLongPoll).toHaveBeenCalledTimes(1);
  const handler = addSpy.mock.calls.find(([type]) => type === 'change')?.[1] as (
    s: string,
  ) => void;
  expect(handler).toBeDefined();

  await act(async () => {
    handler('background');
  });
  expect(pendingPolls[0].signal.aborted).toBe(true);
  await flush();
  expect(mockLongPoll).toHaveBeenCalledTimes(1); // 后台不再发

  await act(async () => {
    handler('active');
  });
  await flush();
  expect(mockLongPoll).toHaveBeenCalledTimes(2); // 回前台立即恢复一轮
  a.unmount();
});

// Review 2026-06-11 [P1][mobile-agent] runStore.ts:103
// bootstrap 瞬时失败 → loop 以 after=-1 轮询;若网络持续故障,旧版固定 1s 退避
// 无限重试(1Hz 打接口耗电、lastIdx 永不推进)。修后:连续瞬时错误指数退避
// (1s→2s→4s…封顶),一旦成功立即复位。
describe('transient error exponential backoff', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('backs off exponentially on consecutive transient errors and resets after success', async () => {
    jest.useFakeTimers();
    mockFetchAgentRun.mockRejectedValue(new Error('network down')); // 瞬时(非404/403)
    mockLongPoll.mockImplementation(() => Promise.reject(new Error('network down')));

    const a = renderHook(() => useAgentRunPoll('r1'));
    await flush();
    expect(mockLongPoll).toHaveBeenCalledTimes(1); // 第 1 次失败,进入 1s 退避

    await act(async () => {
      await jest.advanceTimersByTimeAsync(999);
    });
    expect(mockLongPoll).toHaveBeenCalledTimes(1);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });
    expect(mockLongPoll).toHaveBeenCalledTimes(2); // 1s 后第 2 次,失败 → 2s 退避

    await act(async () => {
      await jest.advanceTimersByTimeAsync(1999);
    });
    expect(mockLongPoll).toHaveBeenCalledTimes(2); // 旧版此处已 1s 重试 → 3 次(红)
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });
    expect(mockLongPoll).toHaveBeenCalledTimes(3); // 2s 后第 3 次,失败 → 4s 退避

    // 第 3 次失败后改为成功(idle 行带 run),退避应复位回 1s
    mockLongPoll
      .mockImplementationOnce(() =>
        Promise.resolve({ type: 'idle', run: makeRun('running'), steps: [], lastIdx: -1 }),
      )
      .mockImplementationOnce(() => Promise.reject(new Error('network down')))
      .mockImplementation(
        (_id: string, _after: number, signal: AbortSignal) =>
          new Promise((resolve, reject) => {
            signal.addEventListener('abort', () =>
              reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })),
            );
            pendingPolls.push({ resolve, reject, signal });
          }),
      );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(4000); // 第 4 次:成功(复位);第 5 次立即发出并失败
    });
    expect(mockLongPoll).toHaveBeenCalledTimes(5); // 第 5 次失败后退避应为 1s 而非 8s
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1000);
    });
    expect(mockLongPoll).toHaveBeenCalledTimes(6); // 复位后 1s 即重试

    a.unmount();
  });
});

// Review 2026-06-11 [P2][mobile-agent] runStore.ts:84/:113
describe('runStore 健壮性(P2)', () => {
  it('某个 listener 抛错不阻断其他 listener(emit 错误隔离)', async () => {
    const { subscribeRun, getRunSnapshot } = jest.requireActual('../runStore') as
      typeof import('../runStore');
    const calls: string[] = [];
    const unsubA = subscribeRun('r1', () => {
      calls.push('a');
      throw new Error('listener a exploded');
    });
    const unsubB = subscribeRun('r1', () => {
      calls.push('b');
    });
    await flush();
    // bootstrap 完成会 emit;a 抛错不应吞掉 b
    expect(calls).toContain('b');
    expect(getRunSnapshot('r1').run?.status).toBe('running');
    unsubA();
    unsubB();
  });

  it('404 永久错误的条目在末位退订时被清理,重订阅可重新 bootstrap', async () => {
    const err404 = Object.assign(new Error('not found'), { status: 404 });
    mockFetchAgentRun.mockRejectedValue(err404);
    const a = renderHook(() => useAgentRunPoll('r-gone'));
    await flush();
    expect(a.result.current.missing).toBe(true);
    const bootstraps = mockFetchAgentRun.mock.calls.length;
    a.unmount(); // 末位退订 → 条目应被清理,不再泄漏 listeners/旧快照

    // run 之后恢复(例如被重新创建):重订阅应重新 bootstrap,而不是永远 serve 旧 missing 快照
    mockFetchAgentRun.mockResolvedValue({ run: makeRun('running'), steps: [], notices: [] });
    const b = renderHook(() => useAgentRunPoll('r-gone'));
    await flush();
    expect(mockFetchAgentRun.mock.calls.length).toBeGreaterThan(bootstraps);
    expect(b.result.current.missing).toBeFalsy();
    expect(b.result.current.run?.status).toBe('running');
    b.unmount();
  });
});
