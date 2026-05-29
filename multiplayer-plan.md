# Kingdoms — Multiplayer Plan & Readiness Audit

> **Status:** Audit (2026-05-28, line refs re-verified 2026-05-29) — ground-truthed against the shipped code, not just `docs/ARCHITECTURE.md`. All blockers still open; nothing multiplayer landed. Line numbers shifted after the audio merge grew `world.ts` 7,594→8,147.
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
| Pure reducer `step(world)` — "same world + same inputs → same next state" | ✅ | `world.ts:3071-3073` |
| **Serializable command queue** — scene pushes discriminated-union commands; `step()` drains them; scene never mutates world directly | ✅ | `world.inputs: SimInput[]` (`world.ts:558`); drain loop `world.ts:3088-3091`; pushes at `game-scene.ts:1715-3703` |
| Fixed-timestep accumulator driver, decoupled from render | ✅ | `game-scene.ts:625-629`; 20 Hz (`config.ts: TICK_HZ:20, TICK_MS:50`) |
| Render interpolation (alpha lerp) separate from sim | ✅ | `game-scene.ts:919-924`; `PrevPosition` component |
| Seeded deterministic RNG (Mulberry32, integer ops, get/setState) | ✅ | `rng.ts` |
| No `Math.random` / `Date.now` / `performance.now` in sim | ✅ | grep: 0 hits in `src/sim` (excl. tests) |
| sim/render separation (zero Phaser imports in `/sim`) | ✅ | confirmed |
| Full world snapshot serializer (entities, resources, fog, AI, paths, map) | ✅ | `save-load.ts: SavedGameV1`, `serializeSimWorld()` |

The command-queue + pure-reducer + fixed-timestep trio is ~70% of a lockstep skeleton and is the part most teams get wrong. It's already correct here.

---

## ❌ Missing or broken (the actual work, ordered by effort)

### 1. Cross-machine determinism — the big one
- Positions/velocities are `Types.f32` floats, not the planned Q16.16 fixed-point (`components.ts:10-29`).
- Spatial math leans on **`Math.hypot` (58 calls)**, plus `Math.sin`/`cos` (`world.ts:7471-7472,7650-7651`), `Math.pow` (`world.ts:4938`), and `hypot`/`sin`/`cos` throughout `map-gen.ts`.
- **Precise problem:** IEEE-754 `+ - * /` and even `Math.sqrt` *are* correctly-rounded and identical across V8/SpiderMonkey/JSC. The offenders are the **transcendental/compound functions** — `hypot`, `sin`, `cos`, `pow`, `atan2` — which are **not** bit-identical across engines or platform libms. Two players on Chrome vs Firefox will desync. Determinism *within one engine* holds (so single-machine replays would work).

### 2. Commands are selection-relative, not self-describing
Half the `SimInput` union (`world.ts:237-250`) — `moveSelected`, `attackSelected`, `gatherSelected`, `stopSelected`, `attackMoveSelected` — carries no `playerId` and no actor IDs; it acts on `commandableSelection(world)` (local selection + `LOCAL_PLAYER_ID`). Selection lives on the client, so over the wire `moveSelected {to}` is meaningless to a peer. Each command must become `{playerId, eids:[…], …}`. (~7 command types; 79 selection/`LOCAL_PLAYER_ID` couplings in `world.ts` to unwind.)

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

The game bundle stays where it is (static host / publish-site). The only new infra lockstep needs is a low-bandwidth **input relay + a bit of session coordination**. We self-host on **Coolify** — a relay is a long-lived container, exactly what Coolify manages.

| Option | What it is | Fit / pros | Cons |
|---|---|---|---|
| **A. Self-hosted WS relay on Coolify** (recommended) | ~100-line Node `ws` server + Dockerfile, deployed as a Coolify app | Self-hosted, zero vendor lock, ~zero marginal cost; Coolify handles TLS (auto Let's Encrypt), domain, restart-on-crash, logs, GitHub redeploy — no manual `systemd`/`pm2`; **collapses old "private host" + "global host" steps into one box we own**; same container loopback-dev → prod, just swap URL | Single region (one box) → not ideal for global low-latency; WebSocket needs enabling in Coolify (Traefik labels; sticky sessions if multi-instance) |
| **B. Colyseus on Coolify** | Purpose-built RTS room server, self-hosted as a Coolify container | Rooms / matchmaking / presence out-of-box; RTS-shaped | Overkill for a dumb lockstep relay (relay = "broadcast input to room"); more framework than needed |
| **C. WebRTC DataChannel P2P** (best for 1v1) | Clients connect directly; only a tiny signaling endpoint on Coolify | Lowest latency; near-zero hosting cost; STUN free (Google public) | TURN fallback for bad NAT needs a `coturn` container (also Coolify-able, but more setup); mesh awkward past 2 players |
| **D. Cloudflare Workers + Durable Objects** (global, not self-hosted) | One Durable Object = one match room; WebSocket hibernation API | Serverless, global edge latency, scales to zero, ~free at hobby scale | Vendor-specific code + account; only worth it if global low-latency becomes a hard requirement |
| **E. Supabase Realtime** | Relay input over a Realtime broadcast channel | Almost no new infra if Supabase already running | Built for presence/broadcast, not low-latency turns — extra latency + ordering caveats at 20 Hz |

**Recommendation:** prototype the `NetworkDriver` against an **in-process loopback relay first** (two browser tabs, no hosting) — ~80% of the netcode can be built/tested with zero infra. For real peers: **A — self-hosted WS relay on Coolify.** Owning Coolify removes the need for both the old manual pfc-1 setup and Cloudflare DO — Coolify does the ops (TLS/restart/deploy) that those steps did by hand. Path: `loopback (0 infra, dev) → WS relay container on Coolify (prod)`. Single region (own box) is fine for private/community play; only reach for **D** if global low-latency becomes a real requirement, or **C** if 1v1-first and latency-obsessed.

---

## Suggested de-risked sequence

1. Build `checksum.ts` + the **cross-engine** determinism test. *(Days. The truth oracle.)*
2. Kill cross-machine non-determinism (Path A, fall back to B) + ship map in snapshot. **← dominates the schedule**
3. Make commands self-describing (`+playerId, +eids`) and put RNG state in the snapshot. *(Days–1 wk.)*
4. `NetworkDriver` against a loopback relay: input-delay buffer (`tick+3`), stall handling, join-snapshot + catch-up. *(1–2 wks.)*
5. Stand up the relay (self-hosted WS container on Coolify — see hosting) + minimal lobby. *(Days.)*
6. Playtest 1v1 → N-player; watch the checksum stream for desyncs.

**Honest effort read:** steps 1, 3, 5 are days each; step 4 is a week or two; **step 2 is the multi-week wildcard** — auditing an 8,147-line spatial sim for bit-determinism is invasive and bug-prone, and is the reason it was deferred. Everything else is comparatively mechanical because the command-queue and pure-reducer foundations are already correct.
