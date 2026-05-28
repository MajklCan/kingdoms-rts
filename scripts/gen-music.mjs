// ElevenLabs Music generator — composes an original, owned background track.
//
// Run: node --env-file=.env scripts/gen-music.mjs [id]
//   id defaults to "theme". Output: public/assets/audio/music/<id>.ogg|.mp3
//
// Original generated music — no copyright entanglement (unlike ripping a track
// off YouTube). Swap the file later if a properly-licensed track is preferred.

import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public/assets/audio/music');
const TMP_DIR = join(ROOT, '.music-tmp');
const API_URL = 'https://api.elevenlabs.io/v1/music';

const PROMPT =
  'Medieval Bohemian orchestral ambient game music, calm but epic, warm strings, ' +
  'soft lute and flute, distant war drums, noble and a little melancholic, ' +
  'instrumental, seamless loop, steady tempo, no vocals';
const LENGTH_MS = 90000;

async function main() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error('Missing ELEVENLABS_API_KEY. Run with: node --env-file=.env scripts/gen-music.mjs');
    process.exit(1);
  }
  const id = process.argv[2] || 'theme';
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(TMP_DIR, { recursive: true });

  console.log(`Composing "${id}" (${LENGTH_MS / 1000}s)... this can take a minute.`);
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: PROMPT, music_length_ms: LENGTH_MS }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    console.error(`API ${res.status} ${res.statusText}: ${txt.slice(0, 400)}`);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) {
    console.error(`Suspiciously tiny audio (${buf.length} bytes).`);
    process.exit(1);
  }

  const src = join(TMP_DIR, `${id}.src.mp3`);
  const outMp3 = join(OUT_DIR, `${id}.mp3`);
  const outOgg = join(OUT_DIR, `${id}.ogg`);
  writeFileSync(src, buf);
  // Normalize to a quiet bed level; music plays under SFX.
  const filter = 'loudnorm=I=-20:TP=-2:LRA=11';
  execFileSync('ffmpeg', ['-y', '-i', src, '-af', filter, '-c:a', 'libmp3lame', '-q:a', '4', outMp3], { stdio: 'pipe' });
  execFileSync('ffmpeg', ['-y', '-i', src, '-af', filter, '-c:a', 'libopus', '-b:a', '96k', outOgg], { stdio: 'pipe' });
  rmSync(TMP_DIR, { recursive: true, force: true });
  console.log(`✓ ${id}  → music/${id}.ogg + music/${id}.mp3`);
}

main();
