/**
 * Voxel model catalogue: which TypeScript voxel model backs which building,
 * unit and resource, under which texture key, with which bake settings and
 * sprite origin. The bake step (voxel-bake.ts) and the voxel sprite source
 * (voxel-sprite-source.ts) both read from here, so adding a voxel model is a
 * one-table edit.
 */

import type { VoxelBakeOptions, Voxel } from '../voxel/voxel-render';
import { AgeId, BuildingDefId, UnitDefId } from '@sim/defs';
import { ResourceKindId } from '@sim/components';
import { MapFeatureKind, type MapFeatureKindValue } from '@sim/map-gen';
import type { Facing } from './facing';
import { buildDarkTcVoxels } from '../voxel/models/dark-tc';
import { buildDarkHouseVoxels } from '../voxel/models/dark-house';
import { buildDarkFarmVoxels } from '../voxel/models/dark-farm';
import { buildDarkBarracksVoxels } from '../voxel/models/dark-barracks';
import { buildDarkArcheryRangeVoxels } from '../voxel/models/dark-archery-range';
import { buildDarkStableVoxels } from '../voxel/models/dark-stable';
import { buildGunpowderFoundryVoxels } from '../voxel/models/gunpowder-foundry';
import { buildDarkLumberCampVoxels } from '../voxel/models/dark-lumber-camp';
import { buildDarkMillVoxels } from '../voxel/models/dark-mill';
import { buildDarkGoldMineVoxels } from '../voxel/models/dark-gold-mine';
import { buildDarkStoneQuarryVoxels } from '../voxel/models/dark-stone-quarry';
import { buildDarkDefensiveTowerVoxels } from '../voxel/models/dark-defensive-tower';
import { buildWallVoxels } from '../voxel/models/wall';
import {
  buildBerryVoxels,
  buildDeadTreeVoxels,
  buildGoldVoxels,
  buildJaggedRockVoxels,
  buildLindenTreeVoxels,
  buildSnowTreeVoxels,
  buildStoneVoxels,
  buildTreeVoxels,
} from '../voxel/models/resources';
import {
  VILLAGER_ANIMS,
  VILLAGER_BAKE_BOUNDS,
  VILLAGER_FRAME_COUNTS,
  buildVillagerVoxels,
} from '../voxel/models/dark-villager';
import {
  ARCHER_ANIMS,
  ARCHER_BAKE_BOUNDS,
  ARCHER_FRAME_COUNTS,
  buildArcherVoxels,
} from '../voxel/models/dark-archer';
import {
  SPEARMAN_ANIMS,
  SPEARMAN_BAKE_BOUNDS,
  SPEARMAN_FRAME_COUNTS,
  buildSpearmanVoxels,
} from '../voxel/models/dark-spearman';
import {
  SCOUT_CAVALRY_ANIMS,
  SCOUT_CAVALRY_BAKE_BOUNDS,
  SCOUT_CAVALRY_FRAME_COUNTS,
  buildScoutCavalryVoxels,
} from '../voxel/models/dark-scout-cavalry';
import {
  GUNMAN_ANIMS,
  GUNMAN_BAKE_BOUNDS,
  GUNMAN_FRAME_COUNTS,
  buildGunmanVoxels,
} from '../voxel/models/gunpowder-gunman';
import {
  CANNON_ANIMS,
  CANNON_BAKE_BOUNDS,
  CANNON_FRAME_COUNTS,
  buildCannonVoxels,
} from '../voxel/models/gunpowder-cannon';
import {
  MACHINE_GUN_ANIMS,
  MACHINE_GUN_BAKE_BOUNDS,
  MACHINE_GUN_FRAME_COUNTS,
  buildMachineGunVoxels,
} from '../voxel/models/total-war-machine-gun';
import {
  MORTAR_ANIMS,
  MORTAR_BAKE_BOUNDS,
  MORTAR_FRAME_COUNTS,
  buildMortarVoxels,
} from '../voxel/models/total-war-mortar';

type BakeBounds = NonNullable<VoxelBakeOptions['bounds']>;

/** Players that get team-coloured bakes (1 = host / human, 2 = AI / guest). */
export const VOXEL_TEAM_PLAYERS = [1, 2] as const;

/**
 * On-screen scale applied to every voxel unit sprite. 0.82 puts a villager at
 * about 25 px against a Blender door of about 20 px (0.52 tile): a touch
 * larger than true scale, the usual RTS exaggeration that keeps units
 * readable next to big detailed buildings and trees.
 */
export const VOXEL_UNIT_SCALE = 0.82;

export const VOXEL_KEYS = {
  DARK_TC_PREFIX: 'voxel-dark-tc-p',
  CASTLE_TC_PREFIX: 'voxel-castle-tc-p',
  GUNPOWDER_TC_PREFIX: 'voxel-gunpowder-tc-p',
  DEFENSIVE_TOWER_PREFIX: 'voxel-dark-defensive-tower-p',
  HOUSE: 'voxel-dark-house',
  FARM: 'voxel-dark-farm',
  MILL: 'voxel-dark-mill',
  BARRACKS: 'voxel-dark-barracks',
  ARCHERY_RANGE: 'voxel-dark-archery-range',
  STABLE: 'voxel-dark-stable',
  LUMBER_CAMP: 'voxel-dark-lumber-camp',
  GOLD_MINE: 'voxel-dark-gold-mine',
  STONE_QUARRY: 'voxel-dark-stone-quarry',
  FOUNDRY: 'voxel-gunpowder-foundry',
  WALL_X: 'voxel-palisade-wall-x',
  WALL_Y: 'voxel-palisade-wall-y',
  TREE: 'voxel-tree',
  SNOW_TREE: 'voxel-snow-tree',
  DEAD_TREE: 'voxel-dead-tree',
  LINDEN_TREE: 'voxel-linden-tree',
  JAGGED_ROCK: 'voxel-jagged-rock',
  GOLD: 'voxel-gold',
  STONE: 'voxel-stone',
  BERRY: 'voxel-berry',
} as const;

// ── Units ───────────────────────────────────────────────────────────────────

export interface VoxelUnitPose {
  facing: Facing;
  anim: string;
  frame: number;
}

export interface VoxelUnitModel {
  keyPrefix: string;
  anims: readonly string[];
  frameCounts: Readonly<Record<string, number>>;
  bounds: BakeBounds;
  /** Sprite originY that puts the feet on the tile anchor (fixed bake bounds add padding). */
  originY: number;
  build(teamColor: number, pose: VoxelUnitPose): Voxel[];
}

export const VOXEL_UNIT_MODELS: Readonly<Partial<Record<number, VoxelUnitModel>>> = {
  [UnitDefId.VILLAGER]: {
    keyPrefix: 'voxel-villager-p',
    anims: VILLAGER_ANIMS,
    frameCounts: VILLAGER_FRAME_COUNTS,
    bounds: VILLAGER_BAKE_BOUNDS,
    originY: 0.73,
    build: (color, pose) =>
      buildVillagerVoxels(color, pose as Parameters<typeof buildVillagerVoxels>[1]),
  },
  [UnitDefId.ARCHER]: {
    keyPrefix: 'voxel-archer-p',
    anims: ARCHER_ANIMS,
    frameCounts: ARCHER_FRAME_COUNTS,
    bounds: ARCHER_BAKE_BOUNDS,
    originY: 0.7,
    build: (color, pose) =>
      buildArcherVoxels(color, pose as Parameters<typeof buildArcherVoxels>[1]),
  },
  [UnitDefId.SPEARMAN]: {
    keyPrefix: 'voxel-spearman-p',
    anims: SPEARMAN_ANIMS,
    frameCounts: SPEARMAN_FRAME_COUNTS,
    bounds: SPEARMAN_BAKE_BOUNDS,
    originY: 0.7,
    build: (color, pose) =>
      buildSpearmanVoxels(color, pose as Parameters<typeof buildSpearmanVoxels>[1]),
  },
  [UnitDefId.SCOUT_CAVALRY]: {
    keyPrefix: 'voxel-scout-cavalry-p',
    anims: SCOUT_CAVALRY_ANIMS,
    frameCounts: SCOUT_CAVALRY_FRAME_COUNTS,
    bounds: SCOUT_CAVALRY_BAKE_BOUNDS,
    originY: 0.73,
    build: (color, pose) =>
      buildScoutCavalryVoxels(color, pose as Parameters<typeof buildScoutCavalryVoxels>[1]),
  },
  [UnitDefId.GUNMAN]: {
    keyPrefix: 'voxel-gunman-p',
    anims: GUNMAN_ANIMS,
    frameCounts: GUNMAN_FRAME_COUNTS,
    bounds: GUNMAN_BAKE_BOUNDS,
    originY: 0.7,
    build: (color, pose) =>
      buildGunmanVoxels(color, pose as Parameters<typeof buildGunmanVoxels>[1]),
  },
  [UnitDefId.CANNON]: {
    keyPrefix: 'voxel-cannon-p',
    anims: CANNON_ANIMS,
    frameCounts: CANNON_FRAME_COUNTS,
    bounds: CANNON_BAKE_BOUNDS,
    originY: 0.645,
    build: (color, pose) =>
      buildCannonVoxels(color, pose as Parameters<typeof buildCannonVoxels>[1]),
  },
  [UnitDefId.MACHINE_GUN]: {
    keyPrefix: 'voxel-machine-gun-p',
    anims: MACHINE_GUN_ANIMS,
    frameCounts: MACHINE_GUN_FRAME_COUNTS,
    bounds: MACHINE_GUN_BAKE_BOUNDS,
    originY: 0.69,
    build: (color, pose) =>
      buildMachineGunVoxels(color, pose as Parameters<typeof buildMachineGunVoxels>[1]),
  },
  [UnitDefId.MORTAR]: {
    keyPrefix: 'voxel-mortar-p',
    anims: MORTAR_ANIMS,
    frameCounts: MORTAR_FRAME_COUNTS,
    bounds: MORTAR_BAKE_BOUNDS,
    originY: 0.64,
    build: (color, pose) =>
      buildMortarVoxels(color, pose as Parameters<typeof buildMortarVoxels>[1]),
  },
};

/** Bake order of the per-player unit models (kept stable for reproducible boots). */
export const VOXEL_UNIT_BAKE_ORDER = [
  UnitDefId.VILLAGER,
  UnitDefId.ARCHER,
  UnitDefId.SPEARMAN,
  UnitDefId.SCOUT_CAVALRY,
  UnitDefId.GUNMAN,
  UnitDefId.CANNON,
  UnitDefId.MACHINE_GUN,
  UnitDefId.MORTAR,
] as const;

export function voxelUnitKey(
  model: VoxelUnitModel,
  playerId: number,
  facing: string,
  anim: string,
  frame: number
): string {
  return `${model.keyPrefix}${playerId}-${facing}-${anim}-${frame}`;
}

/** Texture key for a unit pose, or null when no voxel model exists for the unit. */
export function voxelUnitTextureKey(
  unitDefId: number,
  playerId: number,
  facing: string,
  anim: string,
  frame: number
): string | null {
  const model = VOXEL_UNIT_MODELS[unitDefId];
  return model ? voxelUnitKey(model, playerId, facing, anim, frame) : null;
}

// ── Buildings ───────────────────────────────────────────────────────────────

export interface VoxelStaticBake {
  key: string;
  build(): Voxel[];
  voxelW: number;
  bounds?: BakeBounds;
}

/** Team-coloured building bakes for one player, in bake order. */
export function voxelTeamBuildingBakes(playerId: number, teamColor: number): VoxelStaticBake[] {
  return [
    { key: VOXEL_KEYS.DARK_TC_PREFIX + playerId, build: () => buildDarkTcVoxels(teamColor), voxelW: 5 },
    {
      key: VOXEL_KEYS.CASTLE_TC_PREFIX + playerId,
      build: () => buildDarkTcVoxels(teamColor, 'castle'),
      voxelW: 5,
    },
    {
      key: VOXEL_KEYS.GUNPOWDER_TC_PREFIX + playerId,
      build: () => buildDarkTcVoxels(teamColor, 'gunpowder'),
      voxelW: 5,
    },
    {
      key: VOXEL_KEYS.DEFENSIVE_TOWER_PREFIX + playerId,
      build: () => buildDarkDefensiveTowerVoxels(teamColor),
      voxelW: 4,
    },
  ];
}

const WALL_BOUNDS: BakeBounds = { minX: -1, maxX: 17, minY: -1, maxY: 17, minZ: 0, maxZ: 11 };

/** Shared (not team-coloured) building, wall and resource bakes, in bake order. */
export const VOXEL_SHARED_BAKES: readonly VoxelStaticBake[] = [
  { key: VOXEL_KEYS.HOUSE, build: buildDarkHouseVoxels, voxelW: 4 },
  { key: VOXEL_KEYS.FARM, build: buildDarkFarmVoxels, voxelW: 4 },
  { key: VOXEL_KEYS.MILL, build: buildDarkMillVoxels, voxelW: 4 },
  { key: VOXEL_KEYS.BARRACKS, build: buildDarkBarracksVoxels, voxelW: 4 },
  { key: VOXEL_KEYS.ARCHERY_RANGE, build: buildDarkArcheryRangeVoxels, voxelW: 4 },
  { key: VOXEL_KEYS.STABLE, build: buildDarkStableVoxels, voxelW: 4 },
  { key: VOXEL_KEYS.LUMBER_CAMP, build: buildDarkLumberCampVoxels, voxelW: 4 },
  { key: VOXEL_KEYS.GOLD_MINE, build: buildDarkGoldMineVoxels, voxelW: 4 },
  { key: VOXEL_KEYS.STONE_QUARRY, build: buildDarkStoneQuarryVoxels, voxelW: 4 },
  { key: VOXEL_KEYS.FOUNDRY, build: buildGunpowderFoundryVoxels, voxelW: 4 },
  { key: VOXEL_KEYS.WALL_X, build: () => buildWallVoxels('x'), voxelW: 4, bounds: WALL_BOUNDS },
  { key: VOXEL_KEYS.WALL_Y, build: () => buildWallVoxels('y'), voxelW: 4, bounds: WALL_BOUNDS },
  { key: VOXEL_KEYS.TREE, build: buildTreeVoxels, voxelW: 4 },
  { key: VOXEL_KEYS.SNOW_TREE, build: buildSnowTreeVoxels, voxelW: 4 },
  { key: VOXEL_KEYS.DEAD_TREE, build: buildDeadTreeVoxels, voxelW: 4 },
  { key: VOXEL_KEYS.LINDEN_TREE, build: buildLindenTreeVoxels, voxelW: 4 },
  { key: VOXEL_KEYS.JAGGED_ROCK, build: buildJaggedRockVoxels, voxelW: 4 },
  { key: VOXEL_KEYS.GOLD, build: buildGoldVoxels, voxelW: 4 },
  { key: VOXEL_KEYS.STONE, build: buildStoneVoxels, voxelW: 4 },
  { key: VOXEL_KEYS.BERRY, build: buildBerryVoxels, voxelW: 4 },
];

/** Texture key + originY for a building in a given age. Null for unknown defs. */
export function voxelBuildingSprite(
  defId: number,
  age: number,
  playerId: number,
  variant?: string
): { key: string; originY: number } | null {
  switch (defId) {
    case BuildingDefId.TOWN_CENTER:
      if (age >= AgeId.GUNPOWDER) {
        return { key: VOXEL_KEYS.GUNPOWDER_TC_PREFIX + playerId, originY: 0.705 };
      }
      return age >= AgeId.CASTLE
        ? { key: VOXEL_KEYS.CASTLE_TC_PREFIX + playerId, originY: 0.706 }
        : { key: VOXEL_KEYS.DARK_TC_PREFIX + playerId, originY: 0.66 };
    case BuildingDefId.HOUSE: return { key: VOXEL_KEYS.HOUSE, originY: 0.609 };
    case BuildingDefId.FARM: return { key: VOXEL_KEYS.FARM, originY: 0.59 };
    case BuildingDefId.MILL: return { key: VOXEL_KEYS.MILL, originY: 0.67 };
    case BuildingDefId.LUMBER_CAMP: return { key: VOXEL_KEYS.LUMBER_CAMP, originY: 0.581 };
    case BuildingDefId.GOLD_MINE: return { key: VOXEL_KEYS.GOLD_MINE, originY: 0.5 };
    case BuildingDefId.STONE_QUARRY: return { key: VOXEL_KEYS.STONE_QUARRY, originY: 0.514 };
    case BuildingDefId.BARRACKS: return { key: VOXEL_KEYS.BARRACKS, originY: 0.596 };
    case BuildingDefId.ARCHERY_RANGE: return { key: VOXEL_KEYS.ARCHERY_RANGE, originY: 0.632 };
    case BuildingDefId.STABLE: return { key: VOXEL_KEYS.STABLE, originY: 0.611 };
    case BuildingDefId.FOUNDRY: return { key: VOXEL_KEYS.FOUNDRY, originY: 0.61 };
    case BuildingDefId.DEFENSIVE_TOWER:
      return { key: VOXEL_KEYS.DEFENSIVE_TOWER_PREFIX + playerId, originY: 0.743 };
    case BuildingDefId.WALL:
      return { key: variant === 'y' ? VOXEL_KEYS.WALL_Y : VOXEL_KEYS.WALL_X, originY: 0.67 };
    default:
      return null;
  }
}

// ── Resources + map features ────────────────────────────────────────────────

export const VOXEL_RESOURCE_ORIGIN_Y = 0.85;

export function voxelResourceKey(kind: number, variant?: string): string | null {
  switch (kind) {
    case ResourceKindId.WOOD:
      if (variant === 'dead') return VOXEL_KEYS.DEAD_TREE;
      return variant === 'snow' ? VOXEL_KEYS.SNOW_TREE : VOXEL_KEYS.TREE;
    case ResourceKindId.GOLD: return VOXEL_KEYS.GOLD;
    case ResourceKindId.STONE: return VOXEL_KEYS.STONE;
    case ResourceKindId.FOOD: return VOXEL_KEYS.BERRY;
    default: return null;
  }
}

export function voxelMapFeatureSprite(
  kind: MapFeatureKindValue,
  size: number
): { key: string; originY: number; scale: number } | null {
  switch (kind) {
    case MapFeatureKind.ROCK_SPIRE:
      return { key: VOXEL_KEYS.JAGGED_ROCK, originY: 0.88, scale: size === 4 ? 2.1 : 1.15 };
    case MapFeatureKind.LINDEN_TREE:
      return { key: VOXEL_KEYS.LINDEN_TREE, originY: 0.86, scale: 1 };
    default:
      return null;
  }
}
