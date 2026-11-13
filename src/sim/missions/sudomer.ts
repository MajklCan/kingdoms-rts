/**
 * Battle of Sudomer: town defense with mud-flank waves.
 */

import { MAP, SIM } from '../../config';
import { Position, ResourceKindId } from '../components';
import { AgeId, BuildingDefId, UnitDefId } from '../defs';
import { CampaignMissionId } from '../campaign';
import { TileType } from '../map-gen';
import type { GridPos } from '../pathfinding';
import { createAllTechSet } from '../tech-tree';
import { AI_PLAYER_ID, LOCAL_PLAYER_ID } from '../core/constants';
import { createAgeState } from '../core/create-world';
import { removeSimEntity } from '../core/entities';
import { pushAiEvent } from '../core/events';
import { findOwnedTownCenter } from '../core/lookup';
import { resourceQuery } from '../core/queries';
import type { SimWorld } from '../core/types';
import { spawnTownCenter } from '../factories/buildings';
import { findPresetUnitSpot, placePresetBuilding, spawnPresetUnitAt } from '../factories/late-game';
import { spawnVillager } from '../factories/units';
import { setUnitHoldAnchor } from '../input/unit-orders';
import { revealMapForPlayer } from '../systems/visibility';
import { issueBilaHoraEnemyAdvance } from './bila-hora';
import { completeCampaignObjective, countLiveTrackedEids } from './campaign-world';
import { placeKutnaHoraWorksite } from './kutna-hora';
import {
  clearBattlefieldForTownlessMission,
  isWaterCampaignTile,
  normalizeVector,
  offsetBattlePoint,
  spawnFormationRow,
} from './shared';

const SUDOMER_FIRST_WAVE_TICKS = SIM.TICK_HZ * 300;
const SUDOMER_WAVE_INTERVAL_TICKS = SIM.TICK_HZ * 55;
const SUDOMER_TOTAL_WAVES = 5;
const SUDOMER_POP_CAP = 120;

export function configureBattleOfSudomer(world: SimWorld): void {
  clearBattlefieldForTownlessMission(world);

  world.ages[LOCAL_PLAYER_ID] = createAgeState(AgeId.GUNPOWDER);
  world.ages[AI_PLAYER_ID] = createAgeState(AgeId.GUNPOWDER);
  world.researchedTechs[LOCAL_PLAYER_ID] = createAllTechSet();
  world.researchedTechs[AI_PLAYER_ID] = createAllTechSet();
  // [food, wood, gold, stone] — a modest stockpile: enough to queue a handful of
  // units immediately, but the prep window must be spent ramping the economy.
  world.resources[LOCAL_PLAYER_ID].set([400, 500, 150, 200]);
  world.resources[AI_PLAYER_ID].set([0, 0, 0, 0]);

  const town = sudomerTownCenter();
  const muster = { x: town.x + 3, y: town.y + 6 };
  const firstAttack = sudomerWaveSpawnAnchor(0);
  world.map.spawns[LOCAL_PLAYER_ID] = muster;
  world.map.spawns[AI_PLAYER_ID] = firstAttack;

  // Clear a generous dry bowl for the town + economy, and keep the two enemy
  // approach lanes (dry central choke, muddy right flank) walkable.
  clearSudomerGround(world, town, 18, 15, false, true);
  clearSudomerGround(world, { x: town.x + 14, y: town.y + 14 }, 14, 5, false);
  clearSudomerGround(world, { x: town.x + 27, y: town.y + 9 }, 6, 8, true);
  for (let i = 0; i < SUDOMER_TOTAL_WAVES; i++) {
    clearSudomerGround(world, sudomerWaveSpawnAnchor(i), 8, 6, i % 2 === 1);
  }

  const townCenter = buildSudomerPlayerTown(world, town);
  spawnSudomerStartingSquad(world, muster);
  spawnSudomerVillagers(world, town, 12);

  world.population[LOCAL_PLAYER_ID].cap = SUDOMER_POP_CAP;
  world.population[AI_PLAYER_ID].cap = SUDOMER_POP_CAP;
  world.armyRallyPoints[LOCAL_PLAYER_ID] = { x: town.x + 12, y: town.y + 12 };
  world.armyRallyPoints[AI_PLAYER_ID] = null;
  world.aiPlayers[AI_PLAYER_ID] = null;
  world.campaign = {
    missionId: CampaignMissionId.BATTLE_OF_SUDOMER,
    name: 'Battle of Sudoměř',
    description: '',
    briefing: '',
    lockedTechs: [],
    objectives: [],
    trackedObjectiveEids: {
      sudomer_attackers: [],
      sudomer_town_center: townCenter !== null ? [townCenter] : [],
    },
    enemyAiMode: 'defensive',
    nextReinforcementTick: world.tick + SUDOMER_FIRST_WAVE_TICKS,
    scriptedWaveIndex: 0,
    scriptedWaveCount: SUDOMER_TOTAL_WAVES,
  };
  pushAiEvent(
    world,
    AI_PLAYER_ID,
    'A royalist crusader host masses across the field — first assault in 5 minutes. Marshal Sudoměř.'
  );
  revealMapForPlayer(world, LOCAL_PLAYER_ID);
}

function clearSudomerGround(
  world: SimWorld,
  center: GridPos,
  radiusX: number,
  radiusY: number,
  keepMud: boolean,
  preserveDirt = false
): void {
  const minX = Math.max(1, Math.round(center.x - radiusX));
  const maxX = Math.min(MAP.WIDTH - 2, Math.round(center.x + radiusX));
  const minY = Math.max(1, Math.round(center.y - radiusY));
  const maxY = Math.min(MAP.HEIGHT - 2, Math.round(center.y + radiusY));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const idx = y * MAP.WIDTH + x;
      if (keepMud && world.map.tiles[idx] === TileType.MUD) {
        world.map.elevation[idx] = Math.min(world.map.elevation[idx], 2);
      } else if (preserveDirt && world.map.tiles[idx] === TileType.DIRT) {
        world.map.elevation[idx] = 3;
      } else if (!isWaterCampaignTile(world.map.tiles[idx])) {
        world.map.tiles[idx] = Math.abs(x - center.x) <= 1 ? TileType.DIRT : TileType.GRASS;
        world.map.elevation[idx] = 3;
      }
      if (!isWaterCampaignTile(world.map.tiles[idx])) {
        world.map.walkability[y][x] = 0;
        world.grid[y][x] = 0;
      }
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

function sudomerTownCenter(): GridPos {
  return {
    x: Math.round(MAP.WIDTH * 0.14),
    y: Math.round(MAP.HEIGHT * 0.14),
  };
}

function buildSudomerPlayerTown(world: SimWorld, town: GridPos): number | null {
  const townCenter = spawnTownCenter(world, town.x, town.y, LOCAL_PLAYER_ID);

  const place = (defId: number, dx: number, dy: number) =>
    placePresetBuilding(world, defId, town.x + dx, town.y + dy, LOCAL_PLAYER_ID);

  const houseOffsets: GridPos[] = [
    { x: -7, y: -5 }, { x: -4, y: -6 }, { x: -1, y: -6 },
    { x: -8, y: 0 }, { x: -8, y: 4 }, { x: -6, y: 7 },
    { x: 2, y: -6 }, { x: 5, y: -5 },
  ];
  for (const offset of houseOffsets) {
    place(BuildingDefId.HOUSE, offset.x, offset.y);
  }

  // Military production: pikemen from the barracks, hand-gunners from the foundry.
  place(BuildingDefId.BARRACKS, -5, 3);
  place(BuildingDefId.FOUNDRY, 5, 3);

  // Economy. Each worksite seeds its own resource nodes and auto-starts one
  // worker; the player must assign the idle villagers to ramp income — gold
  // especially, since gunmen cost 75 gold apiece.
  placeKutnaHoraWorksite(world, BuildingDefId.LUMBER_CAMP, town.x - 9, town.y - 3, ResourceKindId.WOOD);
  placeKutnaHoraWorksite(world, BuildingDefId.STONE_QUARRY, town.x + 9, town.y - 4, ResourceKindId.STONE);
  placeKutnaHoraWorksite(world, BuildingDefId.GOLD_MINE, town.x + 10, town.y + 2, ResourceKindId.GOLD);

  place(BuildingDefId.FARM, -6, 8);
  place(BuildingDefId.FARM, -3, 9);
  place(BuildingDefId.FARM, 0, 9);
  place(BuildingDefId.MILL, 3, 8);

  return townCenter;
}

function spawnSudomerStartingSquad(world: SimWorld, muster: GridPos): number[] {
  const squad: number[] = [];
  const block = (defId: number, originX: number, originY: number, cols: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const preferredX = originX + (i % cols);
      const preferredY = originY + Math.floor(i / cols);
      const spot = findPresetUnitSpot(world, preferredX, preferredY, 4, LOCAL_PLAYER_ID, 6);
      if (!spot) continue;
      const eid = spawnPresetUnitAt(world, defId, spot.x, spot.y, LOCAL_PLAYER_ID);
      if (eid === null) continue;
      setUnitHoldAnchor(world, eid, spot.x, spot.y);
      squad.push(eid);
    }
  };
  // A tidy square mustered in the base: 12 pikemen in front, 6 gunmen ranked up
  // behind. Default stance — the player repositions them before the assault.
  block(UnitDefId.SPEARMAN, muster.x - 2, muster.y, 4, 12);
  block(UnitDefId.GUNMAN, muster.x - 2, muster.y + 4, 3, 6);
  return squad;
}

function spawnSudomerVillagers(world: SimWorld, town: GridPos, count: number): void {
  for (let i = 0; i < count; i++) {
    const preferredX = town.x - 3 + (i % 4);
    const preferredY = town.y + 3 + Math.floor(i / 4);
    const spot = findPresetUnitSpot(world, preferredX, preferredY, 5, LOCAL_PLAYER_ID, 6);
    if (!spot) continue;
    spawnVillager(world, spot.x, spot.y, LOCAL_PLAYER_ID);
  }
}

function sudomerAttackTarget(route: SudomerWaveRoute): GridPos {
  const town = sudomerTownCenter();
  if (route === 'mud') {
    return { x: town.x + 27, y: town.y + 9 };
  }
  return { x: town.x + 12, y: town.y + 12 };
}

export function sudomerWaveSystem(world: SimWorld): void {
  const campaign = world.campaign;
  if (!campaign) return;
  campaign.scriptedWaveIndex ??= 0;
  campaign.scriptedWaveCount ??= SUDOMER_TOTAL_WAVES;

  if (campaign.scriptedWaveIndex < campaign.scriptedWaveCount) {
    // Telegraph the approaching wave so the player can shift between the two
    // fronts. Exact-tick checks fire each warning exactly once.
    const next = campaign.nextReinforcementTick;
    if (next < Number.MAX_SAFE_INTEGER) {
      const upcoming = SUDOMER_WAVES[Math.min(campaign.scriptedWaveIndex, SUDOMER_WAVES.length - 1)];
      if (world.tick === next - SIM.TICK_HZ * 40) {
        pushAiEvent(world, AI_PLAYER_ID, `The crusaders form up — ${sudomerWaveThreatLabel(upcoming)} incoming.`);
      } else if (world.tick === next - SIM.TICK_HZ * 12) {
        pushAiEvent(world, AI_PLAYER_ID, `Assault imminent — brace for ${sudomerWaveThreatLabel(upcoming)}!`);
      }
    }

    if (world.tick >= campaign.nextReinforcementTick) {
      const waveIndex = campaign.scriptedWaveIndex;
      const spawned = spawnSudomerAssaultWave(world, waveIndex);
      const attackers = campaign.trackedObjectiveEids.sudomer_attackers ?? [];
      campaign.trackedObjectiveEids.sudomer_attackers = attackers.concat(spawned);
      campaign.scriptedWaveIndex = waveIndex + 1;
      campaign.nextReinforcementTick =
        campaign.scriptedWaveIndex >= campaign.scriptedWaveCount
          ? Number.MAX_SAFE_INTEGER
          : world.tick + SUDOMER_WAVE_INTERVAL_TICKS;
      const wave = SUDOMER_WAVES[Math.min(waveIndex, SUDOMER_WAVES.length - 1)];
      pushAiEvent(
        world,
        AI_PLAYER_ID,
        `Crusader assault ${waveIndex + 1} of ${campaign.scriptedWaveCount} charges — ${sudomerWaveThreatLabel(wave)}!`
      );
    }
    return;
  }

  const liveAttackers = countLiveTrackedEids(
    world,
    campaign.trackedObjectiveEids.sudomer_attackers ?? []
  );
  if (liveAttackers > 0) return;
  completeCampaignObjective(campaign, 'survive_sudomer_assault');
  if (findOwnedTownCenter(world, LOCAL_PLAYER_ID) !== null) {
    completeCampaignObjective(campaign, 'hold_sudomer_town');
  }
}

type SudomerWaveRoute = 'middle' | 'mud';

interface SudomerWaveProng {
  route: SudomerWaveRoute;
  spearmen: number;
  archers: number;
  cavalry: number;
  gunmen?: number;
  cannons?: number;
}

interface SudomerWaveDef {
  prongs: SudomerWaveProng[];
}

// Five escalating waves alternating the dry central gap and the muddy flank,
// building to wave 4's simultaneous two-front squeeze and a combined finale.
// Counts are first-pass "balanced" values — tune against tests/playthrough.
const SUDOMER_WAVES: SudomerWaveDef[] = [
  { prongs: [{ route: 'middle', spearmen: 14, archers: 6, cavalry: 0 }] },
  { prongs: [{ route: 'mud', spearmen: 4, archers: 0, cavalry: 18 }] },
  { prongs: [{ route: 'middle', spearmen: 20, archers: 8, cavalry: 0, gunmen: 4 }] },
  {
    prongs: [
      { route: 'middle', spearmen: 16, archers: 6, cavalry: 0 },
      { route: 'mud', spearmen: 0, archers: 0, cavalry: 16 },
    ],
  },
  {
    prongs: [
      { route: 'middle', spearmen: 18, archers: 8, cavalry: 0, gunmen: 6, cannons: 1 },
      { route: 'mud', spearmen: 6, archers: 0, cavalry: 16 },
    ],
  },
];

function sudomerWaveThreatLabel(wave: SudomerWaveDef): string {
  const routes = new Set(wave.prongs.map((prong) => prong.route));
  if (routes.has('middle') && routes.has('mud')) return 'infantry at the gap and horse in the mud';
  if (routes.has('mud')) return 'cavalry through the mud';
  return 'infantry through the central gap';
}

function spawnSudomerAssaultWave(world: SimWorld, waveIndex: number): number[] {
  const wave = SUDOMER_WAVES[Math.min(waveIndex, SUDOMER_WAVES.length - 1)];
  const eids: number[] = [];
  wave.prongs.forEach((prong, i) => {
    eids.push(...spawnSudomerProng(world, prong, waveIndex + i));
  });
  return eids;
}

function spawnSudomerProng(world: SimWorld, prong: SudomerWaveProng, ordinal: number): number[] {
  const enemyEdge = sudomerRouteAnchor(prong.route);
  world.map.spawns[AI_PLAYER_ID] = enemyEdge;
  clearSudomerGround(world, enemyEdge, 8, 6, prong.route === 'mud');
  const target = sudomerAttackTarget(prong.route);
  const advance = normalizeVector(target.x - enemyEdge.x, target.y - enemyEdge.y);
  const across = { x: -advance.y, y: advance.x };
  const anchor = offsetBattlePoint(
    enemyEdge,
    advance,
    across,
    ordinal % 2 === 0 ? 0 : -2,
    (ordinal - 1.5) * 1.5
  );

  const eids: number[] = [];
  if (prong.cavalry > 0) {
    const left = Math.ceil(prong.cavalry / 2);
    const right = prong.cavalry - left;
    eids.push(...spawnFormationRow(world, UnitDefId.SCOUT_CAVALRY, anchor, advance, across, 1.0, -6.5, AI_PLAYER_ID, left, 1.1));
    eids.push(...spawnFormationRow(world, UnitDefId.SCOUT_CAVALRY, anchor, advance, across, 1.0, 6.5, AI_PLAYER_ID, right, 1.1));
  }
  if (prong.spearmen > 0) {
    const front = Math.ceil(prong.spearmen / 2);
    eids.push(...spawnFormationRow(world, UnitDefId.SPEARMAN, anchor, advance, across, 0.0, -4.0, AI_PLAYER_ID, front, 1.05));
    eids.push(...spawnFormationRow(world, UnitDefId.SPEARMAN, anchor, advance, across, 1.4, 4.0, AI_PLAYER_ID, prong.spearmen - front, 1.05));
  }
  if (prong.archers > 0) {
    eids.push(...spawnFormationRow(world, UnitDefId.ARCHER, anchor, advance, across, -1.6, 0, AI_PLAYER_ID, prong.archers, 1.1));
  }
  if (prong.gunmen && prong.gunmen > 0) {
    eids.push(...spawnFormationRow(world, UnitDefId.GUNMAN, anchor, advance, across, -3.0, 0, AI_PLAYER_ID, prong.gunmen, 1.12));
  }
  if (prong.cannons && prong.cannons > 0) {
    eids.push(...spawnFormationRow(world, UnitDefId.CANNON, anchor, advance, across, -4.6, 0, AI_PLAYER_ID, prong.cannons, 3.0));
  }
  issueBilaHoraEnemyAdvance(world, eids, target);
  return eids;
}

function sudomerRouteAnchor(route: SudomerWaveRoute): GridPos {
  if (route === 'mud') {
    return { x: MAP.WIDTH - 4, y: Math.round(MAP.HEIGHT * 0.25) };
  }
  return { x: Math.round(MAP.WIDTH * 0.49), y: MAP.HEIGHT - 4 };
}

function sudomerWaveSpawnAnchor(waveIndex: number): GridPos {
  const anchors: GridPos[] = [
    { x: Math.round(MAP.WIDTH * 0.49), y: MAP.HEIGHT - 4 },
    { x: MAP.WIDTH - 4, y: Math.round(MAP.HEIGHT * 0.25) },
  ];
  return anchors[waveIndex % anchors.length];
}
