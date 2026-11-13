# CLAUDE.md - Kingdoms RTS

Agent brief for this repo. Read once per session. For deeper detail see `docs/AGENT_GUIDE.md`, `docs/ARCHITECTURE.md`, `docs/GDD.md`; sprites: `docs/BLENDER_SPRITE_PIPELINE.md`, `docs/SPRITE_ATLAS.md`, `docs/UNIT_SPRITES.md`, `docs/VOXEL_SPRITE_PIPELINE.md`.

## What this is

Web-native, deterministic 2D-isometric RTS spanning Czech history from medieval Bohemia (Dark Age) through gunpowder to the 1918 First Czechoslovak Republic. Single-page Vite app.

Stack: **Phaser 4 beta** (rendering only) + **bitECS 0.3.40** (sim) + **TypeScript** strict + **Vite 6** + **Vitest 2** + **easystarjs** (pathfinding) + **vox-saver** (devDep, scripts only).

## Commands

| Command           | Effect                                              |
|-------------------|-----------------------------------------------------|
| `npm run dev`     | Vite dev server, port 5173                          |
| `npm run build`   | `tsc -b` then `vite build` - type error fails build |
| `npm run typecheck` | `tsc -b --noEmit`                                  |
| `npm test`        | Vitest single run - ALWAYS run before claiming done |
| `npm run test:watch` | Vitest watch                                      |
| `npm run preview` | Serve built `dist/`                                 |

TypeScript strict flags on: `noUnusedLocals`, `noUnusedParameters`, `noUncheckedSideEffectImports`. Don't silence them.

## Architecture pillars

### Sim/render split (HARD RULE)

`src/sim/` is pure bitECS data + systems. **No Phaser, no DOM, no `Math.random`, no `Date.now`, no `performance.now`, no async inside ticks.** Render reads sim, never writes. Don't add `import 'phaser'` under `src/sim/**`.

### Determinism

- Fixed **20 Hz** tick (`SIM.TICK_HZ` in `src/config.ts`). All durations in defs = `Math.round(SIM.TICK_HZ * seconds)`.
- Single RNG: `world.rng` (Mulberry32, `src/sim/rng.ts`). Never call `Math.random()` in sim. AI tie-breaks, map-gen, forest regrowth route through it.
- World creation: the scattered berry bushes are the last rng draws in `createSimWorld`. Add new creation-time draws after them so existing maps keep their layout.
- Tests may monkey-patch `world.rng.int` / `world.rng.next` for determinism (see `forest-regrowth.test.ts`).
- `step(world)` is pure fn of `(world, inputs)` → same world + same inputs → same next state.
- **Note:** RNG state is NOT persisted by `serializeSimWorld` currently. Replays from seed work; mid-game save/load won't reproduce future RNG draws.

### Tick order (`step()` in `src/sim/step.ts`)

Pre-input visibility → drain `world.inputs` → ai → ageProgression → production → construction → resourceWorksite → gathering → resourceDepletion (removes empty nodes, retargets their gatherers) → dropoff → targeting → combat → projectile/cannon impact → death → cleanup → campaign → forestRegrowth → movement (copies `Position`→`PrevPosition` first, runs separation internally) → post-move visibility → winCondition → `tick += 1`.

`world.paused = true` after `createSimWorld()`. Tests must set it to `false`.

### Data flow

Input (DOM/Phaser) → `world.inputs.push(...)` → consumed by `applyInput` switch during `step()`. Render layer drains `world.combatEvents` / `world.aiEvents` / `world.gameEvents` (append-only per tick; `gameEvents` is the typed HUD feed: unit trained, building complete or lost, research, age). Sim never reads them back. `world.matchStats` holds exact per-player counters for the game-over screen: write-only, excluded from the checksum, saved.

## Repo layout

```
src/
  main.ts              Phaser.Game ctor, then mountUi() hands the page to src/ui
  config.ts            SIM.TICK_HZ, RENDER (1280×720), ISO, MAP, TEAM_COLORS
  sim/
    world.ts           barrel only: the stable public sim API (`@sim/world`); add code to the owning module
    step.ts            step(): the tick order
    core/              SimWorld/SimInput types, constants, entity + NetId ids, queries, lookup, grid, createSimWorld
    factories/         spawn helpers (military units are a MilitaryUnitSpec table), late-game fixture
    input/             applyInput switch + command handlers (orders, formations, buildings)
    systems/           one file per tick system (visibility, production, combat, movement, ...)
    ai/                computer player: difficulty, snapshot, brain, economy, military, attack, breach (picks the wall to knock down)
    missions/          campaign world setup + scripted mission runtime (one file per mission)
    maps/              map generators; map-gen.ts is their barrel
    save/              save schema, serialize, load; save-load.ts is their barrel
    components.ts      bitECS components, *KindId enums, gameplay constants
    defs.ts            BUILDING_TABLE, UNIT_TABLE, AGE_TABLE, WALL_TIERS (palisade/stone/brick per age) + canAfford/spend/refund
    tech-tree.ts       TECH_TREE nodes + pure prereq/age helpers
    campaign.ts        2 missions: SIEGE_OF_BRNO, BATTLE_OF_BILA_HORA
    pathfinding.ts     EasyStar wrapper, LOS smoothing, nearest-walkable fallback
    rng.ts             Mulberry32; getState/setState
    *.test.ts          vitest, sit next to source
  net/                 lockstep multiplayer (relay server in relay/)
    session.ts         MultiplayerSession: transport + lockstep + sim driver, desync checks
    lockstep.ts        pure turn scheduler (input delay, bounded send-ahead)
    commands.ts        wire command validation + eid <-> NetId mapping
    checksum-ledger.ts per-tick local vs peer checksum pairing
    protocol.ts        message types + validated decodeServer; transport.ts WebSocket
  render/
    game-scene.ts      ~650 lines: GameScene wiring + per-frame update order; logic lives in the folders below
    ui-api.ts          typed API the DOM HUD reads through src/ui/game-bridge.ts (selection, queue, alerts, stats, endMatch)
    iso.ts             tileToScreen / screenToTile (64×32 diamond, VPER=4)
    entities/          building / unit / resource renderers, sprite sync, ruins + stumps
    sprites/           SpriteSourceRegistry: Blender atlas first, voxel bake fallback (see below)
    terrain/           terrain baker + decor layer
    effects/           particles, combat fx, ambient life (birds, smoke, wildlife)
    overlays/          fog of war (fog-renderer.ts), status overlay
    hud/ commands/ input/ placement/ camera/   HUD data, player commands, hotkeys + pointer, build ghost, camera
    audio/             AudioManager + sound-map (game-audio.ts routes sim events to cues)
    inspection/        `?inspect=<unit>` voxel sprite sheets
    voxel/             voxel models (dark-*, gunpowder-*, total-war-*, resources, wall) + bakeVoxelTexture
  ui/                  DOM UI (`@ui/*`): screens (menu, skirmish setup, lobby, game over), hud, panels, styles, icons
  debug/
    window-api.ts      window.__GAME__ (sim introspection)
    render-api.ts      window.__RENDER__ (snapshot, startSkirmish, loadLateGame, setZoom, panToTile, fps, scene)
    cheats.ts, overlay.ts
docs/                  AGENT_GUIDE, ARCHITECTURE, GDD, sprite pipeline docs
scripts/               blender/ + pack_sprites.py (sprite atlases), gen-*.mjs (audio, legacy .vox)
public/assets/         sprites/ (atlases + manifest.json + units-manifest.json), audio/, ui/
index.html             27-line shell; CSS lives in src/ui/styles
.claude/launch.json    'kingdoms-dev' run config
```

### Path aliases (`tsconfig.json` + `vite.config.ts`)

- `@sim/*`, `@render/*`, `@debug/*`, `@ui/*` - exist, use freely.
- `@data/*` - **declared but `src/data/` doesn't exist.** Importing it fails. Data lives in `src/sim/defs.ts` and `src/sim/tech-tree.ts`.

## Key constants / IDs

- Players: `MAX_PLAYERS=3`. `0`=Gaia (resources), `1`=`LOCAL_PLAYER_ID` (human), `2`=`AI_PLAYER_ID`.
- `POP_CAP_HARD_LIMIT=75`. `VILLAGER_CARRY_CAPACITY=10`. `VILLAGER_GATHER_COOLDOWN=4` ticks.
- Resources: `FOOD=0, WOOD=1, GOLD=2, STONE=3`. Dropoff bitmask 1/2/4/8.
- Units (`UnitKindId`): VILLAGER, MILITIA (legacy, no longer trainable), ARCHER, SPEARMAN, SCOUT_CAVALRY, GUNMAN, CANNON, MACHINE_GUN.
- Buildings: 13 defs (`BuildingDefId` TOWN_CENTER=0 … MILL=12). A building trains whatever its def `trains` lists: town center villagers, barracks archers + spearmen, archery range archers (unlocked by the Archers tech).
- Ages: DARK → CASTLE → GUNPOWDER → TOTAL_WAR. **TOTAL_WAR and MACHINE_GUN are scaffolded but unreachable** in normal play (`applyAdvanceAge` blocks; `isUnitUnlocked` returns false).

## Sprite pipeline

Renderers ask `SpriteSourceRegistry` (`src/render/sprites/sprite-registry.ts`) what to draw. Order per query: pre-rendered unit atlases (`units-manifest.json`), then Blender atlas art (`manifest.json`), then in-engine voxel bakes. A missing manifest, atlas or frame falls back per query, never blanks an entity.

- **Blender atlases (primary art, "style A"):** rendered by `scripts/blender/`, packed by `scripts/pack_sprites.py` into `public/assets/sprites/*-0.{png,json}` + manifests. Re-running, conventions and variant keys: `docs/BLENDER_SPRITE_PIPELINE.md`, `docs/UNIT_SPRITES.md`; engine side (loading, zoom, layers, team colour, terrain bake, ambient life): `docs/SPRITE_ATLAS.md`.
- **Voxel fallback:** model fns in `src/render/voxel/models/<thing>.ts` return `Voxel[]`; `src/render/sprites/voxel-bake.ts` bakes every pose at boot (`bakeIfMissing`, fixed `bounds` so frames don't slide). Keys e.g. `voxel-villager-p1-SE-move-0`. Details: `docs/VOXEL_SPRITE_PIPELINE.md`. QA sheet: `?inspect=<unit>` (e.g. `?inspect=scout-cavalry`).
- `scripts/gen-*-tc*.mjs` / `gen-minimal.mjs` export `.vox` files for external rendering, legacy, not on the runtime path.

## Iso + rendering specifics

- `ISO.TILE_W=64`, `TILE_H=32` (2:1 diamond), `ISO.VPER=4` px per elevation step. Tile (0,0) at world centre.
- `tileToScreen(x,y) = ((x-y)*32, (x+y)*16)`. Inverse `screenToTile`. Elevation subtracts from screen y.
- World drawing goes into fixed layers (`src/render/world-layers.ts`: terrain, decor, shadows, groundFx, ground, fog, entities, overlay, effects). The entities layer is painter-sorted by screen y.
- Pixel-art chain: `pixelArt: true` + `roundPixels: true` + `antialias{,GL}: false`. Internal height stays `RENDER.HEIGHT` (720); width follows the window aspect (4:3 .. 21:9, `src/main.ts`).
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

- `SAVE_VERSION=3`. Round-trips entities, map, banks, techs, visibility, AI state, campaign, production queues, paths, rally points, match stats, map seed. v1 saves migrate with zeroed stats, v1/v2 saves get a map seed hashed from the map bytes (`migrateSavedGame`). `world.mapSeed` (`getMapSeed`) is cosmetic only: not checksummed, read by no system.
- Bumping any persisted component shape → bump version + write migration.
- `createLateGameTestWorld()` produces a deterministic stress fixture exercising every player-usable building.

## Tests

~45 files / ~310 tests, mostly `src/sim/*.test.ts` (behaviour per feature: combat, AI, economy, producers, save/load, tech tree, ...), plus `src/net/` (lockstep, protocol, `full-feature-1v1.test.ts`: a ~100 s exhaustive deterministic 1v1 replay), a few pure `src/render/` + `src/ui/` helpers. Run `npx vitest run --dir src`.

Thin / missing coverage:
- Most sim modules (`systems/`, `input/`, `ai/`) are covered only through behaviour tests; `core/` has a few unit tests.
- `pathfinding.ts` has no dedicated test.
- Renderers, scenes and `debug/` have no tests.

Test pattern: `const world = createSimWorld(seed); world.paused = false;` → push inputs OR call `spawnX` helpers → drive with `step(world)` or local `stepN` → assert against component arrays / queries.

## Agent affordances

In dev, `window.__GAME__` (`src/debug/window-api.ts`) exposes: `getState`, `queueInput`, `tickN`, `selected`, `selectAll`, `moveTo`, `inspect`, `placeBuilding`, `advanceAge`, `trainVillager`, `trainUnit`, `pop`, `bank`, `debugDump`, `raw`. `window.__RENDER__` (`src/debug/render-api.ts`): `snapshot`, `spawnEffect`, `shake`, `tileToClient`, `startSkirmish`, `startCampaign`, `loadLateGame`, `setZoom`, `panToTile`, `fps`, `scene`. Both installed by `GameScene`. Use for headless QA, debugging and perf (`loadLateGame()` is the stress fixture).

## Conventions & rules

- **Immutability:** ECS struct-of-arrays writes are the exception; everywhere else prefer copy-on-update.
- **Many small files:** 200-400 LOC typical, 800 max. `game-scene.ts` is wiring only: put new render logic in a module under `src/render/<area>/`, not in the scene. `src/sim/world.ts`, `map-gen.ts` and `save-load.ts` are barrels: never add logic to them.
- **Don't import `/render` from `/sim`.** Lint will catch you eventually; assume it does today.
- **Iteration order:** `sortedEids(world, eids)` (NetId first, raw eid for entities without one) for any order that matters. Eids differ between lockstep peers, NetIds don't.
- **Czech naming preserved** in domain terms: `Brno`, `Bílá Hora`, `Bohemia`. Keep them.
- **`MilitiaTag`** is legacy. Loadable from old saves; nothing trains militia anymore. Don't add usages.

## Known doc divergences (treat code as authoritative)

The four docs in `docs/` were written at different stages and contradict each other in places. Believe the code first:

1. **Fixed-point vs float:** `ARCHITECTURE.md` mandates Q16.16 i32 for Position/Velocity/Speed. Code uses **f32 floats**. `AGENT_GUIDE.md` explicitly says don't convert until tasked.
2. **Static tables location:** `ARCHITECTURE.md` says JSON in `public/assets/data/`. Reality: TS in `src/sim/defs.ts` + `src/sim/tech-tree.ts`.
3. **Scene graph:** `ARCHITECTURE.md` describes multi-scene (Boot/Preload/Title/HUDScene/…). Reality: single `GameScene` + DOM UI in `src/ui` (menus and HUD).
4. **Sprite pipeline:** `ARCHITECTURE.md` §8 and `GDD.md` §8 describe voxels as the art path. Reality: Blender atlases first, voxels only as fallback (see Sprite pipeline).
5. **System numeric prefixes** (`00 input`, `10 ai`, …) - described in `ARCHITECTURE.md`. Real `step()` is a function with hand-ordered calls; the numeric naming convention isn't applied to filenames yet.
6. `@data/*` alias declared without a backing directory (see above).

When in doubt: read `src/sim/step.ts` (then the system module it calls) and `src/render/game-scene.ts`; they're the ground truth.

## Workflow expectations

- Before every commit, bump the root package patch version in both `package.json` and `package-lock.json`, unless the user explicitly says not to. The title menu displays this package version together with the git commit, so do not rely on the commit hash alone as the version signal.
- Plan complex work before coding (planner agent / `EnterPlanMode`).
- TDD for new sim systems - tests next to source, vitest, target 80%+ on touched code.
- After non-trivial changes: `npm run typecheck && npm test`.
- For UI/render changes: actually run `npm run dev` and look at the result before reporting done.
- Commits: `feat:` / `fix:` / `refactor:` / `docs:` / `test:` / `chore:` / `perf:` / `ci:`. Body explains *why*.
