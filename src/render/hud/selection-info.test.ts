import { addComponent } from 'bitecs';
import { describe, expect, it } from 'vitest';
import { Owner, Selected } from '@sim/components';
import { BUILDING_TABLE, BuildingDefId } from '@sim/defs';
import { createSimWorld, spawnCompletedBuilding, townCenterQuery } from '@sim/world';
import type { SceneContext } from '../scene-context';
import { getSelectionInfo, getStatusInfo, STALL_HINT_DELAY_MS } from './selection-info';

/** Nothing selected; the sim last advanced `ms` ago and lacks `peers`' turns. */
function ctxWaiting(ms: number, peers: number[]): SceneContext {
  const session = { msSinceLastStep: () => ms, waitingForPeers: () => peers };
  return { world: createSimWorld(1), multiplayer: session } as unknown as SceneContext;
}

describe('multiplayer stall status', () => {
  it('stays quiet through the short waits lockstep makes every tick', () => {
    expect(getStatusInfo(ctxWaiting(0, [2])).text).not.toContain('waiting');
    expect(getStatusInfo(ctxWaiting(60, [2])).text).not.toContain('waiting');
    expect(getStatusInfo(ctxWaiting(STALL_HINT_DELAY_MS - 1, [2])).text).not.toContain('waiting');
  });

  it('names the peer once the sim has stood still long enough to feel', () => {
    expect(getStatusInfo(ctxWaiting(STALL_HINT_DELAY_MS, [2])).text).toBe('waiting for P2');
  });

  it('never blames a stall on nobody (only peers count, not ourselves)', () => {
    expect(getStatusInfo(ctxWaiting(5000, [])).text).not.toContain('waiting');
  });
});

describe('armed buildings in the selection panel', () => {
  it('a selected town center shows its own attack and range next to what it trains', () => {
    const world = createSimWorld(7);
    const tc = [...townCenterQuery(world.ecs)].find((eid) => Owner.player[eid] === 1)!;
    addComponent(world.ecs, Selected, tc);
    const combat = BUILDING_TABLE[BuildingDefId.TOWN_CENTER].combat!;
    const info = getSelectionInfo(world);
    expect(info.name).toBe('Town Center');
    expect(info.stats).toContain('Producer');
    expect(info.stats).toContain(`Atk ${combat.atk}  Rng ${combat.range}`);
  });

  it('a selected tower shows a shorter range than the town center', () => {
    const world = createSimWorld(7);
    const spawn = world.map.spawns[1];
    let tower = -1;
    for (let d = 5; d < 12 && tower < 0; d++) {
      for (const [dx, dy] of [[d, 0], [0, d], [d, d], [-d, 0], [0, -d]] as const) {
        const x = spawn.x + dx;
        const y = spawn.y + dy;
        if (world.map.walkability[y]?.[x] !== 0) continue;
        tower = spawnCompletedBuilding(world, BuildingDefId.DEFENSIVE_TOWER, x, y, 1);
        break;
      }
    }
    addComponent(world.ecs, Selected, tower);
    const range = (stats: string) => Number(/Rng ([\d.]+)/.exec(stats)?.[1]);
    const towerRange = range(getSelectionInfo(world).stats);
    expect(towerRange).toBe(BUILDING_TABLE[BuildingDefId.DEFENSIVE_TOWER].combat!.range);
    expect(BUILDING_TABLE[BuildingDefId.TOWN_CENTER].combat!.range).toBeGreaterThan(towerRange);
  });
});
