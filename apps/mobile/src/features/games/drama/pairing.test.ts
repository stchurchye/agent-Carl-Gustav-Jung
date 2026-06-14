import {
  cycleMark,
  clearMarks,
  isComplete,
  isCorrect,
  solutionsCount,
  buildPairing,
  makePairing,
  type PairingState,
  type Mark,
} from './pairing';
import { mulberry32 } from '../shared/rng';

/** 按真相把整张网格标对 */
const fillTruth = (s: PairingState): PairingState => ({
  ...s,
  marks: s.truth.map((row, i) => row.map((v, j): Mark => (i === j ? 'unknown' : v ? 'lethal' : 'safe'))),
});

describe('验毒配伍 · 标注逻辑', () => {
  const base = makePairing({ n: 5, seed: 7 });

  it('点一格:unknown → lethal → safe → unknown,并同步镜像格', () => {
    let s = cycleMark(base, 0, 1);
    expect(s.marks[0][1]).toBe('lethal');
    expect(s.marks[1][0]).toBe('lethal'); // 镜像
    s = cycleMark(s, 0, 1);
    expect(s.marks[0][1]).toBe('safe');
    s = cycleMark(s, 0, 1);
    expect(s.marks[0][1]).toBe('unknown');
  });

  it('对角 / 越界 → 原引用(no-op)', () => {
    expect(cycleMark(base, 2, 2)).toBe(base);
    expect(cycleMark(base, 0, 9)).toBe(base);
  });

  it('clearMarks 清空所有标注', () => {
    const dirty = cycleMark(cycleMark(base, 0, 1), 2, 3);
    expect(isComplete(clearMarks(dirty))).toBe(false);
    expect(clearMarks(dirty).marks.every((r) => r.every((m) => m === 'unknown'))).toBe(true);
  });

  it('标全且全对 → isCorrect;留空 → 不完整;错一格 → 不对', () => {
    expect(isComplete(base)).toBe(false);
    const ok = fillTruth(base);
    expect(isComplete(ok)).toBe(true);
    expect(isCorrect(ok)).toBe(true);
    // 翻错一对
    const wrongVal: Mark = ok.marks[0][1] === 'lethal' ? 'safe' : 'lethal';
    const bad: PairingState = {
      ...ok,
      marks: ok.marks.map((r, i) => r.map((m, j) => ((i === 0 && j === 1) || (i === 1 && j === 0) ? wrongVal : m))),
    };
    expect(isCorrect(bad)).toBe(false);
  });
});

describe('验毒配伍 · 生成器保证唯一可解', () => {
  for (const seed of [1, 2, 7, 11, 23]) {
    it(`seed ${seed}(n=5):线索集恰好唯一可解 → 真相`, () => {
      const s = buildPairing(mulberry32(seed), { n: 5 });
      // 唯一解 ⇒ 由于真相必满足自身导出的线索,这唯一解即真相
      expect(solutionsCount(s.n, s.clues)).toBe(1);
      expect(isCorrect(fillTruth(s))).toBe(true);
    });
  }

  it('n=4 更短可解;n=5 计数档(useCounts)也唯一可解', () => {
    const small = buildPairing(mulberry32(3), { n: 4 });
    expect(solutionsCount(small.n, small.clues)).toBe(1);
    const hard = buildPairing(mulberry32(9), { n: 5, useCounts: true });
    expect(solutionsCount(hard.n, hard.clues)).toBe(1);
  });

  it('同 seed 可复现', () => {
    const a = buildPairing(mulberry32(42), { n: 5 });
    const b = buildPairing(mulberry32(42), { n: 5 });
    expect(b.truth).toEqual(a.truth);
    expect(b.clues).toEqual(a.clues);
  });
});
