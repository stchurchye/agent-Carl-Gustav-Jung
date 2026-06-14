/**
 * 默宫仪 · 宫礼版 Simon(纯逻辑,全 TDD)。
 * 掌仪嬷嬷示范一段步步加长的礼仪手势,雪团凭记忆复现——但金羽塞了一记「诈仪」禁手
 * (御前叩首=僭越),示范里会出现,玩家必须**忍住不照做、跳过它**。
 * 复现正确 = 把当前轮的示范序列里的禁手剔掉、其余按序点出。点错/反射性点了禁手 = 失仪(lost)。
 */
export type Gesture = string;
export const GESTURES: readonly Gesture[] = ['跪', '拜', '叩', '兴', '避', '奉'];

export type KoulliState = {
  palette: readonly Gesture[];
  sequence: readonly Gesture[]; // 完整示范序列
  forbidden: Gesture; // 诈仪禁手
  round: number; // 当前要复现的长度(1..sequence.length)
  pos: number; // 本轮已对的手势数
  status: 'playing' | 'won' | 'lost';
};

/** 当前轮该点出的手势(示范前 round 个,剔除禁手) */
export function expectedSeq(s: KoulliState): Gesture[] {
  return s.sequence.slice(0, s.round).filter((g) => g !== s.forbidden);
}

/** 点一个手势 */
export function tapGesture(state: KoulliState, g: Gesture): KoulliState {
  if (state.status !== 'playing') return state;
  const exp = expectedSeq(state);
  if (g !== exp[state.pos]) return { ...state, status: 'lost' }; // 点错 / 反射点了禁手 → 失仪
  const pos = state.pos + 1;
  if (pos < exp.length) return { ...state, pos };
  // 本轮复现完毕
  if (state.round >= state.sequence.length) return { ...state, pos, status: 'won' };
  return { ...state, round: state.round + 1, pos: 0 }; // 进下一轮(panel 重放更长示范)
}

/** 失仪后重头来过 */
export function resetKoulli(state: KoulliState): KoulliState {
  return { ...state, round: 1, pos: 0, status: 'playing' };
}

// ── 生成器(种子可复现):一段含 1 记禁手的礼仪序列 ──
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildKoulli(
  rng: () => number,
  opts: { length?: number; paletteSize?: number },
): KoulliState {
  const length = opts.length ?? 5;
  const palette = GESTURES.slice(0, opts.paletteSize ?? 5);
  const forbidden = palette[Math.floor(rng() * palette.length)];
  const safe = palette.filter((g) => g !== forbidden);
  const seq: Gesture[] = [];
  for (let i = 0; i < length; i++) seq[i] = safe[Math.floor(rng() * safe.length)];
  // 把禁手塞到中段一处(首位永远是安全手势,保证每轮可点)
  const trapAt = 1 + Math.floor(rng() * (length - 1));
  seq[trapAt] = forbidden;
  return { palette, sequence: seq, forbidden, round: 1, pos: 0, status: 'playing' };
}

export function makeKoulli(opts: { length?: number; paletteSize?: number; seed?: number }): KoulliState {
  return buildKoulli(mulberry(opts.seed ?? 1), opts);
}
