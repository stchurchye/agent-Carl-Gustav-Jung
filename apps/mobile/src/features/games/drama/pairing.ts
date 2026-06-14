/**
 * 验毒配伍 · 太医院试毒局:逻辑约束网格(纯逻辑,全 TDD)。
 * 玩家面对 n 味御药两两配伍的「真值网格」(每对 安/烈),真相不直给——
 * 只凭几纸「医案」线索(约束)推断,逐格标注,整张呈对才算解。仿 generateCase「构造即验证」:
 * 生成器保证线索集恰好唯一可解(种子可复现),公平性在测试里可证。
 */
import { mulberry32, randomSeed } from '../shared/rng';

export type Mark = 'unknown' | 'safe' | 'lethal';

/** 医案线索 = 对真值网格的纯布尔约束(同时作为展示给玩家的flavor文案) */
export type Clue =
  | { kind: 'allWith'; ing: number; value: boolean; text: string } // 凡与 ing 同盏者皆 value(烈/安)
  | { kind: 'pair'; a: number; b: number; value: boolean; text: string } // 该具体一对 = value
  | { kind: 'rowCount'; ing: number; lethal: number; text: string } // ing 一行恰有 lethal 道烈
  | { kind: 'parity'; ing: number; even: boolean; text: string }; // ing 一行烈者成双/成单

export type PairingState = {
  n: number;
  names: readonly string[];
  /** truth[i][j]=true ⇒ 该对为「烈」(对称,对角 false) */
  truth: ReadonlyArray<readonly boolean[]>;
  /** 玩家标注(对称,对角恒 unknown) */
  marks: ReadonlyArray<readonly Mark[]>;
  clues: readonly Clue[];
};

const MEDS = ['麝香', '甘草', '犀角', '雄黄', '朱砂', '人参', '附子', '黄连'];

const cloneMarks = (m: ReadonlyArray<readonly Mark[]>) => m.map((row) => [...row]);

/** 点一格:unknown → lethal → safe → unknown,并同步镜像格;对角/越界 → 原引用(no-op) */
export function cycleMark(state: PairingState, i: number, j: number): PairingState {
  if (i === j || i < 0 || j < 0 || i >= state.n || j >= state.n) return state;
  const nextOf: Record<Mark, Mark> = { unknown: 'lethal', lethal: 'safe', safe: 'unknown' };
  const v = nextOf[state.marks[i][j]];
  const marks = cloneMarks(state.marks);
  marks[i][j] = v;
  marks[j][i] = v;
  return { ...state, marks };
}

/** 重置所有标注 */
export function clearMarks(state: PairingState): PairingState {
  return { ...state, marks: state.marks.map((row) => row.map(() => 'unknown' as Mark)) };
}

/** 全部非对角格都已标(无空白) */
export function isComplete(state: PairingState): boolean {
  for (let i = 0; i < state.n; i++)
    for (let j = 0; j < state.n; j++) if (i !== j && state.marks[i][j] === 'unknown') return false;
  return true;
}

/** 标全且每对都与真相一致 */
export function isCorrect(state: PairingState): boolean {
  if (!isComplete(state)) return false;
  for (let i = 0; i < state.n; i++)
    for (let j = i + 1; j < state.n; j++)
      if ((state.marks[i][j] === 'lethal') !== state.truth[i][j]) return false;
  return true;
}

// ── 生成器:抽真值 + 贪心选线索至唯一可解 ──

const pairList = (n: number): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) out.push([i, j]);
  return out;
};

/** mask 第 p 位是否「烈」 */
const bit = (mask: number, p: number) => ((mask >> p) & 1) === 1;

function pairIndexMap(n: number, pairs: Array<[number, number]>): number[][] {
  const idx = Array.from({ length: n }, () => new Array(n).fill(-1));
  pairs.forEach(([i, j], p) => {
    idx[i][j] = p;
    idx[j][i] = p;
  });
  return idx;
}

/** 某 mask(真值赋值)是否满足某条线索 */
function clueOkMask(clue: Clue, mask: number, n: number, idx: number[][]): boolean {
  const lethal = (i: number, j: number) => bit(mask, idx[i][j]);
  const rowLethal = (ing: number) => {
    let c = 0;
    for (let j = 0; j < n; j++) if (j !== ing && lethal(ing, j)) c++;
    return c;
  };
  switch (clue.kind) {
    case 'allWith':
      for (let j = 0; j < n; j++) if (j !== clue.ing && lethal(clue.ing, j) !== clue.value) return false;
      return true;
    case 'pair':
      return lethal(clue.a, clue.b) === clue.value;
    case 'rowCount':
      return rowLethal(clue.ing) === clue.lethal;
    case 'parity':
      return rowLethal(clue.ing) % 2 === 0 === clue.even;
  }
}

/** 满足全部线索的真值网格(mask)个数——暴力枚举 2^C(n,2)(n≤6 ⇒ ≤32768) */
export function solutionsCount(n: number, clues: readonly Clue[]): number {
  const pairs = pairList(n);
  const idx = pairIndexMap(n, pairs);
  const total = 1 << pairs.length;
  let count = 0;
  for (let mask = 0; mask < total; mask++) {
    if (clues.every((c) => clueOkMask(c, mask, n, idx))) count++;
  }
  return count;
}

function truthToMask(truth: ReadonlyArray<readonly boolean[]>, pairs: Array<[number, number]>): number {
  let m = 0;
  pairs.forEach(([i, j], p) => {
    if (truth[i][j]) m |= 1 << p;
  });
  return m;
}

/** 从真值列出所有「为真」的候选线索(非 pair 在前,逼玩家推理;pair 兜底) */
function candidateClues(
  n: number,
  names: readonly string[],
  truth: boolean[][],
  rng: () => number,
  useCounts: boolean,
): Clue[] {
  const rowLethal = (ing: number) => {
    let c = 0;
    for (let j = 0; j < n; j++) if (j !== ing && truth[ing][j]) c++;
    return c;
  };
  const allWith: Clue[] = [];
  const counts: Clue[] = [];
  const pairs: Clue[] = [];
  for (let ing = 0; ing < n; ing++) {
    const neigh: boolean[] = [];
    for (let j = 0; j < n; j++) if (j !== ing) neigh.push(truth[ing][j]);
    if (neigh.every((v) => v))
      allWith.push({ kind: 'allWith', ing, value: true, text: `凡与「${names[ing]}」同盏者,皆烈` });
    else if (neigh.every((v) => !v))
      allWith.push({ kind: 'allWith', ing, value: false, text: `「${names[ing]}」解百毒,逢之转安` });
    const k = rowLethal(ing);
    counts.push({ kind: 'rowCount', ing, lethal: k, text: `「${names[ing]}」一味,恰配出 ${k} 道烈药` });
    counts.push({ kind: 'parity', ing, even: k % 2 === 0, text: `「${names[ing]}」所配,烈者成${k % 2 === 0 ? '双' : '单'}` });
  }
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      pairs.push({
        kind: 'pair',
        a: i,
        b: j,
        value: truth[i][j],
        text: truth[i][j]
          ? `「${names[i]}」遇「${names[j]}」,两烈相激`
          : `「${names[i]}」与「${names[j]}」,相济则安`,
      });
  const shuffle = (arr: Clue[]) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const k = Math.floor(rng() * (i + 1));
      [arr[i], arr[k]] = [arr[k], arr[i]];
    }
    return arr;
  };
  // 顺序:allWith(强约束) → (可选)计数/奇偶 → pair(直给,兜底放最后)
  return [...shuffle(allWith), ...(useCounts ? shuffle(counts) : []), ...shuffle(pairs)];
}

/**
 * 生成一局「唯一可解」的配伍局。seed 可复现。
 * size=n(网格)、clueBudget(线索软上限)、useCounts(是否加计数/奇偶约束 → 更难)。
 */
export function buildPairing(
  rng: () => number,
  opts: { n: number; clueBudget?: number; useCounts?: boolean },
): PairingState {
  const n = opts.n;
  const budget = opts.clueBudget ?? n * 2;
  const useCounts = opts.useCounts ?? false;
  const names = MEDS.slice(0, n);
  const pairs = pairList(n);
  const idx = pairIndexMap(n, pairs);

  const truth: boolean[][] = Array.from({ length: n }, () => new Array(n).fill(false));
  for (const [i, j] of pairs) {
    const v = rng() < 0.5;
    truth[i][j] = v;
    truth[j][i] = v;
  }
  const truthMask = truthToMask(truth, pairs);

  const cands = candidateClues(n, names, truth, rng, useCounts);
  const chosen: Clue[] = [];
  const countWith = (cs: Clue[]) => {
    const total = 1 << pairs.length;
    let c = 0;
    for (let mask = 0; mask < total; mask++) if (cs.every((cl) => clueOkMask(cl, mask, n, idx))) c++;
    return c;
  };
  let cur = countWith(chosen); // = total(无约束)
  for (const c of cands) {
    if (cur === 1) break;
    const tentative = [...chosen, c];
    const next = countWith(tentative);
    if (next < cur && (chosen.length < budget || next === 1)) {
      chosen.push(c);
      cur = next;
    }
  }
  // 兜底:若仍非唯一,补 pair 直给直到唯一(candidateClues 已含全部 pair,故必能收敛)
  if (cur > 1) {
    for (const c of cands) {
      if (cur === 1) break;
      if (chosen.includes(c)) continue;
      const next = countWith([...chosen, c]);
      if (next < cur) {
        chosen.push(c);
        cur = next;
      }
    }
  }

  const marks: Mark[][] = Array.from({ length: n }, () => new Array(n).fill('unknown'));
  // 健壮性:唯一解必等于 truth(测试也会断言)
  void truthMask;
  return { n, names, truth, marks, clues: chosen };
}

/** 便捷:按 seed 生成 */
export function makePairing(opts: { n: number; clueBudget?: number; useCounts?: boolean; seed?: number }): PairingState {
  return buildPairing(mulberry32(opts.seed ?? randomSeed()), opts);
}
