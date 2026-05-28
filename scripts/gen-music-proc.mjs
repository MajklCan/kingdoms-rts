// Procedural background music generator — synthesizes a seamless, owned ambient
// loop via DSP. Free of any copyright entanglement and needs no paid API.
//
// Run: node scripts/gen-music-proc.mjs [id]
//   id defaults to "theme". Output: public/assets/audio/music/<id>.ogg|.mp3
//
// A slow minor-key chord pad (i–VI–III–VII) with a soft sub pulse. Each chord
// segment swells in and out, so segment boundaries sit at silence — the loop is
// click-free. Length is an integer number of bars so it repeats seamlessly.

import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SR = 44100;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public/assets/audio/music');
const TMP_DIR = join(ROOT, '.music-tmp');

// --- Musical material: A natural-minor pad progression, 6s per chord. ---
const CHORD_SECONDS = 6;
// Frequencies (Hz) for each chord's voices. i (Am), VI (F), III (C), VII (G).
const PROGRESSION = [
  [110.0, 130.81, 164.81, 220.0], // Am:  A2 C3 E3 A3
  [87.31, 130.81, 174.61, 220.0], // F:   F2 C3 F3 A3
  [130.81, 164.81, 196.0, 261.63], // C:  C3 E3 G3 C4
  [98.0, 146.83, 196.0, 246.94], // G:   G2 D3 G3 B3
];

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

function normalize(buf, peak) {
  let max = 0;
  for (let i = 0; i < buf.length; i++) max = Math.max(max, Math.abs(buf[i]));
  if (max < 1e-6) return;
  const g = peak / max;
  for (let i = 0; i < buf.length; i++) buf[i] *= g;
}

// Swell envelope: slow attack, sustain, slow release across one chord segment.
function swell(i, len) {
  const t = i / len;
  const a = 0.25; // attack fraction
  const r = 0.3; // release fraction
  if (t < a) return t / a;
  if (t > 1 - r) return (1 - t) / r;
  return 1;
}

function synth() {
  const segLen = Math.round(SR * CHORD_SECONDS);
  const total = segLen * PROGRESSION.length;
  const buf = new Float32Array(total);
  const rnd = mulberry32(20260528);

  for (let c = 0; c < PROGRESSION.length; c++) {
    const chord = PROGRESSION[c];
    const base = c * segLen;
    for (let i = 0; i < segLen; i++) {
      const t = i / SR;
      const env = swell(i, segLen);
      let s = 0;
      for (let v = 0; v < chord.length; v++) {
        const f = chord[v];
        // Slight detune + slow vibrato for a warm, living pad.
        const detune = 1 + (v - 1.5) * 0.0015;
        const vib = 1 + 0.002 * Math.sin(2 * Math.PI * 0.18 * t + v);
        const amp = v === 0 ? 0.5 : 0.32; // bass voice a touch louder
        s += Math.sin(2 * Math.PI * f * detune * vib * t) * amp;
      }
      // Soft sub pulse every 1.5s (slow heartbeat), quiet.
      const beat = (t % 1.5) / 1.5;
      const pulse = Math.sin(2 * Math.PI * 55 * t) * Math.exp(-12 * beat) * 0.25;
      // A whisper of noise for air, heavily attenuated.
      const air = (rnd() * 2 - 1) * 0.01;
      buf[base + i] = (s * 0.25 + pulse + air) * env;
    }
  }
  lowpass(buf, 2600);
  normalize(buf, 0.9);
  return buf;
}

function writeWav(path, samples) {
  const n = samples.length;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    b.writeInt16LE((s * 32767) | 0, 44 + i * 2);
  }
  writeFileSync(path, b);
}

function main() {
  const id = process.argv[2] || 'theme';
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(TMP_DIR, { recursive: true });
  const wav = join(TMP_DIR, `${id}.wav`);
  const outMp3 = join(OUT_DIR, `${id}.mp3`);
  const outOgg = join(OUT_DIR, `${id}.ogg`);
  const samples = synth();
  writeWav(wav, samples);
  // Quiet bed level (music plays under SFX).
  const filter = 'loudnorm=I=-20:TP=-2:LRA=11';
  execFileSync('ffmpeg', ['-y', '-i', wav, '-af', filter, '-c:a', 'libmp3lame', '-q:a', '4', outMp3], { stdio: 'pipe' });
  execFileSync('ffmpeg', ['-y', '-i', wav, '-af', filter, '-c:a', 'libopus', '-b:a', '96k', outOgg], { stdio: 'pipe' });
  rmSync(TMP_DIR, { recursive: true, force: true });
  console.log(`✓ ${id}  → music/${id}.ogg + music/${id}.mp3  (${(samples.length / SR).toFixed(0)}s loop)`);
}

main();
