/**
 * Test-only desync forensics: flatten a world into "path = value" lines keyed
 * by NetId (never raw eid, which legitimately differs between clients) and
 * diff two of them. Reads every field of every component an entity carries,
 * including fields the checksum skips, so a diff names the component (and so
 * the system) that diverged first.
 */

import { getEntityComponents } from 'bitecs';
import * as Components from '@sim/components';
import { NetId } from '@sim/components';
import { positionQuery, type SimWorld } from '@sim/world';

const componentNames = new Map<unknown, string>();
for (const [name, value] of Object.entries(Components)) {
  if (value && typeof value === 'object') componentNames.set(value, name);
}

function isEidField(field: string): boolean {
  return /eid$/i.test(field);
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toPrecision(9);
}

/** One line per scalar of sim state, sorted, eid references as NetIds. */
export function describeWorld(world: SimWorld): Map<string, string> {
  const out = new Map<string, string>();
  const eidToNet = new Map<number, number>();
  for (const [netId, eid] of world.netIdToEid) eidToNet.set(eid, netId);
  const ref = (eid: number): string => {
    if (eid < 0 || eid === 0xffffffff) return String(eid);
    const n = eidToNet.get(eid);
    return n === undefined ? (eid === 0 ? '0' : `dead:${eid}`) : `n${n}`;
  };

  out.set('tick', String(world.tick));
  out.set('rng', String(world.rng.getState()));
  out.set('nextNetId', String(world.nextNetId));
  out.set('paused', String(world.paused));
  out.set('outcome', JSON.stringify(world.outcome));
  world.resources.forEach((bank, p) => out.set(`bank[${p}]`, Array.from(bank).join(',')));
  world.population.forEach((pop, p) => out.set(`pop[${p}]`, `${pop.current}/${pop.cap}`));
  world.ages.forEach((age, p) => out.set(`age[${p}]`, JSON.stringify(age)));
  world.researchedTechs.forEach((set, p) => out.set(`techs[${p}]`, [...set].sort().join(',')));
  out.set('formationModes', world.formationModes.join(','));
  out.set('formationFacings', world.formationFacings.join(','));
  out.set('armyRallyPoints', JSON.stringify(world.armyRallyPoints));
  out.set('walkability', String(world.grid.reduce((acc, row, y) => acc + row.reduce((a, v, x) => a + v * (x + 1) * (y + 7), 0), 0)));

  for (const eid of positionQuery(world.ecs)) {
    const key = ref(eid);
    for (const comp of getEntityComponents(world.ecs, eid)) {
      const name = componentNames.get(comp) ?? 'Component?';
      if (comp === NetId || name === 'Selected') continue;
      const stores = comp as unknown as Record<string, ArrayLike<number> & { [i: number]: number }>;
      const fields = Object.keys(stores);
      if (fields.length === 0) {
        out.set(`${key}.${name}`, 'tag');
        continue;
      }
      for (const field of fields) {
        const store = stores[field];
        if (!store || typeof store !== 'object' || !('length' in store)) continue;
        const value = store[eid];
        if (typeof value !== 'number') continue;
        out.set(`${key}.${name}.${field}`, isEidField(field) ? ref(value) : fmt(value));
      }
    }
  }

  const mapByRef = <T>(label: string, map: Map<number, T>, show: (value: T) => string): void => {
    for (const [eid, value] of map) out.set(`${label}[${ref(eid)}]`, show(value));
  };
  mapByRef('queue', world.productionQueues, (q) => q.join(','));
  mapByRef('path', world.paths, (p) => p.map((w) => `${w.x}:${w.y}`).join(' '));
  mapByRef('stuck', world.movementStuck, (s) => JSON.stringify(s));
  mapByRef('speedCap', world.formationSpeedCaps, (s) => fmt(s));
  mapByRef('windup', world.cannonWindups, (w) => `${ref(w.targetEid)}:${w.ticksRemaining}`);
  world.pendingProjectileImpacts.forEach((imp, i) =>
    out.set(`projectile#${i}`, `${imp.impactTick} ${ref(imp.attackerEid)}>${ref(imp.targetEid)} ${imp.damage}`)
  );
  world.pendingCannonImpacts.forEach((imp, i) =>
    out.set(`cannon#${i}`, `${imp.impactTick} ${ref(imp.attackerEid)} ${fmt(imp.impactX)},${fmt(imp.impactY)} ${imp.damage}`)
  );
  world.aiPlayers.forEach((ai, p) => {
    if (!ai) return;
    out.set(`ai[${p}]`, JSON.stringify({ ...ai, waveUnitEids: ai.waveUnitEids.map(ref) }));
  });
  world.visibility.forEach((vis, p) => {
    if (!vis) return;
    let sum = 0;
    for (let i = 0; i < vis.visible.length; i++) sum = (sum * 31 + vis.visible[i] * 3 + vis.explored[i]) >>> 0;
    out.set(`vis[${p}]`, String(sum));
  });
  return out;
}

export interface WorldDiffLine {
  path: string;
  a: string | undefined;
  b: string | undefined;
}

export function diffWorlds(a: SimWorld, b: SimWorld, limit = 40): WorldDiffLine[] {
  return diffDescriptions(describeWorld(a), describeWorld(b), limit);
}

export function diffDescriptions(da: Map<string, string>, db: Map<string, string>, limit = 40): WorldDiffLine[] {
  const keys = new Set([...da.keys(), ...db.keys()]);
  const out: WorldDiffLine[] = [];
  for (const path of [...keys].sort()) {
    const va = da.get(path);
    const vb = db.get(path);
    if (va === vb) continue;
    out.push({ path, a: va, b: vb });
    if (out.length >= limit) break;
  }
  return out;
}
