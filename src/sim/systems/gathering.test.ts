import { describe, expect, it } from 'vitest';
import { MAP } from '../../config';
import { Gatherer, GathererStateId, Position, ResourceCarry, ResourceKindId } from '../components';
import { RESOURCE_GATHER_DISTANCE } from '../core/constants';
import {
  AI_PLAYER_ID,
  createSimWorld,
  findBuildingAt,
  findResourceAt,
  spawnResource,
  spawnVillager,
  step,
  townCenterQuery,
  type SimWorld,
} from '../world';

const P1 = 1;

function quietWorld(seed = 4242): SimWorld {
  const world = createSimWorld(seed);
  world.paused = false;
  world.humanPlayers = new Set([1, 2]);
  world.aiPlayers[AI_PLAYER_ID] = null;
  return world;
}

function openTileNear(world: SimWorld, cx: number, cy: number, minR: number): { x: number; y: number } {
  for (let r = minR; r < 12; r++) {
    for (let y = Math.round(cy) - r; y <= Math.round(cy) + r; y++) {
      for (let x = Math.round(cx) - r; x <= Math.round(cx) + r; x++) {
        if (x < 2 || y < 2 || x >= MAP.WIDTH - 2 || y >= MAP.HEIGHT - 2) continue;
        if (Math.hypot(x - cx, y - cy) < minR) continue;
        let clear = true;
        for (let dy = -1; dy <= 1 && clear; dy++) {
          for (let dx = -1; dx <= 1 && clear; dx++) {
            if (world.map.walkability[y + dy][x + dx] !== 0) clear = false;
          }
        }
        if (!clear || findResourceAt(world, x, y, 2.5) !== null || findBuildingAt(world, x, y, 2.5) !== null) continue;
        return { x, y };
      }
    }
  }
  throw new Error('no open tile');
}

describe('gathering', () => {
  it('a gatherer nudged just off its contact point after the walk ends still starts work', () => {
    // Unit separation can push a worker that reached a contact point (~0.52
    // from the node) just past the gather distance. It used to stand there,
    // or re-path out and back, forever without gathering.
    const world = quietWorld();
    const tc = townCenterQuery(world.ecs).find((eid) => Math.round(Position.x[eid]) === world.map.spawns[P1].x)!;
    const nodeTile = openTileNear(world, Position.x[tc], Position.y[tc], 5);
    const node = spawnResource(world, ResourceKindId.GOLD, nodeTile.x, nodeTile.y, 200);
    const villager = spawnVillager(world, nodeTile.x + 1, nodeTile.y, P1);
    world.inputs.push({ type: 'cmdGather', playerId: P1, eids: [villager], targetEid: node });
    step(world);

    Gatherer.state[villager] = GathererStateId.WALKING_TO;
    world.paths.delete(villager);
    Position.x[villager] = Position.x[node] + 0.66;
    Position.y[villager] = Position.y[node];
    expect(RESOURCE_GATHER_DISTANCE).toBeLessThan(0.66);

    step(world);
    expect(Gatherer.state[villager]).toBe(GathererStateId.GATHERING);
    for (let i = 0; i < 40; i++) step(world);
    expect(ResourceCarry.amount[villager]).toBeGreaterThan(0);
  });
});
