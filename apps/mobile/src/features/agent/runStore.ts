import { AppState, type AppStateStatus } from 'react-native';
import { fetchAgentRun, longPollAgentRun } from './agentApi';
import { isTerminalRunStatus } from './types';
import type { AgentNotice, AgentRun, AgentStep } from './types';

/**
 * W1a:agent run 的共享订阅层。
 *
 * 此前每个 AgentRunCard/AskUserPromptCard/详情屏各自 useAgentRunPoll —— 同一 run
 * 多条 long-poll 并行、跨屏状态短暂不一致、重进屏必现「加载中」闪卡(重新 bootstrap)。
 * 改为 module 级 store:同 runId 共享一条 long-poll 与一份快照缓存;
 * refCount=0 停轮询但保缓存(重挂载即时渲染);AppState 进后台暂停、回前台恢复。
 *
 * 轮询协议不变(M6 T1b):bootstrap 全量 GET /runs/:id → loop long-poll(after=lastIdx)。
 */

const CLIENT_TIMEOUT_MS = 35000; // server max 30s + 5s 余量
const ERROR_BACKOFF_MS = 1000;
// 网络持续故障时固定 1s 退避 = 1Hz 打接口耗电;连续瞬时错误指数退避,封顶 30s。
const ERROR_BACKOFF_MAX_MS = 30000;


export type RunSnapshot = {
  run: AgentRun | null;
  steps: AgentStep[];
  notices: AgentNotice[];
  connected: boolean;
  /** run 已不存在/无权访问(404/403):永久态,停止轮询(否则 1s 退避无限重试狂打接口)。 */
  missing?: boolean;
};

export const EMPTY_RUN_SNAPSHOT: RunSnapshot = {
  run: null,
  steps: [],
  notices: [],
  connected: false,
};

/** 404/403 是永久错误:run 被删或无权,重试不会好。 */
function isPermanentRunError(e: unknown): boolean {
  const status = (e as { status?: number })?.status;
  if (status === 404 || status === 403) return true;
  const msg = e instanceof Error ? e.message : '';
  return /\b(404|403)\b/.test(msg);
}

type Entry = {
  snap: RunSnapshot;
  listeners: Set<() => void>;
  refCount: number;
  loopActive: boolean;
  cancelled: boolean;
  activeCtl: AbortController | null;
  lastIdx: number;
  bootstrapped: boolean;
};

const entries = new Map<string, Entry>();
let appStateSub: { remove: () => void } | null = null;
let inBackground = false;

function isTerminal(run: AgentRun | null): boolean {
  return !!run && isTerminalRunStatus(run.status);
}

function getEntry(runId: string): Entry {
  let e = entries.get(runId);
  if (!e) {
    e = {
      snap: EMPTY_RUN_SNAPSHOT,
      listeners: new Set(),
      refCount: 0,
      loopActive: false,
      cancelled: false,
      activeCtl: null,
      lastIdx: -1,
      bootstrapped: false,
    };
    entries.set(runId, e);
  }
  return e;
}

function emit(e: Entry, patch: Partial<RunSnapshot>) {
  e.snap = { ...e.snap, ...patch };
  for (const l of e.listeners) l();
}

function mergeSteps(e: Entry, incoming: AgentStep[]): AgentStep[] {
  if (incoming.length === 0) return e.snap.steps;
  const byId = new Map(e.snap.steps.map((s) => [s.id, s]));
  for (const s of incoming) byId.set(s.id, s);
  return Array.from(byId.values()).sort((a, b) => a.idx - b.idx);
}

async function runLoop(runId: string, e: Entry) {
  if (e.loopActive) {
    e.cancelled = false; // 卸载后极速重挂:让仍在收尾的 loop 继续
    return;
  }
  e.loopActive = true;
  e.cancelled = false;
  emit(e, { connected: true });

  if (!e.bootstrapped) {
    try {
      const { run, steps, notices } = await fetchAgentRun(runId);
      if (!e.cancelled) {
        e.bootstrapped = true;
        e.lastIdx = steps.length > 0 ? Math.max(...steps.map((s) => s.idx)) : -1;
        emit(e, { run, steps, notices: notices ?? [] });
      }
    } catch (err) {
      if (isPermanentRunError(err)) {
        e.cancelled = true;
        e.loopActive = false;
        emit(e, { connected: false, missing: true });
        return;
      }
      // 瞬时失败不致命:loop 以 after=-1 long-poll,batch 自带 run+全量 steps
    }
  }

  let errorStreak = 0;
  while (!e.cancelled && !isTerminal(e.snap.run)) {
    const ctl = new AbortController();
    e.activeCtl = ctl;
    const timeoutId = setTimeout(() => ctl.abort(), CLIENT_TIMEOUT_MS);
    try {
      const batch = await longPollAgentRun(runId, e.lastIdx, ctl.signal);
      errorStreak = 0;
      if (e.cancelled) break;
      const patch: Partial<RunSnapshot> = {};
      if (batch.run) {
        patch.run = batch.run;
        e.bootstrapped = true;
      }
      if (batch.notices) patch.notices = batch.notices;
      if (batch.steps && batch.steps.length > 0) {
        patch.steps = mergeSteps(e, batch.steps);
        e.lastIdx = Math.max(...batch.steps.map((s) => s.idx));
      }
      if (Object.keys(patch).length > 0) emit(e, patch);
      if (batch.run && isTerminal(batch.run)) break;
    } catch (err) {
      if (e.cancelled) break;
      if (isPermanentRunError(err)) {
        e.cancelled = true;
        emit(e, { missing: true });
        break;
      }
      const backoffMs = Math.min(ERROR_BACKOFF_MS * 2 ** errorStreak, ERROR_BACKOFF_MAX_MS);
      errorStreak += 1;
      await new Promise((r) => setTimeout(r, backoffMs));
    } finally {
      clearTimeout(timeoutId);
      e.activeCtl = null;
    }
  }

  e.loopActive = false;
  emit(e, { connected: false });
  // 竞态守卫:收尾期间若有新订阅/回前台把 cancelled 翻回 false(走了 runLoop 早返回分支),
  // 旧 loop 退出会让轮询静默死亡 —— 此处补一次重启判定。
  if (!e.cancelled && e.refCount > 0 && !isTerminal(e.snap.run) && !e.snap.missing && !inBackground) {
    void runLoop(runId, e);
  }
}

function pauseEntry(e: Entry) {
  e.cancelled = true;
  e.activeCtl?.abort();
}

function handleAppStateChange(state: AppStateStatus) {
  const background = state !== 'active';
  if (background === inBackground) return;
  inBackground = background;
  if (background) {
    for (const e of entries.values()) {
      if (e.loopActive) pauseEntry(e);
    }
  } else {
    for (const [runId, e] of entries.entries()) {
      if (e.refCount > 0 && !isTerminal(e.snap.run) && !e.snap.missing) void runLoop(runId, e);
    }
  }
}

function ensureAppStateWiring() {
  if (appStateSub) return;
  appStateSub = AppState.addEventListener('change', handleAppStateChange);
}

/** 订阅一个 run:首个订阅者启动轮询;返回退订函数(末个订阅者退订即暂停,缓存保留)。 */
export function subscribeRun(runId: string, listener: () => void): () => void {
  ensureAppStateWiring();
  const e = getEntry(runId);
  e.listeners.add(listener);
  e.refCount += 1;
  if (!inBackground && !isTerminal(e.snap.run) && !e.snap.missing) void runLoop(runId, e);
  return () => {
    e.listeners.delete(listener);
    e.refCount -= 1;
    if (e.refCount <= 0) {
      e.refCount = 0;
      pauseEntry(e);
    }
  };
}

export function getRunSnapshot(runId: string): RunSnapshot {
  return entries.get(runId)?.snap ?? EMPTY_RUN_SNAPSHOT;
}

export function __resetRunStoreForTests() {
  for (const e of entries.values()) pauseEntry(e);
  entries.clear();
  appStateSub?.remove();
  appStateSub = null;
  inBackground = false;
}
