import { describe, expect, it } from 'vitest';
import { Health, Owner, VillagerTag } from '../components';
import { hasComponent } from 'bitecs';
import { createSimWorld, findIdleVillagers, spawnVillager, step, unitQuery } from '../world';

describe('findIdleVillagers', () => {
  it('lists own idle villagers in ascending order and drops busy or dead ones', () => {
    const world = createSimWorld(9);
    world.paused = false;
    world.aiPlayers = [];
    const a = spawnVillager(world, 20, 20, 1);
    const b = spawnVillager(world, 21, 20, 1);
    const enemy = spawnVillager(world, 22, 20, 2);
    const idle = findIdleVillagers(world, 1);
    expect(idle).toEqual([...idle].sort((x, y) => x - y));
    expect(idle).toContain(a);
    expect(idle).toContain(b);
    expect(idle).not.toContain(enemy);
    for (const eid of idle) {
      expect(Owner.player[eid]).toBe(1);
      expect(hasComponent(world.ecs, VillagerTag, eid)).toBe(true);
    }

    world.inputs.push({ type: 'cmdMove', playerId: 1, eids: [a], to: { x: 30, y: 30 } });
    step(world);
    expect(findIdleVillagers(world, 1)).not.toContain(a);

    Health.hp[b] = 0;
    expect(findIdleVillagers(world, 1)).not.toContain(b);
    expect(unitQuery(world.ecs)).toContain(b);
  });
});
