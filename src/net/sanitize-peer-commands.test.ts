import { describe, expect, it } from 'vitest';
import type { SimInput } from '@sim/world';
import { sanitizePeerCommands } from './session';

describe('sanitizePeerCommands', () => {
  it('forces every accepted command to the relay-stamped sender id', () => {
    const forged: SimInput[] = [
      { type: 'placeBuilding', defId: 0, x: 1, y: 1, playerId: 1 }, // claims to be P1
      { type: 'advanceAge', playerId: 1 },
      { type: 'researchTech', playerId: 1, techId: 'castle_age' },
      { type: 'cmdMove', playerId: 1, eids: [42], to: { x: 5, y: 5 } },
    ];
    const out = sanitizePeerCommands(2, forged);
    expect(out).toHaveLength(4);
    for (const cmd of out) {
      expect((cmd as { playerId: number }).playerId).toBe(2);
    }
  });

  it('stamps the sender onto commands with an optional ownerless playerId', () => {
    const out = sanitizePeerCommands(2, [
      { type: 'trainUnit', atEid: 7, defId: 0 }, // no playerId supplied
      { type: 'cancelProduction', atEid: 7 },
    ]);
    expect(out).toEqual([
      { type: 'trainUnit', atEid: 7, defId: 0, playerId: 2 },
      { type: 'cancelProduction', atEid: 7, playerId: 2 },
    ]);
  });

  it('drops selection-relative commands a peer must never drive', () => {
    const out = sanitizePeerCommands(2, [
      { type: 'moveSelected', to: { x: 1, y: 1 } },
      { type: 'removeSelectedBuildings', playerId: 1 },
      { type: 'stopSelected' },
      { type: 'cmdStop', playerId: 1, eids: [3] }, // the one network-safe cmd survives
    ]);
    expect(out).toEqual([{ type: 'cmdStop', playerId: 2, eids: [3] }]);
  });

  it('preserves command payloads other than playerId', () => {
    const [cmd] = sanitizePeerCommands(2, [
      { type: 'cmdAttack', playerId: 9, eids: [1, 2, 3], targetEid: 88 },
    ]);
    expect(cmd).toEqual({ type: 'cmdAttack', playerId: 2, eids: [1, 2, 3], targetEid: 88 });
  });
});
