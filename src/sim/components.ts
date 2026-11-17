/**
 * bitECS component definitions. Each component is a struct-of-arrays. The fields are
 * indexed by entity id (eid). Keep these lean - only data the sim mutates. Render-only
 * state belongs in the render layer, not here.
 */

import { defineComponent, Types } from 'bitecs';

/** Position in tile coordinates (fractional - sub-tile interpolation possible). */
export const Position = defineComponent({
  x: Types.f32,
  y: Types.f32,
});

/**
 * Position at the START of the current sim tick. Movement copies Position →
 * PrevPosition before integrating, so the render layer can lerp between the
 * two using (accumulatorMs / TICK_MS) as alpha - eliminates the 20 Hz judder
 * that's otherwise visible at 60 fps render.
 */
export const PrevPosition = defineComponent({
  x: Types.f32,
  y: Types.f32,
});

/** Velocity in tiles per second (sim coordinates). */
export const Velocity = defineComponent({
  x: Types.f32,
  y: Types.f32,
});

/** Movement speed cap in tiles per second. */
export const Speed = defineComponent({
  value: Types.f32,
});

/** A* path destination in tile coordinates (-1 = no destination). */
export const PathTarget = defineComponent({
  x: Types.i16,
  y: Types.i16,
});

/** Unit kind enum. Militia id/tag are legacy save compatibility only. */
export const UnitKind = defineComponent({
  kind: Types.ui8,
});

/** Population used by this unit. Worksite-spawned economic workers use 0. */
export const PopulationCost = defineComponent({
  value: Types.ui8,
});

/** Player owner id (0 = gaia, 1 = player 1, etc.). */
export const Owner = defineComponent({
  player: Types.ui8,
});

/** Deterministic per-world entity id used for multiplayer command payloads. */
export const NetId = defineComponent({
  value: Types.ui32,
});

/** Selection tag - entity is currently selected by the local player. */
export const Selected = defineComponent();

/** Tag component for the Villager unit kind (used by queries). */
export const VillagerTag = defineComponent();

/**
 * Unit kind id constants. Mirrors the index referenced by UnitKind.kind so callers
 * don't have magic numbers scattered around. Expand as the unit roster grows.
 */
export const UnitKindId = {
  VILLAGER: 0,
  MILITIA: 1,
  ARCHER: 2,
  SPEARMAN: 3,
  SCOUT_CAVALRY: 4,
  GUNMAN: 5,
  CANNON: 6,
  MACHINE_GUN: 7,
  MORTAR: 8,
  COMMANDER: 9,
} as const;

// ────────────────────────────────────────────────────────────────────────────
// Phase 5 - Economy components
// ────────────────────────────────────────────────────────────────────────────

/** Resource node (tree, gold pile, stone pile, berry bush). */
export const Resource = defineComponent({
  kind: Types.ui8,
  amount: Types.i32,
});

/** What a unit is currently carrying back to a drop-off. */
export const ResourceCarry = defineComponent({
  kind: Types.ui8,
  amount: Types.ui16,
});

/** Gathering state machine. targetEid stores the resource node we're working. */
export const Gatherer = defineComponent({
  targetEid: Types.i32,
  state: Types.ui8,
  /** Ticks until next gather increment. */
  cooldown: Types.ui16,
});

/** Drop-off building. acceptsMask bits: 1=Food, 2=Wood, 4=Gold, 8=Stone. */
export const DropOff = defineComponent({
  acceptsMask: Types.ui8,
});

/** Tag - this entity is a Town Center (used for rendering + queries). */
export const TownCenterTag = defineComponent();

/** Resource kind ids - match Resource.kind values. */
export const ResourceKindId = {
  FOOD: 0,
  WOOD: 1,
  GOLD: 2,
  STONE: 3,
} as const;

export type ResourceKind = (typeof ResourceKindId)[keyof typeof ResourceKindId];

/** Gatherer state machine states. */
export const GathererStateId = {
  IDLE: 0,
  WALKING_TO: 1,
  GATHERING: 2,
  RETURNING: 3,
  DEPOSITING: 4,
  WALKING_TO_BUILD: 5,
  BUILDING: 6,
} as const;

/** Bitmask helpers for DropOff.acceptsMask. */
export const DropOffMask = {
  FOOD: 1 << 0,
  WOOD: 1 << 1,
  GOLD: 1 << 2,
  STONE: 1 << 3,
  ALL: (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3),
} as const;

/** Maximum capacity a single villager can carry per trip. */
export const VILLAGER_CARRY_CAPACITY = 10;
/** Cooldown ticks between gather increments: one unit every cooldown + 1
 *  ticks, so 5 ticks (0.25 s) per unit at 20 Hz. */
export const VILLAGER_GATHER_COOLDOWN = 4;
/** Stone is cut at half that pace: one unit every 10 ticks (0.5 s). Deposits
 *  keep their size, so a quarry both pays out and runs dry half as fast. */
export const STONE_GATHER_COOLDOWN = 9;

/** Cooldown between gather increments for a resource kind. */
export function gatherCooldownForKind(kind: number): number {
  return kind === ResourceKindId.STONE ? STONE_GATHER_COOLDOWN : VILLAGER_GATHER_COOLDOWN;
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 6 - Buildings + production
// ────────────────────────────────────────────────────────────────────────────

/** Generic Building marker - present on both foundations and completed buildings. */
export const Building = defineComponent({
  defId: Types.ui16,
});

/** Tag - entity is a building foundation (under construction). */
export const FoundationTag = defineComponent();

/** Construction progress for a foundation. Goes from 0 to def.buildTimeTicks. */
export const ConstructionSite = defineComponent({
  defId: Types.ui16,
  progress: Types.ui16,
  /** Snapshot of build time at site creation - saves a lookup each tick. */
  totalTicks: Types.ui16,
});

/** Villager's assigned build target. -1 = none. */
export const BuildOrder = defineComponent({
  targetEid: Types.i32,
});

/** Indicates this entity is a production source (TC, Barracks, etc.). */
export const Producer = defineComponent({
  /** Ticks of progress on the front-of-queue item (0 if queue empty). */
  currentProgress: Types.ui16,
});

/** Completed resource building that converts assigned villagers into income. */
export const ResourceWorksite = defineComponent({
  /** ResourceKindId this building extracts. */
  kind: Types.ui8,
  /** Auto-assigned workers this tick. Render/HUD can read this directly. */
  assignedWorkers: Types.ui8,
  /** Has this worksite already spawned its free initial worker? */
  freeWorkersSpawned: Types.ui8,
  /** Accumulated extraction progress. */
  progress: Types.ui16,
});

/** Villager spawned and controlled by a resource worksite. */
export const WorksiteWorker = defineComponent({
  siteEid: Types.i32,
});

// ────────────────────────────────────────────────────────────────────────────
// Phase 7 - Combat
// ────────────────────────────────────────────────────────────────────────────

/** Hit points + max hp + damage-reduction armour. */
export const Health = defineComponent({
  hp: Types.i32,
  hpMax: Types.i32,
  armor: Types.i16,
});

/** Combat stats for an attacking entity. */
export const Combat = defineComponent({
  atk: Types.i16,
  /** Attack range in tiles. Supports fractional values for tighter melee reach. */
  range: Types.f32,
  /** Ticks between attacks (1 / atk-speed). */
  attackSpeedTicks: Types.ui16,
  /** Aggro radius - auto-target enemies within this in idle mode. */
  aggroRadius: Types.ui8,
});

/** Current attack target. -1 = none. retainGoal=1 means attack-move (resume after kill). */
export const AttackTarget = defineComponent({
  targetEid: Types.i32,
  retainGoal: Types.ui8,
});

/** Generic cooldown (used by Combat). */
export const Cooldown = defineComponent({
  ticksRemaining: Types.i16,
});

/**
 * Attack-move destination. When `active=1`, units who lose their attack
 * target should resume walking toward (x, y) rather than stop in place.
 * Replaces the old `AttackTarget.retainGoal` bit which had nowhere to store
 * the actual destination.
 */
export const AttackMoveGoal = defineComponent({
  active: Types.ui8,
  x: Types.i16,
  y: Types.i16,
});

/** Standing combat behavior for military units. */
export const UnitStance = defineComponent({
  stance: Types.ui8,
  anchorX: Types.f32,
  anchorY: Types.f32,
});

export const UnitStanceId = {
  AUTO_DEFEND: 0,
  HOLD_POSITION: 1,
} as const;

export type UnitStanceValue = (typeof UnitStanceId)[keyof typeof UnitStanceId];

/** Tag - entity will be removed by cleanupSystem this tick. */
export const DeadTag = defineComponent();

/** Legacy tag - retained only so old saves that contain militia can deserialize. */
export const MilitiaTag = defineComponent();

/** Tag - entity is an Archer unit. */
export const ArcherTag = defineComponent();

/** Tag - entity is a Spearman unit. */
export const SpearmanTag = defineComponent();

/** Tag - entity is a Commander (the veteran, at most one alive per player). */
export const CommanderTag = defineComponent();

/** Tag - entity is a Scout Cavalry unit. */
export const ScoutCavalryTag = defineComponent();

/** Tag - entity is a Gunpowder Age gunman unit. */
export const GunmanTag = defineComponent();

/** Tag - entity is a Gunpowder Age field cannon unit. */
export const CannonTag = defineComponent();

/** Tag - entity is a Total War Age machine gun team. */
export const MachineGunTag = defineComponent();

/** Machine guns must unpack after movement before they can fire. */
export const MachineGunDeployment = defineComponent({
  deployed: Types.ui8,
  setupTicks: Types.ui16,
});

/** Tag - entity is a Total War Age mortar team (indirect-fire siege). */
export const MortarTag = defineComponent();

// ────────────────────────────────────────────────────────────────────────────
// Villager jobs: worksite helpers, work memory, huntable game
// ────────────────────────────────────────────────────────────────────────────

/**
 * Free villager helping at a completed worksite (src/sim/systems/worksite-helpers.ts).
 * He stays a free villager: any other order removes this component.
 * `extra` = 1 when he works beyond the crew slots (reduced rate), refreshed
 * by the worksite system every tick.
 */
export const WorksiteHelper = defineComponent({
  siteEid: Types.i32,
  extra: Types.ui8,
});

/** VillagerWork.job values. */
export const VillagerJobId = {
  NONE: 0,
  GATHER: 1,
  HUNT: 2,
  HELP: 3,
} as const;

/**
 * What a free villager last worked at, so he can go back to it after a build
 * order. The site is stored by NetId (never recycled), the spot as a position.
 */
export const VillagerWork = defineComponent({
  job: Types.ui8,
  kind: Types.ui8,
  siteNetId: Types.ui32,
  x: Types.f32,
  y: Types.f32,
});

/** Huntable animal species (GameAnimal.species). */
export const GameSpeciesId = {
  DEER: 0,
  BOAR: 1,
} as const;

/** GameAnimal.state values. */
export const GameAnimalStateId = {
  ALIVE: 0,
  CARCASS: 1,
} as const;

/**
 * Huntable game: a FOOD Resource node that wanders inside a leash around
 * `homeX/homeY` until a hunter reaches it, then lies still as a carcass.
 */
export const GameAnimal = defineComponent({
  species: Types.ui8,
  state: Types.ui8,
  homeX: Types.f32,
  homeY: Types.f32,
  targetX: Types.f32,
  targetY: Types.f32,
  /** Ticks to stand before picking the next wander point. */
  wait: Types.ui16,
});
