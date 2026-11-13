import { describe, expect, it } from 'vitest';
import { sanitizeTurnCommands, sanitizeWireCommand } from './commands';

describe('cancelProduction slot', () => {
  it('keeps an integer slot and drops a malformed one', () => {
    expect(sanitizeWireCommand(2, { type: 'cancelProduction', atEid: 7, slot: 2 })).toEqual({
      type: 'cancelProduction',
      atEid: 7,
      slot: 2,
      playerId: 2,
    });
    expect(sanitizeWireCommand(2, { type: 'cancelProduction', atEid: 7 })).toEqual({
      type: 'cancelProduction',
      atEid: 7,
      playerId: 2,
    });
    expect(sanitizeWireCommand(2, { type: 'cancelProduction', atEid: 7, slot: 1.5 })).toBeNull();
    expect(sanitizeWireCommand(2, { type: 'cancelProduction', atEid: 7, slot: 'last' })).toBeNull();
  });
});

describe('sanitizeWireCommand', () => {
  it('keeps well-formed commands from their own player', () => {
    const move = { type: 'cmdMove', playerId: 2, eids: [4, 5], to: { x: 3, y: 4.5 } };
    expect(sanitizeWireCommand(2, move)).toEqual(move);
    expect(sanitizeWireCommand(2, { type: 'advanceAge', playerId: 2 })).not.toBeNull();
    expect(sanitizeWireCommand(2, { type: 'researchTech', playerId: 2, techId: 'x' })).not.toBeNull();
  });

  it('stamps the sender on commands whose playerId is optional', () => {
    expect(sanitizeWireCommand(2, { type: 'trainUnit', atEid: 7, defId: 3 })).toEqual({
      type: 'trainUnit',
      atEid: 7,
      defId: 3,
      playerId: 2,
    });
    expect(sanitizeWireCommand(2, { type: 'cancelProduction', atEid: 7, playerId: 1 })).toBeNull();
  });

  it('drops commands for another player, selection-relative or unknown types and bad fields', () => {
    for (const raw of [
      { type: 'cmdStop', playerId: 1, eids: [1] },
      { type: 'cmdStop', eids: [1] },
      { type: 'moveSelected', to: { x: 1, y: 1 } },
      { type: 'removeSelectedBuildings', playerId: 2 },
      { type: 'nope', playerId: 2 },
      { type: 'cmdMove', playerId: 2, eids: [1.5], to: { x: 1, y: 1 } },
      { type: 'cmdMove', playerId: 2, eids: [1], to: { x: Number.NaN, y: 1 } },
      { type: 'trainUnit', atEid: 7, defId: 3, count: 'many' },
      { type: 'placeBuilding', playerId: 2, defId: 1 },
      null,
      [],
      'cmdStop',
    ]) {
      expect(sanitizeWireCommand(2, raw), JSON.stringify(raw)).toBeNull();
    }
  });

  it('filters a turn packet command by command', () => {
    expect(sanitizeTurnCommands(2, 'nope')).toEqual([]);
    expect(
      sanitizeTurnCommands(2, [null, { type: 'cmdStop', playerId: 2, eids: [] }, { type: 'cmdStop', playerId: 1, eids: [] }])
    ).toEqual([{ type: 'cmdStop', playerId: 2, eids: [] }]);
  });
});
