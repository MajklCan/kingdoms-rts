/**
 * Dark Age spearman. Directional infantry rig with walking legs and a two-frame
 * spear thrust so melee combat faces the target instead of staying static.
 */

import type { Voxel, VoxelBakeOptions } from '../voxel-render';
import { PALETTE as P } from '../palette';

export const SPEARMAN_FACINGS = [
  'E',
  'SE',
  'S',
  'SW',
  'W',
  'NW',
  'N',
  'NE',
] as const;

export const SPEARMAN_ANIMS = ['idle', 'move', 'attack'] as const;

export type SpearmanFacing = (typeof SPEARMAN_FACINGS)[number];
export type SpearmanAnim = (typeof SPEARMAN_ANIMS)[number];

export const SPEARMAN_FRAME_COUNTS: Record<SpearmanAnim, number> = {
  idle: 1,
  move: 2,
  attack: 2,
};

export const SPEARMAN_BAKE_BOUNDS: NonNullable<VoxelBakeOptions['bounds']> = {
  minX: -1,
  maxX: 18,
  minY: -1,
  maxY: 18,
  minZ: 0,
  maxZ: 18,
};

interface SpearmanPose {
  facing?: SpearmanFacing;
  anim?: SpearmanAnim;
  frame?: number;
}

const FACING_VECTOR: Record<SpearmanFacing, { fx: number; fy: number }> = {
  E: { fx: 1, fy: 0 },
  SE: { fx: 1, fy: 1 },
  S: { fx: 0, fy: 1 },
  SW: { fx: -1, fy: 1 },
  W: { fx: -1, fy: 0 },
  NW: { fx: -1, fy: -1 },
  N: { fx: 0, fy: -1 },
  NE: { fx: 1, fy: -1 },
};

const CENTER_X = 9;
const CENTER_Y = 9;

export function buildSpearmanVoxels(teamColor: number, pose: SpearmanPose = {}): Voxel[] {
  const facing = pose.facing ?? 'SE';
  const anim = pose.anim ?? 'idle';
  const frame = pose.frame ?? 0;
  const { fx, fy } = FACING_VECTOR[facing];
  const sx = -fy;
  const sy = fx;
  const cells = new Map<string, Voxel>();

  const put = (forward: number, side: number, z: number, color: number) => {
    const x = Math.round(CENTER_X + forward * fx + side * sx);
    const y = Math.round(CENTER_Y + forward * fy + side * sy);
    cells.set(`${x},${y},${z}`, { x, y, z, color });
  };
  const box = (
    f0: number,
    s0: number,
    z0: number,
    f1: number,
    s1: number,
    z1: number,
    color: number
  ) => {
    for (let z = z0; z <= z1; z++)
      for (let f = f0; f <= f1; f++)
        for (let s = s0; s <= s1; s++) put(f, s, z, color);
  };
  const line = (
    fromF: number,
    fromS: number,
    fromZ: number,
    toF: number,
    toS: number,
    toZ: number,
    color: number
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
        color
      );
    }
  };

  const stride = anim === 'move' ? (frame % 2 === 0 ? 1 : -1) : 0;
  const attackLean = anim === 'attack' ? 1 : 0;

  for (const side of [-1, 1] as const) {
    const footF = attackLean > 0 && side === 1 ? 2 : stride * side;
    put(footF, side, 0, P.BOOTS);
    put(footF, side, 1, P.BOOTS);
    put(0, side, 2, P.LEATHER_D);
    put(0, side, 3, P.LEATHER);
  }

  box(-1 + attackLean, -1, 4, attackLean, 1, 7, P.LEATHER);
  put(attackLean, -1, 5, teamColor);
  put(attackLean, 0, 5, teamColor);
  put(attackLean, 1, 5, teamColor);
  put(attackLean, 0, 7, P.MAIL_D);

  // Shield sits on the off-hand side and stays readable in all facings.
  for (let z = 4; z <= 8; z++) {
    put(attackLean, 2, z, P.SHIELD_WOOD);
  }
  put(attackLean, 2, 5, teamColor);
  put(attackLean, 2, 7, teamColor);
  put(attackLean, 2, 6, P.IRON);

  // Head and helmet.
  put(attackLean, 0, 8, P.SKIN);
  box(attackLean, -1, 9, attackLean + 1, 0, 10, P.SKIN);
  box(attackLean, -1, 11, attackLean + 1, 0, 11, P.LEATHER_D);
  put(attackLean + 1, 0, 12, P.LEATHER_D);
  put(attackLean + 1, -1, 12, P.LEATHER_D);
  put(attackLean + 1, -1, 10, P.STEEL);

  if (anim === 'attack') {
    addAttackPose(put, line, attackLean, frame);
  } else {
    addCarryPose(put, line, stride);
  }

  return Array.from(cells.values());
}

function addCarryPose(
  put: (forward: number, side: number, z: number, color: number) => void,
  line: (fromF: number, fromS: number, fromZ: number, toF: number, toS: number, toZ: number, color: number) => void,
  stride: number
): void {
  line(0, -2, 7, 1 + stride, -2, 5, P.LEATHER);
  put(1 + stride, -2, 5, P.SKIN);
  line(0, 2, 7, -1, 2, 5, P.LEATHER);
  put(-1, 2, 5, P.SKIN);

  // Vertical spear when idle/moving.
  line(2, -2, 2, 3, -2, 15, P.WOOD_L);
  put(3, -2, 16, P.STEEL);
  put(3, -2, 17, P.STEEL);
  put(2, -2, 16, P.STEEL);
  put(4, -2, 16, P.STEEL);
}

function addAttackPose(
  put: (forward: number, side: number, z: number, color: number) => void,
  line: (fromF: number, fromS: number, fromZ: number, toF: number, toS: number, toZ: number, color: number) => void,
  lean: number,
  frame: number
): void {
  const tipF = frame % 2 === 0 ? 5 : 8;
  const handF = lean + 2;
  line(lean, -2, 7, handF, -1, 7, P.LEATHER);
  put(handF, -1, 7, P.SKIN);
  line(lean, 2, 7, handF - 1, 1, 6, P.LEATHER);
  put(handF - 1, 1, 6, P.SKIN);
  line(handF - 1, -1, 7, tipF, -1, 7, P.WOOD_L);
  put(tipF, -1, 7, P.STEEL);
  put(tipF + 1, -1, 7, P.STEEL);
  put(tipF, -1, 8, P.STEEL);
  put(tipF, -1, 6, P.STEEL);
}
