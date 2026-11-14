import { describe, expect, it } from 'vitest';
import { MAP } from '../../config';
import { Position } from '../components';
import {
  AI_PLAYER_ID,
  createSimWorld,
  findBuildingAt,
  findResourceAt,
  spawnVillager,
  step,
  type SimWorld,
} from '../world';

function quietWorld(seed = 4242): SimWorld {
  const world = createSimWorld(seed);
  world.paused = false;
  world.humanPlayers = new Set([1, 2]);
  world.aiPlayers[AI_PLAYER_ID] = null;
  return world;
}

/** A 5x6 block of open tiles with nothing on it, top-left corner returned. */
function openBlock(world: SimWorld): { x: number; y: number } {
  for (let y = 6; y < MAP.HEIGHT - 12; y++) {
    for (let x = 6; x < MAP.WIDTH - 10; x++) {
      let clear = true;
      for (let dy = 0; dy < 6 && clear; dy++) {
        for (let dx = 0; dx < 5 && clear; dx++) {
          const tx = x + dx;
          const ty = y + dy;
          if (world.map.walkability[ty][tx] !== 0) clear = false;
          else if (findResourceAt(world, tx, ty, 0.6) !== null || findBuildingAt(world, tx, ty, 0.6) !== null) clear = false;
        }
      }
      if (clear) return { x, y };
    }
  }
  throw new Error('no open block');
}

describe('movement', () => {
  it('a unit off its tile centre whose straight line clips a blocked tile walks around it, not stands still', () => {
    // Paths are smoothed from the tile centre. From (X-0.498, Y+0.372) the
    // straight line to (X-1, Y-3) enters the blocked tile (X-1, Y) at once;
    // from the centre (X, Y) it does not.
    const world = quietWorld();
    const block = openBlock(world);
    const X = block.x + 3;
    const Y = block.y + 4;
    world.grid[Y][X - 1] = 1;
    const unit = spawnVillager(world, X - 0.498, Y + 0.372, 1, 0);
    world.paths.set(unit, [{ x: X - 1, y: Y - 3 }]);

    let still = 0;
    let longestStill = 0;
    for (let i = 0; i < 80 && world.paths.has(unit); i++) {
      const x = Position.x[unit];
      const y = Position.y[unit];
      step(world);
      still = Math.hypot(Position.x[unit] - x, Position.y[unit] - y) < 0.001 && world.paths.has(unit) ? still + 1 : 0;
      longestStill = Math.max(longestStill, still);
    }
    expect(longestStill).toBeLessThanOrEqual(2);
    expect(world.paths.has(unit)).toBe(false);
    expect(Math.hypot(Position.x[unit] - (X - 1), Position.y[unit] - (Y - 3))).toBeLessThan(0.3);
  });
});
