#!/usr/bin/env node
/**
 * Bow Wow 提示音合成:零依赖生成 10 种差异化「汪」WAV(16-bit PCM 单声道)。
 * 每种对应一种狗狗气质,在音高/音节数/时长/噪声/颤音上有明显区别。
 * 有真实素材可直接替换同名文件。
 *   node scripts/generate-bark-sounds.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'assets', 'sounds');
const SAMPLE_RATE = 22050;
const VARIANTS = 10;

/** 确定性伪随机 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 单个音节渲染
 * @param {Float32Array} samples 写入目标
 * @param {number} start 起始采样位置
 * @param {object} opts
 *   durSec      - 时长
 *   baseFreq    - 基频
 *   freqEnvFn   - 音高包络函数(p)->倍率
 *   ampEnvFn    - 振幅包络函数(p)->0..1
 *   harmonics   - 谐波数
 *   noiseAmt    - 噪声强度
 *   vibRate     - 颤音速率(Hz), 0=无
 *   vibDepth    - 颤音深度(比例)
 *   rng
 */
function renderSyllable(samples, start, opts) {
  const { durSec, baseFreq, freqEnv, ampEnv, harmonics = 6,
          noiseAmt = 0.3, vibRate = 0, vibDepth = 0, rng } = opts;
  const n = Math.floor(durSec * SAMPLE_RATE);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const p = i / n;
    const vib = vibRate > 0 ? (1 + vibDepth * Math.sin(2 * Math.PI * vibRate * t)) : 1;
    const freq = baseFreq * freqEnv(p) * vib;
    const dphase = (2 * Math.PI * freq) / SAMPLE_RATE;
    phase += dphase;
    let s = 0;
    for (let k = 1; k <= harmonics; k++) s += Math.sin(phase * k) / k;
    s /= Math.sqrt(harmonics) * 0.9;
    const noise = (rng() * 2 - 1) * Math.exp(-18 * p) * noiseAmt;
    const v = (s + noise) * ampEnv(p) * 0.75;
    const idx = start + i;
    if (idx < samples.length) samples[idx] += v;
  }
  return n;
}

/**
 * 生成一个变体的完整音效样本
 * @param {number} v variant index 0..9
 */
function renderBark(v) {
  const rng = mulberry32(2000 + v * 13);

  // 每种变体独立的参数描述
  const presets = [
    // 0: 大型犬低沉单吠(金毛 / 拉布拉多气质)
    {
      label: '低沉单吠',
      syllables: [{ freq: 115, dur: 0.32, gap: 0 }],
      totalSec: 0.55,
      freqEnv: (p) => 0.9 + 0.28 * Math.sin(Math.PI * Math.min(1, p * 1.1)),
      ampEnv: (p) => Math.min(1, p / 0.04) * Math.exp(-2.5 * p),
      harmonics: 8,
      noise: 0.25,
      vib: 0,
    },
    // 1: 中型犬标准双吠(边牧 / 萨摩耶)
    {
      label: '中型双吠',
      syllables: [{ freq: 260, dur: 0.16, gap: 0.06 }, { freq: 285, dur: 0.14, gap: 0 }],
      totalSec: 0.55,
      freqEnv: (p) => 0.88 + 0.44 * Math.sin(Math.PI * Math.min(1, p * 1.15)),
      ampEnv: (p) => Math.min(1, p / 0.05) * Math.exp(-3.5 * p),
      harmonics: 6,
      noise: 0.28,
      vib: 0,
    },
    // 2: 小型犬高亢三连叫(泰迪 / 比熊)
    {
      label: '高亢三叫',
      syllables: [
        { freq: 420, dur: 0.10, gap: 0.04 },
        { freq: 440, dur: 0.09, gap: 0.04 },
        { freq: 460, dur: 0.09, gap: 0 },
      ],
      totalSec: 0.60,
      freqEnv: (p) => 0.92 + 0.35 * Math.sin(Math.PI * Math.min(1, p * 1.2)),
      ampEnv: (p) => Math.min(1, p / 0.03) * Math.exp(-4.5 * p),
      harmonics: 5,
      noise: 0.20,
      vib: 0,
    },
    // 3: 哈士奇拖腔(带颤音,尾音下沉)
    {
      label: '哈士奇拖腔',
      syllables: [{ freq: 195, dur: 0.38, gap: 0 }],
      totalSec: 0.65,
      freqEnv: (p) => 1.0 + 0.15 * Math.sin(Math.PI * p * 0.8) - 0.25 * p,
      ampEnv: (p) => Math.min(1, p / 0.05) * Math.pow(1 - p, 0.6),
      harmonics: 7,
      noise: 0.18,
      vib: 5.5,
      vibDepth: 0.04,
    },
    // 4: 吉娃娃急促高叫(极高频,四连快)
    {
      label: '吉娃娃急叫',
      syllables: [
        { freq: 580, dur: 0.07, gap: 0.03 },
        { freq: 600, dur: 0.07, gap: 0.03 },
        { freq: 590, dur: 0.07, gap: 0.03 },
        { freq: 610, dur: 0.06, gap: 0 },
      ],
      totalSec: 0.55,
      freqEnv: (p) => 0.95 + 0.2 * Math.sin(Math.PI * p * 1.1),
      ampEnv: (p) => Math.min(1, p / 0.02) * Math.exp(-5 * p),
      harmonics: 4,
      noise: 0.15,
      vib: 0,
    },
    // 5: 老狗沙哑单吠(低频+大量噪声)
    {
      label: '老狗沙哑',
      syllables: [{ freq: 145, dur: 0.28, gap: 0 }],
      totalSec: 0.50,
      freqEnv: (p) => 0.85 + 0.3 * Math.sin(Math.PI * Math.min(1, p * 1.0)),
      ampEnv: (p) => Math.min(1, p / 0.08) * Math.exp(-2.8 * p),
      harmonics: 5,
      noise: 0.65,
      vib: 2.5,
      vibDepth: 0.025,
    },
    // 6: 柯基兴奋三叫(中高频,节奏感强)
    {
      label: '柯基兴奋',
      syllables: [
        { freq: 335, dur: 0.12, gap: 0.05 },
        { freq: 350, dur: 0.12, gap: 0.05 },
        { freq: 365, dur: 0.11, gap: 0 },
      ],
      totalSec: 0.65,
      freqEnv: (p) => 0.9 + 0.42 * Math.sin(Math.PI * Math.min(1, p * 1.1)),
      ampEnv: (p) => Math.min(1, p / 0.04) * (0.4 + 0.6 * Math.exp(-3 * p)),
      harmonics: 6,
      noise: 0.22,
      vib: 0,
    },
    // 7: 贵宾软糯双叫(中高,温柔衰减)
    {
      label: '贵宾软糯',
      syllables: [{ freq: 390, dur: 0.18, gap: 0.07 }, { freq: 405, dur: 0.15, gap: 0 }],
      totalSec: 0.58,
      freqEnv: (p) => 0.9 + 0.3 * Math.sin(Math.PI * p * 0.9),
      ampEnv: (p) => Math.min(1, p / 0.07) * Math.exp(-3.0 * p),
      harmonics: 5,
      noise: 0.12,
      vib: 3.5,
      vibDepth: 0.02,
    },
    // 8: 秋田/柴犬一声庄重(中低,干净利落)
    {
      label: '庄重单吠',
      syllables: [{ freq: 230, dur: 0.22, gap: 0 }],
      totalSec: 0.45,
      freqEnv: (p) => 1.0 + 0.18 * Math.exp(-4 * p),
      ampEnv: (p) => Math.min(1, p / 0.03) * Math.exp(-4.5 * p),
      harmonics: 7,
      noise: 0.10,
      vib: 0,
    },
    // 9: 中大型犬欢快双叫(明快,上扬收尾)
    {
      label: '欢快双叫',
      syllables: [{ freq: 290, dur: 0.15, gap: 0.07 }, { freq: 310, dur: 0.17, gap: 0 }],
      totalSec: 0.58,
      freqEnv: (p) => 0.85 + 0.55 * Math.sin(Math.PI * Math.min(1, p * 1.25)),
      ampEnv: (p) => Math.min(1, p / 0.04) * (0.5 + 0.5 * Math.cos(Math.PI * p * 0.5)) * Math.exp(-2.0 * p),
      harmonics: 6,
      noise: 0.20,
      vib: 0,
    },
  ];

  const preset = presets[v];
  const total = Math.floor((preset.totalSec ?? 0.60) * SAMPLE_RATE);
  const samples = new Float32Array(total);

  let cur = Math.floor(0.01 * SAMPLE_RATE);
  for (const syl of preset.syllables) {
    cur += renderSyllable(samples, cur, {
      durSec: syl.dur,
      baseFreq: syl.freq,
      freqEnv: preset.freqEnv,
      ampEnv: preset.ampEnv,
      harmonics: preset.harmonics ?? 6,
      noiseAmt: preset.noise ?? 0.3,
      vibRate: preset.vib ?? 0,
      vibDepth: preset.vibDepth ?? 0,
      rng,
    });
    cur += Math.floor((syl.gap ?? 0) * SAMPLE_RATE);
  }
  return samples;
}

/** float[-1,1] → 16-bit PCM WAV */
function encodeWav(samples) {
  const dataLen = samples.length * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < samples.length; i++) {
    const c = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(c * 32767), 44 + i * 2);
  }
  return buf;
}

for (let v = 0; v < VARIANTS; v++) {
  const wav = encodeWav(renderBark(v));
  const p = join(OUT_DIR, `bark-${v}.wav`);
  writeFileSync(p, wav);
  console.log(`✓ bark-${v}.wav  (${wav.length} bytes)`);
}
console.log(`完成。共 ${VARIANTS} 种狗叫音效。`);
