import { describe, expect, it } from 'vitest';
import { UnitStanceId } from '@sim/components';
import { BuildingDefId, UnitDefId } from '@sim/defs';
import { TECH_TREE, TechId } from '@sim/tech-tree';
import type { SimInput } from '@sim/world';
import { UI_FEATURES, buildTraceCatalog, commandFeature } from './trace-catalog';

const MODES = ['LUMBER_CAMP', 'STONE_QUARRY', 'HOUSE', 'BARRACKS', 'GOLD_MINE', 'STABLE', 'FARM', 'MILL', 'FOUNDRY', 'DEFENSIVE_TOWER', 'WALL'];

describe('trace catalog', () => {
  const catalog = buildTraceCatalog(MODES);
  const ids = new Set(catalog.map((f) => f.id));

  it('lists each feature once with a label', () => {
    expect(ids.size).toBe(catalog.length);
    for (const f of catalog) expect(f.label.length).toBeGreaterThan(0);
  });

  it('offers exactly the buildings on the build buttons', () => {
    for (const mode of MODES) {
      expect(ids.has(`build:${mode}`)).toBe(true);
      expect(ids.has(`build-arm:${mode}`)).toBe(true);
    }
    expect(ids.has('build:ARCHERY_RANGE')).toBe(false);
    expect(ids.has('build:TOWN_CENTER')).toBe(false);
  });

  it('offers the units those buildings and the town center train, not legacy ones', () => {
    for (const unit of ['VILLAGER', 'SPEARMAN', 'ARCHER', 'COMMANDER', 'SCOUT_CAVALRY', 'GUNMAN', 'CANNON']) {
      expect(ids.has(`train:${unit}`)).toBe(true);
    }
    expect(ids.has('train:MILITIA')).toBe(false);
    expect(ids.has('train:MACHINE_GUN')).toBe(false);
  });

  it('offers every technology and every UI feature', () => {
    for (const tech of TECH_TREE) expect(ids.has(`research:${tech.id}`)).toBe(true);
    for (const id of Object.keys(UI_FEATURES)) expect(ids.has(id)).toBe(true);
  });

  it('has a catalog entry for every command the HUD sends', () => {
    // One of each SimInput type the render layer dispatches.
    const sent: SimInput[] = [
      { type: 'moveSelected', to: { x: 1, y: 1 } },
      { type: 'moveSelected', to: { x: 1, y: 1 }, queue: true },
      { type: 'attackMoveSelected', to: { x: 1, y: 1 } },
      { type: 'attackSelected', targetEid: 5 },
      { type: 'gatherSelected', targetEid: 5 },
      { type: 'buildSelected', targetEid: 5 },
      { type: 'assignWorksiteSelected', targetEid: 5 },
      { type: 'cmdAssignWorksite', playerId: 1, eids: [3], targetEid: 5 },
      { type: 'stopSelected' },
      { type: 'setSelectedUnitStance', stance: UnitStanceId.HOLD_POSITION },
      { type: 'setSelectedUnitStance', stance: UnitStanceId.AUTO_DEFEND },
      { type: 'setFormationMode', mode: 0 },
      { type: 'setFormationMode', mode: 1 },
      { type: 'setFormationMode', mode: 2 },
      { type: 'rotateSelectedFormation', delta: 1 },
      { type: 'cmdRemoveBuildings', playerId: 1, eids: [9] },
      { type: 'setArmyRallyPoint', playerId: 1, x: 2, y: 2 },
      { type: 'setVillagerRally', playerId: 1, atEid: 4, x: 2, y: 2 },
      { type: 'clearVillagerRally', playerId: 1, atEid: 4 },
      { type: 'placeBuilding', defId: BuildingDefId.FARM, x: 3, y: 3, playerId: 1 },
      { type: 'placeWallLine', playerId: 1, x0: 0, y0: 0, x1: 4, y1: 0 },
      { type: 'trainUnit', atEid: 4, defId: UnitDefId.VILLAGER },
      { type: 'cancelProduction', atEid: 4, playerId: 1, slot: 0 },
      { type: 'researchTech', playerId: 1, techId: TechId.ARCHERS },
    ];
    for (const input of sent) {
      const { feature, queued } = commandFeature(input);
      expect(ids.has(feature), `${input.type} -> ${feature}`).toBe(true);
      if (queued) expect(ids.has('order:shift-queue')).toBe(true);
    }
  });
});

describe('commandFeature', () => {
  it('names buildings, units and techs by their table keys', () => {
    expect(commandFeature({ type: 'placeBuilding', defId: BuildingDefId.HOUSE, x: 0, y: 0, playerId: 1 }).feature).toBe('build:HOUSE');
    expect(commandFeature({ type: 'placeWallLine', playerId: 1, x0: 0, y0: 0, x1: 2, y1: 0 }).feature).toBe('build:WALL');
    expect(commandFeature({ type: 'trainUnit', atEid: 1, defId: UnitDefId.ARCHER, count: 5 })).toEqual({
      feature: 'train:ARCHER',
      detail: 'x5',
      queued: false,
    });
    expect(commandFeature({ type: 'researchTech', playerId: 1, techId: TechId.KNIGHTS }).feature).toBe('research:knights');
  });

  it('treats the selection and the multiplayer forms of an order alike', () => {
    expect(commandFeature({ type: 'moveSelected', to: { x: 0, y: 0 } }).feature).toBe('order:move');
    expect(commandFeature({ type: 'cmdMove', playerId: 1, eids: [1], to: { x: 0, y: 0 } }).feature).toBe('order:move');
    expect(commandFeature({ type: 'cmdSetStance', playerId: 1, eids: [1], stance: UnitStanceId.HOLD_POSITION }).feature).toBe(
      'stance:hold'
    );
  });

  it('flags Shift-queued orders', () => {
    expect(commandFeature({ type: 'gatherSelected', targetEid: 3, queue: true }).queued).toBe(true);
    expect(commandFeature({ type: 'gatherSelected', targetEid: 3 }).queued).toBe(false);
    expect(commandFeature({ type: 'stopSelected' }).queued).toBe(false);
  });
});
