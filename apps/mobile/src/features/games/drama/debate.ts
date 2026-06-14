/**
 * 公堂辩论 · 气势对垒(纯逻辑,全 TDD)。
 * 逐轮:对方当殿发难,你择一句驳词回敬——选得犀利涨气势、选得软弱/落入圈套则丢气势。
 * 气势归零 = 当殿被驳得哑口无言(lost);辩完全场气势够高 = 压服满堂(won),否则落于下风(lost)。
 * 各轮的发难词与驳词由剧情提供(像说台词的意图一样,内容在 script,不在引擎)。
 */
export type Rebuttal = { label: string; delta: number };
export type DebateRound = { argument: string; who?: string; rebuttals: Rebuttal[] };

export type DebateState = {
  rounds: readonly DebateRound[];
  idx: number; // 当前轮
  momentum: number; // 气势 0..100
  status: 'playing' | 'won' | 'lost';
  lastDelta: number; // 上一手涨跌(给面板做反馈)
};

export const MOMENTUM_MAX = 100;
export const MOMENTUM_START = 50;
export const WIN_AT = 80; // 辩完气势 ≥ 此值方算压服全场

const clamp = (n: number) => Math.max(0, Math.min(MOMENTUM_MAX, n));

export function buildDebate(rounds: readonly DebateRound[]): DebateState {
  return { rounds, idx: 0, momentum: MOMENTUM_START, status: 'playing', lastDelta: 0 };
}

/** 回敬一句驳词;越界选择 → 原引用(no-op) */
export function rebut(state: DebateState, choice: number): DebateState {
  if (state.status !== 'playing') return state;
  const round = state.rounds[state.idx];
  const r = round?.rebuttals[choice];
  if (!r) return state;
  const momentum = clamp(state.momentum + r.delta);
  const idx = state.idx + 1;
  let status: DebateState['status'] = 'playing';
  if (momentum <= 0) status = 'lost'; // 被驳哑
  else if (idx >= state.rounds.length) status = momentum >= WIN_AT ? 'won' : 'lost';
  // lastDelta 记"实际涨跌"(夹紧后),与气势条同步,封顶时不夸大
  return { ...state, idx, momentum, status, lastDelta: momentum - state.momentum };
}
