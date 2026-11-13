---
name: audio
description: How the Kingdoms RTS audio system works and how to add, generate, re-encode, wire, or tune any sound (SFX, music, ambience, unit voices). Use whenever touching audio assets, the AudioManager, the music director, or the ElevenLabs generation scripts.
---

# Kingdoms RTS - Audio

Web audio for the game: SFX, adaptive music, ambience beds, unit voice barks.
Assets are generated via the **ElevenLabs API** (scripts in `scripts/`), encoded
with `ffmpeg`, and played through raw WebAudio on Phaser's AudioContext. The sim
stays pure: it only emits cues; the render layer decides what to play.

## Architecture (read before changing anything)

```
sim (pure)                       render layer
----------                       ------------
world.soundCues   --drained-->   GameAudio.consumeSoundCues  --+
world.combatEvents --drained-->  GameAudio.onCombatEvent  -----+--> AudioManager.play()
world.gameEvents  --peeked--->   GameAudio.update (research)  -+
world.tick / paused / outcome -> GameAudio.update -> MusicDirector -> AudioManager music/ambience
DOM/HUD input ----------------> GameAudio.bark* / playUi, ui-sounds.ts -> AudioManager
```

- **HARD RULE:** `src/sim/**` never imports Phaser/audio/DOM. Sound is render-only.
  `Math.random` is fine for audio variation; never touch `world.rng`.
- `world.soundCues` / `combatEvents` are output-only append arrays: sim pushes,
  render drains each frame. `world.gameEvents` is drained by the HUD feed
  (`UiAlertFeed.pump`, POST_UPDATE); audio only peeks at it earlier in the frame.

### Signal graph

```
voice gain -> (StereoPanner) -> bus level -> bus duck -> master -> compressor -> limiter -> out
                                (BUS_GAIN x channel)     (volume x makeup)  (-14 dB 3:1) (-2 dB 20:1)
```

Buses: `music`, `ambience`, `sfx`, `ui`, `voice`. Each maps to one user channel.

## File map

| File | Role |
|------|------|
| `src/render/game-audio.ts` | Game-side direction: match lifecycle (menu, match, paused, over), director mood, camera-relative spatial SFX + fog, off-screen alarm, unit voice persona, research chime. |
| `src/render/audio/audio-manager.ts` | Facade: loading, settings API, music/ambience calls, `play()`, `playVoiceBark()`, pause/world-silence, debug snapshot. |
| `src/render/audio/audio-engine.ts` | WebAudio graph, buses, ducks, one-shot voices (envelope, variation, stealing), meters, visibility suspend. |
| `src/render/audio/mix.ts` | **All mix numbers**: `BUS_GAIN`, `SFX_TRIM_DB`, `MUSIC_TRIM_DB`, `VOICE_TRIM_DB`, `SFX_POLICY` (bus, cap, priority, detune, jitter), `BUS_VOICE_CAP`, `DUCK`. |
| `src/render/audio/sfx-limiter.ts` | Pure: cooldown, per-key cap with weakest-steal, bus cap with priority steal, density gain. |
| `src/render/audio/music-player.ts` | Song decks + ambience beds, equal-power crossfades, gapped / chain programs. |
| `src/render/audio/music-programs.ts` | menu / peace / battle program definitions. |
| `src/render/audio/music-plan.ts` | Pure: per-track in/out windows, ramps, song picking, gaps. |
| `src/render/audio/music-director.ts` | Pure: decaying combat intensity -> peace/battle mood with hysteresis; village flavor. |
| `src/render/audio/bark-arbiter.ts` | Pure: one voice line at a time, replace rules, no same line twice. |
| `src/render/audio/spatial.ts` | Pure: pan + distance falloff from the camera view. |
| `src/render/audio/audio-settings.ts` | Persisted settings (`kingdoms.audio`), migration. |
| `src/render/audio/audio-debug.ts` | Dev only: `window.__AUDIO__`. |
| `src/render/audio/sound-map.ts` | Pure tables: keys, cue -> SFX, combat -> SFX, UI configs. |
| `src/ui/ui-sounds.ts` | DOM button click / hover sounds (rate-limited, deduped). |
| `src/ui/panels/settings.ts` | Volume sliders per channel. |
| `scripts/gen-sfx-elevenlabs.mjs`, `gen-music.mjs`, `gen-voices.mjs` | ElevenLabs generators. |

## Asset + encoding rules (NON-NEGOTIABLE)

1. **Two formats per clip:** `<key>.mp3` AND `<key>.ogg`, same basename.
2. **mp3 is loaded FIRST** (`queueLoad*`). ffmpeg here has no libvorbis, so every
   `.ogg` is Opus-in-Ogg; some browsers claim Ogg support but fail
   `decodeAudioData` on Opus. Never reorder to ogg-first.
3. **Encode SFX/voices MONO** (`-ac 1`); the render pans them. Music/ambience stereo.
4. **Encoders:** `-c:a libmp3lame -q:a 4` for mp3, `-c:a libopus -b:a 96k` for ogg.
5. **Never list a key in `sound-map.ts` before its file exists.** The Vite dev
   server answers a missing file with the HTML fallback, which fails to decode.

## Generating assets

```bash
# SFX: edit SOUNDS in the script ({ id, text, dur, infl })
node --env-file=.env scripts/gen-sfx-elevenlabs.mjs forage          # ids matching
node --env-file=.env scripts/gen-sfx-elevenlabs.mjs alert --force   # regenerate
# Music (90 s, per-id prompt override in PROMPTS, else the default prompt)
node --env-file=.env scripts/gen-music.mjs ingame_2
# Voices: edit LINES + VOICES
node --env-file=.env scripts/gen-voices.mjs soldier_1
```

- **ALWAYS redact the key** in any output: `... 2>&1 | sed 's/sk_[a-zA-Z0-9]*/sk_***/g'`.
  Never print or commit `.env`. From a worktree, point `--env-file` at the main
  checkout's `.env`.
- SFX `dur` >= 0.5 (API minimum). `infl` 0.5-0.6 for mechanical sounds, ~0.3 organic.
- Prompts: end with "no music"; no brand names (ToS reject); for crisp impacts add
  "NO bass, no rumble, no boom"; describe the thing, not the trigger.
- Voice line counts live in `VOICE_LINE_COUNTS` in `sound-map.ts`; keep in sync.

### After generating: measure, then trim

Files come out at different loudness. Measure with ffmpeg (`ebur128`, `astats`,
or a short node script decoding to f32 and computing RMS/peak per window), then
set the trim in `mix.ts` so the file sits at the house level: SFX by their loud
50 ms window, music by integrated LUFS (house level about -16 LUFS after trim).
For music also set its `trackWindow` in `music-plan.ts` (`inSec` past lead-in
silence, `outSec` before trailing silence or a decaying ending), so loops and
crossfades never expose dead air.

## Wiring a new sound

1. Add the key to `SFX_KEYS`, generate the asset, add `SFX_TRIM_DB` and
   `SFX_POLICY` entries in `mix.ts` (typecheck forces the policy).
2. Sim state transition: a `SoundCueKind` + `CUE_MAP` entry + `pushSoundCue` in
   the system. Render plays it fog-gated and spatial.
   Combat fire: extend `combatSound()`. UI: an `SfxConfig` + `GameAudio.playUi(cfg)`
   (goes to the `ui` bus via the policy).
3. Cue `volume` sets the hierarchy (big impacts ~0.8, combat ~0.5, economy
   ~0.3-0.4); trims already equalised the files.

## Behaviour (what keeps it from bleeding)

- **SFX:** per-key cooldown (`minIntervalMs`), per-key cap (combat 4, death 3,
  cannon/explosion 3, gather 2, alert/age_up 1) stealing the weakest copy, bus
  cap (sfx 20, ui 4, voice 2) stealing by priority, density gain
  1/sqrt(1 + copies still sounding), random detune / volume / start jitter,
  4 ms attack and 20 ms release.
- **Spatial:** full level on screen, pan up to 0.7, squared falloff to 0 at 0.6
  view half-widths off screen, culled below 0.04. Own build/train notifications
  keep a 0.45 floor. The "under attack" bell only for off-screen fights, 15 s
  cooldown.
- **Voices:** one line at a time; a command replaces a select line; no repeated
  line per persona and type; a blip only when no line plays.
- **Ducking:** voice ducks music -6 dB, ambience -3, sfx -2; big impacts duck
  music -3 for 0.5 s; pause silences the world and dips music -9 dB.
- **Music:** menu and peace are gapped (song, ambience-only gap, next song; peace
  never cuts a playing song to switch village/playlist). Battle chains tracks with
  3 s equal-power crossfades before each track's decaying ending. The director
  needs sustained combat to enter battle (lone arrows never do), holds through
  lulls, leaves after about 10 s calm, with minimum dwell times both ways.
- **Lifecycle:** match end: score fades, victory stinger, menu theme. Leaving to
  the menu silences the world. Hidden tab suspends the context.

## Verify after any audio change

1. `npm run typecheck && npx vitest run --dir src`.
2. `npm run dev`, click once (autoplay unlock), check the console for
   `decode` / `EncodingError` (missing file or ogg loaded first).
3. In dev, `window.__AUDIO__.snapshot()` returns context state, bus levels and
   ducks, live voices per key and bus, meters (peak, compressor and limiter
   reduction), music program / audible songs / crossfades, stats (played,
   dropped, stolen, max per key and bus) and the last 60 play decisions.
   `__AUDIO__.resetStats()` before a measured run. `__RENDER__.loadLateGame()`
   gives a big battle to stress the limiter.
