/**
 * Full 1v1 playthrough to a win condition.
 *
 * Player 1 ("me") is overwhelmingly strong: cheated resources and a large
 * pre-massed army sieging the enemy Town Center. Player 2 is the real enemy AI,
 * fighting back. Drives the deterministic sim until winConditionSystem declares
 * a conquest victory, exercising the whole end-game loop (combat, targeting,
 * death, building destruction, win detection).
 *
 * Single-world game (not the lockstep harness) — MP determinism is covered in
 * src/net/mp-smoke.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { hasComponent } from 'bitecs';
import {
  createSimWorld,
  spawnArcher,
  spawnSpearman,
  step,
  townCenterQuery,
  unitQuery,
  type SimWorld,
} from './world';
import { DeadTag, Health, Owner, Position } from './components';

function enemyTownCenter(world: SimWorld): number | undefined {
  return townCenterQuery(world.ecs).find((e) => Owner.player[e] === 2 && Health.hp[e] > 0);
}
function aliveMilitary(world: SimWorld, eids: number[]): number[] {
  return eids.filter((e) => !hasComponent(world.ecs, DeadTag, e) && Health.hp[e] > 0);
}
/** FOOD=0 WOOD=1 GOLD=2 STONE=3 — keep player 1 swimming in resources. */
function cheatResources(world: SimWorld): void {
  world.resources[1].fill(100000);
}

describe('1v1 playthrough', () => {
  it('player 1 sieges the enemy Town Center and wins by conquest', () => {
    const world = createSimWorld(4242);
    world.paused = false;
    // Default humanPlayers = {1}, so player 2 is driven by the enemy AI.

    const tcEid = enemyTownCenter(world);
    expect(tcEid).toBeDefined();
    const tx = Position.x[tcEid!];
    const ty = Position.y[tcEid!];

    const ring = (i: number) => ({ dx: (i % 7) - 3, dy: Math.floor(i / 7) - 3 });
    const army: number[] = [];
    // Mass a strong army on the enemy's doorstep.
    for (let i = 0; i < 28; i++) {
      const { dx, dy } = ring(i);
      army.push(spawnSpearman(world, tx + dx, ty + dy + 5, 1));
    }
    for (let i = 0; i < 12; i++) {
      const { dx, dy } = ring(i);
      army.push(spawnArcher(world, tx + dx, ty - dy - 5, 1));
    }
    cheatResources(world);

    const MAX_TICKS = 4000;
    let tick = 0;
    for (; tick < MAX_TICKS; tick++) {
      if (world.outcome.state !== 'playing') break;
      if (tick % 20 === 0) {
        cheatResources(world);
        const tc = enemyTownCenter(world);
        const alive = aliveMilitary(world, army);
        if (tc !== undefined) {
          world.inputs.push({ type: 'cmdAttack', playerId: 1, eids: alive, targetEid: tc });
        }
        if (alive.length < 20) {
          for (let i = 0; i < 16; i++) {
            const { dx, dy } = ring(i);
            army.push(spawnSpearman(world, tx + dx, ty + dy + 6, 1));
          }
        }
      }
      step(world);
    }

    // eslint-disable-next-line no-console
    console.log(
      `outcome after ${tick} ticks:`,
      JSON.stringify(world.outcome),
      '| p1 units',
      unitQuery(world.ecs).filter((e) => Owner.player[e] === 1).length,
      '| enemy TCs alive',
      townCenterQuery(world.ecs).filter((e) => Owner.player[e] === 2 && Health.hp[e] > 0).length
    );

    expect(world.outcome.state).toBe('victory');
    if (world.outcome.state === 'victory') {
      expect(world.outcome.winnerPlayerId).toBe(1);
      expect(world.outcome.mode).toBe('conquest');
    }
  });
});
