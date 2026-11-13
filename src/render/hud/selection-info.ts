/**
 * Read-only selection queries for the DOM HUD: the portrait panel summary,
 * the one-line status (gathering / training / waiting for peer) and small
 * naming helpers shared with input feedback messages.
 */

import { hasComponent } from 'bitecs';
import { SIM } from '../../config';
import {
  ArcherTag,
  Building,
  CannonTag,
  Combat,
  ConstructionSite,
  Gatherer,
  GathererStateId,
  GunmanTag,
  Health,
  MachineGunDeployment,
  MachineGunTag,
  MortarTag,
  Owner,
  Producer,
  ResourceCarry,
  ResourceKindId,
  ResourceWorksite,
  ScoutCavalryTag,
  Speed,
  SpearmanTag,
  TownCenterTag,
  VillagerTag,
} from '@sim/components';
import { BUILDING_TABLE, BuildingDefId, getUnitDef } from '@sim/defs';
import {
  getBuildingPopProvided,
  getWorksiteWorkerSlots,
  selectedQuery,
  type SimWorld,
} from '@sim/world';
import type { SceneContext } from '../scene-context';

export type SelectionKind =
  | 'villager'
  | 'archer'
  | 'spearman'
  | 'scoutCavalry'
  | 'gunman'
  | 'cannon'
  | 'machineGun'
  | 'mortar'
  | 'tc'
  | 'house'
  | 'farm'
  | 'mill'
  | 'lumberCamp'
  | 'goldMine'
  | 'stoneQuarry'
  | 'barracks'
  | 'archeryRange'
  | 'stable'
  | 'foundry'
  | 'defensiveTower'
  | 'foundation'
  | 'mixed'
  | 'none';

export interface SelectionInfo {
  kind: SelectionKind;
  name: string;
  glyph: string;
  hp: number;
  hpMax: number;
  count: number;
  team: number;
  stats: string;
}

const NAME_BY_KIND: Record<string, string> = {
  villager: 'Villager',
  archer: 'Archer',
  spearman: 'Pikeman',
  scoutCavalry: 'Scout Cavalry',
  gunman: 'Gunman',
  cannon: 'Field Cannon',
  machineGun: 'Machine Gun',
  mortar: 'Mortar Team',
  tc: 'Town Center',
  house: 'House',
  farm: 'Farm',
  mill: 'Mill',
  lumberCamp: 'Lumber Camp',
  goldMine: 'Gold Mine',
  stoneQuarry: 'Stone Quarry',
  barracks: 'Barracks',
  archeryRange: 'Archery Range',
  stable: 'Stable',
  foundry: 'Foundry',
  defensiveTower: 'Defensive Tower',
  foundation: 'Foundation',
  mixed: 'Mixed Selection',
};

const GLYPH_BY_KIND: Record<string, string> = {
  villager: '🧑',
  archer: '🏹',
  spearman: '♜',
  scoutCavalry: '♞',
  gunman: '•',
  cannon: '●',
  machineGun: '▰',
  mortar: '◤',
  tc: '🏰',
  house: '🏠',
  farm: '🌾',
  mill: '◈',
  lumberCamp: '🪵',
  goldMine: '⛏',
  stoneQuarry: '▣',
  barracks: '⚒',
  archeryRange: '🏹',
  stable: '♞',
  foundry: '●',
  defensiveTower: '♜',
  foundation: '🪜',
  mixed: '⊞',
};

const BUILDING_KIND_BY_DEF: Partial<Record<number, SelectionKind>> = {
  [BuildingDefId.HOUSE]: 'house',
  [BuildingDefId.FARM]: 'farm',
  [BuildingDefId.MILL]: 'mill',
  [BuildingDefId.LUMBER_CAMP]: 'lumberCamp',
  [BuildingDefId.GOLD_MINE]: 'goldMine',
  [BuildingDefId.STONE_QUARRY]: 'stoneQuarry',
  [BuildingDefId.BARRACKS]: 'barracks',
  [BuildingDefId.ARCHERY_RANGE]: 'archeryRange',
  [BuildingDefId.STABLE]: 'stable',
  [BuildingDefId.FOUNDRY]: 'foundry',
  [BuildingDefId.DEFENSIVE_TOWER]: 'defensiveTower',
};

const UNIT_KINDS: ReadonlySet<SelectionKind> = new Set<SelectionKind>([
  'villager', 'archer', 'spearman', 'scoutCavalry', 'gunman', 'cannon', 'machineGun', 'mortar',
]);

const BUILDING_KINDS: ReadonlySet<SelectionKind> = new Set<SelectionKind>([
  'tc', 'house', 'farm', 'mill', 'lumberCamp', 'goldMine', 'stoneQuarry', 'barracks',
  'archeryRange', 'stable', 'foundry', 'defensiveTower',
]);

const GATHERER_STATE_NAMES = [
  'idle',
  'walking→',
  'gathering',
  'returning',
  'depositing',
  'walking-to-build',
  'building',
];

function selectionKindOf(world: SimWorld, eid: number): SelectionKind {
  const ecs = world.ecs;
  if (hasComponent(ecs, VillagerTag, eid)) return 'villager';
  if (hasComponent(ecs, ArcherTag, eid)) return 'archer';
  if (hasComponent(ecs, SpearmanTag, eid)) return 'spearman';
  if (hasComponent(ecs, ScoutCavalryTag, eid)) return 'scoutCavalry';
  if (hasComponent(ecs, GunmanTag, eid)) return 'gunman';
  if (hasComponent(ecs, CannonTag, eid)) return 'cannon';
  if (hasComponent(ecs, MachineGunTag, eid)) return 'machineGun';
  if (hasComponent(ecs, MortarTag, eid)) return 'mortar';
  if (hasComponent(ecs, TownCenterTag, eid)) return 'tc';
  if (hasComponent(ecs, Building, eid)) {
    if (hasComponent(ecs, ConstructionSite, eid)) return 'foundation';
    return BUILDING_KIND_BY_DEF[Building.defId[eid]] ?? 'tc';
  }
  return 'none';
}

/** Portrait panel summary: dominant kind (or 'mixed'), summed HP, stats line. */
export function getSelectionInfo(world: SimWorld): SelectionInfo {
  const sel = selectedQuery(world.ecs);
  if (sel.length === 0) {
    return { kind: 'none', name: '-', glyph: '·', hp: 0, hpMax: 0, count: 0, team: 0, stats: '' };
  }
  let firstKind: SelectionKind = 'none';
  let mixed = false;
  let totalHp = 0;
  let totalHpMax = 0;
  let team = 0;
  for (const eid of sel) {
    const k = selectionKindOf(world, eid);
    if (firstKind === 'none') firstKind = k;
    else if (firstKind !== k) mixed = true;
    if (hasComponent(world.ecs, Health, eid)) {
      totalHp += Health.hp[eid];
      totalHpMax += Health.hpMax[eid];
    }
    team = Owner.player[eid] ?? team;
  }
  const kind: SelectionKind = mixed ? 'mixed' : firstKind;
  return {
    kind,
    name: NAME_BY_KIND[kind] ?? '-',
    glyph: GLYPH_BY_KIND[kind] ?? '·',
    hp: totalHp,
    hpMax: totalHpMax,
    count: sel.length,
    team,
    stats: selectionStats(world, kind, sel[0]),
  };
}

function selectionStats(world: SimWorld, kind: SelectionKind, e0: number): string {
  const ecs = world.ecs;
  if (UNIT_KINDS.has(kind)) {
    const speed = Speed.value[e0];
    const atk = hasComponent(ecs, Combat, e0) ? Combat.atk[e0] : 0;
    const range = hasComponent(ecs, Combat, e0) ? Combat.range[e0] : 0;
    let stats = `Atk ${atk}  Rng ${formatRange(range)}  Spd ${speed.toFixed(1)}`;
    if (kind === 'villager') {
      const carry = hasComponent(ecs, ResourceCarry, e0) ? ResourceCarry.amount[e0] : 0;
      if (carry > 0) stats += `  Carry ${carry}/10`;
    } else if (kind === 'machineGun' && hasComponent(ecs, MachineGunDeployment, e0)) {
      stats += MachineGunDeployment.deployed[e0] === 1
        ? '  Deployed'
        : `  Deploy ${Math.ceil(MachineGunDeployment.setupTicks[e0] / SIM.TICK_HZ)}s`;
    }
    return stats;
  }
  if (BUILDING_KINDS.has(kind)) {
    const defId = Building.defId[e0];
    const def = BUILDING_TABLE[defId];
    if (!def) return '';
    let stats = `Pop +${getBuildingPopProvided(world, Owner.player[e0], defId)}`;
    if (hasComponent(ecs, ResourceWorksite, e0)) {
      const workers = ResourceWorksite.assignedWorkers[e0];
      const slots = getWorksiteWorkerSlots(world, e0);
      stats += `  Workers ${workers}/${slots}  ${resourceKindName(ResourceWorksite.kind[e0])}`;
    } else if (defId === BuildingDefId.MILL) {
      stats += '  Food drop-off +50%';
    } else if (def.trains.length > 0) {
      stats += '  Producer';
    } else if (def.combat) {
      stats += `  Atk ${def.combat.atk}  Rng ${formatRange(def.combat.range)}`;
    }
    return stats;
  }
  if (kind === 'foundation') {
    const prog = ConstructionSite.progress[e0];
    const total = ConstructionSite.totalTicks[e0] || 1;
    return `Build ${Math.floor(prog / total * 100)}%`;
  }
  return '';
}

/** Status line for the first selected gatherer / producer (or the MP stall). */
export function getStatusInfo(ctx: SceneContext): { text: string; progressFrac: number | null } {
  const mpSession = ctx.multiplayer;
  if (mpSession?.stalled) {
    const mp = mpSession.debugSnapshot();
    const missing = mp.lockstep?.missingPlayers ?? [];
    const suffix = missing.length > 0 ? ` P${missing.join(',P')}` : ' peer';
    return { text: `waiting for${suffix}`, progressFrac: null };
  }
  const world = ctx.world;
  for (const eid of selectedQuery(world.ecs)) {
    if (hasComponent(world.ecs, Gatherer, eid)) {
      const st = Gatherer.state[eid];
      const carry = hasComponent(world.ecs, ResourceCarry, eid) ? ResourceCarry.amount[eid] : 0;
      const stateName = GATHERER_STATE_NAMES[st] ?? '?';
      if (st === GathererStateId.IDLE && carry === 0) return { text: 'idle', progressFrac: null };
      return { text: `${stateName}${carry > 0 ? ` (${carry}/10)` : ''}`, progressFrac: null };
    }
    if (hasComponent(world.ecs, Producer, eid)) {
      const q = world.productionQueues.get(eid);
      if (!q || q.length === 0) return { text: 'producer idle', progressFrac: null };
      const trainDef = getUnitDef(q[0]);
      if (!trainDef) return { text: 'producer', progressFrac: null };
      const frac = Producer.currentProgress[eid] / trainDef.trainTimeTicks;
      return {
        text: q.length > 1 ? `training ${trainDef.name} (${q.length})` : `training ${trainDef.name}`,
        progressFrac: Math.max(0, Math.min(1, frac)),
      };
    }
  }
  return { text: '', progressFrac: null };
}

/** Lower-case kind name for feedback messages ("selected archer eid=12"). */
export function entityKindName(world: SimWorld, eid: number): string {
  const ecs = world.ecs;
  if (hasComponent(ecs, VillagerTag, eid)) return 'villager';
  if (hasComponent(ecs, ArcherTag, eid)) return 'archer';
  if (hasComponent(ecs, SpearmanTag, eid)) return 'spearman';
  if (hasComponent(ecs, ScoutCavalryTag, eid)) return 'scout cavalry';
  if (hasComponent(ecs, GunmanTag, eid)) return 'gunman';
  if (hasComponent(ecs, CannonTag, eid)) return 'field cannon';
  if (hasComponent(ecs, MachineGunTag, eid)) return 'machine gun';
  if (hasComponent(ecs, MortarTag, eid)) return 'mortar team';
  if (hasComponent(ecs, TownCenterTag, eid)) return 'TC';
  if (hasComponent(ecs, Building, eid)) {
    const def = BUILDING_TABLE[Building.defId[eid]];
    return def?.name.toLowerCase() ?? 'building';
  }
  return 'entity';
}

export function resourceKindName(kind: number): string {
  switch (kind) {
    case ResourceKindId.FOOD: return 'food';
    case ResourceKindId.WOOD: return 'wood';
    case ResourceKindId.GOLD: return 'gold';
    case ResourceKindId.STONE: return 'stone';
    default: return 'resource';
  }
}

function formatRange(range: number): string {
  return Number.isInteger(range) ? String(range) : range.toFixed(1);
}
