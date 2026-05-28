/**
 * Dark Age archer. Authored as a directional voxel rig with idle, movement,
 * and draw/release attack poses for all 8 facings.
 */

import type { Voxel, VoxelBakeOptions } from '../voxel-render';
import { PALETTE as P } from '../palette';

export const ARCHER_FACINGS = [
  'E',
  'SE',
  'S',
  'SW',
  'W',
  'NW',
  'N',
  'NE',
] as const;

export const ARCHER_ANIMS = ['idle', 'move', 'attack'] as const;

export type ArcherFacing = (typeof ARCHER_FACINGS)[number];
export type ArcherAnim = (typeof ARCHER_ANIMS)[number];

export const ARCHER_FRAME_COUNTS: Record<ArcherAnim, number> = {
  idle: 1,
  move: 2,
  attack: 2,
};

export const ARCHER_BAKE_BOUNDS: NonNullable<VoxelBakeOptions['bounds']> = {
  minX: 0,
  maxX: 16,
  minY: 0,
  maxY: 16,
  minZ: 0,
  maxZ: 15,
};

interface ArcherPose {
  facing?: ArcherFacing;
  anim?: ArcherAnim;
  frame?: number;
}

const FACING_VECTOR: Record<ArcherFacing, { fx: number; fy: number }> = {
  E: { fx: 1, fy: 0 },
  SE: { fx: 1, fy: 1 },
  S: { fx: 0, fy: 1 },
  SW: { fx: -1, fy: 1 },
  W: { fx: -1, fy: 0 },
  NW: { fx: -1, fy: -1 },
  N: { fx: 0, fy: -1 },
  NE: { fx: 1, fy: -1 },
};

const CENTER_X = 8;
const CENTER_Y = 8;

export function buildArcherVoxels(teamColor: number, pose: ArcherPose = {}): Voxel[] {
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

  for (const side of [-1, 1] as const) {
    const footF = stride * side;
    put(footF, side, 0, P.BOOTS);
    put(footF, side, 1, P.BOOTS);
    put(0, side, 2, P.LEATHER_D);
    put(0, side, 3, P.LEATHER);
  }

  box(-1, -1, 4, 0, 1, 7, P.TUNIC_GREEN);
  put(1, -1, 5, teamColor);
  put(1, 0, 5, teamColor);
  put(1, 1, 5, teamColor);
  put(-1, 0, 7, P.LEATHER_D);

  // Quiver on the rear shoulder.
  line(-2, 1, 5, -2, 1, 10, P.LEATHER_D);
  put(-2, 1, 10, P.ARROW_SHAFT);
  put(-2, 1, 11, P.FLETCHING);
  put(-1, 2, 10, P.ARROW_SHAFT);

  // Head and hood.
  put(0, 0, 8, P.SKIN);
  box(0, -1, 9, 1, 0, 10, P.SKIN);
  box(0, -1, 11, 1, 0, 11, P.TUNIC_GREEN);
  put(1, -1, 12, P.TUNIC_GREEN);
  put(1, 0, 12, P.TUNIC_GREEN);
  put(0, 0, 13, P.TUNIC_GREEN);
  put(1, 1, 11, P.TUNIC_GREEN);

  if (anim === 'attack') {
    addAttackPose(put, line, frame);
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
  line(0, -2, 7, 1 + stride, -2, 5, P.TUNIC_GREEN);
  put(1 + stride, -2, 5, P.SKIN);
  line(0, 2, 7, -1 - stride, 2, 5, P.TUNIC_GREEN);
  put(-1 - stride, 2, 5, P.SKIN);

  // Bow carried upright on the weapon side.
  line(2, -2, 3, 1, -2, 11, P.BOW_WOOD);
  line(1, -2, 11, 2, -2, 13, P.BOW_WOOD);
  line(1, -2, 4, 1, -2, 12, P.FLETCHING);
}

function addAttackPose(
  put: (forward: number, side: number, z: number, color: number) => void,
  line: (fromF: number, fromS: number, fromZ: number, toF: number, toS: number, toZ: number, color: number) => void,
  frame: number
): void {
  const release = frame % 2 === 1;
  const bowF = release ? 4 : 3;
  const drawF = release ? 0 : -1;

  line(0, -2, 7, bowF, -2, 8, P.TUNIC_GREEN);
  put(bowF, -2, 8, P.SKIN);
  line(0, 2, 7, drawF, 1, 8, P.TUNIC_GREEN);
  put(drawF, 1, 8, P.SKIN);

  // Curved bow profile and string.
  line(bowF, -3, 4, bowF + 1, -3, 7, P.BOW_WOOD);
  line(bowF + 1, -3, 7, bowF, -3, 12, P.BOW_WOOD);
  line(bowF, -3, 5, bowF, -3, 11, P.FLETCHING);

  // Drawn arrow on frame 0, released arrow extending forward on frame 1.
  const arrowTip = release ? 7 : bowF + 1;
  line(drawF, 0, 8, arrowTip, -1, 8, P.ARROW_SHAFT);
  put(drawF - 1, 0, 8, P.FLETCHING);
  if (release) {
    put(arrowTip, -1, 8, P.STEEL);
    put(arrowTip + 1, -1, 8, P.STEEL);
  }
}
