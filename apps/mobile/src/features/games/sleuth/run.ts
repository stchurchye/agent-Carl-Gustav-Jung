import { mulberry32 } from '../shared/rng';
import { generateCase, type Clue, type SleuthCase, type SniffAttr } from './engine';

export type RunStatus = 'sniffing' | 'lost';

/** 一局游戏的全部状态。种子驱动 → 可序列化、可复现(不存 rng 闭包) */
export type RunState = {
  seed: number;
  /** 第几桩案件(从 1 起) */
  caseNum: number;
  case: SleuthCase;
  clues: Clue[];
  sniffsLeft: number;
  /** 已破案数 = 分数 */
  solved: number;
  status: RunStatus;
};

/** 难度:嫌疑狗数随案号缓升(每两桩 +1,上限 8),嗅探预算恒为 3 */
export function caseParams(caseNum: number): { count: number; budget: number } {
  return { count: Math.min(4 + Math.floor((caseNum - 1) / 2), 8), budget: 3 };
}

/** 把 (seed, caseNum) 混成该案件的独立种子,保证逐案不同又整体可复现 */
function caseSeed(seed: number, caseNum: number): number {
  return (Math.imul(seed, 2654435761) + caseNum * 40503) >>> 0;
}

function buildCase(seed: number, caseNum: number, solved: number): RunState {
  const { count, budget } = caseParams(caseNum);
  const theCase = generateCase(mulberry32(caseSeed(seed, caseNum)), { count, budget });
  return { seed, caseNum, case: theCase, clues: [], sniffsLeft: budget, solved, status: 'sniffing' };
}

/** 开一局新游戏 */
export function startRun(seed: number): RunState {
  return buildCase(seed, 1, 0);
}

/** 嗅探一个维度:揭示真凶在该维度的取值,扣一次,记一条线索。已嗅过/没次数/非进行中 → 空操作 */
export function sniff(state: RunState, attr: SniffAttr): RunState {
  if (state.status !== 'sniffing' || state.sniffsLeft <= 0) return state;
  if (state.clues.some((c) => c.attr === attr)) return state;
  const value = state.case.suspects[state.case.culpritIndex][attr];
  return {
    ...state,
    clues: [...state.clues, { attr, value }],
    sniffsLeft: state.sniffsLeft - 1,
  };
}

/** 指认一只狗:对 → 破案 +1 并进入更难的下一桩;错 → 整局结束 */
export function accuse(state: RunState, suspectIndex: number): RunState {
  if (state.status !== 'sniffing') return state;
  if (suspectIndex === state.case.culpritIndex) {
    return buildCase(state.seed, state.caseNum + 1, state.solved + 1);
  }
  return { ...state, status: 'lost' };
}
