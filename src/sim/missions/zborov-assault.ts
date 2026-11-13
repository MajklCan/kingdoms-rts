/**
 * Battle of Zborov runtime: enemy production, wave release and line capture.
 */

import { hasComponent } from 'bitecs';
import { MAP, SIM } from '../../config';
import {
  AttackMoveGoal,
  Building,
  CannonTag,
  ConstructionSite,
  GunmanTag,
  Health,
  Owner,
  Position,
  VillagerTag,
} from '../components';
import { BuildingDefId, UnitDefId } from '../defs';
import type { GridPos } from '../pathfinding';
import { aiQueueUnit } from '../ai/placement';
import {
  AI_PLAYER_ID,
  LOCAL_PLAYER_ID,
  ZBOROV_FORWARD_LINE_FRAC,
  ZBOROV_MID_LINE_FRAC,
  ZBOROV_REAR_LINE_FRAC,
} from '../core/constants';
import { isLiveEntity } from '../core/entities';
import { pushAiEvent } from '../core/events';
import { buildingQuery, unitQuery } from '../core/queries';
import type { CampaignState, SimWorld } from '../core/types';
import { issueBilaHoraEnemyAdvance } from './bila-hora';
import {
  completeCampaignObjective,
  countLiveTrackedEids,
  mergeTrackedEids,
} from './campaign-world';

const ZBOROV_ENEMY_WAVE_INTERVAL_TICKS = SIM.TICK_HZ * 55;
const ZBOROV_ENEMY_WAVE_MIN_SIZE = 3;
const ZBOROV_ENEMY_WAVE_MAX_SIZE = 8;
const ZBOROV_ENEMY_WAVE_WAIT_CAP_TICKS = SIM.TICK_HZ * 35;

export function zborovAssaultSystem(world: SimWorld): void {
  const campaign = world.campaign;
  if (!campaign) return;
  if (campaign.zborovForwardY === undefined) {
    campaign.zborovForwardY = world.map.spawns[LOCAL_PLAYER_ID].y;
  }

  // Bite-and-hold objective progress. The enemy garrison stays in its trench
  // anchors; pressure now comes from units actually trained at the rear foundry.
  const lineKeys = ['take_trench_1', 'take_trench_2', 'take_trench_3'];
  const lineFracs = [
    ZBOROV_FORWARD_LINE_FRAC,
    ZBOROV_MID_LINE_FRAC,
    ZBOROV_REAR_LINE_FRAC,
  ];
  let taken = campaign.zborovLinesTaken ?? 0;
  while (taken < lineKeys.length) {
    const lineEids = campaign.trackedObjectiveEids[lineKeys[taken]] ?? [];
    if (lineEids.length === 0 || countLiveTrackedEids(world, lineEids) > 0) break;
    completeCampaignObjective(campaign, lineKeys[taken]);
    campaign.zborovForwardY = Math.round(MAP.HEIGHT * lineFracs[taken]) + 4;
    pushAiEvent(world, AI_PLAYER_ID, `Trench line ${taken + 1} has fallen.`);
    taken += 1;
    campaign.zborovLinesTaken = taken;
  }

  zborovQueueEnemyProduction(world, campaign);
  zborovMaybeReleaseEnemyWave(world, campaign);
}

function zborovQueueEnemyProduction(world: SimWorld, campaign: CampaignState): void {
  const foundries = zborovLiveBuildings(world, AI_PLAYER_ID, BuildingDefId.FOUNDRY);
  for (const foundry of foundries) {
    const queue = world.productionQueues.get(foundry) ?? [];
    if (queue.length >= 2) continue;
    const waveIndex = campaign.scriptedWaveIndex ?? 0;
    const preferCannon = (waveIndex + queue.length) % 4 === 3;
    if (preferCannon && aiQueueUnit(world, foundry, UnitDefId.CANNON)) continue;
    aiQueueUnit(world, foundry, UnitDefId.GUNMAN);
  }
}

function zborovMaybeReleaseEnemyWave(world: SimWorld, campaign: CampaignState): void {
  if (world.tick < campaign.nextReinforcementTick) return;

  const candidates = zborovEnemyWaveCandidates(world, campaign);
  const waitedLongEnough =
    world.tick - campaign.nextReinforcementTick >= ZBOROV_ENEMY_WAVE_WAIT_CAP_TICKS;
  if (
    candidates.length < ZBOROV_ENEMY_WAVE_MIN_SIZE &&
    !(waitedLongEnough && candidates.length > 0)
  ) {
    return;
  }

  const wave = candidates
    .sort((a, b) => Position.y[b] - Position.y[a] || a - b)
    .slice(0, ZBOROV_ENEMY_WAVE_MAX_SIZE);
  const target = zborovCampaignTarget(
    world,
    campaign.trackedObjectiveEids.hold_legion_command ?? [],
    world.map.spawns[LOCAL_PLAYER_ID]
  );
  issueBilaHoraEnemyAdvance(world, wave, target);
  campaign.trackedObjectiveEids.zborov_enemy_reinforcements = mergeTrackedEids(
    campaign.trackedObjectiveEids.zborov_enemy_reinforcements ?? [],
    wave
  );
  campaign.scriptedWaveIndex = (campaign.scriptedWaveIndex ?? 0) + 1;
  campaign.nextReinforcementTick = world.tick + ZBOROV_ENEMY_WAVE_INTERVAL_TICKS;
  pushAiEvent(world, AI_PLAYER_ID, `Austro-Hungarian trained wave ${campaign.scriptedWaveIndex} is moving through no-man's-land.`);
}

function zborovEnemyWaveCandidates(world: SimWorld, campaign: CampaignState): number[] {
  const garrison = new Set(campaign.trackedObjectiveEids.zborov_garrison ?? []);
  const candidates: number[] = [];
  for (const eid of unitQuery(world.ecs)) {
    if (Owner.player[eid] !== AI_PLAYER_ID) continue;
    if (Health.hp[eid] <= 0) continue;
    if (garrison.has(eid)) continue;
    if (hasComponent(world.ecs, VillagerTag, eid)) continue;
    if (!hasComponent(world.ecs, GunmanTag, eid) && !hasComponent(world.ecs, CannonTag, eid)) continue;
    if (hasComponent(world.ecs, AttackMoveGoal, eid) && AttackMoveGoal.active[eid] === 1) continue;
    candidates.push(eid);
  }
  return candidates;
}

function zborovLiveBuildings(
  world: SimWorld,
  playerId: number,
  defId: number
): number[] {
  return buildingQuery(world.ecs).filter((eid) =>
    Owner.player[eid] === playerId &&
    Building.defId[eid] === defId &&
    Health.hp[eid] > 0 &&
    !hasComponent(world.ecs, ConstructionSite, eid)
  );
}

function zborovCampaignTarget(
  world: SimWorld,
  eids: number[],
  fallback: GridPos
): GridPos {
  for (const eid of eids) {
    if (!isLiveEntity(world, eid)) continue;
    return { x: Math.round(Position.x[eid]), y: Math.round(Position.y[eid]) };
  }
  return fallback;
}
