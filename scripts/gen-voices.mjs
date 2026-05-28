// ElevenLabs Text-to-Speech generator for unit voice barks (AoE-style).
//
// Run: node --env-file=.env scripts/gen-voices.mjs [filter]
//   Output: public/assets/audio/voices/<category>_<type>_<n>.ogg|.mp3
//
// One voice per category; each says a few SELECT lines (clicked) and COMMAND
// lines (ordered to move/attack). Skips clips whose .ogg already exists unless
// --force. TTS works on the free tier (unlike the Music API).

import { writeFileSync, mkdirSync, existsSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public/assets/audio/voices');
const TMP_DIR = join(ROOT, '.voice-tmp');
const TTS = (id) => `https://api.elevenlabs.io/v1/text-to-speech/${id}`;
const MODEL = 'eleven_multilingual_v2';

// category → ElevenLabs voice id.
const VOICES = {
  villager_female: 'pFZP5JQG7iQjIQuC4Bku', // Lily - velvety British
  villager_male: 'JBFqnCBsd6RMkjVDRZzb', // George - warm British
  soldier_1: 'SOYHLrjzK2X1ezoPC6cr', // Harry - fierce warrior
  soldier_2: 'pNInz6obpgDQGcFmaJgB', // Adam - dominant, firm
  soldier_3: 'nPczCjzI2devNBz1zQrb', // Brian - deep, resonant
};

// Lines per role. Villagers share lines (male/female differ by voice); soldiers
// share lines across the three voices (variety comes from the voice).
const VILLAGER_LINES = {
  select: ['Yes, my lord?', 'At your service.', 'What do you need?'],
  command: ['Right away.', 'As you wish.', 'On my way.'],
};
const SOLDIER_LINES = {
  select: ['Yes, sire?', 'Awaiting your orders.', 'My lord?'],
  command: ['Attack!', 'For the kingdom!', 'Aye, sire!'],
};

function linesFor(category) {
  return category.startsWith('villager') ? VILLAGER_LINES : SOLDIER_LINES;
}

// Build the full clip list: { id, category, text }.
function allClips() {
  const clips = [];
  for (const category of Object.keys(VOICES)) {
    const lines = linesFor(category);
    for (const type of ['select', 'command']) {
      lines[type].forEach((text, n) => {
        clips.push({ id: `${category}_${type}_${n}`, category, text });
      });
    }
  }
  return clips;
}

async function tts(category, text, apiKey) {
  const res = await fetch(TTS(VOICES[category]), {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: MODEL,
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true },
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`TTS ${res.status} ${res.statusText}: ${t.slice(0, 300)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 200) throw new Error(`tiny audio (${buf.length}B)`);
  return buf;
}

function encode(id, mp3Buf) {
  const src = join(TMP_DIR, `${id}.src.mp3`);
  const outMp3 = join(OUT_DIR, `${id}.mp3`);
  const outOgg = join(OUT_DIR, `${id}.ogg`);
  writeFileSync(src, mp3Buf);
  // Trim silence + normalize so barks sit at a consistent level.
  const trim =
    'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.1,areverse,loudnorm=I=-16:TP=-1.5:LRA=11';
  const run = (filter) => {
    execFileSync('ffmpeg', ['-y', '-i', src, '-af', filter, '-c:a', 'libmp3lame', '-q:a', '4', outMp3], { stdio: 'pipe' });
    execFileSync('ffmpeg', ['-y', '-i', src, '-af', filter, '-c:a', 'libopus', '-b:a', '96k', outOgg], { stdio: 'pipe' });
  };
  run(trim);
  if (statSync(outMp3).size < 1500) run('loudnorm=I=-16:TP=-1.5:LRA=11');
}

async function main() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error('Missing ELEVENLABS_API_KEY. Run: node --env-file=.env scripts/gen-voices.mjs');
    process.exit(1);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(TMP_DIR, { recursive: true });

  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const filters = args.filter((a) => !a.startsWith('--'));
  const match = (id) => filters.length === 0 || filters.some((f) => id.includes(f));

  const todo = allClips()
    .filter((c) => match(c.id))
    .filter((c) => force || !existsSync(join(OUT_DIR, `${c.id}.ogg`)));
  if (todo.length === 0) {
    console.log('Nothing to generate (all exist; pass --force).');
    return;
  }
  console.log(`Generating ${todo.length} voice clip(s)...`);
  let ok = 0;
  for (const c of todo) {
    try {
      const buf = await tts(c.category, c.text, apiKey);
      encode(c.id, buf);
      ok++;
      console.log(`✓ ${c.id}  "${c.text}"`);
    } catch (err) {
      console.error(`✗ ${c.id}: ${err.message}`);
    }
  }
  rmSync(TMP_DIR, { recursive: true, force: true });
  console.log(`Done: ${ok}/${todo.length}.`);
  if (ok < todo.length) process.exit(1);
}

main();
