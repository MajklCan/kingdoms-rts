"""Decor sprites: fences, hay, carts, rocks, grass, flowers and small props.

Non-blocking dressing for maps and villages. Each sprite sits on a 1x1
footprint centred on the origin (anchor = bottom corner of that diamond),
so the engine can drop one per tile. Fences run along the tile centre line
in game +x ("x") or game +y ("y"); place x and y on the same tile for a
corner or crossing.
"""

from __future__ import annotations

import math

import bmesh
import bpy

from kr_kit import B
from kr_lib import Job, Surface, material
from nature import ROCK, ROCK_WARM, clump

GRASS = Surface((0x7e9e40, 0x66882f, 0x98b452), "leaves", 0.03, roughness=0.8, bump=0.4, noise_scale=2.0, grime=0.0,
                ao=0.6, coords="object")
GRASS_DRY = Surface((0xa8a256, 0x8e8a44, 0xbcb46a), "leaves", 0.03, roughness=0.8, bump=0.4, noise_scale=2.0, grime=0.0,
                    ao=0.6, coords="object")
REED = Surface((0x8a9a4a, 0x6e8038, 0xa2aa5e), "leaves", 0.03, roughness=0.8, bump=0.3, noise_scale=2.0, grime=0.0,
               ao=0.6, coords="object")
FERN = Surface((0x4e7e30, 0x3c6a26, 0x62923c), "leaves", 0.03, roughness=0.8, bump=0.5, noise_scale=2.5, grime=0.0,
               ao=0.7, coords="object")
PETALS = {
    "white": Surface((0xf2eee4, 0xe4e0d4, 0xfaf8f0), "none", roughness=0.6, grime=0.0, ao=0.2),
    "yellow": Surface((0xf0c63a, 0xe0b02c, 0xf8d860), "none", roughness=0.6, grime=0.0, ao=0.2),
    "red": Surface((0xd03a2e, 0xb42c24, 0xe05040), "none", roughness=0.6, grime=0.0, ao=0.2),
    "blue": Surface((0x6a86d6, 0x5670c0, 0x86a0e4), "none", roughness=0.6, grime=0.0, ao=0.2),
    "purple": Surface((0x9a6ac0, 0x8456aa, 0xb084d0), "none", roughness=0.6, grime=0.0, ao=0.2),
}
WHEAT_HEAD = Surface((0xd8b45a, 0xc49c48, 0xe8c870), "straw", 0.02, roughness=0.85, bump=0.4, grime=0.0, ao=0.5)


def _mat(name: str, s: Surface) -> bpy.types.Material:
    return material(name, s)


# ---------------------------------------------------------------------------
# Vegetation
# ---------------------------------------------------------------------------


def blades(b: B, cx: float, cy: float, n: int, h: float, spread: float, m, w: float = 0.01,
           lean: tuple[float, float] = (0.15, 0.5), name: str = "blades") -> bpy.types.Object:
    """Clump of curved, tapered grass blades (two segments each)."""
    rng = b.rng
    bm = bmesh.new()
    for _ in range(n):
        a = rng.uniform(0, math.tau)
        rr = spread * math.sqrt(rng.random())
        bx, by = cx + math.cos(a) * rr, cy + math.sin(a) * rr
        hh = h * rng.uniform(0.6, 1.1)
        la = rng.uniform(0, math.tau)
        ln = rng.uniform(*lean) * hh
        dx, dy = math.cos(la), math.sin(la)
        px, py = -dy * w, dx * w
        mid = (bx + dx * ln * 0.3, by + dy * ln * 0.3, hh * 0.6)
        tip = (bx + dx * ln, by + dy * ln, hh)
        v0 = bm.verts.new((bx - px, by - py, 0))
        v1 = bm.verts.new((bx + px, by + py, 0))
        v2 = bm.verts.new((mid[0] + px * 0.6, mid[1] + py * 0.6, mid[2]))
        v3 = bm.verts.new((mid[0] - px * 0.6, mid[1] - py * 0.6, mid[2]))
        v4 = bm.verts.new(tip)
        bm.faces.new((v0, v1, v2, v3))
        bm.faces.new((v3, v2, v4))
    ob = b.obj(bm, m, name, smooth=True)
    ob["kr_keep_uv"] = True
    return ob


def tall_grass(col, rng, dry: bool = False) -> None:
    b = B(col, rng)
    m = _mat("grass_dry" if dry else "grass_tall", GRASS_DRY if dry else GRASS)
    for _ in range(rng.randint(4, 6)):
        a = rng.uniform(0, math.tau)
        r = rng.uniform(0, 0.16)
        blades(b, math.cos(a) * r, math.sin(a) * r, 26, rng.uniform(0.09, 0.14), 0.045, m)


def reeds(col, rng) -> None:
    b = B(col, rng)
    m = _mat("reed", REED)
    head = _mat("reed_head", Surface((0x5a4030, 0x4a3426, 0x6a4c38), "none", roughness=0.8, grime=0.0, ao=0.4))
    for _ in range(4):
        a = rng.uniform(0, math.tau)
        r = rng.uniform(0, 0.14)
        cx, cy = math.cos(a) * r, math.sin(a) * r
        blades(b, cx, cy, 18, rng.uniform(0.2, 0.28), 0.04, m, w=0.007, lean=(0.05, 0.25))
        for _ in range(rng.randint(2, 4)):
            px, py = cx + rng.uniform(-0.03, 0.03), cy + rng.uniform(-0.03, 0.03)
            hh = rng.uniform(0.22, 0.3)
            b.cyl((px, py, 0), (px, py, hh), 0.003, m, segs=4)
            o = b.cyl((px, py, hh), (px, py, hh + 0.045), 0.009, head, segs=6, smooth=True)
            o["kr_keep_uv"] = True


def fern(col, rng) -> None:
    b = B(col, rng)
    m = _mat("fern", FERN)
    bm = bmesh.new()
    for i in range(9):
        a = i / 9 * math.tau + rng.uniform(-0.2, 0.2)
        ln = rng.uniform(0.12, 0.17)
        dx, dy = math.cos(a), math.sin(a)
        px, py = -dy, dx
        prev = None
        for k in range(6):
            t = k / 5
            r = ln * t
            z = 0.02 + 0.09 * math.sin(t * math.pi * 0.8)
            wd = 0.03 * math.sin(t * math.pi) + 0.004
            c = (dx * r, dy * r, z)
            vl = bm.verts.new((c[0] + px * wd, c[1] + py * wd, c[2] - wd * 0.3))
            vr = bm.verts.new((c[0] - px * wd, c[1] - py * wd, c[2] - wd * 0.3))
            vc = bm.verts.new((c[0], c[1], c[2] + 0.004))
            if prev:
                bm.faces.new((prev[0], vl, vc, prev[2]))
                bm.faces.new((prev[2], vc, vr, prev[1]))
            prev = (vl, vr, vc)
    ob = b.obj(bm, m, "fern", smooth=True)
    ob["kr_keep_uv"] = True


def flowers(col, rng, colors: tuple[str, ...]) -> None:
    b = B(col, rng)
    m = _mat("grass_tall", GRASS)
    for _ in range(5):
        a = rng.uniform(0, math.tau)
        r = rng.uniform(0, 0.18)
        cx, cy = math.cos(a) * r, math.sin(a) * r
        blades(b, cx, cy, 14, 0.07, 0.04, m)
        pm = _mat(f"petal_{colors[0]}", PETALS[colors[0]])
        for _ in range(rng.randint(5, 8)):
            c = rng.choice(colors)
            pm = _mat(f"petal_{c}", PETALS[c])
            px, py = cx + rng.uniform(-0.045, 0.045), cy + rng.uniform(-0.045, 0.045)
            hh = rng.uniform(0.05, 0.1)
            b.cyl((px, py, 0), (px, py, hh), 0.0025, m, segs=4)
            o = b.sphere((px, py, hh), 0.012, pm, scale=(1, 1, 0.55), subdiv=1)
            o["kr_keep_uv"] = True


def bush(col, rng, small: bool = False) -> None:
    from nature import LEAF

    b = B(col, rng)
    m = _mat("leaf_bush", LEAF["bush"])
    n = 3 if small else 5
    for i in range(n):
        a = i / n * math.tau + rng.uniform(-0.4, 0.4)
        r = 0.0 if i == 0 else rng.uniform(0.06, 0.12)
        s = (0.09 if small else 0.13) * rng.uniform(0.8, 1.1)
        clump(b, (math.cos(a) * r, math.sin(a) * r, s * 0.7), s, m, (1, 1, 0.8), rough=0.45, nscale=0.4)


# ---------------------------------------------------------------------------
# Rocks
# ---------------------------------------------------------------------------


def rocks(col, rng, size: str) -> None:
    b = B(col, rng)
    m = _mat("rock", ROCK) if size != "warm" else _mat("rock_warm", ROCK_WARM)
    grass = _mat("grass_tall", GRASS)
    if size == "small":
        specs = [(0.0, 0.0, 0.06), (0.08, 0.05, 0.035), (-0.06, 0.07, 0.03)]
    elif size == "medium":
        specs = [(0.0, 0.0, 0.12), (0.12, -0.04, 0.06), (-0.1, 0.08, 0.05)]
    elif size == "boulder":
        specs = [(0.0, 0.02, 0.22), (0.18, -0.1, 0.09), (-0.16, -0.12, 0.07)]
    else:  # warm: flat sandstone slabs
        specs = [(0.0, 0.0, 0.1), (0.1, 0.08, 0.07), (-0.1, -0.05, 0.06), (0.05, -0.12, 0.04)]
    for x, y, r in specs:
        sz = rng.uniform(0.45, 0.65) if size != "warm" else rng.uniform(0.3, 0.4)
        clump(b, (x, y, r * sz * 0.35), r, m, (rng.uniform(0.9, 1.25), rng.uniform(0.85, 1.1), sz), rough=0.5, nscale=0.5, subdiv=2)
    for _ in range(3 if size != "small" else 2):
        a = rng.uniform(0, math.tau)
        blades(b, math.cos(a) * specs[0][2] * 0.9, math.sin(a) * specs[0][2] * 0.9, 10, 0.06, 0.03, grass)


# ---------------------------------------------------------------------------
# Farm and village props
# ---------------------------------------------------------------------------


def fence(col, rng, axis: str, kind: str = "rail") -> None:
    b = B(col, rng)
    pts = [(-0.5, 0.0), (0.5, 0.0)] if axis == "x" else [(0.0, 0.5), (0.0, -0.5)]
    if kind == "rail":
        b.fence(pts, h=0.17, m="log", post_every=0.25, rails=2)
        return
    # wattle: posts with woven hazel panel
    (ax, ay), (bx, by) = pts
    n = 4
    for i in range(n + 1):
        t = i / n
        px, py = ax + (bx - ax) * t, ay + (by - ay) * t
        b.cyl((px, py, 0), (px, py, 0.17 + rng.uniform(-0.01, 0.01)), 0.01, "log", segs=6)
    for k in range(6):
        z = 0.03 + k * 0.023
        wob = 0.006 if k % 2 else -0.006
        if axis == "x":
            o = b.beam((ax, ay + wob, z), (bx, by - wob, z), 0.012, "planks_dark", d=0.02, bevel=0.004)
        else:
            o = b.beam((ax + wob, ay, z), (bx - wob, by, z), 0.012, "planks_dark", d=0.02, bevel=0.004)
        b.roughen(o, 0.006, 0.04, 2)


def hay(col, rng, kind: str) -> None:
    b = B(col, rng)
    if kind == "bales":
        b.hay_bale(-0.06, 0.04, 0, 0.09, 0.2)
        b.hay_bale(0.07, -0.03, 0, 0.09, -0.15)
        b.hay_bale(0.0, 0.0, 0.066, 0.09, 0.4)
        b.hay_bale(0.12, 0.12, 0, 0.08, 1.4)
    else:  # traditional haystack around a pole
        prof = [(0.0, 0.0), (0.17, 0.0), (0.2, 0.06), (0.2, 0.14), (0.16, 0.24), (0.09, 0.32), (0.025, 0.37), (0.0, 0.38)]
        ob = b.lathe(prof, 0.0, 0.0, "hay", segs=16)
        b.roughen(ob, 0.018, 0.06, 1)
        b.cyl((0, 0, 0.3), (0.005, 0.003, 0.48), 0.008, "timber", segs=6)


def cart(col, rng, load: str | None) -> None:
    b = B(col, rng)
    b.cart(0.0, 0.0, rot=math.radians(rng.choice((-20, 25))), load=load)


def woodpile(col, rng) -> None:
    b = B(col, rng)
    b.log_pile(0.0, -0.04, 0.34, "x", rows=3, r=0.028)
    b.cyl((0.16, 0.12, 0), (0.16, 0.12, 0.05), 0.04, "log", segs=10, cap_m="log_end")
    b.beam((0.13, 0.12, 0.05), (0.19, 0.14, 0.12), 0.006, "timber", d=0.006)
    b.box(0.17, 0.1, 0.05, 0.2, 0.14, 0.065, "iron", 0.002)


def barrels(col, rng) -> None:
    b = B(col, rng)
    b.barrel(-0.05, 0.03)
    b.barrel(0.05, -0.04)
    b.barrel(0.07, 0.07, r=0.04, h=0.1)
    b.crate(-0.08, -0.09, 0, 0.08, 0.3)


def crates(col, rng) -> None:
    b = B(col, rng)
    b.crate(0.0, 0.0, 0, 0.09, 0.15)
    b.crate(0.0, 0.0, 0.09, 0.075, 0.5)
    b.crate(0.1, -0.06, 0, 0.07, -0.3)
    b.sack(-0.09, -0.05, 0, 0.045)
    b.sack(-0.06, 0.08, 0, 0.042)


def wayside_shrine(col, rng) -> None:
    """Czech "Bozi muka": stone pillar with a small roofed niche and cross."""
    b = B(col, rng)
    b.box(-0.07, -0.07, 0, 0.07, 0.07, 0.04, "ashlar", 0.006)
    b.box(-0.04, -0.04, 0.04, 0.04, 0.04, 0.32, "plaster", 0.004)
    b.box(-0.055, -0.055, 0.32, 0.055, 0.055, 0.44, "plaster", 0.004)
    b.box(-0.03, -0.056, 0.34, 0.03, -0.05, 0.41, "void", 0.0)
    b.hip_roof(-0.06, -0.06, 0.06, 0.06, 0.44, 0.07, "tile_red", overhang=0.02, thick=0.015)
    b.box(-0.004, -0.004, 0.5, 0.004, 0.004, 0.58, "iron", 0.001)
    b.box(-0.02, -0.004, 0.545, 0.02, 0.004, 0.553, "iron", 0.001)


def signpost(col, rng) -> None:
    b = B(col, rng)
    b.cyl((0, 0, 0), (0, 0, 0.3), 0.012, "timber", segs=6)
    b.box(-0.004, -0.09, 0.22, 0.004, 0.02, 0.26, "planks", 0.003, 0.0)
    b.box(-0.02, -0.004, 0.17, 0.08, 0.004, 0.205, "planks", 0.003, 0.0)


def campfire(col, rng) -> None:
    b = B(col, rng)
    for i in range(8):
        a = i / 8 * math.tau
        b.box(math.cos(a) * 0.08 - 0.018, math.sin(a) * 0.08 - 0.014, 0, math.cos(a) * 0.08 + 0.018,
              math.sin(a) * 0.08 + 0.014, 0.025, "rock", 0.006, a)
    for i in range(4):
        a = i / 4 * math.tau + 0.3
        b.cyl((math.cos(a) * 0.06, math.sin(a) * 0.06, 0.01), (math.cos(a) * 0.01, math.sin(a) * 0.01, 0.06), 0.011, "log",
              segs=6, cap_m="char")
    b.sphere((0, 0, 0.012), 0.04, "ash", scale=(1, 1, 0.3), subdiv=2)


def well(col, rng) -> None:
    b = B(col, rng)
    ob = b.lathe([(0.0, 0.0), (0.12, 0.0), (0.12, 0.11), (0.095, 0.11), (0.095, 0.02), (0.0, 0.02)], 0, 0, "fieldstone", segs=14)
    b.roughen(ob, 0.006, 0.05, 1)
    for s in (-1, 1):
        b.beam((0.1 * s, 0, 0.0), (0.1 * s, 0, 0.3), 0.022, "timber")
    b.cyl((-0.1, 0, 0.24), (0.1, 0, 0.24), 0.014, "log", segs=8)
    b.gable_roof(-0.13, -0.09, 0.13, 0.09, 0.3, 0.09, "shingle", axis="x", overhang=0.02, thick=0.015)
    b.cyl((0.02, 0, 0.06), (0.02, 0, 0.11), 0.022, "planks_dark", segs=8)


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------


def jobs(only: str | None = None) -> list[Job]:
    out = [
        Job("fence_rail_x", lambda c, r: fence(c, r, "x"), (1, 1), group="fence",
            meta={"asset": "decor.fence_rail", "variant": "x", "kind": "decor", "connections": "x"}),
        Job("fence_rail_y", lambda c, r: fence(c, r, "y"), (1, 1), group="fence",
            meta={"asset": "decor.fence_rail", "variant": "y", "kind": "decor", "connections": "y"}),
        Job("fence_wattle_x", lambda c, r: fence(c, r, "x", "wattle"), (1, 1), group="fence",
            meta={"asset": "decor.fence_wattle", "variant": "x", "kind": "decor", "connections": "x"}),
        Job("fence_wattle_y", lambda c, r: fence(c, r, "y", "wattle"), (1, 1), group="fence",
            meta={"asset": "decor.fence_wattle", "variant": "y", "kind": "decor", "connections": "y"}),
    ]

    def add(name: str, fn, asset: str, variant: str) -> None:
        out.append(Job(name, fn, (1, 1), group=asset, meta={"asset": asset, "variant": variant, "kind": "decor"}))

    add("hay_bales", lambda c, r: hay(c, r, "bales"), "decor.hay", "bales")
    add("haystack", lambda c, r: hay(c, r, "stack"), "decor.hay", "stack")
    add("cart_hay", lambda c, r: cart(c, r, "hay"), "decor.cart", "hay")
    add("cart_logs", lambda c, r: cart(c, r, "logs"), "decor.cart", "logs")
    add("cart_empty", lambda c, r: cart(c, r, None), "decor.cart", "empty")
    add("rocks_small", lambda c, r: rocks(c, r, "small"), "decor.rocks", "small")
    add("rocks_medium", lambda c, r: rocks(c, r, "medium"), "decor.rocks", "medium")
    add("rocks_boulder", lambda c, r: rocks(c, r, "boulder"), "decor.rocks", "boulder")
    add("rocks_slabs", lambda c, r: rocks(c, r, "warm"), "decor.rocks", "slabs")
    add("grass_tall_a", lambda c, r: tall_grass(c, r), "decor.grass", "a")
    add("grass_tall_b", lambda c, r: tall_grass(c, r), "decor.grass", "b")
    add("grass_dry", lambda c, r: tall_grass(c, r, True), "decor.grass", "dry")
    add("reeds", reeds, "decor.reeds", "default")
    add("fern", fern, "decor.fern", "default")
    add("bush_a", lambda c, r: bush(c, r), "decor.bush", "a")
    add("bush_small", lambda c, r: bush(c, r, True), "decor.bush", "small")
    add("flowers_meadow", lambda c, r: flowers(c, r, ("white", "yellow", "purple")), "decor.flowers", "meadow")
    add("flowers_poppy", lambda c, r: flowers(c, r, ("red", "red", "blue")), "decor.flowers", "poppy")
    add("woodpile", woodpile, "decor.woodpile", "default")
    add("barrels", barrels, "decor.barrels", "default")
    add("crates", crates, "decor.crates", "default")
    add("wayside_shrine", wayside_shrine, "decor.wayside_shrine", "default")
    add("signpost", signpost, "decor.signpost", "default")
    add("campfire", campfire, "decor.campfire", "default")
    add("well", well, "decor.well", "default")
    if only:
        keys = [k.strip() for k in only.split(",")]
        out = [j for j in out if any(k in j.name for k in keys)]
    return out
