/**
 * Dark Age scout cavalry. This model is authored as a compact horse-and-rider
 * voxel rig, then posed for 8 facings and idle / move / attack frames.
 *
 * The local rig uses forward/side coordinates so the horse head, tail, legs,
 * rider, and lance can be rotated together into game facings before baking.
 */

import type { Voxel, VoxelBakeOptions } from '../voxel-render';
import { PALETTE as P } from '../palette';

export const SCOUT_CAVALRY_FACINGS = [
  'E',
  'SE',
  'S',
  'SW',
  'W',
  'NW',
  'N',
  'NE',
] as const;

export const SCOUT_CAVALRY_ANIMS = ['idle', 'move', 'attack'] as const;

export type ScoutCavalryFacing = (typeof SCOUT_CAVALRY_FACINGS)[number];
export type ScoutCavalryAnim = (typeof SCOUT_CAVALRY_ANIMS)[number];

export const SCOUT_CAVALRY_FRAME_COUNTS: Record<ScoutCavalryAnim, number> = {
  idle: 1,
  move: 2,
  attack: 2,
};

export const SCOUT_CAVALRY_BAKE_BOUNDS: NonNullable<VoxelBakeOptions['bounds']> = {
  minX: -2,
  maxX: 22,
  minY: -2,
  maxY: 22,
  minZ: 0,
  maxZ: 20,
};

interface ScoutCavalryPose {
  facing?: ScoutCavalryFacing;
  anim?: ScoutCavalryAnim;
  frame?: number;
}

const FACING_VECTOR: Record<ScoutCavalryFacing, { fx: number; fy: number }> = {
  E: { fx: 1, fy: 0 },
  SE: { fx: 1, fy: 1 },
  S: { fx: 0, fy: 1 },
  SW: { fx: -1, fy: 1 },
  W: { fx: -1, fy: 0 },
  NW: { fx: -1, fy: -1 },
  N: { fx: 0, fy: -1 },
  NE: { fx: 1, fy: -1 },
};

const CENTER_X = 10;
const CENTER_Y = 10;

export function buildScoutCavalryVoxels(teamColor: number, pose: ScoutCavalryPose = {}): Voxel[] {
  const facing = pose.facing ?? 'SE';
  const anim = pose.anim ?? 'idle';
  const frame = pose.frame ?? 0;
  const { fx, fy } = FACING_VECTOR[facing];
  const sx = -fy;
  const sy = fx;
  const cells = new Map<string, Voxel>();

  const put = (forward: number, side: number, z: number, c: number) => {
    const x = Math.round(CENTER_X + forward * fx + side * sx);
    const y = Math.round(CENTER_Y + forward * fy + side * sy);
    cells.set(`${x},${y},${z}`, { x, y, z, color: c });
  };

  const box = (
    f0: number,
    s0: number,
    z0: number,
    f1: number,
    s1: number,
    z1: number,
    c: number
  ) => {
    for (let z = z0; z <= z1; z++) {
      for (let f = f0; f <= f1; f++) {
        for (let s = s0; s <= s1; s++) put(f, s, z, c);
      }
    }
  };

  const line = (
    fromF: number,
    fromS: number,
    fromZ: number,
    toF: number,
    toS: number,
    toZ: number,
    c: number
  ) => {
    const steps = Math.max(
      Math.abs(toF - fromF),
      Math.abs(toS - fromS),
      Math.abs(toZ - fromZ),
      1
    );
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      put(
        Math.round(fromF + (toF - fromF) * t),
        Math.round(fromS + (toS - fromS) * t),
        Math.round(fromZ + (toZ - fromZ) * t),
        c
      );
    }
  };

  const moveStride = anim === 'move' ? (frame % 2 === 0 ? 1 : -1) : 0;
  const attackLean = anim === 'attack' ? frame + 1 : 0;

  // Horse legs. Alternate diagonals for the two movement frames; attack braces
  // the front pair so the thrust reads even in a small sprite.
  const legSeeds = [
    { f: -2, s: -1, phase: 1 },
    { f: -2, s: 1, phase: -1 },
    { f: 2, s: -1, phase: -1 },
    { f: 2, s: 1, phase: 1 },
  ];
  for (const leg of legSeeds) {
    const frontLeg = leg.f > 0;
    const planted = anim === 'attack' && frontLeg;
    const footF = leg.f + (planted ? 1 : moveStride * leg.phase);
    const kneeF = leg.f + Math.sign(footF - leg.f);
    const footZ = planted ? 0 : moveStride === 0 ? 0 : leg.phase === moveStride ? 0 : 1;
    put(footF, leg.s, footZ, P.BOOTS);
    put(kneeF, leg.s, 1, P.HORSE_DARK);
    put(leg.f, leg.s, 2, P.HORSE_DARK);
    put(leg.f, leg.s, 3, P.HORSE_BAY);
  }

  // Horse body, chest, neck, head, mane, and tail.
  box(-3, -1, 4, 2, 1, 6, P.HORSE_BAY);
  box(-2, -1, 7, 1, 1, 7, P.HORSE_BAY);
  box(2, -1, 5, 3, 1, 7, P.HORSE_BAY);
  box(3, 0, 7, 4, 0, 10, P.HORSE_BAY);
  box(4, -1, 9, 5, 0, 11, P.HORSE_BAY);
  put(6, 0, 9, P.HORSE_BAY);
  put(5, -1, 12, P.HORSE_DARK);
  put(5, 0, 12, P.HORSE_DARK);
  put(6, 0, 10, P.IRON);
  for (let z = 7; z <= 11; z++) put(3, 1, z, P.MANE);
  line(-4, 0, 6, -5, 0, 3, P.MANE);

  // Saddle, team blanket, and tack.
  box(-1, -1, 8, 2, 1, 8, teamColor);
  box(-1, -1, 7, 2, -1, 8, P.LEATHER_D);
  put(0, -1, 9, P.LEATHER);
  put(1, -1, 9, P.LEATHER);
  line(1, -1, 9, 4, -1, 9, P.LEATHER_D);

  // Rider legs.
  put(-1, -1, 9, P.LEATHER_D);
  put(2, -1, 9, P.LEATHER_D);
  put(-1, 1, 9, P.LEATHER_D);
  put(2, 1, 9, P.LEATHER_D);

  // Rider torso and head. Attack poses lean into the horse's forward axis.
  const riderF = attackLean > 0 ? 1 : 0;
  box(riderF, -1, 10, riderF + 1, 0, 13, P.LEATHER);
  put(riderF, -1, 11, teamColor);
  put(riderF + 1, -1, 11, teamColor);
  put(riderF, -1, 12, teamColor);
  put(riderF + 1, -1, 12, teamColor);
  put(riderF, 0, 13, P.MAIL_D);
  put(riderF + 1, 0, 13, P.MAIL_D);
  put(riderF + 1, 0, 14, P.SKIN);
  put(riderF + 1, -1, 14, P.SKIN);
  put(riderF + 1, 0, 15, P.SKIN);
  put(riderF + 1, -1, 15, P.SKIN);
  put(riderF + 1, 0, 16, P.LEATHER_D);
  put(riderF + 1, -1, 16, P.LEATHER_D);
  put(riderF + 1, 0, 17, P.LEATHER_D);

  // Arms and weapon. Idle/move carries the light lance upright; attack extends
  // it forward with a steel tip for the fighting sprite.
  if (anim === 'attack') {
    line(riderF + 1, -1, 12, riderF + 3, -1, 10, P.LEATHER);
    put(riderF + 3, -1, 10, P.SKIN);
    const tipF = frame % 2 === 0 ? 7 : 9;
    line(riderF + 2, -1, 10, tipF, -1, 8, P.WOOD_L);
    put(tipF, -1, 8, P.STEEL);
    put(tipF + 1, -1, 8, P.STEEL);
    put(tipF, -1, 9, P.STEEL);
    put(riderF - 1, 1, 11, P.LEATHER);
    put(riderF - 1, 1, 12, P.SKIN);
  } else {
    put(riderF - 1, 1, 11, P.LEATHER);
    put(riderF - 1, 1, 12, P.SKIN);
    put(riderF + 2, -1, 11, P.LEATHER);
    put(riderF + 2, -1, 12, P.SKIN);
    line(riderF + 2, -2, 10, riderF + 3, -2, 18, P.WOOD_L);
    put(riderF + 3, -2, 19, P.STEEL);
    put(riderF + 3, -2, 20, P.STEEL);
  }

  return Array.from(cells.values());
}
