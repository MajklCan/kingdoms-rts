/**
 * Total War Age machine gun team. The silhouette is intentionally different
 * from gunmen: compact tripod, short water-cooled barrel, ammo belt, upright
 * braced gunner, and a brighter repeated muzzle flash during attack frames.
 */

import type { Voxel, VoxelBakeOptions } from '../voxel-render';
import { PALETTE as P } from '../palette';

export const MACHINE_GUN_FACINGS = [
  'E',
  'SE',
  'S',
  'SW',
  'W',
  'NW',
  'N',
  'NE',
] as const;

export const MACHINE_GUN_ANIMS = ['idle', 'move', 'attack'] as const;

export type MachineGunFacing = (typeof MACHINE_GUN_FACINGS)[number];
export type MachineGunAnim = (typeof MACHINE_GUN_ANIMS)[number];

export const MACHINE_GUN_FRAME_COUNTS: Record<MachineGunAnim, number> = {
  idle: 1,
  move: 2,
  attack: 3,
};

export const MACHINE_GUN_BAKE_BOUNDS: NonNullable<VoxelBakeOptions['bounds']> = {
  minX: -2,
  maxX: 25,
  minY: -2,
  maxY: 25,
  minZ: 0,
  maxZ: 19,
};

interface MachineGunPose {
  facing?: MachineGunFacing;
  anim?: MachineGunAnim;
  frame?: number;
}

const FACING_VECTOR: Record<MachineGunFacing, { fx: number; fy: number }> = {
  E: { fx: 1, fy: 0 },
  SE: { fx: 1, fy: 1 },
  S: { fx: 0, fy: 1 },
  SW: { fx: -1, fy: 1 },
  W: { fx: -1, fy: 0 },
  NW: { fx: -1, fy: -1 },
  N: { fx: 0, fy: -1 },
  NE: { fx: 1, fy: -1 },
};

const CENTER_X = 13;
const CENTER_Y = 13;
const IRON_D = 0x101214;
const IRON_M = 0x2a2f32;
const IRON_L = 0x586268;
const BARREL_D = 0x161a1d;
const BARREL_L = 0x707b82;
const KHAKI = 0x6e6842;
const KHAKI_D = 0x49472d;
const BELT = 0xb48a3a;
const FLASH = 0xffd66b;
const FLASH_HOT = 0xff6a3a;
const SMOKE = 0xaeb5b8;

export function buildMachineGunVoxels(teamColor: number, pose: MachineGunPose = {}): Voxel[] {
  const facing = pose.facing ?? 'SE';
  const anim = pose.anim ?? 'idle';
  const frame = pose.frame ?? 0;
  const { fx, fy } = FACING_VECTOR[facing];
  const sx = -fy;
  const sy = fx;
  const screenHorizontal = facing === 'NE' || facing === 'SW';
  const screenVertical = facing === 'SE' || facing === 'NW';
  const forwardScale = screenHorizontal ? 0.62 : screenVertical ? 0.78 : 1;
  const sideScale = screenHorizontal ? 0.82 : screenVertical ? 0.72 : 1;
  const cells = new Map<string, Voxel>();

  const put = (forward: number, side: number, z: number, color: number) => {
    const f = forward * forwardScale;
    const s = side * sideScale;
    const x = Math.round(CENTER_X + f * fx + s * sx);
    const y = Math.round(CENTER_Y + f * fy + s * sy);
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

  if (anim === 'move') {
    addGunner(put, box, line, teamColor, anim, frame);
    addCarriedGun(put, box, line, frame);
  } else {
    addTripod(put, line, anim, frame);
    addReceiverAndBarrel(put, box, line, anim, frame);
    addAmmoBelt(put, line, anim, frame);
    addGunner(put, box, line, teamColor, anim, frame);

    if (anim === 'attack') {
      addMuzzleFlash(put, frame);
    }
  }

  return Array.from(cells.values());
}

function addCarriedGun(
  put: (forward: number, side: number, z: number, color: number) => void,
  box: (f0: number, s0: number, z0: number, f1: number, s1: number, z1: number, color: number) => void,
  line: (fromF: number, fromS: number, fromZ: number, toF: number, toS: number, toZ: number, color: number) => void,
  frame: number
): void {
  const bob = frame % 2 === 0 ? 0 : 1;
  box(-2, -1, 8 + bob, 0, 1, 9 + bob, IRON_D);
  line(0, 0, 9 + bob, 5, 0, 9 + bob, BARREL_D);
  line(1, -1, 10 + bob, 4, -1, 10 + bob, BARREL_L);
  put(6, 0, 9 + bob, 0x050607);
  line(-2, 1, 7 + bob, 3, 1, 7 + bob, IRON_M);
  put(-3, 1, 7 + bob, P.WOOD_D);
  put(-3, 2, 7 + bob, P.WOOD_M);
}

function addTripod(
  put: (forward: number, side: number, z: number, color: number) => void,
  line: (fromF: number, fromS: number, fromZ: number, toF: number, toS: number, toZ: number, color: number) => void,
  anim: MachineGunAnim,
  frame: number
): void {
  const brace = anim === 'move' && frame % 2 === 1 ? 1 : 0;
  put(0, 0, 4, IRON_L);
  put(0, 0, 5, IRON_M);
  line(0, 0, 4, -4 - brace, -2, 0, IRON_M);
  line(0, 0, 4, -4 - brace, 2, 0, IRON_M);
  line(0, 0, 4, 2 + brace, 0, 0, IRON_M);
  put(-5 - brace, -2, 0, IRON_D);
  put(-5 - brace, 2, 0, IRON_D);
  put(3 + brace, 0, 0, IRON_D);
}

function addReceiverAndBarrel(
  put: (forward: number, side: number, z: number, color: number) => void,
  box: (f0: number, s0: number, z0: number, f1: number, s1: number, z1: number, color: number) => void,
  line: (fromF: number, fromS: number, fromZ: number, toF: number, toS: number, toZ: number, color: number) => void,
  anim: MachineGunAnim,
  frame: number
): void {
  const recoil = anim === 'attack' && frame === 1 ? -1 : 0;
  box(-1 + recoil, -1, 5, 1 + recoil, 1, 7, IRON_D);
  box(0 + recoil, -1, 7, 1 + recoil, 1, 8, IRON_M);
  put(0 + recoil, -1, 9, BARREL_L);
  put(1 + recoil, 1, 9, BARREL_L);

  // Short water jacket, then a thin muzzle extension.
  box(1 + recoil, -1, 7, 5 + recoil, 1, 8, BARREL_D);
  line(1 + recoil, 0, 9, 5 + recoil, 0, 9, BARREL_L);
  line(5 + recoil, 0, 7, 9 + recoil, 0, 7, IRON_D);
  line(6 + recoil, -1, 8, 9 + recoil, -1, 8, IRON_M);
  put(10 + recoil, 0, 7, 0x050607);
  put(9 + recoil, 1, 8, BARREL_L);
}

function addAmmoBelt(
  put: (forward: number, side: number, z: number, color: number) => void,
  line: (fromF: number, fromS: number, fromZ: number, toF: number, toS: number, toZ: number, color: number) => void,
  anim: MachineGunAnim,
  frame: number
): void {
  const wave = anim === 'attack' ? frame - 1 : 0;
  line(-1, 2, 6, -4, 3 + wave, 4, BELT);
  for (let i = 0; i < 4; i++) {
    put(-1 - i, 2 + Math.floor(i / 2) + wave, 6 - Math.floor(i / 2), i % 2 === 0 ? BELT : P.GOLD);
  }
  put(-5, 3 + wave, 2, P.WOOD_D);
  put(-5, 4 + wave, 2, P.WOOD_M);
  put(-4, 3 + wave, 3, P.WOOD_L);
}

function addGunner(
  put: (forward: number, side: number, z: number, color: number) => void,
  box: (f0: number, s0: number, z0: number, f1: number, s1: number, z1: number, color: number) => void,
  line: (fromF: number, fromS: number, fromZ: number, toF: number, toS: number, toZ: number, color: number) => void,
  teamColor: number,
  anim: MachineGunAnim,
  frame: number
): void {
  const step = anim === 'move' && frame % 2 === 1 ? 1 : 0;
  const lean = anim === 'attack' ? 1 : 0;

  if (anim === 'move') {
    put(-3 - step, -1, 0, P.BOOTS);
    put(-1 + step, 1, 0, P.BOOTS);
    put(-3 - step, -1, 1, KHAKI_D);
    put(-1 + step, 1, 1, KHAKI_D);
    line(-3 - step, -1, 1, -3, -1, 5, KHAKI);
    line(-1 + step, 1, 1, -2, 1, 5, KHAKI);
    box(-3, -1, 5, -1, 1, 10, teamColor);
    put(-2, -1, 11, KHAKI_D);
    put(-1, 1, 11, KHAKI_D);
    put(-1, 0, 12, P.SKIN);
    put(-1, 0, 13, P.SKIN);
    put(-1, 0, 14, KHAKI_D);
    put(0, 0, 14, KHAKI_D);
    line(-2, -1, 9, 0, -1, 10, KHAKI_D);
    put(0, -1, 10, P.SKIN);
    line(-2, 1, 8, 1, 1, 9, KHAKI_D);
    put(1, 1, 9, P.SKIN);
    return;
  }

  // Upright braced stance behind the weapon.
  put(-4 - step, -1, 0, P.BOOTS);
  put(-3 + step, 1, 0, P.BOOTS);
  put(-4 - step, -1, 1, KHAKI_D);
  put(-3 + step, 1, 1, KHAKI_D);
  line(-4 - step, -1, 1, -4, -1, 4, KHAKI);
  line(-3 + step, 1, 1, -3, 1, 4, KHAKI);
  put(-4, -1, 4, KHAKI_D);
  put(-3, 1, 4, KHAKI_D);

  box(-4 + lean, -1, 5, -2 + lean, 1, 9, teamColor);
  put(-3 + lean, -1, 10, KHAKI_D);
  put(-2 + lean, 1, 10, KHAKI_D);
  put(-2 + lean, 0, 11, P.SKIN);
  put(-2 + lean, 0, 12, P.SKIN);
  put(-2 + lean, 0, 13, KHAKI_D);
  put(-1 + lean, 0, 13, KHAKI_D);

  // Arms bracing the grips.
  line(-3 + lean, -1, 8, -1, -1, 8, KHAKI_D);
  put(-1, -1, 8, P.SKIN);
  line(-3 + lean, 1, 8, 0, 1, 8, KHAKI_D);
  put(0, 1, 8, P.SKIN);
  put(-1, -2, 7, P.WOOD_D);
  put(-1, 2, 7, P.WOOD_D);
}

function addMuzzleFlash(
  put: (forward: number, side: number, z: number, color: number) => void,
  frame: number
): void {
  if (frame === 0) {
    put(11, 0, 7, FLASH);
    put(12, 0, 7, FLASH_HOT);
    put(11, -1, 8, FLASH);
  } else if (frame === 1) {
    put(11, 0, 7, FLASH_HOT);
    put(12, -1, 8, FLASH);
    put(13, -1, 8, SMOKE);
    put(13, 1, 9, SMOKE);
  } else {
    put(11, 1, 8, FLASH);
    put(12, 1, 8, FLASH_HOT);
    put(14, 1, 9, SMOKE);
  }
}
