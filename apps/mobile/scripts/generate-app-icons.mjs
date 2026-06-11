#!/usr/bin/env node
/**
 * Bow wow know 应用图标生成:32×32 像素网格 → 整数倍放大 → PNG。
 * 图案:正面狗狗张大嘴「啊呜」大吃一口(用户指定),与 app 内像素狗同一调色板。
 * 零依赖(node:zlib + 手写 CRC32);改图改下面的网格后重跑:
 *   node scripts/generate-app-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// 与 src/pixel/palette.ts 同源的色值
const COLORS = {
  B: [0xd9, 0x97, 0x5d, 255], // malt base
  S: [0xb5, 0x71, 0x3b, 255], // shade
  L: [0xef, 0xd3, 0xae, 255], // light
  I: [0x3d, 0x32, 0x29, 255], // ink
  N: [0x2a, 0x23, 0x1c, 255], // 口腔/鼻
  T: [0xe8, 0x83, 0x7e, 255], // 舌
  W: [0xff, 0xff, 0xff, 255], // 牙
};
const CREAM = [0xf4, 0xef, 0xe4, 255];

// 正面大嘴狗 32×32:立耳、弯月笑眼、下半张大嘴(牙+舌)
const GRID = [
  '................................',
  '....III..................III....',
  '...IBBBI................IBBBI...',
  '...IBSBBI..............IBBSBI...',
  '...IBSBBBIIIIIIIIIIIIIIBBBSBI...',
  '..IBBBBBBBLLLLLLLLLLLLBBBBBBBI..',
  '..IBBBBBBBBBBBBBBBBBBBBBBBBBBI..',
  '..IBBBBBBBBBBBBBBBBBBBBBBBBBBI..',
  '..IBBBBBBBBBBBBBBBBBBBBBBBBBBI..',
  '..IBBBBBBBBBBBBBBBBBBBBBBBBBBI..',
  '..IBBBBBBIIIBBBBBBBBIIIBBBBBBI..',
  '..IBBBBBIBBBIBBBBBBIBBBIBBBBBI..',
  '..IBBBBBBBBBBBBBBBBBBBBBBBBBBI..',
  '..IBBBBBBBBBBBBNNBBBBBBBBBBBBI..',
  '..IBBBBBBBBBBBBNNBBBBBBBBBBBBI..',
  '..IBBBIIIIIIIIIIIIIIIIIIIIBBBI..',
  '..IBBIWWNNWWNNWWNNWWNNWWNNIBBI..',
  '..IBBINNNNNNNNNNNNNNNNNNNNIBBI..',
  '..IBBINNNNNNNNNNNNNNNNNNNNIBBI..',
  '..IBBINNNTTTTTTTTTTTTTTNNNIBBI..',
  '..IBBINNTTTTTTTTTTTTTTTTNNIBBI..',
  '..IBBINNTTTTTTTTTTTTTTTTNNIBBI..',
  '..IBBINNTTTTTTTTTTTTTTTTNNIBBI..',
  '..IBBINNTTTTTTTTTTTTTTTTNNIBBI..',
  '..IBBINNTTTTTTTTTTTTTTTTNNIBBI..',
  '..IBBBIITTTTTTTTTTTTTTTTIIBBBI..',
  '..IBBBBIIIIIIIIIIIIIIIIIIBBBBI..',
  '..IBBBBBBBBBBBBBBBBBBBBBBBBBBI..',
  '...ISBBBBBBBBBBBBBBBBBBBBBBSI...',
  '....IIIIIIIIIIIIIIIIIIIIIIII....',
  '................................',
  '................................',
];

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

/** 网格按 scale 放大,绘制在 canvas×canvas 画布中央;bg=null 表示透明 */
function renderPng(canvas, scale, bg) {
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
  return encodePng(canvas, canvas, rgba);
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
console.log('完成。app.json 的 splash/adaptiveIcon backgroundColor 建议 #F4EFE4。');
