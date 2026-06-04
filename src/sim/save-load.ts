import {
  addComponent,
  hasComponent,
} from 'bitecs';
import { MAP } from '../config';
import {
  ArcherTag,
  AttackMoveGoal,
  AttackTarget,
  Building,
  BuildOrder,
  Combat,
  ConstructionSite,
  Cooldown,
  CannonTag,
  DeadTag,
  DropOff,
  FoundationTag,
  Gatherer,
  GunmanTag,
  Health,
  MachineGunDeployment,
  MachineGunTag,
  MilitiaTag,
  MortarTag,
  NetId,
  Owner,
  PathTarget,
  PopulationCost,
  Position,
  PrevPosition,
  Producer,
  Resource,
  ResourceCarry,
  ResourceWorksite,
  ScoutCavalryTag,
  Selected,
  Speed,
  SpearmanTag,
  TownCenterTag,
  UnitKind,
  UnitStance,
  UnitStanceId,
  Velocity,
  VillagerTag,
  WorksiteWorker,
} from './components';
import { AgeId } from './defs';
import type { MapFeature } from './map-gen';
import {
  AI_PLAYER_ID,
  createAiPlayerState,
  createVisibilityStates,
  normalizeAiDifficulty,
  type AiPlayerState,
  type AiDifficulty,
  type CampaignState,
  type LastSeenBuilding,
  LOCAL_PLAYER_ID,
  type MatchOutcome,
  type SimWorld,
  addSimEntity,
  createLateGameTestWorld,
  positionQuery,
  removeSimEntity,
  updatePlayerVisibility,
} from './world';
import { Pathfinder, type GridPos } from './pathfinding';
import {
  TECH_TREE,
  type TechIdValue,
  createStartingTechSetForAge,
} from './tech-tree';

export const SAVE_VERSION = 1;
export const LATE_GAME_TEST_SAVE_ID = 'late-game-test';

export interface SavedMapV1 {
  width: number;
  height: number;
  tiles: number[];
  elevation: number[];
  bridgePositions: Array<{ x: number; y: number }>;
  walkability: number[][];
  spawns: Array<{ x: number; y: number }>;
  features?: MapFeature[];
}

export interface SavedEntityV1 {
  id: number;
  netId?: number;
  position: { x: number; y: number };
  prevPosition?: { x: number; y: number };
  velocity?: { x: number; y: number };
  speed?: number;
  unitKind?: number;
  populationCost?: number;
  owner?: number;
  selected?: true;
  villager?: true;
  militia?: true;
  archer?: true;
  spearman?: true;
  scoutCavalry?: true;
  gunman?: true;
  cannon?: true;
  machineGun?: true;
  machineGunDeployment?: { deployed: number; setupTicks: number };
  mortar?: true;
  resource?: { kind: number; amount: number };
  resourceCarry?: { kind: number; amount: number };
  gatherer?: { targetEid: number; state: number; cooldown: number };
  dropOff?: { acceptsMask: number };
  townCenter?: true;
  building?: { defId: number };
  foundation?: true;
  constructionSite?: { defId: number; progress: number; totalTicks: number };
  buildOrder?: { targetEid: number };
  producer?: { currentProgress: number };
  resourceWorksite?: {
    kind: number;
    assignedWorkers: number;
    freeWorkersSpawned: number;
    progress: number;
  };
  worksiteWorker?: { siteEid: number };
  health?: { hp: number; hpMax: number; armor: number };
  combat?: { atk: number; range: number; attackSpeedTicks: number; aggroRadius: number };
  attackTarget?: { targetEid: number; retainGoal: number };
  attackMoveGoal?: { active: number; x: number; y: number };
  stance?: number;
  stanceAnchor?: { x: number; y: number };
  cooldown?: { ticksRemaining: number };
  pathTarget?: { x: number; y: number };
  dead?: true;
}

export interface SavedGameV1 {
  version: typeof SAVE_VERSION;
  label: string;
  savedAt: string;
  tick: number;
  /** Mulberry32 RNG state at save time. Required so a loaded/joined world
   *  reproduces the SAME future RNG draws (forest regrowth, AI tie-breaks,
   *  map gen). Lockstep join-snapshots and replays diverge without it.
   *  Optional for back-compat with v1 saves written before this field existed. */
  rngState?: number;
  nextNetId?: number;
  paused: boolean;
  aiDifficulty?: AiDifficulty;
  map: SavedMapV1;
  resources: number[][];
  population: Array<{ current: number; cap: number }>;
  ages: Array<{ current: number; progress: number; totalTicks: number }>;
  researchedTechs?: TechIdValue[][];
  revealedMapPlayers?: boolean[];
  outcome: MatchOutcome;
  entities: SavedEntityV1[];
  productionQueues: Array<{ eid: number; queue: number[] }>;
  armyRallyPoints?: Array<GridPos | null>;
  paths: Array<{ eid: number; waypoints: GridPos[] }>;
  aiPlayers?: Array<SavedAiPlayerStateV1 | null>;
  visibility?: Array<SavedVisibilityV1 | null>;
  campaign?: SavedCampaignV1 | null;
}

export interface SavedAiPlayerStateV1 {
  plan: AiPlayerState['plan'];
  nextAttackTick: number;
  lastAttackTick: number;
  stageStartedTick: number;
  rallyPoint: GridPos | null;
  lastAttackEventTick: number;
  lastDefenseEventTick: number;
}

export interface SavedVisibilityV1 {
  explored: number[];
  lastSeenBuildings: LastSeenBuilding[];
}

export interface SavedCampaignV1 {
  missionId: CampaignState['missionId'];
  name: string;
  description: string;
  briefing: string;
  lockedTechs: TechIdValue[];
  objectives: CampaignState['objectives'];
  trackedObjectiveEids: Record<string, number[]>;
  enemyAiMode: CampaignState['enemyAiMode'];
  nextReinforcementTick: number;
  scriptedWaveIndex?: number;
  scriptedWaveCount?: number;
}

export function serializeSimWorld(world: SimWorld, label = 'Manual Save'): SavedGameV1 {
  const entities: SavedEntityV1[] = [];
  for (const eid of positionQuery(world.ecs)) {
    const entity: SavedEntityV1 = {
      id: eid,
      position: { x: Position.x[eid], y: Position.y[eid] },
    };
    if (hasComponent(world.ecs, NetId, eid)) entity.netId = NetId.value[eid];
    if (hasComponent(world.ecs, PrevPosition, eid)) {
      entity.prevPosition = { x: PrevPosition.x[eid], y: PrevPosition.y[eid] };
    }
    if (hasComponent(world.ecs, Velocity, eid)) {
      entity.velocity = { x: Velocity.x[eid], y: Velocity.y[eid] };
    }
    if (hasComponent(world.ecs, Speed, eid)) entity.speed = Speed.value[eid];
    if (hasComponent(world.ecs, UnitKind, eid)) entity.unitKind = UnitKind.kind[eid];
    if (hasComponent(world.ecs, PopulationCost, eid)) entity.populationCost = PopulationCost.value[eid];
    if (hasComponent(world.ecs, Owner, eid)) entity.owner = Owner.player[eid];
    if (hasComponent(world.ecs, Selected, eid)) entity.selected = true;
    if (hasComponent(world.ecs, VillagerTag, eid)) entity.villager = true;
    if (hasComponent(world.ecs, MilitiaTag, eid)) entity.militia = true;
    if (hasComponent(world.ecs, ArcherTag, eid)) entity.archer = true;
    if (hasComponent(world.ecs, SpearmanTag, eid)) entity.spearman = true;
    if (hasComponent(world.ecs, ScoutCavalryTag, eid)) entity.scoutCavalry = true;
    if (hasComponent(world.ecs, GunmanTag, eid)) entity.gunman = true;
    if (hasComponent(world.ecs, CannonTag, eid)) entity.cannon = true;
    if (hasComponent(world.ecs, MachineGunTag, eid)) entity.machineGun = true;
    if (hasComponent(world.ecs, MortarTag, eid)) entity.mortar = true;
    if (hasComponent(world.ecs, MachineGunDeployment, eid)) {
      entity.machineGunDeployment = {
        deployed: MachineGunDeployment.deployed[eid],
        setupTicks: MachineGunDeployment.setupTicks[eid],
      };
    }
    if (hasComponent(world.ecs, Resource, eid)) {
      entity.resource = { kind: Resource.kind[eid], amount: Resource.amount[eid] };
    }
    if (hasComponent(world.ecs, ResourceCarry, eid)) {
      entity.resourceCarry = {
        kind: ResourceCarry.kind[eid],
        amount: ResourceCarry.amount[eid],
      };
    }
    if (hasComponent(world.ecs, Gatherer, eid)) {
      entity.gatherer = {
        targetEid: Gatherer.targetEid[eid],
        state: Gatherer.state[eid],
        cooldown: Gatherer.cooldown[eid],
      };
    }
    if (hasComponent(world.ecs, DropOff, eid)) {
      entity.dropOff = { acceptsMask: DropOff.acceptsMask[eid] };
    }
    if (hasComponent(world.ecs, TownCenterTag, eid)) entity.townCenter = true;
    if (hasComponent(world.ecs, Building, eid)) entity.building = { defId: Building.defId[eid] };
    if (hasComponent(world.ecs, FoundationTag, eid)) entity.foundation = true;
    if (hasComponent(world.ecs, ConstructionSite, eid)) {
      entity.constructionSite = {
        defId: ConstructionSite.defId[eid],
        progress: ConstructionSite.progress[eid],
        totalTicks: ConstructionSite.totalTicks[eid],
      };
    }
    if (hasComponent(world.ecs, BuildOrder, eid)) {
      entity.buildOrder = { targetEid: BuildOrder.targetEid[eid] };
    }
    if (hasComponent(world.ecs, Producer, eid)) {
      entity.producer = { currentProgress: Producer.currentProgress[eid] };
    }
    if (hasComponent(world.ecs, ResourceWorksite, eid)) {
      entity.resourceWorksite = {
        kind: ResourceWorksite.kind[eid],
        assignedWorkers: ResourceWorksite.assignedWorkers[eid],
        freeWorkersSpawned: ResourceWorksite.freeWorkersSpawned[eid],
        progress: ResourceWorksite.progress[eid],
      };
    }
    if (hasComponent(world.ecs, WorksiteWorker, eid)) {
      entity.worksiteWorker = { siteEid: WorksiteWorker.siteEid[eid] };
    }
    if (hasComponent(world.ecs, Health, eid)) {
      entity.health = {
        hp: Health.hp[eid],
        hpMax: Health.hpMax[eid],
        armor: Health.armor[eid],
      };
    }
    if (hasComponent(world.ecs, Combat, eid)) {
      entity.combat = {
        atk: Combat.atk[eid],
        range: Combat.range[eid],
        attackSpeedTicks: Combat.attackSpeedTicks[eid],
        aggroRadius: Combat.aggroRadius[eid],
      };
    }
    if (hasComponent(world.ecs, AttackTarget, eid)) {
      entity.attackTarget = {
        targetEid: AttackTarget.targetEid[eid],
        retainGoal: AttackTarget.retainGoal[eid],
      };
    }
    if (hasComponent(world.ecs, AttackMoveGoal, eid)) {
      entity.attackMoveGoal = {
        active: AttackMoveGoal.active[eid],
        x: AttackMoveGoal.x[eid],
        y: AttackMoveGoal.y[eid],
      };
    }
    if (hasComponent(world.ecs, UnitStance, eid)) {
      entity.stance = UnitStance.stance[eid];
      entity.stanceAnchor = {
        x: UnitStance.anchorX[eid],
        y: UnitStance.anchorY[eid],
      };
    }
    if (hasComponent(world.ecs, Cooldown, eid)) {
      entity.cooldown = { ticksRemaining: Cooldown.ticksRemaining[eid] };
    }
    if (hasComponent(world.ecs, PathTarget, eid)) {
      entity.pathTarget = { x: PathTarget.x[eid], y: PathTarget.y[eid] };
    }
    if (hasComponent(world.ecs, DeadTag, eid)) entity.dead = true;
    entities.push(entity);
  }

  return {
    version: SAVE_VERSION,
    label,
    savedAt: new Date().toISOString(),
    tick: world.tick,
    rngState: world.rng.getState(),
    nextNetId: world.nextNetId,
    paused: world.paused,
    aiDifficulty: world.aiDifficulty,
    map: {
      width: MAP.WIDTH,
      height: MAP.HEIGHT,
      tiles: Array.from(world.map.tiles),
      elevation: Array.from(world.map.elevation),
      bridgePositions: world.map.bridgePositions.map((p) => ({ ...p })),
      walkability: world.map.walkability.map((row) => row.slice()),
      spawns: world.map.spawns.map((p) => ({ ...p })),
      features: world.map.features.map((feature) => ({ ...feature })),
    },
    resources: world.resources.map((bank) => Array.from(bank)),
    population: world.population.map((p) => ({ ...p })),
    ages: world.ages.map((age) => ({ ...age })),
    researchedTechs: world.researchedTechs.map((set) => Array.from(set)),
    revealedMapPlayers: world.revealedMapPlayers.slice(),
    outcome: { ...world.outcome },
    entities,
    productionQueues: Array.from(world.productionQueues.entries()).map(([eid, queue]) => ({
      eid,
      queue: queue.slice(),
    })),
    armyRallyPoints: world.armyRallyPoints.map((point) => point ? { ...point } : null),
    paths: Array.from(world.paths.entries()).map(([eid, waypoints]) => ({
      eid,
      waypoints: waypoints.map((p) => ({ ...p })),
    })),
    aiPlayers: world.aiPlayers.map((state) => state ? {
      plan: state.plan,
      nextAttackTick: state.nextAttackTick,
      lastAttackTick: Number.isFinite(state.lastAttackTick) ? state.lastAttackTick : -1,
      stageStartedTick: state.stageStartedTick,
      rallyPoint: state.rallyPoint ? { ...state.rallyPoint } : null,
      lastAttackEventTick: Number.isFinite(state.lastAttackEventTick) ? state.lastAttackEventTick : -1,
      lastDefenseEventTick: Number.isFinite(state.lastDefenseEventTick) ? state.lastDefenseEventTick : -1,
    } : null),
    visibility: world.visibility.map((vis) => vis ? {
      explored: Array.from(vis.explored),
      lastSeenBuildings: Array.from(vis.lastSeenBuildings.values()).map((snap) => ({ ...snap })),
    } : null),
    campaign: world.campaign ? {
      missionId: world.campaign.missionId,
      name: world.campaign.name,
      description: world.campaign.description,
      briefing: world.campaign.briefing,
      lockedTechs: world.campaign.lockedTechs.slice(),
      objectives: world.campaign.objectives.map((objective) => ({ ...objective })),
      trackedObjectiveEids: Object.fromEntries(
        Object.entries(world.campaign.trackedObjectiveEids)
          .map(([id, eids]) => [id, eids.slice()])
      ),
      enemyAiMode: world.campaign.enemyAiMode,
      nextReinforcementTick: world.campaign.nextReinforcementTick,
      scriptedWaveIndex: world.campaign.scriptedWaveIndex,
      scriptedWaveCount: world.campaign.scriptedWaveCount,
    } : null,
  };
}

export function loadSimWorldSnapshot(world: SimWorld, snapshot: SavedGameV1): void {
  if (snapshot.version !== SAVE_VERSION) {
    throw new Error(`Unsupported save version ${snapshot.version}`);
  }

  for (const eid of [...positionQuery(world.ecs)]) {
    removeSimEntity(world, eid);
  }

  world.tick = snapshot.tick;
  world.nextNetId = 1;
  world.netIdToEid.clear();
  if (snapshot.rngState !== undefined) {
    world.rng.setState(snapshot.rngState);
  }
  world.inputs.length = 0;
  world.combatEvents.length = 0;
  world.cannonWindups.clear();
  world.pendingProjectileImpacts.length = 0;
  world.pendingCannonImpacts.length = 0;
  world.aiEvents.length = 0;
  world.soundCues.length = 0;
  world.paused = snapshot.paused;
  world.humanPlayers = new Set([LOCAL_PLAYER_ID]);
  world.aiDifficulty = normalizeAiDifficulty(snapshot.aiDifficulty);
  world.outcome = { ...snapshot.outcome };
  world.campaign = null;
  world.map = {
    tiles: Uint8Array.from(snapshot.map.tiles),
    elevation: Uint8Array.from(snapshot.map.elevation),
    bridgePositions: snapshot.map.bridgePositions.map((p) => ({ ...p })),
    walkability: snapshot.map.walkability.map((row) => row.slice()),
    spawns: snapshot.map.spawns.map((p) => ({ ...p })),
    features: (snapshot.map.features ?? []).map((feature) => ({ ...feature })),
  };
  world.grid = world.map.walkability;
  world.pathfinder = new Pathfinder(world.grid);

  world.resources.length = 0;
  for (const bank of snapshot.resources) {
    world.resources.push(Int32Array.from(bank));
  }
  world.population.length = 0;
  for (const pop of snapshot.population) {
    world.population.push({ ...pop });
  }
  world.ages.length = 0;
  for (const age of snapshot.ages) {
    world.ages.push({ ...age });
  }
  world.aiPlayers.length = 0;
  for (let playerId = 0; playerId < snapshot.resources.length; playerId++) {
    const savedAi = snapshot.aiPlayers?.[playerId];
    if (savedAi) {
      world.aiPlayers.push({
        ...createAiPlayerState(snapshot.tick, world.aiDifficulty),
        plan: savedAi.plan,
        nextAttackTick: savedAi.nextAttackTick,
        lastAttackTick: savedAi.lastAttackTick,
        stageStartedTick: savedAi.stageStartedTick,
        rallyPoint: savedAi.rallyPoint ? { ...savedAi.rallyPoint } : null,
        waveUnitEids: [],
        lastAttackEventTick: savedAi.lastAttackEventTick,
        lastDefenseEventTick: savedAi.lastDefenseEventTick,
      });
    } else {
      world.aiPlayers.push(playerId === AI_PLAYER_ID ? createAiPlayerState(snapshot.tick, world.aiDifficulty) : null);
    }
  }
  world.researchedTechs.length = 0;
  for (let playerId = 0; playerId < world.resources.length; playerId++) {
    const saved = snapshot.researchedTechs?.[playerId];
    if (Array.isArray(saved)) {
      world.researchedTechs.push(
        new Set(saved.filter((techId): techId is TechIdValue => isKnownTechId(techId)))
      );
    } else {
      world.researchedTechs.push(fallbackTechSet(snapshot, playerId));
    }
  }
  world.revealedMapPlayers.length = 0;
  for (let playerId = 0; playerId < world.resources.length; playerId++) {
    world.revealedMapPlayers.push(Boolean(snapshot.revealedMapPlayers?.[playerId]));
  }

  const eidMap = new Map<number, number>();
  let maxRestoredNetId = 0;
  for (const saved of snapshot.entities) {
    const eid = addSimEntity(world);
    if (saved.netId !== undefined) {
      world.netIdToEid.delete(NetId.value[eid]);
      NetId.value[eid] = saved.netId;
      world.netIdToEid.set(saved.netId, eid);
      maxRestoredNetId = Math.max(maxRestoredNetId, saved.netId);
    }
    eidMap.set(saved.id, eid);
    addComponent(world.ecs, Position, eid);
    Position.x[eid] = saved.position.x;
    Position.y[eid] = saved.position.y;
    restoreEntityComponents(world, eid, saved);
  }
  world.nextNetId = snapshot.nextNetId ?? (maxRestoredNetId > 0 ? maxRestoredNetId + 1 : world.nextNetId);

  for (const saved of snapshot.entities) {
    const eid = eidMap.get(saved.id);
    if (eid === undefined) continue;
    restoreEntityReferences(eid, saved, eidMap);
  }

  if (snapshot.campaign) {
    world.campaign = {
      missionId: snapshot.campaign.missionId,
      name: snapshot.campaign.name,
      description: snapshot.campaign.description,
      briefing: snapshot.campaign.briefing,
      lockedTechs: snapshot.campaign.lockedTechs.slice(),
      objectives: snapshot.campaign.objectives.map((objective) => ({ ...objective })),
      trackedObjectiveEids: Object.fromEntries(
        Object.entries(snapshot.campaign.trackedObjectiveEids)
          .map(([id, eids]) => [
            id,
            eids
              .map((eid) => eidMap.get(eid))
              .filter((eid): eid is number => eid !== undefined),
          ])
      ),
      enemyAiMode: snapshot.campaign.enemyAiMode,
      nextReinforcementTick: snapshot.campaign.nextReinforcementTick,
      scriptedWaveIndex: snapshot.campaign.scriptedWaveIndex,
      scriptedWaveCount: snapshot.campaign.scriptedWaveCount,
    };
  }

  world.productionQueues.clear();
  for (const savedQueue of snapshot.productionQueues) {
    const eid = eidMap.get(savedQueue.eid);
    if (eid === undefined) continue;
    world.productionQueues.set(eid, savedQueue.queue.slice());
  }

  world.armyRallyPoints.length = 0;
  for (let playerId = 0; playerId < world.resources.length; playerId++) {
    const point = snapshot.armyRallyPoints?.[playerId];
    world.armyRallyPoints.push(point ? { ...point } : null);
  }

  world.paths.clear();
  world.movementStuck.clear();
  for (const savedPath of snapshot.paths) {
    const eid = eidMap.get(savedPath.eid);
    if (eid === undefined) continue;
    world.paths.set(eid, savedPath.waypoints.map((p) => ({ ...p })));
  }

  restoreVisibility(world, snapshot, eidMap);
}

export function parseSavedGame(text: string): SavedGameV1 | null {
  try {
    const parsed = JSON.parse(text) as Partial<SavedGameV1>;
    if (parsed.version !== SAVE_VERSION) return null;
    if (!Array.isArray(parsed.entities) || !parsed.map) return null;
    return parsed as SavedGameV1;
  } catch {
    return null;
  }
}

export function createLateGameTestSave(): SavedGameV1 {
  return serializeSimWorld(createLateGameTestWorld(), 'Late Game Test');
}

const KNOWN_TECH_IDS = new Set<string>(TECH_TREE.map((tech) => tech.id));

function isKnownTechId(techId: unknown): techId is TechIdValue {
  return typeof techId === 'string' && KNOWN_TECH_IDS.has(techId);
}

function fallbackTechSet(snapshot: SavedGameV1, playerId: number): Set<TechIdValue> {
  return createStartingTechSetForAge(snapshot.ages[playerId]?.current ?? AgeId.DARK);
}

function isSavedMilitaryEntity(saved: SavedEntityV1): boolean {
  return Boolean(
    saved.archer ||
      saved.spearman ||
      saved.scoutCavalry ||
      saved.gunman ||
      saved.cannon ||
      saved.machineGun ||
      saved.mortar
  );
}

function restoreEntityComponents(world: SimWorld, eid: number, saved: SavedEntityV1): void {
  const { ecs } = world;
  if (saved.prevPosition) {
    addComponent(ecs, PrevPosition, eid);
    PrevPosition.x[eid] = saved.prevPosition.x;
    PrevPosition.y[eid] = saved.prevPosition.y;
  }
  if (saved.velocity) {
    addComponent(ecs, Velocity, eid);
    Velocity.x[eid] = saved.velocity.x;
    Velocity.y[eid] = saved.velocity.y;
  }
  if (saved.speed !== undefined) {
    addComponent(ecs, Speed, eid);
    Speed.value[eid] = saved.speed;
  }
  if (saved.unitKind !== undefined) {
    addComponent(ecs, UnitKind, eid);
    UnitKind.kind[eid] = saved.unitKind;
  }
  if (saved.populationCost !== undefined) {
    addComponent(ecs, PopulationCost, eid);
    PopulationCost.value[eid] = saved.populationCost;
  }
  if (saved.owner !== undefined) {
    addComponent(ecs, Owner, eid);
    Owner.player[eid] = saved.owner;
  }
  if (saved.selected) addComponent(ecs, Selected, eid);
  if (saved.villager) addComponent(ecs, VillagerTag, eid);
  if (saved.militia) addComponent(ecs, MilitiaTag, eid);
  if (saved.archer) addComponent(ecs, ArcherTag, eid);
  if (saved.spearman) addComponent(ecs, SpearmanTag, eid);
  if (saved.scoutCavalry) addComponent(ecs, ScoutCavalryTag, eid);
  if (saved.gunman) addComponent(ecs, GunmanTag, eid);
  if (saved.cannon) addComponent(ecs, CannonTag, eid);
  if (saved.machineGun) addComponent(ecs, MachineGunTag, eid);
  if (saved.mortar) addComponent(ecs, MortarTag, eid);
  if (saved.machineGunDeployment || saved.machineGun) {
    addComponent(ecs, MachineGunDeployment, eid);
    MachineGunDeployment.deployed[eid] = saved.machineGunDeployment?.deployed ?? 1;
    MachineGunDeployment.setupTicks[eid] = saved.machineGunDeployment?.setupTicks ?? 0;
  }
  if (isSavedMilitaryEntity(saved)) {
    addComponent(ecs, UnitStance, eid);
    UnitStance.stance[eid] =
      saved.stance === UnitStanceId.HOLD_POSITION
        ? UnitStanceId.HOLD_POSITION
        : UnitStanceId.AUTO_DEFEND;
    UnitStance.anchorX[eid] = saved.stanceAnchor?.x ?? saved.position.x;
    UnitStance.anchorY[eid] = saved.stanceAnchor?.y ?? saved.position.y;
  }
  if (saved.resource) {
    addComponent(ecs, Resource, eid);
    Resource.kind[eid] = saved.resource.kind;
    Resource.amount[eid] = saved.resource.amount;
  }
  if (saved.resourceCarry) {
    addComponent(ecs, ResourceCarry, eid);
    ResourceCarry.kind[eid] = saved.resourceCarry.kind;
    ResourceCarry.amount[eid] = saved.resourceCarry.amount;
  }
  if (saved.gatherer) {
    addComponent(ecs, Gatherer, eid);
    Gatherer.state[eid] = saved.gatherer.state;
    Gatherer.cooldown[eid] = saved.gatherer.cooldown;
  }
  if (saved.dropOff) {
    addComponent(ecs, DropOff, eid);
    DropOff.acceptsMask[eid] = saved.dropOff.acceptsMask;
  }
  if (saved.townCenter) addComponent(ecs, TownCenterTag, eid);
  if (saved.building) {
    addComponent(ecs, Building, eid);
    Building.defId[eid] = saved.building.defId;
  }
  if (saved.foundation) addComponent(ecs, FoundationTag, eid);
  if (saved.constructionSite) {
    addComponent(ecs, ConstructionSite, eid);
    ConstructionSite.defId[eid] = saved.constructionSite.defId;
    ConstructionSite.progress[eid] = saved.constructionSite.progress;
    ConstructionSite.totalTicks[eid] = saved.constructionSite.totalTicks;
  }
  if (saved.buildOrder) {
    addComponent(ecs, BuildOrder, eid);
  }
  if (saved.producer) {
    addComponent(ecs, Producer, eid);
    Producer.currentProgress[eid] = saved.producer.currentProgress;
  }
  if (saved.resourceWorksite) {
    addComponent(ecs, ResourceWorksite, eid);
    ResourceWorksite.kind[eid] = saved.resourceWorksite.kind;
    ResourceWorksite.assignedWorkers[eid] = saved.resourceWorksite.assignedWorkers;
    ResourceWorksite.freeWorkersSpawned[eid] = saved.resourceWorksite.freeWorkersSpawned;
    ResourceWorksite.progress[eid] = saved.resourceWorksite.progress;
  }
  if (saved.worksiteWorker) {
    addComponent(ecs, WorksiteWorker, eid);
  }
  if (saved.health) {
    addComponent(ecs, Health, eid);
    Health.hp[eid] = saved.health.hp;
    Health.hpMax[eid] = saved.health.hpMax;
    Health.armor[eid] = saved.health.armor;
  }
  if (saved.combat) {
    addComponent(ecs, Combat, eid);
    Combat.atk[eid] = saved.combat.atk;
    Combat.range[eid] = saved.combat.range;
    Combat.attackSpeedTicks[eid] = saved.combat.attackSpeedTicks;
    Combat.aggroRadius[eid] = saved.combat.aggroRadius;
  }
  if (saved.attackTarget) {
    addComponent(ecs, AttackTarget, eid);
    AttackTarget.retainGoal[eid] = saved.attackTarget.retainGoal;
  }
  if (saved.attackMoveGoal) {
    addComponent(ecs, AttackMoveGoal, eid);
    AttackMoveGoal.active[eid] = saved.attackMoveGoal.active;
    AttackMoveGoal.x[eid] = saved.attackMoveGoal.x;
    AttackMoveGoal.y[eid] = saved.attackMoveGoal.y;
  }
  if (saved.cooldown) {
    addComponent(ecs, Cooldown, eid);
    Cooldown.ticksRemaining[eid] = saved.cooldown.ticksRemaining;
  }
  if (saved.pathTarget) {
    addComponent(ecs, PathTarget, eid);
    PathTarget.x[eid] = saved.pathTarget.x;
    PathTarget.y[eid] = saved.pathTarget.y;
  }
  if (saved.dead) addComponent(ecs, DeadTag, eid);
}

function restoreEntityReferences(
  eid: number,
  saved: SavedEntityV1,
  eidMap: Map<number, number>
): void {
  if (saved.gatherer) {
    Gatherer.targetEid[eid] = remapEid(saved.gatherer.targetEid, eidMap);
  }
  if (saved.buildOrder) {
    BuildOrder.targetEid[eid] = remapEid(saved.buildOrder.targetEid, eidMap);
  }
  if (saved.worksiteWorker) {
    WorksiteWorker.siteEid[eid] = remapEid(saved.worksiteWorker.siteEid, eidMap);
  }
  if (saved.attackTarget) {
    AttackTarget.targetEid[eid] = remapEid(saved.attackTarget.targetEid, eidMap);
  }
}

function remapEid(savedEid: number, eidMap: Map<number, number>): number {
  if (savedEid < 0) return -1;
  return eidMap.get(savedEid) ?? -1;
}

function restoreVisibility(
  world: SimWorld,
  snapshot: SavedGameV1,
  eidMap: Map<number, number>
): void {
  const next = createVisibilityStates();
  for (let playerId = 0; playerId < next.length; playerId++) {
    const saved = snapshot.visibility?.[playerId];
    if (!saved) continue;
    const vis = next[playerId];
    const max = Math.min(vis.explored.length, saved.explored.length);
    for (let i = 0; i < max; i++) {
      vis.explored[i] = saved.explored[i] ? 1 : 0;
    }
    for (const snap of saved.lastSeenBuildings) {
      const remappedEid = remapEid(snap.eid, eidMap);
      vis.lastSeenBuildings.set(remappedEid, {
        ...snap,
        eid: remappedEid,
      });
    }
  }
  world.visibility = next;
  updatePlayerVisibility(world, LOCAL_PLAYER_ID);
}
