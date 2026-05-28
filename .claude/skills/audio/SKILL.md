---
name: audio
description: How the Kingdoms RTS audio system works and how to add, generate, re-encode, wire, or tune any sound (SFX, music, ambience, unit voices). Use whenever touching audio assets, the AudioManager, the music director, or the ElevenLabs generation scripts.
---

# Kingdoms RTS — Audio

Web audio for the game: SFX, adaptive music, ambience beds, AoE-style unit voice
barks. Assets are generated via the **ElevenLabs API** (scripts in `scripts/`),
encoded with `ffmpeg`, and played through a render-layer `AudioManager`. The sim
stays pure — it only emits cues; the render layer decides what to play.

## Architecture (read before changing anything)

```
sim (pure)                     render layer
──────────                     ────────────
world.soundCues  ──drained──►  GameScene.consumeSoundCues  ──►
world.combatEvents ─drained─►  GameScene.consumeCombatEvents ─► AudioManager.play()
                               GameScene.updateMusicDirector ─► AudioManager music/ambience
DOM/HUD input ───────────────► GameScene bark* / playUi ─────► AudioManager
```

- **HARD RULE:** `src/sim/**` never imports Phaser/audio/DOM. Sound is render-only.
- `world.soundCues` is an **output-only append array** (same contract as
  `combatEvents`/`aiEvents`): sim pushes, render drains each frame, sim never reads
  it back. This keeps determinism intact. Defined in `src/sim/world.ts`
  (`SoundCue`, `SoundCueKind`, `pushSoundCue`, `MAX_SOUND_CUES`).

## File map

| File | Role |
|------|------|
| `src/render/audio/audio-manager.ts` | Loading, throttling, concurrency cap, spatial pan, per-channel volume, music director playback (menu / playlist / village-gapped / battle loop), ambience crossfade, voice barks, localStorage settings. |
| `src/render/audio/sound-map.ts` | **Pure mapping tables.** SFX keys, music/ambience/voice keys, cue→SFX map, combat→SFX picker, UI sound configs. No Phaser. |
| `src/render/game-scene.ts` | Drains cues/events, music director state machine, spatial play, unit voice bark selection. |
| `src/sim/world.ts` | `soundCues` field + `pushSoundCue` + per-system push calls. |
| `scripts/gen-sfx-elevenlabs.mjs` | Generate SFX via ElevenLabs Sound-Generation API. |
| `scripts/gen-voices.mjs` | Generate unit voice barks via ElevenLabs TTS. |
| `public/assets/audio/{sfx,music,voices}/` | The `.ogg` + `.mp3` asset pairs. |
| `index.html` + `src/main.ts` | ⚙ Audio settings panel + quick-mute, slider wiring. |

## Asset + encoding rules (NON-NEGOTIABLE)

1. **Two formats per clip:** `<key>.mp3` AND `<key>.ogg`, same basename.
2. **mp3 is loaded FIRST** (`queueLoad*` in audio-manager). ffmpeg here has no
   libvorbis so every `.ogg` is **Opus-in-Ogg**; some browsers report Ogg support
   but fail `decodeAudioData` on Opus → silences ALL audio. mp3 (libmp3lame)
   decodes everywhere. Never reorder to ogg-first.
3. **Encode MONO** (`-ac 1`). The API returns asymmetric stereo (content weighted
   to one channel) → panned SFX play in one ear. Mono + the render pan = correct
   spatialization. (Music/ambience may stay stereo; they aren't panned.)
4. **Encoders:** `-c:a libmp3lame -q:a 4` for mp3, `-c:a libopus -b:a 96k` (SFX/
   voices) or `128k` (music) for ogg.
5. **Never list a track key in `sound-map.ts` before its file exists.** A missing
   file makes the Vite dev server return the HTML SPA fallback (HTTP 200), which
   then fails to decode and spams the console with `EncodingError`. Looks like a
   bug; it's just a missing asset.

## Generating SFX

Edit the `SOUNDS` array in `scripts/gen-sfx-elevenlabs.mjs` (each entry:
`{ id, text, dur, infl, loop? }`), then:

```bash
node --env-file=.env scripts/gen-sfx-elevenlabs.mjs                 # all missing
node --env-file=.env scripts/gen-sfx-elevenlabs.mjs chop_wood       # ids matching
node --env-file=.env scripts/gen-sfx-elevenlabs.mjs alert --force   # regenerate
```

- Skips ids whose `.ogg` already exists unless `--force`. Output is encoded mono
  (mp3+ogg) automatically, silence-trimmed + loudnorm'd, with a norm-only fallback
  if trimming eats a quiet clip (<1500 bytes).
- `dur` ≥ **0.5** (API minimum). `infl` = prompt adherence (0..1; 0.5–0.6 for
  precise mechanical sounds, ~0.3 for musical/organic).
- **ALWAYS redact the key** in any command output you echo:
  `... 2>&1 | sed 's/sk_[a-zA-Z0-9]*/sk_***/g'`.

### Prompt guidelines (learned the hard way)

- End every prompt with **"no music"** (and "no music bed" for fanfares).
- **No brand names** ("Age of Empires" etc.) → ElevenLabs ToS-rejects the prompt.
- For crisp impacts add **"NO bass, no rumble, no boom"** + higher `infl` — the
  model otherwise returns dull booms (axe, bow, gun all needed this).
- Describe the *thing*, not the trigger: "arrow flying, whistling whoosh" beats
  "bow shot"; "fast-ringing town alarm bell" beats "alarm".

## Generating unit voices

Edit `LINES` (per-category) + `VOICES` (category→ElevenLabs voice id) in
`scripts/gen-voices.mjs`. Bark types: **select / move / attack** (keep them split —
a move order must NOT shout "Attack!"). Each soldier voice has its own line set for
variety; villagers split female (farm) / male (rest).

```bash
node --env-file=.env scripts/gen-voices.mjs                 # all missing
node --env-file=.env scripts/gen-voices.mjs soldier_1       # filter
node --env-file=.env scripts/gen-voices.mjs --force         # regenerate all
```

If you change line counts or types, update `VOICE_LINE_COUNTS` + `VOICE_KEYS` in
`sound-map.ts` to match, then regenerate (delete `public/assets/audio/voices/*`
first if lines changed, so stale text doesn't linger).

## Adding music / ambience (user-supplied)

The ElevenLabs **Music API is paid** (HTTP 402 on free tier) — music tracks are
supplied by the user, not generated here. Workflow: user drops a named `.mp3` in
the repo root, then convert + place:

```bash
KEY=village_theme   # the sound-map key
cp "$KEY".mp3 public/assets/audio/music/$KEY.mp3
ffmpeg -y -i public/assets/audio/music/$KEY.mp3 -c:a libopus -b:a 128k public/assets/audio/music/$KEY.ogg
```

Then ensure the key is registered in `sound-map.ts` (`MENU_MUSIC`, `VILLAGE_MUSIC`,
`BATTLE_TRACKS`, `INGAME_TRACKS`, or `AMBIENCE_KEYS`). Missing files no-op safely
(every playback path guards on `cache.audio.exists`), but only list a key once its
file is present (see rule 5).

## Wiring a NEW sound end-to-end

**SFX from a sim event (e.g. a new building finishing):**
1. Add the key to `SFX_KEYS` in `sound-map.ts` + generate the asset.
2. If it's a sim state transition: add a `SoundCueKind` in `world.ts`, a
   `CUE_MAP` entry in `sound-map.ts` (key + `minIntervalMs` + `volume`), and a
   `pushSoundCue(world, kind, x, y, player)` call in the relevant system. Render
   plays it automatically via `consumeSoundCues` (fog-gated + spatial).
3. If it's a combat fire: extend `combatSound()` in `sound-map.ts`.

**UI sound:** add an `SfxConfig` const (like `UI_CLICK`) in `sound-map.ts`, call
`this.playUi(cfg)` from `game-scene.ts`. Generic button click/hover are already
delegated in `main.ts`.

**Throttling:** every SFX has `minIntervalMs` — collapses simultaneous triggers
(30 villagers chopping → a trickle). Global cap `MAX_CONCURRENT = 12`.

## Volume channels + settings

5 persisted channels (localStorage key `kingdoms.audio`): **master, music, sfx,
voices, ambience** (each 0..1). The multiplier is applied at 4 points in
audio-manager: `musicVolume()`, `ambienceVolume()`, `play()` (SFX),
`playVoiceBark()`. UI = ⚙ Audio panel (`#settings-panel` in `index.html`, wired in
`bindAudioControls()` in `main.ts`) + quick-mute button in the resource bar.
`setChannelVolume(channel, v)` / `getChannelVolume(channel)` are the API. New
settings fields default to 1 and old saved settings migrate cleanly.

## Music director behavior (game-scene `updateMusicDirector`)

Contexts: **battle** (combat) > **village** (lingering safely at home) >
**playlist** (neutral). Key rules, all tunable via the `*_TICKS` constants:
- Battle holds **15s** after the last local combat event, but **winds down early**
  if the local army is wiped and the base isn't under recent attack.
- village↔playlist needs **10s min dwell** (no flapping); battle interrupts both.
- Village + playlist **breathe**: song → fade-out → randomized ambience-only gap →
  song. Only battle loops continuously. Fades are slow (music 2s, ambience 2.8s).
- Ambience: `nature_ambience` fills peacetime quiet; crossfades to
  `battle_ambience` (era-neutral crowd din) when in danger.

## Verify after any audio change

1. `npm run typecheck && npm test && npm run build` (106 tests; audio is render-only
   so sim tests should be untouched).
2. `npm run dev`, hard-reload (Cmd+Shift+R), click into the game (browser autoplay
   needs a gesture before the AudioContext starts).
3. Check the console for `decode` / `EncodingError` — if present, a listed track is
   missing its file or ogg got loaded first (see rules 2 + 5).
4. Quick decode sanity in a browser console:
   `new AudioContext().decodeAudioData(await (await fetch('assets/audio/sfx/<key>.mp3')).arrayBuffer())`.
