/**
 * Snapshot a live SimWorld into a JSON-safe SavedGame.
 */

import { hasComponent } from 'bitecs';
import { MAP } from '../../config';
import {
  ArcherTag,
  AttackMoveGoal,
  AttackTarget,
  BuildOrder,
  Building,
  CannonTag,
  Combat,
  ConstructionSite,
  Cooldown,
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
  SpearmanTag,
  Speed,
  TownCenterTag,
  UnitKind,
  UnitStance,
  Velocity,
  VillagerTag,
  WorksiteWorker,
} from '../components';
import { type SimWorld, createLateGameTestWorld, positionQuery } from '../world';
import { SAVE_VERSION, type SavedEntityV1, type SavedGame } from './schema';

export function serializeSimWorld(world: SimWorld, label = 'Manual Save'): SavedGame {
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
    humanPlayers: [...world.humanPlayers],
    formationModes: world.formationModes.slice(),
    formationFacings: world.formationFacings.slice(),
    outcome: { ...world.outcome },
    matchStats: world.matchStats.map((stats) => ({ ...stats, gathered: [...stats.gathered] })),
    mapSeed: world.mapSeed,
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
    movementStuck: Array.from(world.movementStuck.entries()).map(([eid, state]) => ({
      eid,
      lastDist: state.lastDist,
      waypointX: state.waypointX,
      waypointY: state.waypointY,
      noProgressTicks: state.noProgressTicks,
      cooldownTicks: state.cooldownTicks,
      attempts: state.attempts,
    })),
    formationSpeedCaps: Array.from(world.formationSpeedCaps.entries()).map(([eid, speedCap]) => ({
      eid,
      speedCap,
    })),
    cannonWindups: Array.from(world.cannonWindups.entries()).map(([attackerEid, windup]) => ({
      attackerEid,
      targetEid: windup.targetEid,
      ticksRemaining: windup.ticksRemaining,
    })),
    pendingProjectileImpacts: world.pendingProjectileImpacts.map((impact) => ({ ...impact })),
    pendingCannonImpacts: world.pendingCannonImpacts.map((impact) => ({ ...impact })),
    aiPlayers: world.aiPlayers.map((state) => state ? {
      plan: state.plan,
      nextAttackTick: state.nextAttackTick,
      lastAttackTick: Number.isFinite(state.lastAttackTick) ? state.lastAttackTick : -1,
      stageStartedTick: state.stageStartedTick,
      rallyPoint: state.rallyPoint ? { ...state.rallyPoint } : null,
      waveUnitEids: state.waveUnitEids.slice(),
      lastAttackEventTick: Number.isFinite(state.lastAttackEventTick) ? state.lastAttackEventTick : -1,
      lastDefenseEventTick: Number.isFinite(state.lastDefenseEventTick) ? state.lastDefenseEventTick : -1,
      ...(state.difficulty ? { difficulty: state.difficulty } : {}),
    } : null),
    visibility: world.visibility.map((vis) => vis ? {
      visible: Array.from(vis.visible),
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
      zborovLinesTaken: world.campaign.zborovLinesTaken,
      zborovForwardY: world.campaign.zborovForwardY,
    } : null,
  };
}

export function createLateGameTestSave(): SavedGame {
  return serializeSimWorld(createLateGameTestWorld(), 'Late Game Test');
}
