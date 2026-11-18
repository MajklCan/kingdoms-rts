/**
 * Several producers selected at once (three barracks, two town centers): a
 * train order goes unit by unit to whichever has the shortest queue, ties to
 * the earlier one in the list, so one click fills the idle building first and
 * a batch spreads across all of them.
 */

export interface ProducerLoad {
  eid: number;
  /** Units already waiting in its queue (the one in training included). */
  queued: number;
}

/** How many units each producer gets, in producer order; producers that get none are left out. */
export function splitTraining(producers: readonly ProducerLoad[], count: number): Array<{ eid: number; count: number }> {
  const load = producers.map((p) => p.queued);
  const given = producers.map(() => 0);
  for (let i = 0; i < count && producers.length > 0; i++) {
    let best = 0;
    for (let j = 1; j < load.length; j++) if (load[j] < load[best]) best = j;
    load[best] += 1;
    given[best] += 1;
  }
  return producers.flatMap((p, i) => (given[i] > 0 ? [{ eid: p.eid, count: given[i] }] : []));
}
