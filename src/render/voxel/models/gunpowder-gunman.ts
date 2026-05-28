/**
 * Gunpowder Age gunman. Compact infantry with a long hand cannon/musket,
 * smoke flash on attack frame 1, and the same 8-facing rig as other combat units.
 */

import type { Voxel, VoxelBakeOptions } from '../voxel-render';
import { PALETTE as P } from '../palette';

export const GUNMAN_FACINGS = [
  'E',
  'SE',
  'S',
  'SW',
  'W',
  'NW',
  'N',
  'NE',
] as const;

export const GUNMAN_ANIMS = ['idle', 'move', 'attack'] as const;

export type GunmanFacing = (typeof GUNMAN_FACINGS)[number];
export type GunmanAnim = (typeof GUNMAN_ANIMS)[number];

export const GUNMAN_FRAME_COUNTS: Record<GunmanAnim, number> = {
  idle: 1,
  move: 2,
  attack: 2,
};

export const GUNMAN_BAKE_BOUNDS: NonNullable<VoxelBakeOptions['bounds']> = {
  minX: 0,
  maxX: 17,
  minY: 0,
  maxY: 17,
  minZ: 0,
  maxZ: 15,
};

interface GunmanPose {
  facing?: GunmanFacing;
  anim?: GunmanAnim;
  frame?: number;
}

const FACING_VECTOR: Record<GunmanFacing, { fx: number; fy: number }> = {
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
const IRON_D = 0x151719;
const SMOKE = 0xb7bdc0;
const FLASH = 0xf4c95a;
const FLASH_HOT = 0xf06a43;

export function buildGunmanVoxels(teamColor: number, pose: GunmanPose = {}): Voxel[] {
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
  const braced = anim === 'attack';

  for (const side of [-1, 1] as const) {
    const footF = braced ? (side < 0 ? 1 : -1) : stride * side;
    put(footF, side, 0, P.BOOTS);
    put(footF, side, 1, P.BOOTS);
    put(0, side, 2, P.LEATHER_D);
    put(0, side, 3, P.LEATHER);
  }

  box(-1, -1, 4, 0, 1, 7, P.MAIL_D);
  put(1, -1, 5, teamColor);
  put(1, 0, 5, teamColor);
  put(1, 1, 5, teamColor);
  put(0, -1, 8, P.MAIL);
  put(0, 1, 8, P.MAIL);

  put(0, 0, 9, P.SKIN);
  box(0, -1, 10, 1, 0, 11, P.SKIN);
  box(0, -1, 12, 1, 0, 12, P.MAIL_D);
  put(1, -1, 13, P.MAIL_D);
  put(1, 0, 13, P.MAIL_D);
  put(0, 0, 14, P.MAIL_D);

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
  line(0, -2, 7, 1 + stride, -2, 6, P.MAIL_D);
  put(1 + stride, -2, 6, P.SKIN);
  line(0, 2, 7, -1 - stride, 2, 6, P.MAIL_D);
  put(-1 - stride, 2, 6, P.SKIN);
  line(0, -3, 5, 4, -3, 8, P.WOOD_D);
  line(3, -3, 8, 7, -3, 8, IRON_D);
  put(0, -3, 5, P.WOOD_L);
}

function addAttackPose(
  put: (forward: number, side: number, z: number, color: number) => void,
  line: (fromF: number, fromS: number, fromZ: number, toF: number, toS: number, toZ: number, color: number) => void,
  frame: number
): void {
  const recoil = frame % 2 === 1;
  const handF = recoil ? 1 : 2;
  const barrelTip = recoil ? 6 : 8;
  line(0, -2, 7, handF, -1, 8, P.MAIL_D);
  put(handF, -1, 8, P.SKIN);
  line(0, 2, 7, handF - 1, 1, 8, P.MAIL_D);
  put(handF - 1, 1, 8, P.SKIN);
  line(handF - 1, 0, 8, barrelTip, -1, 8, P.WOOD_D);
  line(handF + 1, -1, 8, barrelTip + 1, -1, 8, IRON_D);
  put(handF - 1, 0, 7, P.WOOD_L);
  if (recoil) {
    put(barrelTip + 1, -1, 8, FLASH);
    put(barrelTip + 2, -1, 8, FLASH_HOT);
    put(barrelTip + 1, -2, 9, FLASH);
    put(barrelTip + 2, -2, 9, SMOKE);
    put(barrelTip + 3, -2, 10, SMOKE);
  }
}
