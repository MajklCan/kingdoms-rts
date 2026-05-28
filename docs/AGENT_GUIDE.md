# Kingdoms — AI Agent Developer Guide

Welcome, Agent! Before modifying this codebase, review this guide to understand constraints, active divergences, and how to verify your changes.

---

## 1. Core Simulation Rules (Determinism)

To support lockstep multiplayer and replay files, everything under `/src/sim/` MUST remain perfectly deterministic. The simulation runs at a fixed 20 Hz (1 tick = 50 ms).

*   **No Phaser**: Do not import `phaser` or anything from `src/render/` into `/src/sim/`. The simulation is a pure data-and-systems layer (using bitECS).
*   **No Math.random()**: Never use the global `Math.random()`. Use the seeded RNG attached to the world (`world.rng.next()`).
*   **No Date.now() / performance.now()**: Never use wall-clock time in `/src/sim/`. Time is measured strictly in simulation ticks (`world.tick`).
*   **Deterministic iteration order**: When iterating over ECS entities in a way that affects state mutations, sort or process them in ascending order of Entity ID (`eid`) to ensure order-of-execution is identical on all clients.

---

## 2. Active Architectural Divergences

The codebase is currently in a transition state from the "Stage 0 prototype" to the "Production architecture". Keep these mismatches in mind:

*   **Float Coordinates**: Although `docs/ARCHITECTURE.md` states the sim uses Q16.16 fixed-point math, the current code still uses floating-point coordinates (`f32`) for `Position`, `PrevPosition`, `Velocity`, and `Speed`. Do NOT attempt to use fixed-point math unless you are explicitly tasked with performing the Q16.16 conversion.
*   **Static Tables**: Game definitions (units, buildings, ages) live as TypeScript structures in `src/sim/defs.ts` and `src/sim/tech-tree.ts` rather than JSON files in `public/assets/data/`.
*   **Monolithic Files**: The core of the sim lives in a single large file `src/sim/world.ts` (~5,100 lines), and the main renderer is in `src/render/game-scene.ts` (~3,700 lines). Be extremely precise when using code editing tools on these files.

---

## 3. How to Verify and Debug

### Running Tests
Always run `npm test` before concluding your task. The test suite contains 50+ unit and integration tests that validate pathfinding, combat formations, tech trees, and save-load roundtrips.
```bash
npm test
```

### Dev Server
To start the developer server:
```bash
npm run dev
```

### Console Debug API (`window.__GAME__`)
When running the game in development mode, the global `window.__GAME__` object is installed. You can open the browser console and run helper methods to inspect and manipulate the game state:
*   `window.__GAME__.getTick()`: Returns current simulation tick.
*   `window.__GAME__.listUnits(playerId)`: Lists all active units for a player.
*   `window.__GAME__.inspect(eid)`: Dumps the bitECS component values for a specific entity.
*   `window.__GAME__.kill(eid)`: Instantly kills an entity.
*   `window.__GAME__.spawn(defId, playerId, tx, ty)`: Spawns a unit.
*   `window.__GAME__.grantResources(playerId, f, w, g, s)`: Adds resources to a player bank.
*   `window.__GAME__.pause()` / `window.__GAME__.resume()`: Controls the simulation driver.
*   `window.__GAME__.getChecksum()`: Returns current FNV-1a checksum of the sim world.
