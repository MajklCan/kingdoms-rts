/**
 * Gunpowder Age field cannon. Authored for a strong game-zoom silhouette:
 * oversized spoked wheels, a thick bronze-black barrel, wooden carriage,
 * powder chest, and a small crewman for scale.
 */

import type { Voxel, VoxelBakeOptions } from '../voxel-render';
import { PALETTE as P } from '../palette';

export const CANNON_FACINGS = [
  'E',
  'SE',
  'S',
  'SW',
  'W',
  'NW',
  'N',
  'NE',
] as const;

export const CANNON_ANIMS = ['idle', 'move', 'attack'] as const;

export type CannonFacing = (typeof CANNON_FACINGS)[number];
export type CannonAnim = (typeof CANNON_ANIMS)[number];

export const CANNON_FRAME_COUNTS: Record<CannonAnim, number> = {
  idle: 1,
  move: 2,
  attack: 2,
};

export const CANNON_BAKE_BOUNDS: NonNullable<VoxelBakeOptions['bounds']> = {
  minX: -4,
  maxX: 32,
  minY: -4,
  maxY: 32,
  minZ: 0,
  maxZ: 19,
};

interface CannonPose {
  facing?: CannonFacing;
  anim?: CannonAnim;
  frame?: number;
}

const FACING_VECTOR: Record<CannonFacing, { fx: number; fy: number }> = {
  E: { fx: 1, fy: 0 },
  SE: { fx: 1, fy: 1 },
  S: { fx: 0, fy: 1 },
  SW: { fx: -1, fy: 1 },
  W: { fx: -1, fy: 0 },
  NW: { fx: -1, fy: -1 },
  N: { fx: 0, fy: -1 },
  NE: { fx: 1, fy: -1 },
};

const CENTER_X = 12;
const CENTER_Y = 12;
const IRON_D = 0x121416;
const IRON_M = 0x2e3437;
const IRON_L = 0x566066;
const BRONZE_D = 0x5c4323;
const BRONZE_L = 0xc08a3c;
const FLASH = 0xf7d56a;
const FLASH_HOT = 0xf06a43;
const SMOKE = 0xaeb5b8;
const SMOKE_D = 0x727b80;

export function buildCannonVoxels(teamColor: number, pose: CannonPose = {}): Voxel[] {
  const facing = pose.facing ?? 'SE';
  const anim = pose.anim ?? 'idle';
  const frame = pose.frame ?? 0;
  const { fx, fy } = FACING_VECTOR[facing];
  const sx = -fy;
  const sy = fx;
  const screenHorizontal = facing === 'NE' || facing === 'SW';
  const screenVertical = facing === 'SE' || facing === 'NW';
  const forwardScale = screenHorizontal ? 0.58 : screenVertical ? 0.78 : 1;
  const sideScale = screenHorizontal ? 0.78 : screenVertical ? 0.7 : 1;
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

  const recoil = anim === 'attack' && frame % 2 === 1 ? -2 : 0;
  const wheelPhase = anim === 'move' ? frame % 2 : 0;

  addCarriage(put, box, line, teamColor, recoil);
  addWheel(put, -1, -5, wheelPhase);
  addWheel(put, -1, 5, 1 - wheelPhase);
  addBarrel(put, box, line, recoil);
  addCrewman(put, line, teamColor, anim, frame);

  if (anim === 'attack' && frame % 2 === 1) {
    addMuzzleBlast(put, 14 + recoil);
  }

  return Array.from(cells.values());
}

function addCarriage(
  put: (forward: number, side: number, z: number, color: number) => void,
  box: (f0: number, s0: number, z0: number, f1: number, s1: number, z1: number, color: number) => void,
  line: (fromF: number, fromS: number, fromZ: number, toF: number, toS: number, toZ: number, color: number) => void,
  teamColor: number,
  recoil: number
): void {
  // Split trail and side beams make the unit read as a cannon carriage, not a cart.
  line(-8, 0, 1, -3, 0, 3, P.WOOD_D);
  line(-7, -1, 1, -3, -1, 3, P.WOOD_M);
  line(-7, 1, 1, -3, 1, 3, P.WOOD_M);
  box(-5, -2, 2, 3, -2, 3, P.WOOD_D);
  box(-5, 2, 2, 3, 2, 3, P.WOOD_D);
  box(-3, -3, 3, 3, 3, 4, P.WOOD_M);
  box(-2, -2, 4, 2, 2, 5, P.WOOD_D);

  // Cross axle and iron bands.
  box(-2, -6, 3, 1, 6, 3, IRON_D);
  box(-1, -6, 4, 0, 6, 4, IRON_M);

  // Recoil bed under the barrel.
  box(-1 + recoil, -2, 5, 5 + recoil, 2, 5, P.WOOD_D);
  box(0 + recoil, -1, 6, 4 + recoil, 1, 6, teamColor);
  put(2 + recoil, -2, 6, P.GOLD);
  put(2 + recoil, 2, 6, P.GOLD);

  // Powder chest at the rear.
  box(-7, -2, 2, -5, 2, 5, P.WOOD_DOOR);
  box(-7, -2, 5, -5, 2, 5, P.WOOD_L);
  put(-6, 0, 6, P.GOLD);
  put(-5, -1, 6, IRON_L);
}

function addBarrel(
  put: (forward: number, side: number, z: number, color: number) => void,
  box: (f0: number, s0: number, z0: number, f1: number, s1: number, z1: number, color: number) => void,
  line: (fromF: number, fromS: number, fromZ: number, toF: number, toS: number, toZ: number, color: number) => void,
  recoil: number
): void {
  const r = recoil;

  // Broad breech block.
  box(-3 + r, -2, 6, 1 + r, 2, 8, IRON_D);
  box(-2 + r, -1, 9, 1 + r, 1, 10, IRON_M);
  put(-2 + r, -2, 9, IRON_L);
  put(-2 + r, 2, 9, IRON_L);

  // Long dark tube. The light top edge makes the barrel readable over grass.
  box(1 + r, -2, 7, 5 + r, 2, 9, IRON_M);
  box(5 + r, -1, 8, 10 + r, 1, 10, IRON_M);
  line(2 + r, 0, 10, 10 + r, 0, 12, IRON_L);
  line(3 + r, -1, 10, 11 + r, -1, 11, P.STEEL);
  line(6 + r, 1, 9, 11 + r, 1, 10, IRON_D);

  // Brass retaining bands break up the tube without making it read as wood.
  box(2 + r, -2, 7, 2 + r, 2, 10, BRONZE_L);
  box(6 + r, -1, 8, 6 + r, 1, 11, BRONZE_D);

  // Heavy black muzzle and visible bore.
  box(10 + r, -2, 8, 13 + r, 2, 11, IRON_D);
  box(13 + r, -1, 9, 14 + r, 1, 10, 0x050607);
  put(14 + r, 0, 10, 0x000000);
  put(13 + r, -2, 12, IRON_L);
  put(13 + r, 2, 12, IRON_L);
  put(12 + r, 0, 12, P.STEEL);
}

function addWheel(
  put: (forward: number, side: number, z: number, color: number) => void,
  centerF: number,
  side: number,
  phase: number
): void {
  // Large vertical wheel silhouette on each side of the carriage.
  const rim: Array<[number, number]> = [
    [0, 0],
    [-1, 1],
    [1, 1],
    [-2, 2],
    [2, 2],
    [-2, 3],
    [2, 3],
    [-1, 4],
    [1, 4],
    [0, 5],
  ];
  for (const [df, z] of rim) put(centerF + df, side, z, P.WOOD_D);
  for (const [df, z] of [[0, 1], [-1, 2], [1, 2], [-1, 3], [1, 3], [0, 4]] as const) {
    put(centerF + df, side, z, P.WOOD_L);
  }

  // Hub and alternating spokes.
  put(centerF, side, 2, IRON_M);
  put(centerF, side, 3, IRON_L);
  if (phase === 0) {
    put(centerF, side, 0, P.WOOD_L);
    put(centerF, side, 5, P.WOOD_L);
    put(centerF - 2, side, 2, P.WOOD_L);
    put(centerF + 2, side, 3, P.WOOD_L);
  } else {
    put(centerF - 1, side, 1, P.WOOD_L);
    put(centerF + 1, side, 4, P.WOOD_L);
    put(centerF + 1, side, 1, P.WOOD_L);
    put(centerF - 1, side, 4, P.WOOD_L);
  }
}

function addCrewman(
  put: (forward: number, side: number, z: number, color: number) => void,
  line: (fromF: number, fromS: number, fromZ: number, toF: number, toS: number, toZ: number, color: number) => void,
  teamColor: number,
  anim: CannonAnim,
  frame: number
): void {
  const lean = anim === 'attack' && frame % 2 === 0 ? 1 : 0;
  const f = -5 + lean;
  const s = -6;

  put(f - 1, s, 0, P.BOOTS);
  put(f + 1, s, 0, P.BOOTS);
  put(f - 1, s, 1, P.LEATHER_D);
  put(f + 1, s, 1, P.LEATHER_D);
  put(f, s, 2, P.LEATHER);
  put(f, s, 3, teamColor);
  put(f, s, 4, teamColor);
  put(f, s, 5, P.MAIL_D);
  put(f, s, 6, P.SKIN);
  put(f, s, 7, P.SKIN);
  put(f, s, 8, P.MAIL_D);

  // Rammer or linstock held toward the breech.
  line(f + 1, s + 1, 5, -1, -2, 6, P.WOOD_L);
  put(f + 1, s + 1, 5, P.SKIN);
}

function addMuzzleBlast(
  put: (forward: number, side: number, z: number, color: number) => void,
  tipF: number
): void {
  put(tipF + 1, 0, 9, FLASH);
  put(tipF + 2, 0, 9, FLASH_HOT);
  put(tipF + 1, -1, 10, FLASH);
  put(tipF + 1, 1, 10, FLASH);
  put(tipF + 2, -1, 11, SMOKE);
  put(tipF + 3, 0, 11, SMOKE_D);
  put(tipF + 3, 1, 12, SMOKE);
  put(tipF + 4, 0, 13, SMOKE_D);
}
