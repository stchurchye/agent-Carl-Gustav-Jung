#!/usr/bin/env node
/**
 * Bow Wow 提示音合成:零依赖生成 N 段「汪汪」狗叫 WAV(16-bit PCM 单声道)。
 * 与性格无关——运行时按「说话那只狗的身份」哈希取一种(见 lib/soundCues.ts)。
 * 合成是粗略近似(双音节 woof:基频做先升后降的音高包络 + 谐波 + 起音噪声 + 振幅包络),
 * 听感像「汪!汪!」的提示音,不追求真实犬吠;有真实素材可直接替换同名文件。
 *   node scripts/generate-bark-sounds.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'assets', 'sounds');
const SAMPLE_RATE = 22050;
const VARIANTS = 6;

/** 确定性伪随机(避免 Math.random,保证每次生成一致、可入库 diff) */
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

/** 单个 woof 音节,写入 float 缓冲 samples 的 [start..) 区间 */
function renderSyllable(samples, start, durSec, baseFreq, rng) {
  const n = Math.floor(durSec * SAMPLE_RATE);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const p = i / n; // 0..1 音节进度
    // 音高包络:快速上扬到峰值再回落(「wu→of」),整体在 baseFreq 附近
    const pitch = baseFreq * (0.85 + 0.5 * Math.sin(Math.PI * Math.min(1, p * 1.15)));
    // 振幅包络:极快起音 + 指数衰减
    const attack = Math.min(1, p / 0.06);
    const env = attack * Math.exp(-3.2 * p);
    // 谐波叠加(浊音感)
    let s = 0;
    const phase = 2 * Math.PI * pitch * t;
    for (let k = 1; k <= 6; k++) s += Math.sin(phase * k) / k;
    s /= 1.6;
    // 起音处叠一点噪声做「咬字」
    const noise = (rng() * 2 - 1) * Math.exp(-22 * p) * 0.5;
    const v = (s + noise) * env * 0.7;
    const idx = start + i;
    if (idx < samples.length) samples[idx] += v;
  }
  return n;
}

/** 一段「汪!汪!」= 两个音节,第二个略高 */
function renderBark(variant) {
  const rng = mulberry32(1000 + variant * 7);
  const baseFreq = 210 + variant * 52; // 各变体不同音色
  const total = Math.floor(0.5 * SAMPLE_RATE);
  const samples = new Float32Array(total);
  const gap = Math.floor(0.07 * SAMPLE_RATE);
  let cur = Math.floor(0.01 * SAMPLE_RATE);
  cur += renderSyllable(samples, cur, 0.17, baseFreq, rng) + gap;
  renderSyllable(samples, cur, 0.15, baseFreq * 1.12, rng);
  return samples;
}

/** float[-1,1] → 16-bit PCM WAV Buffer */
function encodeWav(samples) {
  const dataLen = samples.length * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
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
  console.log(`✓ bark-${v}.wav (${wav.length} bytes)`);
}
console.log(`完成。共 ${VARIANTS} 段狗叫;运行时按狗身份哈希取一种(与性格无关)。`);
