#!/usr/bin/env node
/**
 * Bow Wow Know 应用图标生成:像素网格 → 整数倍放大 → PNG。
 * 图案:用户参照图(灰度像素图)按方式2 重画,8×8 源 ×4 放大到 32×32。
 * 零依赖(node:zlib + 手写 CRC32);改图改下面的 SRC 网格后重跑:
 *   node scripts/generate-app-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// 灰度图标调色板(用户参照图量化:'.'=背景,L 浅灰 / M 中灰 / D 深灰)
const COLORS = {
  L: [0xd6, 0xd4, 0xce, 255], // 浅灰
  M: [0xb8, 0xb6, 0xb0, 255], // 中灰
  D: [0x8a, 0x88, 0x84, 255], // 深灰
};
const CREAM = [0xf5, 0xf4, 0xf1, 255]; // 近白底(对齐参照图背景)

// 用户参照图(方式2 像素重画):8×8 源量化,×4 放大到 32×32
const SRC = [
  '........',
  '...D.DD.',
  '...MMDD.',
  '..L.L.M.',
  '..L.L...',
  '..D.....',
  '........',
  '........',
];
// 每个源格放大 4×4,沿用下方管线的 32×32 网格契约
const GRID = SRC.flatMap((row) => {
  const wide = [...row].map((ch) => ch.repeat(4)).join('');
  return [wide, wide, wide, wide];
});

// SRC 字符校验:'.'=背景,其余必须在 COLORS 里,否则 renderRgba 会静默漏画该格(typo 防呆)
for (const row of SRC) {
  for (const ch of row) {
    if (ch !== '.' && !COLORS[ch]) throw new Error(`SRC 含未知字符 '${ch}'(需为 '.' 或 ${Object.keys(COLORS).join('/')})`);
  }
}

for (const row of GRID) {
  if (row.length !== 32) throw new Error(`行宽 ${row.length} ≠ 32: ${row}`);
}
if (GRID.length !== 32) throw new Error(`行数 ${GRID.length} ≠ 32`);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter: none
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 网格按 scale 放大,绘制在 canvas×canvas 画布中央居中;bg=null 表示透明。返回 RGBA 缓冲。 */
function renderRgba(canvas, scale, bg) {
  const rgba = Buffer.alloc(canvas * canvas * 4);
  if (bg) {
    for (let i = 0; i < canvas * canvas; i++) rgba.set(bg, i * 4);
  }
  const art = 32 * scale;
  const offset = Math.floor((canvas - art) / 2);
  for (let gy = 0; gy < 32; gy++) {
    for (let gx = 0; gx < 32; gx++) {
      const color = COLORS[GRID[gy][gx]];
      if (!color) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const x = offset + gx * scale + dx;
          const y = offset + gy * scale + dy;
          rgba.set(color, (y * canvas + x) * 4);
        }
      }
    }
  }
  return rgba;
}

function renderPng(canvas, scale, bg) {
  return encodePng(canvas, canvas, renderRgba(canvas, scale, bg));
}

/**
 * 无 alpha 的 RGB PNG(color type 2):iOS AppIcon 必须不带 alpha 通道,
 * 否则即便全不透明也会被拒/发黑。透明像素压到 CREAM 实色底。
 */
function encodePngRgbFlat(canvas, scale) {
  const rgba = renderRgba(canvas, scale, CREAM);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(canvas, 0);
  ihdr.writeUInt32BE(canvas, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB(无 alpha)
  const raw = Buffer.alloc(canvas * (1 + canvas * 3));
  for (let y = 0; y < canvas; y++) {
    const rowStart = y * (1 + canvas * 3);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < canvas; x++) {
      const si = (y * canvas + x) * 4;
      const a = rgba[si + 3] / 255;
      const di = rowStart + 1 + x * 3;
      raw[di] = Math.round(rgba[si] * a + CREAM[0] * (1 - a));
      raw[di + 1] = Math.round(rgba[si + 1] * a + CREAM[1] * (1 - a));
      raw[di + 2] = Math.round(rgba[si + 2] * a + CREAM[2] * (1 - a));
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = (name, buf) => {
  const p = join(ROOT, 'assets', name);
  writeFileSync(p, buf);
  console.log(`✓ ${name} (${buf.length} bytes)`);
};

out('icon.png', renderPng(1024, 32, CREAM));
// Android 自适应前景:留安全区,缩到 ~66% 居中,透明底(底色在 app.json backgroundColor)
out('adaptive-icon.png', renderPng(1024, 21, null));
out('splash-icon.png', renderPng(512, 14, null));
out('favicon.png', renderPng(64, 2, CREAM));

// iOS prebuild 产物(ios/ 在 gitignore):若存在则直接刷新 AppIcon,免跑整套 prebuild 冲掉签名。
const iosIcon = join(
  ROOT,
  'ios/agentCarlGustavJung/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png',
);
if (existsSync(iosIcon)) {
  const buf = encodePngRgbFlat(1024, 32);
  writeFileSync(iosIcon, buf);
  console.log(`✓ ios AppIcon 1024 (无 alpha, ${buf.length} bytes)`);
}

console.log('完成。app.json 的 splash/adaptiveIcon backgroundColor 建议 #F4EFE4。');
