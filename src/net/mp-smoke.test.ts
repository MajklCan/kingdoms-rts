/**
 * Multiplayer end-to-end smoke test (headless, no real WebSocket).
 *
 * Drives TWO MultiplayerSession instances against each other through a paired
 * in-memory Transport that emulates the relay (relay/server.mjs) for a 2-slot
 * room, plays a 1v1, and asserts the lockstep invariants:
 *   1. no desync — checksums stay in parity (onDesync never fires + explicit
 *      end-of-run checksum compare matches),
 *   2. liveness — both sessions stay 'playing', tick counts converge,
 *   3. effect — sampled commands mutate the world identically on both clients.
 *
 * Each command type is exercised in its OWN test (a matrix) so a failure names
 * the offending command, plus one combined run to catch interaction desyncs.
 * This is the regression guard for the bug class that broke MP: selection-
 * relative commands leaking onto the wire, hardcoded guest playerId, and local
 * pause diverging tick counts.
 */
import { describe, expect, it } from 'vitest';
import { MAP, SIM } from '../config';
import { checksumWorld } from '@sim/checksum';
import {
  buildingQuery,
  findBuildingAt,
  findResourceAt,
  resourceQuery,
  townCenterQuery,
  unitQuery,
  type SimWorld,
} from '@sim/world';
import { Building, Owner, Position, UnitKindId, UnitStance, UnitStanceId } from '@sim/components';
import { BuildingDefId } from '@sim/defs';
import { MultiplayerSession, type SessionCallbacks } from './session';
import type { Transport } from './transport';
import {
  CHECKSUM_INTERVAL_TICKS,
  PROTOCOL_VERSION,
  type ClientMessage,
  type PlayerSlot,
  type ServerMessage,
} from './protocol';

const MAX_SLOTS = 2;

/** Synchronous, ordered in-memory relay shim mirroring relay/server.mjs. */
class RelayShim {
  started = false;
  readonly clients = new Map<number, PairedTransport>();

  private nextSlot(): number | null {
    for (let id = 1; id <= MAX_SLOTS; id++) if (!this.clients.has(id)) return id;
    return null;
  }
  private roster(): PlayerSlot[] {
    return [...this.clients.entries()]
      .map(([playerId, t]) => ({ playerId, name: t.name ?? `Player ${playerId}` }))
      .sort((a, b) => a.playerId - b.playerId);
  }
  private broadcast(msg: ServerMessage, except: number | null = null): void {
    for (const [pid, t] of this.clients) {
      if (pid === except) continue;
      t.receive(msg);
    }
  }
  handle(from: PairedTransport, msg: ClientMessage): void {
    switch (msg.t) {
      case 'join': {
        if (msg.v !== PROTOCOL_VERSION) return from.receive({ t: 'error', message: 'protocol mismatch' });
        if (this.started) return from.receive({ t: 'error', message: 'match already started' });
        const slot = this.nextSlot();
        if (slot === null) return from.receive({ t: 'error', message: 'room full' });
        from.playerId = slot;
        this.clients.set(slot, from);
        from.receive({
          t: 'joined',
          v: PROTOCOL_VERSION,
          room: 'room',
          playerId: slot,
          isHost: slot === 1,
          players: this.roster(),
        });
        this.broadcast({ t: 'roster', players: this.roster() });
        return;
      }
      case 'start':
        if (from.playerId !== 1 || this.started) return;
        this.started = true;
        this.broadcast({ t: 'start', seed: msg.seed | 0, players: this.roster() });
        return;
      case 'turn':
        for (const [pid, t] of this.clients) {
          if (pid === from.playerId) continue;
          t.receive({ t: 'turn', playerId: from.playerId!, forTick: msg.forTick, cmds: msg.cmds });
        }
        return;
      case 'checksum':
        this.broadcast({ t: 'checksum', playerId: from.playerId!, tick: msg.tick, hash: msg.hash }, from.playerId);
        return;
    }
  }
}

class PairedTransport implements Transport {
  playerId: number | null = null;
  name: string | null = null;
  private msgCb: ((msg: ServerMessage) => void) | null = null;
  private openCb: (() => void) | null = null;
  private closeCb: (() => void) | null = null;
  constructor(private readonly relay: RelayShim) {}
  send(msg: ClientMessage): void {
    if (msg.t === 'join') this.name = msg.name;
    this.relay.handle(this, msg);
  }
  onMessage(cb: (msg: ServerMessage) => void): void {
    this.msgCb = cb;
  }
  onOpen(cb: () => void): void {
    this.openCb = cb;
  }
  onClose(cb: () => void): void {
    this.closeCb = cb;
  }
  close(): void {
    this.closeCb?.();
  }
  receive(msg: ServerMessage): void {
    this.msgCb?.(msg);
  }
  fireOpen(): void {
    this.openCb?.();
  }
}

interface Captured {
  world: SimWorld | null;
  localId: number;
  desync: boolean;
  desyncInfo: string;
  state: string;
}
function makeCapture(): Captured {
  return { world: null, localId: 0, desync: false, desyncInfo: '', state: 'connecting' };
}
function callbacks(cap: Captured): SessionCallbacks {
  return {
    onStateChange: (s) => {
      cap.state = s;
    },
    onMatchStart: (world, id) => {
      cap.world = world;
      cap.localId = id;
    },
    onDesync: (tick, local, peer, peerId) => {
      if (!cap.desync) cap.desyncInfo = `tick ${tick}: local ${local} vs P${peerId} ${peer}`;
      cap.desync = true;
    },
  };
}

function ownedUnits(world: SimWorld, pid: number): number[] {
  return unitQuery(world.ecs).filter((e) => Owner.player[e] === pid);
}
function ownedBuildings(world: SimWorld, pid: number): number[] {
  return buildingQuery(world.ecs).filter((e) => Owner.player[e] === pid);
}
function ownTownCenter(world: SimWorld, pid: number): number | undefined {
  return townCenterQuery(world.ecs).find((e) => Owner.player[e] === pid);
}
function buildableTileNear(world: SimWorld, cx: number, cy: number): { x: number; y: number } | null {
  for (let r = 2; r < 12; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = Math.round(cx) + dx;
        const y = Math.round(cy) + dy;
        if (x < 1 || y < 1 || x >= MAP.WIDTH - 1 || y >= MAP.HEIGHT - 1) continue;
        if (world.map.walkability[y][x] !== 0) continue;
        if (findBuildingAt(world, x, y, 1.2) !== null) continue;
        if (findResourceAt(world, x, y, 0.8) !== null) continue;
        return { x, y };
      }
    }
  }
  return null;
}

interface MatchCtx {
  sessA: MultiplayerSession;
  sessB: MultiplayerSession;
  worldA: SimWorld;
  worldB: SimWorld;
  capA: Captured;
  capB: Captured;
  pumpN: (n: number) => void;
  settle: () => void;
  /** [session, its world, its playerId, opponent playerId] for both players. */
  sides: ReadonlyArray<readonly [MultiplayerSession, SimWorld, number, number]>;
}

function setupMatch(seed = 12345): MatchCtx {
  const relay = new RelayShim();
  const tA = new PairedTransport(relay);
  const tB = new PairedTransport(relay);
  const capA = makeCapture();
  const capB = makeCapture();
  const sessA = new MultiplayerSession(tA, 'room', 'Alice', callbacks(capA));
  const sessB = new MultiplayerSession(tB, 'room', 'Bob', callbacks(capB));
  tA.fireOpen();
  tB.fireOpen();
  sessA.start(seed);
  const worldA = capA.world!;
  const worldB = capB.world!;
  // These two worlds live in one process, so their raw bitECS eids are offset.
  // The relay deliberately does not translate them; MultiplayerSession must
  // encode command payloads with deterministic per-world NetIds.
  // Grant resources identically at tick 0 so economic commands can take effect
  // while parity is preserved (FOOD=0 WOOD=1 GOLD=2 STONE=3).
  for (const w of [worldA, worldB]) for (const pid of [1, 2]) w.resources[pid].fill(5000);
  const pump = () => {
    sessA.update(SIM.TICK_MS);
    sessB.update(SIM.TICK_MS);
  };
  const pumpN = (n: number) => {
    for (let i = 0; i < n; i++) pump();
  };
  const settle = () => {
    for (let i = 0; i < 4; i++) {
      sessA.update(0);
      sessB.update(0);
    }
  };
  pumpN(8); // warm up past the input-delay boundary
  settle();
  return {
    sessA,
    sessB,
    worldA,
    worldB,
    capA,
    capB,
    pumpN,
    settle,
    sides: [
      [sessA, worldA, 1, 2],
      [sessB, worldB, 2, 1],
    ],
  };
}

function assertParity(ctx: MatchCtx): void {
  ctx.pumpN(CHECKSUM_INTERVAL_TICKS * 3);
  ctx.settle();
  expect(ctx.capA.desync, `A ${ctx.capA.desyncInfo}`).toBe(false);
  expect(ctx.capB.desync, `B ${ctx.capB.desyncInfo}`).toBe(false);
  expect(ctx.sessA.state).toBe('playing');
  expect(ctx.sessB.state).toBe('playing');
  expect(ctx.worldA.tick).toBe(ctx.worldB.tick);
  expect(checksumWorld(ctx.worldA)).toBe(checksumWorld(ctx.worldB));
}

/** One issuer per command type; issues the command from BOTH players against
 *  their own freshly-resolved eids. */
const SCENARIOS: ReadonlyArray<{ name: string; issue: (ctx: MatchCtx) => void }> = [
  {
    name: 'placeBuilding',
    issue: ({ sides }) => {
      for (const [sess, world, pid] of sides) {
        const tc = ownTownCenter(world, pid);
        if (tc === undefined) continue;
        const tile = buildableTileNear(world, Position.x[tc], Position.y[tc]);
        if (tile) sess.sendCommand({ type: 'placeBuilding', defId: BuildingDefId.HOUSE, x: tile.x, y: tile.y, playerId: pid });
      }
    },
  },
  {
    name: 'cmdMove',
    issue: ({ sides }) => {
      for (const [sess, world, pid] of sides) {
        const eids = ownedUnits(world, pid).slice(0, 3);
        if (eids.length) sess.sendCommand({ type: 'cmdMove', playerId: pid, eids, to: { x: 20, y: 20 } });
      }
    },
  },
  {
    name: 'cmdAttackMove',
    issue: ({ sides }) => {
      for (const [sess, world, pid] of sides) {
        const eids = ownedUnits(world, pid).slice(0, 2);
        if (eids.length) sess.sendCommand({ type: 'cmdAttackMove', playerId: pid, eids, to: { x: 25, y: 18 } });
      }
    },
  },
  {
    name: 'cmdGather',
    issue: ({ sides }) => {
      for (const [sess, world, pid] of sides) {
        const eids = ownedUnits(world, pid).slice(0, 2);
        const res = resourceQuery(world.ecs)[0];
        if (eids.length && res !== undefined) sess.sendCommand({ type: 'cmdGather', playerId: pid, eids, targetEid: res });
      }
    },
  },
  {
    name: 'cmdToggleStance',
    issue: ({ sides }) => {
      for (const [sess, world, pid] of sides) {
        const eids = ownedUnits(world, pid).slice(0, 2);
        if (eids.length) sess.sendCommand({ type: 'cmdToggleStance', playerId: pid, eids });
      }
    },
  },
  {
    name: 'cmdStop',
    issue: ({ sides }) => {
      for (const [sess, world, pid] of sides) {
        const eids = ownedUnits(world, pid).slice(0, 2);
        if (eids.length) sess.sendCommand({ type: 'cmdStop', playerId: pid, eids });
      }
    },
  },
  {
    name: 'cmdAttack',
    issue: ({ sides }) => {
      for (const [sess, world, pid, foe] of sides) {
        const eids = ownedUnits(world, pid).slice(0, 2);
        const target = ownedUnits(world, foe)[0];
        if (eids.length && target !== undefined) sess.sendCommand({ type: 'cmdAttack', playerId: pid, eids, targetEid: target });
      }
    },
  },
  {
    name: 'cmdSetStance',
    issue: ({ sides }) => {
      for (const [sess, world, pid] of sides) {
        const eids = ownedUnits(world, pid).slice(0, 3);
        if (eids.length) sess.sendCommand({ type: 'cmdSetStance', playerId: pid, eids, stance: UnitStanceId.HOLD_POSITION });
      }
    },
  },
  {
    name: 'cmdSetFormationMode',
    issue: ({ sides }) => {
      for (const [sess, world, pid] of sides) {
        const eids = ownedUnits(world, pid).slice(0, 4);
        // P1 → line, P2 → compact. Diverging per-player modes must NOT cross-contaminate.
        if (eids.length) sess.sendCommand({ type: 'cmdSetFormationMode', playerId: pid, eids, mode: pid === 1 ? 1 : 2 });
      }
    },
  },
  {
    name: 'cmdRotateFormation',
    issue: ({ sides }) => {
      for (const [sess, world, pid] of sides) {
        const eids = ownedUnits(world, pid).slice(0, 4);
        if (!eids.length) continue;
        sess.sendCommand({ type: 'cmdSetFormationMode', playerId: pid, eids, mode: 1 });
        sess.sendCommand({ type: 'cmdRotateFormation', playerId: pid, eids, delta: pid });
      }
    },
  },
  {
    name: 'cmdReformFormation',
    issue: ({ sides }) => {
      for (const [sess, world, pid] of sides) {
        const eids = ownedUnits(world, pid).slice(0, 4);
        if (!eids.length) continue;
        sess.sendCommand({ type: 'cmdSetFormationMode', playerId: pid, eids, mode: 2 });
        sess.sendCommand({ type: 'cmdReformFormation', playerId: pid, eids });
      }
    },
  },
  {
    name: 'setArmyRallyPoint',
    issue: ({ sides }) => {
      for (const [sess, , pid] of sides) sess.sendCommand({ type: 'setArmyRallyPoint', playerId: pid, x: 12 + pid, y: 12 + pid });
    },
  },
  {
    name: 'trainUnit',
    issue: ({ sides }) => {
      for (const [sess, world, pid] of sides) {
        const tc = ownTownCenter(world, pid);
        if (tc !== undefined) sess.sendCommand({ type: 'trainUnit', atEid: tc, defId: UnitKindId.VILLAGER, playerId: pid });
      }
    },
  },
  {
    name: 'cancelProduction',
    issue: ({ sides, pumpN }) => {
      for (const [sess, world, pid] of sides) {
        const tc = ownTownCenter(world, pid);
        if (tc !== undefined) sess.sendCommand({ type: 'trainUnit', atEid: tc, defId: UnitKindId.VILLAGER, playerId: pid });
      }
      pumpN(3);
      for (const [sess, world, pid] of sides) {
        const tc = ownTownCenter(world, pid);
        if (tc !== undefined) sess.sendCommand({ type: 'cancelProduction', atEid: tc, playerId: pid });
      }
    },
  },
  {
    name: 'advanceAge',
    issue: ({ sides }) => {
      for (const [sess, , pid] of sides) sess.sendCommand({ type: 'advanceAge', playerId: pid });
    },
  },
  {
    name: 'cmdRemoveBuildings',
    issue: ({ sides, pumpN }) => {
      for (const [sess, world, pid] of sides) {
        const tc = ownTownCenter(world, pid);
        if (tc === undefined) continue;
        const tile = buildableTileNear(world, Position.x[tc], Position.y[tc]);
        if (tile) sess.sendCommand({ type: 'placeBuilding', defId: BuildingDefId.HOUSE, x: tile.x, y: tile.y, playerId: pid });
      }
      pumpN(5);
      for (const [sess, world, pid] of sides) {
        const house = ownedBuildings(world, pid).find((e) => Building.defId[e] === BuildingDefId.HOUSE);
        if (house !== undefined) sess.sendCommand({ type: 'cmdRemoveBuildings', playerId: pid, eids: [house] });
      }
    },
  },
];

describe('multiplayer 1v1 — per-command parity matrix', () => {
  for (const sc of SCENARIOS) {
    it(`stays in lockstep parity after ${sc.name} from both players`, () => {
      const ctx = setupMatch();
      sc.issue(ctx);
      assertParity(ctx);
    });
  }

  it('formation mode is per-player: P1 line + P2 compact stay independent on both clients', () => {
    const ctx = setupMatch();
    const { worldA, worldB, sides, pumpN } = ctx;
    for (const [sess, world, pid] of sides) {
      const eids = ownedUnits(world, pid).slice(0, 4);
      sess.sendCommand({ type: 'cmdSetFormationMode', playerId: pid, eids, mode: pid === 1 ? 1 : 2 });
    }
    pumpN(6);
    assertParity(ctx);
    // Both clients agree on each player's mode, and the two players differ —
    // P2 picking 'compact' must not have reshaped P1's 'line' (and vice-versa).
    expect(worldA.formationModes[1]).toBe(1);
    expect(worldA.formationModes[2]).toBe(2);
    expect(worldB.formationModes[1]).toBe(1);
    expect(worldB.formationModes[2]).toBe(2);
  });

  it('all commands in one match — no interaction desync + observable effects', () => {
    const ctx = setupMatch();
    const { worldA, pumpN } = ctx;

    const buildBaselineA = ownedBuildings(worldA, 1).length;
    const moverA = ownedUnits(worldA, 1)[0];
    const preMove = moverA !== undefined ? { x: Position.x[moverA], y: Position.y[moverA] } : null;
    const stanceUnitA = ownedUnits(worldA, 1)[0];
    const preStance = stanceUnitA !== undefined ? UnitStance.stance[stanceUnitA] : null;

    for (const sc of SCENARIOS) {
      sc.issue(ctx);
      pumpN(3);
    }
    assertParity(ctx);

    // Sampled effects (each asserted to have happened on world A).
    expect(ownedBuildings(worldA, 1).length).toBe(buildBaselineA); // placed then removed → net zero
    if (moverA !== undefined && preMove) {
      const moved = Position.x[moverA] !== preMove.x || Position.y[moverA] !== preMove.y;
      expect(moved).toBe(true);
    }
    if (stanceUnitA !== undefined && preStance !== null) {
      expect(UnitStance.stance[stanceUnitA]).not.toBe(preStance);
    }
  });
});

describe('multiplayer lobby + transport', () => {
  it('base lockstep: two idle sessions stay in checksum parity (no commands)', () => {
    const relay = new RelayShim();
    const tA = new PairedTransport(relay);
    const tB = new PairedTransport(relay);
    const capA = makeCapture();
    const capB = makeCapture();
    const sessA = new MultiplayerSession(tA, 'room', 'A', callbacks(capA));
    const sessB = new MultiplayerSession(tB, 'room', 'B', callbacks(capB));
    tA.fireOpen();
    tB.fireOpen();
    expect(sessA.isHost).toBe(true);
    expect(sessB.localPlayerId).toBe(2);
    sessA.start(777);
    for (let i = 0; i < 120; i++) {
      sessA.update(SIM.TICK_MS);
      sessB.update(SIM.TICK_MS);
    }
    for (let i = 0; i < 4; i++) {
      sessA.update(0);
      sessB.update(0);
    }
    expect(capA.desync, `A ${capA.desyncInfo}`).toBe(false);
    expect(capB.desync, `B ${capB.desyncInfo}`).toBe(false);
    expect(capA.world!.tick).toBe(capB.world!.tick);
    expect(checksumWorld(capA.world!)).toBe(checksumWorld(capB.world!));
  });

  it('recovers from a throttled multiplayer timer wake with a bounded catch-up batch', () => {
    const ctx = setupMatch(778);
    const startTick = ctx.worldA.tick;

    ctx.sessA.update(SIM.TICK_MS * 40);
    ctx.sessB.update(SIM.TICK_MS * 40);
    for (let i = 0; i < 8; i++) {
      ctx.sessA.update(0);
      ctx.sessB.update(0);
    }

    expect(ctx.capA.desync, `A ${ctx.capA.desyncInfo}`).toBe(false);
    expect(ctx.capB.desync, `B ${ctx.capB.desyncInfo}`).toBe(false);
    expect(ctx.sessA.state).toBe('playing');
    expect(ctx.sessB.state).toBe('playing');
    expect(ctx.worldA.tick).toBe(ctx.worldB.tick);
    expect(ctx.worldA.tick).toBeGreaterThan(startTick + 20);
    expect(checksumWorld(ctx.worldA)).toBe(checksumWorld(ctx.worldB));
  });

  it('surfaces a relay rejection (room full) via onError instead of hanging', () => {
    const relay = new RelayShim();
    const tA = new PairedTransport(relay);
    const tB = new PairedTransport(relay);
    const tC = new PairedTransport(relay);
    new MultiplayerSession(tA, 'room', 'A', {});
    new MultiplayerSession(tB, 'room', 'B', {});
    let errMsg = '';
    let cState = 'connecting';
    new MultiplayerSession(tC, 'room', 'C', {
      onError: (m) => {
        errMsg = m;
      },
      onStateChange: (s) => {
        cState = s;
      },
    });
    tA.fireOpen();
    tB.fireOpen();
    tC.fireOpen();
    expect(errMsg).toBe('room full');
    expect(cState).toBe('disconnected');
  });
});
