"""Terrain tiles, cliff faces and transition masks.

Seamless by construction: every terrain material and every scattered 3D
detail (grass tufts, pebbles, flowers) is periodic with a period of P tiles
(4 for common ground, 2 for rarer ground). Noise is made periodic by mapping
the ground position onto a 4D Clifford torus before sampling Blender's 4D
noise / Voronoi. One P x P block is rendered at once and sliced into P*P
diamond tiles; the engine picks frame (x mod P) + P * (y mod P), so
neighbouring tiles of the same type always continue each other.

Tile frames are 144x72 at 2x: the 128x64 diamond plus a 2:1 bleed (8 px
horizontally, 4 px vertically) so filtering never shows the background at
tile edges. Anchor is the bottom corner of the diamond (72, 68), like every
other sprite.

Cliff faces are one elevation step (4 px at 1x, 8 px at 2x) tall and
vertically tileable: stack them for higher steps. "lip" faces carry the
grass overhang for the topmost step.
"""

from __future__ import annotations

import math
import os
import random

import bmesh
import bpy
import numpy as np
from mathutils import Vector

import kr_lib as K
from kr_lib import NodeBuilder, _inp, _out, hex_rgb

BLEED_X, BLEED_Y = 8, 4  # 2:1 bleed around the diamond (about 1.8 px at 1x along the edge normal)
TILE_FRAME = (128 + 2 * BLEED_X, 64 + 2 * BLEED_Y)
EDGE_VARIANTS = 3
STEP_PX = 8  # one elevation step at 2x
STEP_UNITS = STEP_PX / (K.PPU * K.SCREEN_UP.z)


# ---------------------------------------------------------------------------
# Periodic shader helpers
# ---------------------------------------------------------------------------


class Periodic:
    """Builds torus-mapped 4D coordinates for a material (period in tiles)."""

    def __init__(self, nb: NodeBuilder, period: float, period_z: float | None = None, plane: str = "xy"):
        self.nb = nb
        geo = nb.n("ShaderNodeNewGeometry")
        sep = nb.n("ShaderNodeSeparateXYZ")
        nb.link(geo.outputs["Position"], sep.inputs[0])
        if plane == "xy":
            a, b, pa, pb = sep.outputs["X"], sep.outputs["Y"], period, period
        elif plane == "xz":
            a, b, pa, pb = sep.outputs["X"], sep.outputs["Z"], period, period_z
        else:
            a, b, pa, pb = sep.outputs["Y"], sep.outputs["Z"], period, period_z
        self.r_a = pa / (2 * math.pi)
        self.r_b = pb / (2 * math.pi)
        ca, sa = self._circle(a, pa, self.r_a)
        cb, sb = self._circle(b, pb, self.r_b)
        comb = nb.n("ShaderNodeCombineXYZ")
        nb.link(ca, comb.inputs[0])
        nb.link(sa, comb.inputs[1])
        nb.link(cb, comb.inputs[2])
        self.vec = comb.outputs[0]
        self.w = sb
        self.pos = geo.outputs["Position"]

    def _circle(self, sock, period: float, radius: float):
        nb = self.nb
        ang = nb.n("ShaderNodeMath", operation="MULTIPLY")
        nb.link(sock, ang.inputs[0])
        ang.inputs[1].default_value = 2 * math.pi / period
        c = nb.n("ShaderNodeMath", operation="COSINE")
        nb.link(ang.outputs[0], c.inputs[0])
        s = nb.n("ShaderNodeMath", operation="SINE")
        nb.link(ang.outputs[0], s.inputs[0])
        cm = nb.n("ShaderNodeMath", operation="MULTIPLY")
        nb.link(c.outputs[0], cm.inputs[0])
        cm.inputs[1].default_value = radius
        sm = nb.n("ShaderNodeMath", operation="MULTIPLY")
        nb.link(s.outputs[0], sm.inputs[0])
        sm.inputs[1].default_value = radius
        return cm.outputs[0], sm.outputs[0]

    def noise(self, scale: float, detail: float = 4.0, rough: float = 0.55, offset: float = 0.0, distortion: float = 0.0):
        nb = self.nb
        n = nb.n("ShaderNodeTexNoise", noise_dimensions="4D")
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = rough
        n.inputs["Distortion"].default_value = distortion
        nb.link(self.vec, n.inputs["Vector"])
        if offset:
            add = nb.n("ShaderNodeMath", operation="ADD")
            nb.link(self.w, add.inputs[0])
            add.inputs[1].default_value = offset
            nb.link(add.outputs[0], n.inputs["W"])
        else:
            nb.link(self.w, n.inputs["W"])
        return n.outputs["Fac"]

    def voronoi(self, scale: float, feature: str = "F1", offset: float = 0.0, randomness: float = 1.0):
        nb = self.nb
        v = nb.n("ShaderNodeTexVoronoi", voronoi_dimensions="4D", feature=feature)
        v.inputs["Scale"].default_value = scale
        v.inputs["Randomness"].default_value = randomness
        nb.link(self.vec, v.inputs["Vector"])
        if offset:
            add = nb.n("ShaderNodeMath", operation="ADD")
            nb.link(self.w, add.inputs[0])
            add.inputs[1].default_value = offset
            nb.link(add.outputs[0], v.inputs["W"])
        else:
            nb.link(self.w, v.inputs["W"])
        return _out(v, "Distance"), (None if feature == "DISTANCE_TO_EDGE" else _out(v, "Color"))


def _ramp(nb: NodeBuilder, fac, stops: list[tuple[float, int]]):
    r = nb.n("ShaderNodeValToRGB")
    cr = r.color_ramp
    cr.elements[0].position = stops[0][0]
    cr.elements[0].color = (*hex_rgb(stops[0][1]), 1)
    cr.elements[1].position = stops[-1][0]
    cr.elements[1].color = (*hex_rgb(stops[-1][1]), 1)
    for pos, col in stops[1:-1]:
        e = cr.elements.new(pos)
        e.color = (*hex_rgb(col), 1)
    nb.link(fac, r.inputs["Fac"])
    return r.outputs["Color"]


def _mix(nb: NodeBuilder, fac, a, b, blend: str = "MIX"):
    m = nb.n("ShaderNodeMix", data_type="RGBA", blend_type=blend)
    if isinstance(fac, float):
        m.inputs["Factor"].default_value = fac
    else:
        nb.link(fac, m.inputs["Factor"])
    for sock, val in ((m.inputs[6], a), (m.inputs[7], b)):
        if isinstance(val, int):
            sock.default_value = (*hex_rgb(val), 1)
        elif isinstance(val, tuple):
            sock.default_value = val
        else:
            nb.link(val, sock)
    return m.outputs[2]


def _map(nb: NodeBuilder, sock, a: float, b: float, c: float = 0.0, d: float = 1.0):
    m = nb.n("ShaderNodeMapRange")
    nb.link(sock, m.inputs["Value"])
    m.inputs["From Min"].default_value = a
    m.inputs["From Max"].default_value = b
    m.inputs["To Min"].default_value = c
    m.inputs["To Max"].default_value = d
    return m.outputs["Result"]


def _op(nb: NodeBuilder, op: str, a, b=None, c=None):
    """Math node; operands may be sockets or floats."""
    m = nb.n("ShaderNodeMath", operation=op)
    for i, v in enumerate((a, b, c)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            m.inputs[i].default_value = float(v)
        else:
            nb.link(v, m.inputs[i])
    return m.outputs[0]


def _finish(nb: NodeBuilder, color, height=None, bump: float = 0.3, rough: float = 0.95, spec: float = 0.2,
            rough_sock=None, normal_dist: float = 0.02):
    bsdf = nb.n("ShaderNodeBsdfPrincipled")
    nb.link(color, _inp(bsdf, "Base Color"))
    if rough_sock is not None:
        nb.link(rough_sock, _inp(bsdf, "Roughness"))
    else:
        _inp(bsdf, "Roughness").default_value = rough
    try:
        _inp(bsdf, "Specular IOR Level", "Specular").default_value = spec
    except KeyError:
        pass
    if height is not None and bump > 0:
        bp = nb.n("ShaderNodeBump")
        bp.inputs["Strength"].default_value = bump
        bp.inputs["Distance"].default_value = normal_dist
        nb.link(height, bp.inputs["Height"])
        nb.link(bp.outputs["Normal"], _inp(bsdf, "Normal"))
    out = nb.n("ShaderNodeOutputMaterial")
    nb.link(bsdf.outputs[0], out.inputs["Surface"])
    return bsdf


# ---------------------------------------------------------------------------
# Ground materials
# ---------------------------------------------------------------------------


def ground_material(kind: str, period: float, frame: int = 0, frames: int = 1) -> bpy.types.Material:
    name = f"kr_ground_{kind}_{period}_{frame}"
    mt = bpy.data.materials.get(name)
    if mt:
        return mt
    mt = bpy.data.materials.new(name)
    nb = NodeBuilder(mt)
    p = Periodic(nb, period)
    if kind in ("grass", "meadow"):
        patches = p.noise(0.55, 3, 0.5)
        base = _ramp(nb, patches, [(0.3, 0x5a7e34), (0.5, 0x6a8c3c), (0.7, 0x7a9a44)])
        dry = p.noise(0.9, 2, 0.5, offset=3.1)
        base = _mix(nb, _map(nb, dry, 0.55, 0.7, 0, 0.55), base, 0x8e9a4c)
        dark = p.noise(1.4, 3, 0.6, offset=7.3)
        base = _mix(nb, _map(nb, dark, 0.35, 0.2, 0, 0.5), base, 0x47682c)
        fine = p.noise(14.0, 4, 0.7, offset=1.7)
        clumps = p.noise(5.0, 3, 0.6, offset=9.4)
        base = _mix(nb, 0.3, base, _ramp(nb, clumps, [(0.35, 0x40602a), (0.65, 0x90b056)]), "OVERLAY")
        base = _mix(nb, 0.45, base, _ramp(nb, fine, [(0.3, 0x4c6c2c), (0.7, 0x86a650)]), "OVERLAY")
        _finish(nb, base, fine, bump=0.35)
    elif kind == "snow_forest":
        patches = p.noise(0.8, 3, 0.5)
        base = _ramp(nb, patches, [(0.3, 0xd2dce4), (0.6, 0xe4ecf2), (0.8, 0xf2f6fa)])
        d, _c = p.voronoi(6.0, offset=2.2)
        litter = _map(nb, d, 0.0, 0.3, 0.75, 0.0)
        needles = _ramp(nb, p.noise(4.0, 2, 0.5, offset=5.0), [(0.3, 0x4a4a32), (0.7, 0x6a5a3a)])
        base = _mix(nb, litter, base, needles)
        fine = p.noise(12.0, 4, 0.6, offset=1.1)
        _finish(nb, base, fine, bump=0.3, rough=0.7, spec=0.35)
    elif kind in ("bridge_x", "bridge_y"):
        # 8 planks per tile across the travel direction, plank tone repeats every 2 tiles
        sep = nb.n("ShaderNodeSeparateXYZ")
        nb.link(p.pos, sep.inputs[0])
        travel = sep.outputs["X"] if kind == "bridge_x" else sep.outputs["Y"]
        t8 = nb.n("ShaderNodeMath", operation="MULTIPLY")
        nb.link(travel, t8.inputs[0])
        t8.inputs[1].default_value = 8.0
        frac = nb.n("ShaderNodeMath", operation="FRACT")
        nb.link(t8.outputs[0], frac.inputs[0])
        idx = nb.n("ShaderNodeMath", operation="FLOOR")
        nb.link(t8.outputs[0], idx.inputs[0])
        idx16 = nb.n("ShaderNodeMath", operation="FLOORED_MODULO")
        nb.link(idx.outputs[0], idx16.inputs[0])
        idx16.inputs[1].default_value = 16.0
        wn = nb.n("ShaderNodeTexWhiteNoise", noise_dimensions="1D")
        nb.link(idx16.outputs[0], wn.inputs["W"])
        tone = _ramp(nb, wn.outputs["Value"], [(0.0, 0x6a4c30), (0.5, 0x7e5c3a), (1.0, 0x94704a)])
        grain = p.noise(9.0, 4, 0.6, offset=4.0)
        tone = _mix(nb, 0.35, tone, _ramp(nb, grain, [(0.3, 0x4a3420), (0.7, 0xa88660)]), "OVERLAY")
        gap = _map(nb, frac.outputs[0], 0.0, 0.1, 0.0, 1.0)
        edge = _map(nb, frac.outputs[0], 0.85, 1.0, 1.0, 0.75)
        shade = nb.n("ShaderNodeMath", operation="MULTIPLY")
        nb.link(gap, shade.inputs[0])
        nb.link(edge, shade.inputs[1])
        base = _mix(nb, shade.outputs[0], 0x2a1e14, tone)
        h = nb.n("ShaderNodeMath", operation="MULTIPLY_ADD")
        nb.link(grain, h.inputs[0])
        h.inputs[1].default_value = 0.3
        nb.link(shade.outputs[0], h.inputs[2])
        _finish(nb, base, h.outputs[0], bump=0.6, rough=0.8)
    elif kind == "forest":
        patches = p.noise(0.7, 3, 0.5)
        base = _ramp(nb, patches, [(0.3, 0x3e5226), (0.55, 0x4a5c2a), (0.75, 0x5a5a30)])
        d, col = p.voronoi(9.0, offset=2.2)
        litter = _map(nb, d, 0.0, 0.32, 1.0, 0.0)
        base = _mix(nb, litter, base, _ramp(nb, p.noise(3.0, 2, 0.5, offset=5.0), [(0.3, 0x6a4a28), (0.7, 0x8a6a34)]))
        fine = p.noise(16.0, 4, 0.7, offset=1.1)
        base = _mix(nb, 0.3, base, _ramp(nb, fine, [(0.3, 0x2c3a1c), (0.7, 0x6a7a3c)]), "OVERLAY")
        _finish(nb, base, fine, bump=0.4)
    elif kind == "dirt":
        patches = p.noise(0.8, 3, 0.5)
        base = _ramp(nb, patches, [(0.3, 0x7a5e3e), (0.55, 0x8c6e48), (0.75, 0x9c7e56)])
        grass = p.noise(1.1, 3, 0.6, offset=4.4)
        base = _mix(nb, _map(nb, grass, 0.6, 0.72, 0, 0.6), base, 0x6a7a3a)
        d, _c = p.voronoi(5.0, offset=1.3)
        crack = _map(nb, d, 0.0, 0.06, 0.82, 1.0)
        fine = p.noise(18.0, 5, 0.7, offset=2.3)
        base = _mix(nb, 0.3, base, _ramp(nb, fine, [(0.3, 0x5a4430), (0.7, 0xa88a64)]), "OVERLAY")
        comb = nb.n("ShaderNodeCombineXYZ")
        for i in range(3):
            nb.link(crack, comb.inputs[i])
        base = _mix(nb, 1.0, base, comb.outputs[0], "MULTIPLY")
        h = nb.n("ShaderNodeMath", operation="MULTIPLY")
        nb.link(fine, h.inputs[0])
        nb.link(crack, h.inputs[1])
        _finish(nb, base, h.outputs[0], bump=0.45)
    elif kind == "sand":
        patches = p.noise(0.7, 3, 0.5)
        base = _ramp(nb, patches, [(0.3, 0xc8ae78), (0.55, 0xd6bc86), (0.75, 0xe2ca96)])
        # wind ripples: sine of the torus angle (integer frequency keeps it periodic)
        warp = p.noise(1.5, 2, 0.5, offset=6.0)
        sep = nb.n("ShaderNodeSeparateXYZ")
        nb.link(p.pos, sep.inputs[0])
        lin = nb.n("ShaderNodeMath", operation="ADD")
        nb.link(sep.outputs["X"], lin.inputs[0])
        nb.link(sep.outputs["Y"], lin.inputs[1])
        ph = nb.n("ShaderNodeMath", operation="MULTIPLY_ADD")
        nb.link(warp, ph.inputs[0])
        ph.inputs[1].default_value = 1.2
        nb.link(lin.outputs[0], ph.inputs[2])
        sn = nb.n("ShaderNodeMath", operation="SINE")
        mul = nb.n("ShaderNodeMath", operation="MULTIPLY")
        nb.link(ph.outputs[0], mul.inputs[0])
        mul.inputs[1].default_value = 2 * math.pi * 7 / period
        nb.link(mul.outputs[0], sn.inputs[0])
        fine = p.noise(20.0, 3, 0.6, offset=2.0)
        base = _mix(nb, 0.25, base, _ramp(nb, fine, [(0.3, 0xa89060), (0.7, 0xf0dcac)]), "OVERLAY")
        hh = nb.n("ShaderNodeMath", operation="MULTIPLY_ADD")
        nb.link(sn.outputs[0], hh.inputs[0])
        hh.inputs[1].default_value = 0.5
        nb.link(fine, hh.inputs[2])
        _finish(nb, base, hh.outputs[0], bump=0.35, rough=0.9)
    elif kind in ("stone", "rock"):
        # rocky ground: gravelly soil with some voronoi cells raised as slabs
        ground = _ramp(nb, p.noise(1.2, 3, 0.5, offset=4.0), [(0.3, 0x6e6450), (0.55, 0x7a7058), (0.8, 0x6a7046)])
        gravel = p.noise(22.0, 3, 0.6, offset=6.0)
        ground = _mix(nb, 0.5, ground, _ramp(nb, gravel, [(0.35, 0x4a4438), (0.65, 0xa49a86)]), "OVERLAY")
        _d, col = p.voronoi(1.9, offset=0.7)
        edge_d, _ = p.voronoi(1.9, feature="DISTANCE_TO_EDGE", offset=0.7)
        sel = nb.n("ShaderNodeSeparateColor")
        nb.link(col, sel.inputs[0])
        is_rock = _map(nb, sel.outputs[0], 0.54, 0.58, 0.0, 1.0)
        inner = _map(nb, edge_d, 0.03, 0.2, 0.0, 1.0)
        slab = _op(nb, "MULTIPLY", is_rock, inner)
        rock = _ramp(nb, sel.outputs[1], [(0.0, 0x6e6a62), (0.5, 0x7e786c), (1.0, 0x8e8878)])
        fine = p.noise(12.0, 5, 0.65, offset=3.0)
        rock = _mix(nb, 0.4, rock, _ramp(nb, fine, [(0.3, 0x5a554c), (0.7, 0xc4bcac)]), "OVERLAY")
        base = _mix(nb, slab, ground, rock)
        h = _op(nb, "MULTIPLY_ADD", slab, 1.0, _op(nb, "MULTIPLY", fine, 0.3))
        _finish(nb, base, h, bump=0.8, normal_dist=0.04)
    elif kind == "mud":
        patches = p.noise(0.9, 3, 0.5)
        base = _ramp(nb, patches, [(0.3, 0x56462c), (0.55, 0x624f32), (0.75, 0x6c5a3a)])
        wet = _map(nb, p.noise(2.0, 3, 0.55, offset=2.5), 0.6, 0.66, 0.0, 1.0)
        base = _mix(nb, _op(nb, "MULTIPLY", wet, 0.6), base, 0x3e3220)
        ruts = _map(nb, p.noise(6.0, 3, 0.6, offset=7.0), 0.35, 0.5, 0.0, 0.25)
        base = _mix(nb, ruts, base, 0x40341f)
        fine = p.noise(15.0, 4, 0.7, offset=4.0)
        base = _mix(nb, 0.35, base, _ramp(nb, fine, [(0.3, 0x30281a), (0.7, 0x8a7a54)]), "OVERLAY")
        rough = _map(nb, wet, 0.0, 1.0, 0.85, 0.2)
        _finish(nb, base, fine, bump=0.45, rough_sock=rough, spec=0.5)
    elif kind in ("snow", "packed_snow"):
        patches = p.noise(0.8, 3, 0.5)
        if kind == "snow":
            base = _ramp(nb, patches, [(0.3, 0xdce6ee), (0.6, 0xeef4f8), (0.8, 0xf8fbfd)])
        else:
            base = _ramp(nb, patches, [(0.3, 0xc4ccd2), (0.6, 0xd6dce0), (0.8, 0xe4e8ea)])
            dirt = _map(nb, p.noise(2.2, 3, 0.6, offset=1.0), 0.6, 0.75, 0.0, 0.5)
            base = _mix(nb, dirt, base, 0x9a9488)
        fine = p.noise(10.0, 4, 0.6, offset=5.0)
        _finish(nb, base, fine, bump=0.25, rough=0.6, spec=0.4)
    elif kind == "ice":
        patches = p.noise(0.8, 3, 0.5)
        base = _ramp(nb, patches, [(0.3, 0x8ec4d6), (0.6, 0xa8d6e4), (0.8, 0xc4e6f0)])
        edge_d, _ = p.voronoi(2.4, feature="DISTANCE_TO_EDGE", offset=0.4)
        crack = _map(nb, edge_d, 0.0, 0.025, 1.0, 0.0)
        base = _mix(nb, crack, base, 0xeef8fc)
        _finish(nb, base, crack, bump=0.3, rough=0.12, spec=0.6)
    elif kind in ("water", "water_shallow"):
        # looping ripples: two noise fields cross-faded with cos/sin of the frame phase
        t = frame / max(1, frames)
        a = _op(nb, "SUBTRACT", p.noise(1.8, 2, 0.5, offset=11.0), 0.5)
        b2 = _op(nb, "SUBTRACT", p.noise(1.8, 2, 0.5, offset=23.0), 0.5)
        wave = _op(nb, "MULTIPLY_ADD", a, math.cos(2 * math.pi * t), _op(nb, "MULTIPLY", b2, math.sin(2 * math.pi * t)))
        ridge = _op(nb, "ABSOLUTE", wave)
        crest = _map(nb, ridge, 0.0, 0.02, 1.0, 0.0)
        depth = p.noise(0.6, 2, 0.5, offset=3.0)
        if kind == "water":
            base = _ramp(nb, depth, [(0.3, 0x1c4562), (0.6, 0x214f6c), (0.8, 0x285a76)])
            crest_col, amt = 0x5a8ca4, 0.28
        else:
            base = _ramp(nb, depth, [(0.3, 0x36707e), (0.6, 0x427e86), (0.8, 0x4e8a8c)])
            sand = _map(nb, p.noise(2.0, 3, 0.5, offset=8.0), 0.45, 0.7, 0.0, 0.4)
            base = _mix(nb, sand, base, 0x7e9472)
            crest_col, amt = 0x8ab8b8, 0.3
        base = _mix(nb, _op(nb, "MULTIPLY", crest, amt), base, crest_col)
        _finish(nb, base, _op(nb, "MULTIPLY", wave, 0.5), bump=0.2, rough=0.15, spec=0.35, normal_dist=0.05)
    else:
        raise ValueError(kind)
    return mt


# ---------------------------------------------------------------------------
# Periodic 3D scatter (tufts, pebbles, flowers)
# ---------------------------------------------------------------------------


def _tuft(bm: bmesh.types.BMesh, x: float, y: float, h: float, rng: random.Random, blades: int = 5) -> None:
    for _ in range(blades):
        a = rng.uniform(0, math.tau)
        lean = rng.uniform(0.1, 0.4)
        w = 0.006
        bx, by = x + rng.uniform(-0.01, 0.01), y + rng.uniform(-0.01, 0.01)
        tip = (bx + math.cos(a) * h * lean, by + math.sin(a) * h * lean, h * rng.uniform(0.7, 1.0))
        p, q = (bx - math.sin(a) * w, by + math.cos(a) * w, 0.0), (bx + math.sin(a) * w, by - math.cos(a) * w, 0.0)
        vs = [bm.verts.new(p), bm.verts.new(q), bm.verts.new(tip)]
        bm.faces.new(vs)


def _pebble(bm: bmesh.types.BMesh, x: float, y: float, r: float, rng: random.Random) -> None:
    tmp = bmesh.new()
    bmesh.ops.create_icosphere(tmp, subdivisions=1, radius=r)
    sx, sy, sz = rng.uniform(0.8, 1.3), rng.uniform(0.8, 1.2), rng.uniform(0.35, 0.6)
    vmap = {}
    for v in tmp.verts:
        vmap[v] = bm.verts.new((x + v.co.x * sx, y + v.co.y * sy, v.co.z * sz * 0.8))
    for f in tmp.faces:
        bm.faces.new([vmap[v] for v in f.verts])
    tmp.free()


def scatter(col: bpy.types.Collection, kind: str, period: int, rng: random.Random, mat_for) -> None:
    """Scatter periodic detail over a (period+2)^2 area around the block."""
    specs = {
        "grass": [("tuft", 26, 0.035, "grass_blade"), ("flower_w", 1.2, 0.016, "flower_w"), ("flower_y", 0.8, 0.016, "flower_y")],
        "meadow": [("tuft", 30, 0.04, "grass_blade"), ("flower_w", 5, 0.016, "flower_w"), ("flower_y", 4, 0.016, "flower_y"),
                   ("flower_p", 3, 0.016, "flower_p")],
        "forest": [("tuft", 8, 0.04, "fern"), ("pebble", 2, 0.02, "pebble"), ("twig", 3, 0.0, "twig")],
        "snow_forest": [("twig", 4, 0.0, "twig"), ("pebble", 1.5, 0.018, "pebble")],
        "dirt": [("pebble", 14, 0.016, "pebble"), ("tuft", 3, 0.03, "grass_blade")],
        "stone": [("pebble", 10, 0.022, "pebble"), ("tuft", 5, 0.03, "grass_blade")],
        "sand": [("pebble", 3, 0.012, "pebble_light")],
        "mud": [("pebble", 4, 0.014, "pebble")],
        "packed_snow": [("pebble", 2, 0.012, "pebble")],
    }.get(kind, [])
    for what, density, size, mkey in specs:
        pts = []
        n = int(density * period * period)
        for _ in range(n):
            pts.append((rng.uniform(0, period), rng.uniform(0, period), rng.uniform(0.7, 1.3), rng.random()))
        bm = bmesh.new()
        lo, hi = -1, 1
        for ox in range(lo, hi + 1):
            for oy in range(lo, hi + 1):
                r2 = random.Random(1234)
                for (px, py, s, k) in pts:
                    x = px + ox * period
                    y = -(py + oy * period)
                    # only within the rendered neighbourhood of the block
                    if not (-1.5 < x < period + 1.5 and -period - 1.5 < y < 1.5):
                        continue
                    r2.seed(hash((round(px, 5), round(py, 5))) & 0xFFFFFFFF)
                    if what == "tuft":
                        _tuft(bm, x, y, size * s, r2, 4 if mkey == "grass_blade" else 6)
                    elif what.startswith("flower"):
                        _pebble(bm, x, y, size * s, r2)
                    elif what == "pebble":
                        _pebble(bm, x, y, size * s, r2)
                    elif what == "twig":
                        a = r2.uniform(0, math.tau)
                        ln = 0.08 * s
                        vs = [bm.verts.new((x, y, 0.004)), bm.verts.new((x + math.cos(a) * ln, y + math.sin(a) * ln, 0.004)),
                              bm.verts.new((x + math.cos(a) * ln, y + math.sin(a) * ln, 0.012)), bm.verts.new((x, y, 0.012))]
                        bm.faces.new(vs)
        if not bm.verts:
            bm.free()
            continue
        if what.startswith("flower"):
            for v in bm.verts:
                v.co.z += 0.014
        me = bpy.data.meshes.new(f"scatter_{kind}_{what}")
        bm.to_mesh(me)
        bm.free()
        me.materials.append(mat_for(mkey))
        for p in me.polygons:
            p.use_smooth = what != "tuft"
        ob = bpy.data.objects.new(me.name, me)
        ob["kr_keep_uv"] = True
        col.objects.link(ob)


def detail_material(key: str, period: int) -> bpy.types.Material:
    name = f"kr_detail_{key}_{period}"
    mt = bpy.data.materials.get(name)
    if mt:
        return mt
    mt = bpy.data.materials.new(name)
    nb = NodeBuilder(mt)
    p = Periodic(nb, period)
    colors = {
        "grass_blade": [(0.3, 0x86a846), (0.7, 0xa8c460)],
        "fern": [(0.3, 0x5a8434), (0.7, 0x76a044)],
        "flower_w": [(0.3, 0xe8e4d8), (0.7, 0xfaf6ea)],
        "flower_y": [(0.3, 0xe0b830), (0.7, 0xf0cc48)],
        "flower_p": [(0.3, 0x9a6ab8), (0.7, 0xb284cc)],
        "pebble": [(0.3, 0x857c6e), (0.7, 0xaaa294)],
        "pebble_light": [(0.3, 0xb8a888), (0.7, 0xd4c4a4)],
        "twig": [(0.3, 0x4a3420), (0.7, 0x6a4c30)],
    }[key]
    base = _ramp(nb, p.noise(3.0, 2, 0.5, offset=9.0), colors)
    _finish(nb, base, None, rough=0.85)
    return mt


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

TERRAINS = [
    # name, material kind, period, tileType, frames
    ("grass", "grass", 4, "GRASS", 1),
    ("meadow", "meadow", 4, "GRASS", 1),
    ("forest", "forest", 4, "FOREST", 1),
    ("dirt", "dirt", 4, "DIRT", 1),
    ("sand", "sand", 4, "SAND", 1),
    ("stone", "stone", 4, "STONE", 1),
    ("mud", "mud", 4, "MUD", 1),
    ("snow", "snow", 2, "SNOW", 1),
    ("snow_forest", "snow_forest", 2, "SNOW_FOREST", 1),
    ("packed_snow", "packed_snow", 2, "PACKED_SNOW", 1),
    ("ice", "ice", 2, "ICE", 1),
    ("bridge_x", "bridge_x", 2, "BRIDGE", 1),
    ("bridge_y", "bridge_y", 2, "BRIDGE", 1),
    ("water", "water", 2, "WATER", 4),
    ("water_shallow", "water_shallow", 2, "WATER_SHALLOW", 4),
]

CLIFFS = [
    # name, material recipe, lip colour (None = no lip variant)
    ("earth", "earth", 0x5e8234),
    ("rock", "rock", 0x5e8234),
    ("sand", "sandbank", None),
    ("snow", "rock_cold", 0xe8eef2),
]


def setup_scene(scene: bpy.types.Scene) -> None:
    g = bpy.data.objects.get(scene.get("kr_ground", ""))
    if g is not None:
        g.hide_render = True
    vl = scene.view_layers.get("shadow")
    if vl is not None:
        vl.use = False


def _block_frame(period: int) -> tuple[K.Frame, Vector]:
    m = 10
    w = period * K.TILE_W_PX + 2 * m
    h = period * K.TILE_H_PX + 2 * m
    return K.Frame(w, h, w // 2, h - m), Vector((period, -period, 0.0))


def _diamond_mask(w: int, h: int, cx: float, cy: float, hw: float, hh: float) -> np.ndarray:
    ys, xs = np.mgrid[0:h, 0:w]
    return (np.abs(xs + 0.5 - cx) / hw + np.abs(ys + 0.5 - cy) / hh) <= 1.0


def render_block(scene, name: str, kind: str, period: int, frame: int, frames: int, rng: random.Random) -> np.ndarray:
    col = K.asset_collection(scene, f"terrain_{name}_{frame}")
    me = bpy.data.meshes.new(f"ground_{name}")
    lo, hi = -2.0, period + 2.0
    me.from_pydata([(lo, -hi, 0), (hi, -hi, 0), (hi, -lo, 0), (lo, -lo, 0)], [], [(0, 1, 2, 3)])
    me.materials.append(ground_material(kind, period, frame, frames))
    ob = bpy.data.objects.new(me.name, me)
    ob["kr_keep_uv"] = True
    col.objects.link(ob)
    if frame == 0 or kind not in ("water", "water_shallow"):
        scatter(col, kind, period, random.Random(f"scatter:{name}"), lambda k: detail_material(k, period))
    fr, anchor = _block_frame(period)
    res = K.render_collection(scene, col, fr, anchor, want_shadow=False)
    return res.beauty, fr


def slice_tiles(block: np.ndarray, fr: K.Frame, period: int) -> dict[tuple[int, int], np.ndarray]:
    out = {}
    fw, fh = TILE_FRAME
    mask = _diamond_mask(fw, fh, fw / 2, fh / 2, 64 + BLEED_X, 32 + BLEED_Y)
    for gx in range(period):
        for gy in range(period):
            # pixel of this tile's bottom corner inside the block image
            bx = fr.anchor_x + (gx - gy) * 64
            by = fr.anchor_y + (gx + gy - 2 * (period - 1)) * 32
            x0, y0 = bx - fw // 2, by - 64 - BLEED_Y
            crop = block[y0:y0 + fh, x0:x0 + fw].copy()
            crop[..., 3] = np.where(mask, 255, 0)
            crop[~mask] = 0
            out[(gx, gy)] = crop
    return out


def cliff_material(recipe: str, lip: int | None) -> bpy.types.Material:
    name = f"kr_cliff_{recipe}_{lip}"
    mt = bpy.data.materials.get(name)
    if mt:
        return mt
    mt = bpy.data.materials.new(name)
    nb = NodeBuilder(mt)
    # periodic along the face (1 tile) and vertically (1 elevation step)
    geo = nb.n("ShaderNodeNewGeometry")
    sep = nb.n("ShaderNodeSeparateXYZ")
    nb.link(geo.outputs["Position"], sep.inputs[0])
    along = nb.n("ShaderNodeMath", operation="SUBTRACT")
    nb.link(sep.outputs["X"], along.inputs[0])
    nb.link(sep.outputs["Y"], along.inputs[1])
    p = Periodic.__new__(Periodic)
    p.nb = nb
    ca, sa = Periodic._circle(p, along.outputs[0], 1.0, 1.0 / (2 * math.pi))
    cb, sb = Periodic._circle(p, sep.outputs["Z"], STEP_UNITS, STEP_UNITS / (2 * math.pi) * 3.0)
    comb = nb.n("ShaderNodeCombineXYZ")
    nb.link(ca, comb.inputs[0])
    nb.link(sa, comb.inputs[1])
    nb.link(cb, comb.inputs[2])
    p.vec, p.w, p.pos = comb.outputs[0], sb, geo.outputs["Position"]
    stops = {
        "rock": [(0.25, 0x6e665a), (0.5, 0x857c6c), (0.75, 0x9a907e)],
        "earth": [(0.25, 0x5e4630), (0.5, 0x6e5438), (0.75, 0x806244)],
        "sandbank": [(0.25, 0xa48a5e), (0.5, 0xb89c6c), (0.75, 0xc8ae7e)],
        "rock_cold": [(0.25, 0x5e626a), (0.5, 0x74787e), (0.75, 0x8a8e94)],
    }[recipe]
    n1 = p.noise(1.4, 4, 0.6)
    base = _ramp(nb, n1, stops)
    fine = p.noise(6.0, 5, 0.7, offset=2.0)
    base = _mix(nb, 0.35, base, _ramp(nb, fine, [(0.3, 0x3a342c), (0.7, 0xc0b6a4)]), "OVERLAY")
    # strata: darker band at the bottom of every step
    zz = nb.n("ShaderNodeMath", operation="MODULO")
    nb.link(sep.outputs["Z"], zz.inputs[0])
    zz.inputs[1].default_value = STEP_UNITS
    band = _map(nb, zz.outputs[0], 0.0, STEP_UNITS * 0.3, 0.7, 1.0)
    comb2 = nb.n("ShaderNodeCombineXYZ")
    for i in range(3):
        nb.link(band, comb2.inputs[i])
    base = _mix(nb, 1.0, base, comb2.outputs[0], "MULTIPLY")
    if lip is not None:
        top = _map(nb, zz.outputs[0], STEP_UNITS * 0.3, STEP_UNITS * 0.6, 0.0, 1.0)
        hang = _map(nb, p.noise(5.0, 3, 0.6, offset=5.0), 0.3, 0.7, -0.6, 0.5)
        add = nb.n("ShaderNodeMath", operation="ADD", use_clamp=True)
        nb.link(top, add.inputs[0])
        nb.link(hang, add.inputs[1])
        base = _mix(nb, add.outputs[0], base, lip)
    h = nb.n("ShaderNodeMath", operation="MULTIPLY_ADD")
    nb.link(fine, h.inputs[0])
    h.inputs[1].default_value = 0.6
    nb.link(n1, h.inputs[2])
    _finish(nb, base, h.outputs[0], bump=0.7)
    return mt


def render_cliff(scene, recipe: str, side: str, lip: int | None) -> np.ndarray:
    """One step of the left (-Y facing) or right (+X facing) side face of a raised tile."""
    col = K.asset_collection(scene, f"cliff_{recipe}_{side}_{lip}")
    steps = 5
    z1 = STEP_UNITS * steps
    me = bpy.data.meshes.new("cliff")
    if side == "left":
        verts = [(-1, -1, 0), (2, -1, 0), (2, -1, z1), (-1, -1, z1)]  # wall along X at y=-1, faces -Y
    else:
        verts = [(1, -2, 0), (1, 1, 0), (1, 1, z1), (1, -2, z1)]  # wall along Y at x=1, faces +X
    me.from_pydata(verts, [], [(0, 1, 2, 3)])
    me.materials.append(cliff_material(recipe, lip))
    ob = bpy.data.objects.new("cliff", me)
    ob["kr_keep_uv"] = True
    col.objects.link(ob)
    # plateau on top so the lip catches the right light/AO
    top = bpy.data.meshes.new("plateau")
    top.from_pydata([(-1, -1, z1), (2, -1, z1), (2, 2, z1), (-1, 2, z1)] if side == "left" else
                    [(-2, -2, z1), (1, -2, z1), (1, 1, z1), (-2, 1, z1)], [], [(0, 1, 2, 3)])
    top.materials.append(ground_material("snow" if recipe == "rock_cold" else "grass", 2 if recipe == "rock_cold" else 4))
    t = bpy.data.objects.new("plateau", top)
    t["kr_keep_uv"] = True
    col.objects.link(t)
    # lip: the topmost step (anchor = tile bottom corner at the plateau);
    # plain: a middle step, away from the plateau edge
    anchor = Vector((1.0, -1.0, z1 if lip is not None else STEP_UNITS * 3))
    fr = K.Frame(128 + 40, 64 + 60, 84, 50)
    res = K.render_collection(scene, col, fr, anchor, want_shadow=False)
    img = res.beauty
    # parallelogram: top edge runs from the bottom corner towards the left (or right) corner
    fw, fh = 64, 32 + STEP_PX
    out = np.zeros((fh, fw, 4), np.uint8)
    ys, xs = np.mgrid[0:fh, 0:fw]
    if side == "left":
        x0 = fr.anchor_x - 64
        top_edge = (xs + 0.5) * 0.5  # y of the top edge at this column (left corner at y=0)
        crop = img[fr.anchor_y - 32:fr.anchor_y - 32 + fh, x0:x0 + fw]
    else:
        x0 = fr.anchor_x
        top_edge = 32 - (xs + 0.5) * 0.5
        crop = img[fr.anchor_y - 32:fr.anchor_y - 32 + fh, x0:x0 + fw]
    inside = ((ys + 0.5) >= top_edge) & ((ys + 0.5) < top_edge + STEP_PX)
    out[inside] = crop[inside]
    out[inside, 3] = 255
    return out


def transition_masks(rng: random.Random) -> dict[str, np.ndarray]:
    """White masks with soft noisy alpha for blending a neighbour's ground over a tile.

    Keys use game directions: edge_px.N (neighbour at x+1), edge_py.N, edge_mx.N,
    edge_my.N with N = 0..EDGE_VARIANTS-1 (pick per tile, e.g. by a position hash),
    and corner_* for diagonal-only neighbours (corner_px_py = neighbour at x+1,y+1).
    Edge wobble is zero at the tile corners, so every variant joins every other.
    """
    fw, fh = TILE_FRAME
    cx, cy = fw / 2, fh / 2
    ys, xs = np.mgrid[0:fh, 0:fw].astype(np.float32)
    # tile-local coords: u along +x game axis, v along +y game axis, both 0..1
    sx = (xs + 0.5 - cx) / 64.0
    sy = (ys + 0.5 - cy) / 32.0
    u = (sx + sy) / 2 + 0.5
    v = (sy - sx) / 2 + 0.5

    def pnoise(t: np.ndarray, seed: int) -> np.ndarray:
        r = np.random.default_rng(seed)
        acc = np.zeros_like(t)
        for k in (1, 2, 3, 5, 7):
            acc += r.uniform(0.3, 1.0) / k * np.sin(2 * np.pi * k * t + r.uniform(0, 6.28))
        return acc / 1.4

    out = {}
    width = 0.34

    def edge_alpha(dist: np.ndarray, along: np.ndarray, seed: int) -> np.ndarray:
        # fully the neighbour's ground from the shared edge (and in the bleed beyond it)
        # to a wobbly depth, then a smooth fade; depth is 0 at both tile corners so any
        # variant joins any other
        t = np.clip(along, 0.0, 1.0)
        depth = 0.16 * np.sin(np.pi * t) * (0.55 + 0.45 * np.clip(pnoise(t, seed), -1.0, 1.0))
        a = 1.0 - np.clip((dist - depth) / width, 0.0, 1.0)
        return a * a * (3 - 2 * a)

    edges = {"edge_px": (1 - u, v), "edge_mx": (u, v), "edge_py": (1 - v, u), "edge_my": (v, u)}
    for i, (k, (dist, along)) in enumerate(edges.items()):
        for n in range(EDGE_VARIANTS):
            out[f"{k}.{n}"] = edge_alpha(dist, along, 100 + 10 * i + n)
    corners = {"corner_px_py": (1 - u, 1 - v), "corner_px_my": (1 - u, v), "corner_mx_py": (u, 1 - v), "corner_mx_my": (u, v)}
    for i, (k, (du, dv)) in enumerate(corners.items()):
        du, dv = np.maximum(du, 0.0), np.maximum(dv, 0.0)
        d = np.sqrt(du * du + dv * dv)
        depth = 0.05 * (1.0 + np.clip(pnoise(np.arctan2(dv, du) / (np.pi / 2), 200 + i), -1.0, 1.0))
        a = 1.0 - np.clip((d - depth) / (width * 0.8), 0.0, 1.0)
        out[k] = a * a * (3 - 2 * a)
    res = {}
    for k, a in out.items():
        img = np.zeros((fh, fw, 4), np.uint8)
        img[..., :3] = 255
        # not clipped to the diamond: overlay alpha = neighbour tile alpha (which has the
        # diamond cut) * mask, so the overlay covers the base tile's bleed exactly
        img[..., 3] = np.round(a * 255).astype(np.uint8)
        res[k] = img
    return res


def render(scene: bpy.types.Scene, out_dir: str, only: str | None) -> list[dict]:
    records = []
    keys = [k.strip() for k in only.split(",")] if only else None

    def want(n: str) -> bool:
        return keys is None or any(k in n for k in keys)

    fw, fh = TILE_FRAME
    for name, kind, period, tile_type, frames in TERRAINS:
        if not want(f"terrain_{name}"):
            continue
        for frame in range(frames):
            block, fr = render_block(scene, name, kind, period, frame, frames, random.Random(name))
            tiles = slice_tiles(block, fr, period)
            for (gx, gy), img in sorted(tiles.items()):
                idx = gx + period * gy
                fname = f"terrain_{name}_{idx:02d}" + (f"_f{frame}" if frames > 1 else "")
                path = os.path.join(out_dir, fname + ".png")
                K.write_png(path, img)
                variant = str(idx) if frames == 1 else f"{idx}.{frame}"
                records.append({"name": fname, "width": fw, "height": fh, "anchor": [fw // 2, fh - BLEED_Y],
                                "footprint": [1, 1], "files": {"frame": path},
                                "meta": {"asset": f"terrain.{name}", "variant": variant, "kind": "terrain",
                                         "tileType": tile_type, "period": period, "frameIndex": frame}})
            print(f"rendered terrain {name} frame {frame}")
    for recipe, mat_recipe, lip_color in CLIFFS:
        for side in ("left", "right"):
            for lip in (False, True):
                if lip and lip_color is None:
                    continue
                fname = f"cliff_{recipe}_{side}" + ("_lip" if lip else "")
                if not want(fname):
                    continue
                img = render_cliff(scene, mat_recipe, side, lip_color if lip else None)
                path = os.path.join(out_dir, fname + ".png")
                K.write_png(path, img)
                anchor = [64, 32] if side == "left" else [0, 32]
                records.append({"name": fname, "width": 64, "height": 32 + STEP_PX, "anchor": anchor, "footprint": [1, 1],
                                "files": {"frame": path},
                                "meta": {"asset": f"terrain.cliff_{recipe}", "variant": side + ("_lip" if lip else ""),
                                         "kind": "cliff", "stepPx": STEP_PX // K.RENDER_SCALE}})
                print(f"rendered {fname}")
    if want("transition"):
        for k, img in transition_masks(random.Random(5)).items():
            fname = "transition_" + k.replace(".", "_")
            path = os.path.join(out_dir, fname + ".png")
            K.write_png(path, img)
            records.append({"name": fname, "width": fw, "height": fh, "anchor": [fw // 2, fh - BLEED_Y],
                            "footprint": [1, 1], "files": {"frame": path},
                            "meta": {"asset": "terrain.transition", "variant": k, "kind": "transition_mask"}})
    return records

