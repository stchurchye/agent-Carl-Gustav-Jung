import { buildDebate, rebut, MOMENTUM_START, WIN_AT, type DebateRound, type DebateState } from './debate';

const R = (delta: number) => ({ label: `驳(${delta})`, delta });
const ROUNDS: DebateRound[] = [
  { argument: '一难', rebuttals: [R(20), R(-15)] },
  { argument: '二难', rebuttals: [R(20), R(-15)] },
];
const playAll = (rounds: DebateRound[], picks: number[]): DebateState => {
  let s = buildDebate(rounds);
  for (const p of picks) s = rebut(s, p);
  return s;
};

describe('公堂辩论 · 气势对垒', () => {
  it('初始气势居中、进行中', () => {
    const s = buildDebate(ROUNDS);
    expect(s.momentum).toBe(MOMENTUM_START);
    expect(s.status).toBe('playing');
    expect(s.idx).toBe(0);
  });

  it('选犀利驳词涨气势、记录涨跌', () => {
    const s = rebut(buildDebate(ROUNDS), 0);
    expect(s.momentum).toBe(MOMENTUM_START + 20);
    expect(s.lastDelta).toBe(20);
    expect(s.idx).toBe(1);
  });

  it('越界选择 → 原引用(no-op)', () => {
    const s = buildDebate(ROUNDS);
    expect(rebut(s, 9)).toBe(s);
    expect(rebut(s, -1)).toBe(s);
  });

  it('lastDelta 记实际涨跌(封顶不夸大,与气势条同步)', () => {
    const big: DebateRound[] = [{ argument: 'a', rebuttals: [R(45)] }, { argument: 'b', rebuttals: [R(45)] }];
    let s = rebut(buildDebate(big), 0); // 50→95
    expect(s.lastDelta).toBe(45);
    s = rebut(s, 0); // 95→clamp(140)=100,实际只涨 5
    expect(s.momentum).toBe(100);
    expect(s.lastDelta).toBe(5);
  });

  it('全程犀利 → 辩完气势够高 → 压服全场 won', () => {
    expect(playAll(ROUNDS, [0, 0]).status).toBe('won');
  });

  it('全程软弱 → 辩完气势不足 → 落于下风 lost', () => {
    const s = playAll(ROUNDS, [1, 1]);
    expect(s.status).toBe('lost');
    expect(s.momentum).toBeGreaterThan(0); // 不是被驳哑,是没占上风
  });

  it('一手丢光气势 → 当殿被驳哑 lost(即时)', () => {
    const harsh: DebateRound[] = [{ argument: '诛心一问', rebuttals: [R(-60)] }, { argument: '二', rebuttals: [R(20)] }];
    const s = rebut(buildDebate(harsh), 0);
    expect(s.momentum).toBe(0);
    expect(s.status).toBe('lost');
  });

  it('结束态再 rebut 空操作', () => {
    const won = playAll(ROUNDS, [0, 0]);
    expect(rebut(won, 0)).toBe(won);
  });

  it(`气势够高的边界:辩完 ≥ ${WIN_AT} 才赢`, () => {
    // 一强一弱:50+20-15=55 < 80 → lost
    expect(playAll(ROUNDS, [0, 1]).status).toBe('lost');
  });
});
