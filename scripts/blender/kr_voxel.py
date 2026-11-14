"""Style A voxeliser: turns any built sprite collection into a voxel diorama.

One global lattice for every family: a voxel is VX = 1/32 tile wide (a 2 px
wide top diamond at 1x) and VZ = 1/39.19 tile high (exactly 1 px per layer
at 1x). Voxel corners therefore project to integer x and to integer or
half-integer y pixel positions, so no voxel edge ever passes through a pixel
centre and the no-AA render comes out crisp.

Pipeline per collection:
  1. sample every evaluated triangle densely (numpy barycentric grids),
  2. bin the samples into lattice cells, keep the camera-nearest sample per
     cell (its material and normal decide the voxel colour),
  3. colour each voxel from the material's Surface recipe (base noise,
     courses / planks / cells patterns on a voxel grid, grime, style A
     saturation boost, per-voxel jitter),
  4. emit only exposed cube faces as one mesh with a colour attribute and a
     handful of shared materials (diffuse, team AOV, emissive, metal, gloss).

Optional pose deformations (tree sway) displace the samples before binning,
so every pose stays on the lattice.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Callable

import bpy
import numpy as np

import kr_lib as K

VX = 1.0 / 32.0
VZ = 1.0 / 39.1918

# Style A colour treatment (matches art-source/style-explore).
A_SAT = 1.12
A_VAL = 1.04

#: per-pattern jitter: (value jitter, hue jitter, large-scale variation)
JITTER = {
    "thatch": (0.09, 0.012, 0.08),
    "straw": (0.08, 0.012, 0.06),
    "leaves": (0.1, 0.02, 0.08),
    "rock": (0.1, 0.01, 0.04),
    "soil": (0.04, 0.006, 0.05),
    "bark": (0.07, 0.01, 0.0),
    "planks": (0.06, 0.01, 0.0),
    "brick": (0.05, 0.008, 0.02),
    "tiles": (0.06, 0.01, 0.03),
    "shingles": (0.06, 0.01, 0.03),
    "cloth": (0.03, 0.004, 0.02),
    "ore": (0.1, 0.01, 0.0),
}
DEFAULT_JITTER = (0.035, 0.005, 0.0)

#: material classes (material slot index of the voxel mesh)
CLS_DIFFUSE, CLS_TEAM, CLS_EMIT, CLS_METAL, CLS_GLOSS = range(5)

#: Surface registry: Blender material name -> Surface recipe. Filled by
#: kr_lib.material(); special materials register here directly.
SURFACES = K.SURFACES

SURFACES["kr_gold_ore"] = K.Surface((0x8e7e66, 0x6e6050, 0xf4c440), "ore", 0.07, grime=0.0)


# ---------------------------------------------------------------------------
# numpy noise
# ---------------------------------------------------------------------------


def _hash(i: np.ndarray, j: np.ndarray, k: np.ndarray, seed: int = 0) -> np.ndarray:
    """Integer lattice hash -> uint32."""
    h = (i.astype(np.int64) * 73856093) ^ (j.astype(np.int64) * 19349663) ^ (k.astype(np.int64) * 83492791)
    h = (h ^ (seed * 2654435761)) & 0xFFFFFFFF
    h = h.astype(np.uint64)
    h ^= h >> np.uint64(16)
    h = (h * np.uint64(0x7FEB352D)) & np.uint64(0xFFFFFFFF)
    h ^= h >> np.uint64(15)
    h = (h * np.uint64(0x846CA68B)) & np.uint64(0xFFFFFFFF)
    h ^= h >> np.uint64(16)
    return h.astype(np.uint32)


def rand01(i: np.ndarray, j: np.ndarray, k: np.ndarray, seed: int = 0) -> np.ndarray:
    return _hash(i, j, k, seed).astype(np.float64) / 4294967296.0


def value_noise(p: np.ndarray, seed: int = 0) -> np.ndarray:
    """Smooth 3D value noise in [0, 1] for points p (N, 3)."""
    f = np.floor(p)
    t = p - f
    t = t * t * (3.0 - 2.0 * t)
    i, j, k = f[:, 0].astype(np.int64), f[:, 1].astype(np.int64), f[:, 2].astype(np.int64)
    out = np.zeros(len(p))
    for dx in (0, 1):
        wx = t[:, 0] if dx else 1.0 - t[:, 0]
        for dy in (0, 1):
            wy = t[:, 1] if dy else 1.0 - t[:, 1]
            for dz in (0, 1):
                wz = t[:, 2] if dz else 1.0 - t[:, 2]
                out += wx * wy * wz * rand01(i + dx, j + dy, k + dz, seed)
    return out


def fbm(p: np.ndarray, octaves: int = 3, seed: int = 0) -> np.ndarray:
    amp, tot, out = 1.0, 0.0, np.zeros(len(p))
    for o in range(octaves):
        out += amp * value_noise(p * (2.0 ** o), seed + o * 17)
        tot += amp
        amp *= 0.5
    return out / tot


def cellular(p: np.ndarray, seed: int = 0) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """3D Worley noise: (F1, F2, cell id hash in [0, 1]) for points p (N, 3)."""
    f = np.floor(p).astype(np.int64)
    best1 = np.full(len(p), 9.0)
    best2 = np.full(len(p), 9.0)
    cid = np.zeros(len(p))
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                ci, cj, ck = f[:, 0] + dx, f[:, 1] + dy, f[:, 2] + dz
                fp = np.stack(
                    [ci + rand01(ci, cj, ck, seed + 1), cj + rand01(ci, cj, ck, seed + 2), ck + rand01(ci, cj, ck, seed + 3)],
                    axis=1,
                )
                d = np.linalg.norm(fp - p, axis=1)
                closer = d < best1
                best2 = np.where(closer, best1, np.minimum(best2, d))
                cid = np.where(closer, rand01(ci, cj, ck, seed + 4), cid)
                best1 = np.where(closer, d, best1)
    return best1, best2, cid


def _smooth(e0: float, e1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _hex(h: int) -> np.ndarray:
    return np.array([((h >> 16) & 255) / 255.0, ((h >> 8) & 255) / 255.0, (h & 255) / 255.0])


def _lin(srgb: np.ndarray) -> np.ndarray:
    srgb = np.clip(srgb, 0.0, 1.0)
    return np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4)


def _rgb_to_hsv(c: np.ndarray) -> np.ndarray:
    r, g, b = c[:, 0], c[:, 1], c[:, 2]
    mx = c.max(axis=1)
    mn = c.min(axis=1)
    d = mx - mn
    h = np.zeros(len(c))
    nz = d > 1e-9
    rm = nz & (mx == r)
    gm = nz & (mx == g) & ~rm
    bm = nz & ~rm & ~gm
    h[rm] = ((g[rm] - b[rm]) / d[rm]) % 6.0
    h[gm] = (b[gm] - r[gm]) / d[gm] + 2.0
    h[bm] = (r[bm] - g[bm]) / d[bm] + 4.0
    h = h / 6.0
    s = np.where(mx > 1e-9, d / np.maximum(mx, 1e-9), 0.0)
    return np.stack([h % 1.0, s, mx], axis=1)


def _hsv_to_rgb(c: np.ndarray) -> np.ndarray:
    h, s, v = c[:, 0] * 6.0, c[:, 1], c[:, 2]
    i = np.floor(h).astype(np.int64) % 6
    f = h - np.floor(h)
    p = v * (1 - s)
    q = v * (1 - s * f)
    t = v * (1 - s * (1 - f))
    out = np.zeros((len(c), 3))
    for idx, (a, b, cc) in enumerate(((v, t, p), (q, v, p), (p, v, t), (p, q, v), (t, p, v), (v, p, q))):
        m = i == idx
        out[m, 0], out[m, 1], out[m, 2] = a[m], b[m], cc[m]
    return out


# ---------------------------------------------------------------------------
# Surface colouring on the lattice
# ---------------------------------------------------------------------------


def _face_uv(c: np.ndarray, n: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Face-planar (u, v) in world units like kr_lib.world_planar_uv, plus a
    flag for horizontal faces."""
    flat = np.abs(n[:, 2]) > 0.85
    t = np.stack([-n[:, 1], n[:, 0], np.zeros(len(n))], axis=1)  # up x n
    tl = np.linalg.norm(t, axis=1)
    t = t / np.maximum(tl, 1e-9)[:, None]
    b = np.cross(n, t)
    b = b / np.maximum(np.linalg.norm(b, axis=1), 1e-9)[:, None]
    u = np.where(flat, c[:, 0], (c * t).sum(1))
    v = np.where(flat, c[:, 1], (c * b).sum(1))
    return u, v, flat


def surface_colors(s: K.Surface, c: np.ndarray, n: np.ndarray, ijk: np.ndarray, seed: int) -> np.ndarray:
    """sRGB colours (N, 3) of voxels at centres c with sample normals n."""
    cols = [_hex(h) for h in s.colors] or [np.array([0.5, 0.5, 0.5])]
    while len(cols) < 3:
        cols.append(cols[-1])
    c0, c1, c2 = cols[0], cols[1], cols[2]
    N = len(c)
    drift = _smooth(0.3, 0.7, fbm(c * s.noise_scale, 3, seed))
    base = c0[None, :] * (1.0 - drift[:, None]) + c1[None, :] * drift[:, None]
    pat = s.pattern
    i, j, k = ijk[:, 0], ijk[:, 1], ijk[:, 2]

    if pat in {"brick", "tiles", "shingles", "planks"}:
        u, v, flat = _face_uv(c, n)
        mortar = _hex(s.mortar)
        if pat == "planks":
            u, v = v, u
            w = max(s.scale, 3.0 * VX)
            row = np.floor(u / w)
            joint = (u / w - row) * w < VX * 0.999
            per = rand01(row.astype(np.int64), np.zeros(N, np.int64), np.zeros(N, np.int64), seed + 7)
            base = base * (0.9 + 0.2 * per[:, None])
            base = np.where(joint[:, None], base * 0.55 + mortar * 0.45, base)
        else:
            rh = max(s.scale, (4.0 if pat == "brick" else 3.0) * VZ)
            bw = rh * {"brick": 2.0, "tiles": 1.2, "shingles": 1.4}[pat]
            row = np.floor(v / rh)
            uo = u + np.where(row % 2 == 0, 0.0, bw * 0.5)
            col = np.floor(uo / bw)
            in_row = (v / rh - row) * rh
            in_col = (uo / bw - col) * bw
            per = rand01(row.astype(np.int64), col.astype(np.int64), np.zeros(N, np.int64), seed + 11)
            base = base * (1.0 - 0.35 * per[:, None]) + c2[None, :] * 0.35 * per[:, None]
            hjoint = in_row < VZ * 1.2 if pat == "brick" else in_row < VZ * 1.2
            vjoint = in_col < VX * 0.999
            joint = hjoint | (vjoint & ~flat)
            if pat != "brick":
                # roof courses: dark lower edge of each row, no vertical joints
                joint = hjoint
            mix = 0.6 if pat == "brick" else 0.45
            base = np.where(joint[:, None], base * (1 - mix) + mortar * mix, base)
    elif pat in {"thatch", "straw"}:
        u, v, _flat = _face_uv(c, n)
        streak = value_noise(np.stack([u / (VX * 1.5), v / (s.scale * 6.0 + 1e-3), np.zeros(N)], axis=1), seed + 3)
        base = base * (0.86 + 0.22 * streak[:, None])
    elif pat == "rock":
        f1, f2, cid = cellular(c / max(s.scale, 1e-3), seed + 5)
        edge = (f2 - f1) * max(s.scale, 1e-3) < VX * 1.1
        base = base * (0.86 + 0.24 * cid[:, None])
        base = np.where(edge[:, None], base * 0.55 + c2[None, :] * 0.45, base)
    elif pat == "ore":
        f1, f2, _cid = cellular(c / 0.09, seed + 5)
        vein = ((f2 - f1) * 0.09 < VX * 0.9) & (fbm(c * 9.0, 2, seed + 9) > 0.45)
        rock = c1[None, :] + (c0 - c1)[None, :] * fbm(c * 9.0, 2, seed + 2)[:, None]
        base = np.where(vein[:, None], c2[None, :], rock)
    elif pat in {"soil", "bark", "leaves", "cloth"}:
        sc = 1.0 / max(s.scale, 1e-3)
        nz = fbm(c * sc * (1.7 if pat != "cloth" else 1.0), 2, seed + 13)
        amt = {"soil": 0.35, "bark": 0.45, "leaves": 0.5, "cloth": 0.25}[pat]
        m = _smooth(0.35, 0.75, nz) * amt
        base = base * (1.0 - m[:, None]) + c2[None, :] * m[:, None]
        if pat == "bark":
            # vertical bark furrows
            u, _v, _f = _face_uv(c, n)
            fur = rand01(np.floor(u / VX).astype(np.int64), np.zeros(N, np.int64), np.zeros(N, np.int64), seed + 17)
            base = base * np.where(fur < 0.25, 0.8, 1.0)[:, None]

    # Grime towards the ground.
    if s.grime > 0:
        g = 1.0 - s.grime + s.grime * np.clip(c[:, 2] / 0.35, 0.0, 1.0)
        base = base * g[:, None]

    # Style A boost + per-voxel jitter (HSV).
    hsv = _rgb_to_hsv(np.clip(base, 0.0, 1.0))
    if not s.team:
        hsv[:, 1] = np.minimum(1.0, hsv[:, 1] * A_SAT)
        hsv[:, 2] = np.minimum(1.0, hsv[:, 2] * A_VAL)
    jv, jh, big = JITTER.get(pat, DEFAULT_JITTER)
    if s.team:
        jv, jh, big = 0.03, 0.0, 0.0
    r1 = rand01(i, j, k, seed + 21) * 2 - 1
    r2 = rand01(i, j, k, seed + 22) * 2 - 1
    r3 = rand01(i, j, k, seed + 23) * 2 - 1
    lf = (value_noise(ijk * 0.09, seed + 31) * 2 - 1) if big > 0 else 0.0
    hsv[:, 2] = np.clip(hsv[:, 2] * (1.0 + jv * r1 + big * lf), 0.0, 1.0)
    hsv[:, 0] = (hsv[:, 0] + jh * r2) % 1.0
    hsv[:, 1] = np.clip(hsv[:, 1] * (1.0 + 0.05 * r3), 0.0, 1.0)
    return _hsv_to_rgb(hsv)


def _material_surface(mat: bpy.types.Material | None) -> K.Surface:
    if mat is None:
        return K.Surface((0x808080,))
    name = mat.name
    s = SURFACES.get(name) or SURFACES.get(name.split(".")[0])
    if s is not None:
        return s
    # Unknown material: read a flat colour from its principled BSDF.
    rgb = (0.5, 0.5, 0.5)
    if mat.use_nodes and mat.node_tree is not None:
        bsdf = next((nd for nd in mat.node_tree.nodes if nd.type == "BSDF_PRINCIPLED"), None)
        if bsdf is not None and not bsdf.inputs["Base Color"].is_linked:
            rgb = tuple(bsdf.inputs["Base Color"].default_value[:3])
    else:
        rgb = tuple(mat.diffuse_color[:3])
    srgb = [c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055 for c in rgb]
    h = (int(srgb[0] * 255) << 16) | (int(srgb[1] * 255) << 8) | int(srgb[2] * 255)
    s = K.Surface((h,))
    SURFACES[name] = s
    return s


def _class_of(s: K.Surface, name: str) -> int:
    if s.team:
        return CLS_TEAM
    if s.emission > 0:
        return CLS_EMIT
    if s.metallic >= 0.5:
        return CLS_METAL
    if s.roughness <= 0.2 or "glass" in name or "water" in name:
        return CLS_GLOSS
    return CLS_DIFFUSE


# ---------------------------------------------------------------------------
# Sampling
# ---------------------------------------------------------------------------


@dataclass
class Samples:
    p: np.ndarray  # (N, 3) world positions
    n: np.ndarray  # (N, 3) unit normals
    m: np.ndarray  # (N,) index into `mats`
    mats: list
    o: np.ndarray | None = None  # (N,) index of the source object in `objs`
    objs: list | None = None


_BARY: dict[int, np.ndarray] = {}


def _bary(n: int) -> np.ndarray:
    if n not in _BARY:
        a, b = np.meshgrid(np.arange(n + 1), np.arange(n + 1), indexing="ij")
        sel = a + b <= n
        _BARY[n] = np.stack([a[sel], b[sel]], axis=1).astype(np.float64) / n
    return _BARY[n]


def sample_collection(scene: bpy.types.Scene, objs: list[bpy.types.Object], spacing: float) -> Samples:
    vl = scene.view_layers[0]
    vl.update()
    deps = vl.depsgraph
    pts, nrm, mid, oid = [], [], [], []
    mats: list = []
    mat_index: dict = {}
    for oi, ob in enumerate(objs):
        if ob.type not in {"MESH", "CURVE", "SURFACE", "META", "FONT"}:
            continue
        ev = ob.evaluated_get(deps)
        try:
            me = ev.to_mesh()
        except RuntimeError:
            continue
        me.calc_loop_triangles()
        nt = len(me.loop_triangles)
        if nt == 0:
            ev.to_mesh_clear()
            continue
        co = np.empty(len(me.vertices) * 3)
        me.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        mw = np.array(ev.matrix_world)
        co = co @ mw[:3, :3].T + mw[:3, 3]
        tv = np.empty(nt * 3, dtype=np.int64)
        me.loop_triangles.foreach_get("vertices", tv)
        tv = tv.reshape(-1, 3)
        tm = np.empty(nt, dtype=np.int64)
        me.loop_triangles.foreach_get("material_index", tm)
        slots = [s.material for s in ob.material_slots] or [None]
        slot_ids = []
        for mt in slots:
            key = mt.name if mt is not None else None
            if key not in mat_index:
                mat_index[key] = len(mats)
                mats.append(mt)
            slot_ids.append(mat_index[key])
        slot_ids = np.array(slot_ids)
        tm = slot_ids[np.clip(tm, 0, len(slot_ids) - 1)]
        ev.to_mesh_clear()

        v0, v1, v2 = co[tv[:, 0]], co[tv[:, 1]], co[tv[:, 2]]
        e1, e2 = v1 - v0, v2 - v0
        fn = np.cross(e1, e2)
        area2 = np.linalg.norm(fn, axis=1)
        ok = area2 > 1e-12
        fn = fn / np.maximum(area2, 1e-12)[:, None]
        longest = np.maximum(np.maximum(np.linalg.norm(e1, axis=1), np.linalg.norm(e2, axis=1)), np.linalg.norm(v2 - v1, axis=1))
        nsub = np.clip(np.ceil(longest / spacing), 1, 600).astype(np.int64)
        # degenerate triangles still contribute their vertices
        for nval in np.unique(nsub):
            sel = np.nonzero(nsub == nval)[0]
            bary = _bary(int(nval))
            for chunk in range(0, len(sel), max(1, 2_000_000 // len(bary))):
                s = sel[chunk: chunk + max(1, 2_000_000 // len(bary))]
                p = v0[s, None, :] + bary[None, :, 0:1] * e1[s, None, :] + bary[None, :, 1:2] * e2[s, None, :]
                nn = np.where(ok[s, None], fn[s], np.array([0.0, 0.0, 1.0]))
                # nudge inwards so faces lying on a lattice plane bin into the solid
                p = p - nn[:, None, :] * 1e-4
                pts.append(p.reshape(-1, 3))
                nrm.append(np.repeat(nn, len(bary), axis=0))
                mid.append(np.repeat(tm[s], len(bary)))
                oid.append(np.full(len(s) * len(bary), oi, dtype=np.int64))
    if not pts:
        return Samples(np.zeros((0, 3)), np.zeros((0, 3)), np.zeros(0, np.int64), mats, np.zeros(0, np.int64), objs)
    return Samples(np.concatenate(pts), np.concatenate(nrm), np.concatenate(mid), mats, np.concatenate(oid), objs)


# ---------------------------------------------------------------------------
# Voxels
# ---------------------------------------------------------------------------


@dataclass
class Voxels:
    ijk: np.ndarray  # (N, 3) int64 cells
    rgb: np.ndarray  # (N, 3) linear colours
    cls: np.ndarray  # (N,) material class


#: deformation of sample positions: (positions, normals, object index) -> (positions, normals)
Deform = Callable[[np.ndarray, np.ndarray, np.ndarray], tuple[np.ndarray, np.ndarray]]


def voxelize_samples(sm: Samples, deform: Deform | None = None, seed: int = 1, floor_k: int = 0) -> Voxels:
    """Bin samples into voxels. Colours are evaluated at the REST position of
    each sample, so a deformed pose (sway, flag ripple, sail rotation) keeps
    the same voxel colours and does not shimmer between frames."""
    p, n = (sm.p, sm.n) if deform is None else deform(sm.p, sm.n, sm.o)
    keep = p[:, 2] >= floor_k * VZ
    rest = sm.p[keep]
    p, n, m = p[keep], n[keep], sm.m[keep]
    if len(p) == 0:
        return Voxels(np.zeros((0, 3), np.int64), np.zeros((0, 3)), np.zeros(0, np.int64))
    ijk = np.floor(p / np.array([VX, VX, VZ])).astype(np.int64)
    # camera-nearest sample per cell decides material + normal
    to_cam = -np.array(K.VIEW_DIR)
    score = p @ to_cam + 0.002 * (n @ to_cam)
    key = ((ijk[:, 0] + 2 ** 20) << 42) | ((ijk[:, 1] + 2 ** 20) << 21) | (ijk[:, 2] + 2 ** 20)
    order = np.lexsort((score, key))
    key_s = key[order]
    last = np.ones(len(order), dtype=bool)
    last[:-1] = key_s[1:] != key_s[:-1]
    pick = order[last]
    ijk, n, m = ijk[pick], n[pick], m[pick]
    rest_ijk = np.floor(rest[pick] / np.array([VX, VX, VZ])).astype(np.int64)
    centre = (rest_ijk + 0.5) * np.array([VX, VX, VZ])
    rgb = np.zeros((len(ijk), 3))
    cls = np.zeros(len(ijk), dtype=np.int64)
    for mi in np.unique(m):
        sel = m == mi
        mat = sm.mats[int(mi)]
        s = _material_surface(mat)
        name = mat.name if mat is not None else ""
        rgb[sel] = surface_colors(s, centre[sel], n[sel], rest_ijk[sel], seed + int(_name_seed(name)))
        cls[sel] = _class_of(s, name)
    return Voxels(ijk, _lin(rgb), cls)


def _name_seed(name: str) -> int:
    h = 0
    for ch in name:
        h = (h * 131 + ord(ch)) & 0xFFFF
    return h


# exposed face quads per direction, corner offsets (di, dj, dk), CCW seen from outside
_QUADS = {
    (1, 0, 0): ((1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)),
    (-1, 0, 0): ((0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0)),
    (0, 1, 0): ((0, 1, 0), (0, 1, 1), (1, 1, 1), (1, 1, 0)),
    (0, -1, 0): ((0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)),
    (0, 0, 1): ((0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)),
    (0, 0, -1): ((0, 0, 0), (0, 1, 0), (1, 1, 0), (1, 0, 0)),
}

_VCOL_MATS: dict[int, bpy.types.Material] = {}


def vcol_material(cls: int) -> bpy.types.Material:
    names = {CLS_DIFFUSE: "diffuse", CLS_TEAM: "team", CLS_EMIT: "emit", CLS_METAL: "metal", CLS_GLOSS: "gloss"}
    name = f"kr_vox_{names[cls]}"
    mt = _VCOL_MATS.get(cls)
    if mt is not None and mt.name in bpy.data.materials:
        return mt
    mt = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    nb = K.NodeBuilder(mt)
    attr = nb.n("ShaderNodeAttribute")
    attr.attribute_name = "Col"
    attr.attribute_type = "GEOMETRY"
    bsdf = nb.n("ShaderNodeBsdfPrincipled")
    nb.link(attr.outputs["Color"], K._inp(bsdf, "Base Color"))
    rough = {CLS_METAL: 0.4, CLS_GLOSS: 0.2}.get(cls, 0.85)
    K._inp(bsdf, "Roughness").default_value = rough
    K._inp(bsdf, "Metallic").default_value = 0.6 if cls == CLS_METAL else 0.0
    try:
        K._inp(bsdf, "Specular IOR Level", "Specular").default_value = 0.5 if cls in (CLS_METAL, CLS_GLOSS) else 0.08
    except KeyError:
        pass
    if cls == CLS_EMIT:
        nb.link(attr.outputs["Color"], K._inp(bsdf, "Emission Color", "Emission"))
        K._inp(bsdf, "Emission Strength").default_value = 4.0
    out = nb.n("ShaderNodeOutputMaterial")
    nb.link(bsdf.outputs[0], out.inputs["Surface"])
    if cls == CLS_TEAM:
        aov = nb.n("ShaderNodeOutputAOV")
        aov.aov_name = "team"
        K._inp(aov, "Value").default_value = 1.0
    _VCOL_MATS[cls] = mt
    return mt


def build_voxel_object(name: str, vox: Voxels, col: bpy.types.Collection) -> bpy.types.Object | None:
    if len(vox.ijk) == 0:
        return None
    lo = vox.ijk.min(axis=0) - 1
    dims = vox.ijk.max(axis=0) - lo + 2
    grid = np.full(tuple(int(d) for d in dims), -1, dtype=np.int64)
    rel = vox.ijk - lo
    grid[rel[:, 0], rel[:, 1], rel[:, 2]] = np.arange(len(rel))
    corners, fcell = [], []
    for d, quad in _QUADS.items():
        nb = rel + np.array(d)
        empty = grid[nb[:, 0], nb[:, 1], nb[:, 2]] < 0
        idx = np.nonzero(empty)[0]
        if len(idx) == 0:
            continue
        base = vox.ijk[idx]
        q = np.stack([base + np.array(o) for o in quad], axis=1)  # (F, 4, 3)
        corners.append(q)
        fcell.append(idx)
    q = np.concatenate(corners)
    cells = np.concatenate(fcell)
    uniq, inv = np.unique(q.reshape(-1, 3), axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    co = uniq.astype(np.float64) * np.array([VX, VX, VZ])
    nf = len(q)
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(co))
    me.vertices.foreach_set("co", co.astype(np.float32).ravel())
    me.loops.add(nf * 4)
    me.loops.foreach_set("vertex_index", inv.astype(np.int32))
    me.polygons.add(nf)
    me.polygons.foreach_set("loop_start", (np.arange(nf) * 4).astype(np.int32))
    cls_f = vox.cls[cells]
    used = sorted(set(int(c) for c in np.unique(cls_f)))
    slot = {c: i for i, c in enumerate(used)}
    for c in used:
        me.materials.append(vcol_material(c))
    me.polygons.foreach_set("material_index", np.array([slot[int(c)] for c in cls_f], dtype=np.int32))
    me.update(calc_edges=True)
    attr = me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
    rgba = np.ones((nf, 4), dtype=np.float32)
    rgba[:, :3] = vox.rgb[cells]
    attr.data.foreach_set("color", np.repeat(rgba, 4, axis=0).ravel())
    ob = bpy.data.objects.new(name, me)
    ob["kr_keep_uv"] = True
    ob["kr_voxel"] = True
    col.objects.link(ob)
    return ob


# ---------------------------------------------------------------------------
# Poses and animated parts
# ---------------------------------------------------------------------------


def sway_deform(amount: float, zmax: float) -> Deform:
    """Quadratic bend along the screen-right direction (tree sway pose)."""
    d = np.array([K.SCREEN_RIGHT.x, K.SCREEN_RIGHT.y, 0.0])
    d = d / np.linalg.norm(d)

    def fn(p: np.ndarray, n: np.ndarray, _o) -> tuple[np.ndarray, np.ndarray]:
        t = np.clip(p[:, 2] / max(zmax, 1e-3), 0.0, 1.0)
        return p + (amount * t * t)[:, None] * d[None, :], n

    return fn


#: whole-sprite poses rendered as `<name>__<pose>` frames
POSES: dict[str, Callable[[float], Deform]] = {
    "swayl": lambda zmax: sway_deform(-0.05, zmax),
    "swayr": lambda zmax: sway_deform(0.05, zmax),
}

#: animated part kind -> (overlay group, frame count). Parts tagged with
#: kr_kit.B.anim are left out of the sprite and rendered as looping overlay
#: frames `<name>__<group><i>` with the same size and anchor as the sprite.
ANIM: dict[str, tuple[str, int]] = {
    "flag": ("flag", 6),
    "hang": ("flag", 6),
    "sails": ("sails", 8),
}


def _prop(ob: bpy.types.Object, key: str, default):
    v = ob.get("kr_" + key, default)
    return tuple(v) if hasattr(v, "__len__") and not isinstance(v, str) else v


def _part_deform(ob: bpy.types.Object, f: int, frames: int) -> Callable[[np.ndarray, np.ndarray], tuple[np.ndarray, np.ndarray]]:
    kind = ob["kr_anim"]
    pv = np.array(_prop(ob, "pivot", (0.0, 0.0, 0.0)), dtype=np.float64)
    # per part phase offset so neighbouring flags do not flap in lockstep
    phase0 = (math.sin(pv[0] * 12.9898 + pv[1] * 78.233) * 43758.5453) % 1.0
    ph = 2.0 * math.pi * (f / frames + phase0)
    if kind == "flag":
        d = np.array(list(_prop(ob, "dir", (1.0, 0.0))) + [0.0])
        d = d / max(np.linalg.norm(d), 1e-9)
        perp = np.array([-d[1], d[0], 0.0])
        ln = float(_prop(ob, "len", 0.15))

        def fn(p: np.ndarray, n: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
            u = np.clip(((p - pv) @ d) / max(ln, 1e-3), 0.0, 1.3)
            w = np.sin(2.0 * math.pi * 0.85 * u - ph)
            off = perp[None, :] * (0.05 * u * w)[:, None]
            off[:, 2] += 0.028 * u * np.cos(2.0 * math.pi * 0.85 * u - ph)
            off -= d[None, :] * (0.02 * u * (1 - np.cos(ph)) * 0.5)[:, None]
            return p + off, n

        return fn
    if kind == "hang":
        top = float(_prop(ob, "top", pv[2]))
        nrm = np.array(list(_prop(ob, "normal", (0.0, -1.0))) + [0.0])
        tan = np.array([-nrm[1], nrm[0], 0.0])
        ln = float(_prop(ob, "len", 0.24))

        def fn(p: np.ndarray, n: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
            v = np.clip((top - p[:, 2]) / max(ln, 1e-3), 0.0, 1.0)
            out = (np.sin(ph + v * math.pi * 1.2) * 0.5 + 0.5) * 0.026 * v
            side = np.sin(ph + v * 2.0) * 0.012 * v
            return p + nrm[None, :] * out[:, None] + tan[None, :] * side[:, None], n

        return fn
    if kind == "sails":
        axis = np.array(_prop(ob, "axis", (0.0, 1.0, 0.0)), dtype=np.float64)
        axis = axis / np.linalg.norm(axis)
        # four-fold symmetric: one quarter turn per loop, clockwise seen from the front
        a = -0.5 * math.pi * f / frames
        c, s = math.cos(a), math.sin(a)
        kx = np.array([[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]])
        rot = np.eye(3) * c + s * kx + (1 - c) * np.outer(axis, axis)

        def fn(p: np.ndarray, n: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
            return (p - pv) @ rot.T + pv, n @ rot.T

        return fn
    raise ValueError(f"unknown animated part {kind!r}")


def _anim_frame_deform(objs: list[bpy.types.Object], f: int, frames: int) -> Deform:
    fns = [_part_deform(ob, f, frames) for ob in objs]

    def fn(p: np.ndarray, n: np.ndarray, o: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        p2, n2 = p.copy(), n.copy()
        for i, part in enumerate(fns):
            sel = o == i
            if sel.any():
                p2[sel], n2[sel] = part(p[sel], n[sel])
        return p2, n2

    return fn


# ---------------------------------------------------------------------------
# Collection level API used by kr_lib.run_jobs
# ---------------------------------------------------------------------------


def source_objects(col: bpy.types.Collection) -> list[bpy.types.Object]:
    return [ob for ob in col.all_objects if not ob.get("kr_voxel") and not ob.hide_render]


def is_overlay(pose: str) -> bool:
    """Overlay poses (animated parts) are drawn over the sprite, the others replace it."""
    return pose != "" and pose not in POSES


def voxelize_collection(
    scene: bpy.types.Scene,
    col: bpy.types.Collection,
    poses: tuple[str, ...] = (),
    seed: int = 1,
) -> dict[str, Voxels]:
    """Voxelise the collection's renderable geometry for every pose.

    Returns {"": sprite, "<pose>": whole-sprite pose, "<group><i>": animated
    part overlay frame, ...}. Sources are hidden from render (not deleted) so
    `restore_collection` can bring them back before the .blend is saved.
    Meshes are built later, one sprite at a time, by `build_pose_objects`.
    """
    srcs = source_objects(col)
    static = [ob for ob in srcs if "kr_anim" not in ob]
    parts = [ob for ob in srcs if "kr_anim" in ob]
    spacing = 0.4 * min(VX, VZ)
    sm = sample_collection(scene, static, spacing)
    groups: dict[str, list[bpy.types.Object]] = {}
    for ob in parts:
        groups.setdefault(ANIM[ob["kr_anim"]][0], []).append(ob)
    group_samples = {g: sample_collection(scene, obs, spacing) for g, obs in groups.items()}
    for ob in srcs:
        ob.hide_render = True
        ob["kr_voxel_src"] = True
    out: dict[str, Voxels] = {}
    zmax = float(sm.p[:, 2].max()) if len(sm.p) else 1.0

    def keep(v: Voxels) -> Voxels:
        return Voxels(v.ijk.astype(np.int32), v.rgb.astype(np.float32), v.cls.astype(np.int8))

    for pose in ("",) + tuple(poses):
        deform = POSES[pose](zmax) if pose else None
        out[pose] = keep(voxelize_samples(sm, deform, seed))
    for g, gs in group_samples.items():
        frames = max(ANIM[ob["kr_anim"]][1] for ob in groups[g])
        for f in range(frames):
            out[f"{g}{f}"] = keep(voxelize_samples(gs, _anim_frame_deform(groups[g], f, frames), seed + 7))
    return out


def corner_points(voxsets: dict[str, Voxels]) -> np.ndarray:
    """World-space corners of every voxel of every pose (for framing)."""
    pts = []
    for vox in voxsets.values():
        if len(vox.ijk) == 0:
            continue
        ijk = vox.ijk.astype(np.int64)
        for d in ((0, 0, 0), (1, 0, 0), (0, 1, 0), (1, 1, 0), (0, 0, 1), (1, 0, 1), (0, 1, 1), (1, 1, 1)):
            pts.append((ijk + np.array(d)) * np.array([VX, VX, VZ]))
    return np.concatenate(pts) if pts else np.zeros((0, 3))


def build_pose_objects(voxsets: dict[str, Voxels], col: bpy.types.Collection, name: str) -> dict[str, bpy.types.Object]:
    out: dict[str, bpy.types.Object] = {}
    for pose, vox in voxsets.items():
        v = Voxels(vox.ijk.astype(np.int64), vox.rgb.astype(np.float64), vox.cls.astype(np.int64))
        ob = build_voxel_object(f"vox_{name}{'__' + pose if pose else ''}", v, col)
        if ob is not None:
            ob["kr_pose"] = pose
            out[pose] = ob
    return out


def show_pose(objs: dict[str, bpy.types.Object], pose: str) -> None:
    """Show only the voxel object of one pose."""
    for p, ob in objs.items():
        ob.hide_render = p != pose


def build_holdout(base: Voxels, part: Voxels, col: bpy.types.Collection, name: str) -> bpy.types.Object | None:
    """The sprite as a holdout for an overlay frame, minus the cells the
    animated part occupies (a part voxel sharing a cell with the sprite must
    win, otherwise the holdout would punch holes into it)."""
    if len(base.ijk) == 0:
        return None
    b = base.ijk.astype(np.int64)
    p = part.ijk.astype(np.int64)

    def key(a: np.ndarray) -> np.ndarray:
        return ((a[:, 0] + 2 ** 20) << 42) | ((a[:, 1] + 2 ** 20) << 21) | (a[:, 2] + 2 ** 20)

    keep = ~np.isin(key(b), key(p)) if len(p) else np.ones(len(b), bool)
    v = Voxels(b[keep], base.rgb[keep].astype(np.float64), np.zeros(int(keep.sum()), np.int64))
    ob = build_voxel_object(f"vox_{name}__holdout", v, col)
    if ob is not None:
        ob.is_holdout = True
    return ob


def restore_collection(col: bpy.types.Collection) -> None:
    """Delete voxel objects and unhide their sources (keeps .blend files small)."""
    for ob in list(col.all_objects):
        if ob.get("kr_voxel"):
            me = ob.data
            bpy.data.objects.remove(ob, do_unlink=True)
            if me is not None and me.users == 0:
                bpy.data.meshes.remove(me)
        elif ob.get("kr_voxel_src"):
            ob.hide_render = False
            del ob["kr_voxel_src"]
