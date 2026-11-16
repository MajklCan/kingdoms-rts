import { describe, expect, it } from 'vitest';
import { AgeId } from '../defs';
import { TechId, TECH_TREE, openRing, techIdsInRing, techsThroughRing } from '../tech-tree';
import { createSimWorld } from '../world';
import { checksumWorld } from '../checksum';
import { loadSimWorldSnapshot, migrateSavedGame, parseSavedGame, serializeSimWorld } from '../save-load';
import { addComponent, hasComponent } from 'bitecs';
import { GameSpeciesId, NetId, Owner, VillagerJobId, VillagerTag, VillagerWork } from '../components';
import { commanderQuery, gameAnimalQuery, gathererQuery } from '../core/queries';
import { spawnGameAnimal } from '../factories/game-animals';
import { spawnCommander } from '../factories/units';
import { SAVE_VERSION, type SavedGameV3, type SavedGameV4, type SavedGameV4Roles } from './schema';

/** A v3 save of a fresh world, with the given per-player ages and research. */
function v3Save(
  seed: number,
  ages: Array<{ current: number; progress: number; totalTicks: number }>,
  techs: string[][],
  lockedTechs?: string[]
): SavedGameV3 {
  const world = createSimWorld(seed);
  const v4 = JSON.parse(JSON.stringify(serializeSimWorld(world, 'old'))) as ReturnType<typeof serializeSimWorld>;
  const campaign = lockedTechs
    ? {
      missionId: 'siege_of_brno' as never,
      name: 'Siege of Brno',
      description: '',
      briefing: '',
      lockedTechs,
      objectives: [],
      trackedObjectiveEids: {},
      enemyAiMode: 'defensive' as const,
      nextReinforcementTick: 0,
    }
    : null;
  return { ...v4, version: 3, ages, researchedTechs: techs, campaign };
}

const IDLE = (current: number) => ({ current, progress: -1, totalTicks: 0 });
const OLD_START = ['lumber_huts', 'stone_mines'];
const OLD_CASTLE = [...OLD_START, 'barracks_pikemen', 'archers', 'housing_i', 'lumber_crews', 'mining_crews', 'mills'];

describe('save v3 -> v4 (tech rings)', () => {
  it('turns a Castle Age save into all of ring I, and a Gunpowder Age save into rings I and II', () => {
    const save = v3Save(
      901,
      [IDLE(AgeId.DARK), IDLE(AgeId.CASTLE), IDLE(AgeId.GUNPOWDER)],
      [OLD_START, OLD_CASTLE, [...OLD_CASTLE, 'farms', 'housing_ii']]
    );
    const migrated = migrateSavedGame(save)!;
    expect(migrated.version).toBe(SAVE_VERSION);
    expect(migrated.researchedTechs[0]).toEqual([]);
    expect([...migrated.researchedTechs[1]].sort()).toEqual([...techIdsInRing(1)].sort());
    expect([...migrated.researchedTechs[2]].sort()).toEqual([...techsThroughRing(2)].sort());
    expect(migrated.ages).toEqual([{ current: AgeId.DARK }, { current: AgeId.CASTLE }, { current: AgeId.GUNPOWDER }]);

    const world = createSimWorld(1);
    loadSimWorldSnapshot(world, save);
    expect(openRing(world, 1)).toBe(2);
    expect(openRing(world, 2)).toBe(3);
    expect(world.ages[1]).toEqual({ current: AgeId.CASTLE });
  });

  it('keeps research that still exists and hands moved unlocks to their new research', () => {
    const save = v3Save(902, [IDLE(0), IDLE(AgeId.DARK), IDLE(AgeId.DARK)], [[], [...OLD_START, 'barracks_pikemen'], [...OLD_START, 'lumber_crews', 'mills']]);
    const migrated = migrateSavedGame(save)!;
    // The old Barracks research also brought palisade walls and the Commander.
    expect([...migrated.researchedTechs[1]].sort()).toEqual([TechId.BARRACKS_PIKEMEN, TechId.PALISADES, TechId.COMMANDER].sort());
    expect([...migrated.researchedTechs[2]].sort()).toEqual([TechId.LUMBER_CREWS, TechId.MILLS].sort());
    expect(migrated.ages[1]).toEqual({ current: AgeId.DARK });

    // Barracks + Archers brought palisades and towers: arms and walls are both
    // maxed in ring I, so ring II opens and the era follows.
    const armed = v3Save(903, [IDLE(0), IDLE(AgeId.DARK), IDLE(AgeId.DARK)], [[], [...OLD_START, 'barracks_pikemen', 'archers'], OLD_START]);
    const armedV4 = migrateSavedGame(armed)!;
    expect(armedV4.researchedTechs[1]).toContain(TechId.WATCHTOWERS);
    expect(armedV4.ages[1]).toEqual({ current: AgeId.CASTLE });
  });

  it('drops an age advance in progress and refunds its fee', () => {
    const save = v3Save(904, [IDLE(0), { current: AgeId.DARK, progress: 120, totalTicks: 800 }, { current: AgeId.CASTLE, progress: 5, totalTicks: 1000 }], [[], OLD_START, OLD_CASTLE]);
    const before = save.resources.map((bank) => bank.slice());
    const migrated = migrateSavedGame(save)!;
    expect(migrated.ages).toEqual([{ current: 0 }, { current: AgeId.DARK }, { current: AgeId.CASTLE }]);
    expect(migrated.resources[1]).toEqual([before[1][0], before[1][1] + 750, before[1][2], before[1][3] + 500]);
    expect(migrated.resources[2]).toEqual([before[2][0], before[2][1] + 1400, before[2][2] + 1200, before[2][3] + 1000]);
    // The save object itself is not changed.
    expect(save.resources).toEqual(before);
  });

  it('turns a locked Gunpowder Age into a locked ring III', () => {
    const save = v3Save(905, [IDLE(0), IDLE(AgeId.DARK), IDLE(AgeId.CASTLE)], [[], OLD_START, OLD_CASTLE], ['gunpowder_age']);
    const migrated = migrateSavedGame(save)!;
    expect(migrated.campaign?.lockedTechs).toEqual(techIdsInRing(3));
  });

  it('round-trips a current save: research, era and checksum', () => {
    const world = createSimWorld(906, { startingAge: AgeId.CASTLE });
    world.researchedTechs[1].add(TechId.GOLD_MINES);
    const text = JSON.stringify(serializeSimWorld(world, 'v5'));
    const parsed = parseSavedGame(text)!;
    expect(parsed.version).toBe(SAVE_VERSION);
    const restored = createSimWorld(1);
    loadSimWorldSnapshot(restored, parsed);
    expect([...restored.researchedTechs[1]].sort()).toEqual([...world.researchedTechs[1]].sort());
    expect(restored.ages).toEqual(world.ages);
    expect(checksumWorld(restored)).toBe(checksumWorld(world));
    expect(TECH_TREE.length).toBe(18);
  });

  it('parses a v3 file from text', () => {
    const save = v3Save(907, [IDLE(0), IDLE(AgeId.CASTLE), IDLE(AgeId.CASTLE)], [[], OLD_CASTLE, OLD_CASTLE]);
    const parsed = parseSavedGame(JSON.stringify(save));
    expect(parsed?.version).toBe(SAVE_VERSION);
    expect(parsed?.researchedTechs[1]).toHaveLength(techIdsInRing(1).length);
  });
});

describe('save v4 -> v5 (both v4 formats)', () => {
  /** A roles-branch v4: the v3 shape (ages with an advance, old research ids) plus the new entity fields. */
  function rolesV4(seed: number): { save: SavedGameV4Roles; villagerNetId: number } {
    const world = createSimWorld(seed);
    spawnCommander(world, 30, 30, 1);
    spawnGameAnimal(world, GameSpeciesId.DEER, 34, 34);
    const villager = [...gathererQuery(world.ecs)].find((eid) => Owner.player[eid] === 1 && hasComponent(world.ecs, VillagerTag, eid))!;
    addComponent(world.ecs, VillagerWork, villager);
    VillagerWork.job[villager] = VillagerJobId.GATHER;
    VillagerWork.kind[villager] = 1;
    VillagerWork.x[villager] = 12;
    VillagerWork.y[villager] = 13;
    const current = JSON.parse(JSON.stringify(serializeSimWorld(world, 'roles v4'))) as ReturnType<typeof serializeSimWorld>;
    const save = {
      ...current,
      version: 4,
      ages: [IDLE(0), { current: AgeId.DARK, progress: 120, totalTicks: 800 }, IDLE(AgeId.DARK)],
      researchedTechs: [[], [...OLD_START, 'barracks_pikemen', 'archers'], OLD_START],
      campaign: null,
    } as unknown as SavedGameV4Roles;
    return { save, villagerNetId: NetId.value[villager] };
  }

  it('reads a roles v4 save as age research: refunds the advance, maps research, keeps the new entities', () => {
    const { save, villagerNetId } = rolesV4(911);
    const before = save.resources[1].slice();
    const parsed = parseSavedGame(JSON.stringify(save))!;
    expect(parsed.version).toBe(SAVE_VERSION);
    expect(parsed.ages[1]).toEqual({ current: AgeId.CASTLE });
    expect(parsed.resources[1]).toEqual([before[0], before[1] + 750, before[2], before[3] + 500]);
    expect([...parsed.researchedTechs[1]].sort()).toEqual(
      [TechId.BARRACKS_PIKEMEN, TechId.ARCHERS, TechId.COMMANDER, TechId.PALISADES, TechId.WATCHTOWERS].sort()
    );
    expect(parsed.entities.some((e) => e.commander)).toBe(true);
    expect(parsed.entities.some((e) => e.gameAnimal)).toBe(true);

    const world = createSimWorld(1);
    loadSimWorldSnapshot(world, parsed);
    expect(openRing(world, 1)).toBe(2);
    expect([...commanderQuery(world.ecs)]).toHaveLength(1);
    expect([...gameAnimalQuery(world.ecs)].length).toBeGreaterThan(0);
    const villager = world.netIdToEid.get(villagerNetId)!;
    expect(hasComponent(world.ecs, VillagerWork, villager)).toBe(true);
    expect([VillagerWork.job[villager], VillagerWork.x[villager], VillagerWork.y[villager]]).toEqual([VillagerJobId.GATHER, 12, 13]);
  });

  it('reads a rings v4 save as is and grants the Commander research with Barracks, so ring II stays open', () => {
    const world = createSimWorld(912);
    for (const id of [TechId.BARRACKS_PIKEMEN, TechId.ARCHERS, TechId.LUMBER_CREWS, TechId.HOUSING_I]) world.researchedTechs[1].add(id);
    world.researchedTechs[2].add(TechId.MILLS);
    world.ages[1].current = AgeId.CASTLE;
    const current = JSON.parse(JSON.stringify(serializeSimWorld(world, 'rings v4'))) as ReturnType<typeof serializeSimWorld>;
    const ringsV4: SavedGameV4 = {
      ...current,
      version: 4,
      researchedTechs: current.researchedTechs.map((ids) => ids.filter((id) => id !== TechId.COMMANDER)),
    };
    const parsed = parseSavedGame(JSON.stringify(ringsV4))!;
    expect(parsed.version).toBe(SAVE_VERSION);
    expect(parsed.ages[1]).toEqual({ current: AgeId.CASTLE });
    expect(parsed.researchedTechs[1]).toContain(TechId.COMMANDER);
    expect(parsed.researchedTechs[2]).toEqual([TechId.MILLS]);
    expect(parsed.resources).toEqual(current.resources);
    const restored = createSimWorld(1);
    loadSimWorldSnapshot(restored, parsed);
    expect(openRing(restored, 1)).toBe(2);
  });

  it('refuses a save from a newer version', () => {
    const world = createSimWorld(913);
    const text = JSON.stringify({ ...serializeSimWorld(world, 'future'), version: SAVE_VERSION + 1 });
    expect(parseSavedGame(text)).toBeNull();
  });
});
