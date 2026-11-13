/**
 * Campaign world creation, objective tracking and the per-tick campaign system.
 */

import { hasComponent } from 'bitecs';
import { SIM } from '../../config';
import { Health, Owner, VillagerTag } from '../components';
import { CampaignMissionId, type CampaignMissionIdValue, getCampaignMissionDef } from '../campaign';
import { LOCAL_PLAYER_ID } from '../core/constants';
import { createSimWorld } from '../core/create-world';
import { isLiveEntity } from '../core/entities';
import { pushAiEvent } from '../core/events';
import { unitQuery } from '../core/queries';
import type { CampaignState, SimWorld } from '../core/types';
import { updatePlayerVisibility } from '../systems/visibility';
import { bilaHoraOpeningAdvanceSystem, configureBattleOfBilaHora } from './bila-hora';
import { brnoReinforcementSystem, configureSiegeOfBrno } from './brno';
import { configureBattleOfKutnaHora, kutnaHoraWaveSystem } from './kutna-hora';
import { configureBattleOfSudomer, sudomerWaveSystem } from './sudomer';
import { configureBattleOfZborov } from './zborov';
import { zborovAssaultSystem } from './zborov-assault';

export function createCampaignWorld(
  seed: number,
  missionId: CampaignMissionIdValue = CampaignMissionId.SIEGE_OF_BRNO
): SimWorld {
  const mission = getCampaignMissionDef(missionId) ?? getCampaignMissionDef(CampaignMissionId.SIEGE_OF_BRNO);
  if (!mission) return createSimWorld(seed);

  const world = createSimWorld(seed, {
    startingAge: mission.startingAge,
    mapId: mission.mapId,
  });

  if (mission.id === CampaignMissionId.SIEGE_OF_BRNO) {
    configureSiegeOfBrno(world, mission.objectives);
  } else if (mission.id === CampaignMissionId.BATTLE_OF_BILA_HORA) {
    configureBattleOfBilaHora(world);
  } else if (mission.id === CampaignMissionId.BATTLE_OF_KUTNA_HORA) {
    configureBattleOfKutnaHora(world);
  } else if (mission.id === CampaignMissionId.BATTLE_OF_SUDOMER) {
    configureBattleOfSudomer(world);
  } else if (mission.id === CampaignMissionId.BATTLE_OF_ZBOROV) {
    configureBattleOfZborov(world);
  }

  const configuredCampaign = world.campaign;
  world.campaign = {
    missionId: mission.id,
    name: mission.name,
    description: mission.description,
    briefing: mission.briefing,
    lockedTechs: mission.lockedTechs.slice(),
    objectives: mission.objectives.map((objective) => ({
      id: objective.id,
      label: objective.label,
      optional: objective.optional === true,
      completed: false,
    })),
    trackedObjectiveEids: configuredCampaign?.trackedObjectiveEids ?? {},
    enemyAiMode: 'defensive',
    nextReinforcementTick:
      configuredCampaign?.nextReinforcementTick ?? world.tick + SIM.TICK_HZ * 70,
    scriptedWaveIndex: configuredCampaign?.scriptedWaveIndex,
    scriptedWaveCount: configuredCampaign?.scriptedWaveCount,
    zborovLinesTaken: configuredCampaign?.zborovLinesTaken,
    zborovForwardY: configuredCampaign?.zborovForwardY,
  };

  updateCampaignObjectives(world);
  updatePlayerVisibility(world, LOCAL_PLAYER_ID);
  return world;
}

export function mergeTrackedEids(existing: number[], incoming: number[]): number[] {
  const seen = new Set(existing);
  const merged = existing.slice();
  for (const eid of incoming) {
    if (seen.has(eid)) continue;
    seen.add(eid);
    merged.push(eid);
  }
  return merged;
}

export function campaignSystem(world: SimWorld): void {
  if (!world.campaign) return;
  updateCampaignObjectives(world);
  if (world.campaign.missionId === CampaignMissionId.SIEGE_OF_BRNO) {
    brnoReinforcementSystem(world);
  } else if (world.campaign.missionId === CampaignMissionId.BATTLE_OF_BILA_HORA) {
    bilaHoraOpeningAdvanceSystem(world);
  } else if (world.campaign.missionId === CampaignMissionId.BATTLE_OF_KUTNA_HORA) {
    kutnaHoraWaveSystem(world);
  } else if (world.campaign.missionId === CampaignMissionId.BATTLE_OF_SUDOMER) {
    sudomerWaveSystem(world);
  } else if (world.campaign.missionId === CampaignMissionId.BATTLE_OF_ZBOROV) {
    zborovAssaultSystem(world);
  }
}

function updateCampaignObjectives(world: SimWorld): void {
  const campaign = world.campaign;
  if (!campaign) return;
  for (const objective of campaign.objectives) {
    if (objective.completed) continue;
    const tracked = campaign.trackedObjectiveEids[objective.id];
    if (!tracked || tracked.length === 0) continue;
    if (tracked.every((eid) => !isLiveEntity(world, eid))) {
      objective.completed = true;
      pushAiEvent(world, 0, `${objective.label} complete`);
    }
  }
}

export function countIncompleteCampaignObjectives(campaign: CampaignState, ids: string[]): number {
  let count = 0;
  for (const id of ids) {
    if (!campaign.objectives.find((objective) => objective.id === id)?.completed) count++;
  }
  return count;
}

export function countLiveMilitary(world: SimWorld, playerId: number): number {
  let count = 0;
  for (const eid of unitQuery(world.ecs)) {
    if (Owner.player[eid] !== playerId) continue;
    if (Health.hp[eid] <= 0) continue;
    if (hasComponent(world.ecs, VillagerTag, eid)) continue;
    count++;
  }
  return count;
}

export function countLiveTrackedEids(world: SimWorld, eids: number[]): number {
  let count = 0;
  for (const eid of eids) {
    if (isLiveEntity(world, eid)) count++;
  }
  return count;
}

export function completeCampaignObjective(campaign: CampaignState, id: string): void {
  const objective = campaign.objectives.find((entry) => entry.id === id);
  if (objective) objective.completed = true;
}
