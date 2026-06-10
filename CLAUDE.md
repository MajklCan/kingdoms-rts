# CLAUDE.md — Kingdoms RTS

Agent brief for this repo. Read once per session. For deeper detail see `docs/AGENT_GUIDE.md`, `docs/ARCHITECTURE.md`, `docs/GDD.md`, `docs/VOXEL_SPRITE_PIPELINE.md`.

## What this is

Web-native, deterministic 2D-isometric RTS spanning Czech history from medieval Bohemia (Dark Age) through gunpowder to the 1918 First Czechoslovak Republic. Single-page Vite app.

Stack: **Phaser 4 beta** (rendering only) + **bitECS 0.3.40** (sim) + **TypeScript** strict + **Vite 6** + **Vitest 2** + **easystarjs** (pathfinding) + **vox-saver** (devDep, scripts only).

## Commands

| Command           | Effect                                              |
|-------------------|-----------------------------------------------------|
| `npm run dev`     | Vite dev server, port 5173                          |
| `npm run build`   | `tsc -b` then `vite build` — type error fails build |
| `npm run typecheck` | `tsc -b --noEmit`                                  |
| `npm test`        | Vitest single run — ALWAYS run before claiming done |
| `npm run test:watch` | Vitest watch                                      |
| `npm run preview` | Serve built `dist/`                                 |

TypeScript strict flags on: `noUnusedLocals`, `noUnusedParameters`, `noUncheckedSideEffectImports`. Don't silence them.

## Architecture pillars

### Sim/render split (HARD RULE)

`src/sim/` is pure bitECS data + systems. **No Phaser, no DOM, no `Math.random`, no `Date.now`, no `performance.now`, no async inside ticks.** Render reads sim, never writes. Don't add `import 'phaser'` under `src/sim/**`.

### Determinism

- Fixed **20 Hz** tick (`SIM.TICK_HZ` in `src/config.ts`). All durations in defs = `Math.round(SIM.TICK_HZ * seconds)`.
- Single RNG: `world.rng` (Mulberry32, `src/sim/rng.ts`). Never call `Math.random()` in sim. AI tie-breaks, map-gen, forest regrowth route through it.
- Tests may monkey-patch `world.rng.int` / `world.rng.next` for determinism (see `forest-regrowth.test.ts`).
- `step(world)` is pure fn of `(world, inputs)` → same world + same inputs → same next state.
- **Note:** RNG state is NOT persisted by `serializeSimWorld` currently. Replays from seed work; mid-game save/load won't reproduce future RNG draws.

### Tick order (`step()` in `src/sim/world.ts`)

Pre-input visibility → drain `world.inputs` → ai → ageProgression → production → construction → resourceWorksite → gathering → dropoff → targeting → combat → projectile/cannon impact → death → cleanup → campaign → forestRegrowth → movement (copies `Position`→`PrevPosition` first, runs separation internally) → post-move visibility → winCondition → `tick += 1`.

`world.paused = true` after `createSimWorld()`. Tests must set it to `false`.

### Data flow

Input (DOM/Phaser) → `world.inputs.push(...)` → consumed by `applyInput` switch during `step()`. Render layer drains `world.combatEvents` / `world.aiEvents` (append-only per tick). Sim never reads them back.

## Repo layout

```
src/
  main.ts              Phaser.Game ctor + rAF HUD loop driving DOM overlay
  config.ts            SIM.TICK_HZ, RENDER (1280×720), ISO, MAP, TEAM_COLORS
  sim/
    world.ts           ~7.5k lines — SimWorld shape, ALL systems, step(), AI, factories
    components.ts      bitECS components, *KindId enums, gameplay constants
    defs.ts            BUILDING_TABLE, UNIT_TABLE, AGE_TABLE + canAfford/spend/refund
    tech-tree.ts       TECH_TREE nodes + pure prereq/age helpers
    campaign.ts        2 missions: SIEGE_OF_BRNO, BATTLE_OF_BILA_HORA
    pathfinding.ts     EasyStar wrapper, LOS smoothing, nearest-walkable fallback
    map-gen.ts         5 generators → MapData{tiles,elevation,walkability,...}
    save-load.ts       SAVE_VERSION=1; round-trip
    rng.ts             Mulberry32; getState/setState
    *.test.ts          vitest, sit next to source
  render/
    game-scene.ts      ~4k lines — GameScene, draw fns, texture bake registry
    iso.ts             tileToScreen / screenToTile (64×32 diamond, VPER=4)
    voxel/
      voxel-render.ts  bakeVoxelTexture(scene, voxels, opts) → Phaser texture
      palette.ts       PALETTE shared across models
      terrain.ts       bakes full map into one big terrain sprite (one draw call)
      models/
        dark-*.ts          Dark Age unlocks (default era)
        gunpowder-*.ts     Gunpowder Age unlocks
        total-war-*.ts     Total War / 1918 unlocks
        resources.ts       trees / rocks / berries / gold / stone
        wall.ts            era-agnostic walls
  debug/
    overlay.ts         DOM updaters (resource bar, debug overlay)
    window-api.ts      installs window.__GAME__ — agent introspection
docs/                  AGENT_GUIDE, ARCHITECTURE, GDD, VOXEL_SPRITE_PIPELINE
scripts/               *.mjs voxel .vox generators (run on demand, not part of build)
public/assets/         static images (title screen etc.)
index.html             ~1500 lines inline CSS for HUD chrome
.claude/launch.json    'kingdoms-dev' run config
```

### Path aliases (`tsconfig.json` + `vite.config.ts`)

- `@sim/*`, `@render/*`, `@debug/*` — exist, use freely.
- `@data/*`, `@ui/*` — **declared but dirs don't exist yet.** Importing them today will fail. UI currently lives inline in `index.html` + `src/main.ts`; "data" lives in `src/sim/defs.ts` and `src/sim/tech-tree.ts`.

## Key constants / IDs

- Players: `MAX_PLAYERS=3`. `0`=Gaia (resources), `1`=`LOCAL_PLAYER_ID` (human), `2`=`AI_PLAYER_ID`.
- `POP_CAP_HARD_LIMIT=75`. `VILLAGER_CARRY_CAPACITY=10`. `VILLAGER_GATHER_COOLDOWN=4` ticks.
- Resources: `FOOD=0, WOOD=1, GOLD=2, STONE=3`. Dropoff bitmask 1/2/4/8.
- Units (`UnitKindId`): VILLAGER, MILITIA (legacy, no longer trainable), ARCHER, SPEARMAN, SCOUT_CAVALRY, GUNMAN, CANNON, MACHINE_GUN.
- Buildings: 13 defs (`BuildingDefId` TOWN_CENTER=0 … MILL=12).
- Ages: DARK → CASTLE → GUNPOWDER → TOTAL_WAR. **TOTAL_WAR and MACHINE_GUN are scaffolded but unreachable** in normal play (`applyAdvanceAge` blocks; `isUnitUnlocked` returns false).

## Voxel sprite pipeline (active path)

In-engine baking, no external `.vox`/MagicaVoxel/Aseprite step required for gameplay.

1. Author a model fn in `src/render/voxel/models/<thing>.ts` returning `Voxel[]` (`{x,y,z,color}`). Use `PALETTE` from `voxel/palette.ts`.
2. Per unit export: `FACINGS` (8 dirs), `ANIMS` (idle/move/attack), `FRAME_COUNTS`, `BAKE_BOUNDS`, and `build<Thing>Voxels(teamColor, {facing, anim, frame})`.
3. Register every pose in `GameScene.bakeAllTextures()` via `bakeIfMissing(key, builder, {voxelW, bounds})`. Texture keys e.g. `voxel-villager-p1-SE-move-0`.
4. Use **fixed `bounds`** when frame footprint changes — prevents sliding between anim frames.
5. Reference units: `dark-scout-cavalry.ts`, `dark-villager.ts`.
6. QA: `http://localhost:5173/?inspect=<unit>` (e.g. `?inspect=scout-cavalry`). Origin typically `originY=0.85`; scout cav uses `0.73` due to padding.

`bakeVoxelTexture` (`voxel/voxel-render.ts`): painter-sorts voxels by `x+y+z`, draws 3 faces (top diamond + R/L parallelograms at 88%/72% shade), `Graphics.generateTexture(key, w, h)`, then destroys the Graphics. Re-baking same key requires `scene.textures.remove(key)` first.

Scripts in `scripts/` (`gen-minimal.mjs`, `gen-tc-v2.mjs`, `gen-voxel-tc.mjs`) export `.vox` files for SpotVox external rendering — not part of the runtime path. `gen-tc-v2.mjs` is the canonical TC writer (uses `vox-saver`); the hand-rolled one is kept for reference.

## Iso + rendering specifics

- `ISO.TILE_W=64`, `TILE_H=32` (2:1 diamond), `ISO.VPER=4` px per elevation step. Tile (0,0) at world centre.
- `tileToScreen(x,y) = ((x-y)*32, (x+y)*16)`. Inverse `screenToTile`. Elevation subtracts from screen y.
- All entity sprites parented to one `worldContainer`. `setDepth(c.y)` for painter ordering inside container.
- Pixel-art chain: `pixelArt: true` + `roundPixels: true` + `antialias{,GL}: false`. Keep internal canvas at 1280×720 — bumping to 1080p makes nearest-neighbour upscale chunkier.
- Render reads via queries (`buildingQuery`, `unitQuery`, etc.) + `hasComponent` gates. `PrevPosition` enables 60 fps interpolation between 20 Hz sim ticks (`accumulator/TICK_MS`).

## Combat / movement gotchas

- Projectile damage is applied at **impact tick**, not fire tick. Tests must `stepN(world, shot.projectileTicks)` after observing a `combatEvents` entry (see `age-tower.test.ts`).
- Cannons have a windup (`CANNON_WINDUP_TICKS`); splash with falloff exponent.
- Stances: `AUTO_DEFEND` vs `HOLD_POSITION` (with melee leash distance).
- `world.grid` IS the pathfinder grid IS `mapData.walkability`. Mutate in place when placing buildings / removing trees so EasyStar sees changes. **Never reassign.**
- Unit separation runs 2 passes inside the movement system. Villagers are mutually non-blocking; ordered/working villagers still push others.
- Movement: per-tick `stepDist = speed/TICK_HZ`. After `STUCK_PROGRESS_TICKS` of no progress → `repathAroundStuckDestination`.
- AI difficulty profiles in `AI_DIFFICULTY_SETTINGS`. AI state machine: `opening | massing | staging | attacking | defending | recovering`.

## Save / load

- `SAVE_VERSION=1`. Round-trips entities, map, banks, techs, visibility, AI state, campaign, production queues, paths, rally points.
- Bumping any persisted component shape → bump version + write migration.
- `createLateGameTestWorld()` produces a deterministic stress fixture exercising every player-usable building.

## Tests (`src/sim/*.test.ts`)

Covered (50+ tests): `age-tower`, `ai`, `campaign`, `combat-formation` (heaviest, ~600L), `dropoff-distance`, `fog-of-war`, `forest-regrowth`, `map-gen`, `save-load`, `selection`, `tech-tree`, `unit-separation`, `worksite-workers`.

Thin / missing coverage:
- `world.ts` has no direct test file — only indirect coverage through the others.
- `pathfinding.ts` has no dedicated test.
- `render/` and `debug/` have no tests.

Test pattern: `const world = createSimWorld(seed); world.paused = false;` → push inputs OR call `spawnX` helpers → drive with `step(world)` or local `stepN` → assert against component arrays / queries.

## Agent affordances

In dev, `window.__GAME__` exposes: `getTick`, `listUnits`, `inspect`, `kill`, `spawn`, `grantResources`, `pause/resume`, `getChecksum`. Use for headless QA / debugging. Installed by `installWindowApi` in `GameScene.create()` (`src/debug/window-api.ts`).

## Conventions & rules

- **Immutability:** ECS struct-of-arrays writes are the exception; everywhere else prefer copy-on-update.
- **Many small files:** 200–400 LOC typical, 800 max. `world.ts` and `game-scene.ts` violate this and are scheduled for extraction — be surgical inside them; don't pile more on.
- **Don't import `/render` from `/sim`.** Lint will catch you eventually; assume it does today.
- **Iteration order:** ascending eid for any mutation order that matters.
- **Czech naming preserved** in domain terms: `Brno`, `Bílá Hora`, `Bohemia`. Keep them.
- **`MilitiaTag`** is legacy. Loadable from old saves; nothing trains militia anymore. Don't add usages.

## Known doc divergences (treat code as authoritative)

The four docs in `docs/` were written at different stages and contradict each other in places. Believe the code first:

1. **Fixed-point vs float:** `ARCHITECTURE.md` mandates Q16.16 i32 for Position/Velocity/Speed. Code uses **f32 floats**. `AGENT_GUIDE.md` explicitly says don't convert until tasked.
2. **Static tables location:** `ARCHITECTURE.md` says JSON in `public/assets/data/`. Reality: TS in `src/sim/defs.ts` + `src/sim/tech-tree.ts`.
3. **Scene graph:** `ARCHITECTURE.md` describes multi-scene (Boot/Preload/Title/HUDScene/…). Reality: single `GameScene` + DOM HUD driven from `src/main.ts`.
4. **Voxel pipeline stage numbers** differ across `ARCHITECTURE.md` §8 and `GDD.md` §8. Both agree the voxel path is active.
5. **System numeric prefixes** (`00 input`, `10 ai`, …) — described in `ARCHITECTURE.md`. Real `step()` is a function with hand-ordered calls; the numeric naming convention isn't applied to filenames yet.
6. `@data/*` and `@ui/*` aliases declared without backing directories (see above).

When in doubt: read `src/sim/world.ts` and `src/render/game-scene.ts`; they're the ground truth.

## Workflow expectations

- Before every commit, bump the root package patch version in both `package.json` and `package-lock.json`, unless the user explicitly says not to. The title menu displays this package version together with the git commit, so do not rely on the commit hash alone as the version signal.
- Plan complex work before coding (planner agent / `EnterPlanMode`).
- TDD for new sim systems — tests next to source, vitest, target 80%+ on touched code.
- After non-trivial changes: `npm run typecheck && npm test`.
- For UI/render changes: actually run `npm run dev` and look at the result before reporting done.
- Commits: `feat:` / `fix:` / `refactor:` / `docs:` / `test:` / `chore:` / `perf:` / `ci:`. Body explains *why*.
