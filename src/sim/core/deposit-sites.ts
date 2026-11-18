/**
 * Where a skirmish map's gold and stone go, and how much: every side gets the
 * same land by construction, because each deposit is placed together with its
 * point mirror through the middle between the two town centers.
 *
 *   home      beside each town center (placed in create-world.ts)
 *   natural   a second mine a short walk to the side of each town, away from
 *             the enemy: the first expansion
 *   centre    the big contested field half way between the towns (split onto
 *             both shores when the middle is water)
 *   flanks    two contested fields out on the wings, as far from one town as
 *             from the other
 *
 * Pure geometry over a "can a deposit stand here" test; no rng.
 */

import type { GridPos } from '../pathfinding';
import { dhypot } from './dmath';
import type { MapSize } from './map-size';
import type { MapDeposit } from '../maps/types';

/** Stone per node: stone is the scarce resource, so its fields are the big ones. */
export const HOME_STONE_NODES = 4;
export const HOME_STONE_AMOUNT = 800;
export const NATURAL_STONE_AMOUNT = 900;
export const NATURAL_GOLD_AMOUNT = 700;
export const CENTER_STONE_AMOUNT = 1000;
export const CENTER_GOLD_AMOUNT = 900;
export const FLANK_STONE_AMOUNT = 800;
export const FLANK_GOLD_AMOUNT = 700;
export const SCATTERED_STONE_AMOUNT = 600;
export const SCATTERED_GOLD_AMOUNT = 500;

/** Amount per node of an authored deposit on a large map, by its tier. */
export function authoredDepositAmount(deposit: MapDeposit): number {
  const gold = deposit.kind === 'gold';
  switch (deposit.tier) {
    case 'center':
      return gold ? CENTER_GOLD_AMOUNT : CENTER_STONE_AMOUNT;
    case 'flank':
      return gold ? FLANK_GOLD_AMOUNT : FLANK_STONE_AMOUNT;
    case 'natural':
      return gold ? NATURAL_GOLD_AMOUNT : NATURAL_STONE_AMOUNT;
    default:
      return gold ? SCATTERED_GOLD_AMOUNT : SCATTERED_STONE_AMOUNT;
  }
}

/** Tiles from a town center to its natural expansion. */
const NATURAL_DISTANCE = 12;
/** Tiles the natural expansion sits back from the line between the towns. */
const NATURAL_SETBACK = 2;
/** Tiles from the middle out to each contested flank. */
const FLANK_DISTANCE = 16;
/** A site needs this many free tiles in the 5 x 5 around it. */
const SITE_MIN_FREE_TILES = 10;
/** Sites keep this far from the map edge. */
const EDGE_MARGIN = 3;

/** Node offsets within a site, stone on one side and gold on the other. */
export const SITE_STONE_OFFSETS: ReadonlyArray<readonly [number, number]> = [[0, 0], [1, 0], [0, 1], [1, 1]];
export const SITE_GOLD_OFFSETS: ReadonlyArray<readonly [number, number]> = [[-2, 0], [-3, 0], [-2, 1], [-3, 1]];
/**
 * The centre field straddles the middle, so its nodes are listed as halves:
 * each offset is placed together with its mirror (a row of gold through the
 * middle, stone above and below).
 */
export const CENTER_GOLD_HALF_OFFSETS: ReadonlyArray<readonly [number, number]> = [[1, 0], [2, 0]];
export const CENTER_STONE_HALF_OFFSETS: ReadonlyArray<readonly [number, number]> = [[0, 2], [1, 2]];

export interface DepositPlan {
  /** Middle between the two town centers (may be fractional). */
  mid: { x: number; y: number };
  /** Player 1's natural expansion; player 2's is its mirror. */
  natural: GridPos | null;
  /** The contested centre, or null when the middle is water. */
  center: GridPos | null;
  /** One anchor per contested wing field on player 1's left; the other wing is the mirror. */
  flanks: GridPos[];
}

export type CanPlace = (x: number, y: number) => boolean;


/** Point mirror of a tile through the middle between the towns. */
export function mirrorThrough(mid: { x: number; y: number }, p: GridPos): GridPos {
  return { x: Math.round(2 * mid.x - p.x), y: Math.round(2 * mid.y - p.y) };
}

function inMap(size: MapSize, p: GridPos): boolean {
  return p.x >= EDGE_MARGIN && p.y >= EDGE_MARGIN && p.x < size.width - EDGE_MARGIN && p.y < size.height - EDGE_MARGIN;
}

function freeTiles(p: GridPos, canPlace: CanPlace): number {
  let n = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (canPlace(p.x + dx, p.y + dy)) n++;
    }
  }
  return n;
}

/** A site works when it and its mirror are inside the map with room for a field. */
function pairRoom(size: MapSize, mid: { x: number; y: number }, p: GridPos, canPlace: CanPlace): number {
  const twin = mirrorThrough(mid, p);
  if (!inMap(size, p) || !inMap(size, twin)) return 0;
  return Math.min(freeTiles(p, canPlace), freeTiles(twin, canPlace));
}

/**
 * Plan the shared deposits for two town centers. `flankOverride` pins the
 * wing field to an authored spot (a map with its own mine clearings).
 */
export function planDeposits(
  size: MapSize,
  p1: GridPos,
  p2: GridPos,
  canPlace: CanPlace,
  flankOverride?: GridPos
): DepositPlan {
  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const length = dhypot(p2.x - p1.x, p2.y - p1.y) || 1;
  const toward = { x: (p2.x - p1.x) / length, y: (p2.y - p1.y) / length };
  const side = { x: -toward.y, y: toward.x };
  const at = (base: { x: number; y: number }, alongSide: number, alongToward: number): GridPos => ({
    x: Math.round(base.x + side.x * alongSide + toward.x * alongToward),
    y: Math.round(base.y + side.y * alongSide + toward.y * alongToward),
  });

  // Natural expansion: to one side of the town, a little behind it. Take the
  // roomier side; come closer when neither side has room at full distance.
  let natural: GridPos | null = null;
  for (const distance of [NATURAL_DISTANCE, NATURAL_DISTANCE - 3, NATURAL_DISTANCE - 5]) {
    let best = 0;
    for (const sign of [1, -1]) {
      const spot = at(p1, sign * distance, -NATURAL_SETBACK);
      const room = pairRoom(size, mid, spot, canPlace);
      if (room > best) {
        best = room;
        natural = spot;
      }
    }
    if (best >= SITE_MIN_FREE_TILES) break;
    natural = null;
  }

  const midTile = { x: Math.round(mid.x), y: Math.round(mid.y) };
  const center = pairRoom(size, mid, midTile, canPlace) >= SITE_MIN_FREE_TILES ? midTile : null;

  const flanks: GridPos[] = [];
  if (flankOverride) {
    flanks.push(flankOverride);
  } else {
    // Out along the line every point of which is as far from one town as from
    // the other. Walk inward from the full distance until there is room.
    const wing = (from: number, to: number): GridPos | null => {
      for (let d = from; d >= to; d--) {
        const spot = at(mid, d, 0);
        if (pairRoom(size, mid, spot, canPlace) >= SITE_MIN_FREE_TILES) return spot;
      }
      return null;
    };
    const outer = wing(FLANK_DISTANCE, 9);
    if (outer) flanks.push(outer);
    // No centre (a lake in the middle): its field moves to the nearest shores.
    if (!center) {
      const outerDistance = outer ? dhypot(outer.x - mid.x, outer.y - mid.y) : Infinity;
      for (let d = 4; d <= FLANK_DISTANCE + 8; d++) {
        if (Math.abs(d - outerDistance) < 5) continue;
        const spot = at(mid, d, 0);
        if (pairRoom(size, mid, spot, canPlace) >= SITE_MIN_FREE_TILES) {
          flanks.push(spot);
          break;
        }
      }
    }
  }
  return { mid, natural, center, flanks };
}
