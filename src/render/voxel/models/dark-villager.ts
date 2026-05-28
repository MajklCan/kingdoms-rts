/**
 * Dark Age villager. Authored as a small local voxel rig and posed for
 * directional idle, walking, carrying, harvesting, and building states.
 */

import type { Voxel, VoxelBakeOptions } from '../voxel-render';
import { PALETTE as P } from '../palette';

export const VILLAGER_FACINGS = [
  'E',
  'SE',
  'S',
  'SW',
  'W',
  'NW',
  'N',
  'NE',
] as const;

export const VILLAGER_ANIMS = ['idle', 'move', 'carry', 'harvest', 'build'] as const;

export type VillagerFacing = (typeof VILLAGER_FACINGS)[number];
export type VillagerAnim = (typeof VILLAGER_ANIMS)[number];

export const VILLAGER_FRAME_COUNTS: Record<VillagerAnim, number> = {
  idle: 1,
  move: 2,
  carry: 2,
  harvest: 2,
  build: 2,
};

export const VILLAGER_BAKE_BOUNDS: NonNullable<VoxelBakeOptions['bounds']> = {
  minX: 0,
  maxX: 12,
  minY: 0,
  maxY: 12,
  minZ: 0,
  maxZ: 15,
};

interface VillagerPose {
  facing?: VillagerFacing;
  anim?: VillagerAnim;
  frame?: number;
}

const FACING_VECTOR: Record<VillagerFacing, { fx: number; fy: number }> = {
  E: { fx: 1, fy: 0 },
  SE: { fx: 1, fy: 1 },
  S: { fx: 0, fy: 1 },
  SW: { fx: -1, fy: 1 },
  W: { fx: -1, fy: 0 },
  NW: { fx: -1, fy: -1 },
  N: { fx: 0, fy: -1 },
  NE: { fx: 1, fy: -1 },
};

const CENTER_X = 6;
const CENTER_Y = 6;

export function buildVillagerVoxels(teamColor: number, pose: VillagerPose = {}): Voxel[] {
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

  const isMoving = anim === 'move' || anim === 'carry';
  const stride = isMoving ? (frame % 2 === 0 ? 1 : -1) : 0;

  // Feet and legs. Movement alternates the side legs along the facing axis.
  for (const side of [-1, 1] as const) {
    const footF = stride * side;
    put(footF, side, 0, P.BOOTS);
    put(footF, side, 1, P.BOOTS);
    put(0, side, 2, P.WOOD_M);
    put(0, side, 3, P.WOOD_M);
  }

  // Tunic, belt, and team-color chest strip.
  box(-1, -1, 4, 0, 1, 7, P.TUNIC_BROWN);
  box(-1, -1, 4, 0, 1, 4, P.WOOD_D);
  put(1, -1, 6, teamColor);
  put(1, 0, 6, teamColor);
  put(1, 1, 6, teamColor);

  // Head, hair/hood, and hood point.
  put(0, 0, 8, P.SKIN);
  box(0, -1, 9, 1, 0, 10, P.SKIN);
  box(0, -1, 11, 1, 0, 11, P.HAIR_BROWN);
  put(1, -1, 12, P.HAIR_BROWN);
  put(1, 0, 12, P.HAIR_BROWN);
  put(0, 0, 13, P.HAIR_BROWN);

  if (anim === 'harvest') {
    addHarvestPose(put, line, frame);
  } else if (anim === 'build') {
    addBuildPose(put, line, frame);
  } else if (anim === 'carry') {
    addCarryPose(put, line, frame);
  } else {
    addNeutralArms(put, line, isMoving ? frame : 0);
  }

  return Array.from(cells.values());
}

function addNeutralArms(
  put: (forward: number, side: number, z: number, c: number) => void,
  line: (fromF: number, fromS: number, fromZ: number, toF: number, toS: number, toZ: number, c: number) => void,
  frame: number
): void {
  const swing = frame % 2 === 0 ? 1 : -1;
  line(0, -2, 7, swing, -2, 4, P.TUNIC_BROWN);
  put(swing, -2, 4, P.SKIN);
  line(0, 2, 7, -swing, 2, 4, P.TUNIC_BROWN);
  put(-swing, 2, 4, P.SKIN);
  line(swing, -2, 5, swing, -2, 8, P.WOOD_L);
}

function addCarryPose(
  put: (forward: number, side: number, z: number, c: number) => void,
  line: (fromF: number, fromS: number, fromZ: number, toF: number, toS: number, toZ: number, c: number) => void,
  frame: number
): void {
  const lift = frame % 2;
  line(0, -2, 7, 2, -1, 6 + lift, P.TUNIC_BROWN);
  line(0, 2, 7, 2, 1, 6 + lift, P.TUNIC_BROWN);
  put(2, -1, 6 + lift, P.SKIN);
  put(2, 1, 6 + lift, P.SKIN);
  boxLocal(put, 2, -1, 4 + lift, 3, 1, 5 + lift, P.WOOD_D);
  put(3, 0, 6 + lift, P.THATCH_M);
  put(2, -1, 6 + lift, P.THATCH_L);
  put(2, 1, 6 + lift, P.THATCH_L);
}

function addHarvestPose(
  put: (forward: number, side: number, z: number, c: number) => void,
  line: (fromF: number, fromS: number, fromZ: number, toF: number, toS: number, toZ: number, c: number) => void,
  frame: number
): void {
  if (frame % 2 === 0) {
    line(0, -2, 7, 2, -1, 10, P.TUNIC_BROWN);
    line(0, 2, 7, 2, 1, 9, P.TUNIC_BROWN);
    put(2, -1, 10, P.SKIN);
    put(2, 1, 9, P.SKIN);
    line(2, 0, 10, 4, 0, 13, P.WOOD_L);
    put(4, -1, 13, P.STEEL);
    put(4, 1, 13, P.STEEL);
  } else {
    line(0, -2, 7, 2, -1, 5, P.TUNIC_BROWN);
    line(0, 2, 7, 2, 1, 5, P.TUNIC_BROWN);
    put(2, -1, 5, P.SKIN);
    put(2, 1, 5, P.SKIN);
    line(2, 0, 6, 5, 0, 1, P.WOOD_L);
    put(5, -1, 1, P.STEEL);
    put(5, 1, 1, P.STEEL);
    put(5, 0, 0, P.DIRT_L);
    put(4, 1, 0, P.DIRT_M);
  }
}

function addBuildPose(
  put: (forward: number, side: number, z: number, c: number) => void,
  line: (fromF: number, fromS: number, fromZ: number, toF: number, toS: number, toZ: number, c: number) => void,
  frame: number
): void {
  if (frame % 2 === 0) {
    line(0, -2, 7, 2, -1, 11, P.TUNIC_BROWN);
    put(2, -1, 11, P.SKIN);
    line(2, -1, 11, 3, -1, 14, P.WOOD_L);
    put(3, -1, 15, P.IRON);
    put(3, 0, 15, P.IRON);
    line(0, 2, 7, 1, 2, 5, P.TUNIC_BROWN);
    put(1, 2, 5, P.SKIN);
  } else {
    line(0, -2, 7, 3, -1, 5, P.TUNIC_BROWN);
    put(3, -1, 5, P.SKIN);
    line(3, -1, 5, 4, -1, 2, P.WOOD_L);
    put(4, -1, 1, P.IRON);
    put(4, 0, 1, P.IRON);
    line(0, 2, 7, 1, 2, 5, P.TUNIC_BROWN);
    put(1, 2, 5, P.SKIN);
    put(4, 0, 0, P.STONE_D);
  }
}

function boxLocal(
  put: (forward: number, side: number, z: number, c: number) => void,
  f0: number,
  s0: number,
  z0: number,
  f1: number,
  s1: number,
  z1: number,
  c: number
): void {
  for (let z = z0; z <= z1; z++) {
    for (let f = f0; f <= f1; f++) {
      for (let s = s0; s <= s1; s++) put(f, s, z, c);
    }
  }
}
