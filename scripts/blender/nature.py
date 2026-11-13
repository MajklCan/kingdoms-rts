"""Nature and resource sprites: central European trees, stumps, berry bushes,
gold ore and stone outcrops with depleted variants.

Every sprite stands on a 1x1 footprint centred on the origin; the anchor is
the bottom corner of that tile diamond (tile centre is 32 px above it at 2x).
"""

from __future__ import annotations

import math
import random

import bmesh
import bpy
from mathutils import Vector, noise

from kr_kit import M, B, mat
from kr_lib import NodeBuilder, Job, Surface, _inp, _out, hex_rgb, material

LEAF = {
    "spruce": Surface((0x3c6a44, 0x2c5434, 0x4c7c50), "leaves", 0.06, roughness=0.85, bump=0.7, noise_scale=3.0, grime=0.0, ao=0.75, coords="object"),
    "pine": Surface((0x4e6e36, 0x3c5a2a, 0x607e42), "leaves", 0.06, roughness=0.85, bump=0.7, noise_scale=3.0, grime=0.0, ao=0.75, coords="object"),
    "oak": Surface((0x5e8636, 0x48722a, 0x729a44), "leaves", 0.05, roughness=0.8, bump=0.8, noise_scale=2.5, grime=0.0, ao=0.75, coords="object"),
    "beech": Surface((0x6e9c3e, 0x588632, 0x82b04e), "leaves", 0.05, roughness=0.8, bump=0.8, noise_scale=2.5, grime=0.0, ao=0.75, coords="object"),
    "linden": Surface((0x5c903c, 0x487c30, 0x6ea24a), "leaves", 0.05, roughness=0.8, bump=0.8, noise_scale=2.5, grime=0.0, ao=0.75, coords="object"),
    "birch": Surface((0x8eb04e, 0x769a3e, 0xa2c060), "leaves", 0.04, roughness=0.8, bump=0.8, noise_scale=2.5, grime=0.0, ao=0.7, coords="object"),
    "bush": Surface((0x4e7a34, 0x3c6428, 0x5e8a40), "leaves", 0.035, roughness=0.8, bump=0.8, noise_scale=3.0, grime=0.0, ao=0.75, coords="object"),
    "autumn": Surface((0xc08a34, 0xa4682a, 0xd4a040), "leaves", 0.05, roughness=0.8, bump=0.8, noise_scale=2.5, grime=0.0, ao=0.75, coords="object"),
}
BARK = {
    "spruce": Surface((0x5c4434, 0x46342a, 0x6e5440), "bark", 0.02, roughness=0.9, bump=0.7, grime=0.0, coords="object"),
    "pine": Surface((0x9a5a36, 0x7e4a2e, 0x6a3e28), "bark", 0.02, roughness=0.9, bump=0.7, grime=0.0, coords="object"),
    "oak": Surface((0x5e5040, 0x4a3e32, 0x6e6050), "bark", 0.015, roughness=0.9, bump=0.9, grime=0.0, coords="object"),
    "beech": Surface((0x8e8a80, 0x7a766c, 0x9c988e), "bark", 0.03, roughness=0.8, bump=0.3, grime=0.0, coords="object"),
    "birch": Surface((0xe8e4d8, 0xd6d0c2, 0x2a2622), "bark", 0.025, roughness=0.8, bump=0.3, grime=0.0, coords="object"),
    "dead": Surface((0x6a5e52, 0x584c42, 0x7a6e60), "bark", 0.02, roughness=0.9, bump=0.8, grime=0.0, coords="object"),
}
SNOW = Surface((0xf2f6fa, 0xe2eaf2, 0xd0dce8), "soil", 0.05, roughness=0.6, bump=0.25, grime=0.0, ao=0.4, coords="object")
BERRY = Surface((0xc4243c, 0xa01a30, 0xd84a5a), "none", roughness=0.35, grime=0.0, ao=0.2)
ROCK = Surface((0x9c968c, 0x847e74, 0x625e56), "rock", 0.09, roughness=0.85, bump=0.8, noise_scale=3.0, grime=0.0, ao=0.6, coords="object")
ROCK_WARM = Surface((0xa8987e, 0x8e7e66, 0x6a5c4a), "rock", 0.08, roughness=0.9, bump=0.8, noise_scale=3.0, grime=0.0, ao=0.6, coords="object")


def _m(name: str, s: Surface) -> bpy.types.Material:
    return material(name, s)


def gold_ore_material() -> bpy.types.Material:
    """Warm rock with metallic gold veins (Voronoi cells thresholded)."""
    key = "gold_ore"
    mt = bpy.data.materials.get("kr_" + key)
    if mt:
        return mt
    mt = bpy.data.materials.new("kr_" + key)
    nb = NodeBuilder(mt)
    tc = nb.n("ShaderNodeTexCoord")
    vor = nb.n("ShaderNodeTexVoronoi", in_Scale=14.0)
    vor.feature = "DISTANCE_TO_EDGE"
    nb.link(tc.outputs["Object"], vor.inputs["Vector"])
    nz = nb.n("ShaderNodeTexNoise", in_Scale=9.0, in_Detail=6.0)
    nb.link(tc.outputs["Object"], nz.inputs["Vector"])
    vein = nb.n("ShaderNodeMapRange")
    nb.link(_out(vor, "Distance"), vein.inputs["Value"])
    vein.inputs["From Min"].default_value = 0.0
    vein.inputs["From Max"].default_value = 0.11
    vein.inputs["To Min"].default_value = 1.0
    vein.inputs["To Max"].default_value = 0.0
    nmask = nb.n("ShaderNodeMapRange")
    nb.link(nz.outputs["Fac"], nmask.inputs["Value"])
    nmask.inputs["From Min"].default_value = 0.38
    nmask.inputs["From Max"].default_value = 0.5
    mul = nb.n("ShaderNodeMath", operation="MULTIPLY")
    nb.link(vein.outputs["Result"], mul.inputs[0])
    nb.link(nmask.outputs["Result"], mul.inputs[1])
    rock = nb.n("ShaderNodeValToRGB")
    rock.color_ramp.elements[0].color = (*hex_rgb(0x6e6050), 1)
    rock.color_ramp.elements[1].color = (*hex_rgb(0xa89880), 1)
    nb.link(nz.outputs["Fac"], rock.inputs["Fac"])
    col = nb.n("ShaderNodeMix", data_type="RGBA", blend_type="MIX")
    nb.link(mul.outputs[0], col.inputs["Factor"])
    nb.link(rock.outputs["Color"], col.inputs[6])
    col.inputs[7].default_value = (*hex_rgb(0xf4c440), 1)
    bsdf = nb.n("ShaderNodeBsdfPrincipled")
    nb.link(col.outputs[2], _inp(bsdf, "Base Color"))
    nb.link(mul.outputs[0], _inp(bsdf, "Metallic"))
    rough = nb.n("ShaderNodeMapRange")
    nb.link(mul.outputs[0], rough.inputs["Value"])
    rough.inputs["To Min"].default_value = 0.85
    rough.inputs["To Max"].default_value = 0.25
    nb.link(rough.outputs["Result"], _inp(bsdf, "Roughness"))
    bump = nb.n("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.6
    nb.link(nz.outputs["Fac"], bump.inputs["Height"])
    nb.link(bump.outputs["Normal"], _inp(bsdf, "Normal"))
    out = nb.n("ShaderNodeOutputMaterial")
    nb.link(bsdf.outputs[0], out.inputs["Surface"])
    return mt


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------


def clump(b: B, c, r: float, m, scale=(1, 1, 1), rough: float = 0.3, nscale: float = 0.6, subdiv: int = 3) -> bpy.types.Object:
    """Bumpy foliage or rock lump: displaced icosphere."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    seed = Vector((b.rng.uniform(-50, 50), b.rng.uniform(-50, 50), b.rng.uniform(-50, 50)))
    for v in bm.verts:
        d = noise.noise(v.co * (1.0 / nscale) * 1.6 + seed) * 0.5 + noise.noise(v.co * (1.0 / nscale) * 4.0 + seed) * 0.25
        k = 1.0 + rough * d
        v.co = Vector((v.co.x * k * scale[0] * r, v.co.y * k * scale[1] * r, v.co.z * k * scale[2] * r)) + Vector(c)
    ob = b.obj(bm, m, "clump", smooth=True)
    ob["kr_keep_uv"] = True
    return ob


def trunk(b: B, base, top, r0: float, r1: float, m, segs: int = 9, bend: float = 0.0) -> None:
    base, top = Vector(base), Vector(top)
    if bend == 0:
        o = b.cyl(base, top, r0, m, r2=r1, segs=segs)
        o["kr_keep_uv"] = True
        return
    mid = (base + top) / 2 + Vector((b.rng.uniform(-bend, bend), b.rng.uniform(-bend, bend), 0))
    rm = (r0 + r1) / 2
    for p0, p1, ra, rb in ((base, mid, r0, rm), (mid, top, rm, r1)):
        o = b.cyl(p0, p1, ra, m, r2=rb, segs=segs)
        o["kr_keep_uv"] = True


def star_tier(b: B, z0: float, radius: float, height: float, m, droop: float = 0.06, points: int = 9) -> bpy.types.Object:
    """One drooping whorl of spruce branches: star-shaped cone."""
    rng = b.rng
    bm = bmesh.new()
    apex = bm.verts.new((0, 0, z0 + height))
    under = bm.verts.new((0, 0, z0 + height * 0.18))
    ring = []
    n = points * 2
    phase = rng.uniform(0, math.tau)
    for i in range(n):
        a = phase + math.tau * i / n
        tip = i % 2 == 0
        rr = radius * (rng.uniform(0.9, 1.08) if tip else rng.uniform(0.62, 0.75))
        zz = z0 - (droop if tip else droop * 0.2) * rng.uniform(0.7, 1.2)
        ring.append(bm.verts.new((math.cos(a) * rr, math.sin(a) * rr, zz)))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((ring[i], ring[j], apex))
        bm.faces.new((ring[j], ring[i], under))
    bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=2, use_grid_fill=False)
    seed = Vector((rng.uniform(-9, 9), rng.uniform(-9, 9), rng.uniform(-9, 9)))
    for v in bm.verts:
        d = noise.noise(v.co * 14.0 + seed)
        v.co += Vector((d * 0.022, noise.noise(v.co * 14.0 + seed * 2) * 0.022, d * 0.015))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = b.obj(bm, m, "tier", smooth=True)
    ob["kr_keep_uv"] = True
    return ob


# ---------------------------------------------------------------------------
# Trees
# ---------------------------------------------------------------------------


def spruce(col, rng, h: float = 2.05, r: float = 0.42, snow: bool = False) -> None:
    b = B(col, rng)
    trunk(b, (0, 0, 0), (0, 0, h * 0.9), 0.055, 0.012, _m("bark_spruce", BARK["spruce"]))
    tiers = 8
    leaf = _m("leaf_spruce", LEAF["spruce"])
    snow_m = _m("snow", SNOW)
    for i in range(tiers):
        t = i / (tiers - 1)
        z0 = h * 0.1 + t * h * 0.72
        rad = r * (1.0 - t * 0.82) * rng.uniform(0.92, 1.06)
        height = rad * 1.25 + 0.12
        star_tier(b, z0, rad, height, leaf, droop=0.05 + 0.05 * (1 - t))
        if snow:
            s = star_tier(b, z0 + height * 0.18, rad * 0.86, height * 0.84, snow_m, droop=0.02)
            s.location.z += 0.012
    b.cone(0, 0, h * 0.86, 0.04, h * 0.16, leaf, segs=6)


def pine(col, rng) -> None:
    b = B(col, rng)
    bark = _m("bark_pine", BARK["pine"])
    leaf = _m("leaf_pine", LEAF["pine"])
    lean = Vector((rng.uniform(-0.06, 0.06), rng.uniform(-0.06, 0.06), 0))
    top = Vector((0, 0, 1.55)) + lean
    trunk(b, (0, 0, 0), top, 0.05, 0.022, bark, bend=0.05)
    for k in range(5):
        a = k * 2.4 + rng.uniform(-0.3, 0.3)
        z = 1.05 + 0.12 * k
        tip = Vector((math.cos(a) * 0.3, math.sin(a) * 0.3, z + 0.12)) + lean
        b.cyl((lean.x * z / 1.55, lean.y * z / 1.55, z), tip, 0.016, bark, r2=0.008, segs=6)
        clump(b, tip + Vector((0, 0, 0.04)), 0.2, leaf, scale=(1.2, 1.2, 0.55), rough=0.5, nscale=0.35)
    clump(b, top + Vector((0, 0, 0.12)), 0.26, leaf, scale=(1.25, 1.25, 0.6), rough=0.5, nscale=0.35)


def broadleaf(col, rng, kind: str) -> None:
    b = B(col, rng)
    leaf = _m(f"leaf_{kind}", LEAF[kind])
    bark = _m(f"bark_{kind}", BARK.get(kind, BARK["oak"]))
    # trunk top, crown centre z, horizontal radius, vertical radius, clumps, clump radius, trunk radius
    params = {
        "oak": (0.62, 0.98, 0.56, 0.42, 16, 0.2, 0.075),
        "beech": (0.66, 1.06, 0.48, 0.5, 15, 0.18, 0.055),
        "linden": (0.6, 1.02, 0.5, 0.56, 17, 0.19, 0.06),
        "birch": (0.8, 1.2, 0.32, 0.55, 14, 0.12, 0.034),
    }
    t_top, cz, rx, rz, n, cr, r0 = params[kind]
    trunk(b, (0, 0, 0), (0, 0, t_top), r0, r0 * 0.75, bark, bend=0.03)
    b.cone(0, 0, 0, r0 * 1.7, 0.1, bark, segs=9)
    for k in range(3 if kind != "birch" else 2):
        a = math.tau * k / 3 + rng.uniform(-0.4, 0.4)
        tip = Vector((math.cos(a) * rx * 0.45, math.sin(a) * rx * 0.45, cz + rng.uniform(-0.05, 0.1)))
        b.cyl((0, 0, t_top - 0.05), tip, r0 * 0.6, bark, r2=r0 * 0.3, segs=7)
    # dense core, then leafy clumps spread over the crown ellipsoid
    clump(b, (0, 0, cz), 1.0, leaf, scale=(rx * 0.78, rx * 0.78, rz * 0.8), rough=0.3, nscale=0.25)
    for k in range(n):
        while True:
            d = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.55, 1)))
            if 0.2 < d.length <= 1.0:
                break
        d.normalize()
        c = Vector((d.x * rx * 0.72, d.y * rx * 0.72, cz + d.z * rz * 0.72))
        clump(b, c, cr * rng.uniform(0.8, 1.2), leaf, scale=(1, 1, 0.85), rough=0.4, nscale=0.18, subdiv=3)


def dead_tree(col, rng) -> None:
    b = B(col, rng)
    bark = _m("bark_dead", BARK["dead"])
    trunk(b, (0, 0, 0), (0.03, -0.02, 1.25), 0.06, 0.02, bark, bend=0.06)
    b.cone(0, 0, 0, 0.1, 0.1, bark, segs=8)
    for k in range(6):
        a = k * 2.1 + rng.uniform(-0.3, 0.3)
        z = 0.55 + 0.11 * k
        ln = 0.35 - 0.03 * k
        tip = (math.cos(a) * ln, math.sin(a) * ln, z + ln * 0.7)
        b.cyl((0.0, 0.0, z), tip, 0.02, bark, r2=0.006, segs=6)
        b.cyl(tip, (tip[0] * 1.3, tip[1] * 1.3 + 0.05, tip[2] + 0.12), 0.006, bark, r2=0.002, segs=5)


def stump(col, rng, kind: str) -> None:
    b = B(col, rng)
    bark = _m("bark_spruce" if kind == "conifer" else "bark_oak", BARK["spruce" if kind == "conifer" else "oak"])
    r = 0.07 if kind == "conifer" else 0.09
    b.cyl((0, 0, 0), (0, 0, 0.1), r * 1.1, bark, r2=r, segs=12, cap_m="log_end")
    for k in range(5):
        a = math.tau * k / 5 + rng.uniform(-0.3, 0.3)
        b.cyl((math.cos(a) * r * 0.6, math.sin(a) * r * 0.6, 0.04), (math.cos(a) * r * 2.2, math.sin(a) * r * 2.2, -0.01),
              0.022, bark, r2=0.008, segs=6)
    # chips and a fallen branch
    for _ in range(6):
        a = rng.uniform(0, math.tau)
        d = rng.uniform(0.12, 0.25)
        b.box(math.cos(a) * d - 0.01, math.sin(a) * d - 0.006, 0, math.cos(a) * d + 0.01, math.sin(a) * d + 0.006, 0.006,
              "log_end", 0.001, rng.uniform(0, 3))


# ---------------------------------------------------------------------------
# Resources
# ---------------------------------------------------------------------------


def berry_bush(col, rng, amount: float) -> None:
    b = B(col, rng)
    leaf = _m("leaf_bush", LEAF["bush"])
    berry = _m("berry", BERRY)
    clumps = [(-0.12, 0.05, 0.16, 0.2), (0.12, -0.02, 0.15, 0.19), (0.0, 0.16, 0.14, 0.17), (0.02, -0.16, 0.12, 0.15),
              (-0.2, -0.14, 0.1, 0.12), (0.22, 0.16, 0.1, 0.12)]
    shell = []
    for (x, y, z, r) in clumps:
        clump(b, (x, y, z), r, leaf, scale=(1, 1, 0.85), rough=0.5, nscale=0.25)
        shell.append((Vector((x, y, z)), r))
    n = int(60 * amount)
    for _ in range(n):
        c, r = shell[rng.randrange(len(shell))]
        d = Vector((rng.uniform(-1, 1), rng.uniform(-1, 0.3), rng.uniform(-0.2, 1))).normalized()
        if d.x > 0.5 and d.y > 0.3:
            continue
        p = c + Vector((d.x * r * 0.95, d.y * r * 0.95, d.z * r * 0.85))
        b.sphere(p, rng.uniform(0.013, 0.019), berry, subdiv=1)
    if amount < 0.3:
        for _ in range(5):
            a = rng.uniform(0, math.tau)
            b.cyl((0, 0, 0.05), (math.cos(a) * 0.25, math.sin(a) * 0.25, 0.25), 0.007, "timber", segs=4)


def ore_pile(col, rng, kind: str, amount: float) -> None:
    b = B(col, rng)
    if kind == "gold":
        rock_m = gold_ore_material()
        warm = _m("rock_warm", ROCK_WARM)
    else:
        rock_m = _m("rock_grey", ROCK)
        warm = rock_m
    count = max(1, round(7 * amount))
    big = 0.17 + 0.09 * amount
    spots = [(0.0, 0.05, big), (-0.2, -0.08, big * 0.75), (0.2, -0.1, big * 0.7), (0.12, 0.22, big * 0.65),
             (-0.18, 0.2, big * 0.6), (-0.02, -0.25, big * 0.5), (0.28, 0.1, big * 0.5)]
    placed = []
    for i in range(count):
        x, y, r = spots[i]
        sc = (rng.uniform(0.9, 1.3), rng.uniform(0.9, 1.2), rng.uniform(0.7, 0.95) if kind == "gold" else rng.uniform(0.6, 0.85))
        m = rock_m if (kind != "gold" or i % 3 != 2) else warm
        ob = clump(b, (x, y, r * 0.25), r, m, scale=sc, rough=0.55, nscale=0.6 if kind == "gold" else 0.9,
                   subdiv=3 if kind == "gold" else 2)
        if kind != "gold":
            for p in ob.data.polygons:
                p.use_smooth = False
        placed.append((Vector((x, y, r * 0.25)), r, sc))
    if kind == "gold":
        gold = mat("gold")
        for _ in range(int(26 * amount) + 3):
            c, r, sc = placed[rng.randrange(len(placed))]
            d = Vector((rng.uniform(-1, 1), rng.uniform(-1, 0.4), rng.uniform(0.1, 1))).normalized()
            p = c + Vector((d.x * r * sc[0] * 0.92, d.y * r * sc[1] * 0.92, d.z * r * sc[2] * 0.92))
            b.sphere(p, rng.uniform(0.016, 0.03), gold, scale=(1.2, 1, 0.8), subdiv=1)
        for _ in range(int(8 * amount) + 2):
            a = rng.uniform(0, math.tau)
            d = rng.uniform(0.2, 0.38)
            b.sphere((math.cos(a) * d, math.sin(a) * d - 0.05, 0.012), rng.uniform(0.012, 0.022), gold, scale=(1.2, 1, 0.7),
                     subdiv=1)
    else:
        for _ in range(int(8 * amount) + 2):
            a = rng.uniform(0, math.tau)
            d = rng.uniform(0.18, 0.38)
            o = clump(b, (math.cos(a) * d, math.sin(a) * d, 0.0), rng.uniform(0.02, 0.04), rock_m, rough=0.4, subdiv=1)
            for p in o.data.polygons:
                p.use_smooth = False


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------


def rock_spire(col, rng, size: int) -> None:
    """Map feature: a cluster of weathered rock columns over a size x size footprint."""
    b = B(col, rng)
    rock = _m("rock_spire", ROCK)
    warm = _m("rock_warm", ROCK_WARM)
    moss = _m("leaf_bush", LEAF["bush"])
    s = float(size)
    # scree and boulders around the foot
    for _ in range(int(9 * s)):
        a = rng.uniform(0, math.tau)
        r = rng.uniform(0.28, 0.46) * s
        rad = rng.uniform(0.06, 0.13) * math.sqrt(s)
        o = clump(b, (math.cos(a) * r, math.sin(a) * r, rad * 0.2), rad, rock if rng.random() < 0.7 else warm,
                  scale=(1.2, 1.0, 0.6), rough=0.5, subdiv=2)
        for p in o.data.polygons:
            p.use_smooth = False
    # columns: stacked, slightly offset, tapering rock drums
    n = 3 if size <= 2 else 7
    for i in range(n):
        if i == 0:
            cx, cy = rng.uniform(-0.05, 0.05) * s, rng.uniform(-0.05, 0.05) * s
            h = (1.25 if size <= 2 else 0.95) * s
            r0 = 0.24 * s if size <= 2 else 0.16 * s
        else:
            a = rng.uniform(0, math.tau)
            d = rng.uniform(0.12, 0.3) * s
            cx, cy = math.cos(a) * d, math.sin(a) * d
            h = rng.uniform(0.45, 0.85) * s * (1.0 if size <= 2 else 0.8)
            r0 = rng.uniform(0.12, 0.18) * s * (1.0 if size <= 2 else 0.7)
        # one weathered, leaning column (tapered prism, roughened), plus a few ledges
        x = cx + rng.uniform(-0.06, 0.06) * s
        y = cy + rng.uniform(-0.06, 0.06) * s
        z = h
        core = b.cyl((cx, cy, 0.0), (x, y, h), r0, rock if i % 3 else warm, r2=r0 * 0.5, segs=7)
        b.roughen(core, 0.035 * s, 0.14 * s, 2)
        for _ in range(2 if size <= 2 else 1):
            t = rng.uniform(0.25, 0.7)
            a = rng.uniform(0, math.tau)
            r = r0 * (1.0 - 0.5 * t)
            lx = cx + (x - cx) * t + math.cos(a) * r * 0.8
            ly = cy + (y - cy) * t + math.sin(a) * r * 0.8
            o = clump(b, (lx, ly, h * t), r * 0.55, warm if rng.random() < 0.5 else rock, scale=(1.2, 1.0, 0.5),
                      rough=0.4, subdiv=2)
            for p in o.data.polygons:
                p.use_smooth = False
        # a cap of moss on some tops
        if rng.random() < 0.6:
            clump(b, (x, y, z + 0.02), r0 * 0.5, moss, scale=(1.0, 1.0, 0.35), rough=0.6, subdiv=2)


def landmark_linden(col, rng) -> None:
    """Map feature: an old, oversized linden (drawn instead of a scaled tree)."""
    broadleaf(col, rng, "linden")
    for ob in col.objects:
        ob.scale = (1.4, 1.4, 1.4)


def _job(name: str, fn, asset: str, variant: str, kind: str = "resource", group: str | None = None, **meta) -> Job:
    d = {"asset": asset, "variant": variant, "kind": kind, "footprint": 1}
    d.update(meta)
    # standing trees get two sway poses (style A), drawn by the engine as a 3 frame sway
    poses = ("swayl", "swayr") if name.startswith("tree_") and name != "tree_dead" else ()
    return Job(name, fn, (1, 1), group=group or asset, meta=d, poses=poses)


def jobs(only: str | None = None) -> list[Job]:
    out = [
        _job("tree_spruce_a", lambda c, r: spruce(c, r, 2.05, 0.42), "resource.tree", "spruce_a", resource="WOOD"),
        _job("tree_spruce_b", lambda c, r: spruce(c, r, 1.75, 0.38), "resource.tree", "spruce_b", resource="WOOD"),
        _job("tree_pine", pine, "resource.tree", "pine", resource="WOOD"),
        _job("tree_oak", lambda c, r: broadleaf(c, r, "oak"), "resource.tree", "oak", resource="WOOD"),
        _job("tree_beech", lambda c, r: broadleaf(c, r, "beech"), "resource.tree", "beech", resource="WOOD"),
        _job("tree_linden", lambda c, r: broadleaf(c, r, "linden"), "resource.tree", "linden", resource="WOOD"),
        _job("tree_birch", lambda c, r: broadleaf(c, r, "birch"), "resource.tree", "birch", resource="WOOD"),
        _job("tree_snow_a", lambda c, r: spruce(c, r, 2.0, 0.42, snow=True), "resource.tree_snow", "a", resource="WOOD"),
        _job("tree_snow_b", lambda c, r: spruce(c, r, 1.7, 0.37, snow=True), "resource.tree_snow", "b", resource="WOOD"),
        _job("tree_dead", dead_tree, "resource.tree_dead", "default", resource="WOOD"),
        _job("stump_conifer", lambda c, r: stump(c, r, "conifer"), "resource.stump", "conifer", group="stump"),
        _job("stump_broadleaf", lambda c, r: stump(c, r, "broadleaf"), "resource.stump", "broadleaf", group="stump"),
    ]
    for label, amt in (("full", 1.0), ("half", 0.5), ("low", 0.2)):
        out.append(_job(f"berry_bush_{label}", lambda c, r, a=amt: berry_bush(c, r, a), "resource.berry_bush", label,
                        resource="FOOD", amount=amt))
        out.append(_job(f"gold_{label}", lambda c, r, a=amt: ore_pile(c, r, "gold", a), "resource.gold", label,
                        resource="GOLD", amount=amt))
        out.append(_job(f"stone_{label}", lambda c, r, a=amt: ore_pile(c, r, "stone", a), "resource.stone", label,
                        resource="STONE", amount=amt))
    for size in (2, 4):
        out.append(Job(f"rock_spire_{size}", lambda c, r, s=size: rock_spire(c, r, s), (size, size),
                       meta={"asset": "feature.rock_spire", "variant": str(size), "kind": "feature", "footprint": size}))
    out.append(Job("landmark_linden", landmark_linden, (1, 1), poses=("swayl", "swayr"),
                   meta={"asset": "feature.linden", "variant": "default", "kind": "feature", "footprint": 1}))
    if only:
        keys = [k.strip() for k in only.split(",")]
        out = [j for j in out if any(k in j.name for k in keys)]
    return out
