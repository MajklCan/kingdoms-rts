/**
 * bitECS 0.3 stores component fields in module-global typed arrays indexed by
 * eid and never clears them: a reused eid starts with whatever the previous
 * owner of that slot left behind, in any world. Spawn helpers do not write
 * every field of every component they add (villagers get a UnitStance with no
 * anchor, for one), so two lockstep clients whose eids were reused
 * differently would read different values. Clearing every store when an
 * entity is created makes a fresh entity identical everywhere.
 */

import * as Components from '../components';

type Store = ArrayLike<number> & { [index: number]: number };

/** Every per-eid store: plain typed-array fields, and the per-eid subarrays of
 *  array fields (`[Types.f32, n]`), collected once from the components module. */
function collectStores(): { scalars: Store[]; vectors: Array<Array<{ fill(v: number): unknown }>> } {
  const scalars: Store[] = [];
  const vectors: Array<Array<{ fill(v: number): unknown }>> = [];
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number): void => {
    if (value === null || typeof value !== 'object' || seen.has(value) || depth > 3) return;
    seen.add(value);
    if (ArrayBuffer.isView(value)) {
      scalars.push(value as unknown as Store);
      return;
    }
    if (Array.isArray(value)) {
      if (value.length > 0 && ArrayBuffer.isView(value[0])) vectors.push(value as Array<{ fill(v: number): unknown }>);
      return;
    }
    for (const key of Object.keys(value)) visit((value as Record<string, unknown>)[key], depth + 1);
  };
  for (const exported of Object.values(Components)) visit(exported, 0);
  return { scalars, vectors };
}

let stores: ReturnType<typeof collectStores> | null = null;

export function clearComponentData(eid: number): void {
  stores ??= collectStores();
  for (const store of stores.scalars) {
    if (eid < store.length) store[eid] = 0;
  }
  for (const vector of stores.vectors) vector[eid]?.fill(0);
}
