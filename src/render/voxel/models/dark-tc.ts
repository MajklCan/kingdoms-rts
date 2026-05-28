/**
 * Dark Age Bohemian Town Center — voxel model, AoE2-styled v2.
 *
 * Iconic silhouette: warm sandstone walls with mortar lines, a central tower
 * rising above an outer keep, pitched terracotta-tile roofs on both, a
 * prominent gate-house door and arrow slits, and a team-color banner mounted
 * on the central tower.
 *
 * Why this looks more "AoE2" than v1:
 *   - Warm sandstone palette (not gray) + terracotta roof tiles
 *   - Multi-tier silhouette (outer keep + central tower) — readable from far
 *   - Soft tonal variation per row (mortar lines) instead of monochrome stone
 *   - Team color used ONLY on the banner, not on the building body
 */

import type { Voxel } from '../voxel-render';

const C = {
  // Warm sandstone walls
  STONE_L: 0xd4c096,   // top-lit sandstone
  STONE_M: 0xb89e74,   // mid-tone
  STONE_D: 0x86694a,   // shadowed / mortar courses
  STONE_BASE: 0x6f5c44, // base plinth (darker)

  // Wood timber
  WOOD_L: 0xa07442,
  WOOD_M: 0x6f4a26,
  WOOD_D: 0x4a3018,
  WOOD_DOOR: 0x3a2410,

  // Terracotta tile roof
  ROOF_L: 0xd05a40,    // tile highlight
  ROOF_M: 0xa83b25,    // main tile
  ROOF_D: 0x751a18,    // tile shadow
  ROOF_RIDGE: 0x4f1014, // ridge cap (darkest)

  // Detail
  IRON: 0x2c2418,
  GOLD: 0xc89c2c,

  // Gunpowder / Renaissance details
  BRICK_L: 0xb0664a,
  BRICK_M: 0x8b4632,
  BRICK_D: 0x5b2b22,
  PLASTER: 0xd2c7aa,
  PLASTER_L: 0xe6dcc0,
  PLASTER_D: 0x9f9072,
  GLASS: 0x40586a,
  GLASS_L: 0x7890a0,
  SLATE_L: 0x5f6873,
  SLATE_M: 0x3f4650,
  SLATE_D: 0x252b33,
  COPPER: 0x6c8f72,
  COPPER_D: 0x3f604d,
  SMOKE: 0x777a7d,

  // Ground
  GRASS_L: 0x6a8c40,
  GRASS_D: 0x4a6020,
  DIRT: 0x8a6a40,
} as const;

export type TownCenterStyle = 'dark' | 'castle' | 'gunpowder';

/** Build the Bohemian Town Center voxels. `bannerColor` is used for the flag. */
export function buildDarkTcVoxels(
  bannerColor: number,
  style: TownCenterStyle = 'dark'
): Voxel[] {
  if (style === 'castle') {
    return buildCastleTcVoxels(bannerColor);
  }
  if (style === 'gunpowder') {
    return buildGunpowderTcVoxels(bannerColor);
  }

  const out: Voxel[] = [];

  const put = (x: number, y: number, z: number, color: number) =>
    out.push({ x, y, z, color });

  const fillBox = (
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    color: number
  ) => {
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) put(x, y, z, color);
  };

  const hollowBox = (
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    wallColor: number
  ) => {
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const onShell =
            x === x0 || x === x1 || y === y0 || y === y1;
          if (onShell || z === z0 || z === z1) put(x, y, z, wallColor);
        }
  };

  // Centered around (12, 12). Footprint roughly 18×18 ground, with outer
  // keep walls 14×14 and an inner tower 6×6 stretching higher.
  const cx = 12, cy = 12;

  // ─── Ground plate: grass with a dirt path leading to the door ──────────
  for (let x = 2; x <= 22; x++) {
    for (let y = 2; y <= 22; y++) {
      const dx = x - cx, dy = y - cy;
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      if (dist > 7 && dist <= 11) {
        // outside the keep — moss/grass.
        put(x, y, 0, (x + y) % 3 === 0 ? C.GRASS_D : C.GRASS_L);
      }
    }
  }
  // Dirt path south from door (along y = 12, x = 5..11).
  for (let y = 5; y <= 11; y++) {
    put(12, y, 0, C.DIRT);
    put(13, y, 0, C.DIRT);
  }

  // ─── Stone plinth: 14×14 dark base under the outer walls ────────────────
  fillBox(cx - 7, cy - 7, 0, cx + 6, cy + 6, 0, C.STONE_BASE);

  // ─── Outer keep walls: 14×14 perimeter, 8 voxels high, sandstone ────────
  const OUT_X0 = cx - 7, OUT_X1 = cx + 6;
  const OUT_Y0 = cy - 7, OUT_Y1 = cy + 6;
  hollowBox(OUT_X0, OUT_Y0, 1, OUT_X1, OUT_Y1, 8, C.STONE_M);

  // Mortar/banded courses: every 3rd row swaps to a lighter or darker stone
  // shade. This is what kills the "minecraft monochrome" look.
  for (let z = 1; z <= 8; z++) {
    const tone = z % 3 === 0 ? C.STONE_D : z % 3 === 1 ? C.STONE_L : C.STONE_M;
    // Just along the visible (low-y / front) wall — variety where it matters.
    for (let x = OUT_X0; x <= OUT_X1; x++) {
      put(x, OUT_Y0, z, tone);
      // Right-side wall too:
      put(OUT_X1, x - OUT_X0 + OUT_Y0, z, tone);
    }
  }

  // Crenellations on the outer wall (z=9, alternating).
  for (let x = OUT_X0; x <= OUT_X1; x++) {
    if ((x - OUT_X0) % 2 === 0) {
      put(x, OUT_Y0, 9, C.STONE_L);
      put(x, OUT_Y1, 9, C.STONE_L);
    }
  }
  for (let y = OUT_Y0 + 1; y <= OUT_Y1 - 1; y++) {
    if ((y - OUT_Y0) % 2 === 0) {
      put(OUT_X0, y, 9, C.STONE_L);
      put(OUT_X1, y, 9, C.STONE_L);
    }
  }

  // ─── Gate-house door on south face (low y) ──────────────────────────────
  // Carve a 3-wide × 4-tall arched opening at x = 11..13, y = OUT_Y0, z = 1..4.
  for (let z = 1; z <= 4; z++)
    for (let x = 11; x <= 13; x++) put(x, OUT_Y0, z, C.WOOD_DOOR);
  // Iron studs.
  put(11, OUT_Y0, 2, C.IRON);
  put(13, OUT_Y0, 2, C.IRON);
  put(12, OUT_Y0, 3, C.IRON);
  // Wooden door frame.
  for (let z = 1; z <= 4; z++) {
    put(10, OUT_Y0, z, C.WOOD_D);
    put(14, OUT_Y0, z, C.WOOD_D);
  }
  for (let x = 10; x <= 14; x++) put(x, OUT_Y0, 5, C.WOOD_D);

  // ─── Arrow slits on each face ───────────────────────────────────────────
  for (const z of [4, 7]) {
    for (const off of [-4, 3]) {
      put(cx + off, OUT_Y0, z, C.IRON);
      put(cx + off, OUT_Y1, z, C.IRON);
      put(OUT_X0, cy + off, z, C.IRON);
      put(OUT_X1, cy + off, z, C.IRON);
    }
  }

  // ─── Outer roof: 14×14, low-pitched, terracotta. ───────────────────────
  // The eaves overhang slightly (16×16) at the very base.
  // Eaves trim — dark wood lip just under the tiles.
  fillBox(OUT_X0 - 1, OUT_Y0 - 1, 9, OUT_X1 + 1, OUT_Y1 + 1, 9, C.WOOD_D);
  // Skip crenellations: re-stamp them on top of the wood trim.
  for (let x = OUT_X0; x <= OUT_X1; x++) {
    if ((x - OUT_X0) % 2 === 0) {
      put(x, OUT_Y0, 9, C.STONE_L);
      put(x, OUT_Y1, 9, C.STONE_L);
    }
  }
  for (let y = OUT_Y0 + 1; y <= OUT_Y1 - 1; y++) {
    if ((y - OUT_Y0) % 2 === 0) {
      put(OUT_X0, y, 9, C.STONE_L);
      put(OUT_X1, y, 9, C.STONE_L);
    }
  }

  // Stepped pitched tile roof — alternates tile tones for texture.
  const tileTone = (i: number) =>
    i % 3 === 0 ? C.ROOF_L : i % 3 === 1 ? C.ROOF_M : C.ROOF_D;
  // Tier 1 z=10: 12×12
  for (let x = OUT_X0 + 1; x <= OUT_X1 - 1; x++)
    for (let y = OUT_Y0 + 1; y <= OUT_Y1 - 1; y++)
      put(x, y, 10, tileTone(x + y));
  // Tier 2 z=11: 10×10
  for (let x = OUT_X0 + 2; x <= OUT_X1 - 2; x++)
    for (let y = OUT_Y0 + 2; y <= OUT_Y1 - 2; y++)
      put(x, y, 11, tileTone(x + y + 1));
  // Tier 3 z=12: 8×8 — central tower starts emerging here.

  // ─── Central tower: 6×6 footprint, rises from z=1 to z=14 ──────────────
  const IN_X0 = cx - 3, IN_X1 = cx + 2;
  const IN_Y0 = cy - 3, IN_Y1 = cy + 2;
  // Inner tower walls hollow up to z=14, but lower portion is masked by outer keep
  // visually; that's fine — we just need the upper segment to read.
  hollowBox(IN_X0, IN_Y0, 8, IN_X1, IN_Y1, 14, C.STONE_M);
  // Banded courses on the tower.
  for (let z = 8; z <= 14; z++) {
    const tone = z % 2 === 0 ? C.STONE_L : C.STONE_M;
    for (let x = IN_X0; x <= IN_X1; x++) put(x, IN_Y0, z, tone);
    for (let y = IN_Y0 + 1; y <= IN_Y1 - 1; y++) put(IN_X0, y, z, tone);
  }
  // Tower arrow slits (one per face, higher up).
  put(cx - 1, IN_Y0, 11, C.IRON);
  put(IN_X0, cy - 1, 11, C.IRON);
  put(cx, IN_Y1, 11, C.IRON);
  put(IN_X1, cy, 11, C.IRON);

  // Tower pitched roof — 4 tiers tapering to a point.
  for (let x = IN_X0; x <= IN_X1; x++)
    for (let y = IN_Y0; y <= IN_Y1; y++) put(x, y, 15, tileTone(x + y));
  for (let x = IN_X0 + 1; x <= IN_X1 - 1; x++)
    for (let y = IN_Y0 + 1; y <= IN_Y1 - 1; y++) put(x, y, 16, tileTone(x + y + 1));
  for (let x = cx - 1; x <= cx + 1; x++)
    for (let y = cy - 1; y <= cy + 1; y++) put(x, y, 17, tileTone(x + y));
  put(cx, cy, 18, C.ROOF_RIDGE);
  put(cx - 1, cy, 18, C.ROOF_D);
  put(cx + 1, cy, 18, C.ROOF_D);
  put(cx, cy - 1, 18, C.ROOF_D);
  put(cx, cy + 1, 18, C.ROOF_D);

  // ─── Banner pole + team-color flag on tower top ─────────────────────────
  for (let z = 19; z <= 23; z++) put(cx, cy, z, C.WOOD_D);
  // Gold finial on top.
  put(cx, cy, 24, C.GOLD);
  // Flag — flies south-east (positive x, positive y) in 3 stripes.
  for (let i = 1; i <= 3; i++) {
    put(cx + i, cy, 22, bannerColor);
    put(cx + i, cy, 21, bannerColor);
  }
  // Tail darker.
  put(cx + 3, cy, 22, shade24(bannerColor, 0.7));
  put(cx + 3, cy, 21, shade24(bannerColor, 0.7));
  // Heraldic stripe — a single contrast voxel.
  put(cx + 2, cy, 22, C.GOLD);

  return out;
}

function buildCastleTcVoxels(bannerColor: number): Voxel[] {
  const out: Voxel[] = [];

  const S = {
    STONE_HI: 0xd8d6c8,
    STONE_L: 0xc1bead,
    STONE_M: 0xa19d8c,
    STONE_D: 0x716d5f,
    STONE_BASE: 0x565145,
    WALK: 0x8e8a79,
    MOSS: 0x5c7040,
    MOSS_D: 0x3f4f2e,
  } as const;

  const put = (x: number, y: number, z: number, color: number) =>
    out.push({ x, y, z, color });

  const fillBox = (
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    color: number
  ) => {
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) put(x, y, z, color);
  };

  const wallBox = (
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    color: number
  ) => {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        put(x, y0, z, color);
        put(x, y1, z, color);
      }
      for (let y = y0 + 1; y <= y1 - 1; y++) {
        put(x0, y, z, color);
        put(x1, y, z, color);
      }
    }
  };

  const courseTone = (z: number) =>
    z % 4 === 0 ? S.STONE_D : z % 4 === 1 ? S.STONE_HI : S.STONE_L;

  const faceCourses = (
    x0: number, y0: number,
    x1: number, y1: number,
    z0: number, z1: number
  ) => {
    for (let z = z0; z <= z1; z++) {
      const tone = courseTone(z);
      for (let x = x0; x <= x1; x++) put(x, y0, z, tone);
      for (let y = y0 + 1; y <= y1; y++) put(x1, y, z, tone);
    }
  };

  const addBattlements = (
    x0: number, y0: number,
    x1: number, y1: number,
    z: number
  ) => {
    for (let x = x0; x <= x1; x += 2) {
      fillBox(x, y0, z, x, y0, z + 1, S.STONE_HI);
      fillBox(x, y1, z, x, y1, z + 1, S.STONE_L);
    }
    for (let y = y0 + 1; y <= y1 - 1; y += 2) {
      fillBox(x0, y, z, x0, y, z + 1, S.STONE_L);
      fillBox(x1, y, z, x1, y, z + 1, S.STONE_D);
    }
  };

  const cx = 12, cy = 12;
  const OUT_X0 = 4, OUT_Y0 = 4, OUT_X1 = 20, OUT_Y1 = 20;

  // Low-noise ground apron so the castle silhouette stays clean.
  for (let x = 1; x <= 23; x++) {
    for (let y = 1; y <= 23; y++) {
      const dist = Math.max(Math.abs(x - cx), Math.abs(y - cy));
      if (dist >= 8 && dist <= 11) {
        put(x, y, 0, (x + y) % 4 === 0 ? S.MOSS_D : S.MOSS);
      }
    }
  }
  for (let y = 1; y <= OUT_Y0; y++) {
    put(11, y, 0, C.DIRT);
    put(12, y, 0, C.DIRT);
    put(13, y, 0, C.DIRT);
  }

  fillBox(OUT_X0, OUT_Y0, 0, OUT_X1, OUT_Y1, 0, S.STONE_BASE);

  // Curtain wall: flat stone, no terracotta roof, with readable battlements.
  wallBox(OUT_X0, OUT_Y0, 1, OUT_X1, OUT_Y1, 7, S.STONE_M);
  faceCourses(OUT_X0, OUT_Y0, OUT_X1, OUT_Y1, 1, 7);
  fillBox(OUT_X0 + 1, OUT_Y0 + 1, 8, OUT_X1 - 1, OUT_Y1 - 1, 8, S.WALK);
  addBattlements(OUT_X0, OUT_Y0, OUT_X1, OUT_Y1, 9);

  // Squared gatehouse, kept simple so it reads as a castle front at game zoom.
  fillBox(9, 3, 1, 15, 5, 8, S.STONE_D);
  faceCourses(9, 3, 15, 5, 1, 8);
  fillBox(10, 3, 9, 14, 4, 9, S.WALK);
  addBattlements(9, 3, 15, 5, 10);
  for (let z = 1; z <= 5; z++)
    for (let x = 11; x <= 13; x++) put(x, 3, z, C.WOOD_DOOR);
  put(10, 3, 2, C.WOOD_D);
  put(14, 3, 2, C.WOOD_D);
  put(10, 3, 3, C.WOOD_D);
  put(14, 3, 3, C.WOOD_D);
  for (let x = 10; x <= 14; x++) put(x, 3, 6, C.WOOD_D);
  put(12, 3, 4, C.GOLD);
  put(12, 3, 6, C.IRON);

  const towers = [
    { x0: 3, y0: 3, x1: 7, y1: 7 },
    { x0: 17, y0: 3, x1: 21, y1: 7 },
    { x0: 3, y0: 17, x1: 7, y1: 21 },
    { x0: 17, y0: 17, x1: 21, y1: 21 },
  ];
  for (const tower of towers) {
    fillBox(tower.x0, tower.y0, 1, tower.x1, tower.y1, 10, S.STONE_M);
    faceCourses(tower.x0, tower.y0, tower.x1, tower.y1, 1, 10);
    fillBox(tower.x0 + 1, tower.y0 + 1, 11, tower.x1 - 1, tower.y1 - 1, 11, S.WALK);
    addBattlements(tower.x0, tower.y0, tower.x1, tower.y1, 12);
    const mx = Math.floor((tower.x0 + tower.x1) / 2);
    const my = Math.floor((tower.y0 + tower.y1) / 2);
    put(mx, tower.y0, 6, C.IRON);
    put(tower.x1, my, 6, C.IRON);
    put(mx, tower.y0, 9, C.IRON);
    put(tower.x1, my, 9, C.IRON);
  }

  // Central keep: a compact, higher stone block with battlements instead of a roof.
  const KX0 = 8, KY0 = 9, KX1 = 16, KY1 = 17;
  fillBox(KX0, KY0, 1, KX1, KY1, 13, S.STONE_M);
  faceCourses(KX0, KY0, KX1, KY1, 1, 13);
  fillBox(KX0 + 1, KY0 + 1, 14, KX1 - 1, KY1 - 1, 14, S.WALK);
  addBattlements(KX0, KY0, KX1, KY1, 15);

  for (const z of [7, 11]) {
    put(10, KY0, z, C.IRON);
    put(12, KY0, z, C.IRON);
    put(14, KY0, z, C.IRON);
    put(KX1, 11, z, C.IRON);
    put(KX1, 13, z, C.IRON);
    put(KX1, 15, z, C.IRON);
  }

  // Small team-color accents only; the building body remains neutral stone.
  for (let z = 16; z <= 20; z++) put(cx, cy, z, C.WOOD_D);
  put(cx, cy, 21, C.GOLD);
  for (let i = 1; i <= 4; i++) {
    put(cx + i, cy, 19, i === 4 ? shade24(bannerColor, 0.65) : bannerColor);
    put(cx + i, cy, 18, i === 4 ? shade24(bannerColor, 0.65) : bannerColor);
  }
  put(cx + 2, cy, 19, C.GOLD);

  put(9, 3, 7, bannerColor);
  put(15, 3, 7, bannerColor);
  put(9, 3, 6, shade24(bannerColor, 0.75));
  put(15, 3, 6, shade24(bannerColor, 0.75));

  return out;
}

function buildGunpowderTcVoxels(bannerColor: number): Voxel[] {
  const out: Voxel[] = [];

  const put = (x: number, y: number, z: number, color: number) =>
    out.push({ x, y, z, color });

  const fillBox = (
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    color: number
  ) => {
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) put(x, y, z, color);
  };

  const addFacedBox = (
    x0: number, y0: number,
    x1: number, y1: number,
    z0: number, z1: number,
    light: number,
    mid: number,
    dark: number
  ) => {
    fillBox(x0, y0, z0, x1, y1, z1, mid);
    for (let z = z0; z <= z1; z++) {
      const tone = z % 3 === 0 ? dark : z % 3 === 1 ? light : mid;
      for (let x = x0; x <= x1; x++) {
        put(x, y0, z, tone);
        put(x, y1, z, shade24(tone, 0.82));
      }
      for (let y = y0 + 1; y <= y1 - 1; y++) {
        put(x0, y, z, shade24(tone, 0.9));
        put(x1, y, z, shade24(tone, 0.7));
      }
    }
  };

  const addTerracottaRoof = (
    x0: number, y0: number,
    x1: number, y1: number,
    z: number
  ) => {
    fillBox(x0 - 1, y0 - 1, z, x1 + 1, y1 + 1, z, C.WOOD_D);
    const maxInset = Math.min(5, Math.floor((x1 - x0) / 2), Math.floor((y1 - y0) / 2));
    for (let inset = 0; inset <= maxInset; inset++) {
      const tone = inset % 3 === 0 ? C.ROOF_L : inset % 3 === 1 ? C.ROOF_M : C.ROOF_D;
      for (let x = x0 + inset; x <= x1 - inset; x++)
        for (let y = y0 + inset; y <= y1 - inset; y++)
          put(x, y, z + 1 + inset, tone);
    }
    const roofCx = Math.floor((x0 + x1) / 2);
    const roofCy = Math.floor((y0 + y1) / 2);
    fillBox(roofCx - 5, roofCy, z + maxInset + 2, roofCx + 5, roofCy + 1, z + maxInset + 2, C.ROOF_RIDGE);
  };

  const addWindow = (x: number, y: number, z: number) => {
    put(x, y, z, C.GLASS);
    put(x + 1, y, z, C.GLASS_L);
    put(x, y, z + 1, C.GLASS_L);
    put(x + 1, y, z + 1, C.GLASS);
    put(x - 1, y, z, C.WOOD_D);
    put(x + 2, y, z, C.WOOD_D);
    put(x, y, z - 1, C.WOOD_D);
    put(x + 1, y, z - 1, C.WOOD_D);
  };

  const cx = 12, cy = 12;
  const HALL_X0 = 3, HALL_Y0 = 8, HALL_X1 = 21, HALL_Y1 = 16;

  // Ordered civic square: a broad footprint makes this read as a town hall
  // rather than a compact military emplacement.
  for (let x = 1; x <= 23; x++) {
    for (let y = 1; y <= 23; y++) {
      const edge = Math.max(Math.abs(x - cx), Math.abs(y - cy));
      if (edge <= 11) put(x, y, 0, (x + y) % 2 === 0 ? 0x746b5a : 0x5b5345);
    }
  }
  for (let y = 1; y <= HALL_Y0; y++) {
    put(11, y, 0, C.DIRT);
    put(12, y, 0, C.DIRT);
    put(13, y, 0, C.DIRT);
  }

  // Main Renaissance civic hall: pale plaster over a stone/brick base.
  fillBox(HALL_X0, HALL_Y0, 0, HALL_X1, HALL_Y1, 0, C.STONE_BASE);
  addFacedBox(HALL_X0, HALL_Y0, HALL_X1, HALL_Y1, 1, 2, C.STONE_L, C.STONE_M, C.STONE_D);
  addFacedBox(HALL_X0, HALL_Y0, HALL_X1, HALL_Y1, 3, 9, C.PLASTER_L, C.PLASTER, C.PLASTER_D);

  // Brick corner quoins and pilasters give the white mass readable edges.
  for (const x of [HALL_X0, HALL_X1]) {
    fillBox(x, HALL_Y0, 3, x, HALL_Y1, 9, C.BRICK_M);
  }
  for (const x of [8, 16]) {
    fillBox(x, HALL_Y0, 3, x, HALL_Y0, 9, C.BRICK_D);
  }
  for (const z of [5, 8]) {
    for (let x = HALL_X0; x <= HALL_X1; x++) {
      put(x, HALL_Y0, z, C.BRICK_L);
      put(x, HALL_Y1, z, C.BRICK_M);
    }
  }

  // Front arcade: three clear arches, with the middle arch as the main door.
  for (const arch of [
    { x0: 6, x1: 8, door: false },
    { x0: 11, x1: 13, door: true },
    { x0: 16, x1: 18, door: false },
  ]) {
    for (let z = 3; z <= 6; z++)
      for (let x = arch.x0; x <= arch.x1; x++)
        put(x, HALL_Y0, z, arch.door ? C.WOOD_DOOR : C.IRON);
    for (let z = 3; z <= 7; z++) {
      put(arch.x0 - 1, HALL_Y0, z, C.BRICK_D);
      put(arch.x1 + 1, HALL_Y0, z, C.BRICK_D);
    }
    for (let x = arch.x0 - 1; x <= arch.x1 + 1; x++) put(x, HALL_Y0, 7, C.BRICK_L);
  }

  addWindow(6, HALL_Y0, 8);
  addWindow(16, HALL_Y0, 8);
  for (const y of [9, 13, 16]) {
    addWindow(HALL_X1, y, 5);
  }

  // Dominant red roof: the era shift is visible from game zoom, but it remains
  // a civic building rather than another castle.
  addTerracottaRoof(HALL_X0, HALL_Y0, HALL_X1, HALL_Y1, 10);

  // Clock and bell tower: the clearest "town hall" marker.
  const TX0 = 5, TY0 = 8, TX1 = 9, TY1 = 12;
  const towerCx = 7, towerCy = 10;
  addFacedBox(TX0, TY0, TX1, TY1, 10, 19, C.PLASTER_L, C.PLASTER, C.PLASTER_D);
  fillBox(TX0, TY0, 10, TX0, TY1, 19, C.BRICK_M);
  fillBox(TX1, TY0, 10, TX1, TY1, 19, C.BRICK_D);
  fillBox(TX0 + 1, TY0, 16, TX1 - 1, TY0, 17, C.PLASTER_L);
  put(towerCx, TY0, 16, C.GOLD);
  put(towerCx, TY0, 17, C.IRON);
  put(towerCx - 1, TY0, 16, C.IRON);
  put(towerCx + 1, TY0, 16, C.IRON);
  fillBox(towerCx - 1, TY0, 12, towerCx, TY0, 13, C.GLASS);
  fillBox(towerCx + 1, TY0, 12, towerCx + 2, TY0, 13, C.GLASS_L);

  // Tower roof and spire.
  fillBox(TX0 - 1, TY0 - 1, 20, TX1 + 1, TY1 + 1, 20, C.WOOD_D);
  for (let inset = 0; inset <= 3; inset++) {
    const tone = inset % 2 === 0 ? C.ROOF_L : C.ROOF_M;
    for (let x = TX0 - 1 + inset; x <= TX1 + 1 - inset; x++)
      for (let y = TY0 - 1 + inset; y <= TY1 + 1 - inset; y++)
        put(x, y, 21 + inset, tone);
  }
  put(towerCx, towerCy, 25, C.COPPER);
  put(towerCx, towerCy, 26, C.COPPER_D);

  // Team identity: front banners and a tower flag.
  for (const x of [9, 15]) {
    put(x, HALL_Y0, 8, bannerColor);
    put(x, HALL_Y0, 7, bannerColor);
    put(x, HALL_Y0, 6, shade24(bannerColor, 0.72));
  }
  for (let z = 23; z <= 27; z++) put(towerCx, towerCy, z, C.WOOD_D);
  put(towerCx, towerCy, 28, C.GOLD);
  for (let i = 1; i <= 4; i++) {
    put(towerCx + i, towerCy, 26, i === 4 ? shade24(bannerColor, 0.65) : bannerColor);
    put(towerCx + i, towerCy, 25, i === 4 ? shade24(bannerColor, 0.65) : bannerColor);
  }

  return out;
}

/** RGB shade helper duplicated locally (keeps this file dep-free). */
function shade24(color: number, factor: number): number {
  const r = Math.min(255, Math.max(0, Math.round(((color >> 16) & 0xff) * factor)));
  const g = Math.min(255, Math.max(0, Math.round(((color >> 8) & 0xff) * factor)));
  const b = Math.min(255, Math.max(0, Math.round((color & 0xff) * factor)));
  return (r << 16) | (g << 8) | b;
}
