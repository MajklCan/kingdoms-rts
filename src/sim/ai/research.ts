/**
 * AI research: one fixed order per difficulty along the rings.
 *
 * Every AI opens ring II with Timber (Lumber Crews, Housing I: wood workers
 * and the house limit) and Arms (Barracks, Archers: its army), then takes
 * Mines to Gold Mine and Cavalry to open ring III, and the Mines path on to
 * the Foundry and Cannons. Land (Mills, Farming I, Farming II) comes in
 * for food; medium and hard take Palisades and Towers last, for their
 * tower.
 * Each step waits for the economy it needs (a lumber hut before Lumber Crews,
 * a quarry before stone research, enough farms before mills), like the age
 * thresholds this replaces. Research is instant, so a step is just a purchase.
 */

import { BuildingDefId, canAfford, getAgeDef } from '../defs';
import { TechId, type TechIdValue, openRing, ringEra, techDef, techStatus } from '../tech-tree';
import { countQueuedPopCost } from '../core/population';
import type { AiDifficulty, AiPlayerState, SimWorld } from '../core/types';
import { activeAiActuator } from './direct-actuator';
import { aiDifficultyOf, aiSettings } from './difficulty';
import { type AiSnapshot, aiHasAnyBuilding, countAiBuildings } from './snapshot';

/** Economy a research waits for before the AI buys it. */
interface AiEconomyGate {
  farms?: number;
  lumber?: number;
  stone?: number;
  gold?: number;
  barracks?: boolean;
  houses?: number;
  /** Only while the population cap is close (or always, on hard). */
  capPressure?: boolean;
}

interface AiResearchStep {
  tech: TechIdValue;
  gate: AiEconomyGate;
}

const step = (tech: TechIdValue, gate: AiEconomyGate = {}): AiResearchStep => ({ tech, gate });

const AI_RESEARCH_ORDER: Record<AiDifficulty, readonly AiResearchStep[]> = {
  easy: [
    step(TechId.LUMBER_CREWS, { lumber: 2 }),
    step(TechId.BARRACKS_PIKEMEN, { farms: 1, lumber: 1 }),
    step(TechId.HOUSING_I, { stone: 1, houses: 2 }),
    step(TechId.ARCHERS, { barracks: true, stone: 1, farms: 2 }),
    step(TechId.MINING_CREWS, { stone: 1, farms: 3 }),
    step(TechId.MILLS, { farms: 3 }),
    step(TechId.GOLD_MINES, { farms: 4, lumber: 2 }),
    step(TechId.KNIGHTS, { farms: 4, gold: 1 }),
    step(TechId.FARMS, { farms: 4 }),
    step(TechId.FOUNDRY, { farms: 5, lumber: 2, gold: 1 }),
    step(TechId.HOUFNICE, { farms: 5, gold: 1 }),
    step(TechId.HOUSING_II, { houses: 6, capPressure: true }),
    step(TechId.FARMS_II, { farms: 6 }),
  ],
  medium: [
    // Lumber Crews before Barracks: wood is the early bottleneck, and Housing I
    // (the house limit) needs it.
    step(TechId.LUMBER_CREWS, { lumber: 2 }),
    step(TechId.BARRACKS_PIKEMEN, { farms: 1, lumber: 1 }),
    step(TechId.HOUSING_I, { stone: 1, houses: 2 }),
    step(TechId.ARCHERS, { barracks: true, stone: 1 }),
    step(TechId.MINING_CREWS, { stone: 1, farms: 3 }),
    step(TechId.MILLS, { farms: 3 }),
    step(TechId.GOLD_MINES, { farms: 4, lumber: 2, stone: 1 }),
    step(TechId.KNIGHTS, { farms: 5, gold: 1 }),
    step(TechId.FARMS, { farms: 5 }),
    step(TechId.FOUNDRY, { farms: 8, lumber: 3, stone: 2, gold: 2 }),
    step(TechId.HOUFNICE, { farms: 8, gold: 2 }),
    step(TechId.PALISADES, { farms: 8, lumber: 4 }),
    step(TechId.WATCHTOWERS, { farms: 8, stone: 2 }),
    step(TechId.HOUSING_II, { houses: 6, capPressure: true }),
    step(TechId.FARMS_II, { farms: 8 }),
  ],
  hard: [
    step(TechId.LUMBER_CREWS, { lumber: 2 }),
    step(TechId.BARRACKS_PIKEMEN, { farms: 1, lumber: 1 }),
    step(TechId.HOUSING_I, { stone: 1, houses: 2 }),
    step(TechId.ARCHERS, { barracks: true, stone: 1 }),
    step(TechId.MINING_CREWS, { stone: 1 }),
    step(TechId.MILLS, { farms: 3 }),
    step(TechId.GOLD_MINES, { farms: 6, lumber: 3, stone: 1 }),
    step(TechId.FARMS, { farms: 5 }),
    step(TechId.KNIGHTS, { farms: 8, gold: 1 }),
    step(TechId.FOUNDRY, { farms: 10, lumber: 4, stone: 2, gold: 2 }),
    step(TechId.HOUFNICE, { farms: 10, gold: 2 }),
    step(TechId.PALISADES, { farms: 10, lumber: 5 }),
    step(TechId.WATCHTOWERS, { farms: 10, stone: 2 }),
    step(TechId.HOUSING_II, { houses: 6 }),
    step(TechId.FARMS_II, { farms: 8 }),
  ],
};

function aiResearchOrder(world: SimWorld): readonly AiResearchStep[] {
  return AI_RESEARCH_ORDER[aiDifficultyOf(world)];
}

function economyReady(world: SimWorld, playerId: number, snapshot: AiSnapshot, gate: AiEconomyGate): boolean {
  if ((gate.farms ?? 0) > countAiBuildings(snapshot, BuildingDefId.FARM)) return false;
  if ((gate.lumber ?? 0) > countAiBuildings(snapshot, BuildingDefId.LUMBER_CAMP)) return false;
  if ((gate.stone ?? 0) > countAiBuildings(snapshot, BuildingDefId.STONE_QUARRY)) return false;
  if ((gate.gold ?? 0) > countAiBuildings(snapshot, BuildingDefId.GOLD_MINE)) return false;
  if ((gate.houses ?? 0) > countAiBuildings(snapshot, BuildingDefId.HOUSE)) return false;
  if (gate.barracks && !aiHasAnyBuilding(snapshot, BuildingDefId.BARRACKS)) return false;
  if (gate.capPressure && aiDifficultyOf(world) !== 'hard' && !nearPopulationCap(world, playerId)) return false;
  return true;
}

function nearPopulationCap(world: SimWorld, playerId: number): boolean {
  const pop = world.population[playerId];
  if (!pop) return false;
  return pop.cap - (pop.current + countQueuedPopCost(world, playerId)) <= aiSettings(world).houseHeadroom + 2;
}

/**
 * The first research of the order still to do whose prerequisites are met
 * and whose economy is in place, or null. Steps that are not yet available
 * (closed ring, missing parent) are skipped, so a later step that is ready
 * never waits behind one that cannot start.
 */
function nextAiResearch(world: SimWorld, playerId: number, snapshot: AiSnapshot): TechIdValue | null {
  for (const { tech, gate } of aiResearchOrder(world)) {
    if (techStatus(world, playerId, tech) !== 'available') continue;
    if (!economyReady(world, playerId, snapshot, gate)) continue;
    return tech;
  }
  return null;
}

/** Buy the next research of the order when it is affordable (at most one per think). */
export function aiResearchTechs(world: SimWorld, playerId: number, snapshot: AiSnapshot): void {
  const techId = nextAiResearch(world, playerId, snapshot);
  if (techId === null) return;
  const tech = techDef(techId);
  const bank = world.resources[playerId];
  if (!tech || !bank || !canAfford(bank, tech.cost)) return;
  const ringBefore = openRing(world, playerId);
  if (!activeAiActuator().researchTech(world, playerId, techId)) return;
  const ringAfter = openRing(world, playerId);
  if (ringAfter > ringBefore) {
    const era = getAgeDef(ringEra(ringAfter))?.name ?? 'a new age';
    activeAiActuator().event(world, playerId, `Frankia has entered the ${era}`);
  }
}

/**
 * Gold and stone to save for the next research once its economy is ready.
 * Without this, scouts and gunmen spent gold as fast as it came in and the
 * AI never banked the 800 gold of the Foundry. Not while defending: an army
 * now beats a research later.
 */
export function aiResearchReserve(
  world: SimWorld,
  playerId: number,
  state: AiPlayerState,
  snapshot: AiSnapshot
): { gold: number; stone: number } | null {
  if (state.plan === 'defending') return null;
  const techId = nextAiResearch(world, playerId, snapshot);
  const tech = techId ? techDef(techId) : null;
  if (!tech || (tech.cost.gold === 0 && tech.cost.stone === 0)) return null;
  return { gold: tech.cost.gold, stone: tech.cost.stone };
}
