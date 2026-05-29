# Kingdoms — Multiplayer Plan & Readiness Audit

> **Status:** Audit (2026-05-28) — ground-truthed against the shipped code, not just `docs/ARCHITECTURE.md`.
> **Model:** Lockstep (clients run their own sim; server relays only input/commands).
> **Bottom line:** The hard-to-retrofit foundations (pure reducer, serializable command queue, fixed-timestep driver, seeded RNG, sim/render split) are already in place. The blocker is **cross-machine determinism**, which the prototype traded away (floats + `Math.hypot`/`sin`/`cos` instead of the planned Q16.16 integer math — see `ARCHITECTURE.md:643`). This is a "convert the math + add a thin netcode layer" project, not an engine rewrite.

---

## How lockstep works (the model we chose)

Every client runs the **full simulation locally**; only **player commands** cross the wire. All clients apply the same commands on the same tick, so they all compute the same world. The server is a **dumb low-bandwidth relay** (kilobits, not state streams). The cost: if any client's state differs by a single bit, clients silently diverge ("desync") and the match is ruined. Two ironclad requirements follow:

1. **Perfect cross-machine determinism** of `step()`.
2. **Input synchronization** — commands scheduled to a common future tick, with a small delay to absorb latency.

> Alternative — *server-authoritative* (server runs the sim, streams state): cheat-resistant and tolerant of non-determinism, but far more bandwidth/CPU and needs a real server. Our codebase is shaped for lockstep, so this plan targets lockstep.

---

## ✅ Already in place (the expensive-to-retrofit parts)

| Capability | Status | Evidence |
|---|---|---|
| Pure reducer `step(world)` — "same world + same inputs → same next state" | ✅ | `world.ts:2708-2713` |
| **Serializable command queue** — scene pushes discriminated-union commands; `step()` drains them; scene never mutates world directly | ✅ | `world.inputs: SimInput[]` (`world.ts:527`); drain loop `world.ts:2727-2731`; pushes at `game-scene.ts:1336-2082` |
| Fixed-timestep accumulator driver, decoupled from render | ✅ | `game-scene.ts:551-559`; 20 Hz (`config.ts: TICK_HZ:20, TICK_MS:50`) |
| Render interpolation (alpha lerp) separate from sim | ✅ | `game-scene.ts:844-846`; `PrevPosition` component |
| Seeded deterministic RNG (Mulberry32, integer ops, get/setState) | ✅ | `rng.ts` |
| No `Math.random` / `Date.now` / `performance.now` in sim | ✅ | grep: 0 hits in `src/sim` (excl. tests) |
| sim/render separation (zero Phaser imports in `/sim`) | ✅ | confirmed |
| Full world snapshot serializer (entities, resources, fog, AI, paths, map) | ✅ | `save-load.ts: SavedGameV1`, `serializeSimWorld()` |

The command-queue + pure-reducer + fixed-timestep trio is ~70% of a lockstep skeleton and is the part most teams get wrong. It's already correct here.

---

## ❌ Missing or broken (the actual work, ordered by effort)

### 1. Cross-machine determinism — the big one
- Positions/velocities are `Types.f32` floats, not the planned Q16.16 fixed-point (`components.ts:10-29`).
- Spatial math leans on **`Math.hypot` (60+ calls)**, plus `Math.sin`/`cos` (`world.ts:6918,7097`), `Math.pow` (`world.ts:4573`), and `hypot`/`sin`/`cos` throughout `map-gen.ts`.
- **Precise problem:** IEEE-754 `+ - * /` and even `Math.sqrt` *are* correctly-rounded and identical across V8/SpiderMonkey/JSC. The offenders are the **transcendental/compound functions** — `hypot`, `sin`, `cos`, `pow`, `atan2` — which are **not** bit-identical across engines or platform libms. Two players on Chrome vs Firefox will desync. Determinism *within one engine* holds (so single-machine replays would work).

### 2. Commands are selection-relative, not self-describing
Half the `SimInput` union (`world.ts:233-246`) — `moveSelected`, `attackSelected`, `gatherSelected`, `stopSelected`, `attackMoveSelected` — carries no `playerId` and no actor IDs; it acts on `commandableSelection(world)` (local selection + `LOCAL_PLAYER_ID`). Selection lives on the client, so over the wire `moveSelected {to}` is meaningless to a peer. Each command must become `{playerId, eids:[…], …}`. (~7 command types; 74 selection/`LOCAL_PLAYER_ID` couplings in `world.ts` to unwind.)

### 3. RNG state isn't in the snapshot
`save-load.ts` serializes tick/entities/resources but **not** `rng.getState()`. Replays and join-snapshots will diverge without it. Small fix, real correctness hole.

### 4. No world checksum / desync detection
`checksum.ts` doesn't exist. Lockstep needs a periodic hash of world state compared across clients to catch divergence the instant it happens.

### 5. No determinism test gate
The doc's flagship "100-run identical checksum" test was never built. We're currently flying blind on the property the whole feature depends on.

### 6. No netcode layer
No transport, no input-delay buffer (apply at `tick+N`), no turn/stall handling when a peer is late, no join-snapshot + catch-up. This is the `NetworkDriver` (`ARCHITECTURE.md:544` — "Only main.ts swaps driver subclass" is true *once* items 1-5 are done).

### 7. No lobby/session layer
Create/join, seed agreement, slot assignment, connect/reconnect, disconnect handling.

### 8. Map generation is non-deterministic too
`map-gen.ts` uses sin/cos/sqrt/hypot. Cleanest fix: **host generates the map and ships it in the join snapshot** (save-load already serializes the map), so map-gen never needs to be cross-engine deterministic.

---

## The determinism fix — two paths (pick empirically)

Build the checksum + **cross-engine** test first (cheap), then:

- **Path A — "deterministic float subset" (cheaper, faster, riskier).** Purge transcendentals only: replace `Math.hypot(dx,dy)` with `Math.sqrt(dx*dx+dy*dy)` (sqrt *is* deterministic), swap the handful of `sin/cos/pow` for LUTs or integer approximations, keep `f32`. Validate with the cross-engine checksum test across Chrome+Firefox+Safari+Node. If it passes, done in a fraction of the time. Risk: a stray transcendental/edge case slips through; can't *guarantee* it the way integers can.
- **Path B — Q16.16 fixed-point (robust, more work).** The documented plan. Guaranteed identical everywhere, but invasive: every distance check, movement integration, and combat calc gets reworked, and **gameplay feel will shift** (re-tune speeds/ranges). This is exactly why it was deferred.

**Pragmatic call:** try A, fall back to B where A proves flaky. The checksum test lets you decide with evidence, not faith. Bonus: a green determinism gate also yields **shareable replays** (a GDD selling point) for free — replays are lockstep minus the network.

---

## Hosting options

The game bundle stays where it is (static host / publish-site). The only new infra lockstep needs is a low-bandwidth **input relay + a bit of session coordination**.

| Option | What it is | Fit / pros | Cons |
|---|---|---|---|
| **A. WebSocket relay on pfc-1** (fastest start) | Tiny Node/Python `ws` process behind Apache at `wss://reporting.palefire.com/kingdoms-mp/`, proxied like the MCP SSE endpoint | Infra we own; full control; ~zero marginal cost; known proxy pattern | Long-lived process to monitor; single region; needs TLS proxy + supervision (a `systemd`/`pm2` service, not a wrapper cron) |
| **B. Cloudflare Workers + Durable Objects** (best long-term; GDD's pick) | One Durable Object = one authoritative match room holding the tick/turn buffer; WebSocket hibernation API | Serverless, global edge latency, scales to zero, ~free at hobby scale, no box to babysit | New platform/account; vendor-specific code; DO billing if it grows |
| **C. WebRTC DataChannel P2P** (best for 1v1) | Clients connect directly; only a tiny signaling endpoint hosted (pfc-1 or a Worker) | Lowest latency; near-zero hosting cost | NAT traversal needs STUN, sometimes TURN (costs money/server); mesh awkward past 2 players |
| **D. Supabase Realtime** (least new infra) | Relay input packets over a Realtime broadcast channel — we already run Supabase | Almost no new infra; reuses project + auth | Built for presence/broadcast, not low-latency turns — extra latency + ordering caveats; needs a spike to prove it's good enough at 20 Hz |
| **E. Managed game host** (Colyseus; or WS on Fly.io/Render) | Purpose-built room server, multi-region | Colyseus is RTS-shaped; multi-region | Another managed service + bill |

**Recommendation:** prototype the `NetworkDriver` against an **in-process loopback relay first** (two browser tabs, no hosting) — ~80% of the netcode can be built/tested with zero infra. For real peers: start with **A** (we control it, known proxy pattern, no extra cost) for private playtests; graduate to **B** for global low-latency + zero-ops. If 1v1-first and latency-obsessed, **C**. **D** is worth a half-day spike since it's the least new infra we own.

---

## Suggested de-risked sequence

1. Build `checksum.ts` + the **cross-engine** determinism test. *(Days. The truth oracle.)*
2. Kill cross-machine non-determinism (Path A, fall back to B) + ship map in snapshot. **← dominates the schedule**
3. Make commands self-describing (`+playerId, +eids`) and put RNG state in the snapshot. *(Days–1 wk.)*
4. `NetworkDriver` against a loopback relay: input-delay buffer (`tick+3`), stall handling, join-snapshot + catch-up. *(1–2 wks.)*
5. Stand up the relay (pick hosting above) + minimal lobby. *(Days.)*
6. Playtest 1v1 → N-player; watch the checksum stream for desyncs.

**Honest effort read:** steps 1, 3, 5 are days each; step 4 is a week or two; **step 2 is the multi-week wildcard** — auditing a 7,594-line spatial sim for bit-determinism is invasive and bug-prone, and is the reason it was deferred. Everything else is comparatively mechanical because the command-queue and pure-reducer foundations are already correct.
