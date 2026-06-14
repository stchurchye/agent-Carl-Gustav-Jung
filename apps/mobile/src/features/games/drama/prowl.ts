/**
 * 月下夜探 · 回合制潜行(纯逻辑,全 TDD)。
 * 雪团每回合走一格或屏息(wait);之后所有巡夜犬沿固定环路各进一步、转向其前进方向;
 * 回合末若与任一守卫同格、或落在其朝向视锥内(墙/柱挡视线)→ 被发现(caught)。踏上目标格 → 脱困(won)。
 * 撞墙/越界/走进当前守卫格 → 原引用(no-op,同 sokoban)。
 */
export type Dir = 'up' | 'down' | 'left' | 'right';
export type ProwlAction = Dir | 'wait';
export type Pos = { r: number; c: number };

const DELTA: Record<Dir, readonly [number, number]> = {
  up: [-1, 0],
  down: [1, 0],
  left: [0, -1],
  right: [0, 1],
};

export type ProwlLevel = {
  rows: number;
  cols: number;
  walls: ReadonlySet<string>;
  start: Pos;
  goal: Pos;
  guards: ReadonlyArray<ReadonlyArray<Pos>>; // 每个守卫一条循环巡逻路径(相邻格)
  sight: number; // 视锥射程
};

export type ProwlState = {
  level: ProwlLevel;
  player: Pos;
  t: number; // 全局回合/相位
  status: 'playing' | 'won' | 'caught';
};

const key = (r: number, c: number) => `${r},${c}`;
const eq = (a: Pos, b: Pos) => a.r === b.r && a.c === b.c;

export function parseProwl(
  grid: string[],
  guardPaths: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
  sight = 3,
): ProwlLevel {
  const walls = new Set<string>();
  let start: Pos = { r: 0, c: 0 };
  let goal: Pos = { r: 0, c: 0 };
  grid.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const ch = row[c];
      if (ch === '#') walls.add(key(r, c));
      if (ch === 'P') start = { r, c };
      if (ch === 'G') goal = { r, c };
    }
  });
  const guards = guardPaths.map((p) => p.map(([r, c]) => ({ r, c })));
  return { rows: grid.length, cols: Math.max(...grid.map((r) => r.length)), walls, start, goal, guards, sight };
}

export function buildProwl(level: ProwlLevel): ProwlState {
  return { level, player: level.start, t: 0, status: 'playing' };
}

const facingOf = (path: ReadonlyArray<Pos>, idx: number): Dir => {
  const a = path[idx];
  const b = path[(idx + 1) % path.length];
  const dr = Math.sign(b.r - a.r);
  const dc = Math.sign(b.c - a.c);
  for (const d of Object.keys(DELTA) as Dir[]) if (DELTA[d][0] === dr && DELTA[d][1] === dc) return d;
  return 'up';
};

/** 某守卫在相位 t 的 位置+朝向 */
function guardAt(path: ReadonlyArray<Pos>, t: number): { pos: Pos; dir: Dir } {
  const idx = ((t % path.length) + path.length) % path.length;
  return { pos: path[idx], dir: facingOf(path, idx) };
}

/** 从 pos 朝 dir 的视锥格(射程内,遇墙/越界即止;不含 pos 本身) */
function coneTiles(level: ProwlLevel, pos: Pos, dir: Dir): Pos[] {
  const out: Pos[] = [];
  const [dr, dc] = DELTA[dir];
  let r = pos.r;
  let c = pos.c;
  for (let s = 1; s <= level.sight; s++) {
    r += dr;
    c += dc;
    if (level.walls.has(key(r, c)) || r < 0 || c < 0 || r >= level.rows || c >= level.cols) break;
    out.push({ r, c });
  }
  return out;
}

/** 相位 t 下所有守卫的 位置/朝向/视锥(供面板渲染) */
export function guardViews(state: ProwlState): Array<{ pos: Pos; dir: Dir; cone: Pos[] }> {
  return state.level.guards.map((path) => {
    const g = guardAt(path, state.t);
    return { pos: g.pos, dir: g.dir, cone: coneTiles(state.level, g.pos, g.dir) };
  });
}

/** 相位 t 下,(r,c) 是否被任一守卫看见(同格或在视锥内) */
function seenAt(level: ProwlLevel, t: number, pos: Pos): boolean {
  for (const path of level.guards) {
    const g = guardAt(path, t);
    if (eq(g.pos, pos)) return true;
    for (const cell of coneTiles(level, g.pos, g.dir)) if (eq(cell, pos)) return true;
  }
  return false;
}

/** 走一步或屏息;非法移动 → 原引用 */
export function step(state: ProwlState, action: ProwlAction): ProwlState {
  if (state.status !== 'playing') return state;
  const { level } = state;
  let next = state.player;
  if (action !== 'wait') {
    const [dr, dc] = DELTA[action];
    const t: Pos = { r: state.player.r + dr, c: state.player.c + dc };
    if (level.walls.has(key(t.r, t.c)) || t.r < 0 || t.c < 0 || t.r >= level.rows || t.c >= level.cols) return state;
    // 不能走进当前守卫格
    for (const path of level.guards) if (eq(guardAt(path, state.t).pos, t)) return state;
    next = t;
  }
  if (eq(next, level.goal)) return { ...state, player: next, status: 'won' }; // 踏上偏殿即脱困
  const nt = state.t + 1;
  const caught = seenAt(level, nt, next);
  return { ...state, player: next, t: nt, status: caught ? 'caught' : 'playing' };
}

// ── 关卡:月下庭院(3 巡夜犬,走廊+对相位扫;BFS 验证 12 步可解、周期 30)──
export const COURTYARD_GRID: string[] = [
  '########',
  '#P.....#',
  '#.####.#',
  '#......#',
  '#.####.#',
  '#......#',
  '#....G.#',
  '########',
];
export const COURTYARD_GUARDS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[3, 1], [3, 2], [3, 3], [3, 4], [3, 5], [3, 6], [3, 5], [3, 4], [3, 3], [3, 2]],
  [[5, 6], [5, 5], [5, 4], [5, 3], [5, 2], [5, 1], [5, 2], [5, 3], [5, 4], [5, 5]],
  [[1, 6], [1, 5], [1, 4], [1, 3], [1, 4], [1, 5]],
];

export const makeCourtyard = (): ProwlState =>
  buildProwl(parseProwl(COURTYARD_GRID, COURTYARD_GUARDS, 3));
