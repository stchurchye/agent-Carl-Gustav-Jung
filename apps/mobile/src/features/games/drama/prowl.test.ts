import {
  parseProwl,
  buildProwl,
  step,
  makeCourtyard,
  COURTYARD_GRID,
  COURTYARD_GUARDS,
  type ProwlAction,
  type ProwlState,
} from './prowl';

const ACT: Record<string, ProwlAction> = { '.': 'wait', U: 'up', D: 'down', L: 'left', R: 'right' };
const replay = (s: ProwlState, seq: string) => [...seq].reduce((st, ch) => step(st, ACT[ch]), s);

describe('月下夜探 · 潜行逻辑', () => {
  it('parseProwl 读出起点/目标/守卫', () => {
    const L = parseProwl(COURTYARD_GRID, COURTYARD_GUARDS, 3);
    expect(L.start).toEqual({ r: 1, c: 1 });
    expect(L.goal).toEqual({ r: 6, c: 5 });
    expect(L.guards.length).toBe(3);
    expect(L.walls.has('0,0')).toBe(true);
  });

  it('撞墙/越界 → 原引用(no-op)', () => {
    const s = makeCourtyard();
    expect(step(s, 'up')).toBe(s); // (0,1) 是墙
    expect(step(s, 'left')).toBe(s); // (1,0) 是墙
  });

  it('屏息 → 回合数 +1、玩家不动、仍在进行', () => {
    const s = step(makeCourtyard(), 'wait');
    expect(s.t).toBe(1);
    expect(s.player).toEqual({ r: 1, c: 1 });
    expect(s.status).toBe('playing');
  });

  it('视锥逮人:小关卡里走进守卫朝向的视锥 → caught', () => {
    const grid = ['#####', '#P..#', '#...#', '#####'];
    const guards = [[[2, 3], [2, 2], [2, 1], [2, 2]] as ReadonlyArray<readonly [number, number]>];
    const tiny = buildProwl(parseProwl(grid, guards, 3));
    expect(step(tiny, 'down').status).toBe('caught'); // 守卫转到 (2,2) 朝左,锥扫到 (2,1)
    expect(step(tiny, 'right').status).toBe('playing'); // 上一行安全
  });

  it('庭院:第一步直接右行撞上巡夜犬视锥 → caught', () => {
    expect(step(makeCourtyard(), 'right').status).toBe('caught');
    expect(step(makeCourtyard(), 'wait').status).toBe('playing');
  });

  it('重放 BFS 解法(卡时机)→ 踏上偏殿、脱困 won', () => {
    expect(replay(makeCourtyard(), '.D..DDDDRRRR').status).toBe('won');
  });

  it('不卡时机鲁莽冲 → 被抓(非 won)', () => {
    expect(replay(makeCourtyard(), 'DDDDDRRRR').status).not.toBe('won');
  });
});
