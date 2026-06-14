/**
 * 听更夜奏 · 抚弦惊鸿:节奏计分纯逻辑(全 TDD,不含计时——计时在面板的更鼓节拍里)。
 * 更鼓定速,谱面每拍是「音」(该拨弦)或「留白」(须屏息不弹)。
 * 音拍:绝/稳=稳住并攒「知音」连击,飘=失准扣仪态,漏弹=扣更多;
 * 留白拍:守住=连击+,忍不住弹了=当殿失态(扣最重)。仪态归零或终了不及通过线 → 失态收场。
 */
export type Beat = 'note' | 'rest';
export type Quality = '绝' | '稳' | '飘';

export type ZitherState = {
  chart: readonly Beat[];
  idx: number; // 待结算的拍
  composure: number; // 仪态 0..100
  combo: number; // 当前知音连击
  bestCombo: number;
  status: 'playing' | 'won' | 'lost';
};

export const COMPOSURE_MAX = 100;
export const PASS = 60; // 通过线
const COST = { miss: 20, off: 9, slip: 26 }; // 漏弹 / 飘 / 留白失态
const FLOURISH_EVERY = 4; // 每 4 连击「知音」回气

/** 结算当前一拍。played=本拍是否拨了弦;quality=拨弦的时准(音拍用) */
export function resolveBeat(state: ZitherState, played: boolean, quality: Quality = '稳'): ZitherState {
  if (state.status !== 'playing') return state;
  const beat = state.chart[state.idx];
  if (beat === undefined) return state;

  let composure = state.composure;
  let combo = state.combo;

  if (beat === 'note') {
    if (!played) {
      composure -= COST.miss;
      combo = 0;
    } else if (quality === '飘') {
      composure -= COST.off;
      combo = 0;
    } else {
      combo += 1;
      if (quality === '绝') composure = Math.min(COMPOSURE_MAX, composure + 3);
    }
  } else {
    // 留白拍
    if (played) {
      composure -= COST.slip; // 忍不住弹了 → 失态
      combo = 0;
    } else {
      combo += 1;
    }
  }
  // 知音连击回气
  if (combo > 0 && combo % FLOURISH_EVERY === 0) composure = Math.min(COMPOSURE_MAX, composure + 5);
  composure = Math.max(0, composure);

  const idx = state.idx + 1;
  const bestCombo = Math.max(state.bestCombo, combo);
  let status: ZitherState['status'] = 'playing';
  if (composure <= 0) status = 'lost';
  else if (idx >= state.chart.length) status = composure >= PASS ? 'won' : 'lost';

  return { ...state, idx, composure, combo, bestCombo, status };
}

/** 一击是否触发「知音·惊鸿」(连击刚满 FLOURISH_EVERY 的整数倍) */
export function isFlourish(state: ZitherState): boolean {
  return state.combo > 0 && state.combo % FLOURISH_EVERY === 0;
}

// ── 谱面:听更夜奏(16 拍,留白多设在连音之后,最考「忍手」)──
export const WATCH_CHART: readonly Beat[] = [
  'note', 'note', 'rest', 'note',
  'note', 'note', 'rest', 'rest',
  'note', 'rest', 'note', 'note',
  'note', 'note', 'rest', 'note',
];

export function buildZither(chart: readonly Beat[] = WATCH_CHART): ZitherState {
  return { chart, idx: 0, composure: COMPOSURE_MAX, combo: 0, bestCombo: 0, status: 'playing' };
}
