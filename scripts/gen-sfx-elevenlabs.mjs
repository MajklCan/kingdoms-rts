// ElevenLabs SFX batch generator for Kingdoms RTS.
//
// Calls the ElevenLabs sound-effects API for each prompt in SOUNDS, saves the
// returned MP3, then shells out to ffmpeg to produce an OGG (libopus) pair.
// Fully headless — no browser, no clicking.
//
// Run (key loaded from .env via Node's native --env-file):
//   node --env-file=.env scripts/gen-sfx-elevenlabs.mjs            generate all missing
//   node --env-file=.env scripts/gen-sfx-elevenlabs.mjs chop       generate ids matching "chop"
//   node --env-file=.env scripts/gen-sfx-elevenlabs.mjs --force    regenerate all (burns credits)
//
// Skips ids whose .ogg already exists unless --force is passed — reruns don't
// re-spend credits. Always picks the model's single best take (the API returns
// one clip per call). loop/duration are tuned per sound below.

import { writeFileSync, mkdirSync, existsSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public/assets/audio/sfx');
const TMP_DIR = join(ROOT, '.sfx-tmp');
const API_URL = 'https://api.elevenlabs.io/v1/sound-generation';

// Each sound: id (filename + key suffix), text prompt, duration in seconds,
// prompt_influence (0..1, higher = stricter adherence to prompt), loop flag.
// All game SFX here are one-shots (loop:false). Durations kept tight so audio
// fires crisply on the triggering event.
const SOUNDS = [
  // --- Combat (fire events come from world.combatEvents) ---
  { id: 'sword_clash',    text: 'Two medieval swords clashing, single sharp metallic clang with a short ring, close-up, dry, no music', dur: 0.8, infl: 0.4 },
  { id: 'bow_shot',       text: 'Single arrow flying fast through the air, sharp whistling whoosh as it cuts past, light feathered fletching swish, quick and high-pitched, ends with faint thud, NO bass, no rumble, no boom, no music', dur: 0.7, infl: 0.6 },
  { id: 'gun_shot',       text: 'Single loud musket gunshot firing, sharp punchy BANG with a hard crack and snappy gunpowder blast, explosive percussive shot, aggressive and clear, short tail, no music', dur: 0.8, infl: 0.55 },
  { id: 'cannon_fire',    text: 'Heavy iron cannon firing, deep booming blast with low rumble, black powder artillery, no music', dur: 1.4, infl: 0.4 },
  { id: 'explosion',      text: 'Cannonball impact explosion, deep boom with debris and rubble, building hit, no music', dur: 1.5, infl: 0.4 },
  { id: 'unit_death',     text: 'Short male soldier death grunt, pained fall, medieval battlefield, dry, no music', dur: 0.7, infl: 0.3 },

  // --- Economy (gather cues from sim) ---
  { id: 'chop_wood',      text: 'Single axe blade biting into wood, sharp crisp high-pitched chop, dry crack and splinter of timber, light hatchet thwack, NO bass, no deep thud, no rumble, no boom, no music', dur: 0.5, infl: 0.6 },
  { id: 'mine_stone',     text: 'Pickaxe striking stone and ore, sharp rocky clink with small debris, close-up, no music', dur: 0.6, infl: 0.4 },

  // --- Building / production lifecycle (cues from sim) ---
  { id: 'build_complete', text: 'Construction finished, satisfying wooden thud and short bright confirmation chime, medieval, no music', dur: 1.0, infl: 0.3 },
  { id: 'unit_ready',     text: 'Short bright medieval horn fanfare, a new soldier is ready, two quick notes, no music', dur: 1.0, infl: 0.3 },
  { id: 'place_building', text: 'Placing a wooden building foundation, heavy thud with creak of timber, close-up, no music', dur: 0.6, infl: 0.4 },

  // --- Age up ---
  { id: 'age_up',         text: 'Triumphant medieval fanfare, brass and choir swell announcing a new age, short and grand, no music bed', dur: 2.2, infl: 0.3 },

  // --- UI ---
  { id: 'ui_click',       text: 'Soft wooden UI button click, single short tap, clean, no music', dur: 0.5, infl: 0.5 },
  { id: 'ui_hover',       text: 'Very subtle soft UI hover tick, tiny short blip, quiet, clean, no music', dur: 0.5, infl: 0.5 },
  { id: 'unit_select',    text: 'Short crisp selection blip for selecting a unit, soft metallic tick, clean, no music', dur: 0.5, infl: 0.5 },
  { id: 'command_move',   text: 'Short confident command acknowledgement tone, soft positive blip, clean UI, no music', dur: 0.5, infl: 0.5 },
  { id: 'error',          text: 'Short low negative error buzz, invalid action denied, soft dull thud, clean UI, no music', dur: 0.5, infl: 0.5 },

  // --- Alert (under attack) ---
  { id: 'alert',          text: 'Urgent medieval town alarm bell ringing fast, a large bronze church bell clanging repeatedly as a warning, danger is near, clear metallic tolls, no music', dur: 1.6, infl: 0.45 },
];

function ensureDirs() {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(TMP_DIR, { recursive: true });
}

async function generateOne(s, apiKey) {
  const body = {
    text: s.text,
    duration_seconds: s.dur,
    prompt_influence: s.infl,
    loop: s.loop ?? false,
  };
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`API ${res.status} ${res.statusText} for "${s.id}": ${txt.slice(0, 300)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 200) throw new Error(`Suspiciously tiny audio for "${s.id}" (${buf.length} bytes)`);
  return buf;
}

// Gentle: only trims near-pure digital silence (-60dB), keeps quiet content.
const TRIM_FILTER =
  'silenceremove=start_periods=1:start_threshold=-60dB:start_silence=0.03,areverse,silenceremove=start_periods=1:start_threshold=-60dB:start_silence=0.08,areverse,loudnorm=I=-16:TP=-1.5:LRA=11';
const NORM_ONLY = 'loudnorm=I=-16:TP=-1.5:LRA=11';

// Encode to MONO (-ac 1): the API sometimes returns asymmetric stereo (content
// weighted to one channel), which made spatial-panned SFX play in only one ear.
// Mono + the render layer's pan = correct spatialization.
function ffmpegEncode(srcMp3, outMp3, outOgg, filter) {
  execFileSync('ffmpeg', ['-y', '-i', srcMp3, '-af', filter, '-ac', '1', '-c:a', 'libmp3lame', '-q:a', '4', outMp3], { stdio: 'pipe' });
  execFileSync('ffmpeg', ['-y', '-i', srcMp3, '-af', filter, '-ac', '1', '-c:a', 'libopus', '-b:a', '96k', outOgg], { stdio: 'pipe' });
}

function encode(id, mp3Buf) {
  const srcMp3 = join(TMP_DIR, `${id}.src.mp3`);
  const outMp3 = join(OUT_DIR, `${id}.mp3`);
  const outOgg = join(OUT_DIR, `${id}.ogg`);
  writeFileSync(srcMp3, mp3Buf);
  ffmpegEncode(srcMp3, outMp3, outOgg, TRIM_FILTER);
  // Fallback: if trimming produced a near-empty file (quiet sound mis-detected
  // as silence), re-encode with loudness normalization only.
  if (statSync(outMp3).size < 1500) {
    ffmpegEncode(srcMp3, outMp3, outOgg, NORM_ONLY);
  }
}

async function main() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error('Missing ELEVENLABS_API_KEY. Run with: node --env-file=.env scripts/gen-sfx-elevenlabs.mjs');
    process.exit(1);
  }
  ensureDirs();

  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const filters = args.filter((a) => !a.startsWith('--'));
  const match = (id) => filters.length === 0 || filters.some((f) => id.includes(f));

  const todo = SOUNDS.filter((s) => match(s.id)).filter((s) => force || !existsSync(join(OUT_DIR, `${s.id}.ogg`)));
  if (todo.length === 0) {
    console.log('Nothing to generate (all exist; pass --force to regenerate).');
    return;
  }
  console.log(`Generating ${todo.length} sound(s)...`);

  let ok = 0;
  for (const s of todo) {
    try {
      const buf = await generateOne(s, apiKey);
      encode(s.id, buf);
      ok++;
      console.log(`✓ ${s.id}  (${s.dur}s)  → ${s.id}.ogg + ${s.id}.mp3`);
    } catch (err) {
      console.error(`✗ ${s.id}: ${err.message}`);
    }
  }
  rmSync(TMP_DIR, { recursive: true, force: true });
  console.log(`Done: ${ok}/${todo.length} generated.`);
  if (ok < todo.length) process.exit(1);
}

main();
