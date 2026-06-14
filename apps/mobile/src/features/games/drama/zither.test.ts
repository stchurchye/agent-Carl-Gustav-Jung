import { resolveBeat, isFlourish, buildZither, WATCH_CHART, PASS, COMPOSURE_MAX, type Beat, type Quality, type ZitherState } from './zither';

/** 按一份"每拍是否拨弦 + 时准"的演奏脚本跑完整谱 */
function perform(chart: readonly Beat[], plays: Array<{ played: boolean; q?: Quality }>): ZitherState {
  let s = buildZither(chart);
  for (const p of plays) s = resolveBeat(s, p.played, p.q ?? '稳');
  return s;
}

describe('听更夜奏 · 节奏计分', () => {
  it('音拍稳住 → 攒连击、不掉仪态', () => {
    const s = resolveBeat(buildZither(['note']), true, '稳');
    expect(s.combo).toBe(1);
    expect(s.composure).toBe(COMPOSURE_MAX);
  });

  it('音拍漏弹 / 飘 → 扣仪态、连击清零', () => {
    expect(resolveBeat(buildZither(['note', 'note']), false).composure).toBeLessThan(COMPOSURE_MAX);
    expect(resolveBeat(buildZither(['note', 'note']), false).combo).toBe(0);
    expect(resolveBeat(buildZither(['note', 'note']), true, '飘').combo).toBe(0);
  });

  it('留白拍:守住=连击+;忍不住弹=失态扣最重', () => {
    const hold = resolveBeat(buildZither(['rest', 'rest']), false);
    expect(hold.combo).toBe(1);
    expect(hold.composure).toBe(COMPOSURE_MAX);
    const slip = resolveBeat(buildZither(['rest', 'rest']), true);
    expect(slip.composure).toBeLessThan(COMPOSURE_MAX - 20); // slip 比漏弹更狠
    expect(slip.combo).toBe(0);
  });

  it('知音连击满 4 → 回气', () => {
    let s = buildZither(Array(6).fill('note') as Beat[]);
    s = resolveBeat(s, false); // 先掉点仪态(80)
    const before = s.composure;
    for (let i = 0; i < 4; i++) s = resolveBeat(s, true, '稳'); // 连下 4 拍 → combo 4
    expect(s.combo).toBe(4);
    expect(isFlourish(s)).toBe(true);
    expect(s.composure).toBeGreaterThan(before); // 回了气(+5)
  });

  it('完美奏完全谱(音拍稳、留白守)→ 仪态满、通仪 won', () => {
    const plays = WATCH_CHART.map((b) => ({ played: b === 'note', q: '稳' as Quality }));
    const s = perform(WATCH_CHART, plays);
    expect(s.status).toBe('won');
    expect(s.composure).toBe(COMPOSURE_MAX);
  });

  it('频频留白失态 → 仪态跌破通过线 → lost', () => {
    const plays = WATCH_CHART.map(() => ({ played: true, q: '稳' as Quality })); // 每拍都弹(留白全失态)
    const s = perform(WATCH_CHART, plays);
    expect(s.status).toBe('lost');
    expect(s.composure).toBeLessThan(PASS);
  });

  it('结束态再 resolve 空操作', () => {
    const plays = WATCH_CHART.map((b) => ({ played: b === 'note' }));
    const won = perform(WATCH_CHART, plays);
    expect(resolveBeat(won, true)).toBe(won);
  });
});
