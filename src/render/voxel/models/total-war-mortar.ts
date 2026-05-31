/**
 * Total War Age mortar team. The silhouette deliberately reads differently from
 * both the machine gun (low tripod, horizontal barrel) and the field cannon
 * (long flat carriage): a heavy baseplate, a short bipod, and a stubby tube
 * angled steeply skyward for indirect fire, with a loader dropping a shell and
 * a smoke puff blooming from the muzzle during the attack frames.
 */

import type { Voxel, VoxelBakeOptions } from '../voxel-render';
import { PALETTE as P } from '../palette';

export const MORTAR_FACINGS = [
  'E',
  'SE',
  'S',
  'SW',
  'W',
  'NW',
  'N',
  'NE',
] as const;

export const MORTAR_ANIMS = ['idle', 'move', 'attack'] as const;

export type MortarFacing = (typeof MORTAR_FACINGS)[number];
export type MortarAnim = (typeof MORTAR_ANIMS)[number];

export const MORTAR_FRAME_COUNTS: Record<MortarAnim, number> = {
  idle: 1,
  move: 2,
  attack: 3,
};

export const MORTAR_BAKE_BOUNDS: NonNullable<VoxelBakeOptions['bounds']> = {
  minX: -2,
  maxX: 25,
  minY: -2,
  maxY: 25,
  minZ: 0,
  maxZ: 23,
};

interface MortarPose {
  facing?: MortarFacing;
  anim?: MortarAnim;
  frame?: number;
}

const FACING_VECTOR: Record<MortarFacing, { fx: number; fy: number }> = {
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
const TUBE_D = 0x171c20;
const TUBE_M = 0x363d42;
const TUBE_L = 0x6b757c;
const KHAKI = 0x6e6842;
const KHAKI_D = 0x49472d;
const SHELL = 0x7c5e2e;
const SHELL_TIP = 0xb89a4a;
const FLASH = 0xffd66b;
const FLASH_HOT = 0xff6a3a;
const SMOKE = 0xb7bdc0;
const SMOKE_D = 0x8a9094;

type PutFn = (forward: number, side: number, z: number, color: number) => void;
type BoxFn = (
  f0: number,
  s0: number,
  z0: number,
  f1: number,
  s1: number,
  z1: number,
  color: number
) => void;
type LineFn = (
  fromF: number,
  fromS: number,
  fromZ: number,
  toF: number,
  toS: number,
  toZ: number,
  color: number
) => void;

export function buildMortarVoxels(teamColor: number, pose: MortarPose = {}): Voxel[] {
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

  const put: PutFn = (forward, side, z, color) => {
    const f = forward * forwardScale;
    const s = side * sideScale;
    const x = Math.round(CENTER_X + f * fx + s * sx);
    const y = Math.round(CENTER_Y + f * fy + s * sy);
    cells.set(`${x},${y},${z}`, { x, y, z, color });
  };
  const box: BoxFn = (f0, s0, z0, f1, s1, z1, color) => {
    for (let z = z0; z <= z1; z++)
      for (let f = f0; f <= f1; f++)
        for (let s = s0; s <= s1; s++) put(f, s, z, color);
  };
  const line: LineFn = (fromF, fromS, fromZ, toF, toS, toZ, color) => {
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
    addHaulingTeam(put, box, line, teamColor, frame, screenHorizontal);
  } else {
    addBaseplate(put, box);
    addBipod(put, line);
    addTube(put, line, anim, frame);
    addLoader(put, box, line, teamColor, anim, frame);
    if (anim === 'attack') {
      addShellAndSmoke(put, frame);
    }
  }

  return Array.from(cells.values());
}

/** Flat steel baseplate the tube recoils into. */
function addBaseplate(put: PutFn, box: BoxFn): void {
  box(-3, -2, 0, 1, 2, 0, IRON_M);
  box(-2, -1, 1, 0, 1, 1, IRON_D);
  put(-3, -2, 0, IRON_L);
  put(-3, 2, 0, IRON_L);
  put(1, -2, 0, IRON_L);
  put(1, 2, 0, IRON_L);
}

/** Two forward bipod legs bracing the muzzle end. */
function addBipod(put: PutFn, line: LineFn): void {
  line(-1, 0, 5, 4, -2, 0, IRON_M);
  line(-1, 0, 5, 4, 2, 0, IRON_M);
  put(4, -2, 0, IRON_D);
  put(4, 2, 0, IRON_D);
  // Elevation screw between the legs.
  put(0, 0, 3, IRON_L);
  put(1, 0, 4, IRON_L);
}

/** Stubby tube angled steeply up-and-forward. */
function addTube(put: PutFn, line: LineFn, anim: MortarAnim, frame: number): void {
  // Recoil snap on the first attack frame: tube kicks back-and-down a touch.
  const recoil = anim === 'attack' && frame === 1 ? -1 : 0;
  const baseF = -2 + recoil;
  const baseZ = 2;
  const muzzleF = 4 + recoil;
  const muzzleZ = 15;
  // Twin core lines give the tube a 2-voxel thickness.
  line(baseF, 0, baseZ, muzzleF, 0, muzzleZ, TUBE_D);
  line(baseF, -1, baseZ, muzzleF, -1, muzzleZ, TUBE_M);
  line(baseF + 1, 0, baseZ + 1, muzzleF + 1, 0, muzzleZ, TUBE_L);
  // Breech cap at the bottom, open muzzle ring at the top.
  put(baseF - 1, 0, baseZ - 1, IRON_D);
  put(baseF, 1, baseZ, TUBE_M);
  put(muzzleF, 1, muzzleZ, TUBE_L);
  put(muzzleF, -1, muzzleZ, TUBE_L);
  put(muzzleF + 1, 0, muzzleZ + 1, 0x05080a);
}

/** Loader kneeling to the side; on attack he raises a shell over the muzzle. */
function addLoader(
  put: PutFn,
  box: BoxFn,
  line: LineFn,
  teamColor: number,
  anim: MortarAnim,
  frame: number
): void {
  const reach = anim === 'attack' && frame === 0 ? 1 : 0;
  // Legs + boots, set back and to one side of the tube.
  put(-5, 3, 0, P.BOOTS);
  put(-4, 4, 0, P.BOOTS);
  line(-5, 3, 1, -4, 3, 4, KHAKI);
  line(-4, 4, 1, -4, 4, 4, KHAKI);
  // Torso in team colour.
  box(-5, 3, 5, -4, 4, 9, teamColor);
  put(-4, 3, 10, KHAKI_D);
  // Head + helmet.
  put(-4, 3, 11, P.SKIN);
  put(-4, 3, 12, KHAKI_D);
  put(-5, 3, 12, KHAKI_D);
  // Arms reaching toward the muzzle (raise when loading).
  line(-4, 3, 9, -1, 2, 10 + reach, KHAKI_D);
  put(-1, 2, 10 + reach, P.SKIN);
}

/** Shell dropping into the muzzle, then the smoke bloom after it fires. */
function addShellAndSmoke(put: PutFn, frame: number): void {
  if (frame === 0) {
    // Shell poised above the muzzle.
    put(4, 0, 18, SHELL);
    put(4, 0, 19, SHELL_TIP);
    put(4, 0, 17, SHELL);
  } else if (frame === 1) {
    // Muzzle flash at the lip.
    put(4, 0, 16, FLASH_HOT);
    put(5, 0, 17, FLASH);
    put(4, -1, 17, SMOKE);
    put(5, 1, 18, SMOKE_D);
  } else {
    // Drifting smoke ring.
    put(5, 0, 18, SMOKE);
    put(5, -1, 19, SMOKE_D);
    put(6, 1, 19, SMOKE);
    put(5, 0, 20, SMOKE_D);
  }
}

/**
 * Relocating: a two-man crew hauls the broken-down mortar — the long tube
 * carried across both their shoulders with the heavy baseplate slung beneath
 * the middle. The whole load bobs and the bearers stride out of phase so it
 * reads as a laborious team carry rather than one soldier with a gun.
 */
function addHaulingTeam(
  put: PutFn,
  box: BoxFn,
  line: LineFn,
  teamColor: number,
  frame: number,
  compact: boolean
): void {
  const bob = frame % 2 === 0 ? 0 : 1; // load rises/sinks with each step
  const stride = frame % 2 === 0 ? 1 : -1;

  if (compact) {
    // Screen-horizontal facings (NE/SW): the forward axis runs straight across
    // the screen, so spacing the bearers far apart fore/aft just makes a wide,
    // flat "crab". Pull them close and stagger them sideways so one reads as
    // nearer/lower and the load becomes a tight diagonal two-man carry.
    addBearer(put, box, line, teamColor, 3, stride, bob, -1, -2);
    addBearer(put, box, line, teamColor, -3, -stride, bob, 1, 2);

    const z = 10 + bob;
    // Tube slung from the rear bearer's far shoulder to the front bearer's near
    // shoulder — diagonal in both side and height, never a flat bar.
    line(-4, 2, z, 0, 0, z + 1, TUBE_D);
    line(0, 0, z + 1, 5, -2, z, TUBE_M);
    line(-3, 2, z + 1, 4, -2, z + 1, TUBE_L); // top highlight
    put(-5, 2, z, IRON_D); // breech
    put(6, -2, z, 0x05080a); // muzzle bore

    // Baseplate slung between them.
    box(-1, -1, 5 + bob, 1, 1, 7 + bob, IRON_M);
    put(0, 0, 4 + bob, IRON_D);
    put(0, 1, 7 + bob, IRON_L);
    return;
  }

  // Front bearer leads (+forward), rear bearer trails (−forward), out of phase.
  addBearer(put, box, line, teamColor, 5, stride, bob, -1, 0);
  addBearer(put, box, line, teamColor, -5, -stride, bob, 1, 0);

  // Tube laid across both shoulders, sagging slightly under its weight.
  const z = 10 + bob;
  line(-7, 0, z, -2, 0, z - 1, TUBE_D);
  line(-2, 0, z - 1, 3, 0, z - 1, TUBE_M);
  line(3, 0, z - 1, 7, 0, z, TUBE_D);
  line(-6, -1, z, 6, -1, z - 1, TUBE_L); // top highlight strip
  put(-8, 0, z, IRON_D); // breech end
  put(8, 0, z, 0x05080a); // muzzle bore

  // Baseplate slung underneath the mid-span — the heavy half of the load.
  box(-1, -1, 5 + bob, 1, 1, 7 + bob, IRON_M);
  put(0, 0, 4 + bob, IRON_D);
  put(-1, -1, 7 + bob, IRON_L);
  put(1, 1, 7 + bob, IRON_L);
}

/**
 * One bearer for the carry team. `baseF`/`baseS` are its forward/side offsets;
 * `stride` swings the lead foot; `innerDir` points the gripping arm toward the
 * tube's centre (so each bearer reaches in toward the load).
 */
function addBearer(
  put: PutFn,
  box: BoxFn,
  line: LineFn,
  teamColor: number,
  baseF: number,
  stride: number,
  bob: number,
  innerDir: number,
  baseS: number
): void {
  // Boots + legs, lead foot swung forward by `stride`.
  put(baseF + stride, baseS - 1, 0, P.BOOTS);
  put(baseF - stride, baseS + 1, 0, P.BOOTS);
  line(baseF + stride, baseS - 1, 1, baseF, baseS - 1, 4, KHAKI);
  line(baseF - stride, baseS + 1, 1, baseF, baseS + 1, 4, KHAKI);

  // Torso in team colour, head + helmet on top.
  box(baseF, baseS - 1, 5, baseF, baseS + 1, 9 + bob, teamColor);
  put(baseF, baseS - 1, 9 + bob, KHAKI_D);
  put(baseF, baseS + 1, 9 + bob, KHAKI_D);
  put(baseF, baseS, 10 + bob, P.SKIN);
  put(baseF, baseS, 11 + bob, KHAKI_D);

  // Inner arm raised to grip the shouldered tube.
  line(baseF, baseS, 9 + bob, baseF + innerDir, baseS, 10 + bob, KHAKI_D);
  put(baseF + innerDir, baseS, 10 + bob, P.SKIN);
}
