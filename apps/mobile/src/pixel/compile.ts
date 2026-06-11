import type { CompiledLayer, CompiledSprite, PixelGrid, Run } from './types';

/** 微膨胀量:消灭相邻 path 间的抗锯齿发丝缝(react-native-svg 不支持 shape-rendering) */
const BLEED = 0.02;

/**
 * 字符画布 → 同色行程合并 → 分色层。
 * 每个角色最终 ≈ 1 个 Svg + 每色一条 Path,同屏多角色也只有几十个原生节点。
 */
export function compileSprite(grid: PixelGrid, roleColors: Record<string, string>): CompiledSprite {
  const size = Math.max(grid.length, grid[0]?.length ?? 0);
  const byColor = new Map<string, Run[]>();
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y];
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      if (ch === '.') {
        x++;
        continue;
      }
      const color = roleColors[ch];
      if (!color) throw new Error(`pixel 画布第 ${y} 行出现未知角色字符「${ch}」`);
      let w = 1;
      while (x + w < row.length && row[x + w] === ch) w++;
      let runs = byColor.get(color);
      if (!runs) {
        runs = [];
        byColor.set(color, runs);
      }
      runs.push({ x, y, w });
      x += w;
    }
  }
  const layers: CompiledLayer[] = [...byColor.entries()].map(([color, runs]) => ({ color, runs }));
  return { size, layers };
}

function fmt(n: number): string {
  // 0.98 / 3.04 这类两位小数;避免 path 里出现超长浮点
  return Number(n.toFixed(2)).toString();
}

/** 行程列表 → path d(每个 run 一个微膨胀矩形) */
export function pathForRuns(runs: Run[]): string {
  return runs
    .map((r) => {
      const x = fmt(r.x - BLEED);
      const y = fmt(r.y - BLEED);
      const w = fmt(r.w + BLEED * 2);
      const h = fmt(1 + BLEED * 2);
      return `M${x} ${y}h${w}v${h}h-${w}Z`;
    })
    .join('');
}
