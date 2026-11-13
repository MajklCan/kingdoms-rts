/**
 * Battle of Kutna Hora: fortified city defense against scripted waves.
 */

import { MAP, SIM } from '../../config';
import { Position, type ResourceKind, ResourceKindId } from '../components';
import { AgeId, BuildingDefId, UnitDefId } from '../defs';
import { CampaignMissionId } from '../campaign';
import { TileType } from '../map-gen';
import type { GridPos } from '../pathfinding';
import { createAllTechSet } from '../tech-tree';
import {
  AI_PLAYER_ID,
  LOCAL_GOLD_DEPOSIT_AMOUNT,
  LOCAL_PLAYER_ID,
  LOCAL_STONE_DEPOSIT_AMOUNT,
  POP_CAP_HARD_LIMIT,
} from '../core/constants';
import { createAgeState } from '../core/create-world';
import { removeSimEntity } from '../core/entities';
import { pushAiEvent } from '../core/events';
import {
  findBuildingAt,
  findEntityNear,
  findOwnedTownCenter,
  findResourceAt,
} from '../core/lookup';
import { resourceQuery } from '../core/queries';
import type { SimWorld } from '../core/types';
import { spawnResource, spawnTownCenter } from '../factories/buildings';
import {
  placePresetBuilding,
  placePresetBuildingExact,
  removePresetStarterMilitary,
  spawnPresetUnitAt,
} from '../factories/late-game';
import { setUnitHoldAnchor } from '../input/unit-orders';
import { updatePlayerVisibility } from '../systems/visibility';
import {
  issueBilaHoraEnemyAdvance,
  setBilaHoraDefensiveStance,
  spawnBilaHoraTreeCluster,
  trySpawnBilaHoraTree,
} from './bila-hora';
import { completeCampaignObjective, countLiveTrackedEids } from './campaign-world';
import {
  clearPlayerBuildingsForCampaign,
  normalizeVector,
  offsetBattlePoint,
  spawnFormationRow,
} from './shared';

const KUTNA_HORA_FIRST_WAVE_TICKS = SIM.TICK_HZ * 30;
const KUTNA_HORA_WAVE_INTERVAL_TICKS = SIM.TICK_HZ * 65;
const KUTNA_HORA_TOTAL_WAVES = 5;

export function configureBattleOfKutnaHora(world: SimWorld): void {
  removePresetStarterMilitary(world);
  clearPlayerBuildingsForCampaign(world, LOCAL_PLAYER_ID);
  clearPlayerBuildingsForCampaign(world, AI_PLAYER_ID);

  world.population[LOCAL_PLAYER_ID] = { current: 0, cap: 0 };
  world.population[AI_PLAYER_ID] = { current: 0, cap: 0 };
  world.ages[LOCAL_PLAYER_ID] = createAgeState(AgeId.GUNPOWDER);
  world.ages[AI_PLAYER_ID] = createAgeState(AgeId.GUNPOWDER);
  world.researchedTechs[LOCAL_PLAYER_ID] = createAllTechSet();
  world.researchedTechs[AI_PLAYER_ID] = createAllTechSet();
  world.resources[LOCAL_PLAYER_ID].set([300, 300, 300, 300]);
  world.resources[AI_PLAYER_ID].set([0, 0, 0, 0]);

  const town = {
    x: Math.round(MAP.WIDTH * 0.50),
    y: Math.round(MAP.HEIGHT * 0.50),
  };
  const enemyEdge = kutnaHoraWaveSpawnAnchor(0);
  world.map.spawns[LOCAL_PLAYER_ID] = town;
  world.map.spawns[AI_PLAYER_ID] = enemyEdge;

  clearKutnaHoraGround(world, town, 15, 13);
  for (let i = 0; i < KUTNA_HORA_TOTAL_WAVES; i++) {
    clearKutnaHoraGround(world, kutnaHoraWaveSpawnAnchor(i), 6, 5);
  }

  const townCenter = spawnTownCenter(world, town.x, town.y, LOCAL_PLAYER_ID);
  buildKutnaHoraPlayerCity(world, town);
  seedKutnaHoraPerimeterWoods(world, town);
  const defenders = spawnKutnaHoraDefenders(world, town);
  setBilaHoraDefensiveStance(world, defenders);

  world.population[LOCAL_PLAYER_ID].cap = POP_CAP_HARD_LIMIT;
  world.population[AI_PLAYER_ID].cap = POP_CAP_HARD_LIMIT;
  world.armyRallyPoints[LOCAL_PLAYER_ID] = { x: town.x, y: town.y - 5 };
  world.armyRallyPoints[AI_PLAYER_ID] = null;
  world.aiPlayers[AI_PLAYER_ID] = null;
  world.campaign = {
    missionId: CampaignMissionId.BATTLE_OF_KUTNA_HORA,
    name: 'Battle of Kutná Hora',
    description: '',
    briefing: '',
    lockedTechs: [],
    objectives: [],
    trackedObjectiveEids: {
      kutna_hora_attackers: [],
      kutna_hora_town_center: [townCenter],
    },
    enemyAiMode: 'defensive',
    nextReinforcementTick: world.tick + KUTNA_HORA_FIRST_WAVE_TICKS,
    scriptedWaveIndex: 0,
    scriptedWaveCount: KUTNA_HORA_TOTAL_WAVES,
  };
  updatePlayerVisibility(world, LOCAL_PLAYER_ID);
}

function clearKutnaHoraGround(
  world: SimWorld,
  center: GridPos,
  radiusX: number,
  radiusY: number
): void {
  const minX = Math.max(1, Math.round(center.x - radiusX));
  const maxX = Math.min(MAP.WIDTH - 2, Math.round(center.x + radiusX));
  const minY = Math.max(1, Math.round(center.y - radiusY));
  const maxY = Math.min(MAP.HEIGHT - 2, Math.round(center.y + radiusY));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const idx = y * MAP.WIDTH + x;
      if (world.map.tiles[idx] !== TileType.DIRT) world.map.tiles[idx] = TileType.GRASS;
      world.map.elevation[idx] = 3;
      world.map.walkability[y][x] = 0;
      world.grid[y][x] = 0;
    }
  }

  for (const eid of [...resourceQuery(world.ecs)]) {
    if (
      Position.x[eid] >= minX - 1 &&
      Position.x[eid] <= maxX + 1 &&
      Position.y[eid] >= minY - 1 &&
      Position.y[eid] <= maxY + 1
    ) {
      removeSimEntity(world, eid);
    }
  }
}

function buildKutnaHoraPlayerCity(
  world: SimWorld,
  town: GridPos
): void {
  const place = (defId: number, x: number, y: number) =>
    placePresetBuilding(world, defId, town.x + x, town.y + y, LOCAL_PLAYER_ID);

  buildKutnaHoraWallRing(world, town, 13, 11, 1);
  buildKutnaHoraWallRing(world, town, 10, 8, 1);
  buildKutnaHoraTowerBelt(world, town);

  const houseOffsets: GridPos[] = [
    { x: -8, y: -6 }, { x: -6, y: -7 }, { x: -4, y: -7 }, { x: 4, y: -7 }, { x: 6, y: -7 }, { x: 8, y: -6 },
    { x: -8, y: 6 }, { x: -6, y: 7 }, { x: -4, y: 7 }, { x: 4, y: 7 }, { x: 6, y: 7 }, { x: 8, y: 6 },
  ];
  for (const offset of houseOffsets) {
    place(BuildingDefId.HOUSE, offset.x, offset.y);
  }

  place(BuildingDefId.BARRACKS, -5, -4);
  place(BuildingDefId.BARRACKS, 5, -4);
  place(BuildingDefId.BARRACKS, 0, -6);
  place(BuildingDefId.STABLE, -5, 4);
  place(BuildingDefId.STABLE, 5, 6);
  place(BuildingDefId.FOUNDRY, 5, 4);
  place(BuildingDefId.FOUNDRY, 0, 5);
  place(BuildingDefId.FARM, -8, 10);
  place(BuildingDefId.FARM, -4, 10);
  place(BuildingDefId.FARM, 4, 10);
  place(BuildingDefId.FARM, 8, 10);
  place(BuildingDefId.MILL, 0, 10);

  const lumberCamp = placeKutnaHoraWorksite(world, BuildingDefId.LUMBER_CAMP, town.x - 11, town.y - 9, ResourceKindId.WOOD);
  const goldMine = placeKutnaHoraWorksite(world, BuildingDefId.GOLD_MINE, town.x - 11, town.y + 2, ResourceKindId.GOLD);
  const stoneQuarry = placeKutnaHoraWorksite(world, BuildingDefId.STONE_QUARRY, town.x + 11, town.y + 2, ResourceKindId.STONE);
  if (lumberCamp !== null) seedKutnaHoraHarvestPatch(world, lumberCamp, ResourceKindId.WOOD);
  if (goldMine !== null) seedKutnaHoraHarvestPatch(world, goldMine, ResourceKindId.GOLD);
  if (stoneQuarry !== null) seedKutnaHoraHarvestPatch(world, stoneQuarry, ResourceKindId.STONE);
}

function buildKutnaHoraWallRing(
  world: SimWorld,
  center: GridPos,
  halfW: number,
  halfH: number,
  gateHalfWidth: number
): void {
  const left = center.x - halfW;
  const right = center.x + halfW;
  const top = center.y - halfH;
  const bottom = center.y + halfH;

  for (let x = left; x <= right; x++) {
    if (Math.abs(x - center.x) > gateHalfWidth) {
      placePresetBuildingExact(world, BuildingDefId.WALL, x, top, LOCAL_PLAYER_ID);
      placePresetBuildingExact(world, BuildingDefId.WALL, x, bottom, LOCAL_PLAYER_ID);
    }
  }
  for (let y = top + 1; y < bottom; y++) {
    if (Math.abs(y - center.y) > gateHalfWidth) {
      placePresetBuildingExact(world, BuildingDefId.WALL, left, y, LOCAL_PLAYER_ID);
      placePresetBuildingExact(world, BuildingDefId.WALL, right, y, LOCAL_PLAYER_ID);
    }
  }
}

function buildKutnaHoraTowerBelt(world: SimWorld, center: GridPos): void {
  const offsets: GridPos[] = [
    { x: -12, y: -9 }, { x: -7, y: -10 }, { x: 7, y: -10 }, { x: 12, y: -9 },
    { x: -12, y: -4 }, { x: -12, y: 4 }, { x: 12, y: -4 }, { x: 12, y: 4 },
    { x: -12, y: 9 }, { x: -7, y: 10 }, { x: 7, y: 10 }, { x: 12, y: 9 },
  ];
  for (const offset of offsets) {
    placePresetBuildingExact(
      world,
      BuildingDefId.DEFENSIVE_TOWER,
      center.x + offset.x,
      center.y + offset.y,
      LOCAL_PLAYER_ID
    );
  }
}

function seedKutnaHoraPerimeterWoods(world: SimWorld, center: GridPos): void {
  const clusters: GridPos[] = [
    { x: -18, y: -13 }, { x: -13, y: -16 }, { x: 13, y: -16 }, { x: 18, y: -13 },
    { x: -19, y: -7 }, { x: 19, y: -7 }, { x: -19, y: 7 }, { x: 19, y: 7 },
    { x: -18, y: 13 }, { x: -13, y: 16 }, { x: 13, y: 16 }, { x: 18, y: 13 },
  ];
  for (const offset of clusters) {
    spawnBilaHoraTreeCluster(world, center.x + offset.x, center.y + offset.y);
  }
}

export function placeKutnaHoraWorksite(
  world: SimWorld,
  defId: number,
  x: number,
  y: number,
  kind: ResourceKind
): number | null {
  seedKutnaHoraHarvestPatchAt(world, Math.round(x), Math.round(y), kind);
  return placePresetBuilding(world, defId, x, y, LOCAL_PLAYER_ID);
}

function seedKutnaHoraHarvestPatch(world: SimWorld, siteEid: number, kind: ResourceKind): void {
  seedKutnaHoraHarvestPatchAt(
    world,
    Math.round(Position.x[siteEid]),
    Math.round(Position.y[siteEid]),
    kind
  );
}

function seedKutnaHoraHarvestPatchAt(
  world: SimWorld,
  baseX: number,
  baseY: number,
  kind: ResourceKind
): void {
  const offsets = [
    [3, 0], [4, 1], [4, -1], [5, 0], [3, 2], [3, -2],
    [-3, 0], [-4, 1], [-4, -1], [-5, 0],
  ];
  for (const [dx, dy] of offsets) {
    const x = baseX + dx;
    const y = baseY + dy;
    if (kind === ResourceKindId.WOOD) {
      trySpawnBilaHoraTree(world, x, y);
    } else {
      trySpawnKutnaHoraResource(world, kind, x, y);
    }
  }
}

function trySpawnKutnaHoraResource(
  world: SimWorld,
  kind: ResourceKind,
  x: number,
  y: number
): void {
  if (x < 1 || y < 1 || x >= MAP.WIDTH - 1 || y >= MAP.HEIGHT - 1) return;
  if (world.map.walkability[y][x] !== 0) return;
  if (findResourceAt(world, x, y, 0.7) !== null) return;
  if (findBuildingAt(world, x, y, 2.2) !== null) return;
  if (findEntityNear(world, x, y, 0.75) !== null) return;
  const amount = kind === ResourceKindId.GOLD ? LOCAL_GOLD_DEPOSIT_AMOUNT : LOCAL_STONE_DEPOSIT_AMOUNT;
  spawnResource(world, kind, x, y, amount);
}

function spawnKutnaHoraDefenders(
  world: SimWorld,
  town: GridPos
): number[] {
  return [
    ...spawnKutnaHoraLooseRow(world, UnitDefId.SPEARMAN, { x: town.x, y: town.y - 5 }, { x: 1, y: 0 }, LOCAL_PLAYER_ID, 2, 1.1),
    ...spawnKutnaHoraLooseRow(world, UnitDefId.SPEARMAN, { x: town.x + 5, y: town.y }, { x: 0, y: 1 }, LOCAL_PLAYER_ID, 2, 1.1),
    ...spawnKutnaHoraLooseRow(world, UnitDefId.SPEARMAN, { x: town.x, y: town.y + 5 }, { x: 1, y: 0 }, LOCAL_PLAYER_ID, 2, 1.1),
    ...spawnKutnaHoraLooseRow(world, UnitDefId.SPEARMAN, { x: town.x - 5, y: town.y }, { x: 0, y: 1 }, LOCAL_PLAYER_ID, 2, 1.1),
    ...spawnKutnaHoraLooseRow(world, UnitDefId.GUNMAN, { x: town.x, y: town.y - 3 }, { x: 1, y: 0 }, LOCAL_PLAYER_ID, 2, 1.08),
    ...spawnKutnaHoraLooseRow(world, UnitDefId.GUNMAN, { x: town.x + 3, y: town.y }, { x: 0, y: 1 }, LOCAL_PLAYER_ID, 2, 1.08),
    ...spawnKutnaHoraLooseRow(world, UnitDefId.GUNMAN, { x: town.x, y: town.y + 3 }, { x: 1, y: 0 }, LOCAL_PLAYER_ID, 2, 1.08),
    ...spawnKutnaHoraLooseRow(world, UnitDefId.GUNMAN, { x: town.x - 3, y: town.y }, { x: 0, y: 1 }, LOCAL_PLAYER_ID, 2, 1.08),
    ...spawnKutnaHoraLooseRow(world, UnitDefId.ARCHER, { x: town.x, y: town.y + 6 }, { x: 1, y: 0 }, LOCAL_PLAYER_ID, 2, 1.12),
    ...spawnKutnaHoraLooseRow(world, UnitDefId.CANNON, { x: town.x, y: town.y - 2 }, { x: 1, y: 0 }, LOCAL_PLAYER_ID, 1, 3.0),
    ...spawnKutnaHoraLooseRow(world, UnitDefId.SCOUT_CAVALRY, { x: town.x - 8, y: town.y + 3 }, { x: 0, y: 1 }, LOCAL_PLAYER_ID, 2, 1.18),
    ...spawnKutnaHoraLooseRow(world, UnitDefId.SCOUT_CAVALRY, { x: town.x + 8, y: town.y + 3 }, { x: 0, y: 1 }, LOCAL_PLAYER_ID, 2, 1.18),
  ];
}

function spawnKutnaHoraLooseRow(
  world: SimWorld,
  defId: number,
  anchor: GridPos,
  across: GridPos,
  playerId: number,
  count: number,
  spacing: number
): number[] {
  const spawned: number[] = [];
  const start = -((count - 1) * spacing) / 2;
  for (let i = 0; i < count; i++) {
    const x = Math.round(anchor.x + across.x * (start + i * spacing));
    const y = Math.round(anchor.y + across.y * (start + i * spacing));
    const spot = findKutnaHoraLooseUnitSpot(world, x, y);
    if (!spot) continue;
    const eid = spawnPresetUnitAt(world, defId, spot.x, spot.y, playerId);
    if (eid === null) continue;
    setUnitHoldAnchor(world, eid, spot.x, spot.y);
    spawned.push(eid);
  }
  return spawned;
}

function findKutnaHoraLooseUnitSpot(
  world: SimWorld,
  preferredX: number,
  preferredY: number
): GridPos | null {
  for (let r = 0; r <= 2; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = preferredX + dx;
        const y = preferredY + dy;
        if (x < 0 || y < 0 || x >= MAP.WIDTH || y >= MAP.HEIGHT) continue;
        if (world.map.walkability[y][x] !== 0) continue;
        if (findBuildingAt(world, x, y, 0.05) !== null) continue;
        if (findEntityNear(world, x, y, 0.35) !== null) continue;
        return { x, y };
      }
    }
  }
  return null;
}

export function kutnaHoraWaveSystem(world: SimWorld): void {
  const campaign = world.campaign;
  if (!campaign) return;
  campaign.scriptedWaveIndex ??= 0;
  campaign.scriptedWaveCount ??= KUTNA_HORA_TOTAL_WAVES;

  if (
    campaign.scriptedWaveIndex < campaign.scriptedWaveCount &&
    world.tick >= campaign.nextReinforcementTick
  ) {
    const waveIndex = campaign.scriptedWaveIndex;
    const spawned = spawnKutnaHoraAssaultWave(world, waveIndex);
    const attackers = campaign.trackedObjectiveEids.kutna_hora_attackers ?? [];
    campaign.trackedObjectiveEids.kutna_hora_attackers = attackers.concat(spawned);
    campaign.scriptedWaveIndex = waveIndex + 1;
    campaign.nextReinforcementTick =
      campaign.scriptedWaveIndex >= campaign.scriptedWaveCount
        ? Number.MAX_SAFE_INTEGER
        : world.tick + KUTNA_HORA_WAVE_INTERVAL_TICKS;
    pushAiEvent(world, AI_PLAYER_ID, `Crusader wave ${waveIndex + 1} is advancing on Kutná Hora`);
  }

  if (campaign.scriptedWaveIndex < campaign.scriptedWaveCount) return;
  const liveAttackers = countLiveTrackedEids(
    world,
    campaign.trackedObjectiveEids.kutna_hora_attackers ?? []
  );
  if (liveAttackers > 0) return;
  completeCampaignObjective(campaign, 'survive_kutna_hora');
  if (findOwnedTownCenter(world, LOCAL_PLAYER_ID) !== null) {
    completeCampaignObjective(campaign, 'hold_kutna_hora_tc');
  }
}

interface KutnaHoraWaveDef {
  spearmen: number;
  archers: number;
  cavalry: number;
  gunmen: number;
  cannons: number;
}

const KUTNA_HORA_WAVES: KutnaHoraWaveDef[] = [
  { spearmen: 8, archers: 4, cavalry: 6, gunmen: 0, cannons: 0 },
  { spearmen: 10, archers: 4, cavalry: 8, gunmen: 4, cannons: 0 },
  { spearmen: 12, archers: 6, cavalry: 10, gunmen: 6, cannons: 0 },
  { spearmen: 12, archers: 8, cavalry: 12, gunmen: 8, cannons: 1 },
  { spearmen: 14, archers: 8, cavalry: 14, gunmen: 10, cannons: 2 },
];

function spawnKutnaHoraAssaultWave(world: SimWorld, waveIndex: number): number[] {
  const town = world.map.spawns[LOCAL_PLAYER_ID];
  const enemyEdge = kutnaHoraWaveSpawnAnchor(waveIndex);
  world.map.spawns[AI_PLAYER_ID] = enemyEdge;
  const advance = normalizeVector(town.x - enemyEdge.x, town.y - enemyEdge.y);
  const across = { x: -advance.y, y: advance.x };
  const wave = KUTNA_HORA_WAVES[Math.min(waveIndex, KUTNA_HORA_WAVES.length - 1)];
  const anchor = offsetBattlePoint(enemyEdge, advance, across, waveIndex % 2 === 0 ? 0 : -2, (waveIndex - 2) * 1.5);
  clearKutnaHoraGround(world, anchor, 12, 8);

  const eids: number[] = [];
  eids.push(...spawnFormationRow(world, UnitDefId.SPEARMAN, anchor, advance, across, 1.2, 0, AI_PLAYER_ID, wave.spearmen, 1.1));
  eids.push(...spawnFormationRow(world, UnitDefId.ARCHER, anchor, advance, across, -0.7, 0, AI_PLAYER_ID, wave.archers, 1.15));
  if (wave.gunmen > 0) {
    eids.push(...spawnFormationRow(world, UnitDefId.GUNMAN, anchor, advance, across, -2.4, 0, AI_PLAYER_ID, wave.gunmen, 1.12));
  }
  if (wave.cavalry > 0) {
    const left = Math.ceil(wave.cavalry / 2);
    const right = wave.cavalry - left;
    eids.push(...spawnFormationRow(world, UnitDefId.SCOUT_CAVALRY, anchor, advance, across, 0.0, -7.0, AI_PLAYER_ID, left, 1.18));
    eids.push(...spawnFormationRow(world, UnitDefId.SCOUT_CAVALRY, anchor, advance, across, 0.0, 7.0, AI_PLAYER_ID, right, 1.18));
  }
  if (wave.cannons > 0) {
    eids.push(...spawnFormationRow(world, UnitDefId.CANNON, anchor, advance, across, -4.8, 0, AI_PLAYER_ID, wave.cannons, 3.0));
  }
  issueBilaHoraEnemyAdvance(world, eids, getKutnaHoraAttackTarget(world, enemyEdge));
  return eids;
}

function kutnaHoraWaveSpawnAnchor(waveIndex: number): GridPos {
  const anchors: GridPos[] = [
    { x: Math.round(MAP.WIDTH * 0.50), y: 2 },
    { x: MAP.WIDTH - 3, y: Math.round(MAP.HEIGHT * 0.50) },
    { x: Math.round(MAP.WIDTH * 0.50), y: MAP.HEIGHT - 3 },
    { x: 2, y: Math.round(MAP.HEIGHT * 0.50) },
    { x: MAP.WIDTH - 5, y: 5 },
  ];
  return anchors[waveIndex % anchors.length];
}

function getKutnaHoraAttackTarget(world: SimWorld, enemyEdge: GridPos): GridPos {
  const town = world.map.spawns[LOCAL_PLAYER_ID];
  const road = normalizeVector(enemyEdge.x - town.x, enemyEdge.y - town.y);
  const across = { x: -road.y, y: road.x };
  return offsetBattlePoint(town, road, across, -4, 0);
}
