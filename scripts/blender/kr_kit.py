"""Geometry kit for the Kingdoms RTS sprite pipeline.

Small procedural building blocks (boxes, beams, roofs, towers, props) that
asset family scripts compose into buildings, nature and decor. Everything is
built with bmesh plus a few modifiers, so it runs headless and inside a live
Blender session alike.

Orientation reminder: the camera looks from the +X / -Y corner. The visible
walls are the -Y face ("front-left", sunlit) and the +X face ("front-right",
in shade). Put doors, windows and detail there.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

from kr_lib import Surface, material

# ---------------------------------------------------------------------------
# Material palette (sRGB hex). Kept in one place so every building shares
# the same stone, timber and roof tones.
# ---------------------------------------------------------------------------

M = {
    # roofs
    "thatch": Surface((0xc6a15e, 0x9e7d45, 0x7d6338), "thatch", 0.035, roughness=0.95, bump=0.55, noise_scale=3.0, grime=0.0, ao=0.6),
    "thatch_old": Surface((0xa58a5c, 0x86704c, 0x6a5a40), "thatch", 0.035, roughness=0.95, bump=0.55, noise_scale=3.0, grime=0.0, ao=0.6),
    "shingle": Surface((0x80664a, 0x65503c, 0x947858), "shingles", 0.045, mortar=0x2e2216, roughness=0.9, bump=0.5, grime=0.0),
    "tile_red": Surface((0xc05a34, 0xa04428, 0x83321e), "tiles", 0.045, mortar=0x3c160e, roughness=0.75, bump=0.6, noise_scale=2.5, grime=0.0),
    "tile_dark": Surface((0xa4462e, 0x883626, 0x6c2a1e), "tiles", 0.045, mortar=0x2e100a, roughness=0.75, bump=0.6, noise_scale=2.5, grime=0.0),
    "slate": Surface((0x5c636c, 0x4a5058, 0x707882), "shingles", 0.04, mortar=0x22262a, roughness=0.55, bump=0.5, grime=0.0),
    "copper": Surface((0x5f9a84, 0x4e8672, 0x76ae98), "none", roughness=0.5, metallic=0.2, grime=0.0),
    # walls
    "daub": Surface((0xcdb68e, 0xb59d74, 0x9b8460), "soil", 0.05, roughness=0.95, bump=0.25, noise_scale=4.0, grime=0.35),
    "plaster": Surface((0xebe2cc, 0xddd2b8, 0xc9bc9e), "soil", 0.08, roughness=0.9, bump=0.12, noise_scale=3.0, grime=0.3),
    "plaster_ochre": Surface((0xe4bb6a, 0xd4a655, 0xbf9044), "soil", 0.08, roughness=0.9, bump=0.12, noise_scale=3.0, grime=0.3),
    "plaster_rose": Surface((0xe2b5a0, 0xd6a28c, 0xc48e78), "soil", 0.08, roughness=0.9, bump=0.12, noise_scale=3.0, grime=0.3),
    "fieldstone": Surface((0x9e927c, 0x807460, 0x5c5446), "rock", 0.045, roughness=0.9, bump=0.6, noise_scale=5.0, grime=0.2),
    "ashlar": Surface((0xcdb992, 0xb7a27c, 0x9a8462), "brick", 0.065, mortar=0xe0d4b8, roughness=0.85, bump=0.45, grime=0.3),
    "ashlar_grey": Surface((0xbcb5a8, 0xa39c90, 0x878074), "brick", 0.065, mortar=0xd8d2c4, roughness=0.85, bump=0.45, grime=0.3),
    "brick": Surface((0xb05e3e, 0x964a32, 0x7a3a28), "brick", 0.032, mortar=0xcfc2a8, roughness=0.85, bump=0.4, grime=0.3),
    # wood
    "timber": Surface((0x5c3c22, 0x4a301a, 0x6c4a2c), "bark", 0.05, roughness=0.85, bump=0.3, grime=0.15),
    "planks": Surface((0x8c6844, 0x735234, 0x5c4028), "planks", 0.07, mortar=0x2a1c10, roughness=0.85, bump=0.35, grime=0.3),
    "planks_dark": Surface((0x6a4c32, 0x553c26, 0x46301e), "planks", 0.07, mortar=0x1e140c, roughness=0.85, bump=0.35, grime=0.3),
    "log": Surface((0x7c5a3a, 0x5e432a, 0x4a3420), "bark", 0.03, roughness=0.9, bump=0.5, grime=0.2),
    "log_end": Surface((0xc8a070, 0xb08858, 0x8a6a44), "none", roughness=0.8, grime=0.0),
    "door": Surface((0x4e3420, 0x3e2818, 0x5a3c24), "planks", 0.05, mortar=0x1a0f08, roughness=0.8, bump=0.3, grime=0.1),
    # misc
    "void": Surface((0x1c1610, 0x16110c), "none", roughness=1.0, grime=0.0, ao=0.0),
    "glass": Surface((0x3e5262, 0x34465a, 0x5a7082), "none", roughness=0.15, grime=0.0, ao=0.0),
    "iron": Surface((0x3c3a38, 0x2c2a28, 0x4a4644), "none", roughness=0.5, metallic=0.7, grime=0.0),
    "bronze": Surface((0x8a6a3a, 0x6e5430, 0xa07c44), "none", roughness=0.4, metallic=0.8, grime=0.0),
    "rope": Surface((0xb8a074, 0x9c865e), "none", roughness=0.95, grime=0.0),
    "straw": Surface((0xd8b864, 0xc0a050, 0xa08440), "straw", 0.02, roughness=0.95, bump=0.4, grime=0.0),
    "hay": Surface((0xc8aa5a, 0xb09246, 0x8e7838), "straw", 0.02, roughness=0.95, bump=0.5, grime=0.1),
    "dirt": Surface((0x8a7254, 0x735e44, 0x9a8464), "soil", 0.03, roughness=1.0, bump=0.3, noise_scale=4.0, grime=0.0, ao=0.3),
    "soil_plowed": Surface((0x6e5236, 0x5a422c, 0x7c5e40), "soil", 0.03, roughness=1.0, bump=0.4, grime=0.0, ao=0.4),
    "gravel": Surface((0x9a9080, 0x7e766a, 0xb0a696), "rock", 0.02, roughness=1.0, bump=0.4, grime=0.0, ao=0.3),
    "rock": Surface((0x9a9184, 0x7e776c, 0x5e584e), "rock", 0.12, roughness=0.9, bump=0.8, noise_scale=3.0, grime=0.15),
    "rock_cut": Surface((0xc4b89e, 0xae9f84, 0x8e826a), "rock", 0.08, roughness=0.85, bump=0.4, grime=0.1),
    "cloth": Surface((0xd8ccb0, 0xc6b896, 0xb0a07c), "cloth", 0.05, roughness=0.95, grime=0.1),
    "cloth_red": Surface((0xa8362a, 0x8c2a20, 0x6e2018), "cloth", 0.05, roughness=0.95, grime=0.1),
    "team": Surface((0xdadada, 0xc8c8c8, 0xb4b4b4), "cloth", 0.05, roughness=0.9, grime=0.0, team=True, ao=0.3),
    "team_paint": Surface((0xd2d2d2, 0xc2c2c2, 0xb0b0b0), "none", roughness=0.6, grime=0.0, team=True, ao=0.3),
    "glow": Surface((0xffa040, 0xff7a20), "none", roughness=1.0, emission=6.0, grime=0.0, ao=0.0),
    "gold": Surface((0xf0c040, 0xd8a428, 0xb08418), "none", roughness=0.3, metallic=0.9, grime=0.0, ao=0.2),
    "water": Surface((0x3c6a88, 0x2e5a78), "none", roughness=0.1, grime=0.0, ao=0.0),
    "char": Surface((0x302822, 0x221c18, 0x403428), "bark", 0.03, roughness=1.0, bump=0.6, grime=0.0),
    "ash": Surface((0x5c5650, 0x48423c, 0x6e665c), "soil", 0.03, roughness=1.0, bump=0.3, grime=0.0, ao=0.3),
    "crop_green": Surface((0x6c9a3a, 0x58842e, 0x7eaa48), "leaves", 0.03, roughness=0.8, bump=0.6, grime=0.0, ao=0.6),
    "crop_young": Surface((0x86b04c, 0x6c963a, 0x9cc060), "leaves", 0.03, roughness=0.8, bump=0.5, grime=0.0, ao=0.5),
    "wheat": Surface((0xdcb456, 0xc89c40, 0xe8c870), "straw", 0.015, roughness=0.9, bump=0.7, grime=0.0, ao=0.6),
    "stubble": Surface((0xb09460, 0x96784a, 0xc4a874), "straw", 0.015, roughness=1.0, bump=0.5, grime=0.0, ao=0.4),
    "white": Surface((0xece6da, 0xe0d8c8), "none", roughness=0.7, grime=0.0, ao=0.3),
    "leaf": Surface((0x5a8a3a, 0x40702a, 0x2c5420), "leaves", 0.12, roughness=0.8, bump=0.5, noise_scale=2.5, grime=0.0, ao=0.7, coords="object"),
    "bark": Surface((0x6a5442, 0x544232, 0x7c6650), "bark", 0.03, roughness=0.9, bump=0.6, grime=0.0, coords="object"),
}


def mat(key: str) -> bpy.types.Material:
    return material(key, M[key])


# ---------------------------------------------------------------------------
# Builder
# ---------------------------------------------------------------------------


@dataclass
class Style:
    """Era look for generic buildings."""

    name: str
    wall: str
    base: str
    frame: str | None  # timber framing material, None for solid masonry
    roof: str
    trim: str = "timber"
    roof_pitch: float = 1.0  # rise over half-span
    base_h: float = 0.07
    window: str = "void"


STYLES = {
    "dark": Style("dark", wall="daub", base="fieldstone", frame="timber", roof="thatch", roof_pitch=1.25),
    "castle": Style("castle", wall="plaster", base="ashlar", frame="timber", roof="tile_red", roof_pitch=1.1, base_h=0.1),
    "gunpowder": Style("gunpowder", wall="plaster_ochre", base="ashlar_grey", frame=None, roof="tile_dark", trim="planks_dark", roof_pitch=0.95, base_h=0.1, window="glass"),
}


class B:
    """Object builder bound to one collection and one RNG."""

    def __init__(self, col: bpy.types.Collection, rng: random.Random):
        self.col = col
        self.rng = rng
        self._n = 0

    # -- core ------------------------------------------------------------
    def obj(self, bm: bmesh.types.BMesh, m: str | bpy.types.Material | list, name: str = "part",
            bevel: float = 0.0, smooth: bool = False) -> bpy.types.Object:
        self._n += 1
        me = bpy.data.meshes.new(f"{self.col.name}_{name}_{self._n}")
        bm.normal_update()
        bm.to_mesh(me)
        bm.free()
        mats = m if isinstance(m, list) else [m]
        for mm in mats:
            me.materials.append(mat(mm) if isinstance(mm, str) else mm)
        if smooth:
            for p in me.polygons:
                p.use_smooth = True
        ob = bpy.data.objects.new(me.name, me)
        self.col.objects.link(ob)
        if bevel > 0:
            mod = ob.modifiers.new("bevel", "BEVEL")
            mod.width = bevel
            mod.segments = 2
            mod.limit_method = "ANGLE"
            mod.angle_limit = math.radians(35)
            mod.harden_normals = False
        return ob

    def roughen(self, ob: bpy.types.Object, strength: float = 0.02, scale: float = 0.15,
                levels: int = 2, subdiv: bool = True) -> bpy.types.Object:
        """Simple-subdivide and displace along normals for hand-made irregularity."""
        if subdiv:
            sd = ob.modifiers.new("subd", "SUBSURF")
            sd.subdivision_type = "SIMPLE"
            sd.levels = levels
            sd.render_levels = levels
        tex = bpy.data.textures.new(f"{ob.name}_n", "CLOUDS")
        tex.noise_scale = scale
        tex.noise_depth = 2
        d = ob.modifiers.new("disp", "DISPLACE")
        d.texture = tex
        d.texture_coords = "GLOBAL"
        d.strength = strength
        d.mid_level = 0.5
        # keep bevel last
        for mod in list(ob.modifiers):
            if mod.type == "BEVEL":
                ob.modifiers.move(list(ob.modifiers).index(mod), len(ob.modifiers) - 1)
        return ob

    # -- primitives --------------------------------------------------------
    def box(self, x0: float, y0: float, z0: float, x1: float, y1: float, z1: float, m: str,
            bevel: float = 0.008, rot: float = 0.0, name: str = "box") -> bpy.types.Object:
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        cx, cy, cz = (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2
        sx, sy, sz = abs(x1 - x0), abs(y1 - y0), abs(z1 - z0)
        mtx = Matrix.Translation((cx, cy, cz)) @ Matrix.Rotation(rot, 4, "Z") @ Matrix.Diagonal((sx, sy, sz, 1))
        bmesh.ops.transform(bm, matrix=mtx, verts=bm.verts)
        return self.obj(bm, m, name, bevel)

    def beam(self, p0, p1, w: float, m: str, d: float | None = None, bevel: float = 0.004,
             roll: float = 0.0, name: str = "beam") -> bpy.types.Object:
        p0, p1 = Vector(p0), Vector(p1)
        d = d if d is not None else w
        axis = p1 - p0
        length = axis.length
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        q = axis.to_track_quat("Z", "Y" if abs(axis.normalized().z) < 0.99 else "X")
        mtx = (Matrix.Translation((p0 + p1) / 2) @ q.to_matrix().to_4x4() @ Matrix.Rotation(roll, 4, "Z")
               @ Matrix.Diagonal((w, d, length, 1)))
        bmesh.ops.transform(bm, matrix=mtx, verts=bm.verts)
        return self.obj(bm, m, name, bevel)

    def cyl(self, p0, p1, r: float, m: str, r2: float | None = None, segs: int = 10,
            bevel: float = 0.0, smooth: bool = True, name: str = "cyl", cap_m: str | None = None) -> bpy.types.Object:
        p0, p1 = Vector(p0), Vector(p1)
        axis = p1 - p0
        bm = bmesh.new()
        r2 = r if r2 is None else r2
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r, radius2=r2, depth=1.0)
        q = axis.to_track_quat("Z", "Y" if abs(axis.normalized().z) < 0.99 else "X")
        mtx = Matrix.Translation((p0 + p1) / 2) @ q.to_matrix().to_4x4() @ Matrix.Diagonal((1, 1, axis.length, 1))
        bmesh.ops.transform(bm, matrix=mtx, verts=bm.verts)
        mats = [m]
        if cap_m:
            mats.append(cap_m)
            for f in bm.faces:
                if len(f.verts) > 4:
                    f.material_index = 1
        ob = self.obj(bm, mats, name, bevel, smooth=smooth)
        if smooth:
            _autosmooth(ob)
        return ob

    def cone(self, cx: float, cy: float, z0: float, r: float, h: float, m: str, segs: int = 12,
             name: str = "cone") -> bpy.types.Object:
        return self.cyl((cx, cy, z0), (cx, cy, z0 + h), r, m, r2=0.0, segs=segs, smooth=True, name=name)

    def sphere(self, c, r: float, m: str, scale=(1, 1, 1), subdiv: int = 2, name: str = "sph") -> bpy.types.Object:
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
        mtx = Matrix.Translation(Vector(c)) @ Matrix.Diagonal((*scale, 1))
        bmesh.ops.transform(bm, matrix=mtx, verts=bm.verts)
        return self.obj(bm, m, name, smooth=True)

    def lathe(self, profile: list[tuple[float, float]], cx: float, cy: float, m: str, segs: int = 16,
              name: str = "lathe", smooth: bool = True, a0: float = 0.0) -> bpy.types.Object:
        """Surface of revolution from (radius, z) pairs, bottom to top.
        segs=4 with a0=pi/4 gives an axis-aligned tapered square (radius = half side * sqrt 2)."""
        bm = bmesh.new()
        rings = []
        for r, z in profile:
            ring = []
            for i in range(segs):
                a = a0 + math.tau * i / segs
                ring.append(bm.verts.new((cx + math.cos(a) * r, cy + math.sin(a) * r, z)))
            rings.append(ring)
        for k in range(len(rings) - 1):
            for i in range(segs):
                j = (i + 1) % segs
                bm.faces.new((rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]))
        if profile[0][0] > 1e-4:
            bm.faces.new(list(reversed(rings[0])))
        if profile[-1][0] > 1e-4:
            bm.faces.new(rings[-1])
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        ob = self.obj(bm, m, name, smooth=smooth)
        if smooth:
            _autosmooth(ob, 50)
        return ob

    def prism(self, pts2d: list[tuple[float, float]], z0: float, z1: float, m: str, bevel: float = 0.0,
              name: str = "prism") -> bpy.types.Object:
        """Extrude a 2D polygon (XY) between z0 and z1."""
        bm = bmesh.new()
        bot = [bm.verts.new((x, y, z0)) for x, y in pts2d]
        top = [bm.verts.new((x, y, z1)) for x, y in pts2d]
        bm.faces.new(list(reversed(bot)))
        bm.faces.new(top)
        n = len(pts2d)
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((bot[i], bot[j], top[j], top[i]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        return self.obj(bm, m, name, bevel)

    def side_prism(self, pts_yz: list[tuple[float, float]], x0: float, x1: float, m: str, axis: str = "x",
                   bevel: float = 0.0, name: str = "sprism") -> bpy.types.Object:
        """Extrude a profile drawn in the (Y,Z) plane along X (axis='x') or the
        (X,Z) plane along Y (axis='y')."""
        bm = bmesh.new()
        if axis == "x":
            a = [bm.verts.new((x0, u, z)) for u, z in pts_yz]
            b = [bm.verts.new((x1, u, z)) for u, z in pts_yz]
        else:
            a = [bm.verts.new((u, x0, z)) for u, z in pts_yz]
            b = [bm.verts.new((u, x1, z)) for u, z in pts_yz]
        bm.faces.new(a)
        bm.faces.new(list(reversed(b)))
        n = len(pts_yz)
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        return self.obj(bm, m, name, bevel)

    # -- roofs -----------------------------------------------------------
    def gable_roof(self, x0: float, y0: float, x1: float, y1: float, z: float, rise: float, m: str,
                   axis: str = "x", overhang: float = 0.06, thick: float = 0.05, gable_m: str | None = None,
                   rough: float = 0.0, ridge_m: str | None = None, end_overhang: float | None = None) -> list:
        """Two sloped slabs + a gable prism (in `gable_m`) closing the ends.

        axis='x': ridge runs along X, slopes face -Y and +Y.
        """
        eo = overhang if end_overhang is None else end_overhang
        out = []
        if axis == "x":
            ym = (y0 + y1) / 2
            half = (y1 - y0) / 2 + overhang
            slope_drop = rise * overhang / ((y1 - y0) / 2)
            ze = z - slope_drop
            for sgn in (-1, 1):
                ye = ym + sgn * half
                pts = [(x0 - eo, ye, ze), (x1 + eo, ye, ze), (x1 + eo, ym, z + rise), (x0 - eo, ym, z + rise)]
                out.append(self._slab(pts, thick, m, rough))
            if gable_m:
                lo = thick * 1.15
                out.append(self.side_prism([(y0, z - lo), (y1, z - lo), (ym, z + rise - lo * 1.3)], x0, x1, gable_m, "x"))
            if ridge_m:
                out.append(self.beam((x0 - eo, ym, z + rise + thick * 0.4), (x1 + eo, ym, z + rise + thick * 0.4),
                                     thick * 1.4, ridge_m, roll=math.radians(45)))
        else:
            xm = (x0 + x1) / 2
            half = (x1 - x0) / 2 + overhang
            slope_drop = rise * overhang / ((x1 - x0) / 2)
            ze = z - slope_drop
            for sgn in (-1, 1):
                xe = xm + sgn * half
                pts = [(xe, y0 - eo, ze), (xe, y1 + eo, ze), (xm, y1 + eo, z + rise), (xm, y0 - eo, z + rise)]
                out.append(self._slab(pts, thick, m, rough))
            if gable_m:
                lo = thick * 1.15
                out.append(self.side_prism([(x0, z - lo), (x1, z - lo), (xm, z + rise - lo * 1.3)], y0, y1, gable_m, "y"))
            if ridge_m:
                out.append(self.beam((xm, y0 - eo, z + rise + thick * 0.4), (xm, y1 + eo, z + rise + thick * 0.4),
                                     thick * 1.4, ridge_m, roll=math.radians(45)))
        return out

    def _slab(self, quad: list[tuple[float, float, float]], thick: float, m: str, rough: float) -> bpy.types.Object:
        """Quad surface (eave edge first, ridge edge last) thickened downwards."""
        bm = bmesh.new()
        vs = [bm.verts.new(p) for p in quad]
        f = bm.faces.new(vs)
        f.normal_update()
        if f.normal.z < 0:
            f.normal_flip()
        ob = self.obj(bm, m, "slab", bevel=0.0)
        sol = ob.modifiers.new("solid", "SOLIDIFY")
        sol.thickness = thick
        sol.offset = -1.0
        if rough > 0:
            ob.modifiers.move(0, 0)
            sd = ob.modifiers.new("subd", "SUBSURF")
            sd.subdivision_type = "SIMPLE"
            sd.levels = 3
            sd.render_levels = 3
            ob.modifiers.move(len(ob.modifiers) - 1, 0)
            tex = bpy.data.textures.new(f"{ob.name}_n", "CLOUDS")
            tex.noise_scale = 0.12
            d = ob.modifiers.new("disp", "DISPLACE")
            d.texture = tex
            d.texture_coords = "GLOBAL"
            d.strength = rough
            ob.modifiers.move(len(ob.modifiers) - 1, 1)
        bev = ob.modifiers.new("bevel", "BEVEL")
        bev.width = min(0.012, thick * 0.3)
        bev.segments = 2
        bev.limit_method = "ANGLE"
        return ob

    def hip_roof(self, x0: float, y0: float, x1: float, y1: float, z: float, rise: float, m: str,
                 overhang: float = 0.06, thick: float = 0.05, rough: float = 0.0, bell: float = 0.0) -> bpy.types.Object:
        """Hip (or pyramid when square) roof as a closed solid with a thin fascia."""
        x0 -= overhang
        y0 -= overhang
        x1 += overhang
        y1 += overhang
        w, d = x1 - x0, y1 - y0
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        drop = rise * overhang / (min(w, d) / 2 - overhang + 1e-6)
        ze = z - drop
        if w >= d:
            r = (w - d) / 2
            ridge = [(cx - r, cy), (cx + r, cy)]
        else:
            r = (d - w) / 2
            ridge = [(cx, cy - r), (cx, cy + r)]
        bm = bmesh.new()
        b = [bm.verts.new(p) for p in ((x0, y0, ze - thick), (x1, y0, ze - thick), (x1, y1, ze - thick), (x0, y1, ze - thick))]
        e = [bm.verts.new(p) for p in ((x0, y0, ze), (x1, y0, ze), (x1, y1, ze), (x0, y1, ze))]
        zr = ze + rise + drop
        if w >= d:
            ra = bm.verts.new((ridge[0][0], ridge[0][1], zr))
            rb = bm.verts.new((ridge[1][0], ridge[1][1], zr))
            faces = [(e[0], e[1], rb, ra), (e[1], e[2], rb), (e[2], e[3], ra, rb), (e[3], e[0], ra)]
        else:
            ra = bm.verts.new((ridge[0][0], ridge[0][1], zr))
            rb = bm.verts.new((ridge[1][0], ridge[1][1], zr))
            faces = [(e[0], e[1], ra), (e[1], e[2], rb, ra), (e[2], e[3], rb), (e[3], e[0], ra, rb)]
        if ra.co == rb.co:
            bmesh.ops.pointmerge(bm, verts=[ra, rb], merge_co=ra.co)
            faces = [tuple(v for v in f if v.is_valid) for f in faces]
            faces = [(e[0], e[1], ra), (e[1], e[2], ra), (e[2], e[3], ra), (e[3], e[0], ra)]
        for f in faces:
            bm.faces.new(f)
        bm.faces.new(list(reversed(b)))
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((b[i], b[j], e[j], e[i]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        if bell > 0:
            # slightly concave (bell-cast) slopes: lower mid verts after subdiv
            pass
        ob = self.obj(bm, m, "hip", bevel=0.01)
        if rough > 0:
            self.roughen(ob, rough, 0.12, levels=3)
        return ob

    def cone_roof(self, cx: float, cy: float, z: float, r: float, h: float, m: str, segs: int = 16,
                  overhang: float = 0.05, thick: float = 0.04, rough: float = 0.0) -> bpy.types.Object:
        rr = r + overhang
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=rr, radius2=0.0, depth=h)
        bmesh.ops.translate(bm, verts=bm.verts, vec=(cx, cy, z + h / 2 - overhang * h / rr))
        ob = self.obj(bm, m, "coneroof", smooth=True)
        _autosmooth(ob)
        if thick > 0:
            sol = ob.modifiers.new("solid", "SOLIDIFY")
            sol.thickness = thick
            sol.offset = -1
        if rough > 0:
            self.roughen(ob, rough, 0.1, levels=2)
        return ob

    # -- architectural details -------------------------------------------
    def opening(self, side: str, x0: float, y0: float, x1: float, y1: float, t: float, z0: float,
                w: float, h: float, m: str = "void", frame_m: str | None = "timber", arch: bool = False,
                depth: float = 0.012, shutters: str | None = None, sill: bool = False) -> None:
        """Door or window on one wall of the box (x0,y0)-(x1,y1).

        side: '-y' (front-left) or '+x' (front-right) or '+y'/'-x'.
        t: position along the wall 0..1.
        """
        fw = 0.022
        if side in ("-y", "+y"):
            yy = y0 if side == "-y" else y1
            s = -1 if side == "-y" else 1
            cx = x0 + (x1 - x0) * t
            self.box(cx - w / 2, yy + s * depth, z0, cx + w / 2, yy - s * 0.01, z0 + h, m, bevel=0.0, name="open")
            if arch:
                self.side_prism(_arch_pts(cx, w, z0 + h, w * 0.5), yy + s * depth, yy - s * 0.01, m, axis="y")
            if frame_m:
                o = s * (depth + 0.006)
                self.box(cx - w / 2 - fw, yy + o, z0, cx - w / 2, yy - s * 0.01, z0 + h + fw, frame_m, 0.003)
                self.box(cx + w / 2, yy + o, z0, cx + w / 2 + fw, yy - s * 0.01, z0 + h + fw, frame_m, 0.003)
                self.box(cx - w / 2 - fw, yy + o, z0 + h, cx + w / 2 + fw, yy - s * 0.01, z0 + h + fw * 1.4, frame_m, 0.003)
                if sill:
                    self.box(cx - w / 2 - fw, yy + o - s * 0.01, z0 - fw, cx + w / 2 + fw, yy - s * 0.01, z0, frame_m, 0.003)
            if shutters:
                o = s * (depth + 0.01)
                self.box(cx - w / 2 - fw - w * 0.5, yy + o, z0, cx - w / 2 - fw, yy + s * depth, z0 + h, shutters, 0.003)
                self.box(cx + w / 2 + fw, yy + o, z0, cx + w / 2 + fw + w * 0.5, yy + s * depth, z0 + h, shutters, 0.003)
        else:
            xx = x1 if side == "+x" else x0
            s = 1 if side == "+x" else -1
            cy = y0 + (y1 - y0) * t
            self.box(xx - s * 0.01, cy - w / 2, z0, xx + s * depth, cy + w / 2, z0 + h, m, bevel=0.0, name="open")
            if arch:
                self.side_prism(_arch_pts(cy, w, z0 + h, w * 0.5), xx - s * 0.01, xx + s * depth, m, axis="x")
            if frame_m:
                o = s * (depth + 0.006)
                self.box(xx - s * 0.01, cy - w / 2 - fw, z0, xx + o, cy - w / 2, z0 + h + fw, frame_m, 0.003)
                self.box(xx - s * 0.01, cy + w / 2, z0, xx + o, cy + w / 2 + fw, z0 + h + fw, frame_m, 0.003)
                self.box(xx - s * 0.01, cy - w / 2 - fw, z0 + h, xx + o, cy + w / 2 + fw, z0 + h + fw * 1.4, frame_m, 0.003)
                if sill:
                    self.box(xx - s * 0.01, cy - w / 2 - fw, z0 - fw, xx + o + s * 0.01, cy + w / 2 + fw, z0, frame_m, 0.003)
            if shutters:
                o = s * (depth + 0.01)
                self.box(xx + s * depth, cy - w / 2 - fw - w * 0.5, z0, xx + o, cy - w / 2 - fw, z0 + h, shutters, 0.003)
                self.box(xx + s * depth, cy + w / 2 + fw, z0, xx + o, cy + w / 2 + fw + w * 0.5, z0 + h, shutters, 0.003)

    def timber_frame(self, x0: float, y0: float, x1: float, y1: float, z0: float, z1: float, m: str = "timber",
                     spacing: float = 0.22, braces: bool = True, sides=("-y", "+x"), w: float = 0.026,
                     mid: bool = True, skip: list[tuple[str, float, float]] | None = None) -> None:
        """Half-timber framing proud of the wall faces on the given sides.

        skip: (side, t0, t1) ranges along the wall (0..1) kept free for doors.
        """
        rng = self.rng
        skip = skip or []
        out = 0.008
        for side in sides:
            if side in ("-y", "+y"):
                yy = (y0 - out) if side == "-y" else (y1 + out)
                a0, a1, fixed = x0, x1, yy
            else:
                xx = (x1 + out) if side == "+x" else (x0 - out)
                a0, a1, fixed = y0, y1, xx
            length = a1 - a0
            n = max(1, round(length / spacing))
            posts = [a0 + length * i / n for i in range(n + 1)]

            def P(a: float, z: float):
                return (a, fixed, z) if side in ("-y", "+y") else (fixed, a, z)

            def blocked(a: float) -> bool:
                t = (a - a0) / length
                return any(s == side and t0 <= t <= t1 for s, t0, t1 in skip)

            # sill and head beams
            self.beam(P(a0 - w / 2, z0 + w / 2), P(a1 + w / 2, z0 + w / 2), w, m, d=w)
            self.beam(P(a0 - w / 2, z1 - w / 2), P(a1 + w / 2, z1 - w / 2), w, m, d=w)
            zm = (z0 + z1) / 2 + rng.uniform(-0.02, 0.02)
            for i, a in enumerate(posts):
                lean = rng.uniform(-0.012, 0.012) if 0 < i < n else 0.0
                if blocked(a) and 0 < i < n:
                    continue
                self.beam(P(a, z0), P(a + lean, z1), w, m, d=w)
            if mid:
                for i in range(n):
                    a, b2 = posts[i], posts[i + 1]
                    if blocked((a + b2) / 2):
                        continue
                    self.beam(P(a, zm), P(b2, zm + rng.uniform(-0.01, 0.01)), w * 0.85, m, d=w)
            if braces:
                for i in (0, n - 1):
                    a, b2 = posts[i], posts[i + 1]
                    if blocked((a + b2) / 2):
                        continue
                    if i == 0:
                        self.beam(P(a, z0 + w), P(b2, zm), w * 0.8, m, d=w)
                    else:
                        self.beam(P(b2, z0 + w), P(a, zm), w * 0.8, m, d=w)

    def crenellate(self, x0: float, y0: float, x1: float, y1: float, z: float, h: float, m: str,
                   merlon: float = 0.09, gap: float = 0.07, t: float = 0.06) -> None:
        for (ax, ay, bx, by) in ((x0, y0, x1, y0), (x1, y0, x1, y1), (x1, y1, x0, y1), (x0, y1, x0, y0)):
            length = math.hypot(bx - ax, by - ay)
            n = max(1, int((length + gap) / (merlon + gap)))
            step = length / n
            for i in range(n):
                t0 = (i * step + (step - merlon) / 2) / length
                t1 = t0 + merlon / length
                px0, py0 = ax + (bx - ax) * t0, ay + (by - ay) * t0
                px1, py1 = ax + (bx - ax) * t1, ay + (by - ay) * t1
                if abs(by - ay) < 1e-6:
                    self.box(min(px0, px1), ay - t / 2, z, max(px0, px1), ay + t / 2, z + h, m, 0.006)
                else:
                    self.box(ax - t / 2, min(py0, py1), z, ax + t / 2, max(py0, py1), z + h, m, 0.006)

    def banner(self, x: float, y: float, z: float, pole_h: float = 0.5, flag_w: float = 0.16, flag_h: float = 0.11,
               direction: tuple[float, float] = (1.0, -0.2), pole_m: str = "timber", pennant: bool = False) -> None:
        """Team-coloured flag on a pole. Flag hangs in the given ground direction."""
        self.cyl((x, y, z), (x, y, z + pole_h), 0.012, pole_m, segs=6)
        self.sphere((x, y, z + pole_h + 0.01), 0.018, "gold", subdiv=1)
        d = Vector((direction[0], direction[1], 0)).normalized()
        top = z + pole_h - 0.02
        bm = bmesh.new()
        cols = 6
        rows = 3
        grid = []
        for r in range(rows + 1):
            row = []
            for c in range(cols + 1):
                u = c / cols
                v = r / rows
                hgt = flag_h if not pennant else flag_h * (1 - u * 0.85)
                wave = math.sin(u * math.pi * 1.6 + 0.5) * 0.018 * u
                p = Vector((x, y, top)) + d * (u * flag_w + 0.012) + Vector((-d.y, d.x, 0)) * wave
                p.z -= v * hgt + (u * flag_h * 0.15 if not pennant else 0)
                row.append(bm.verts.new(p))
            grid.append(row)
        for r in range(rows):
            for c in range(cols):
                bm.faces.new((grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c]))
        ob = self.obj(bm, "team", "flag", smooth=True)
        sol = ob.modifiers.new("solid", "SOLIDIFY")
        sol.thickness = 0.006

    def pad(self, fw: float, fh: float, m: str = "dirt", inset: float = 0.03, z: float = 0.0,
            irregular: float = 0.035, cx: float = 0.0, cy: float = 0.0) -> bpy.types.Object:
        """Irregular ground patch covering the footprint, grounds the building."""
        rng = self.rng
        pts = []
        hx, hy = fw / 2 - inset, fh / 2 - inset
        n = 12
        # walk the rectangle perimeter with noisy offsets, rounded corners
        per = []
        for i in range(n):
            per.append((-hx + 2 * hx * i / n, -hy))
        for i in range(n):
            per.append((hx, -hy + 2 * hy * i / n))
        for i in range(n):
            per.append((hx - 2 * hx * i / n, hy))
        for i in range(n):
            per.append((-hx, hy - 2 * hy * i / n))
        for (px, py) in per:
            k = rng.uniform(0, irregular)
            # pull towards the centre a little (rounded silhouette)
            corner = (abs(px) / hx) ** 6 * (abs(py) / hy) ** 6
            f = 1 - (k + corner * 0.06) / max(hx, hy)
            pts.append((cx + px * f, cy + py * f))
        bm = bmesh.new()
        vs = [bm.verts.new((x, y, z + 0.004)) for x, y in pts]
        bm.faces.new(vs)
        bmesh.ops.triangulate(bm, faces=bm.faces)
        ob = self.obj(bm, m, "pad")
        return ob

    # -- props -----------------------------------------------------------
    def barrel(self, x: float, y: float, z: float = 0.0, r: float = 0.045, h: float = 0.11, m: str = "planks") -> None:
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=r, radius2=r, depth=h)
        for v in bm.verts:
            t = v.co.z / (h / 2)
            v.co.x *= 1 + 0.18 * (1 - t * t)
            v.co.y *= 1 + 0.18 * (1 - t * t)
        bmesh.ops.subdivide_edges(bm, edges=[e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > h * 0.9], cuts=3)
        for v in bm.verts:
            t = v.co.z / (h / 2)
            k = 1 + 0.18 * (1 - t * t)
            rr = math.hypot(v.co.x, v.co.y)
            if rr > 1e-6:
                v.co.x *= r * k / rr
                v.co.y *= r * k / rr
        bmesh.ops.translate(bm, verts=bm.verts, vec=(x, y, z + h / 2))
        ob = self.obj(bm, "planks_dark", "barrel", smooth=True)
        _autosmooth(ob)
        for zz in (0.2, 0.8):
            self.cyl((x, y, z + h * zz - 0.005), (x, y, z + h * zz + 0.005), r * 1.12, "iron", segs=10)

    def crate(self, x: float, y: float, z: float = 0.0, s: float = 0.08, rot: float = 0.0) -> None:
        self.box(x - s / 2, y - s / 2, z, x + s / 2, y + s / 2, z + s, "planks", 0.004, rot)

    def sack(self, x: float, y: float, z: float = 0.0, s: float = 0.05) -> None:
        self.sphere((x, y, z + s * 0.6), s, "cloth", scale=(1.0, 0.8, 0.75), subdiv=2)

    def log_pile(self, x: float, y: float, length: float = 0.3, axis: str = "x", rows: int = 3,
                 r: float = 0.025, z: float = 0.0) -> None:
        rng = self.rng
        for row in range(rows):
            n = rows - row
            for i in range(n):
                off = (i - (n - 1) / 2) * 2 * r * 1.05
                zz = z + r + row * r * 1.75
                ln = length * rng.uniform(0.85, 1.05)
                if axis == "x":
                    p0, p1 = (x - ln / 2, y + off, zz), (x + ln / 2, y + off, zz)
                else:
                    p0, p1 = (x + off, y - ln / 2, zz), (x + off, y + ln / 2, zz)
                self.cyl(p0, p1, r * rng.uniform(0.85, 1.1), "log", segs=8, cap_m="log_end")

    def stone_pile(self, x: float, y: float, n: int = 6, s: float = 0.05, m: str = "rock_cut", z: float = 0.0) -> None:
        rng = self.rng
        for i in range(n):
            a = rng.uniform(0, math.tau)
            rr = rng.uniform(0, s * 1.4)
            sx = s * rng.uniform(0.8, 1.3)
            px, py = x + math.cos(a) * rr, y + math.sin(a) * rr
            zz = z + (s * 0.6 if i >= n * 0.6 else 0)
            self.box(px - sx / 2, py - s / 2, zz, px + sx / 2, py + s / 2, zz + s * 0.7, m, 0.008, rng.uniform(0, 3))

    def fence(self, pts: list[tuple[float, float]], h: float = 0.16, m: str = "log", post_every: float = 0.18,
              rails: int = 2) -> None:
        rng = self.rng
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            length = math.hypot(bx - ax, by - ay)
            n = max(1, round(length / post_every))
            for i in range(n + 1):
                t = i / n
                px, py = ax + (bx - ax) * t, ay + (by - ay) * t
                self.cyl((px, py, 0), (px + rng.uniform(-0.006, 0.006), py, h + rng.uniform(-0.01, 0.01)), 0.011, m, segs=6)
            for k in range(rails):
                zz = h * (0.4 + 0.45 * k / max(1, rails - 1))
                self.cyl((ax, ay, zz), (bx, by, zz + rng.uniform(-0.01, 0.01)), 0.008, m, segs=5)

    def hay_bale(self, x: float, y: float, z: float = 0.0, s: float = 0.07, rot: float = 0.0) -> None:
        ob = self.box(x - s * 0.7, y - s / 2, z, x + s * 0.7, y + s / 2, z + s * 0.75, "hay", 0.012, rot)
        self.roughen(ob, 0.006, 0.05, 2)

    def cart(self, x: float, y: float, rot: float = 0.0, load: str | None = "hay") -> None:
        c, s = math.cos(rot), math.sin(rot)

        def P(px: float, py: float, pz: float):
            return (x + px * c - py * s, y + px * s + py * c, pz)

        # bed (beam cross-section: w horizontal, d vertical)
        self.beam(P(-0.12, 0, 0.07), P(0.12, 0, 0.07), 0.12, "planks", d=0.02)
        for sy in (-0.06, 0.06):
            self.beam(P(-0.12, sy, 0.085), P(0.12, sy, 0.085), 0.01, "planks_dark", d=0.03)
        # wheels
        for sy in (-0.07, 0.07):
            p0 = Vector(P(0.0, sy, 0.05))
            p1 = Vector(P(0.0, sy + 0.012 * (1 if sy > 0 else -1), 0.05))
            self.cyl(p0, p1, 0.05, "planks_dark", segs=12, smooth=False)
        # shafts
        for sy in (-0.04, 0.04):
            self.beam(P(0.12, sy, 0.07), P(0.26, sy, 0.03), 0.012, "timber")
        if load == "hay":
            ob = self.beam(P(-0.11, 0, 0.11), P(0.11, 0, 0.11), 0.11, "hay", d=0.065, bevel=0.015)
            self.roughen(ob, 0.01, 0.05)
        elif load == "logs":
            for i in range(3):
                yy = (i - 1) * 0.035
                self.cyl(P(-0.13, yy, 0.1), P(0.13, yy, 0.1), 0.017, "log", cap_m="log_end", segs=8)
        elif load == "sacks":
            for i in range(3):
                px = -0.07 + 0.07 * i
                self.sack(*P(px, 0, 0)[:2], 0.075, 0.035)
        elif load == "stone":
            for i in range(3):
                px = -0.07 + 0.07 * i
                self.beam(P(px - 0.025, 0, 0.1), P(px + 0.025, 0, 0.1), 0.06, "rock_cut", d=0.04, bevel=0.006)


def _arch_pts(c: float, w: float, z: float, h: float, n: int = 8) -> list[tuple[float, float]]:
    pts = [(c - w / 2, z - 0.001)]
    for i in range(n + 1):
        a = math.pi * i / n
        pts.append((c - math.cos(a) * w / 2, z + math.sin(a) * h))
    pts.append((c + w / 2, z - 0.001))
    return pts


def _autosmooth(ob: bpy.types.Object, angle: float = 40.0) -> None:
    """Smooth shading with sharp edges above `angle` (Blender 4.1+ API)."""
    try:
        ob.data.set_sharp_from_angle(angle=math.radians(angle))
    except AttributeError:
        pass
