import type { PixelGrid } from './types';

function assertRect(grid: PixelGrid, label: string): void {
  const w = grid[0]?.length ?? 0;
  for (const row of grid) {
    if (row.length !== w) {
      throw new Error(`pixel grid ${label} 行宽不一致: 期望 ${w},实际 ${row.length}(行「${row}」)`);
    }
  }
}

/**
 * 画布叠加:overlay 的非 '.' 格替换底图,后画覆盖前画。
 * 所有画布必须同尺寸——部件库笔误要在这里炸出来,不能静默错位。
 */
/**
 * 花纹只染在毛色格上(B/S/L → W 白斑 / K 深斑),身体轮廓外的花纹格忽略,
 * 这样同一张花纹模板适配四种体型不会"溢出"到背景。
 */
export function applyPattern(body: PixelGrid, pattern: PixelGrid): PixelGrid {
  assertRect(body, 'body');
  assertRect(pattern, 'pattern');
  if (pattern.length !== body.length || (pattern[0]?.length ?? 0) !== (body[0]?.length ?? 0)) {
    throw new Error('pixel pattern 尺寸与 body 不一致');
  }
  const COAT = new Set(['B', 'S', 'L']);
  return body.map((row, y) =>
    row
      .split('')
      .map((ch, x) => {
        const p = pattern[y][x];
        return p !== '.' && COAT.has(ch) ? p : ch;
      })
      .join(''),
  );
}

export function composeGrids(base: PixelGrid, ...overlays: PixelGrid[]): PixelGrid {
  assertRect(base, 'base');
  const h = base.length;
  const w = base[0]?.length ?? 0;
  const out = base.map((row) => row.split(''));
  overlays.forEach((overlay, i) => {
    assertRect(overlay, `overlay#${i}`);
    if (overlay.length !== h || (overlay[0]?.length ?? 0) !== w) {
      throw new Error(`pixel overlay#${i} 尺寸 ${overlay[0]?.length}x${overlay.length} ≠ base ${w}x${h}`);
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ch = overlay[y][x];
        if (ch !== '.') out[y][x] = ch;
      }
    }
  });
  return out.map((row) => row.join(''));
}
