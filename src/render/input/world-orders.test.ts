import { describe, expect, it } from 'vitest';
import { Position, Resource, ResourceKindId } from '@sim/components';
import { createSimWorld, isGameAnimal, resourceQuery, type SimWorld } from '@sim/world';
import type { PlayerCommands } from '../commands/player-commands';
import type { GameAudio } from '../game-audio';
import type { SceneContext } from '../scene-context';
import { WorldOrders } from './world-orders';

interface Sent {
  type: string;
  to?: { x: number; y: number };
  targetEid?: number;
  queue?: true;
}

/** A WorldOrders over a real sim world, with the scene and the command layer stubbed. */
function harness(world: SimWorld, selection: { units: number; gatherers: number }) {
  const sent: Sent[] = [];
  const failures: string[] = [];
  const ctx = {
    world,
    perspectivePlayerId: 1,
    layers: { root: { x: 0, y: 0 } },
    // Camera-world point = tile, for the test.
    pickTile: (x: number, y: number) => ({ tx: Math.round(x), ty: Math.round(y), tileX: x, tileY: y }),
    isEntityVisible: () => true,
    isResourceExplored: () => true,
  } as unknown as SceneContext;
  const commands = {
    selectedCommandableCount: () => selection.units,
    selectedGathererCount: () => selection.gatherers,
    selectedBuilderEids: () => [],
    selectedTownCenters: () => [],
    queuedOrderFailure: () => null,
    dispatch: (input: Sent) => sent.push(input),
    fail: (failure: { text: string }) => failures.push(failure.text),
    confirm: () => undefined,
  } as unknown as PlayerCommands;
  const audio = { barkMove: () => undefined, barkAttack: () => undefined } as unknown as GameAudio;
  return { orders: new WorldOrders(ctx, { commands, audio }), sent, failures };
}

function resourceOf(world: SimWorld, pick: (eid: number) => boolean): number {
  const eid = resourceQuery(world.ecs).find((e) => Resource.amount[e] > 0 && pick(e));
  if (eid === undefined) throw new Error('no such resource on this map');
  return eid;
}

describe('right click on a resource or an animal', () => {
  const world = createSimWorld(31);
  const tree = resourceOf(world, (e) => Resource.kind[e] === ResourceKindId.WOOD && !isGameAnimal(world, e));
  const stone = resourceOf(world, (e) => Resource.kind[e] === ResourceKindId.STONE);
  const at = (eid: number) => ({ x: Position.x[eid], y: Position.y[eid] });

  it('sends soldiers there as a plain move instead of refusing the click', () => {
    for (const target of [tree, stone]) {
      const { orders, sent, failures } = harness(world, { units: 5, gatherers: 0 });
      const p = at(target);
      orders.command(p.x, p.y);
      expect(failures).toEqual([]);
      expect(sent).toEqual([{ type: 'moveSelected', to: { x: Math.round(p.x), y: Math.round(p.y) } }]);
    }
  });

  it('does the same for a deer or a boar, when the map has game', () => {
    const game = resourceQuery(world.ecs).find((e) => Resource.amount[e] > 0 && isGameAnimal(world, e));
    if (game === undefined) return;
    const { orders, sent, failures } = harness(world, { units: 3, gatherers: 0 });
    const p = at(game);
    orders.command(p.x, p.y);
    expect(failures).toEqual([]);
    expect(sent.map((s) => s.type)).toEqual(['moveSelected']);
  });

  it('queues that move with Shift held', () => {
    const { orders, sent } = harness(world, { units: 5, gatherers: 0 });
    const p = at(tree);
    orders.command(p.x, p.y, true);
    expect(sent).toEqual([{ type: 'moveSelected', to: { x: Math.round(p.x), y: Math.round(p.y) }, queue: true }]);
  });

  it('still gathers when a villager is in the selection', () => {
    const { orders, sent, failures } = harness(world, { units: 2, gatherers: 1 });
    const p = at(tree);
    orders.command(p.x, p.y);
    expect(failures).toEqual([]);
    expect(sent).toEqual([{ type: 'gatherSelected', targetEid: tree }]);
  });

  it('walks villagers to a spent node rather than refusing', () => {
    const spent = resourceOf(world, (e) => Resource.kind[e] === ResourceKindId.WOOD && e !== tree);
    Resource.amount[spent] = 0;
    const { orders, sent, failures } = harness(world, { units: 1, gatherers: 1 });
    const p = at(spent);
    orders.command(p.x, p.y);
    expect(failures).toEqual([]);
    expect(sent.map((s) => s.type)).toEqual(['moveSelected']);
  });
});
