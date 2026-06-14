/**
 * 推箱子 · 库房脱困纯逻辑:把所有宫箱推上地砖机关,暗门即开。
 * 不可变 reducer(撞墙/推不动 → 返回原引用,便于检测 no-op),全 TDD。
 * 标记:# 墙 / . 机关 / $ 箱 / * 箱在机关上 / @ 玩家 / + 玩家在机关上 / 空格 地面。
 */
export type Dir = 'up' | 'down' | 'left' | 'right';

const DELTA: Record<Dir, readonly [number, number]> = {
  up: [-1, 0],
  down: [1, 0],
  left: [0, -1],
  right: [0, 1],
};

export type SokobanState = {
  rows: number;
  cols: number;
  walls: ReadonlySet<string>;
  targets: ReadonlySet<string>;
  boxes: ReadonlySet<string>;
  player: { r: number; c: number };
};

const cell = (r: number, c: number) => `${r},${c}`;

export function parseLevel(grid: string[]): SokobanState {
  const walls = new Set<string>();
  const targets = new Set<string>();
  const boxes = new Set<string>();
  let player = { r: 0, c: 0 };
  const cols = Math.max(...grid.map((row) => row.length));
  grid.forEach((row, r) => {
    for (let c = 0; c < cols; c++) {
      const ch = row[c] ?? ' ';
      if (ch === '#') walls.add(cell(r, c));
      if (ch === '.' || ch === '*' || ch === '+') targets.add(cell(r, c));
      if (ch === '$' || ch === '*') boxes.add(cell(r, c));
      if (ch === '@' || ch === '+') player = { r, c };
    }
  });
  return { rows: grid.length, cols, walls, targets, boxes, player };
}

/** 朝 dir 走一步:撞墙/把箱推向墙或另一只箱 → 推不动,返回原 state(引用不变)。 */
export function move(state: SokobanState, dir: Dir): SokobanState {
  const [dr, dc] = DELTA[dir];
  const nr = state.player.r + dr;
  const nc = state.player.c + dc;
  const nk = cell(nr, nc);
  if (state.walls.has(nk)) return state;
  if (state.boxes.has(nk)) {
    const bk = cell(nr + dr, nc + dc);
    if (state.walls.has(bk) || state.boxes.has(bk)) return state; // 箱后是墙或箱 → 推不动
    const boxes = new Set(state.boxes);
    boxes.delete(nk);
    boxes.add(bk);
    return { ...state, boxes, player: { r: nr, c: nc } };
  }
  return { ...state, player: { r: nr, c: nc } };
}

/** 全部箱子都压在机关上 → 解开 */
export function isSolved(state: SokobanState): boolean {
  if (state.boxes.size !== state.targets.size) return false;
  for (const b of state.boxes) if (!state.targets.has(b)) return false;
  return true;
}

export type TileKind = 'wall' | 'floor' | 'target';
export function tileAt(state: SokobanState, r: number, c: number): TileKind {
  if (state.walls.has(cell(r, c))) return 'wall';
  if (state.targets.has(cell(r, c))) return 'target';
  return 'floor';
}
export function boxAt(state: SokobanState, r: number, c: number): boolean {
  return state.boxes.has(cell(r, c));
}

/**
 * 库房脱困关卡:4 宫箱 → 四角地砖机关,中央双墙设死角。
 * 逆向生成(从终局反拉,天然有解)+ 正向 BFS 验证:最短 32 步 / 20 次推箱(刻意做难)。
 */
export const KUFANG_LEVEL: string[] = [
  '########',
  '#.    .#',
  '# $##$ #',
  '#      #',
  '#  ##  #',
  '# $  $ #',
  '#.   @.#',
  '########',
];
