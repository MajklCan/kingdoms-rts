import { describe, expect, it } from 'vitest';
import { PENDING_PLACEMENT_TICKS, PlacementChain } from './placement-chain';

const HOUSE = 1;
const FARM = 2;
const twoByTwo = { w: 2, h: 2 };

describe('PlacementChain', () => {
  it('counts placements of a building until the sim has built them', () => {
    const chain = new PlacementChain();
    chain.add({ defId: HOUSE, x: 10, y: 10, footprint: twoByTwo, tick: 100 });
    chain.add({ defId: HOUSE, x: 13, y: 10, footprint: twoByTwo, tick: 101 });
    chain.add({ defId: FARM, x: 20, y: 20, footprint: { w: 3, h: 3 }, tick: 101 });
    expect(chain.placed).toBe(3);
    expect(chain.pendingCount(HOUSE)).toBe(2);
    expect(chain.pendingCount(FARM)).toBe(1);

    // The first house now stands: it no longer counts against the bank.
    chain.settle(102, (p) => p.x === 10);
    expect(chain.pendingCount(HOUSE)).toBe(1);
    expect(chain.placed).toBe(3);
  });

  it('drops a placement the sim never answered', () => {
    const chain = new PlacementChain();
    chain.add({ defId: HOUSE, x: 10, y: 10, footprint: twoByTwo, tick: 100 });
    chain.settle(100 + PENDING_PLACEMENT_TICKS, () => false);
    expect(chain.pendingCount(HOUSE)).toBe(1);
    chain.settle(101 + PENDING_PLACEMENT_TICKS, () => false);
    expect(chain.pendingCount(HOUSE)).toBe(0);
  });

  it('drops everything when the world went back in time (new match, loaded save)', () => {
    const chain = new PlacementChain();
    chain.add({ defId: HOUSE, x: 10, y: 10, footprint: twoByTwo, tick: 500 });
    chain.settle(3, () => false);
    expect(chain.pendingCount(HOUSE)).toBe(0);
  });

  it('sees a footprint that shares a tile with a placement on its way', () => {
    const chain = new PlacementChain();
    // 2x2 anchored at (10, 10) covers tiles 9..10 on both axes.
    chain.add({ defId: HOUSE, x: 10, y: 10, footprint: twoByTwo, tick: 1 });
    expect(chain.overlaps(twoByTwo, 10, 10)).toBe(true);
    expect(chain.overlaps(twoByTwo, 11, 11)).toBe(true);
    expect(chain.overlaps(twoByTwo, 12, 10)).toBe(false);
    expect(chain.overlaps({ w: 1, h: 1 }, 9, 9)).toBe(true);
    expect(chain.overlaps({ w: 1, h: 1 }, 8, 9)).toBe(false);
  });

  it('reset forgets the chain', () => {
    const chain = new PlacementChain();
    chain.add({ defId: HOUSE, x: 10, y: 10, footprint: twoByTwo, tick: 1 });
    chain.reset();
    expect(chain.placed).toBe(0);
    expect(chain.pendingCount(HOUSE)).toBe(0);
    expect(chain.overlaps(twoByTwo, 10, 10)).toBe(false);
  });
});
