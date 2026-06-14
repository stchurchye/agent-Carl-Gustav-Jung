import { tapGesture, expectedSeq, resetKoulli, makeKoulli, buildKoulli, type KoulliState } from './koulli';

/** 一路正确复现到底 */
function playCorrect(s0: KoulliState): KoulliState {
  let s = s0;
  let guard = 0;
  while (s.status === 'playing' && guard++ < 200) {
    const exp = expectedSeq(s);
    s = tapGesture(s, exp[s.pos]);
  }
  return s;
}

describe('默宫仪 · Simon + 诈仪禁手', () => {
  const base = makeKoulli({ length: 5, seed: 7 });

  it('生成:禁手在调色板内,序列含禁手,首位非禁手', () => {
    expect(base.palette).toContain(base.forbidden);
    expect(base.sequence).toContain(base.forbidden);
    expect(base.sequence[0]).not.toBe(base.forbidden);
  });

  it('expectedSeq 剔除禁手', () => {
    expect(expectedSeq({ ...base, round: base.sequence.length })).toEqual(
      base.sequence.filter((g) => g !== base.forbidden),
    );
  });

  it('一路按序复现(自动跳过禁手)→ 通仪 won', () => {
    expect(playCorrect(base).status).toBe('won');
  });

  it('反射性点了禁手 → 失仪 lost', () => {
    expect(tapGesture(base, base.forbidden).status).toBe('lost'); // 首步期待安全手势,点禁手即错
  });

  it('点错手势 → 失仪 lost', () => {
    const exp0 = expectedSeq(base)[0];
    const wrong = base.palette.find((g) => g !== exp0 && g !== base.forbidden)!;
    expect(tapGesture(base, wrong).status).toBe('lost');
  });

  it('每对一手则进度+1;每轮复现完则轮次+1', () => {
    const exp = expectedSeq(base);
    const s1 = tapGesture(base, exp[0]);
    if (exp.length > 1) {
      expect(s1.pos).toBe(1);
      expect(s1.round).toBe(1);
    } else {
      expect(s1.round).toBe(2); // 单手即完成本轮
    }
  });

  it('失仪后 reset 重头来过', () => {
    const dead = tapGesture(base, base.forbidden);
    const fresh = resetKoulli(dead);
    expect(fresh.status).toBe('playing');
    expect(fresh.round).toBe(1);
    expect(fresh.pos).toBe(0);
  });

  it('多种子都能一路复现通仪', () => {
    for (const seed of [1, 3, 9, 17, 42]) expect(playCorrect(buildKoulli((() => { let a = seed; return () => ((a = (a * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); })(), { length: 6 })).status).toBe('won');
  });
});
