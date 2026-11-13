/**
 * Battle of Bila Hora: deployment, armies and the imperial opening advance.
 */

import { hasComponent } from 'bitecs';
import { MAP, SIM } from '../../config';
import {
  AttackMoveGoal,
  AttackTarget,
  Combat,
  Owner,
  Position,
  ResourceKindId,
  UnitStance,
  UnitStanceId,
} from '../components';
import { AgeId, UnitDefId } from '../defs';
import { CampaignMissionId } from '../campaign';
import { TileType } from '../map-gen';
import type { GridPos } from '../pathfinding';
import { createAllTechSet } from '../tech-tree';
import {
  AI_PLAYER_ID,
  FORMATION_MODE_LINE,
  LOCAL_PLAYER_ID,
  POP_CAP_HARD_LIMIT,
  TREE_RESOURCE_AMOUNT,
} from '../core/constants';
import { createAgeState } from '../core/create-world';
import { isLiveEntity, removeSimEntity } from '../core/entities';
import { findBuildingAt, findEntityNear, findResourceAt } from '../core/lookup';
import { pathTo } from '../core/navigation';
import { resourceQuery, unitQuery } from '../core/queries';
import type { SimWorld } from '../core/types';
import { spawnResource } from '../factories/buildings';
import { formationDestinations } from '../input/formation';
import { applyFormationSpeedCap, setUnitHoldAnchor } from '../input/unit-orders';
import { revealMapForPlayer } from '../systems/visibility';
import {
  clampBattlePoint,
  clearBattlefieldForTownlessMission,
  normalizeVector,
  offsetBattlePoint,
  spawnFormationRow,
} from './shared';

const BILA_HORA_ENEMY_OPENING_WAIT_TICKS = SIM.TICK_HZ * 15;

export function configureBattleOfBilaHora(world: SimWorld): void {
  clearBattlefieldForTownlessMission(world);

  world.ages[LOCAL_PLAYER_ID] = createAgeState(AgeId.GUNPOWDER);
  world.ages[AI_PLAYER_ID] = createAgeState(AgeId.GUNPOWDER);
  world.researchedTechs[LOCAL_PLAYER_ID] = createAllTechSet();
  world.researchedTechs[AI_PLAYER_ID] = createAllTechSet();
  world.resources[LOCAL_PLAYER_ID].set([0, 0, 0, 0]);
  world.resources[AI_PLAYER_ID].set([0, 0, 0, 0]);
  world.population[LOCAL_PLAYER_ID].cap = POP_CAP_HARD_LIMIT;
  world.population[AI_PLAYER_ID].cap = POP_CAP_HARD_LIMIT;

  const p1 = world.map.spawns[LOCAL_PLAYER_ID];
  const p2 = world.map.spawns[AI_PLAYER_ID];
  const road = normalizeVector(p2.x - p1.x, p2.y - p1.y);
  const across = { x: -road.y, y: road.x };
  const bohemian = {
    x: Math.round(p1.x + (p2.x - p1.x) * 0.39),
    y: Math.round(p1.y + (p2.y - p1.y) * 0.39),
  };
  const imperial = clampBattlePoint(offsetBattlePoint(p2, road, across, 5, 0));

  clearBilaHoraDeploymentZone(world, bohemian, road, across, 17, 8);
  clearBilaHoraDeploymentZone(world, imperial, road, across, 21, 10);
  seedBilaHoraPassTrees(world, bohemian, imperial, road, across);
  world.map.spawns[LOCAL_PLAYER_ID] = bohemian;
  world.map.spawns[AI_PLAYER_ID] = imperial;

  const defenders = spawnBilaHoraBohemianLine(world, bohemian, road, across);
  const trackedObjectiveEids = spawnBilaHoraImperialArmy(world, imperial, road, across);
  setBilaHoraDefensiveStance(world, defenders);

  world.campaign = {
    missionId: CampaignMissionId.BATTLE_OF_BILA_HORA,
    name: 'Battle of Bílá Hora',
    description: '',
    briefing: '',
    lockedTechs: [],
    objectives: [],
    trackedObjectiveEids,
    enemyAiMode: 'defensive',
    nextReinforcementTick: world.tick + BILA_HORA_ENEMY_OPENING_WAIT_TICKS,
  };
  world.aiPlayers[AI_PLAYER_ID] = null;
  revealMapForPlayer(world, LOCAL_PLAYER_ID);
}

function clearBilaHoraDeploymentZone(
  world: SimWorld,
  center: GridPos,
  forward: GridPos,
  across: GridPos,
  halfAcross: number,
  halfDepth: number
): void {
  for (let y = 0; y < MAP.HEIGHT; y++) {
    for (let x = 0; x < MAP.WIDTH; x++) {
      const relX = x - center.x;
      const relY = y - center.y;
      const lateral = relX * across.x + relY * across.y;
      const depth = relX * forward.x + relY * forward.y;
      if (Math.abs(lateral) > halfAcross || Math.abs(depth) > halfDepth) continue;
      const idx = y * MAP.WIDTH + x;
      if (world.map.tiles[idx] !== TileType.DIRT) {
        world.map.tiles[idx] = TileType.GRASS;
      }
      world.map.elevation[idx] = 3;
      world.map.walkability[y][x] = 0;
      world.grid[y][x] = 0;
    }
  }

  for (const eid of [...resourceQuery(world.ecs)]) {
    const relX = Position.x[eid] - center.x;
    const relY = Position.y[eid] - center.y;
    const lateral = relX * across.x + relY * across.y;
    const depth = relX * forward.x + relY * forward.y;
    if (Math.abs(lateral) <= halfAcross + 1 && Math.abs(depth) <= halfDepth + 1) {
      removeSimEntity(world, eid);
    }
  }
}

function seedBilaHoraPassTrees(
  world: SimWorld,
  bohemian: GridPos,
  imperial: GridPos,
  forward: GridPos,
  across: GridPos
): void {
  const mid = {
    x: (bohemian.x + imperial.x) / 2,
    y: (bohemian.y + imperial.y) / 2,
  };
  const clusters = [
    offsetBattlePoint(mid, forward, across, -2, -23),
    offsetBattlePoint(mid, forward, across, 2, 23),
    offsetBattlePoint(bohemian, forward, across, -7, -15),
    offsetBattlePoint(bohemian, forward, across, -6, 15),
    offsetBattlePoint(imperial, forward, across, 7, -16),
    offsetBattlePoint(imperial, forward, across, 7, 16),
  ];
  for (const cluster of clusters) {
    spawnBilaHoraTreeCluster(world, cluster.x, cluster.y);
  }
}

export function spawnBilaHoraTreeCluster(world: SimWorld, cx: number, cy: number): void {
  const offsets = [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [2, 1],
    [-2, -1],
  ];
  for (const [dx, dy] of offsets) {
    trySpawnBilaHoraTree(world, cx + dx, cy + dy);
  }
}

export function trySpawnBilaHoraTree(world: SimWorld, x: number, y: number): void {
  if (x < 1 || y < 1 || x >= MAP.WIDTH - 1 || y >= MAP.HEIGHT - 1) return;
  if (world.map.walkability[y][x] !== 0) return;
  const idx = y * MAP.WIDTH + x;
  const tile = world.map.tiles[idx];
  if (tile !== TileType.GRASS && tile !== TileType.FOREST) return;
  if (findResourceAt(world, x, y, 0.7) !== null) return;
  if (findEntityNear(world, x, y, 1.3) !== null) return;
  if (findBuildingAt(world, x, y, 2) !== null) return;
  world.map.tiles[idx] = TileType.FOREST;
  spawnResource(world, ResourceKindId.WOOD, x, y, TREE_RESOURCE_AMOUNT);
}

function spawnBilaHoraBohemianLine(
  world: SimWorld,
  anchor: GridPos,
  forward: GridPos,
  across: GridPos
): number[] {
  // Bohemian Estates: defensive infantry and firearms hold the White Mountain
  // rise, with guns behind the line and a smaller cavalry reserve on the wings.
  return [
    ...spawnFormationRow(world, UnitDefId.SPEARMAN, anchor, forward, across, 2.6, 0, LOCAL_PLAYER_ID, 16, 1.15),
    ...spawnFormationRow(world, UnitDefId.GUNMAN, anchor, forward, across, 0.2, 0, LOCAL_PLAYER_ID, 24, 1.05),
    ...spawnFormationRow(world, UnitDefId.CANNON, anchor, forward, across, -4.5, 0, LOCAL_PLAYER_ID, 2, 3.0),
    ...spawnFormationRow(world, UnitDefId.SCOUT_CAVALRY, anchor, forward, across, -5.8, -9.5, LOCAL_PLAYER_ID, 4, 1.18),
    ...spawnFormationRow(world, UnitDefId.SCOUT_CAVALRY, anchor, forward, across, -5.8, 9.5, LOCAL_PLAYER_ID, 4, 1.18),
  ];
}

function spawnBilaHoraImperialArmy(
  world: SimWorld,
  anchor: GridPos,
  forward: GridPos,
  across: GridPos
): Record<string, number[]> {
  const before = new Set(unitQuery(world.ecs));
  // Imperial and Catholic League troops: the pressure is cavalry-heavy, while
  // gunmen and field pieces give the attack its Gunpowder Age character.
  spawnFormationRow(world, UnitDefId.SCOUT_CAVALRY, anchor, forward, across, -4.0, -5.5, AI_PLAYER_ID, 12, 1.02);
  spawnFormationRow(world, UnitDefId.SCOUT_CAVALRY, anchor, forward, across, -4.0, 5.5, AI_PLAYER_ID, 12, 1.02);
  spawnFormationRow(world, UnitDefId.GUNMAN, anchor, forward, across, -1.4, -3.2, AI_PLAYER_ID, 13, 0.95);
  spawnFormationRow(world, UnitDefId.GUNMAN, anchor, forward, across, 0.5, 3.2, AI_PLAYER_ID, 13, 0.95);
  spawnFormationRow(world, UnitDefId.SPEARMAN, anchor, forward, across, 2.6, 0, AI_PLAYER_ID, 8, 1.05);
  spawnFormationRow(world, UnitDefId.CANNON, anchor, forward, across, 5.6, 0, AI_PLAYER_ID, 2, 2.6);

  return {
    destroy_imperial_field_army: unitQuery(world.ecs)
      .filter((eid) => !before.has(eid) && Owner.player[eid] === AI_PLAYER_ID),
  };
}

export function setBilaHoraDefensiveStance(world: SimWorld, eids: number[]): void {
  for (const eid of eids) {
    if (!hasComponent(world.ecs, UnitStance, eid)) continue;
    UnitStance.stance[eid] = UnitStanceId.HOLD_POSITION;
    setUnitHoldAnchor(world, eid);
  }
}

export function issueBilaHoraEnemyAdvance(world: SimWorld, eids: number[], target: GridPos): void {
  const ordered: number[] = [];
  for (const { eid, dest } of formationDestinations(world, eids, target, FORMATION_MODE_LINE)) {
    if (!hasComponent(world.ecs, Combat, eid)) continue;
    if (!hasComponent(world.ecs, AttackTarget, eid)) continue;
    if (!pathTo(world, eid, dest.x, dest.y)) continue;
    AttackTarget.targetEid[eid] = -1;
    AttackTarget.retainGoal[eid] = 0;
    if (hasComponent(world.ecs, AttackMoveGoal, eid)) {
      AttackMoveGoal.active[eid] = 1;
      AttackMoveGoal.x[eid] = dest.x;
      AttackMoveGoal.y[eid] = dest.y;
    }
    setUnitHoldAnchor(world, eid, dest.x, dest.y);
    ordered.push(eid);
  }
  applyFormationSpeedCap(world, ordered);
}

export function bilaHoraOpeningAdvanceSystem(world: SimWorld): void {
  const campaign = world.campaign;
  if (!campaign) return;
  if (world.tick < campaign.nextReinforcementTick) return;
  const enemyUnits = campaign.trackedObjectiveEids.destroy_imperial_field_army ?? [];
  const liveEnemyUnits = enemyUnits.filter((eid) => isLiveEntity(world, eid));
  if (liveEnemyUnits.length > 0) {
    const playerAnchor = world.map.spawns[LOCAL_PLAYER_ID];
    const enemyAnchor = world.map.spawns[AI_PLAYER_ID];
    const road = normalizeVector(enemyAnchor.x - playerAnchor.x, enemyAnchor.y - playerAnchor.y);
    const across = { x: -road.y, y: road.x };
    issueBilaHoraEnemyAdvance(
      world,
      liveEnemyUnits,
      offsetBattlePoint(playerAnchor, road, across, -8, 0)
    );
  }
  campaign.nextReinforcementTick = Number.MAX_SAFE_INTEGER;
}
