# Kingdoms — Technical Architecture

> **Status:** Architecture v1.0 (2026-05-20) — derived from `docs/GDD.md`
> **Stack:** Phaser 4 (v4.0.0-rc.7) + Vite + TypeScript (strict) + bitECS + EasyStar.js + Vitest
> **Architectural North Stars:** Determinism, sim/render separation, JSON-serialisable state, MP-ready from day 1, agent-buildable.

---

## 1. Phaser Game Config

The Phaser layer is intentionally thin: a pure renderer + input dispatcher. **No physics** (custom grid collision + A*), **no `pixelArt`** (Kenney Medieval RTS is painterly), **Scale.FIT** to letterbox a fixed 1920×1080 internal canvas.

```typescript
// src/main.ts
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,                       // Phaser Beam WebGL renderer (canvas fallback)
  width: 1920,
  height: 1080,
  parent: 'game-container',
  backgroundColor: '#1B1B2F',
  pixelArt: false,
  roundPixels: true,
  antialias: true,
  powerPreference: 'high-performance',
  disableContextMenu: true,
  fps: { target: 60, forceSetTimeOut: false, smoothStep: true },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: 1920, height: 1080 },
  render: { pixelArt: false, roundPixels: true, antialias: true, transparent: false },
  input: { keyboard: true, mouse: true, touch: false, gamepad: false },
  scene: [ /* BootScene, PreloadScene, TitleScene, ..., GameScene, HUDScene, PauseScene, PostGameScene, ReplayPlayerScene */ ],
};
```

**Phaser 4 specific notes:**
- `Phaser.AUTO` picks Beam WebGL renderer — fastest path for many sprite quads.
- `Phaser.Geom.Point` removed → use `Phaser.Math.Vector2`.
- `Phaser.Structs.Map` / `Set` removed → use native `Map` / `Set`.
- `DynamicTexture` requires explicit `.render()` call (used by Minimap + FogOfWar).

---

## 2. Scene Graph

```
                             [BootScene]
                                  |
                                  v
                            [PreloadScene]
                                  |
                                  v
                            +-----------+
                            | TitleScene|<------------------------+
                            +-----------+                          |
                                  |                                |
        +-----------+------+------+------+------------+            |
        |           |      |      |      |            |            |
        v           v      v      v      v            v            |
[SkirmishSetup] [Scenario [Replay [Sett- [Credits   (exit)         |
                Browser]  Browser]ings]                            |
        |           |      |                                       |
        | (Start)   | (Pick)                                       |
        v           v      v                                       |
  +----------+ +----------+ +-------------+                        |
  | GameScene|=| GameScene| | ReplayPlayer|                        |
  +----------+ +----------+ +-------------+                        |
       ||           ||            |                                |
       ||           ||            +--------------------------------+
       || (launch)  ||
       vv           vv
   +---------+  +---------+
   |HUDScene |  |HUDScene |   (HUDScene runs in PARALLEL with GameScene
   +---------+  +---------+    via this.scene.launch — never .start)
       ||
       || (Esc → launch)
       vv
   +---------+
   |PauseScene| ---> Resume / Resign / Save Replay → PostGameScene
   +---------+

   GameScene ends (Conquest / Wonder / Independence / Defeat)
                              |
                              v
                       [PostGameScene] -----> [TitleScene]
                              |
                              +-> Save Replay (writes to localStorage / IndexedDB)
                              +-> Rematch (back to SkirmishSetupScene with same args)
```

**Scene responsibilities:**

| Scene | Role |
|---|---|
| `BootScene` | Loads bootstrap-only assets; transitions to PreloadScene. |
| `PreloadScene` | Loads all atlases, audio, JSON data, fonts with a progress bar. |
| `TitleScene` | Animated title art, 5 buttons (Skirmish / Scenarios / Replays / Settings / Credits). |
| `SkirmishSetupScene` | Civ pick + map pick + AI tier + seed. |
| `ScenarioBrowserScene` | Lists hand-crafted scenarios. |
| `ReplayBrowserScene` | Lists saved replays. |
| `SettingsScene` | Audio sliders, control rebind, graphics. |
| `GameScene` | Owns the sim driver, iso world renderer, camera, picking. Launches HUDScene in parallel. |
| `HUDScene` | Resource bar, bottom panel, notifications. Reads sim state via SimBridge. |
| `PauseScene` | Modal overlay; pauses sim driver. |
| `PostGameScene` | Stats table, Save Replay, Rematch, Back. |
| `ReplayPlayerScene` | Replay-driven sim driver + transport controls. |

**Parallel scenes:** `HUDScene` is `scene.launch`-ed alongside `GameScene`. Shared state lives in **bitECS world + SimBridge**, never in scene instance fields.

---

## 3. Module Structure

```
kingdoms/
├── index.html
├── vite.config.ts
├── tsconfig.json
├── vitest.config.ts
├── package.json
├── public/
│   └── assets/
│       ├── atlases/                         ← Aseprite JSON + PNG pairs
│       ├── audio/                           ← .mp3 + .ogg pairs
│       ├── data/                            ← static JSON (units, buildings, techs, civs, ages, maps)
│       ├── fonts/
│       └── ui/
├── docs/
│   ├── GDD.md
│   ├── ARCHITECTURE.md
│   └── VOXEL_SPRITE_PIPELINE.md
├── tests/
│   ├── sim/                                 ← Vitest unit tests
│   ├── integration/                         ← 60s deterministic match test
│   └── fixtures/
└── src/
    ├── main.ts
    ├── env.d.ts
    │
    ├── sim/                                 ← ★ PURE — NO Phaser imports allowed ★
    │   ├── index.ts
    │   ├── world.ts                         ← bitECS world creation + component registration
    │   ├── step.ts                          ← top-level reducer
    │   ├── tick.ts                          ← fixed-timestep driver
    │   ├── rng.ts                           ← Mulberry32 seeded RNG
    │   ├── checksum.ts                      ← FNV-1a 32-bit world checksum
    │   ├── components/                      ← one file per component (Position, Velocity, Health, etc.)
    │   ├── systems/                         ← 00-input, 10-ai, 20-research, ..., 99-tick-counter
    │   ├── pathfinding/                     ← grid, easystar adapter, flow-field (post-demo)
    │   ├── map/                             ← generator, scenario-loader, terrain
    │   ├── inputs/                          ← types, queue, validate
    │   ├── data/                            ← typed DataRegistry over JSON
    │   ├── snapshot/                        ← serialize, deserialize, version
    │   └── replay/                          ← recorder, format, player
    │
    ├── render/                              ← ALL Phaser code lives here
    │   ├── scenes/                          ← Boot, Preload, Title, ..., GameScene, HUDScene
    │   ├── bridge/                          ← SimBridge (read-only), InputDispatcher
    │   ├── world/                           ← IsoProjection, TerrainRenderer, EntityRenderer, FogOfWar, Selection, BuildGhost, HealthBar, Projectile, CameraController
    │   ├── hud/                             ← ResourceBar, BottomPanel, Minimap, CommandGrid, UnitPortrait, NotificationToaster, HotkeyHandler
    │   ├── menu/                            ← Button, CivCard, MapCard, ReplayListItem, SettingsPanel
    │   ├── audio/                           ← AudioManager, MusicDirector
    │   └── style/                           ← colors, fonts
    │
    ├── ui/                                  ← non-Phaser UI state stores
    │   ├── stores/                          ← SettingsStore, ProfileStore, ReplayLibrary
    │   └── persistence/                     ← localStorageDriver, indexedDBDriver
    │
    ├── shared/                              ← types/keys shared between sim, render, ui
    │   ├── scene-keys.ts
    │   ├── event-names.ts
    │   ├── registry-keys.ts
    │   ├── asset-keys.ts
    │   ├── data-keys.ts
    │   ├── player-ids.ts
    │   ├── numeric.ts                       ← Q16.16 fixed-point helpers
    │   └── results.ts
    │
    └── debug/
        ├── window-game.ts                   ← window.__GAME__
        ├── overlay.ts                       ← in-canvas debug HUD
        └── inspector.ts                     ← click-an-entity → console.dir
```

**Hard rule:** ESLint forbids `import 'phaser'` inside `src/sim/**`.

---

## 4. ECS Component List

> **Position units:** tiles, **fixed-point Q16.16** stored as `i32` (1.0 tile == `1 << 16`). Avoids float drift across browsers. `IsoProjection` in /render converts to screen pixels.

| Component | Fields (bitECS types) | Purpose |
|---|---|---|
| `Position` | `x: i32, y: i32` | Q16.16 fixed-point tile coords. |
| `Velocity` | `vx: i32, vy: i32` | Tiles/tick Q16.16. |
| `Heading` | `dir: ui8` | 0–7 (8 facings). |
| `Health` | `hp: i32, hpMax: i32, armorMelee: i16, armorRanged: i16` | Integer HP. |
| `Owner` | `playerId: ui8` | 0=Gaia, 1..N=players. |
| `Unit` | `defId: ui16` | Index into UnitDef[]. |
| `Building` | `defId: ui16, footprintW: ui8, footprintH: ui8, popProvided: ui8` | Index into BuildingDef[]. |
| `Resource` | `kind: ui8, amount: i32` | 0 Food, 1 Wood, 2 Gold, 3 Stone. |
| `ResourceCarry` | `kind: ui8, amount: ui16, capacity: ui16` | What a villager is holding. |
| `DropOff` | `acceptsMask: ui8` | Bitmask: 1=F 2=W 4=G 8=S. |
| `Gatherer` | `targetEid: eid, state: ui8, gatherRatePerTick: ui16` | 0 idle, 1 walkingTo, 2 gathering, 3 returning. |
| `BuildOrder` | `buildingDefId: ui16, tileX: i16, tileY: i16, state: ui8` | Villager's pending build. |
| `ConstructionSite` | `buildingDefId: ui16, progress: ui16, hpAtComplete: i32, buildersMask: ui32` | Foundation. |
| `ProductionQueue` | `slots: ui16[15], slotCount: ui8, currentProgress: ui16` | Up to 15 queued unit defIds. |
| `ResearchProgress` | `techId: ui16, ticksRemaining: i32` | Per-building active research. |
| `Pathfinding` | `goalX: i32, goalY: i32, requestState: ui8` | 0 none, 1 pending, 2 ready, 3 failed. |
| `PathFollower` | `pathHandle: ui32, nodeIndex: ui16, repath: ui8` | Handle into pathStore. |
| `Vision` | `radius: ui8` | Tiles. |
| `Combat` | `atk: i16, atkRanged: i16, range: ui8, attackSpeedTicks: ui16, projectileSpeedQ: ui16` | Range 0=melee. |
| `AttackTarget` | `targetEid: eid, retainGoal: ui8` | retainGoal=1 → attack-move. |
| `Cooldown` | `ticksRemaining: i16` | Generic. |
| `Garrison` | `containerEid: eid, slot: ui8` | Set when garrisoned. |
| `AIBrain` | `personality: ui8, phase: ui8, lastDecisionTick: i32` | Player-level brain. |
| `AIGoal` | `kind: ui8, paramA: i32, paramB: i32, paramC: i32` | Sub-goal. |
| `Selectable` | `flags: ui8` | Sim-side selection flag. |
| `Stance` | `mode: ui8` | 0 aggressive, 1 defensive, 2 hold-ground. |
| `Lifetime` | `ticksRemaining: i32` | Projectiles, corpses. |
| `DeadTag` | (tag only) | For cleanup system. |
| `FoundationTag` | (tag only) | Distinguishes construction from finished. |
| `Wonder` | `ticksHeld: i32, builtAtTick: i32` | Wonder timer. |
| `Unique` | `civId: ui8` | Civ-specific unit/tech. |

**Path data (out-of-band):** `PathStore = Map<pathHandle, Int32Array>` on the world. Snapshots serialize it.

**Fog of War:** per-player `Uint8Array(mapW * mapH)` on `world.fog[playerId]`. 0 unexplored, 1 explored, 2 visible.

**Resource banks:** per-player `Int32Array(4)` (F/W/G/S) on `world.resources[playerId]`.

**Tick counter:** `world.tick: i32`.

---

## 5. System List (Execution Order Per Sim Tick)

Each system is `(world, ctx) => void`. Filename numeric prefix locks import order. **Never `Math.random` — always `ctx.rng`.**

| # | System | Purpose |
|---|---|---|
| 00 | `inputSystem` | Drains pending SimInputs, applies to entities. Single mutation entry. |
| 10 | `aiSystem` | Per-AI-player tick; emits inputs (same path as human player). |
| 20 | `researchSystem` | Decrements research timers; on complete writes to player tech bitset. |
| 21 | `productionSystem` | Consumes ProductionQueue, spawns units at rally point. |
| 22 | `constructionSystem` | Builders advance ConstructionSite progress; convert to Building at 100. |
| 30 | `pathfindingSystem` | Drains batched A* requests via EasyStar; deterministic entity-id order. |
| 31 | `movementSystem` | Integer-tick movement along path nodes. Repath flag on collision. |
| 40 | `gatheringSystem` | Walk→gather→return state machine; retarget on depletion. |
| 41 | `dropoffSystem` | Credits player bank when carrier reaches drop-off. |
| 50 | `targetingSystem` | Auto-acquire targets per stance. |
| 51 | `combatSystem` | Initiates attacks if in range + cooldown=0; queues DamageEvent. |
| 52 | `damageSystem` | Applies damage with armor formula; flushes queue. |
| 60 | `visionSystem` | Recomputes per-player fog grid; emits FogChanged. |
| 70 | `deathSystem` | Tags entities at hp≤0; records score deltas. |
| 71 | `cleanupSystem` | removeEntity for DeadTag; decrement Lifetime. |
| 80 | `winConditionSystem` | Checks Conquest, Wonder timer, Independence tech. |
| 99 | `tickCounterSystem` | Increments world.tick last. |

**Why batched A* (30):** EasyStar's calculate() is interleavable but not order-deterministic. Single pump point at fixed tick position, entity-id ascending, sync-drain to cap. One deterministic path producer.

**SimContext:**
```typescript
interface SimContext {
  readonly tick: number;
  readonly dt: number;          // 1 (tick-based)
  readonly rng: SeededRng;
  readonly data: DataRegistry;
  readonly events: SimEventBus;
}
```

---

## 6. State Management Plan

Four distinct state domains. They never cross-write.

### 6.1 Sim state (authoritative)
- bitECS World + side-tables: `world.resources`, `world.fog`, `world.tech`, `world.pathStore`, `world.tick`, `world.rng`, `world.matchResult`.
- **JSON-serialisable in full.** Snapshot = `{ version, tick, rngState, soa: base64(SoA bytes), sideTables }`.
- Mutated **only** by systems inside `step(state, inputs)`.
- Pure. No `Date.now`, no `Math.random`, no DOM, no Phaser.

### 6.2 Render state (ephemeral)
- Lives in Phaser scenes + renderers.
- Camera, sprite refs, interpolation buffers, particle emitters, build-ghost preview, screen shake.
- **Never persisted, never replayed.** Recreated from sim snapshot on replay restart.

### 6.3 UI state (non-Phaser)
- Plain TS stores in `src/ui/stores/`.
- Audio volume, selected civ, control rebinds.
- Persisted to `localStorage` (settings) and `IndexedDB` (replays).

### 6.4 Persistent state
- `SettingsStore` → `localStorage.kingdoms.settings.v1`.
- `ReplayLibrary` → `IndexedDB` (replays store).
- `ProfileStore` (post-demo) → `localStorage`.

### 6.5 SimBridge

```typescript
export class SimBridge {
  constructor(private driver: SimDriver) {}

  getRenderableEntities(): RenderableSnapshot[]
  getInterpolatedPosition(eid: number, alpha: number): { x: number; y: number; dir: number }
  getResources(playerId: number): { food: number; wood: number; gold: number; stone: number }
  getPop(playerId: number): { current: number; cap: number }
  getCurrentAge(playerId: number): AgeId
  getFogState(playerId: number, tx: number, ty: number): 0 | 1 | 2
  on(event: 'unitDied' | 'buildingComplete' | 'ageUp' | 'techComplete' | 'matchEnd', fn): void
}
```

Subscribes to sim event bus once, re-emits via Phaser emitter.

### 6.6 Input flow

```
[Mouse / Keyboard / Hotkey]
        |
        v
[InputDispatcher  in /render/bridge]   ← Phaser input events
        |
        v
[SimInput object]                       ← discriminated union, JSON-safe
        |
        v
[InputQueue  on world.inputs]
        |
        v
[Next step() → inputSystem (00) drains queue]
        |
        v
[Recorder.append(tick, input)]          ← simultaneously, for replays
```

**Replay = input log + snapshot every N ticks.**

### 6.7 `window.__GAME__` debug interface

```typescript
window.__GAME__: {
  // sim
  getState(): SnapshotJson;
  setState(json: SnapshotJson): void;
  tick(n?: number): void;
  pause(): void;
  resume(): void;
  isPaused(): boolean;
  getChecksum(): number;
  getTick(): number;
  getRngState(): number;
  setSeed(seed: number): void;

  // entities
  listUnits(playerId?: number): Array<{ eid; defId; pos; hp }>;
  inspect(eid: number): Record<string, unknown>;
  kill(eid: number): void;
  spawn(defId: number, playerId: number, tx: number, ty: number): number;
  grantResources(playerId: number, f: number, w: number, g: number, s: number): void;

  // replays
  startRecording(): void;
  stopRecording(): ReplayFile;
  loadReplay(file: ReplayFile): void;

  // perf
  getMetrics(): { fps: number; tickMs: number; entityCount: number };
};
```

Installed only in dev (`import.meta.env.DEV`).

---

## 7. Data File Schema

All static game data lives as JSON in `public/assets/data/`, loaded by `PreloadScene`, frozen via `Object.freeze` by `DataRegistry.boot()`. Code references data by typed `const enum` keys, never raw strings.

### 7.1 Layout

```
public/assets/data/
├── ages.json
├── civs/         { bohemia.json, frankia.json }
├── units/        { villager.json, militia.json, archer.json, ... }
├── buildings/    { town-center.json, house.json, ... }
├── techs/        { loom.json, wheelbarrow.json, ... }
├── maps/         { arabia.json, black-forest.json }
└── scenarios/    { lechfeld.json }
```

### 7.2 Unit schema (example)

```json
{
  "id": "MILITIA",
  "displayName": "Militia",
  "trainAt": "BARRACKS",
  "trainTimeTicks": 420,
  "cost": { "food": 60, "wood": 0, "gold": 20, "stone": 0 },
  "pop": 1,
  "stats": {
    "hp": 40, "armorMelee": 0, "armorRanged": 1,
    "speedQ": 58982, "visionRadius": 6,
    "atk": 4, "atkRanged": 0, "range": 0,
    "attackSpeedTicks": 40, "projectileSpeedQ": 0
  },
  "ageRequired": "DARK",
  "upgradesTo": "MAN_AT_ARMS",
  "counters": ["ARCHER"],
  "counteredBy": ["CAVALRY", "PIKEMAN"],
  "audio": { "select": "VOX_MILITIA_SELECT", "attack": "SFX_SWORD_SWING", "death": "SFX_GRUNT_DEATH" },
  "sprite": { "atlas": "UNITS_ATLAS", "framePrefix": "militia", "anims": { "idle": 4, "walk": 8, "attack": 6, "death": 6 } }
}
```

`speedQ` and `projectileSpeedQ` are Q16.16 fixed-point.

### 7.3 Building schema

```json
{
  "id": "BARRACKS",
  "cost": { "food": 0, "wood": 175, "gold": 0, "stone": 0 },
  "hp": 1200, "armorMelee": 3, "armorRanged": 7,
  "footprint": { "w": 3, "h": 3 },
  "buildTimeTicks": 600,
  "ageRequired": "DARK",
  "trains": ["MILITIA", "SPEARMAN"],
  "researches": ["LOOM"],
  "popProvided": 0,
  "dropOff": { "food": false, "wood": false, "gold": false, "stone": false },
  "visionRadius": 6,
  "sprite": { "atlas": "BUILDINGS_ATLAS", "framePrefix": "barracks", "stages": ["foundation", "halfBuilt", "complete"] }
}
```

### 7.4 Tech / Civ / Age / Map / Scenario schemas

See full original GDD section 7. Tech `effects` is a discriminated union (`addHp`, `addArmor`, `addAtk`, `multSpeed`, `unlock`, `civUnique`) processed at research completion.

---

## 8. Asset Pipeline Strategy

Three coexisting stages — code never references PNG paths directly; only stable asset keys.

### 8.1 Manifest indirection

```typescript
// src/shared/asset-keys.ts
export const enum AssetKey {
  UNITS_ATLAS = 'units-atlas',
  BUILDINGS_ATLAS = 'buildings-atlas',
  TERRAIN_ATLAS = 'terrain-atlas',
  UI_ATLAS = 'ui-atlas',
}
```

`PreloadScene` loads the manifest selected by `VITE_ASSET_STAGE` env (default `stage1`). Renderers call `scene.add.sprite(x, y, AssetKey.UNITS_ATLAS, 'villager_walk_e_0')`. Frame names stable across stages.

### 8.2 Stage 0 — coloured shapes
- Generated at build time by `scripts/gen-stage0-atlas.ts` (node-canvas).
- Coloured iso diamonds (terrain), filled polys with letter labels (units), boxes (buildings).
- Identical frame names to Stage 1.

### 8.3 Stage 1 — Kenney Medieval RTS
- Unpacked into `art-source/kenney-medieval-rts/`.
- Packed by `scripts/pack-stage1.ts` (TexturePacker JSON-array).
- Frame-name mapping in `art-source/kenney-mapping.json`.

### 8.4 Stage 2 — voxel custom units
- Current implementation uses TypeScript voxel model builders in `src/render/voxel/models/`.
- `src/render/voxel/voxel-render.ts` bakes `Voxel[]` directly into Phaser textures at scene boot.
- Animated directional units bake 8 facings x action states x frame counts. Scout cavalry and villager are the reference implementations.
- See `docs/VOXEL_SPRITE_PIPELINE.md` before adding or converting unit sprites.

### 8.5 Aseprite JSON
`this.load.aseprite(key, png, json)` + `this.anims.createFromAseprite(key)`. Anim names: `<defId>_<state>_<dir>`.

### 8.6 Audio pairs
Every key loads both `.mp3` and `.ogg`; Phaser picks best per browser.

### 8.7 Lazy-load by age
`PreloadScene` loads through Castle Age. Later ages load in background while gameplay starts. Sim never depends on art.

---

## 9. Determinism & Replay Plan

### 9.1 The five rules
1. **No floats for sim positions/velocities** — Q16.16 `i32`.
2. **No `Math.random` in /sim** — `ctx.rng` only (lint enforced).
3. **No `Date.now()` / `performance.now()`** in /sim. Time is `world.tick`.
4. **Deterministic iteration order** — sort by entity id where intra-tick ordering matters.
5. **No async inside a tick.** EasyStar drained synchronously.

### 9.2 Fixed-timestep driver

```typescript
export class SimDriver {
  private accumulator = 0;
  private readonly TICK_MS = 50;      // 20 Hz
  private readonly MAX_CATCHUP_TICKS = 5;

  update(realDtMs: number): void {
    this.accumulator += Math.min(realDtMs, 250);
    let ticks = 0;
    while (this.accumulator >= this.TICK_MS && ticks < this.MAX_CATCHUP_TICKS) {
      const inputs = this.world.inputs.drain();
      this.recorder?.append(this.world.tick, inputs);
      step(this.world, inputs);
      this.accumulator -= this.TICK_MS;
      ticks++;
    }
  }
}
```

Render interpolates `world.tick - 1 → world.tick` via `accumulator / TICK_MS` alpha.

### 9.3 RNG (Mulberry32)
State is 32-bit, included in every snapshot. Replays start with `setState(replay.initialRngState)`.

### 9.4 Replay file format

```typescript
export interface ReplayFile {
  version: 1;
  createdAt: string;
  game: { seed, mapId, civs, aiTiers, dataVersion };
  ticks: number;
  inputs: Array<{ t: number; in: SimInput }>;
  snapshots: Array<{ t: number; data: string }>;     // every 1200 ticks (1 min)
  checksums: Array<{ t: number; c: number }>;        // every 200 ticks (10 s)
  result?: { outcome; winnerPlayerId };
}
```

URL-share encodes inputs + seed (no snapshots) into URL fragment via gzip + base64url.

### 9.5 MP-ready glue
Lockstep architecture already in place. Future `NetworkDriver` replaces local SimDriver — same `/sim`, same `/render`. Only `main.ts` swaps driver subclass.

---

## 10. Testing Strategy

Vitest. Fast, ESM-native. /sim tests run in Node (no DOM).

### 10.1 Layout

```
tests/
├── sim/              ← unit (components, systems, pathfinding, rng, snapshot, data)
├── integration/      ← deterministic-60s-match, replay-roundtrip, ai-vs-ai, desync-detection, win-conditions
├── render/           ← iso-projection, sim-bridge interpolation
└── fixtures/         ← canned-world-tick-0, replays, frozen data-snapshot-v1
```

### 10.2 Flagship integration test

```typescript
it('produces identical checksum across 100 runs from the same seed + inputs', () => {
  const checksums: number[] = [];
  for (let run = 0; run < 100; run++) {
    const world = createWorld({ seed: 12345, mapId: 'ARABIA', civs: { 1: 'BOHEMIA', 2: 'FRANKIA' }, aiTiers: { 1: 'standard', 2: 'standard' } });
    for (let t = 0; t < 1200; t++) {
      world.inputs.pushAll(canonicalReplay.inputs.filter(i => i.t === t).map(i => i.in));
      step(world);
    }
    checksums.push(fnv1a32Checksum(world));
  }
  expect(new Set(checksums).size).toBe(1);
  expect(checksums[0]).toBe(0xA1B2C3D4); // regenerated when canonical replay regenerates
});
```

Non-negotiable gate for every sim PR.

### 10.3 Custom lint rules
- `no-phaser-in-sim`
- `no-math-random-in-sim`
- `no-date-now-in-sim`

### 10.4 Coverage
- /sim systems ≥85%
- /sim pathfinding + rng + snapshot 100%
- /render smoke tests only

---

## 11. Implementation Order

1. **Phase 0 — Shared scaffolding.** Enums, rng, checksum, configs, lint with sim rules.
2. **Phase 1 — Sim skeleton.** bitECS world, all components, empty systems, step(), snapshot, RNG, replay types.
3. **Phase 2 — Phaser shell.** GameConfig, BootScene → PreloadScene → TitleScene, manifest, window.__GAME__ shell.
4. **Phase 3 — Iso world + Stage 0 art.** TerrainRenderer, IsoProjection, CameraController, Stage-0 atlas generator.
5. **Phase 4 — First entity loop.** Villager unit def, click-select, right-click move, EasyStar pathfinding.
6. **Phase 5 — Gathering + economy.** Resources, Gatherer, DropOff, ResourceBar HUD.
7. **Phase 6 — Building + production.** ConstructionSite, BuildGhost, ProductionQueue, House + Mill + TC.
8. **Phase 7 — Combat.** Militia, Combat/AttackTarget/Cooldown/Damage, projectile renderer, death.
9. **Phase 8 — Fog of war + vision.**
10. **Phase 9 — Age progression + tech.** Research, AgeUp tech, Feudal + Castle unlocks.
11. **Phase 10 — AI opponent.** Standard build order, scouting, attack at Feudal.
12. **Phase 11 — Replay system.** Recorder + Player + ReplayBrowser + URL-share.
13. **Phase 12 — Stage 1 asset swap.** Manifest swap to Kenney, no code edits.
14. **Phase 13 — Late ages.** Imperial → Gunpowder → Industrial content.
15. **Phase 14 — Republic Age + Independence win.** 1918 cinematic.
16. **Phase 15 — Polish.** Audio, accessibility, settings, scenario, post-game stats.

After each phase, regenerate canonical replay if sim behaviour intentionally changed; otherwise checksum gate stays locked.

---

## 12. Phaser 4 Gotchas — RTS-Specific

- **`Phaser.Geom.Point` removed.** Use `Phaser.Math.Vector2`.
- **`Phaser.Structs.Map/Set` removed.** Use native.
- **`DynamicTexture` requires explicit `.render()`** — Minimap + FogOfWar.
- **`Math.PI2` gone.** Use `Math.TAU`.
- **No physics block in GameConfig.** Collision is `/sim/pathfinding/grid.ts`.
- **HUDScene MUST be `scene.launch`** (parallel), never `scene.start` (which stops calling scene).
- **`pixelArt: false` + `roundPixels: true`** — crisper iso edges without nearest-neighbour scaling.

---

## 13. Open Questions Deferred

- **Navmesh upgrade** if pop cap >1000.
- **Server-authoritative MP** variant alongside lockstep (cheat-resistant).
- **WASM hot path** for pathfinding + targeting if sim exceeds 10 ms/tick budget at 400 units.
- **Save/load mid-match.** Hooks exist in SimDriver; UI TBD.

---

## 14. Summary

Everything stateful and rule-bound goes into `/sim` (pure, testable, deterministic, MP-ready). Everything visual goes into `/render` (Phaser scenes + renderers, read sim via SimBridge). JSON data files mean balance changes ship without code edits. Four state domains (sim / render / UI / persistent) never cross-write. Replays = inputs + periodic snapshots; canonical-replay checksum test is the determinism gate. Three swap-in stages for art ride a manifest-of-asset-keys indirection.

> **Note:** the Stage 0 prototype as shipped diverges intentionally from a few of these rules (uses f32 not Q16.16, single GameScene instead of full scene graph, no manifest indirection) — these will be refactored toward this architecture before multiplayer/replay work begins (Phase 11+). For Phases 0-10 the current scaffold is a sufficient foundation.
