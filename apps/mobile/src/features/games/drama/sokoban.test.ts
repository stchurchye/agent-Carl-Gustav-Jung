import { parseLevel, move, isSolved, KUFANG_LEVEL, type Dir } from './sokoban';

const DIR: Record<string, Dir> = { U: 'up', D: 'down', L: 'left', R: 'right' };
const replay = (grid: string[], seq: string) =>
  [...seq].reduce((s, ch) => move(s, DIR[ch]), parseLevel(grid));

describe('推箱子纯逻辑', () => {
  it('parseLevel 读出墙/机关/箱/玩家', () => {
    const s = parseLevel(['#####', '#@$.#', '#####']);
    expect(s.player).toEqual({ r: 1, c: 1 });
    expect(s.boxes.has('1,2')).toBe(true);
    expect(s.targets.has('1,3')).toBe(true);
    expect(s.walls.has('0,0')).toBe(true);
  });

  it('走向空地 → 玩家移动', () => {
    const s = parseLevel(['####', '#@ #', '####']);
    expect(move(s, 'right').player).toEqual({ r: 1, c: 2 });
  });

  it('撞墙 → 原地不动(返回原引用)', () => {
    const s = parseLevel(['###', '#@#', '###']);
    expect(move(s, 'up')).toBe(s);
    expect(move(s, 'left')).toBe(s);
  });

  it('推箱:箱后是空地 → 箱与玩家各进一格', () => {
    const s = parseLevel(['#####', '#@$ #', '#####']);
    const n = move(s, 'right');
    expect(n.player).toEqual({ r: 1, c: 2 });
    expect(n.boxes.has('1,3')).toBe(true);
    expect(n.boxes.has('1,2')).toBe(false);
  });

  it('推不动:箱后是墙 → 不动', () => {
    const s = parseLevel(['####', '#@$#', '####']); // 箱紧贴右墙
    expect(move(s, 'right')).toBe(s);
  });

  it('推不动:箱后还是箱 → 不动', () => {
    const s = parseLevel(['#####', '#@$$#', '#####']);
    expect(move(s, 'right')).toBe(s);
  });

  it('isSolved:箱压在机关上才算解开', () => {
    expect(isSolved(parseLevel(['###', '#*#', '###']))).toBe(true); // * = 箱在机关
    expect(isSolved(parseLevel(['####', '#@$.', '####']))).toBe(false);
  });
});

describe('库房脱困关卡(KUFANG)', () => {
  it('4 宫箱 ↔ 4 地砖机关,有玩家', () => {
    const s = parseLevel(KUFANG_LEVEL);
    expect(s.boxes.size).toBe(4);
    expect(s.targets.size).toBe(4);
    expect(s.player).toEqual({ r: 6, c: 5 });
  });

  it('重放 BFS 解法序列 → 解开(关卡确有解)', () => {
    const solved = replay(KUFANG_LEVEL, 'UURULLLLULURRRRDDDDLDRULLLULDUUU');
    expect(isSolved(solved)).toBe(true);
  });

  it('解法少走一步(去掉末步)→ 还没解开(够难,非一两步可破)', () => {
    const almost = replay(KUFANG_LEVEL, 'UURULLLLULURRRRDDDDLDRULLLULDUU');
    expect(isSolved(almost)).toBe(false);
  });
});
