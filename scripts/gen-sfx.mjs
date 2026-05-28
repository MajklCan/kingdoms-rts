// Procedural SFX generator for Kingdoms RTS.
// Synthesizes game sound effects via DSP, writes WAV, then shells out to
// ffmpeg to produce OGG (libopus) + MP3 (libmp3lame) pairs.
//
// Run: node scripts/gen-sfx.mjs           (generate all)
//      node scripts/gen-sfx.mjs cannon    (generate one by id)
//
// Pure synthesis — no network, no login, deterministic. Tune voices below.

import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SR = 44100;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public/assets/audio/sfx');
const TMP_DIR = join(ROOT, '.sfx-tmp');

// ---------- DSP primitives (all return Float32 sample arrays, range ~[-1,1]) ----------

const seconds = (n) => Math.round(SR * n);

// Deterministic PRNG so regenerated noise is identical run-to-run.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buffer(durSec) {
  return new Float32Array(seconds(durSec));
}

// Exponential decay envelope: 1 → ~0 over the buffer, shaped by `k` (higher = snappier).
function decay(i, len, k = 5) {
  const t = i / len;
  return Math.exp(-k * t);
}

// Attack-decay envelope to avoid click on transient sounds.
function ad(i, len, attackFrac = 0.005, k = 5) {
  const t = i / len;
  const atk = t < attackFrac ? t / attackFrac : 1;
  return atk * Math.exp(-k * t);
}

// One-pole low-pass filter applied in place.
function lowpass(buf, cutoffHz) {
  const dt = 1 / SR;
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const alpha = dt / (rc + dt);
  let prev = 0;
  for (let i = 0; i < buf.length; i++) {
    prev = prev + alpha * (buf[i] - prev);
    buf[i] = prev;
  }
}

// One-pole high-pass filter applied in place.
function highpass(buf, cutoffHz) {
  const dt = 1 / SR;
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const alpha = rc / (rc + dt);
  let prevIn = 0, prevOut = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    prevOut = alpha * (prevOut + x - prevIn);
    prevIn = x;
    buf[i] = prevOut;
  }
}

function normalize(buf, peak = 0.95) {
  let max = 0;
  for (let i = 0; i < buf.length; i++) max = Math.max(max, Math.abs(buf[i]));
  if (max < 1e-6) return;
  const g = peak / max;
  for (let i = 0; i < buf.length; i++) buf[i] *= g;
}

// ---------- WAV writer (16-bit PCM mono) ----------

function writeWav(path, samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);          // PCM
  buf.writeUInt16LE(1, 22);          // mono
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);     // byte rate
  buf.writeUInt16LE(2, 32);          // block align
  buf.writeUInt16LE(16, 34);         // bits
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE((s * 32767) | 0, 44 + i * 2);
  }
  writeFileSync(path, buf);
}

// ---------- Voices: one synth fn per sound id ----------

function cannonBoom() {
  const dur = 0.9;
  const buf = buffer(dur);
  const len = buf.length;
  const rnd = mulberry32(1337);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    // Pitch-dropping body: 130Hz → 38Hz
    const f = 38 + 92 * Math.exp(-6 * (i / len));
    const body = Math.sin(2 * Math.PI * f * t);
    // Noise burst for the crack of the blast
    const noise = (rnd() * 2 - 1);
    const env = decay(i, len, 4.2);
    const noiseEnv = decay(i, len, 22); // crack fades fast
    buf[i] = body * env * 0.9 + noise * noiseEnv * 0.6;
  }
  lowpass(buf, 1800);
  normalize(buf, 0.97);
  return buf;
}

function chopWood() {
  const dur = 0.16;
  const buf = buffer(dur);
  const len = buf.length;
  const rnd = mulberry32(4242);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    // Sharp axe-impact transient (high noise click)
    const click = (rnd() * 2 - 1) * decay(i, len, 60);
    // Woody resonant body: fundamental + octave, damped fast
    const f0 = 220;
    const woodEnv = decay(i, len, 26);
    const wood =
      Math.sin(2 * Math.PI * f0 * t) * 0.7 +
      Math.sin(2 * Math.PI * f0 * 2 * t) * 0.3;
    buf[i] = click * 0.8 + wood * woodEnv * 0.7;
  }
  highpass(buf, 200);
  lowpass(buf, 5000);
  normalize(buf, 0.9);
  return buf;
}

const VOICES = {
  cannon_boom: cannonBoom,
  chop_wood: chopWood,
};

// ---------- Pipeline ----------

function ensureDirs() {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(TMP_DIR, { recursive: true });
}

function encode(id, samples) {
  const wav = join(TMP_DIR, `${id}.wav`);
  const ogg = join(OUT_DIR, `${id}.ogg`);
  const mp3 = join(OUT_DIR, `${id}.mp3`);
  writeWav(wav, samples);
  execFileSync('ffmpeg', ['-y', '-i', wav, '-c:a', 'libopus', '-b:a', '96k', ogg], { stdio: 'pipe' });
  execFileSync('ffmpeg', ['-y', '-i', wav, '-c:a', 'libmp3lame', '-qscale:a', '4', mp3], { stdio: 'pipe' });
  return { ogg, mp3, frames: samples.length, dur: (samples.length / SR).toFixed(2) };
}

function main() {
  ensureDirs();
  const only = process.argv[2];
  const ids = only ? Object.keys(VOICES).filter((k) => k.includes(only)) : Object.keys(VOICES);
  if (ids.length === 0) {
    console.error(`No voice matches "${only}". Available: ${Object.keys(VOICES).join(', ')}`);
    process.exit(1);
  }
  let ok = 0;
  try {
    for (const id of ids) {
      try {
        const samples = VOICES[id]();
        const r = encode(id, samples);
        ok++;
        console.log(`✓ ${id}  ${r.dur}s  → ${id}.ogg + ${id}.mp3`);
      } catch (err) {
        // One bad encode shouldn't abort the rest of the batch.
        console.error(`✗ ${id}: ${err.message}`);
      }
    }
  } finally {
    rmSync(TMP_DIR, { recursive: true, force: true });
  }
  console.log(`Done: ${ok}/${ids.length} generated.`);
  if (ok < ids.length) process.exit(1);
}

main();
