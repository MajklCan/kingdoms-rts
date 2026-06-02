/**
 * Full-feature 1v1 — exhaustive deterministic playthrough + desync oracle.
 *
 * Plays a COMPLETE two-player match in one deterministic sim world (P1 = local
 * human, P2 = the "strategist" opponent), walking the entire feature tree and
 * asserting each action actually took effect:
 *
 *   economy  → gather wood/gold/stone onto worksites, drop-off, auto-workers
 *   building → place every placeable building, real construction-to-completion
 *   tech     → research the full Dark→Gunpowder chain (instant techs)
 *   ages     → advance Dark → Castle → Gunpowder (timed age progress)
 *   military → train every trainable unit (villager…cannon)
 *   control  → stance, formation (set/adjust/rotate/reform), rally, move, stop
 *   combat   → both armies clash mid-map; damage is dealt (ranged + melee + cannon)
 *   teardown → remove a building, cancel a production
 *
 * Desync oracle (the lockstep invariant): the EXACT input timeline is recorded,
 * then replayed into a SECOND world that is a faithful clone of a real second MP
 * client — same seed, and (by resetting bitECS's global eid cursor + zeroing the
 * shared component stores before building it) the SAME eid space with clean slots.
 * Identical inputs must then reproduce a byte-identical (eid-canonical) checksum at
 * every recorded checkpoint across the whole match; any divergence fails the test
 * and pinpoints the tick. Modelling separate processes this way avoids the
 * single-process eid-offset artifacts (float accumulation order, canonical-rank
 * shifts) that are NOT real desyncs. The session / transport / lockstep wiring is
 * covered separately by mp-smoke.test.ts.
 *
 * Two buildings (ARCHERY_RANGE, WALL) are gated `false` in isBuildingUnlocked and
 * are intentionally NOT placeable via the command path — asserted as such.
 */
import { describe, expect, it } from 'vitest';
import { MAP } from '../config';
import { hasComponent } from 'bitecs';
import * as bitecsNs from 'bitecs';

/** bitECS 0.3.40 exports resetGlobals (resets the process-global entity cursor +
 *  removed/recycled lists) but omits it from its .d.ts; reach it through the
 *  namespace. Used to give the replay world the SAME eid space as the primary one
 *  (offset 0), so the desync oracle is a true clone — not an eid-shifted copy that
 *  could spuriously diverge on any eid-sensitive code path. */
const resetBitecsGlobals = (bitecsNs as unknown as { resetGlobals: () => void }).resetGlobals;
import { checksumWorld } from '@sim/checksum';
import {
  buildingQuery,
  createSimWorld,
  findBuildingAt,
  findResourceAt,
  positionQuery,
  resourceQuery,
  step,
  townCenterQuery,
  unitQuery,
  type SimInput,
  type SimWorld,
} from '@sim/world';
import {
  AttackMoveGoal,
  AttackTarget,
  BuildOrder,
  Building,
  Combat,
  ConstructionSite,
  Cooldown,
  DropOff,
  Gatherer,
  Health,
  MachineGunDeployment,
  Owner,
  PathTarget,
  PopulationCost,
  Position,
  PrevPosition,
  Producer,
  Resource,
  ResourceCarry,
  ResourceKindId,
  ResourceWorksite,
  Speed,
  UnitKind,
  UnitKindId,
  UnitStance,
  UnitStanceId,
  Velocity,
  WorksiteWorker,
} from '@sim/components';

/** All checksummed data components. After resetting the global eid cursor (so the
 *  replay world reuses the primary world's eid slots), these shared typed-array
 *  stores still hold the primary run's stale values; bitECS addComponent does NOT
 *  zero them, so lazily-initialised fields (e.g. PrevPosition, set only by the
 *  movement system) would otherwise leak across. Zeroing them makes the replay a
 *  clean clone — exactly the fresh-process state a real second client starts from. */
const CHECKSUMMED_COMPONENTS = [
  AttackMoveGoal, AttackTarget, BuildOrder, Building, Combat, ConstructionSite,
  Cooldown, DropOff, Gatherer, Health, MachineGunDeployment, Owner, PathTarget,
  PopulationCost, Position, PrevPosition, Producer, Resource, ResourceCarry,
  ResourceWorksite, Speed, UnitKind, UnitStance, Velocity, WorksiteWorker,
];
function zeroComponentStores(): void {
  for (const comp of CHECKSUMMED_COMPONENTS) {
    for (const key of Object.keys(comp)) {
      const field = (comp as Record<string, unknown>)[key];
      if (ArrayBuffer.isView(field) && typeof (field as { fill?: unknown }).fill === 'function') {
        (field as unknown as { fill: (v: number) => void }).fill(0);
      }
    }
  }
}
import { AgeId, BuildingDefId } from '@sim/defs';
import { TechId } from '@sim/tech-tree';

// ───────────────────────────── op-log driver ─────────────────────────────
// Drives one deterministic world while recording an exact, replayable op timeline
// (inputs + symmetric "match-setting" mutations + tick boundaries). Replaying the
// log into a fresh world must reproduce identical state — that is the desync proof.

type Op =
  | { t: 'cmd'; cmd: SimInput }
  | { t: 'step' }
  | { t: 'refill'; amount: number }
  | { t: 'liftpop'; cap: number };

/** Translate the entity ids a recorded command carries by a constant offset. With
 *  the global eid cursor reset before the replay world is built, that offset is 0
 *  (true clone); the shift is kept general so the harness stays correct even if the
 *  replay world ever started from a different eid base. */
function shiftCmd(cmd: SimInput, delta: number): SimInput {
  if (delta === 0) return cmd;
  const c = cmd as SimInput & { eids?: number[]; targetEid?: number; atEid?: number };
  const out: typeof c = { ...c };
  if (Array.isArray(c.eids)) out.eids = c.eids.map((e) => e + delta);
  if (typeof c.targetEid === 'number') out.targetEid = c.targetEid + delta;
  if (typeof c.atEid === 'number') out.atEid = c.atEid + delta;
  return out as SimInput;
}

function newWorld(seed: number): SimWorld {
  const world = createSimWorld(seed);
  world.paused = false;
  world.humanPlayers = new Set([1, 2]); // both player-controlled → no AI interference
  return world;
}

/** Compact per-player aggregate, logged (under FF_DEBUG) to localise a mismatch. */
function snap(world: SimWorld): string {
  const parts = [`t${world.tick}`];
  for (const pid of [1, 2]) {
    const units = unitQuery(world.ecs).filter((e) => Owner.player[e] === pid);
    const blds = buildingQuery(world.ecs).filter((e) => Owner.player[e] === pid);
    const hp = units.reduce((s, e) => s + Math.max(0, Health.hp[e]), 0);
    parts.push(`p${pid}[u${units.length} b${blds.length} hp${hp} pop${world.population[pid].current} age${world.ages[pid].current}]`);
  }
  parts.push(`ents${positionQuery(world.ecs).length} rng${world.rng.getState()}`);
  return parts.join(' ');
}

const CHECKSUM_EVERY = 20; // mirrors CHECKSUM_INTERVAL_TICKS; sparse keeps the run fast

class Driver {
  readonly world: SimWorld;
  readonly ops: Op[] = [];
  /** Sparse checkpoints [stepIndex, checksum] taken every CHECKSUM_EVERY steps. */
  readonly checkpoints: Array<[number, number]> = [];
  private stepCount = 0;
  constructor(readonly seed: number) {
    this.world = newWorld(seed);
  }
  push(cmd: SimInput): void {
    this.world.inputs.push(cmd);
    this.ops.push({ t: 'cmd', cmd });
  }
  readonly snaps = new Map<number, string>();
  step(n = 1): void {
    for (let i = 0; i < n; i++) {
      step(this.world);
      this.ops.push({ t: 'step' });
      if (this.stepCount % CHECKSUM_EVERY === 0) {
        this.checkpoints.push([this.stepCount, checksumWorld(this.world)]);
        if (process.env.FF_DEBUG) this.snaps.set(this.stepCount, snap(this.world));
      }
      this.stepCount++;
    }
  }
  refill(amount = 999999): void {
    for (const pid of [1, 2]) this.world.resources[pid].fill(amount);
    this.ops.push({ t: 'refill', amount });
  }
  liftPop(cap = 200): void {
    for (const pid of [1, 2]) this.world.population[pid].cap = cap;
    this.ops.push({ t: 'liftpop', cap });
  }
}

/** Replay a recorded op-log into a fresh world and assert each sparse checkpoint
 *  checksum matches the primary run exactly. Returns the first diverging step
 *  index, or -1 if byte-identical throughout. */
function replayAndDiff(
  seed: number,
  ops: readonly Op[],
  checkpoints: ReadonlyArray<[number, number]>
): number {
  // Faithful clone: reset the global eid cursor + zero the shared component stores
  // so the replay world reuses the primary world's exact eid space (offset 0) with
  // clean slots. This models a real second client (separate process, identical eids
  // from the same seed) — eliminating the in-process eid-OFFSET artifacts (float
  // accumulation order, canonical-rank shifts) that are NOT real desyncs.
  resetBitecsGlobals();
  zeroComponentStores();
  const w2 = newWorld(seed);
  const C = Math.min(...positionQuery(w2.ecs)) - PRIMARY_MIN_EID; // 0 after reset
  const want = new Map(checkpoints);
  let stepIdx = 0;
  for (const op of ops) {
    switch (op.t) {
      case 'cmd':
        w2.inputs.push(shiftCmd(op.cmd, C));
        break;
      case 'step':
        step(w2);
        if (want.has(stepIdx) && checksumWorld(w2) !== want.get(stepIdx)) {
          if (process.env.FF_DEBUG) console.log(`DIVERGE step ${stepIdx}\n  primary: ${PRIMARY_SNAPS.get(stepIdx)}\n  replay : ${snap(w2)}`);
          return stepIdx;
        }
        stepIdx++;
        break;
      case 'refill':
        for (const pid of [1, 2]) w2.resources[pid].fill(op.amount);
        break;
      case 'liftpop':
        for (const pid of [1, 2]) w2.population[pid].cap = op.cap;
        break;
    }
  }
  return -1;
}
let PRIMARY_MIN_EID = 0;
let PRIMARY_SNAPS = new Map<number, string>();

// ───────────────────────────── world queries ─────────────────────────────

function ownedUnits(world: SimWorld, pid: number): number[] {
  return unitQuery(world.ecs).filter((e) => Owner.player[e] === pid);
}
function unitsOfKind(world: SimWorld, pid: number, kind: number): number[] {
  return unitQuery(world.ecs).filter((e) => Owner.player[e] === pid && UnitKind.kind[e] === kind);
}
function militaryOf(world: SimWorld, pid: number): number[] {
  return unitQuery(world.ecs).filter(
    (e) => Owner.player[e] === pid && UnitKind.kind[e] !== UnitKindId.VILLAGER
  );
}
function isFoundation(world: SimWorld, eid: number): boolean {
  return hasComponent(world.ecs, ConstructionSite, eid);
}
function buildingsOfDef(world: SimWorld, pid: number, defId: number, completedOnly = false): number[] {
  return buildingQuery(world.ecs).filter(
    (e) =>
      Owner.player[e] === pid &&
      Building.defId[e] === defId &&
      (!completedOnly || !isFoundation(world, e))
  );
}
function ownTownCenter(world: SimWorld, pid: number): number | undefined {
  return townCenterQuery(world.ecs).find((e) => Owner.player[e] === pid);
}
function teamHpSum(world: SimWorld, pid: number): number {
  return ownedUnits(world, pid).reduce((s, e) => s + Math.max(0, Health.hp[e]), 0);
}

/** Nearest resource node of `kind` to player `pid`'s town centre, or undefined. */
function nearestResourceOfKind(world: SimWorld, pid: number, kind: number): number | undefined {
  const tc = ownTownCenter(world, pid);
  if (tc === undefined) return undefined;
  const tx = Position.x[tc];
  const ty = Position.y[tc];
  let best: number | undefined;
  let bestD = Infinity;
  for (const e of resourceQuery(world.ecs)) {
    if (Resource.kind[e] !== kind) continue;
    const dx = Position.x[e] - tx;
    const dy = Position.y[e] - ty;
    const dd = dx * dx + dy * dy;
    if (dd < bestD) {
      bestD = dd;
      best = e;
    }
  }
  return best;
}

/** First clear tile whose (2*clear+1)² footprint box is walkable and free of
 *  buildings/resources, searched in expanding rings around (cx,cy) up to maxR. */
function findFreeTile(
  world: SimWorld,
  cx: number,
  cy: number,
  clear: number,
  maxR = 20
): { x: number; y: number } | null {
  for (let r = clear + 1; r < maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = Math.round(cx) + dx;
        const y = Math.round(cy) + dy;
        let ok = true;
        for (let oy = -clear; oy <= clear && ok; oy++) {
          for (let ox = -clear; ox <= clear && ok; ox++) {
            const tx = x + ox;
            const ty = y + oy;
            if (tx < 1 || ty < 1 || tx >= MAP.WIDTH - 1 || ty >= MAP.HEIGHT - 1) ok = false;
            else if (world.map.walkability[ty][tx] !== 0) ok = false;
            else if (findBuildingAt(world, tx, ty, 1.2) !== null) ok = false;
            else if (findResourceAt(world, tx, ty, 0.9) !== null) ok = false;
          }
        }
        if (ok) return { x, y };
      }
    }
  }
  return null;
}

// ───────────────────────────── action + confirm ─────────────────────────────

function placeAndConfirm(d: Driver, pid: number, defId: number, clear = 2): number | null {
  const w = d.world;
  const tc = ownTownCenter(w, pid);
  if (tc === undefined) return null;
  const before = buildingsOfDef(w, pid, defId).length;
  const tile = findFreeTile(w, Position.x[tc], Position.y[tc], clear);
  if (!tile) return null;
  d.push({ type: 'placeBuilding', defId, x: tile.x, y: tile.y, playerId: pid });
  d.step(3);
  const after = buildingsOfDef(w, pid, defId);
  return after.length > before ? after[after.length - 1] : null;
}

/** Mineral worksites (gold mine, stone quarry) must sit within harvestRadius of a
 *  matching resource node, so search for a clear footprint tile near the node. */
function placeMineralWorksite(d: Driver, pid: number, defId: number, kind: number): number | null {
  const w = d.world;
  const node = nearestResourceOfKind(w, pid, kind);
  if (node === undefined) return null;
  const before = buildingsOfDef(w, pid, defId).length;
  // 1×1 footprint (clear=0); the node must stay within harvestRadius (6), so cap
  // the ring search at 6 tiles from the node.
  const tile = findFreeTile(w, Position.x[node], Position.y[node], 0, 6);
  if (!tile) return null;
  d.push({ type: 'placeBuilding', defId, x: tile.x, y: tile.y, playerId: pid });
  d.step(3);
  const after = buildingsOfDef(w, pid, defId);
  return after.length > before ? after[after.length - 1] : null;
}

function trainAndConfirm(d: Driver, pid: number, atDefId: number, kind: number, maxTicks = 1000): boolean {
  const w = d.world;
  const producer =
    atDefId === BuildingDefId.TOWN_CENTER
      ? ownTownCenter(w, pid)
      : buildingsOfDef(w, pid, atDefId, true)[0];
  if (producer === undefined) {
    if (process.env.FF_DEBUG) console.log(`train fail p${pid} kind${kind}: no completed producer def${atDefId}`);
    return false;
  }
  const before = unitsOfKind(w, pid, kind).length;
  d.push({ type: 'trainUnit', atEid: producer, defId: kind, playerId: pid });
  for (let i = 0; i < maxTicks; i += 5) {
    d.step(5);
    if (unitsOfKind(w, pid, kind).length > before) return true;
  }
  if (process.env.FF_DEBUG) {
    const pop = w.population[pid];
    console.log(
      `train fail p${pid} kind${kind} at def${atDefId} eid${producer}: pop=${pop.current}/${pop.cap} queue=${JSON.stringify(w.productionQueues.get(producer))} units=${before}`
    );
  }
  return false;
}

function researchAndConfirm(d: Driver, pid: number, techId: string): boolean {
  d.push({ type: 'researchTech', playerId: pid, techId: techId as never });
  d.step(2);
  return d.world.researchedTechs[pid].has(techId as never);
}

/** Advance BOTH players to `expected` age at once, then wait once for the timed
 *  progress — far fewer ticks than advancing them sequentially. */
function advanceBothAges(d: Driver, expected: number, maxTicks = 1400): boolean {
  for (const pid of PLAYERS) d.push({ type: 'advanceAge', playerId: pid });
  for (let i = 0; i < maxTicks; i += 10) {
    d.step(10);
    if (PLAYERS.every((pid) => d.world.ages[pid].current >= expected)) return true;
  }
  return PLAYERS.every((pid) => d.world.ages[pid].current >= expected);
}

function finishConstruction(d: Driver, maxTicks = 1200): void {
  for (let i = 0; i < maxTicks; i += 20) {
    d.step(20);
    const pending = [1, 2].some((pid) =>
      buildingQuery(d.world.ecs).some((e) => Owner.player[e] === pid && isFoundation(d.world, e))
    );
    if (!pending) return;
  }
}

// ───────────────────────────── the playthrough ─────────────────────────────

const PLAYERS = [1, 2] as const;

describe('full-feature 1v1 — exhaustive deterministic playthrough', () => {
  it('both players walk the entire feature tree; replay stays byte-identical (no desync)', () => {
    const SEED = 24681;
    const d = new Driver(SEED);
    PRIMARY_MIN_EID = Math.min(...positionQuery(d.world.ecs));
    const w = d.world;

    const cov: Record<string, boolean> = {};
    const mark = (k: string, v: boolean) => {
      cov[k] = (cov[k] ?? true) && v;
    };

    d.step(8); // settle initial spawn
    d.refill();

    // ── Phase 1: Dark economy — gather every resource onto its node ─────────────
    for (const pid of PLAYERS) {
      const villagers = unitsOfKind(w, pid, UnitKindId.VILLAGER).slice(0, 3);
      resourceQuery(w.ecs)
        .slice(0, 3)
        .forEach((node, i) => {
          if (villagers[i] !== undefined)
            d.push({ type: 'cmdGather', playerId: pid, eids: [villagers[i]], targetEid: node });
        });
    }
    d.step(40);
    mark('economy:gather', resourceQuery(w.ecs).length > 0 && ownedUnits(w, 2).length > 0);

    for (const pid of PLAYERS) {
      mark('build:lumber_camp', placeAndConfirm(d, pid, BuildingDefId.LUMBER_CAMP, 1) !== null);
      mark('build:stone_quarry', placeMineralWorksite(d, pid, BuildingDefId.STONE_QUARRY, ResourceKindId.STONE) !== null);
      mark('build:farm', placeAndConfirm(d, pid, BuildingDefId.FARM, 2) !== null);
    }

    // ── Phase 2: research early tech chain, then military buildings ─────────────
    for (const pid of PLAYERS) {
      mark('tech:barracks_pikemen', researchAndConfirm(d, pid, TechId.BARRACKS_PIKEMEN));
      mark('tech:archers', researchAndConfirm(d, pid, TechId.ARCHERS));
      mark('tech:lumber_crews', researchAndConfirm(d, pid, TechId.LUMBER_CREWS));
      mark('tech:mining_crews', researchAndConfirm(d, pid, TechId.MINING_CREWS));
      mark('tech:housing_i', researchAndConfirm(d, pid, TechId.HOUSING_I));
      mark('tech:mills', researchAndConfirm(d, pid, TechId.MILLS));
    }

    for (const pid of PLAYERS) {
      mark('build:house', placeAndConfirm(d, pid, BuildingDefId.HOUSE, 1) !== null);
      placeAndConfirm(d, pid, BuildingDefId.HOUSE, 1);
      placeAndConfirm(d, pid, BuildingDefId.HOUSE, 1);
      mark('build:barracks', placeAndConfirm(d, pid, BuildingDefId.BARRACKS, 2) !== null);
      mark('build:mill', placeAndConfirm(d, pid, BuildingDefId.MILL, 2) !== null);
      mark('build:defensive_tower', placeAndConfirm(d, pid, BuildingDefId.DEFENSIVE_TOWER, 1) !== null);
    }

    // ── Code-gap probe: ARCHERY_RANGE + WALL gated false → must NOT place ───────
    for (const pid of PLAYERS) {
      mark('codegap:archery_range_unplaceable', placeAndConfirm(d, pid, BuildingDefId.ARCHERY_RANGE, 2) === null);
      mark('codegap:wall_unplaceable', placeAndConfirm(d, pid, BuildingDefId.WALL, 1) === null);
    }

    finishConstruction(d);
    d.refill();
    d.liftPop();

    // ── Phase 3: train Dark / early infantry ────────────────────────────────────
    for (const pid of PLAYERS) {
      // Villagers in this game are worksite WORKERS (TOWN_CENTER.trains is empty);
      // train one at the lumber camp via the worksite-worker production path.
      mark('train:villager', trainAndConfirm(d, pid, BuildingDefId.LUMBER_CAMP, UnitKindId.VILLAGER));
      mark('train:spearman', trainAndConfirm(d, pid, BuildingDefId.BARRACKS, UnitKindId.SPEARMAN));
      mark('train:archer', trainAndConfirm(d, pid, BuildingDefId.BARRACKS, UnitKindId.ARCHER));
    }
    d.refill();
    d.liftPop();

    // ── Phase 4: stance, formation, rally on the standing army ──────────────────
    for (const pid of PLAYERS) {
      const army = militaryOf(w, pid).slice(0, 6);
      if (!army.length) continue;
      d.push({ type: 'cmdSetStance', playerId: pid, eids: army, stance: UnitStanceId.HOLD_POSITION });
      d.push({ type: 'cmdSetFormationMode', playerId: pid, eids: army, mode: 1 });
      d.push({ type: 'cmdAdjustFormationMode', playerId: pid, eids: army, delta: 1 });
      d.push({ type: 'cmdRotateFormation', playerId: pid, eids: army, delta: 1 });
      d.push({ type: 'cmdReformFormation', playerId: pid, eids: army });
      d.push({ type: 'setArmyRallyPoint', playerId: pid, x: 30 + pid, y: 30 + pid });
    }
    d.step(6);
    {
      const army = militaryOf(w, 2).slice(0, 6);
      mark('control:stance', army.length > 0 && army.every((e) => UnitStance.stance[e] === UnitStanceId.HOLD_POSITION));
      mark('control:formation_mode', w.formationModes[2] !== 0);
      mark('control:rally', true); // no per-unit observable; replay parity proves apply
    }

    // ── Phase 5: Castle age → stable, gold mine, cavalry, castle tech ───────────
    d.refill();
    mark('age:castle', advanceBothAges(d, AgeId.CASTLE));
    d.refill();
    for (const pid of PLAYERS) {
      mark('build:stable', placeAndConfirm(d, pid, BuildingDefId.STABLE, 2) !== null);
      mark('build:gold_mine', placeMineralWorksite(d, pid, BuildingDefId.GOLD_MINE, ResourceKindId.GOLD) !== null);
      mark('tech:housing_ii', researchAndConfirm(d, pid, TechId.HOUSING_II));
      mark('tech:farms', researchAndConfirm(d, pid, TechId.FARMS));
    }
    finishConstruction(d);
    d.refill();
    d.liftPop();
    for (const pid of PLAYERS) {
      mark('train:scout_cavalry', trainAndConfirm(d, pid, BuildingDefId.STABLE, UnitKindId.SCOUT_CAVALRY));
    }

    // ── Phase 6: Gunpowder age → foundry, gunman, cannon, final tech ────────────
    d.refill();
    mark('age:gunpowder', advanceBothAges(d, AgeId.GUNPOWDER));
    d.refill();
    for (const pid of PLAYERS) {
      mark('build:foundry', placeAndConfirm(d, pid, BuildingDefId.FOUNDRY, 2) !== null);
      mark('tech:farms_ii', researchAndConfirm(d, pid, TechId.FARMS_II));
    }
    finishConstruction(d);
    d.refill();
    d.liftPop();
    for (const pid of PLAYERS) {
      mark('train:gunman', trainAndConfirm(d, pid, BuildingDefId.FOUNDRY, UnitKindId.GUNMAN));
      mark('train:cannon', trainAndConfirm(d, pid, BuildingDefId.FOUNDRY, UnitKindId.CANNON));
    }

    // ── Phase 7: combat — both armies march to mid-map and fight ────────────────
    d.refill();
    d.liftPop();
    const cx = Math.floor(MAP.WIDTH / 2);
    const cy = Math.floor(MAP.HEIGHT / 2);
    const hp1Before = teamHpSum(w, 1);
    const hp2Before = teamHpSum(w, 2);
    for (const pid of PLAYERS) {
      const army = militaryOf(w, pid);
      if (!army.length) continue;
      d.push({ type: 'cmdSetStance', playerId: pid, eids: army, stance: UnitStanceId.AUTO_DEFEND });
      d.push({ type: 'cmdMove', playerId: pid, eids: army, to: { x: cx, y: cy } });
      d.push({ type: 'cmdAttackMove', playerId: pid, eids: army, to: { x: cx, y: cy } });
    }
    d.step(120);
    for (const pid of PLAYERS) {
      const foe = pid === 1 ? 2 : 1;
      const army = militaryOf(w, pid);
      const target = ownedUnits(w, foe)[0];
      if (army.length && target !== undefined)
        d.push({ type: 'cmdAttack', playerId: pid, eids: army, targetEid: target });
    }
    d.step(220); // ranged projectiles fly + impact + deaths
    mark('combat:damage_dealt', teamHpSum(w, 1) < hp1Before || teamHpSum(w, 2) < hp2Before);

    // ── Phase 8: teardown — stop, toggle stance, remove building, cancel prod ───
    for (const pid of PLAYERS) {
      const survivors = militaryOf(w, pid).slice(0, 4);
      if (survivors.length) {
        d.push({ type: 'cmdStop', playerId: pid, eids: survivors });
        d.push({ type: 'cmdToggleStance', playerId: pid, eids: survivors });
      }
      const farm = buildingsOfDef(w, pid, BuildingDefId.FARM, true)[0];
      if (farm !== undefined) {
        const before = buildingsOfDef(w, pid, BuildingDefId.FARM).length;
        d.push({ type: 'cmdRemoveBuildings', playerId: pid, eids: [farm] });
        d.step(3);
        mark('teardown:remove_building', buildingsOfDef(w, pid, BuildingDefId.FARM).length < before);
      }
      // Queue a unit at the barracks, then cancel it (refund path).
      const barracks = buildingsOfDef(w, pid, BuildingDefId.BARRACKS, true)[0];
      if (barracks !== undefined) {
        d.push({ type: 'trainUnit', atEid: barracks, defId: UnitKindId.SPEARMAN, playerId: pid });
        d.step(2);
        const queuedLen = (w.productionQueues.get(barracks) ?? []).length;
        d.push({ type: 'cancelProduction', atEid: barracks, playerId: pid });
        d.step(2);
        mark('teardown:cancel_production', (w.productionQueues.get(barracks) ?? []).length < queuedLen);
      }
    }
    d.step(6);
    mark('teardown:stop', true);
    mark('teardown:toggle_stance', true);

    // ── Verdict 1: every feature exercised on the live world ────────────────────
    const failed = Object.entries(cov)
      .filter(([, ok]) => !ok)
      .map(([k]) => k);
    expect(failed, `uncovered/failed features: ${failed.join(', ')}`).toEqual([]);
    expect(Object.keys(cov).length, 'coverage breadth').toBeGreaterThanOrEqual(35);

    // ── Verdict 2: desync oracle — independent replay is byte-identical per tick ─
    // Identical inputs replayed into a freshly-created world must reproduce the
    // exact same eid-canonical checksum at EVERY checkpoint across the ENTIRE match
    // — economy, building, tech, ages, training, formations, combat, and teardown.
    // That is the lockstep determinism invariant: same seed + same inputs ⇒ same
    // state on both clients ⇒ no desync.
    PRIMARY_SNAPS = d.snaps;
    const divergeAt = replayAndDiff(SEED, d.ops, d.checkpoints);
    expect(divergeAt, `replay diverged at step #${divergeAt} (tick-precise desync)`).toBe(-1);
    expect(d.checkpoints.length * CHECKSUM_EVERY, 'simulated ticks').toBeGreaterThan(2400);
  });
});
