import { describe, expect, it } from 'vitest';
import { hasComponent } from 'bitecs';
import { MAP } from '../config';
import { Building, ConstructionSite, Health, Owner, Position, Resource, ResourceKindId } from './components';
import { AgeId, BuildingDefId, WALL_TIERS } from './defs';
import { TechId } from './tech-tree';
import { checksumWorld } from './checksum';
import { applyDamage } from './core/match-stats';
import { findAiBreachTarget } from './ai/breach';
import {
  AI_PLAYER_ID,
  WALL_LINE_MAX_TILES,
  buildingQuery,
  createSimWorld,
  findBuildingAt,
  findResourceAt,
  getBuildingCost,
  removeSimEntity,
  resourceQuery,
  spawnResource,
  spawnSpearman,
  step,
  townCenterQuery,
  unitQuery,
  wallLineTiles,
  type GameEvent,
  type SimWorld,
} from './world';

const P1 = 1;
const P2 = AI_PLAYER_ID;
const PALISADE = WALL_TIERS[0];
const STONE = WALL_TIERS[1];

function wallWorld(seed = 4242): SimWorld {
  const world = createSimWorld(seed);
  world.paused = false;
  world.humanPlayers = new Set([1, 2]);
  world.aiPlayers[AI_PLAYER_ID] = null;
  world.researchedTechs[P1].add(TechId.BARRACKS_PIKEMEN);
  world.resources[P1] = Int32Array.of(0, 1000, 1000, 1000);
  return world;
}

function stepN(world: SimWorld, n: number): void {
  for (let i = 0; i < n; i++) step(world);
}

function townCenterOf(world: SimWorld, playerId: number): number {
  for (const eid of townCenterQuery(world.ecs)) if (Owner.player[eid] === playerId) return eid;
  throw new Error(`no TC for ${playerId}`);
}

function wallsOf(world: SimWorld, playerId: number): number[] {
  return [...buildingQuery(world.ecs)].filter(
    (eid) => Building.defId[eid] === BuildingDefId.WALL && Owner.player[eid] === playerId
  );
}

function tileFree(world: SimWorld, x: number, y: number): boolean {
  if (x < 1 || y < 1 || x >= MAP.WIDTH - 1 || y >= MAP.HEIGHT - 1) return false;
  if (world.map.walkability[y][x] !== 0) return false;
  if (findResourceAt(world, x, y, 0.8) !== null) return false;
  if (findBuildingAt(world, x, y, 1.2) !== null) return false;
  for (const u of unitQuery(world.ecs)) {
    if (Math.hypot(Position.x[u] - x, Position.y[u] - y) < 1.5) return false;
  }
  return true;
}

/** Top-left corner of a w x h block of free tiles near (cx, cy). */
function openBlock(world: SimWorld, cx: number, cy: number, w: number, h: number): { x: number; y: number } {
  for (let r = 4; r < 30; r++) {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        let ok = true;
        for (let dy = 0; dy < h && ok; dy++) {
          for (let dx = 0; dx < w && ok; dx++) ok = tileFree(world, x + dx, y + dy);
        }
        if (ok) return { x, y };
      }
    }
  }
  throw new Error('no open block');
}

function placeLine(world: SimWorld, x0: number, y0: number, x1: number, y1: number, playerId = P1): void {
  world.inputs.push({ type: 'placeWallLine', playerId, x0, y0, x1, y1 });
  step(world);
}

/** Walls around the w x h rectangle at (x, y), one tile outside it. */
function ringAround(world: SimWorld, x: number, y: number, w: number, h: number, playerId = P1): void {
  const x0 = x - 1;
  const y0 = y - 1;
  const x1 = x + w;
  const y1 = y + h;
  placeLine(world, x0, y0, x1, y0, playerId);
  placeLine(world, x1, y0 + 1, x1, y1, playerId);
  placeLine(world, x1 - 1, y1, x0, y1, playerId);
  placeLine(world, x0, y1 - 1, x0, y0 + 1, playerId);
}

describe('wall line geometry', () => {
  it('is 4-connected, covers both ends and is capped', () => {
    for (const [x0, y0, x1, y1] of [[0, 0, 7, 0], [3, 3, 3, -4], [0, 0, 5, 5], [10, 2, 1, 7], [4, 4, 4, 4]]) {
      const tiles = wallLineTiles(x0, y0, x1, y1);
      expect(tiles[0]).toEqual({ x: x0, y: y0 });
      expect(tiles[tiles.length - 1]).toEqual({ x: x1, y: y1 });
      expect(tiles).toHaveLength(Math.abs(x1 - x0) + Math.abs(y1 - y0) + 1);
      for (let i = 1; i < tiles.length; i++) {
        // Edge neighbours only: a diagonal step would leave a gap EasyStar cuts through.
        expect(Math.abs(tiles[i].x - tiles[i - 1].x) + Math.abs(tiles[i].y - tiles[i - 1].y)).toBe(1);
      }
    }
    expect(wallLineTiles(0, 0, 60, 60)).toHaveLength(WALL_LINE_MAX_TILES);
  });
});

describe('walls', () => {
  it('unlock with the Barracks tech and cost the palisade tier per tile', () => {
    const world = wallWorld();
    world.researchedTechs[P1].delete(TechId.BARRACKS_PIKEMEN);
    const tc = townCenterOf(world, P1);
    const at = openBlock(world, Math.round(Position.x[tc]), Math.round(Position.y[tc]), 7, 1);
    placeLine(world, at.x, at.y, at.x + 6, at.y);
    expect(wallsOf(world, P1)).toHaveLength(0);

    world.researchedTechs[P1].add(TechId.BARRACKS_PIKEMEN);
    expect(getBuildingCost(world, P1, BuildingDefId.WALL)).toEqual(PALISADE.cost);
    const woodBefore = world.resources[P1][1];
    placeLine(world, at.x, at.y, at.x + 6, at.y);
    const walls = wallsOf(world, P1);
    expect(walls).toHaveLength(7);
    expect(world.resources[P1][1]).toBe(woodBefore - 7 * PALISADE.cost.wood);
    for (const eid of walls) {
      // The shared pathfinder grid is blocked the tick the foundation drops.
      expect(world.grid[Position.y[eid]][Position.x[eid]]).toBe(1);
      expect(world.pathfinder.grid).toBe(world.grid);
      expect(Health.hpMax[eid]).toBe(PALISADE.hp);
      expect(ConstructionSite.totalTicks[eid]).toBe(PALISADE.buildTimeTicks);
    }
    stepN(world, PALISADE.buildTimeTicks + 2);
    for (const eid of walls) {
      expect(hasComponent(world.ecs, ConstructionSite, eid)).toBe(false);
      expect(Health.hp[eid]).toBe(PALISADE.hp);
    }
  });

  it('skips tiles with a tree or a unit on them and stops when the wood runs out', () => {
    const world = wallWorld(77);
    const tc = townCenterOf(world, P1);
    const at = openBlock(world, Math.round(Position.x[tc]), Math.round(Position.y[tc]), 9, 3);
    const y = at.y + 1;
    spawnResource(world, ResourceKindId.WOOD, at.x + 2, y, 50);
    // Own unit: an enemy one would knock down the 1 hp foundations next to it.
    spawnSpearman(world, at.x + 4, y, P1);
    placeLine(world, at.x, y, at.x + 8, y);
    const xs = wallsOf(world, P1).map((eid) => Position.x[eid] - at.x).sort((a, b) => a - b);
    expect(xs).toEqual([0, 1, 3, 5, 6, 7, 8]);

    world.resources[P1][1] = PALISADE.cost.wood * 3;
    placeLine(world, at.x, y - 1, at.x + 8, y - 1);
    expect(wallsOf(world, P1)).toHaveLength(7 + 3);
    expect(world.resources[P1][1]).toBe(0);
  });

  it('seals a pocket from pathing and reopens it when a wall falls', () => {
    const world = wallWorld(9);
    const tc = townCenterOf(world, P1);
    const at = openBlock(world, Math.round(Position.x[tc]), Math.round(Position.y[tc]), 7, 7);
    const pocket = { x: at.x + 3, y: at.y + 3 };
    ringAround(world, pocket.x, pocket.y, 1, 1);
    const ring = wallsOf(world, P1);
    expect(ring).toHaveLength(8);
    const outside = { x: at.x, y: at.y };
    expect(world.pathfinder.findPath(outside, pocket)).toBeNull();

    stepN(world, PALISADE.buildTimeTicks + 2);
    const gate = ring[0];
    applyDamage(world, gate, Health.hp[gate] + 1, P2);
    step(world);
    expect(hasComponent(world.ecs, Building, gate)).toBe(false);
    expect(world.pathfinder.findPath(outside, pocket)).not.toBeNull();
    const destroyed = world.gameEvents.find(
      (e): e is Extract<GameEvent, { kind: 'entityDestroyed' }> => e.kind === 'entityDestroyed' && e.eid === gate
    );
    expect(destroyed).toMatchObject({ defId: BuildingDefId.WALL, footprint: { w: 1, h: 1 }, killerOwnerId: P2 });
  });

  it('upgrades standing walls on age-up and builds the next tier after it', () => {
    const world = wallWorld(31);
    const tc = townCenterOf(world, P1);
    const at = openBlock(world, Math.round(Position.x[tc]), Math.round(Position.y[tc]), 6, 3);
    placeLine(world, at.x, at.y, at.x + 1, at.y);
    stepN(world, PALISADE.buildTimeTicks + 2);
    const [done, other] = wallsOf(world, P1);
    applyDamage(world, done, 100, P2);
    // One foundation still building when the age arrives.
    placeLine(world, at.x + 4, at.y, at.x + 4, at.y);
    const site = wallsOf(world, P1).find((eid) => hasComponent(world.ecs, ConstructionSite, eid))!;
    stepN(world, 10);
    const siteHpBefore = Health.hp[site];

    world.ages[P1].progress = 0;
    world.ages[P1].totalTicks = 1;
    step(world);
    expect(world.ages[P1].current).toBe(AgeId.CASTLE);
    expect(Health.hpMax[done]).toBe(STONE.hp);
    expect(Health.hp[done]).toBe(STONE.hp - 100);
    expect(Health.hp[other]).toBe(STONE.hp);
    expect(Health.hpMax[site]).toBe(STONE.hp);
    expect(Health.hp[site]).toBeGreaterThan(siteHpBefore);
    stepN(world, PALISADE.buildTimeTicks);
    expect(Health.hp[site]).toBe(STONE.hp);

    expect(getBuildingCost(world, P1, BuildingDefId.WALL)).toEqual(STONE.cost);
    const stoneBefore = world.resources[P1][3];
    placeLine(world, at.x, at.y + 2, at.x + 2, at.y + 2);
    const fresh = wallsOf(world, P1).filter((eid) => Position.y[eid] === at.y + 2);
    expect(fresh).toHaveLength(3);
    expect(world.resources[P1][3]).toBe(stoneBefore - 3 * STONE.cost.stone);
    stepN(world, STONE.buildTimeTicks + 2);
    for (const eid of fresh) expect(Health.hp[eid]).toBe(STONE.hp);
  });

  it('a unit ordered to attack a wall from below walks up to its own side', () => {
    const world = wallWorld(5);
    const tc = townCenterOf(world, P1);
    const at = openBlock(world, Math.round(Position.x[tc]), Math.round(Position.y[tc]), 9, 5);
    placeLine(world, at.x, at.y + 1, at.x + 8, at.y + 1);
    stepN(world, PALISADE.buildTimeTicks + 2);
    const target = wallsOf(world, P1).find((eid) => Position.x[eid] === at.x + 4)!;
    const spear = spawnSpearman(world, at.x + 4, at.y + 4, P2);
    world.inputs.push({ type: 'cmdAttack', playerId: P2, eids: [spear], targetEid: target });
    for (let i = 0; i < 400 && Health.hp[target] === PALISADE.hp; i++) step(world);
    expect(Health.hp[target]).toBeLessThan(PALISADE.hp);
    expect(Position.y[spear]).toBeGreaterThan(at.y + 1);
  });

  it('stays deterministic: identical inputs give identical checksums', () => {
    const run = () => {
      const world = wallWorld(1234);
      const tc = townCenterOf(world, P1);
      const at = openBlock(world, Math.round(Position.x[tc]), Math.round(Position.y[tc]), 6, 6);
      placeLine(world, at.x, at.y, at.x + 5, at.y + 5);
      stepN(world, 120);
      return checksumWorld(world);
    };
    expect(run()).toBe(run());
  });
});

describe('AI wall breaching', () => {
  it('picks a wall of the ring around its target, and nothing when a gap is open', () => {
    const world = wallWorld(21);
    const tc = townCenterOf(world, P1);
    const at = openBlock(world, Math.round(Position.x[tc]), Math.round(Position.y[tc]), 7, 7);
    const pocket = { x: at.x + 3, y: at.y + 3 };
    world.inputs.push({ type: 'placeBuilding', defId: BuildingDefId.WALL, x: pocket.x, y: pocket.y, playerId: P1 });
    step(world);
    const target = findBuildingAt(world, pocket.x, pocket.y, 0.1)!;
    ringAround(world, pocket.x, pocket.y, 1, 1);
    const ring = wallsOf(world, P1).filter((eid) => eid !== target);
    expect(ring).toHaveLength(8);
    const breach = findAiBreachTarget(world, P2, { x: at.x, y: at.y }, target);
    expect(breach).not.toBeNull();
    expect(ring).toContain(breach);
    // Same answer twice: deterministic.
    expect(findAiBreachTarget(world, P2, { x: at.x, y: at.y }, target)).toBe(breach);

    // Read the tile first: removal clears the entity's component data.
    const gap = { x: Position.x[ring[3]], y: Position.y[ring[3]] };
    removeSimEntity(world, ring[3]);
    world.grid[gap.y][gap.x] = 0;
    expect(findAiBreachTarget(world, P2, { x: at.x, y: at.y }, target)).toBeNull();
  });

  it('an AI attack wave breaks through walls around a walled-in town center', () => {
    const world = createSimWorld(4242);
    world.paused = false;
    world.researchedTechs[P1].add(TechId.BARRACKS_PIKEMEN);
    world.resources[P1] = Int32Array.of(0, 5000, 5000, 5000);
    const tc = townCenterOf(world, P1);
    // Clear the ground the ring needs: no starting army, no trees in the way.
    for (const eid of [...unitQuery(world.ecs)]) if (Owner.player[eid] === P1) removeSimEntity(world, eid);
    for (const eid of [...resourceQuery(world.ecs)]) {
      if (Math.hypot(Position.x[eid] - Position.x[tc], Position.y[eid] - Position.y[tc]) < 5) {
        removeSimEntity(world, eid);
      }
    }
    expect(Resource.amount.length).toBeGreaterThan(0);
    const tx = Math.round(Position.x[tc]) - 1;
    const ty = Math.round(Position.y[tc]) - 1;
    // Two tiles out from the 3x3 footprint.
    ringAround(world, tx - 1, ty - 1, 5, 5);
    stepN(world, PALISADE.buildTimeTicks + 2);
    const ring = wallsOf(world, P1);
    expect(ring.length).toBeGreaterThan(20);
    const outside = { x: tx - 4, y: ty - 4 };
    expect(world.pathfinder.findPath(outside, { x: tx + 1, y: ty - 1 })).toBeNull();

    const aiTc = townCenterOf(world, P2);
    for (let i = 0; i < 8; i++) {
      spawnSpearman(world, Math.round(Position.x[aiTc]) + 3 + (i % 4), Math.round(Position.y[aiTc]) + 3 + Math.floor(i / 4), P2);
    }
    const ai = world.aiPlayers[AI_PLAYER_ID]!;
    ai.nextAttackTick = 0;
    ai.plan = 'massing';

    const tcMax = Health.hpMax[tc];
    let breached = false;
    for (let i = 0; i < 6000 && Health.hp[tc] >= tcMax; i++) {
      step(world);
      if (!breached) breached = ring.some((eid) => !hasComponent(world.ecs, Building, eid));
    }
    expect(breached).toBe(true);
    expect(Health.hp[tc]).toBeLessThan(tcMax);
  });
});
