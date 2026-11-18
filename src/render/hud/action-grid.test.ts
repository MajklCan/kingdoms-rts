import { addComponent, hasComponent } from 'bitecs';
import { describe, expect, it } from 'vitest';
import { Owner, Selected, VillagerTag } from '@sim/components';
import { LOCAL_PLAYER_ID, createSimWorld, unitQuery } from '@sim/world';
import { AgeId } from '@sim/defs';
import type { SimWorld } from '@sim/world';
import type { SceneContext } from '../scene-context';
import type { PlayerCommands } from '../commands/player-commands';
import type { BuildPlacement } from '../placement/build-placement';
import { ActionGrid } from './action-grid';

const ENDLESS_BUTTONS = ['build-mint', 'build-brickworks', 'build-forester'];

function villagerGrid(world: SimWorld): ActionGrid {
  const villager = unitQuery(world.ecs).find((eid) =>
    Owner.player[eid] === LOCAL_PLAYER_ID && hasComponent(world.ecs, VillagerTag, eid)
  );
  if (villager === undefined) throw new Error('no starter villager');
  addComponent(world.ecs, Selected, villager);
  const ctx = { world, perspectivePlayerId: LOCAL_PLAYER_ID } as unknown as SceneContext;
  return new ActionGrid(ctx, {} as PlayerCommands, {} as BuildPlacement);
}

describe('villager build buttons for the endless worksites', () => {
  it('stay off the grid in the Dark Age', () => {
    const world = createSimWorld(1);
    const ids = villagerGrid(world).available().map((a) => a.id);
    for (const id of ENDLESS_BUTTONS) expect(ids, id).not.toContain(id);
    // Other locked buildings still show as locked buttons.
    expect(ids).toContain('build-barracks');
  });

  it('appear once ring II (Castle Age) is open', () => {
    const world = createSimWorld(1, { startingAge: AgeId.CASTLE });
    const actions = villagerGrid(world).available();
    for (const id of ENDLESS_BUTTONS) {
      const action = actions.find((a) => a.id === id);
      expect(action, id).toBeDefined();
    }
  });
});
