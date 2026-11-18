import { describe, expect, it } from 'vitest';
import { splitTraining } from './train-split';

describe('splitTraining', () => {
  it('sends one unit to the producer with the shortest queue', () => {
    expect(splitTraining([{ eid: 7, queued: 2 }, { eid: 3, queued: 0 }, { eid: 9, queued: 1 }], 1)).toEqual([
      { eid: 3, count: 1 },
    ]);
  });

  it('breaks ties by list order', () => {
    expect(splitTraining([{ eid: 7, queued: 1 }, { eid: 3, queued: 1 }], 1)).toEqual([{ eid: 7, count: 1 }]);
  });

  it('spreads a batch so the queues even out', () => {
    expect(splitTraining([{ eid: 1, queued: 0 }, { eid: 2, queued: 3 }, { eid: 4, queued: 0 }], 5)).toEqual([
      { eid: 1, count: 3 },
      { eid: 4, count: 2 },
    ]);
  });

  it('gives a single producer the whole batch', () => {
    expect(splitTraining([{ eid: 5, queued: 4 }], 5)).toEqual([{ eid: 5, count: 5 }]);
  });

  it('returns nothing without producers or units', () => {
    expect(splitTraining([], 3)).toEqual([]);
    expect(splitTraining([{ eid: 5, queued: 0 }], 0)).toEqual([]);
  });
});
