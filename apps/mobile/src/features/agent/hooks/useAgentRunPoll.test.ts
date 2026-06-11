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
