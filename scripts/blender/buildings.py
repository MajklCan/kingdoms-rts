"""Building sprites for every BuildingDefId (src/sim/defs.ts), per era.

Footprints are centred on the origin: an n x n building spans [-n/2, n/2]
on X and Y. The anchor is the bottom (camera-nearest) footprint corner.
Visible walls are -Y (front-left, sunlit) and +X (front-right, shade).

Eras: dark (timber, thatch, wattle and daub), castle (stone, lime plaster,
red tile, Bohemian gothic), gunpowder (renaissance and baroque, brick).
Buildings that only exist from a later age (foundry) or look the same in
every age (farm) have fewer variants; the engine falls back to the newest
variant that is not newer than the player's age.
"""

from __future__ import annotations

import math
import random

import bpy
from mathutils import Euler, Matrix, Vector

from bld_common import DOOR_W, baroque_gable, chimney, hall, stairs, style, wall_banner
from kr_kit import B
from kr_lib import Job

ERAS = ("dark", "castle", "gunpowder")


def _b(col: bpy.types.Collection, rng: random.Random) -> B:
    return B(col, rng)


def _roof_vent(b: B, x: float, y: float, z: float) -> None:
    """Small wooden smoke louvre on a thatched ridge."""
    b.box(x - 0.05, y - 0.04, z - 0.04, x + 0.05, y + 0.04, z + 0.05, "planks_dark", 0.005)
    b.gable_roof(x - 0.05, y - 0.05, x + 0.05, y + 0.05, z + 0.05, 0.04, "shingle", axis="x", overhang=0.015,
                 thick=0.012)


def _dummy(b: B, x: float, y: float) -> None:
    b.cyl((x, y, 0), (x, y, 0.5), 0.016, "log", segs=6)
    b.beam((x - 0.12, y, 0.38), (x + 0.12, y, 0.38), 0.022, "log")
    b.sphere((x, y, 0.33), 0.065, "hay", scale=(1, 0.8, 1.3), subdiv=2)
    b.sphere((x, y, 0.47), 0.04, "cloth", subdiv=2)
    # shield on the arm, facing the camera-left side
    b.cyl((x + 0.1, y - 0.03, 0.34), (x + 0.1, y - 0.045, 0.34), 0.055, "team_paint", segs=12, smooth=False)


def _weapon_rack(b: B, x: float, y: float, axis: str = "x", n: int = 4, pole_m: str = "log") -> None:
    w = 0.26
    if axis == "x":
        b.cyl((x - w / 2, y, 0), (x - w / 2, y, 0.3), 0.012, pole_m, segs=6)
        b.cyl((x + w / 2, y, 0), (x + w / 2, y, 0.3), 0.012, pole_m, segs=6)
        b.beam((x - w / 2, y, 0.27), (x + w / 2, y, 0.27), 0.016, "timber")
        for i in range(n):
            px = x - w / 2 + w * (i + 0.5) / n
            b.cyl((px, y - 0.06, 0), (px + 0.01, y + 0.01, 0.62), 0.007, "timber", segs=5)
            b.cone(px + 0.01, y + 0.01, 0.62, 0.012, 0.06, "iron", segs=6)
    else:
        b.cyl((x, y - w / 2, 0), (x, y - w / 2, 0.3), 0.012, pole_m, segs=6)
        b.cyl((x, y + w / 2, 0), (x, y + w / 2, 0.3), 0.012, pole_m, segs=6)
        b.beam((x, y - w / 2, 0.27), (x, y + w / 2, 0.27), 0.016, "timber")
        for i in range(n):
            py = y - w / 2 + w * (i + 0.5) / n
            b.cyl((x + 0.06, py, 0), (x - 0.01, py + 0.01, 0.62), 0.007, "timber", segs=5)
            b.cone(x - 0.01, py + 0.01, 0.62, 0.012, 0.06, "iron", segs=6)


def _target(b: B, x: float, y: float, z: float = 0.12, r: float = 0.12) -> None:
    """Straw archery butt on an easel, face towards -y (visible)."""
    for dx in (-0.08, 0.08):
        b.cyl((x + dx, y - 0.03, 0), (x + dx * 0.4, y + 0.01, z + r + 0.05), 0.01, "timber", segs=5)
    b.cyl((x, y + 0.1, 0), (x, y + 0.02, z + r), 0.01, "timber", segs=5)
    b.cyl((x, y - 0.01, z + r), (x, y + 0.05, z + r), r, "straw", segs=20, smooth=True)
    b.cyl((x, y - 0.016, z + r), (x, y - 0.01, z + r), r * 0.86, "team_paint", segs=20)
    b.cyl((x, y - 0.02, z + r), (x, y - 0.014, z + r), r * 0.6, "white", segs=20)
    b.cyl((x, y - 0.024, z + r), (x, y - 0.018, z + r), r * 0.28, "cloth_red", segs=16)


def _well(b: B, x: float, y: float, stone: str = "fieldstone", roof: str = "shingle") -> None:
    b.cyl((x, y, 0), (x, y, 0.16), 0.11, stone, segs=14, smooth=False)
    b.cyl((x, y, 0.16), (x, y, 0.162), 0.085, "water", segs=14)
    for dy in (-0.1, 0.1):
        b.cyl((x, y + dy, 0.1), (x, y + dy, 0.42), 0.012, "timber", segs=6)
    b.cyl((x, y - 0.1, 0.32), (x, y + 0.1, 0.32), 0.018, "log", segs=8)
    b.gable_roof(x - 0.08, y - 0.13, x + 0.08, y + 0.13, 0.42, 0.1, roof, axis="y", overhang=0.02, thick=0.015)


# ---------------------------------------------------------------------------
# House (1x1)
# ---------------------------------------------------------------------------


def house(col, rng, era: str) -> None:
    b = _b(col, rng)
    st = style(era)
    b.pad(1, 1, "dirt")
    if era == "dark":
        x0, y0, x1, y1 = -0.36, -0.30, 0.34, 0.24
        ridge = hall(b, x0, y0, x1, y1, 0.62, st, axis="x", doors=(("-y", 0.64),),
                     windows=(("+x", 0.5, 0.3, 0.12, 0.11),), shutters="planks")
        _roof_vent(b, -0.12, -0.03, ridge - 0.02)
        b.log_pile(0.42, -0.02, 0.32, axis="y", rows=3, r=0.022)
        b.barrel(0.1, -0.4)
        wall_banner(b, "-y", x0, y0, x1, y1, 0.26, 0.58, 0.11, 0.2)
        b.cyl((-0.4, -0.41, 0), (-0.4, -0.41, 0.06), 0.045, "log", segs=8, cap_m="log_end")
    elif era == "castle":
        x0, y0, x1, y1 = -0.34, -0.32, 0.32, 0.26
        hall(b, x0, y0, x1, y1, 0.42, st, roof="none", frame=False, wall_m="ashlar",
             doors=(("-y", 0.68, 0.22, 0.34),), arch_doors=True,
             windows=(("+x", 0.5, 0.18, 0.1, 0.12),))
        j = 0.035
        b.box(x0 - j, y0 - j, 0.40, x1 + j, y1 + j, 0.44, "timber", 0.006)
        ridge = hall(b, x0 - j, y0 - j, x1 + j, y1 + j, 0.4, st, roof="gable", axis="y", z0=0.44, base=False,
                     windows=(("-y", 0.3, 0.12, 0.1, 0.13), ("-y", 0.72, 0.12, 0.1, 0.13), ("+x", 0.5, 0.12, 0.1, 0.13)),
                     shutters="team_paint", pitch=1.35)
        chimney(b, 0.12, 0.12, 0.8, ridge + 0.04, "brick", 0.07)
        b.barrel(0.42, -0.25)
        b.crate(0.4, -0.4, 0, 0.07, 0.3)
    else:
        x0, y0, x1, y1 = -0.34, -0.30, 0.32, 0.28
        hall(b, x0, y0, x1, y1, 0.86, st, roof="none", frame=False,
             doors=(("-y", 0.5, 0.22, 0.4),), arch_doors=True,
             windows=(("-y", 0.2, 0.52, 0.1, 0.16), ("-y", 0.8, 0.52, 0.1, 0.16),
                      ("+x", 0.3, 0.52, 0.1, 0.16), ("+x", 0.75, 0.52, 0.1, 0.16),
                      ("+x", 0.3, 0.2, 0.1, 0.14), ("+x", 0.75, 0.2, 0.1, 0.14)),
             shutters="team_paint")
        b.box(x0 - 0.02, y0 - 0.02, 0.84, x1 + 0.02, y1 + 0.02, 0.88, "plaster", 0.008)
        b.box(x0 - 0.01, y0 - 0.01, 0.44, x1 + 0.01, y1 + 0.01, 0.46, "plaster", 0.004)
        b.gable_roof(x0, y0, x1, y1, 0.88, 0.38, "tile_dark", axis="y", overhang=0.04, thick=0.035,
                     gable_m="plaster_ochre", ridge_m="tile_dark")
        baroque_gable(b, x0 + 0.02, x1 - 0.02, y0, 0.88, 0.42, "plaster_ochre", "plaster")
        b.opening("-y", x0, y0 - 0.05, x1, y1, 0.5, 1.02, 0.08, 0.1, "glass", frame_m="plaster", arch=True)
        chimney(b, 0.16, 0.16, 0.9, 1.4, "brick", 0.07)
        b.barrel(0.43, -0.2)


# ---------------------------------------------------------------------------
# Town center (3x3)
# ---------------------------------------------------------------------------


def town_center(col, rng, era: str) -> None:
    b = _b(col, rng)
    st = style(era)
    b.pad(3, 3, "dirt" if era == "dark" else "gravel", inset=0.06)
    ax0, ay0, ax1, ay1 = -1.3, 0.45, 1.25, 1.3   # back hall
    bx0, by0, bx1, by1 = -1.3, -1.25, -0.5, 0.45  # left wing
    tx0, ty0, tx1, ty1 = -0.32, -0.38, 0.42, 0.36  # central tower
    if era == "dark":
        hall(b, ax0, ay0, ax1, ay1, 0.86, st, axis="x", pitch=1.2,
             doors=(("-y", 0.78, 0.32, 0.55),),
             windows=(("-y", 0.2, 0.4, 0.13, 0.12), ("-y", 0.92, 0.4, 0.13, 0.12), ("+x", 0.5, 0.4, 0.14, 0.12)),
             shutters="planks")
        hall(b, bx0, by0, bx1, by1, 0.8, st, axis="y", pitch=1.2,
             doors=(("+x", 0.32),),
             windows=(("-y", 0.5, 0.36, 0.14, 0.12), ("+x", 0.75, 0.36, 0.13, 0.12)), shutters="planks")
        _roof_vent(b, 0.6, 0.875, 0.86 + 0.5 - 0.02)
        # central timber tower
        b.box(tx0 - 0.03, ty0 - 0.03, 0, tx1 + 0.03, ty1 + 0.03, 0.22, "fieldstone", 0.012)
        b.box(tx0, ty0, 0.2, tx1, ty1, 1.72, "daub", 0.006)
        b.timber_frame(tx0, ty0, tx1, ty1, 0.22, 0.95, "timber", spacing=0.24)
        b.timber_frame(tx0, ty0, tx1, ty1, 0.95, 1.72, "timber", spacing=0.24, braces=False)
        b.opening("-y", tx0, ty0, tx1, ty1, 0.5, 0.18, 0.28, 0.5, "door", frame_m="timber")
        b.opening("-y", tx0, ty0, tx1, ty1, 0.5, 1.2, 0.12, 0.14, "void", frame_m="timber", shutters="team_paint")
        b.opening("+x", tx0, ty0, tx1, ty1, 0.5, 1.2, 0.12, 0.14, "void", frame_m="timber", shutters="team_paint")
        g = 0.07
        b.box(tx0 - g, ty0 - g, 1.72, tx1 + g, ty1 + g, 1.77, "planks", 0.006)
        for (px, py) in ((tx0 - g, ty0 - g), (tx1 + g, ty0 - g), (tx1 + g, ty1 + g), (tx0 - g, ty1 + g)):
            b.cyl((px, py, 1.77), (px, py, 2.1), 0.022, "log", segs=6)
        b.box(tx0 - g, ty0 - g - 0.005, 1.77, tx1 + g, ty0 - g + 0.015, 1.92, "planks", 0.004)
        b.box(tx1 + g - 0.015, ty0 - g, 1.77, tx1 + g + 0.005, ty1 + g, 1.92, "planks", 0.004)
        b.hip_roof(tx0 - g, ty0 - g, tx1 + g, ty1 + g, 2.1, 0.62, "thatch", overhang=0.1, thick=0.08, rough=0.016)
        b.banner(0.05, -0.01, 2.6, 0.45, 0.24, 0.15)
        wall_banner(b, "-y", tx0, ty0, tx1, ty1, 0.5, 0.95, 0.16, 0.3)
        wall_banner(b, "+x", tx0, ty0, tx1, ty1, 0.5, 0.95, 0.16, 0.3)
        _well(b, 0.95, -0.95)
        b.cart(0.95, 0.05, rot=math.radians(80), load="logs")
        b.log_pile(0.55, -1.2, 0.5, "x", 3, 0.026)
        for i, (px, py) in enumerate(((-0.42, -1.05), (-0.42, -0.9), (-0.3, -1.12))):
            b.barrel(px, py)
        b.sack(0.65, -0.55)
        b.sack(0.72, -0.62)
        b.crate(1.2, -0.45, 0, 0.09, 0.4)
        b.crate(1.18, -0.33, 0, 0.07, 0.1)
    elif era == "castle":
        hall(b, ax0, ay0, ax1, ay1, 0.45, st, roof="none", frame=False, wall_m="ashlar",
             doors=(("-y", 0.78, 0.3, 0.38),), arch_doors=True,
             windows=(("-y", 0.2, 0.2, 0.1, 0.14), ("-y", 0.92, 0.2, 0.1, 0.14), ("+x", 0.5, 0.2, 0.1, 0.14)))
        j = 0.035
        b.box(ax0 - j, ay0 - j, 0.43, ax1 + j, ay1 + j, 0.47, "timber", 0.006)
        hall(b, ax0 - j, ay0 - j, ax1 + j, ay1 + j, 0.45, st, axis="x", z0=0.47, base=False, pitch=1.25,
             windows=(("-y", 0.1, 0.13, 0.1, 0.14), ("-y", 0.3, 0.13, 0.1, 0.14), ("-y", 0.5, 0.13, 0.1, 0.14),
                      ("-y", 0.9, 0.13, 0.1, 0.14), ("+x", 0.5, 0.13, 0.1, 0.14)), shutters="team_paint")
        chimney(b, 0.9, 1.05, 1.0, 1.6, "brick", 0.08)
        hall(b, bx0, by0, bx1, by1, 0.88, st, axis="y", wall_m="ashlar", frame=False, pitch=1.25,
             doors=(("+x", 0.32, 0.24, 0.42),), arch_doors=True,
             windows=(("-y", 0.5, 0.42, 0.1, 0.18), ("+x", 0.75, 0.42, 0.1, 0.18)))
        # central keep
        k0, k1 = (tx0 - 0.04, ty0 - 0.04), (tx1 + 0.04, ty1 + 0.04)
        b.box(k0[0] - 0.05, k0[1] - 0.05, 0, k1[0] + 0.05, k1[1] + 0.05, 0.25, "ashlar_grey", 0.015)
        b.box(k0[0], k0[1], 0.2, k1[0], k1[1], 2.15, "ashlar", 0.01)
        b.box(k0[0] - 0.015, k0[1] - 0.015, 1.1, k1[0] + 0.015, k1[1] + 0.015, 1.14, "ashlar_grey", 0.005)
        b.opening("-y", *k0, *k1, 0.5, 0.2, 0.26, 0.42, "door", frame_m="ashlar_grey", arch=True)
        for z in (0.75, 1.35, 1.75):
            b.opening("-y", *k0, *k1, 0.5, z, 0.05, 0.16, "void", frame_m=None)
            b.opening("+x", *k0, *k1, 0.5, z, 0.05, 0.16, "void", frame_m=None)
        # corbelled parapet
        p = 0.05
        b.box(k0[0] - p, k0[1] - p, 2.1, k1[0] + p, k1[1] + p, 2.2, "ashlar_grey", 0.008)
        b.crenellate(k0[0] - p + 0.03, k0[1] - p + 0.03, k1[0] + p - 0.03, k1[1] + p - 0.03, 2.2, 0.09, "ashlar_grey",
                     merlon=0.08, gap=0.06, t=0.05)
        b.hip_roof(k0[0] + 0.05, k0[1] + 0.05, k1[0] - 0.05, k1[1] - 0.05, 2.2, 0.85, "tile_red", overhang=0.04)
        for (px, py) in ((k0[0] - p, k0[1] - p), (k1[0] + p, k0[1] - p), (k1[0] + p, k1[1] + p), (k0[0] - p, k1[1] + p)):
            b.cyl((px, py, 2.0), (px, py, 2.32), 0.075, "ashlar", segs=12, smooth=False)
            b.cone(px, py, 2.32, 0.095, 0.3, "tile_red", segs=12)
        b.banner(0.05, -0.01, 3.0, 0.4, 0.24, 0.15, pole_m="iron")
        wall_banner(b, "-y", *k0, *k1, 0.5, 1.68, 0.18, 0.34)
        wall_banner(b, "+x", *k0, *k1, 0.5, 1.68, 0.18, 0.34)
        _well(b, 0.95, -0.95, "ashlar", "tile_red")
        b.cart(0.95, 0.05, rot=math.radians(80), load="sacks")
        for px, py in ((-0.42, -1.05), (-0.42, -0.9)):
            b.barrel(px, py)
        b.crate(1.2, -0.45, 0, 0.09, 0.4)
        b.stone_pile(0.55, -1.15, 5, 0.05)
    else:
        # renaissance town hall with arcade and a baroque clock tower
        hall(b, ax0, ay0, ax1, ay1, 1.0, st, roof="none", frame=False,
             windows=tuple(("-y", t, 0.62, 0.1, 0.18) for t in (0.1, 0.3, 0.5, 0.7, 0.9))
             + (("+x", 0.5, 0.62, 0.1, 0.18),), shutters="team_paint")
        for i in range(6):
            t = (i + 0.5) / 6
            b.opening("-y", ax0, ay0, ax1, ay1, t, 0.08, 0.26, 0.26, "void", frame_m="plaster", arch=True)
        b.box(ax0 - 0.02, ay0 - 0.02, 0.98, ax1 + 0.02, ay1 + 0.02, 1.03, "plaster", 0.008)
        b.box(ax0 - 0.01, ay0 - 0.01, 0.48, ax1 + 0.01, ay1 + 0.01, 0.5, "plaster", 0.004)
        b.hip_roof(ax0, ay0, ax1, ay1, 1.03, 0.45, "tile_dark", overhang=0.05)
        for t in (0.2, 0.8):
            x = ax0 + (ax1 - ax0) * t
            b.box(x - 0.06, ay0 + 0.08, 1.05, x + 0.06, ay0 + 0.2, 1.2, "plaster", 0.006)
            b.opening("-y", x - 0.06, ay0 + 0.08, x + 0.06, ay0 + 0.2, 0.5, 1.07, 0.06, 0.09, "glass", frame_m="white")
            b.gable_roof(x - 0.07, ay0 + 0.06, x + 0.07, ay0 + 0.22, 1.2, 0.07, "tile_dark", axis="y", overhang=0.01,
                         thick=0.015)
        hall(b, bx0, by0, bx1, by1, 0.92, style("gunpowder"), wall_m="plaster_rose", frame=False, axis="y",
             roof_m="tile_dark", doors=(("+x", 0.32, 0.24, 0.42),), arch_doors=True,
             windows=(("-y", 0.3, 0.5, 0.1, 0.18), ("-y", 0.7, 0.5, 0.1, 0.18), ("+x", 0.75, 0.5, 0.1, 0.18)),
             shutters="team_paint", pitch=1.0)
        baroque_gable(b, bx0 + 0.04, bx1 - 0.04, by0, 0.92, 0.36, "plaster_rose", "plaster")
        # clock tower
        k0, k1 = (tx0 + 0.02, ty0 + 0.02), (tx1 - 0.02, ty1 - 0.02)
        b.box(k0[0] - 0.04, k0[1] - 0.04, 0, k1[0] + 0.04, k1[1] + 0.04, 0.2, "ashlar_grey", 0.012)
        b.box(k0[0], k0[1], 0.18, k1[0], k1[1], 2.05, "plaster_ochre", 0.008)
        for z in (0.95, 2.0):
            b.box(k0[0] - 0.025, k0[1] - 0.025, z, k1[0] + 0.025, k1[1] + 0.025, z + 0.05, "plaster", 0.006)
        b.opening("-y", *k0, *k1, 0.5, 0.18, 0.26, 0.44, "door", frame_m="ashlar_grey", arch=True)
        b.opening("-y", *k0, *k1, 0.5, 1.15, 0.1, 0.2, "glass", frame_m="white", arch=True)
        b.opening("+x", *k0, *k1, 0.5, 1.15, 0.1, 0.2, "glass", frame_m="white", arch=True)
        cxm, cym = (k0[0] + k1[0]) / 2, (k0[1] + k1[1]) / 2
        for side in ("-y", "+x"):
            if side == "-y":
                p0, p1 = (cxm, k0[1] - 0.005, 1.68), (cxm, k0[1] - 0.02, 1.68)
            else:
                p0, p1 = (k1[0] + 0.005, cym, 1.68), (k1[0] + 0.02, cym, 1.68)
            b.cyl(p0, p1, 0.14, "white", segs=24, smooth=False)
            b.cyl(p0, p1, 0.15, "gold", segs=24, smooth=False)
        b.beam((cxm, k0[1] - 0.025, 1.68), (cxm + 0.0, k0[1] - 0.025, 1.79), 0.014, "iron", d=0.006)
        b.beam((cxm, k0[1] - 0.025, 1.68), (cxm + 0.07, k0[1] - 0.025, 1.68), 0.014, "iron", d=0.006)
        b.beam((k1[0] + 0.025, cym, 1.68), (k1[0] + 0.025, cym, 1.79), 0.014, "iron", d=0.006)
        # onion dome, lantern, spire
        r = (k1[0] - k0[0]) / 2
        b.lathe([(r + 0.02, 2.05), (r * 0.95, 2.12), (r * 0.98, 2.3), (r * 0.7, 2.48), (r * 0.25, 2.58), (0.07, 2.62)],
                cxm, cym, "copper", segs=20)
        b.cyl((cxm, cym, 2.6), (cxm, cym, 2.8), 0.08, "plaster", segs=10, smooth=False)
        b.lathe([(0.11, 2.8), (0.12, 2.84), (0.08, 2.92), (0.03, 2.98), (0.012, 3.12)], cxm, cym, "copper", segs=14)
        b.sphere((cxm, cym, 3.13), 0.022, "gold")
        b.banner(cxm + 0.0, cym, 3.14, 0.22, 0.18, 0.11, pole_m="iron", pennant=True)
        wall_banner(b, "-y", *k0, *k1, 0.5, 0.92, 0.16, 0.3)
        # fountain
        b.cyl((0.95, -0.95, 0), (0.95, -0.95, 0.1), 0.2, "ashlar_grey", segs=20, smooth=False)
        b.cyl((0.95, -0.95, 0.1), (0.95, -0.95, 0.102), 0.17, "water", segs=20)
        b.cyl((0.95, -0.95, 0.1), (0.95, -0.95, 0.3), 0.03, "ashlar_grey", segs=10)
        b.cyl((0.95, -0.95, 0.3), (0.95, -0.95, 0.33), 0.07, "ashlar_grey", segs=12)
        b.cart(0.95, 0.05, rot=math.radians(80), load="sacks")
        b.barrel(-0.42, -1.05)
        b.crate(1.2, -0.45, 0, 0.09, 0.4)


# ---------------------------------------------------------------------------
# Barracks (2x2)
# ---------------------------------------------------------------------------


def barracks(col, rng, era: str) -> None:
    b = _b(col, rng)
    st = style(era)
    b.pad(2, 2, "dirt")
    hx0, hy0, hx1, hy1 = -0.88, 0.08, 0.5, 0.84
    if era == "dark":
        hall(b, hx0, hy0, hx1, hy1, 0.74, st, axis="x", pitch=1.2,
             doors=(("-y", 0.5, 0.3, 0.52),),
             windows=(("-y", 0.15, 0.36, 0.12, 0.1), ("-y", 0.85, 0.36, 0.12, 0.1), ("+x", 0.5, 0.36, 0.12, 0.1)),
             shutters="planks")
        _roof_vent(b, -0.5, 0.46, 0.74 + 0.456 - 0.02)
        hall(b, 0.5, 0.16, 0.86, 0.76, 0.5, st, axis="y", pitch=1.0, doors=(("+x", 0.5, 0.2, 0.4),))
        fence_m = "log"
        b.fence([(-0.92, 0.0), (-0.92, -0.92), (-0.18, -0.92)], 0.2, fence_m)
        b.fence([(0.18, -0.92), (0.92, -0.92), (0.92, 0.05)], 0.2, fence_m)
        b.banner(-0.17, -0.93, 0.0, 0.62, 0.15, 0.1, pole_m="log")
        b.banner(0.17, -0.93, 0.0, 0.62, 0.15, 0.1, pole_m="log")
        _dummy(b, -0.5, -0.45)
        _dummy(b, -0.1, -0.55)
        _weapon_rack(b, 0.55, -0.45, axis="y")
        wall_banner(b, "-y", hx0, hy0, hx1, hy1, 0.32, 0.68, 0.13, 0.24)
        b.barrel(0.7, -0.75)
    elif era == "castle":
        hall(b, hx0, hy0, hx1, hy1, 0.45, st, roof="none", frame=False, wall_m="ashlar",
             doors=(("-y", 0.5, 0.28, 0.4),), arch_doors=True,
             windows=(("-y", 0.15, 0.2, 0.08, 0.14), ("-y", 0.85, 0.2, 0.08, 0.14), ("+x", 0.5, 0.2, 0.08, 0.14)))
        j = 0.03
        b.box(hx0 - j, hy0 - j, 0.43, hx1 + j, hy1 + j, 0.47, "timber", 0.006)
        hall(b, hx0 - j, hy0 - j, hx1 + j, hy1 + j, 0.42, st, axis="x", z0=0.47, base=False, pitch=1.2,
             windows=(("-y", 0.15, 0.13, 0.1, 0.13), ("-y", 0.5, 0.13, 0.1, 0.13), ("-y", 0.85, 0.13, 0.1, 0.13),
                      ("+x", 0.5, 0.13, 0.1, 0.13)), shutters="team_paint")
        # square tower at the right end
        t0x, t0y, t1x, t1y = 0.42, 0.2, 0.86, 0.66
        b.box(t0x - 0.03, t0y - 0.03, 0, t1x + 0.03, t1y + 0.03, 0.15, "ashlar_grey", 0.01)
        b.box(t0x, t0y, 0.1, t1x, t1y, 1.42, "ashlar", 0.008)
        b.opening("+x", t0x, t0y, t1x, t1y, 0.5, 0.15, 0.22, 0.4, "door", frame_m="ashlar_grey", arch=True)
        for z in (0.7, 1.1):
            b.opening("-y", t0x, t0y, t1x, t1y, 0.5, z, 0.05, 0.15, "void", frame_m=None)
            b.opening("+x", t0x, t0y, t1x, t1y, 0.5, z, 0.05, 0.15, "void", frame_m=None)
        b.box(t0x - 0.04, t0y - 0.04, 1.38, t1x + 0.04, t1y + 0.04, 1.46, "ashlar_grey", 0.006)
        b.crenellate(t0x - 0.015, t0y - 0.015, t1x + 0.015, t1y + 0.015, 1.46, 0.08, "ashlar_grey", 0.07, 0.05, 0.05)
        b.hip_roof(t0x + 0.03, t0y + 0.03, t1x - 0.03, t1y - 0.03, 1.46, 0.5, "tile_red", overhang=0.03)
        b.banner((t0x + t1x) / 2, (t0y + t1y) / 2, 1.95, 0.35, 0.18, 0.12, pole_m="iron")
        # low stone yard wall with gate posts
        for (a, c) in (((-0.92, 0.0), (-0.92, -0.92)), ((-0.92, -0.92), (-0.2, -0.92)),
                       ((0.2, -0.92), (0.92, -0.92)), ((0.92, -0.92), (0.92, 0.12))):
            xa, ya = a
            xc, yc = c
            b.box(min(xa, xc) - 0.04, min(ya, yc) - 0.04, 0, max(xa, xc) + 0.04, max(ya, yc) + 0.04, 0.2, "fieldstone", 0.01)
        for gx in (-0.2, 0.2):
            b.box(gx - 0.06, -0.98, 0, gx + 0.06, -0.86, 0.36, "ashlar", 0.01)
            b.cone(gx, -0.92, 0.36, 0.07, 0.1, "ashlar_grey", segs=4)
        b.banner(-0.2, -0.92, 0.46, 0.3, 0.13, 0.09, pole_m="iron")
        b.banner(0.2, -0.92, 0.46, 0.3, 0.13, 0.09, pole_m="iron")
        _dummy(b, -0.5, -0.45)
        _weapon_rack(b, 0.5, -0.45, axis="y")
        wall_banner(b, "-y", hx0, hy0, hx1, hy1, 0.32, 0.4, 0.13, 0.22)
        b.barrel(0.7, -0.7)
    else:
        hall(b, hx0, hy0 - 0.06, hx1 + 0.06, hy1, 1.0, st, roof="none", frame=False, wall_m="brick",
             doors=(("-y", 0.5, 0.26, 0.42),), arch_doors=True,
             windows=tuple(("-y", t, z, 0.1, 0.16) for t in (0.15, 0.32, 0.68, 0.85) for z in (0.22, 0.62))
             + (("-y", 0.5, 0.62, 0.1, 0.16), ("+x", 0.3, 0.22, 0.1, 0.16), ("+x", 0.7, 0.22, 0.1, 0.16),
                ("+x", 0.3, 0.62, 0.1, 0.16), ("+x", 0.7, 0.62, 0.1, 0.16)), shutters="team_paint")
        b.box(hx0 - 0.02, hy0 - 0.08, 0.98, hx1 + 0.08, hy1 + 0.02, 1.03, "ashlar_grey", 0.008)
        b.box(hx0 - 0.01, hy0 - 0.07, 0.5, hx1 + 0.07, hy1 + 0.01, 0.52, "ashlar_grey", 0.004)
        b.hip_roof(hx0, hy0 - 0.06, hx1 + 0.06, hy1, 1.03, 0.4, "tile_dark", overhang=0.05)
        # pediment over the door
        cx = (hx0 + hx1 + 0.06) / 2
        b.side_prism([(cx - 0.22, 1.0), (cx + 0.22, 1.0), (cx, 1.18)], hy0 - 0.1, hy0 - 0.02, "ashlar_grey", axis="y")
        for gx in (-0.2, 0.2):
            b.box(gx - 0.06, -0.98, 0, gx + 0.06, -0.86, 0.42, "brick", 0.008)
            b.box(gx - 0.07, -0.99, 0.42, gx + 0.07, -0.85, 0.46, "ashlar_grey", 0.005)
        for (a, c) in (((-0.92, 0.0), (-0.92, -0.92)), ((-0.92, -0.92), (-0.26, -0.92)),
                       ((0.26, -0.92), (0.92, -0.92)), ((0.92, -0.92), (0.92, 0.0))):
            xa, ya = a
            xc, yc = c
            b.box(min(xa, xc) - 0.035, min(ya, yc) - 0.035, 0, max(xa, xc) + 0.035, max(ya, yc) + 0.035, 0.22, "brick", 0.008)
        b.banner(-0.2, -0.92, 0.46, 0.34, 0.14, 0.1, pole_m="iron")
        b.banner(0.2, -0.92, 0.46, 0.34, 0.14, 0.1, pole_m="iron")
        _weapon_rack(b, -0.5, -0.5, axis="x", n=5, pole_m="timber")
        _dummy(b, 0.45, -0.45)
        b.barrel(0.7, -0.72)
        b.barrel(0.78, -0.62)


# ---------------------------------------------------------------------------
# Archery range (2x2)
# ---------------------------------------------------------------------------


def archery_range(col, rng, era: str) -> None:
    b = _b(col, rng)
    st = style(era)
    b.pad(2, 2, "dirt")
    sx0, sy0, sx1, sy1 = -0.9, -0.88, -0.3, 0.88  # shed along the left edge, open towards +x
    if era == "dark":
        # back and side walls, open front on +x carried by posts
        b.box(sx0, sy0, 0, sx0 + 0.04, sy1, 0.62, "planks", 0.004)
        b.box(sx0, sy1 - 0.04, 0, sx1, sy1, 0.62, "planks", 0.004)
        b.box(sx0, sy0, 0, sx1, sy0 + 0.04, 0.62, "planks", 0.004)
        for i in range(5):
            py = sy0 + (sy1 - sy0) * i / 4
            b.cyl((sx1, py, 0), (sx1, py, 0.64), 0.022, "log", segs=8)
        b.beam((sx1, sy0, 0.62), (sx1, sy1, 0.62), 0.035, "log")
        b.gable_roof(sx0, sy0, sx1, sy1, 0.64, 0.38, "thatch", axis="y", overhang=0.09, thick=0.075, rough=0.014,
                     ridge_m="thatch_old")
        b.box(sx0 + 0.06, -0.3, 0, sx0 + 0.2, 0.3, 0.2, "planks_dark", 0.004)  # table
        for i in range(3):
            b.cyl((sx0 + 0.1, -0.5 + 0.08 * i, 0.0), (sx0 + 0.12, -0.5 + 0.08 * i, 0.5), 0.008, "log", segs=5)
        wall_banner(b, "-y", sx0, sy0, sx1, sy1, 0.5, 0.56, 0.13, 0.24)
        b.fence([(0.92, -0.92), (-0.2, -0.92)], 0.16, "log")
        pole = "log"
    else:
        hall(b, sx0, sy0, sx0 + 0.24, sy1, 0.7, st, roof="none", frame=st.frame is not None)
        b.box(sx0, sy0, 0, sx1, sy0 + 0.1, 0.7, st.wall, 0.006)
        for i in range(4):
            py = sy0 + 0.12 + (sy1 - sy0 - 0.2) * (i + 0.5) / 4
            b.box(sx1 - 0.05, py - 0.04, 0, sx1 + 0.03, py + 0.04, 0.7, "ashlar", 0.008)
        b.beam((sx1 - 0.01, sy0, 0.67), (sx1 - 0.01, sy1, 0.67), 0.08, "ashlar_grey", d=0.06)
        b.box(sx1 - 0.05, sy0, 0, sx1 + 0.03, sy0 + 0.1, 0.7, "ashlar", 0.008)
        b.gable_roof(sx0, sy0, sx1 + 0.03, sy1, 0.7, 0.38, st.roof, axis="y", overhang=0.06, thick=0.035,
                     gable_m=st.wall, ridge_m=st.roof)
        b.opening("-y", sx0, sy0, sx1, sy0 + 0.1, 0.5, 0.25, 0.12, 0.18, "void", frame_m="timber", shutters="team_paint")
        b.box(sx0 + 0.3, -0.3, 0, sx0 + 0.44, 0.3, 0.2, "planks_dark", 0.004)
        b.fence([(0.92, -0.92), (-0.2, -0.92)], 0.16, "timber")
        b.banner(-0.24, -0.94, 0, 0.7, 0.16, 0.11, pole_m="timber")
        pole = "timber"
    for x in (0.0, 0.4, 0.78):
        _target(b, x, 0.72)
    # shooting line marks and quivers
    b.beam((-0.15, -0.3, 0.005), (0.85, -0.3, 0.005), 0.025, "planks_dark", d=0.01)
    for x in (0.1, 0.5):
        b.cyl((x, -0.4, 0), (x + 0.01, -0.38, 0.12), 0.02, "door", segs=8)
    b.banner(0.9, 0.9, 0, 0.6, 0.15, 0.1, pole_m=pole)
    b.hay_bale(0.65, -0.65, 0, 0.08, 0.3)


# ---------------------------------------------------------------------------
# Stable (2x2)
# ---------------------------------------------------------------------------


def stable(col, rng, era: str) -> None:
    b = _b(col, rng)
    st = style(era)
    b.pad(2, 2, "dirt")
    x0, y0, x1, y1 = -0.9, 0.12, 0.62, 0.86
    if era == "dark":
        hall(b, x0, y0, x1, y1, 0.62, st, axis="x", wall_m="planks", frame=False, pitch=1.15,
             windows=(("+x", 0.5, 0.52, 0.12, 0.12),))
    else:
        hall(b, x0, y0, x1, y1, 0.66, st, axis="x", pitch=1.15, windows=(("+x", 0.5, 0.5, 0.12, 0.12),),
             shutters="team_paint")
    for t in (0.18, 0.5, 0.82):
        b.opening("-y", x0, y0, x1, y1, t, 0.06, 0.26, 0.44, "void", frame_m="timber", arch=(era != "dark"))
        cx = x0 + (x1 - x0) * t
        b.box(cx - 0.13, y0 - 0.025, 0.04, cx + 0.13, y0 - 0.01, 0.24, "door", 0.003)
    # side lean-to with hay
    b.box(0.62, 0.2, 0, 0.64, 0.8, 0.02, "planks", 0)
    for py in (0.2, 0.8):
        b.cyl((0.88, py, 0), (0.88, py, 0.42), 0.018, "log", segs=6)
    b._slab([(0.92, 0.16, 0.42), (0.92, 0.84, 0.42), (0.62, 0.84, 0.56), (0.62, 0.16, 0.56)], 0.04,
            "thatch" if era == "dark" else st.roof, 0.008 if era == "dark" else 0.0)
    for i in range(3):
        b.hay_bale(0.75, 0.3 + 0.2 * i, 0, 0.09, 1.57)
    b.hay_bale(0.75, 0.4, 0.07, 0.09, 1.57)
    # paddock
    fm = "log" if era == "dark" else "timber"
    b.fence([(-0.92, 0.08), (-0.92, -0.92), (0.92, -0.92), (0.92, 0.08)], 0.2, fm, rails=2)
    b.box(0.2, -0.55, 0, 0.6, -0.45, 0.08, "planks_dark", 0.004)
    b.box(0.215, -0.54, 0.075, 0.585, -0.46, 0.078, "water", 0)
    ob = b.sphere((-0.5, -0.5, 0.0), 0.15, "hay", scale=(1.2, 1.0, 0.55))
    b.roughen(ob, 0.02, 0.05, 1)
    # team saddle blanket on the fence and a wall banner
    b.box(-0.2, -0.95, 0.1, 0.0, -0.89, 0.2, "team", 0.006)
    wall_banner(b, "-y", x0, y0, x1, y1, 0.34, 0.6, 0.12, 0.22)
    b.banner(-0.88, -0.88, 0.0, 0.62, 0.15, 0.1, pole_m=fm)
    b.barrel(0.7, -0.75)


# ---------------------------------------------------------------------------
# Farm (2x2) - growth stages instead of eras
# ---------------------------------------------------------------------------


def farm(col, rng, stage: str) -> None:
    b = _b(col, rng)
    b.pad(2, 2, "soil_plowed", inset=0.03, irregular=0.02)
    rows = 9
    hx = 0.9
    for i in range(rows):
        y = -0.85 + 1.7 * i / (rows - 1)
        b.side_prism([(y - 0.085, 0.0), (y + 0.085, 0.0), (y + 0.03, 0.04), (y - 0.03, 0.04)], -hx, hx, "soil_plowed",
                     axis="x")
        if stage == "sown":
            for k in range(14):
                x = -hx + 0.06 + (2 * hx - 0.12) * (k + rng.uniform(0.2, 0.8)) / 14
                b.cone(x, y + rng.uniform(-0.02, 0.02), 0.035, 0.015, 0.05, "crop_young", segs=5)
        elif stage in ("growing", "ripe"):
            h = 0.12 if stage == "growing" else 0.2
            m = "crop_green" if stage == "growing" else "wheat"
            ob = b.box(-hx + 0.04, y - 0.055, 0.03, hx - 0.04, y + 0.055, 0.03 + h, m, 0.02)
            b.roughen(ob, 0.03 if stage == "ripe" else 0.02, 0.04, 3)
            if stage == "ripe":
                for k in range(22):
                    x = -hx + 0.08 + (2 * hx - 0.16) * rng.random()
                    b.sphere((x, y + rng.uniform(-0.04, 0.04), 0.03 + h + rng.uniform(-0.01, 0.02)), 0.018, "wheat",
                             scale=(0.6, 0.6, 1.4), subdiv=1)
        elif stage == "depleted":
            for k in range(18):
                x = -hx + 0.05 + (2 * hx - 0.1) * rng.random()
                b.cone(x, y + rng.uniform(-0.03, 0.03), 0.03, 0.012, 0.035, "stubble", segs=4)
    # scarecrow wearing the team colour at the back corner
    sx, sy = -0.72, 0.72
    b.cyl((sx, sy, 0), (sx, sy, 0.55), 0.014, "log", segs=6)
    b.beam((sx - 0.13, sy, 0.42), (sx + 0.13, sy, 0.42), 0.018, "log")
    b.box(sx - 0.07, sy - 0.04, 0.26, sx + 0.07, sy + 0.04, 0.45, "team", 0.012)
    b.sphere((sx, sy, 0.5), 0.045, "straw", subdiv=2)
    b.cone(sx, sy, 0.52, 0.08, 0.06, "straw", segs=10)
    if stage == "ripe":
        b.hay_bale(0.82, 0.82, 0, 0.07, 0.4)


# ---------------------------------------------------------------------------
# Mill (2x2)
# ---------------------------------------------------------------------------


def _sails(b: B, hx: float, hy: float, hz: float, length: float = 0.86, width: float = 0.2, angle0: float = 45.0,
           spar_m: str = "timber") -> None:
    """Four sails in the XZ plane at y=hy (facing -y)."""
    b.cyl((hx, hy + 0.12, hz + 0.02), (hx, hy - 0.03, hz), 0.035, "log", segs=10)
    b.sphere((hx, hy - 0.035, hz), 0.04, "iron", subdiv=1)
    with b.anim("sails", pivot=(hx, hy, hz), axis=(0.0, 1.0, 0.0)):
        _sail_blades(b, hx, hy, hz, length, width, angle0, spar_m)


def _sail_blades(b: B, hx: float, hy: float, hz: float, length: float, width: float, angle0: float,
                 spar_m: str) -> None:
    for k in range(4):
        a = math.radians(angle0 + 90 * k)
        d = (math.cos(a), math.sin(a))
        n = (-d[1], d[0])

        def P(r: float, s: float, dy: float = 0.0):
            return (hx + d[0] * r + n[0] * s, hy - 0.05 + dy, hz + d[1] * r + n[1] * s)

        b.beam(P(0.0, 0), P(length, 0), 0.03, spar_m, d=0.03)
        for s in (0.02, width):
            b.beam(P(0.16, s), P(length, s), 0.012, spar_m, d=0.012)
        for i in range(6):
            r = 0.16 + (length - 0.16) * i / 5
            b.beam(P(r, 0), P(r, width), 0.01, spar_m, d=0.01)
        # cloth stretched over the lattice
        import bmesh
        bm = bmesh.new()
        vs = [bm.verts.new(P(0.18, 0.025, -0.008)), bm.verts.new(P(length - 0.02, 0.025, -0.008)),
              bm.verts.new(P(length - 0.02, width - 0.005, -0.008)), bm.verts.new(P(0.18, width - 0.005, -0.008))]
        bm.faces.new(vs)
        cloth = b.obj(bm, "cloth", "sail")
        sol = cloth.modifiers.new("solid", "SOLIDIFY")
        sol.thickness = 0.005
        # team-coloured band near the sail tip
        bm = bmesh.new()
        vs = [bm.verts.new(P(length - 0.17, 0.03, -0.016)), bm.verts.new(P(length - 0.06, 0.03, -0.016)),
              bm.verts.new(P(length - 0.06, width - 0.01, -0.016)), bm.verts.new(P(length - 0.17, width - 0.01, -0.016))]
        bm.faces.new(vs)
        band = b.obj(bm, "team", "sail_band")
        band.modifiers.new("solid", "SOLIDIFY").thickness = 0.004


def mill(col, rng, era: str) -> None:
    b = _b(col, rng)
    st = style(era)
    b.pad(2, 2, "dirt")
    if era == "dark":
        # post mill: wooden body on a trestle
        for (px, py) in ((-0.36, 0.2), (0.36, 0.2), (0.0, -0.16), (0.0, 0.56)):
            b.box(px - 0.05, py - 0.05, 0, px + 0.05, py + 0.05, 0.08, "fieldstone", 0.01)
        b.beam((-0.38, 0.2, 0.1), (0.38, 0.2, 0.1), 0.05, "log")
        b.beam((0.0, -0.18, 0.13), (0.0, 0.58, 0.13), 0.05, "log")
        for (px, py) in ((-0.34, 0.2), (0.34, 0.2), (0.0, -0.14), (0.0, 0.54)):
            b.beam((px, py, 0.12), (0.0, 0.2, 0.5), 0.035, "log")
        b.cyl((0.0, 0.2, 0.1), (0.0, 0.2, 0.6), 0.05, "log", segs=8)
        x0, y0, x1, y1 = -0.27, -0.12, 0.27, 0.56
        b.box(x0, y0, 0.58, x1, y1, 1.28, "planks", 0.006)
        b.timber_frame(x0, y0, x1, y1, 0.58, 1.28, "timber", spacing=0.27, braces=False, mid=False)
        b.gable_roof(x0, y0, x1, y1, 1.28, 0.3, "shingle", axis="y", overhang=0.04, thick=0.03, gable_m="planks",
                     ridge_m="shingle")
        b.opening("+x", x0, y0, x1, y1, 0.75, 0.62, 0.18, 0.34, "door", frame_m="timber")
        b.opening("-y", x0, y0, x1, y1, 0.75, 0.8, 0.08, 0.1, "void", frame_m="timber")
        # steps from the door down to the ground
        for i in range(6):
            z = 0.58 - i * 0.1
            b.box(0.28 + i * 0.07, 0.32, z - 0.02, 0.35 + i * 0.07, 0.48, z, "planks", 0.003)
        b.beam((0.28, 0.33, 0.6), (0.72, 0.33, 0.0), 0.02, "log", d=0.02)
        b.beam((0.28, 0.47, 0.6), (0.72, 0.47, 0.0), 0.02, "log", d=0.02)
        _sails(b, 0.0, y0 - 0.02, 1.12, length=0.86)
        b.cart(0.55, -0.55, rot=math.radians(-20), load="sacks")
        for (px, py) in ((-0.55, -0.45), (-0.62, -0.32), (-0.48, -0.32)):
            b.sack(px, py, 0, 0.055)
        hall(b, -0.88, 0.45, -0.42, 0.88, 0.42, st, axis="y", doors=(("+x", 0.5, 0.18, 0.34),), pitch=1.2)
        b.banner(0.85, 0.85, 0.0, 0.6, 0.14, 0.1, pole_m="log")
    else:
        # tower mill: whitewashed round tower on a stone base, conical cap
        cx, cy = -0.05, 0.12
        b.cyl((cx, cy, 0), (cx, cy, 0.22), 0.46, "ashlar_grey" if era == "gunpowder" else "fieldstone", segs=24,
              smooth=True)
        body = "plaster" if era == "castle" else "brick"
        b.lathe([(0.43, 0.2), (0.4, 0.6), (0.36, 1.0), (0.33, 1.3)], cx, cy, body, segs=24)
        b.cyl((cx, cy, 1.28), (cx, cy, 1.33), 0.36, "timber", segs=24)
        b.cone_roof(cx, cy, 1.33, 0.33, 0.42, "thatch" if era == "castle" else "tile_dark", segs=24, overhang=0.05,
                    thick=0.03)
        # door and windows on the visible side
        import math as _m
        for (ang, z, w, h, m) in ((-60, 0.18, 0.2, 0.36, "door"), (-35, 0.75, 0.08, 0.12, "void"),
                                  (5, 0.95, 0.08, 0.12, "void")):
            a = _m.radians(ang)
            r = 0.41 if z < 0.5 else 0.37
            px, py = cx + _m.cos(a) * r, cy + _m.sin(a) * r
            b.box(px - w / 2, py - 0.03, z, px + w / 2, py + 0.03, z + h, m, 0.0, rot=a + _m.pi / 2)
        _sails(b, cx, cy - 0.42, 1.4, length=0.9)
        # gallery / store house
        hall(b, 0.42, 0.25, 0.9, 0.88, 0.5, st, axis="y", wall_m="ashlar" if era == "castle" else "brick",
             frame=False, doors=(("+x", 0.4, 0.2, 0.36),), arch_doors=True, pitch=1.2)
        b.cart(0.55, -0.55, rot=math.radians(-20), load="sacks")
        for (px, py) in ((-0.62, -0.45), (-0.7, -0.32), (-0.56, -0.32), (-0.62, -0.38)):
            b.sack(px, py, 0, 0.055)
        b.banner(0.88, -0.1, 0.0, 0.62, 0.14, 0.1, pole_m="timber")


# ---------------------------------------------------------------------------
# Lumber camp (1x1)
# ---------------------------------------------------------------------------


def lumber_camp(col, rng, era: str) -> None:
    b = _b(col, rng)
    st = style(era)
    b.pad(1, 1, "dirt")
    x0, y0, x1, y1 = -0.44, -0.02, 0.2, 0.44
    # open lean-to shed: posts, back wall, mono-pitch roof
    post_m = "log" if era == "dark" else "timber"
    for (px, py) in ((x0, y0), (x1, y0), (x1, y1), (x0, y1)):
        if era == "dark":
            b.cyl((px, py, 0), (px, py, 0.5 if py < 0.2 else 0.66), 0.02, post_m, segs=7)
        else:
            b.box(px - 0.02, py - 0.02, 0.0, px + 0.02, py + 0.02, 0.52 if py < 0.2 else 0.7, post_m, 0.004)
    if era == "dark":
        b._slab([(x0 - 0.07, y0 - 0.08, 0.5), (x1 + 0.07, y0 - 0.08, 0.5), (x1 + 0.07, y1 + 0.06, 0.68),
                 (x0 - 0.07, y1 + 0.06, 0.68)], 0.06, "thatch", 0.01)
        b.box(x0, y1 - 0.03, 0, x1, y1, 0.6, "planks", 0.003)
    else:
        b.box(x0 - 0.03, y0 - 0.03, 0, x1 + 0.03, y1 + 0.03, 0.04, st.base, 0.006)
        b.beam((x0, y0, 0.5), (x1, y0, 0.5), 0.03, "timber", d=0.04)
        b.beam((x0, y1, 0.68), (x1, y1, 0.68), 0.03, "timber", d=0.04)
        for xx in (x0 + 0.01, x1 - 0.01):
            b.beam((xx, y0, 0.27), (xx, y0 + 0.16, 0.5), 0.016, "timber")
        b.box(x0, y1 - 0.03, 0.04, x1, y1, 0.66, "planks_dark", 0.003)
        b.box(x0, y0 + 0.2, 0.04, x0 + 0.03, y1, 0.6, "planks_dark", 0.003)
        b._slab([(x0 - 0.06, y0 - 0.08, 0.53), (x1 + 0.06, y0 - 0.08, 0.53), (x1 + 0.06, y1 + 0.06, 0.72),
                 (x0 - 0.06, y1 + 0.06, 0.72)], 0.035, st.roof, 0.0)
    # stacked planks under / beside the shed
    for i in range(4):
        b.box(-0.38, 0.06 + i * 0.0, i * 0.022, 0.12, 0.2, i * 0.022 + 0.02, "planks", 0.003)
    b.log_pile(-0.08, -0.3, 0.5, "x", rows=3, r=0.03)
    # sawhorse with a log
    sx, sy = 0.32, -0.08
    for dx in (-0.08, 0.08):
        b.beam((sx + dx, sy - 0.05, 0), (sx + dx, sy, 0.12), 0.012, "timber")
        b.beam((sx + dx, sy + 0.05, 0), (sx + dx, sy, 0.12), 0.012, "timber")
    b.cyl((sx - 0.15, sy, 0.15), (sx + 0.15, sy, 0.15), 0.03, "log", segs=9, cap_m="log_end")
    # chopping stump with an axe
    b.cyl((0.34, 0.3, 0), (0.34, 0.3, 0.08), 0.05, "log", segs=10, cap_m="log_end")
    b.beam((0.34, 0.3, 0.08), (0.37, 0.27, 0.2), 0.01, "timber")
    b.box(0.32, 0.28, 0.07, 0.36, 0.3, 0.1, "iron", 0.002)
    b.banner(0.42, -0.42, 0.0, 0.52, 0.12, 0.08, pole_m="log")


# ---------------------------------------------------------------------------
# Gold mine and stone quarry (1x1 worksites)
# ---------------------------------------------------------------------------


def _mound(b: B, cx: float, cy: float, rx: float, ry: float, h: float, m: str = "rock") -> None:
    rng = b.rng
    ob = b.sphere((cx, cy, 0.0), 1.0, m, scale=(rx, ry, h), subdiv=3)
    b.roughen(ob, 0.06, 0.25, 1)
    for _ in range(6):
        a = rng.uniform(0.6, 4.2)
        px, py = cx + math.cos(a) * rx * 0.85, cy + math.sin(a) * ry * 0.85
        s = rng.uniform(0.07, 0.13)
        rock = b.sphere((px, py, s * 0.4), s, m, scale=(1.2, 1.0, 0.8), subdiv=1)
        b.roughen(rock, 0.02, 0.1, 1)


def gold_mine(col, rng, era: str) -> None:
    b = _b(col, rng)
    b.pad(1, 1, "gravel")
    from nature import gold_ore_material

    # A proper hill that towers over its tile (it read as a pebble next to trees before).
    _mound(b, -0.04, 0.14, 0.58, 0.52, 1.3, gold_ore_material())
    _mound(b, 0.32, 0.34, 0.26, 0.24, 0.72, gold_ore_material())
    _mound(b, -0.36, 0.36, 0.24, 0.22, 0.85, gold_ore_material())
    ex, ey = -0.08, -0.2
    pm = "log" if era == "dark" else "ashlar"
    if era == "dark":
        b.box(ex - 0.16, ey - 0.06, 0, ex + 0.16, ey + 0.14, 0.44, "void", 0)
        for dx in (-0.17, 0.17):
            b.cyl((ex + dx, ey - 0.05, 0), (ex + dx, ey - 0.05, 0.47), 0.03, pm, segs=7)
        b.beam((ex - 0.23, ey - 0.05, 0.48), (ex + 0.23, ey - 0.05, 0.48), 0.05, pm)
    else:
        b.box(ex - 0.24, ey - 0.08, 0, ex + 0.24, ey + 0.14, 0.52, "ashlar", 0.01)
        b.opening("-y", ex - 0.24, ey - 0.08, ex + 0.24, ey + 0.14, 0.5, 0.0, 0.28, 0.32, "void", frame_m="ashlar_grey",
                  arch=True, depth=0.02)
        # winding gear on top of the hill
        for dx in (-0.14, 0.14):
            b.beam((-0.05 + dx, 0.2, 1.08), (-0.05, 0.2, 1.48), 0.026, "timber")
        b.cyl((-0.19, 0.2, 1.42), (0.09, 0.2, 1.42), 0.014, "iron", segs=6)
        b.cyl((-0.08, 0.2, 1.42), (-0.06, 0.2, 1.42), 0.11, "timber", segs=14, smooth=False)
        b.gable_roof(-0.24, 0.1, 0.1, 0.34, 1.51, 0.12, "tile_red", axis="y", overhang=0.02, thick=0.02)
    # rails out of the adit
    for dx in (-0.045, 0.045):
        b.beam((ex + dx, ey - 0.02, 0.012), (ex + dx + 0.04, -0.47, 0.012), 0.01, "iron", d=0.01)
    for i in range(5):
        y = ey - 0.04 - 0.07 * i
        b.box(ex - 0.08 + i * 0.008, y - 0.012, 0, ex + 0.08 + i * 0.008, y + 0.012, 0.01, "timber", 0.002)
    # mine cart with ore
    cx, cy = ex + 0.025, -0.32
    b.box(cx - 0.07, cy - 0.09, 0.04, cx + 0.07, cy + 0.09, 0.13, "planks_dark", 0.006)
    for dx in (-0.075, 0.075):
        for dy in (-0.055, 0.055):
            b.cyl((cx + dx, cy + dy, 0.035), (cx + dx * 1.15, cy + dy, 0.035), 0.03, "iron", segs=10)
    for k in range(9):
        p = (cx + rng.uniform(-0.05, 0.05), cy + rng.uniform(-0.07, 0.07), 0.13 + rng.uniform(0, 0.03))
        b.sphere(p, rng.uniform(0.02, 0.03), "gold" if k % 2 == 0 else "rock", subdiv=1)
    # ore heap
    for k in range(12):
        a = rng.uniform(0, math.tau)
        r = rng.uniform(0, 0.09)
        p = (0.28 + math.cos(a) * r, -0.22 + math.sin(a) * r, 0.015 + (0.09 - r) * 0.5)
        b.sphere(p, rng.uniform(0.022, 0.04), "gold" if k % 3 == 0 else "rock", subdiv=1)
    # lantern post and team flag
    b.cyl((ex + 0.22, ey - 0.08, 0), (ex + 0.22, ey - 0.08, 0.4), 0.01, "timber", segs=5)
    b.box(ex + 0.2, ey - 0.1, 0.33, ex + 0.24, ey - 0.06, 0.38, "glow", 0.0)
    b.banner(0.4, 0.15, 0.0, 0.5, 0.12, 0.08, pole_m="timber")


def stone_quarry(col, rng, era: str) -> None:
    b = _b(col, rng)
    b.pad(1, 1, "gravel")
    # stepped rock face at the back
    # Tall stepped face that fills the tile (it read as a pebble on its footprint before).
    # (heights x1.5 in the style A pass: the quarry now stands up next to trees)
    blocks = [(-0.48, 0.02, -0.02, 0.48, 1.1), (-0.04, 0.16, 0.36, 0.48, 0.78), (-0.48, -0.26, -0.18, 0.06, 0.56),
              (0.04, 0.02, 0.36, 0.18, 0.34), (-0.24, 0.24, 0.12, 0.48, 1.35), (-0.48, 0.3, -0.2, 0.48, 1.2)]
    for (bx0, by0, bx1, by1, h) in blocks:
        ob = b.box(bx0, by0, 0, bx1, by1, h, "rock_cut", 0.02)
        b.roughen(ob, 0.014, 0.08, 2)
    for _ in range(5):
        p = (rng.uniform(-0.42, 0.2), rng.uniform(0.3, 0.44), 1.18 + rng.uniform(0, 0.16))
        r = b.sphere(p, rng.uniform(0.08, 0.12), "rock", scale=(1.2, 1, 0.7), subdiv=1)
        b.roughen(r, 0.02, 0.1, 1)
    # cut blocks
    for i, (px, py, z) in enumerate(((0.18, -0.3, 0), (0.3, -0.3, 0), (0.24, -0.3, 0.07), (0.32, -0.12, 0))):
        b.box(px - 0.055, py - 0.045, z, px + 0.055, py + 0.045, z + 0.07, "ashlar" if era != "dark" else "rock_cut",
              0.006, rng.uniform(-0.1, 0.1))
    # tripod crane
    cx, cy, top = -0.12, -0.2, 1.15
    for a in (0.3, 2.4, 4.4):
        b.cyl((cx + math.cos(a) * 0.2, cy + math.sin(a) * 0.2, 0), (cx, cy, top), 0.016, "log", segs=6)
    b.beam((cx, cy, top), (cx + 0.18, cy - 0.12, top - 0.05), 0.02, "log")
    b.cyl((cx + 0.17, cy - 0.11, top - 0.06), (cx + 0.17, cy - 0.11, 0.3), 0.004, "rope", segs=4)
    b.box(cx + 0.12, cy - 0.16, 0.22, cx + 0.22, cy - 0.06, 0.3, "rock_cut", 0.006)
    if era != "dark":
        b.gable_roof(0.12, -0.12, 0.46, 0.18, 0.46, 0.14, "tile_red", axis="x", overhang=0.03, thick=0.02)
        for (px, py) in ((0.12, -0.12), (0.46, -0.12)):
            b.cyl((px, py, 0), (px, py, 0.46), 0.018, "timber", segs=6)
    b.banner(0.42, -0.4, 0.0, 0.5, 0.12, 0.08, pole_m="log" if era == "dark" else "timber")


# ---------------------------------------------------------------------------
# Defensive tower (1x1)
# ---------------------------------------------------------------------------


def defensive_tower(col, rng, era: str) -> None:
    b = _b(col, rng)
    b.pad(1, 1, "dirt" if era == "dark" else "gravel")
    if era == "dark":
        top = 1.32
        legs = [(-0.3, -0.3), (0.3, -0.3), (0.3, 0.3), (-0.3, 0.3)]
        for (px, py) in legs:
            b.box(px - 0.04, py - 0.04, 0, px + 0.04, py + 0.04, 0.05, "fieldstone", 0.008)
            b.cyl((px, py, 0), (px * 0.72, py * 0.72, top), 0.03, "log", segs=8)
        for z0, z1 in ((0.1, 0.62), (0.62, 1.12)):
            k0, k1 = 1 - (1 - 0.72) * z0 / top, 1 - (1 - 0.72) * z1 / top
            b.beam((-0.3 * k0, -0.3 * k0 - 0.01, z0), (0.3 * k1, -0.3 * k1 - 0.01, z1), 0.02, "log")
            b.beam((0.3 * k0 + 0.01, -0.3 * k0, z0), (0.3 * k1 + 0.01, 0.3 * k1, z1), 0.02, "log")
        p = 0.3
        b.box(-p, -p, top, p, p, top + 0.05, "planks", 0.006)
        b.box(-p, -p, top + 0.05, p, -p + 0.03, top + 0.27, "planks", 0.004)
        b.box(p - 0.03, -p, top + 0.05, p, p, top + 0.27, "planks", 0.004)
        b.box(-p, p - 0.03, top + 0.05, p, p, top + 0.27, "planks", 0.004)
        b.box(-p, -p, top + 0.05, -p + 0.03, p, top + 0.27, "planks", 0.004)
        for (px, py) in ((-p, -p), (p, -p), (p, p), (-p, p)):
            b.cyl((px, py, top), (px, py, top + 0.56), 0.02, "log", segs=6)
        # No roughen here: displace + bevel on the pyramid apex shaded the whole roof pure black.
        b.hip_roof(-p, -p, p, p, top + 0.56, 0.42, "thatch", overhang=0.1, thick=0.07, rough=0.0)
        # ladder
        for dx in (-0.06, 0.06):
            b.beam((0.05 + dx, -0.48, 0), (0.05 + dx, -0.24, top), 0.014, "log")
        for i in range(9):
            z = 0.12 + i * 0.13
            t = z / top
            b.beam((0.05 - 0.06, -0.48 + 0.24 * t, z), (0.05 + 0.06, -0.48 + 0.24 * t, z), 0.01, "log")
        b.box(-0.22, -p - 0.035, top + 0.06, -0.02, -p - 0.02, top + 0.24, "team", 0.004)
        b.banner(0.0, 0.0, top + 0.98, 0.35, 0.16, 0.1, pole_m="log")
    elif era == "castle":
        s0, s1 = 0.33, 0.29
        b.lathe([(s0 * 1.414, 0.0), (s0 * 1.414, 0.12), (s1 * 1.414, 0.3)], 0, 0, "ashlar_grey", segs=4, smooth=False,
                a0=math.pi / 4)
        b.box(-s1, -s1, 0.25, s1, s1, 1.72, "ashlar", 0.01)
        b.box(-s1 - 0.015, -s1 - 0.015, 1.0, s1 + 0.015, s1 + 0.015, 1.04, "ashlar_grey", 0.005)
        b.opening("-y", -s1, -s1, s1, s1, 0.5, 0.25, 0.2, 0.38, "door", frame_m="ashlar_grey", arch=True)
        for z in (0.75, 1.25):
            b.opening("-y", -s1, -s1, s1, s1, 0.5, z, 0.045, 0.16, "void", frame_m=None)
            b.opening("+x", -s1, -s1, s1, s1, 0.5, z, 0.045, 0.16, "void", frame_m=None)
        # corbels and parapet
        c = 0.05
        for i in range(5):
            t = -s1 + (2 * s1) * (i + 0.5) / 5
            b.box(t - 0.02, -s1 - c, 1.62, t + 0.02, -s1, 1.72, "ashlar_grey", 0.004)
            b.box(s1, t - 0.02, 1.62, s1 + c, t + 0.02, 1.72, "ashlar_grey", 0.004)
        b.box(-s1 - c, -s1 - c, 1.72, s1 + c, s1 + c, 1.8, "ashlar", 0.008)
        b.crenellate(-s1 - c + 0.025, -s1 - c + 0.025, s1 + c - 0.025, s1 + c - 0.025, 1.8, 0.1, "ashlar", 0.075, 0.055, 0.05)
        b.hip_roof(-s1 + 0.04, -s1 + 0.04, s1 - 0.04, s1 - 0.04, 1.8, 0.62, "tile_red", overhang=0.02)
        b.banner(0.0, 0.0, 2.4, 0.32, 0.16, 0.11, pole_m="iron")
        wall_banner(b, "-y", -s1, -s1, s1, s1, 0.5, 1.58, 0.14, 0.26)
    else:
        r0 = 0.44
        b.lathe([(r0, 0.0), (r0 - 0.06, 0.45), (r0 - 0.08, 1.1)], 0, 0, "ashlar_grey", segs=28)
        b.cyl((0, 0, 0.5), (0, 0, 0.55), r0 - 0.04, "ashlar", segs=28)
        b.cyl((0, 0, 1.08), (0, 0, 1.18), r0 - 0.04, "ashlar", segs=28)
        for ang in (-80, -35, 10):
            a = math.radians(ang)
            r = r0 - 0.075
            px, py = math.cos(a) * r, math.sin(a) * r
            b.box(px - 0.06, py - 0.04, 0.78, px + 0.06, py + 0.04, 0.9, "void", 0.0, rot=a + math.pi / 2)
            b.cyl((px * 0.95, py * 0.95, 0.84), (px * 1.12, py * 1.12, 0.84), 0.022, "bronze", segs=10)
        b.opening("-y", -0.12, -r0 + 0.04, 0.12, 0, 0.5, 0.0, 0.2, 0.36, "door", frame_m="ashlar", arch=True)
        b.cone_roof(0, 0, 1.18, r0 - 0.06, 0.42, "tile_dark", segs=28, overhang=0.05, thick=0.03)
        b.banner(0.0, 0.0, 1.55, 0.35, 0.16, 0.11, pole_m="iron")
        b.cyl((0.0, -r0 + 0.02, 0.58), (0.0, -r0 - 0.005, 0.58), 0.08, "team_paint", segs=6, smooth=False)


# ---------------------------------------------------------------------------
# Foundry (2x2, gunpowder age and later)
# ---------------------------------------------------------------------------


def foundry(col, rng, era: str) -> None:
    b = _b(col, rng)
    st = style("gunpowder")
    b.pad(2, 2, "gravel")
    x0, y0, x1, y1 = -0.88, 0.05, 0.42, 0.86
    hall(b, x0, y0, x1, y1, 0.82, st, axis="x", wall_m="brick", frame=False, pitch=0.9,
         windows=(("-y", 0.15, 0.38, 0.1, 0.18), ("-y", 0.85, 0.38, 0.1, 0.18), ("+x", 0.5, 0.38, 0.1, 0.18)),
         shutters="team_paint", gable_m="brick")
    b.opening("-y", x0, y0, x1, y1, 0.5, 0.05, 0.34, 0.5, "void", frame_m="ashlar_grey", arch=True)
    b.box(-0.35, y0 + 0.02, 0.05, -0.08, y0 + 0.08, 0.3, "glow", 0.0)
    # chimney stack
    b.lathe([(0.17 * 1.414, 0.6), (0.15 * 1.414, 1.6), (0.12 * 1.414, 2.25)], -0.55, 0.55, "brick", segs=4, smooth=False,
            a0=math.pi / 4)
    b.box(-0.55 - 0.15, 0.55 - 0.15, 2.22, -0.55 + 0.15, 0.55 + 0.15, 2.3, "ashlar_grey", 0.006)
    b.box(-0.55 - 0.1, 0.55 - 0.1, 2.27, -0.55 + 0.1, 0.55 + 0.1, 2.31, "void", 0.0)
    # furnace annex
    hall(b, 0.42, 0.22, 0.86, 0.78, 0.55, st, axis="y", wall_m="brick", frame=False, roof_m="tile_dark", pitch=0.8)
    b.opening("+x", 0.42, 0.22, 0.86, 0.78, 0.5, 0.08, 0.16, 0.16, "glow", frame_m="iron", arch=True)
    # cannon barrels on chocks
    for (px, py, rot) in ((-0.45, -0.5, 0.0), (0.05, -0.62, 0.15)):
        c, s = math.cos(rot), math.sin(rot)
        for d in (-0.15, 0.15):
            b.box(px + c * d - 0.03, py + s * d - 0.05, 0, px + c * d + 0.03, py + s * d + 0.05, 0.06, "timber", 0.004)
        b.cyl((px - c * 0.25, py - s * 0.25, 0.1), (px + c * 0.25, py + s * 0.25, 0.1), 0.055, "bronze", r2=0.042, segs=14)
        b.cyl((px - c * 0.27, py - s * 0.27, 0.1), (px - c * 0.25, py - s * 0.25, 0.1), 0.065, "bronze", segs=14)
    # coal heap and anvil
    ob = b.sphere((0.62, -0.25, 0.0), 0.18, "char", scale=(1.0, 0.9, 0.5), subdiv=2)
    b.roughen(ob, 0.02, 0.05, 1)
    b.cyl((0.6, -0.65, 0), (0.6, -0.65, 0.09), 0.045, "log", segs=10, cap_m="log_end")
    b.box(0.55, -0.68, 0.09, 0.66, -0.62, 0.13, "iron", 0.004)
    b.banner(0.88, 0.9, 0.0, 0.62, 0.15, 0.1, pole_m="iron")
    wall_banner(b, "-y", x0, y0, x1, y1, 0.3, 0.75, 0.13, 0.24)


# ---------------------------------------------------------------------------
# Walls: 16 connection variants per era
# ---------------------------------------------------------------------------

#: mask bits use GAME directions: 1 = +x neighbour, 2 = +y, 4 = -x, 8 = -y.
#: Game +x = Blender +X, game +y = Blender -Y.
WALL_DIRS = ((1, (1.0, 0.0)), (2, (0.0, -1.0)), (4, (-1.0, 0.0)), (8, (0.0, 1.0)))


def wall(col, rng, era: str, mask: int) -> None:
    b = _b(col, rng)
    arms = [d for bit, d in WALL_DIRS if mask & bit]
    straight = mask in (5, 10)
    if era == "dark":
        # Log palisade: fat bark stakes with pale sharpened tips and a ragged top,
        # two binding rails and an earth bank, so it reads as logs and not a slab.
        def stake(x: float, y: float, h: float, r: float = 0.054) -> None:
            b.cyl((x, y, 0), (x, y, h), r, "log", segs=9)
            b.cone(x, y, h, r * 0.98, 0.1, "log_end", segs=9)

        for dx, dy in arms:
            n = 5
            for i in range(1, n + 1):
                t = 0.5 * i / n - 0.04
                stake(dx * t + rng.uniform(-0.007, 0.007), dy * t + rng.uniform(-0.007, 0.007),
                      rng.uniform(0.7, 0.92), rng.uniform(0.048, 0.06))
            for z in (0.24, 0.56):
                b.beam((0, 0, z), (dx * 0.5, dy * 0.5, z), 0.028, "timber", d=0.15)
            bank = b.box(min(0, dx * 0.5) - 0.07 * abs(dy), min(0, dy * 0.5) - 0.07 * abs(dx), 0,
                         max(0, dx * 0.5) + 0.07 * abs(dy), max(0, dy * 0.5) + 0.07 * abs(dx), 0.07, "dirt", 0.03)
            b.roughen(bank, 0.02, 0.1, 1)
        if not straight:
            stake(0, 0, 1.0, 0.07)
            if not arms:
                for a in (0.0, 2.1, 4.2):
                    stake(math.cos(a) * 0.1, math.sin(a) * 0.1, 0.84, 0.052)
        else:
            stake(0, 0, 0.86, 0.054)
        b.pad(0.9, 0.9, "dirt", inset=0.25, irregular=0.03)
    else:
        mt = "ashlar" if era == "castle" else "brick"
        cap = "ashlar_grey"
        th, h = 0.3, 0.78
        for dx, dy in arms:
            if dy == 0:
                xa, xb = sorted((0.0, dx * 0.5))
                b.box(xa, -th / 2, 0, xb, th / 2, h, mt, 0.008)
                b.box(xa, -th / 2 - 0.02, 0, xb, th / 2 + 0.02, 0.1, cap, 0.008)
                if era == "castle":
                    for side in (-1, 1):
                        y = side * (th / 2 - 0.03)
                        n = 3
                        for i in range(n):
                            c = xa + (xb - xa) * (i + 0.5) / n
                            b.box(c - 0.04, y - 0.03, h, c + 0.04, y + 0.03, h + 0.11, mt, 0.006)
                else:
                    b.box(xa, -th / 2 - 0.015, h, xb, th / 2 + 0.015, h + 0.05, cap, 0.008)
            else:
                ya, yb = sorted((0.0, dy * 0.5))
                b.box(-th / 2, ya, 0, th / 2, yb, h, mt, 0.008)
                b.box(-th / 2 - 0.02, ya, 0, th / 2 + 0.02, yb, 0.1, cap, 0.008)
                if era == "castle":
                    for side in (-1, 1):
                        x = side * (th / 2 - 0.03)
                        n = 3
                        for i in range(n):
                            c = ya + (yb - ya) * (i + 0.5) / n
                            b.box(x - 0.03, c - 0.04, h, x + 0.03, c + 0.04, h + 0.11, mt, 0.006)
                else:
                    b.box(-th / 2 - 0.015, ya, h, th / 2 + 0.015, yb, h + 0.05, cap, 0.008)
        if not straight:
            p = th / 2 + 0.05
            b.box(-p, -p, 0, p, p, h + 0.12, mt, 0.01)
            b.box(-p - 0.02, -p - 0.02, 0, p + 0.02, p + 0.02, 0.12, cap, 0.008)
            b.box(-p - 0.02, -p - 0.02, h + 0.12, p + 0.02, p + 0.02, h + 0.17, cap, 0.008)
            if era == "castle":
                b.crenellate(-p, -p, p, p, h + 0.17, 0.1, mt, 0.07, 0.06, 0.05)
            else:
                b.cone(0, 0, h + 0.17, p * 0.9, 0.16, "tile_dark", segs=4)
        b.pad(0.9, 0.9, "gravel", inset=0.22, irregular=0.03)


# ---------------------------------------------------------------------------
# Construction stages and rubble per footprint size
# ---------------------------------------------------------------------------


def construction(col, rng, n: int, stage: int) -> None:
    """stage 0: staked foundation, 1: timber frame, 2: frame with scaffolding and rafters."""
    b = _b(col, rng)
    b.pad(n, n, "dirt", inset=0.04)
    h0 = n / 2 - 0.14
    # stone footing ring
    th = 0.07
    for (xa, ya, xb, yb) in ((-h0, -h0, h0, -h0 + th), (h0 - th, -h0, h0, h0), (-h0, h0 - th, h0, h0),
                             (-h0, -h0, -h0 + th, h0)):
        ob = b.box(xa, ya, 0, xb, yb, 0.05 + 0.01 * n, "fieldstone", 0.01)
        b.roughen(ob, 0.006, 0.05, 1)
    corners = [(-h0, -h0), (h0, -h0), (h0, h0), (-h0, h0)]
    if stage == 0:
        for (px, py) in corners:
            sx, sy = px * 1.08, py * 1.08
            b.cyl((sx, sy, 0), (sx, sy, 0.2), 0.012, "log", segs=5)
        for (a, c) in zip(corners, corners[1:] + corners[:1]):
            b.cyl((a[0] * 1.08, a[1] * 1.08, 0.16), (c[0] * 1.08, c[1] * 1.08, 0.16), 0.003, "rope", segs=4)
        b.stone_pile(h0 * 0.3, -h0 * 0.3, 5 + n * 2, 0.05)
        for i in range(2 + n):
            z = 0.012 * i
            b.box(-h0 * 0.5, h0 * 0.2 + 0.0, z, h0 * 0.1, h0 * 0.2 + 0.1, z + 0.01, "planks", 0.002)
        return
    post_h = 0.55 + 0.12 * n if stage == 1 else 0.7 + 0.15 * n
    nposts = 2 + n
    for side in range(4):
        a, c = corners[side], corners[(side + 1) % 4]
        for i in range(nposts):
            t = i / nposts
            px, py = a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t
            b.beam((px, py, 0.05), (px, py, post_h), 0.04, "log")
        b.beam((a[0], a[1], post_h - 0.02), (c[0], c[1], post_h - 0.02), 0.045, "log")
        b.beam((a[0], a[1], 0.08), (c[0], c[1], 0.08), 0.05, "log")
        if stage == 2:
            b.beam((a[0], a[1], post_h * 0.5), (c[0], c[1], post_h * 0.5), 0.035, "log")
    # partly finished wall infill on the visible sides
    infill = 0.18 if stage == 1 else post_h * 0.55
    b.box(-h0 + 0.02, -h0 + 0.01, 0.06, h0 - 0.02, -h0 + 0.05, infill, "daub", 0.004)
    b.box(h0 - 0.05, -h0 + 0.02, 0.06, h0 - 0.01, h0 - 0.02, infill * 0.7, "daub", 0.004)
    # scaffolding: poles and walk boards outside the front faces
    sc = 0.1
    for i in range(nposts + 1):
        t = -h0 + 2 * h0 * i / nposts
        b.cyl((t, -h0 - sc, 0), (t, -h0 - sc, post_h + 0.1), 0.011, "log", segs=5)
        b.cyl((h0 + sc, t, 0), (h0 + sc, t, post_h + 0.1), 0.011, "log", segs=5)
    for z in ((post_h * 0.5,) if stage == 1 else (post_h * 0.45, post_h * 0.9)):
        b.box(-h0 - sc - 0.04, -h0 - sc - 0.04, z, h0, -h0 - sc + 0.04, z + 0.015, "planks", 0.002)
        b.box(h0 + sc - 0.04, -h0 - sc - 0.04, z, h0 + sc + 0.04, h0, z + 0.015, "planks", 0.002)
    # ladder
    for dx in (-0.05, 0.05):
        b.beam((-h0 * 0.3 + dx, -h0 - 0.3, 0), (-h0 * 0.3 + dx, -h0 - sc, post_h * 0.5), 0.012, "log")
    if stage == 2:
        # roof rafters (A-frames) along x
        rise = h0 * 1.0
        k = 3 + n
        for i in range(k):
            x = -h0 + 2 * h0 * i / (k - 1)
            b.beam((x, -h0, post_h), (x, 0, post_h + rise), 0.03, "log")
            b.beam((x, h0, post_h), (x, 0, post_h + rise), 0.03, "log")
        b.beam((-h0, 0, post_h + rise), (h0, 0, post_h + rise), 0.035, "log")
    b.stone_pile(h0 * 0.6 + 0.12, -h0 - 0.2 if n > 1 else -h0 * 0.2, 4 + n, 0.04)
    b.log_pile(-h0 * 0.3, h0 * 0.35, 0.3 * n, "x", 2, 0.022)


def rubble(col, rng, n: int) -> None:
    b = _b(col, rng)
    b.pad(n, n, "dirt", inset=0.05, irregular=0.06)
    b.pad(n * 0.62, n * 0.5, "ash", inset=0.0, z=0.004, irregular=0.18, cx=rng.uniform(-0.1, 0.1) * n,
          cy=rng.uniform(-0.1, 0.1) * n)
    h0 = n / 2 - 0.15
    # broken wall stubs on the footprint outline
    for (xa, ya, xb, yb) in ((-h0, -h0, h0, -h0 + 0.08), (h0 - 0.08, -h0, h0, h0), (-h0, h0 - 0.08, h0, h0),
                             (-h0, -h0, -h0 + 0.08, h0)):
        segs = 3 + n
        for i in range(segs):
            if rng.random() < 0.35:
                continue
            t0, t1 = i / segs, (i + 0.8) / segs
            x0, y0 = xa + (xb - xa) * t0, ya + (yb - ya) * t0
            x1, y1 = xa + (xb - xa) * t1, ya + (yb - ya) * t1
            if abs(xb - xa) > abs(yb - ya):
                ob = b.box(x0, ya, 0, x1, yb, rng.uniform(0.06, 0.22), "fieldstone", 0.01)
            else:
                ob = b.box(xa, y0, 0, xb, y1, rng.uniform(0.06, 0.22), "fieldstone", 0.01)
            b.roughen(ob, 0.015, 0.06, 1)
    for _ in range(3 + 2 * n):
        b.stone_pile(rng.uniform(-h0, h0), rng.uniform(-h0, h0), 4, 0.04 + 0.01 * n, "fieldstone")
    for _ in range(3 + 3 * n):
        x, y = rng.uniform(-h0, h0), rng.uniform(-h0, h0)
        a = rng.uniform(0, math.tau)
        ln = rng.uniform(0.2, 0.35) * (1 + 0.3 * n)
        z = rng.uniform(0.02, 0.1)
        b.beam((x, y, z), (x + math.cos(a) * ln, y + math.sin(a) * ln, rng.uniform(0.0, 0.18)), 0.035, "char")
    # collapsed masonry heaps instead of one smooth mound
    for k in range(n + 1):
        cx = rng.uniform(-h0 * 0.6, h0 * 0.6)
        cy = rng.uniform(-h0 * 0.6, h0 * 0.6)
        _debris_heap(b, cx, cy, 0.16 + 0.08 * n, 0.08 + 0.04 * n, 26 + 10 * n)


def _debris_heap(b: B, cx: float, cy: float, r: float, h: float, count: int) -> None:
    """Conical heap of broken stones, plaster chunks and roof-tile shards."""
    rng = b.rng
    mats = ("fieldstone", "fieldstone", "rock_cut", "plaster", "tile_red", "char")
    for i in range(count):
        a = rng.uniform(0, math.tau)
        d = r * math.sqrt(rng.random())
        x, y = cx + math.cos(a) * d, cy + math.sin(a) * d
        top = h * (1 - d / r) ** 1.2
        z = rng.uniform(0.0, max(0.0, top - 0.02))
        s = rng.uniform(0.03, 0.065)
        m = rng.choice(mats)
        if m == "tile_red":
            ob = b.box(x - s * 0.7, y - s * 0.45, z, x + s * 0.7, y + s * 0.45, z + 0.012, m, 0.002, rng.uniform(0, 3))
        else:
            ob = b.box(x - s / 2, y - s * 0.4, z, x + s / 2, y + s * 0.4, z + s * rng.uniform(0.5, 0.8), m, 0.008,
                       rng.uniform(0, 3))
        c = Vector((x, y, z + s * 0.3))
        tilt = Euler((rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4), 0.0)).to_matrix().to_4x4()
        ob.data.transform(Matrix.Translation(c) @ tilt @ Matrix.Translation(-c))


# ---------------------------------------------------------------------------
# Job list
# ---------------------------------------------------------------------------


def _meta(asset: str, def_id: str | None, variant: str, kind: str = "building", **extra) -> dict:
    d = {"asset": asset, "variant": variant, "kind": kind}
    if def_id:
        d["defId"] = def_id
    d.update(extra)
    return d


BUILDINGS = [
    # key, builder, footprint, defId, variants
    ("town_center", town_center, 3, "TOWN_CENTER", ERAS),
    ("house", house, 1, "HOUSE", ERAS),
    ("barracks", barracks, 2, "BARRACKS", ERAS),
    ("archery_range", archery_range, 2, "ARCHERY_RANGE", ("dark", "castle")),
    ("stable", stable, 2, "STABLE", ("dark", "castle")),
    ("mill", mill, 2, "MILL", ERAS),
    ("lumber_camp", lumber_camp, 1, "LUMBER_CAMP", ("dark", "castle")),
    ("gold_mine", gold_mine, 1, "GOLD_MINE", ("dark", "castle")),
    ("stone_quarry", stone_quarry, 1, "STONE_QUARRY", ("dark", "castle")),
    ("defensive_tower", defensive_tower, 1, "DEFENSIVE_TOWER", ERAS),
    ("foundry", foundry, 2, "FOUNDRY", ("gunpowder",)),
]

FARM_STAGES = ("sown", "growing", "ripe", "depleted")


def jobs(only: str | None = None) -> list[Job]:
    out: list[Job] = []
    for key, fn, fp, def_id, eras in BUILDINGS:
        for era in eras:
            out.append(Job(f"{key}_{era}", lambda col, rng, fn=fn, era=era: fn(col, rng, era), (fp, fp),
                           group=key, meta=_meta(f"building.{key}", def_id, era, footprint=fp,
                                                 construction=f"construction.{fp}x{fp}", rubble=f"rubble.{fp}x{fp}")))
    for stage in FARM_STAGES:
        out.append(Job(f"farm_{stage}", lambda col, rng, s=stage: farm(col, rng, s), (2, 2), group="farm",
                       meta=_meta("building.farm", "FARM", stage, footprint=2,
                                  construction="construction.2x2", rubble="rubble.2x2")))
    for era in ERAS:
        for mask in range(16):
            out.append(Job(f"wall_{era}_{mask:02d}", lambda col, rng, era=era, m=mask: wall(col, rng, era, m), (1, 1),
                           group=f"wall_{era}", meta=_meta("building.wall", "WALL", f"{era}.{mask}", footprint=1,
                                                         era=era, connections=mask, rubble="rubble.1x1",
                                                         construction="construction.1x1")))
    for n in (1, 2, 3):
        for stage in range(3):
            out.append(Job(f"construction_{n}x{n}_{stage}", lambda col, rng, n=n, s=stage: construction(col, rng, n, s),
                           (n, n), group=f"construction_{n}",
                           meta=_meta(f"construction.{n}x{n}", None, str(stage), "construction", footprint=n,
                                      progress=[0.0, 0.34, 0.67][stage])))
        out.append(Job(f"rubble_{n}x{n}", lambda col, rng, n=n: rubble(col, rng, n), (n, n), group=f"rubble_{n}",
                       meta=_meta(f"rubble.{n}x{n}", None, "default", "rubble", footprint=n)))
    if only:
        keys = [k.strip() for k in only.split(",")]
        out = [j for j in out if any(k in j.name for k in keys)]
    return out
