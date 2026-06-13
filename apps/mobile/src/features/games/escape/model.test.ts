import {
  ema,
  ESCAPE_TUNING,
  type EscapeState,
  finishCalibration,
  normalizeLoudness,
  observeLoudness,
  startEscape,
  tick,
} from './model';

describe('normalizeLoudness:ESR 振幅(-2..10)→ 抓力 0..1', () => {
  it('低于 0 视为无声 → 0', () => {
    expect(normalizeLoudness(-2, 5)).toBe(0);
    expect(normalizeLoudness(0, 5)).toBe(0);
  });

  it('按校准上限线性映射并夹到 [0,1]', () => {
    expect(normalizeLoudness(2.5, 5)).toBeCloseTo(0.5);
    expect(normalizeLoudness(5, 5)).toBe(1);
    expect(normalizeLoudness(10, 5)).toBe(1); // 超过上限也封顶
  });

  it('上限非正 → 0(防除零)', () => {
    expect(normalizeLoudness(5, 0)).toBe(0);
  });
});

describe('ema 指数滑动平均', () => {
  it('按 alpha 向新值靠拢', () => {
    expect(ema(0, 1, 0.5)).toBeCloseTo(0.5);
    expect(ema(0.5, 1, 0.5)).toBeCloseTo(0.75);
  });
  it('值不变时保持不变', () => {
    expect(ema(0.3, 0.3, 0.4)).toBeCloseTo(0.3);
  });
});

describe('startEscape 开局', () => {
  it('校准中、狗在起点附近、抓力0、未计时', () => {
    const s = startEscape();
    expect(s.phase).toBe('calibrating');
    expect(s.position).toBe(ESCAPE_TUNING.startPosition);
    expect(s.position).toBeGreaterThan(0);
    expect(s.position).toBeLessThan(1);
    expect(s.grip).toBe(0);
    expect(s.calibratedMax).toBe(0);
    expect(s.elapsedMs).toBe(0);
  });
});

describe('校准:observeLoudness + finishCalibration', () => {
  it('校准期把见过的最大振幅记为上限,并抬升抓力', () => {
    let s = startEscape();
    s = observeLoudness(s, 4);
    s = observeLoudness(s, 7);
    s = observeLoudness(s, 3);
    expect(s.calibratedMax).toBe(7);
    expect(s.grip).toBeGreaterThan(0);
  });

  it('finishCalibration 转入游戏,上限不低于地板', () => {
    let quiet = startEscape();
    quiet = observeLoudness(quiet, 0.5); // 很安静
    const started = finishCalibration(quiet);
    expect(started.phase).toBe('playing');
    expect(started.calibratedMax).toBeGreaterThanOrEqual(ESCAPE_TUNING.minCalibratedMax);
  });

  it('游戏期:响声抬抓力,静默让抓力衰减', () => {
    let s = finishCalibration({ ...startEscape(), calibratedMax: 6 });
    const loud = observeLoudness(s, 6);
    expect(loud.grip).toBeGreaterThan(s.grip);
    // 多次静默后抓力趋于 0
    let q = loud;
    for (let i = 0; i < 30; i++) q = observeLoudness(q, 0);
    expect(q.grip).toBeLessThan(0.05);
  });

  it('逃脱后 observeLoudness 空操作', () => {
    const escaped: EscapeState = { ...startEscape(), phase: 'escaped' };
    expect(observeLoudness(escaped, 8)).toBe(escaped);
  });
});

describe('tick 物理推进', () => {
  const playing = (over: Partial<EscapeState> = {}): EscapeState => ({
    ...finishCalibration({ ...startEscape(), calibratedMax: 5 }),
    ...over,
  });

  it('非游戏态(校准/逃脱)位置不动(原样返回)', () => {
    const c = startEscape();
    expect(tick(c, 100)).toBe(c);
    const e: EscapeState = { ...startEscape(), phase: 'escaped' };
    expect(tick(e, 100)).toBe(e);
  });

  it('安静(抓力0):狗向门前进、计时增加', () => {
    const s = playing({ grip: 0 });
    const after = tick(s, 1000);
    expect(after.position).toBeGreaterThan(s.position);
    expect(after.elapsedMs).toBe(1000);
  });

  it('满抓力:狗被往回拽,位置减小且不小于 0', () => {
    const after = tick(playing({ grip: 1, position: 0.5 }), 1000);
    expect(after.position).toBeLessThan(0.5);
    expect(after.position).toBeGreaterThanOrEqual(0);
  });

  it('狗冲到门口 → 逃脱、位置封顶 1', () => {
    const after = tick(playing({ grip: 0, position: 0.98 }), 1000);
    expect(after.phase).toBe('escaped');
    expect(after.position).toBe(1);
  });

  it('前进速度随坚持时间加快', () => {
    const early = tick(playing(), 1000).escapeSpeed;
    const late = tick(playing({ elapsedMs: 20000 }), 1000).escapeSpeed;
    expect(late).toBeGreaterThan(early);
  });
});
