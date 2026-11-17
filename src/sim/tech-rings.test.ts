import { describe, expect, it } from 'vitest';
import { AgeId } from './defs';
import {
  TechId,
  type TechIdValue,
  type TechStateWorld,
  isRingOpen,
  maxedPaths,
  openRing,
  techIdsInRing,
  techLockedReason,
  techStatus,
} from './tech-tree';
import { createSimWorld, step, type SimWorld } from './world';

function stateWith(...techs: TechIdValue[]): TechStateWorld {
  return { researchedTechs: [new Set(), new Set(techs)], ages: [{ current: 0 }, { current: AgeId.DARK }] };
}

const ARMS_I = [TechId.BARRACKS_PIKEMEN, TechId.ARCHERS, TechId.KNIGHTS];
const TIMBER_I = [TechId.LUMBER_CREWS, TechId.HOUSING_I];
const WALLS_I = [TechId.PALISADES, TechId.WATCHTOWERS];
const RING_I = techIdsInRing(1);

function research(world: SimWorld, ...techs: TechIdValue[]): void {
  for (const techId of techs) world.inputs.push({ type: 'researchTech', playerId: 1, techId });
  step(world);
}

describe('tech rings', () => {
  it('keeps ring I open and ring II shut at the start', () => {
    const state = stateWith();
    expect(isRingOpen(state, 1, 1)).toBe(true);
    expect(isRingOpen(state, 1, 2)).toBe(false);
    expect(openRing(state, 1)).toBe(1);
    expect(techLockedReason(state, 1, TechId.GOLD_MINES)).toBe(
      'Ring II opens when 2 paths are complete in ring I (0 of 2). Needs Mining Crews'
    );
  });

  it('opens ring II when two paths are maxed in ring I', () => {
    const one = stateWith(...ARMS_I);
    expect(maxedPaths(one, 1, 1)).toEqual(['arms']);
    expect(isRingOpen(one, 1, 2)).toBe(false);
    expect(techLockedReason(one, 1, TechId.HOUSING_II)).toContain('(1 of 2)');

    const two = stateWith(...ARMS_I, ...TIMBER_I);
    expect(maxedPaths(two, 1, 1)).toEqual(['arms', 'timber']);
    expect(openRing(two, 1)).toBe(2);
    expect(techStatus(two, 1, TechId.HOUSING_II)).toBe('available');
    expect(techStatus(two, 1, TechId.STONE_WALLS)).toBe('locked'); // Towers first

    // The two cheap one-seal roots open it too.
    expect(openRing(stateWith(TechId.MINING_CREWS, TechId.MILLS), 1)).toBe(2);
  });

  it('never opens a ring with a single path, however far it goes', () => {
    // A half-done path does not count: Barracks alone plus Palisades alone is nothing.
    expect(openRing(stateWith(TechId.BARRACKS_PIKEMEN, TechId.PALISADES, TechId.LUMBER_CREWS), 1)).toBe(1);
    for (const path of [ARMS_I, TIMBER_I, WALLS_I, [TechId.MINING_CREWS], [TechId.MILLS]]) {
      expect(openRing(stateWith(...path), 1), path.join('+')).toBe(1);
    }
    // Ring II with one ring II path maxed (and ring II's other seals missing) keeps ring III shut.
    const mines = stateWith(...RING_I, TechId.GOLD_MINES);
    expect(openRing(mines, 1)).toBe(2);
    expect(techStatus(mines, 1, TechId.FOUNDRY)).toBe('locked');
    expect(techLockedReason(mines, 1, TechId.FOUNDRY)).toBe('Ring III opens when 2 paths are complete in ring II (1 of 2)');
  });

  it('opens ring III when two paths are maxed in ring II', () => {
    const state = stateWith(...RING_I, TechId.GOLD_MINES, TechId.FARMS);
    expect(maxedPaths(state, 1, 2)).toEqual(['mines', 'land']);
    expect(openRing(state, 1)).toBe(3);
    expect(techStatus(state, 1, TechId.FOUNDRY)).toBe('available');
    expect(techStatus(state, 1, TechId.HOUFNICE)).toBe('locked');
    expect(techStatus(state, 1, TechId.BRICK_WALLS)).toBe('locked');
  });

  it('branches arms after Barracks: Archers and Cavalry each need only Barracks, in ring I', () => {
    const none = stateWith();
    expect(techLockedReason(none, 1, TechId.ARCHERS)).toBe('Needs Barracks');
    expect(techLockedReason(none, 1, TechId.KNIGHTS)).toBe('Needs Barracks');

    const barracks = stateWith(TechId.BARRACKS_PIKEMEN);
    expect(techStatus(barracks, 1, TechId.ARCHERS)).toBe('available');
    // Cavalry needs neither Archers nor a gold mine any more.
    expect(techStatus(barracks, 1, TechId.KNIGHTS)).toBe('available');

    // The path counts for the ring only with both branches done.
    expect(maxedPaths(stateWith(TechId.BARRACKS_PIKEMEN, TechId.ARCHERS), 1, 1)).toEqual([]);
    expect(maxedPaths(stateWith(TechId.BARRACKS_PIKEMEN, TechId.KNIGHTS), 1, 1)).toEqual([]);
    expect(maxedPaths(stateWith(...ARMS_I), 1, 1)).toEqual(['arms']);
    // Arms has nothing in ring II, so it cannot help open ring III.
    expect(maxedPaths(stateWith(...RING_I, TechId.GOLD_MINES), 1, 2)).toEqual(['mines']);
  });

  it('researches instantly, and the era follows the ring the moment it opens', () => {
    const world = createSimWorld(601);
    world.paused = false;
    world.resources[1].set([0, 5000, 0, 5000]);

    research(world, ...ARMS_I);
    expect(techStatus(world, 1, TechId.ARCHERS)).toBe('researched');
    expect(world.resources[1][1]).toBe(5000 - 250 - 300 - 300);
    expect(world.ages[1].current).toBe(AgeId.DARK);

    research(world, TechId.LUMBER_CREWS, TechId.HOUSING_I);
    expect(world.ages[1].current).toBe(AgeId.CASTLE);
    expect(world.gameEvents.some((e) => e.kind === 'ageAdvanced' && e.playerId === 1 && e.ageId === AgeId.CASTLE)).toBe(true);
    expect(world.soundCues.some((c) => c.kind === 'age_up' && c.player === 1)).toBe(true);
    expect(world.ages[2].current).toBe(AgeId.DARK);

    world.resources[1].set([0, 5000, 0, 5000]);
    research(world, TechId.MINING_CREWS, TechId.GOLD_MINES, TechId.MILLS, TechId.FARMS);
    expect(world.ages[1].current).toBe(AgeId.GUNPOWDER);
  });

  it('refuses research whose ring is closed, without charging', () => {
    const world = createSimWorld(602);
    world.paused = false;
    world.resources[1].set([0, 5000, 5000, 5000]);
    research(world, TechId.MINING_CREWS, TechId.GOLD_MINES);
    expect(techStatus(world, 1, TechId.GOLD_MINES)).toBe('locked');
    expect(Array.from(world.resources[1])).toEqual([0, 5000 - 300, 5000, 5000 - 250]);
  });

  it('keeps a campaign-locked ring shut, and its era with it', () => {
    const world = createSimWorld(603, { startingAge: AgeId.CASTLE });
    world.paused = false;
    world.campaign = {
      missionId: 'siege_of_brno' as never,
      name: '',
      description: '',
      briefing: '',
      lockedTechs: techIdsInRing(3),
      objectives: [],
      trackedObjectiveEids: {},
      enemyAiMode: 'defensive',
      nextReinforcementTick: 0,
    };
    world.resources[1].set([0, 5000, 5000, 5000]);
    research(world, TechId.GOLD_MINES, TechId.FARMS);
    expect(maxedPaths(world, 1, 2)).toEqual(['mines', 'land']);
    expect(openRing(world, 1)).toBe(2);
    expect(world.ages[1].current).toBe(AgeId.CASTLE);
    expect(techLockedReason(world, 1, TechId.FOUNDRY)).toBe('Locked for this mission');
  });

  it('moves the era for techs granted outside the research command', () => {
    const world = createSimWorld(604);
    world.paused = false;
    for (const techId of [...ARMS_I, TechId.MILLS]) world.researchedTechs[1].add(techId);
    step(world);
    expect(world.ages[1].current).toBe(AgeId.CASTLE);
  });
});
