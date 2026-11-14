import { describe, expect, it } from 'vitest';
import { Owner } from '../components';
import {
  createSimWorld,
  isSelectionRelativeInput,
  selectedCommandableEids,
  setSelected,
  toSelfDescribingInput,
  unitQuery,
  type SimInput,
} from '../world';

function setup() {
  const world = createSimWorld(5);
  const mine = unitQuery(world.ecs).filter((eid) => Owner.player[eid] === 1);
  const theirs = unitQuery(world.ecs).filter((eid) => Owner.player[eid] === 2);
  // Select in reverse order plus an enemy: the result must be own units only, ascending.
  for (const eid of [...mine].reverse()) setSelected(world, eid, true);
  setSelected(world, theirs[0]!, true);
  return { world, mine: [...mine].sort((a, b) => a - b) };
}

describe('toSelfDescribingInput', () => {
  it('turns selection-relative orders into cmd* inputs for the given player only', () => {
    const { world, mine } = setup();
    expect(selectedCommandableEids(world, 1)).toEqual(mine);

    expect(toSelfDescribingInput(world, 1, { type: 'moveSelected', to: { x: 3, y: 4 } })).toEqual({
      type: 'cmdMove',
      playerId: 1,
      eids: mine,
      to: { x: 3, y: 4 },
    });
    expect(toSelfDescribingInput(world, 1, { type: 'attackMoveSelected', to: { x: 1, y: 2 } })).toMatchObject({
      type: 'cmdAttackMove',
      eids: mine,
    });
    expect(toSelfDescribingInput(world, 1, { type: 'attackSelected', targetEid: 99 })).toMatchObject({
      type: 'cmdAttack',
      targetEid: 99,
    });
    expect(toSelfDescribingInput(world, 1, { type: 'removeSelectedBuildings', playerId: 1 })).toMatchObject({
      type: 'cmdRemoveBuildings',
      playerId: 1,
    });
  });

  it('passes self-describing inputs through untouched', () => {
    const { world } = setup();
    const input: SimInput = { type: 'setArmyRallyPoint', playerId: 1, x: 2, y: 3 };
    expect(isSelectionRelativeInput(input)).toBe(false);
    expect(toSelfDescribingInput(world, 1, input)).toBe(input);
  });

  it('gives the other player an empty order from this selection', () => {
    const { world } = setup();
    const out = toSelfDescribingInput(world, 2, { type: 'stopSelected' });
    expect(out.type).toBe('cmdStop');
    expect(out.type === 'cmdStop' ? out.eids.length : -1).toBe(1);
  });
});
