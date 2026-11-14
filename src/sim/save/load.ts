/**
 * Rebuild a SimWorld from a SavedGame (older versions are migrated first): entities, components, eid references and fog.
 */

import { addComponent } from 'bitecs';
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
  UnitStanceId,
  Velocity,
  VillagerTag,
  WorksiteWorker,
} from '../components';
import { AgeId } from '../defs';
import {
  AI_PLAYER_ID,
  LOCAL_PLAYER_ID,
  type SimWorld,
  addSimEntity,
  createAiPlayerState,
  createVisibilityStates,
  normalizeAiDifficulty,
  positionQuery,
  removeSimEntity,
  updatePlayerVisibility,
} from '../world';
import { Pathfinder } from '../pathfinding';
import { TECH_TREE, type TechIdValue, createStartingTechSetForAge } from '../tech-tree';
import { type SavedEntityV1, type SavedGame, type SavedGameV1, type SavedGameV2, migrateSavedGame } from './schema';

/** Ticks are never negative; a negative (or missing) saved tick means never. */
function fromSavedTick(tick: number | null | undefined): number {
  return typeof tick === 'number' && Number.isFinite(tick) && tick >= 0 ? tick : -Infinity;
}

export function loadSimWorldSnapshot(world: SimWorld, saved: SavedGame | SavedGameV2 | SavedGameV1): void {
  const snapshot = migrateSavedGame(saved);
  if (!snapshot) {
    throw new Error(`Unsupported save version ${String((saved as { version?: unknown }).version)}`);
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
  world.gameEvents.length = 0;
  world.killingBlows.clear();
  world.matchStats = snapshot.matchStats.map((stats) => ({ ...stats, gathered: [...stats.gathered] }));
  world.mapSeed = snapshot.mapSeed;
  world.paused = snapshot.paused;
  world.humanPlayers = new Set(
    (snapshot.humanPlayers ?? [LOCAL_PLAYER_ID])
      .filter((playerId) => Number.isInteger(playerId) && playerId > 0)
  );
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
        // Saves store "never" (-Infinity) as -1; restore it, the AI's
        // cooldown checks treat the two differently.
        lastAttackTick: fromSavedTick(savedAi.lastAttackTick),
        stageStartedTick: savedAi.stageStartedTick,
        rallyPoint: savedAi.rallyPoint ? { ...savedAi.rallyPoint } : null,
        waveUnitEids: [],
        lastAttackEventTick: fromSavedTick(savedAi.lastAttackEventTick),
        lastDefenseEventTick: fromSavedTick(savedAi.lastDefenseEventTick),
        ...(savedAi.difficulty ? { difficulty: normalizeAiDifficulty(savedAi.difficulty) } : {}),
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
  const fallbackFormationModes = world.formationModes.slice();
  const savedFormationModes = snapshot.formationModes ?? fallbackFormationModes;
  world.formationModes.length = 0;
  for (let i = 0; i < savedFormationModes.length; i++) {
    world.formationModes.push(savedFormationModes[i] ?? fallbackFormationModes[i] ?? 0);
  }
  const fallbackFormationFacings = world.formationFacings.slice();
  const savedFormationFacings = snapshot.formationFacings ?? fallbackFormationFacings;
  world.formationFacings.length = 0;
  for (let i = 0; i < savedFormationFacings.length; i++) {
    world.formationFacings.push(savedFormationFacings[i] ?? fallbackFormationFacings[i] ?? 0);
  }

  const eidMap = new Map<number, number>();
  let maxRestoredNetId = 0;
  // Hand out temporary NetIds above every saved one: a temporary id equal to
  // a NetId restored earlier in this loop would overwrite that entity's
  // netIdToEid entry and the override below would then delete it.
  for (const saved of snapshot.entities) {
    if (saved.netId !== undefined) maxRestoredNetId = Math.max(maxRestoredNetId, saved.netId);
  }
  world.nextNetId = maxRestoredNetId + 1;
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
      zborovLinesTaken: snapshot.campaign.zborovLinesTaken,
      zborovForwardY: snapshot.campaign.zborovForwardY,
    };
  }

  for (let playerId = 0; playerId < world.aiPlayers.length; playerId++) {
    const ai = world.aiPlayers[playerId];
    const savedAi = snapshot.aiPlayers?.[playerId];
    if (!ai || !savedAi?.waveUnitEids) continue;
    ai.waveUnitEids = savedAi.waveUnitEids
      .map((eid) => eidMap.get(eid))
      .filter((eid): eid is number => eid !== undefined);
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
  for (const saved of snapshot.movementStuck ?? []) {
    const eid = eidMap.get(saved.eid);
    if (eid === undefined) continue;
    world.movementStuck.set(eid, {
      lastDist: saved.lastDist,
      waypointX: saved.waypointX,
      waypointY: saved.waypointY,
      noProgressTicks: saved.noProgressTicks,
      cooldownTicks: saved.cooldownTicks,
      attempts: saved.attempts,
    });
  }

  world.formationSpeedCaps.clear();
  for (const saved of snapshot.formationSpeedCaps ?? []) {
    const eid = eidMap.get(saved.eid);
    if (eid === undefined) continue;
    world.formationSpeedCaps.set(eid, saved.speedCap);
  }

  world.cannonWindups.clear();
  for (const saved of snapshot.cannonWindups ?? []) {
    const attackerEid = eidMap.get(saved.attackerEid);
    const targetEid = eidMap.get(saved.targetEid);
    if (attackerEid === undefined || targetEid === undefined) continue;
    world.cannonWindups.set(attackerEid, {
      targetEid,
      ticksRemaining: saved.ticksRemaining,
    });
  }

  world.pendingProjectileImpacts.length = 0;
  for (const saved of snapshot.pendingProjectileImpacts ?? []) {
    const attackerEid = eidMap.get(saved.attackerEid);
    const targetEid = eidMap.get(saved.targetEid);
    if (attackerEid === undefined || targetEid === undefined) continue;
    world.pendingProjectileImpacts.push({
      impactTick: saved.impactTick,
      attackerEid,
      attackerOwner: saved.attackerOwner,
      targetEid,
      damage: saved.damage,
    });
  }

  world.pendingCannonImpacts.length = 0;
  for (const saved of snapshot.pendingCannonImpacts ?? []) {
    const attackerEid = eidMap.get(saved.attackerEid);
    if (attackerEid === undefined) continue;
    world.pendingCannonImpacts.push({
      impactTick: saved.impactTick,
      attackerEid,
      attackerOwner: saved.attackerOwner,
      impactX: saved.impactX,
      impactY: saved.impactY,
      damage: saved.damage,
    });
  }

  restoreVisibility(world, snapshot, eidMap);
}

const KNOWN_TECH_IDS = new Set<string>(TECH_TREE.map((tech) => tech.id));

function isKnownTechId(techId: unknown): techId is TechIdValue {
  return typeof techId === 'string' && KNOWN_TECH_IDS.has(techId);
}

function fallbackTechSet(snapshot: SavedGame, playerId: number): Set<TechIdValue> {
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
  // Villagers carry a stance too (spawned with it): restore it whenever it was
  // saved, so a reloaded world hashes like the one that was saved.
  if (saved.stance !== undefined || isSavedMilitaryEntity(saved)) {
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
  snapshot: SavedGame,
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
    if (saved.visible) {
      const visibleMax = Math.min(vis.visible.length, saved.visible.length);
      for (let i = 0; i < visibleMax; i++) {
        vis.visible[i] = saved.visible[i] ? 1 : 0;
      }
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
  for (const playerId of world.humanPlayers) {
    updatePlayerVisibility(world, playerId);
  }
}
