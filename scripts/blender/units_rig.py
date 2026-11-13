"""Style A unit toolkit: jointed voxel puppets, rasterised on the game's voxel
lattice and lit like the style A world. Pure numpy, no Blender API, so the
same code runs inside Blender (`-b -P render_units.py`) and in plain Python.

Lattice (style A): one voxel is 1/32 tile wide (a 2 px wide top at 1x) and
1/39.19 tile high (exactly 1 px per layer at 1x). Game tile coordinates:
x and y on the ground (screen x = 32 (x - y), screen y = 16 (x + y)), z up.

A unit is authored in unit-local coordinates (f = forward, s = its left,
z = up, 1 unit = 1 tile, origin between the feet on the ground) and rotated
to one of the 8 game facings when rendered.

Every primitive paints the lattice cells whose centres fall inside it (later
primitives paint over earlier ones, like the TypeScript voxel rigs). Each
painted cell also gets a colour jitter value hashed from its position in the
primitive's own frame, so a limb keeps its speckle pattern while it swings
and colours do not crawl between animation frames.
"""

from __future__ import annotations

import colorsys
import math
import struct
import zlib
from contextlib import contextmanager
from dataclasses import dataclass, field

import numpy as np

VX = 1.0 / 32.0
VZ = 1.0 / 39.1918

#: game facings, index = 45 degree steps from tile +x (the engine's order)
FACINGS = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"]

# ---------------------------------------------------------------------------
# Palette (sRGB albedo). Keys follow the style A bake-off where they exist.
# ---------------------------------------------------------------------------

PALETTE: dict[str, int] = {
    "skin": 0xEDB48C,
    "skin_d": 0xC98A66,
    "hair": 0x5E3A20,
    "hair_l": 0x8A5A30,
    "beard": 0x6A4024,
    "linen": 0xE2D2AC,
    "linen_d": 0xB8A47E,
    "tunic": 0x8A6A40,
    "trousers": 0x5E4A36,
    "leather": 0x8C5A32,
    "leather_d": 0x4A2E1E,
    "boots": 0x3A281C,
    "team": 0xC8C8C8,  # neutral; the engine tints it through the mask
    "team_trim": 0xF0EADA,
    "steel": 0x9EA7B2,
    "steel_d": 0x67707C,
    "iron": 0x4A4846,
    "black_iron": 0x34363A,
    "bronze": 0x9E7A4C,
    "wood": 0xA0703C,
    "wood_d": 0x5E3E22,
    "wood_l": 0xC89A5E,
    "string": 0xEDE4CC,
    "fletch": 0xF6F2E8,
    "hood": 0x3F5A26,
    "hood_d": 0x2C3F1B,
    "horse": 0x8E5530,
    "horse_l": 0xA86A3C,
    "horse_d": 0x2E1E14,
    "hoof": 0x262220,
    "sock": 0xE6DED0,
    "felt": 0x4A3E36,
    "straw_hat": 0xE6C064,
    "straw_d": 0xB48C40,
    "eye": 0x1E1410,
    "mouth": 0x8A3E30,
    "gold": 0xF0C040,
    "stone": 0xA49E92,
    "log": 0x7C5A3A,
    "log_end": 0xD8B07A,
    "basket": 0xB8925A,
    "berry": 0xB8283C,
    "wheat": 0xE8C460,
    "leaf": 0x4E8A34,
    "sack": 0xCDB88C,
    "plume": 0xF2EEE6,
    "rope": 0xC8A870,
    "flash": 0xFFF0B0,
    "spark": 0xFFB030,
    "powder": 0x2A2624,
}

#: keys that are never saturation / value boosted
NEUTRAL_KEYS = {"team", "team_trim", "eye", "flash", "spark"}
#: emissive keys skip lighting
EMISSIVE = {"flash": 1.0, "spark": 1.0}
#: keys drawn into the team-colour mask
TEAM_KEYS = {"team"}
#: per key value jitter amplitude (default 0.035)
JITTER = {
    "straw_hat": 0.09, "straw_d": 0.08, "hair": 0.07, "beard": 0.07, "horse": 0.06, "horse_l": 0.06,
    "horse_d": 0.05, "wood": 0.06, "wood_d": 0.06, "wood_l": 0.06, "leather": 0.05, "log": 0.08,
    "log_end": 0.05, "basket": 0.08, "hood": 0.05, "stone": 0.1, "gold": 0.08, "wheat": 0.09,
    "linen": 0.03, "team": 0.025, "skin": 0.02, "steel": 0.03, "eye": 0.0, "flash": 0.0, "spark": 0.0,
    "trousers": 0.05, "tunic": 0.05, "sack": 0.05, "leaf": 0.08, "berry": 0.06,
}
A_SAT = 1.12
A_VAL = 1.04


def srgb_to_lin(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(np.asarray(c, dtype=np.float64), 0.0, None)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def _albedo(key: str) -> tuple[float, float, float]:
    h = PALETTE[key]
    r, g, b = (((h >> s) & 255) / 255.0 for s in (16, 8, 0))
    if key not in NEUTRAL_KEYS:
        hh, ss, vv = colorsys.rgb_to_hsv(r, g, b)
        r, g, b = colorsys.hsv_to_rgb(hh, min(1.0, ss * A_SAT), min(1.0, vv * A_VAL))
    return tuple(float(v) for v in srgb_to_lin((r, g, b)))


KEYS = ["void"] + list(PALETTE)
KEY_ID = {k: i for i, k in enumerate(KEYS)}
ALBEDO = np.array([(0.0, 0.0, 0.0)] + [_albedo(k) for k in PALETTE], dtype=np.float64)
JIT_AMP = np.array([0.0] + [JITTER.get(k, 0.035) for k in PALETTE], dtype=np.float64)
EMIT = np.array([0.0] + [EMISSIVE.get(k, 0.0) for k in PALETTE], dtype=np.float64)
TEAM_IDS = np.array([KEY_ID[k] for k in TEAM_KEYS])

# ---------------------------------------------------------------------------
# Light: the style A sun (screen top-left, shadows to the bottom-right)
# ---------------------------------------------------------------------------

_EL = math.radians(42.0)
_H = np.array([-1.0, 0.6]) / math.hypot(1.0, 0.6)  # game x, y (Blender (-1, -0.6))
SUN_DIR = np.array([_H[0] * math.cos(_EL), _H[1] * math.cos(_EL), math.sin(_EL)])
SUN_RGB = np.array([1.0, 0.92, 0.78]) * 3.4 / math.pi
SKY_RGB = np.array([0.55, 0.66, 0.9]) * 0.75
BOUNCE_RGB = np.array([0.20, 0.19, 0.15]) * 0.5
#: a soft fill from the camera keeps faces readable on the shade side
FILL_RGB = np.array([0.16, 0.15, 0.14])
SUN_SOFT_DEG = 4.5
SHADOW_ALPHA = 0.5

# ---------------------------------------------------------------------------
# Small matrix helpers (4x4, column vectors)
# ---------------------------------------------------------------------------


def T(x: float = 0.0, y: float = 0.0, z: float = 0.0) -> np.ndarray:
    m = np.eye(4)
    m[:3, 3] = (x, y, z)
    return m


def R(axis: str, deg: float) -> np.ndarray:
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    m = np.eye(4)
    if axis == "f":  # roll about the forward axis
        m[1:3, 1:3] = [[c, -s], [s, c]]
    elif axis == "s":  # pitch about the left axis: positive tips the top forward
        m[0, 0], m[0, 2], m[2, 0], m[2, 2] = c, s, -s, c
    else:  # yaw about z: positive turns left
        m[0, 0], m[0, 1], m[1, 0], m[1, 1] = c, -s, s, c
    return m


def S(k: float) -> np.ndarray:
    m = np.eye(4)
    m[0, 0] = m[1, 1] = m[2, 2] = k
    return m


def V(f: float, s: float, z: float) -> np.ndarray:
    return np.array([f, s, z], dtype=np.float64)


def xfp(m: np.ndarray, p) -> np.ndarray:
    p = np.asarray(p, dtype=np.float64)
    return m[:3, :3] @ p + m[:3, 3]


def frame_from_axis(a: np.ndarray, b: np.ndarray, ref=(0.0, 1.0, 0.0)) -> np.ndarray:
    """4x4 frame with origin a and local z along a->b; local x is perpendicular to `ref`."""
    d = b - a
    ln = float(np.linalg.norm(d))
    z = d / ln if ln > 1e-9 else np.array([0.0, 0.0, 1.0])
    r = np.asarray(ref, dtype=np.float64)
    x = np.cross(r, z)
    if np.linalg.norm(x) < 1e-6:
        x = np.cross(np.array([1.0, 0.0, 0.0]), z)
        if np.linalg.norm(x) < 1e-6:
            x = np.cross(np.array([0.0, 0.0, 1.0]), z)
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    m = np.eye(4)
    m[:3, 0], m[:3, 1], m[:3, 2], m[:3, 3] = x, y, z, a
    return m


def facing_matrix(index: int) -> np.ndarray:
    """Unit-local (f, s, z) -> game tile (x, y, z) for facing `index` (det -1:
    game x/y/z is left-handed while the rig frame is right-handed)."""
    a = math.radians(45.0 * index)
    m = np.eye(4)
    m[0, 0], m[1, 0] = math.cos(a), math.sin(a)  # forward
    m[0, 1], m[1, 1] = math.sin(a), -math.cos(a)  # left
    return m


def _hash(q: np.ndarray, seed: int) -> np.ndarray:
    """Deterministic value in [-1, 1] per integer triple (rows of q)."""
    q = q.astype(np.int64)
    h = (q[:, 0] * 73856093) ^ (q[:, 1] * 19349663) ^ (q[:, 2] * 83492791) ^ np.int64(seed)
    h &= 0xFFFFFFFF
    h = ((h ^ (h >> 15)) * 0x2C1B3C6D) & 0xFFFFFFFF
    h = ((h ^ (h >> 12)) * 0x297A2D39) & 0xFFFFFFFF
    h ^= h >> 15
    return (h & 0xFFFF).astype(np.float64) / 32767.5 - 1.0


def _seed(key: str, tag: int) -> int:
    return (zlib.crc32(key.encode()) ^ (tag * 0x9E3779B1)) & 0x7FFFFFFF


# ---------------------------------------------------------------------------
# Voxel canvas + primitives
# ---------------------------------------------------------------------------


class Mk:
    """Rasterises primitives onto the voxel lattice for one pose."""

    def __init__(self, facing: int = 1, density: float = 1.0, half: int = 48, layers: int = 96,
                 world: np.ndarray | None = None):
        self.vx = VX / density
        self.vz = VZ / density
        self.half = int(half * density)
        self.layers = int(layers * density)
        n = 2 * self.half
        self.mat = np.zeros((n, n, self.layers), dtype=np.uint8)
        self.jit = np.zeros((n, n, self.layers), dtype=np.float32)
        self.world = facing_matrix(facing) if world is None else world
        self.stack = [np.eye(4)]
        self.points: dict[str, np.ndarray] = {}
        self._tag = 0

    # -- frames ----------------------------------------------------------------
    @contextmanager
    def push(self, m: np.ndarray):
        self.stack.append(self.stack[-1] @ m)
        try:
            yield
        finally:
            self.stack.pop()

    def at(self, p) -> np.ndarray:
        """Current-frame point -> unit-local point."""
        return xfp(self.stack[-1], p)

    def mark(self, name: str, p) -> None:
        """Remember a named point (unit-local), e.g. a muzzle or bow hand."""
        self.points[name] = self.at(p)

    # -- core rasteriser ---------------------------------------------------------
    def _paint(self, prim: np.ndarray, lo: np.ndarray, hi: np.ndarray, inside, key: str) -> None:
        """prim: 4x4 primitive frame (unit-local). lo/hi: local AABB. inside(q) -> bool mask."""
        full = self.world @ self.stack[-1] @ prim
        corners = np.array([[x, y, z] for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])])
        wc = corners @ full[:3, :3].T + full[:3, 3]
        wlo, whi = wc.min(0), wc.max(0)
        i0 = max(int(math.floor(wlo[0] / self.vx)), -self.half)
        i1 = min(int(math.floor(whi[0] / self.vx)), self.half - 1)
        j0 = max(int(math.floor(wlo[1] / self.vx)), -self.half)
        j1 = min(int(math.floor(whi[1] / self.vx)), self.half - 1)
        k0 = max(int(math.floor(wlo[2] / self.vz)), 0)
        k1 = min(int(math.floor(whi[2] / self.vz)), self.layers - 1)
        self._tag += 1
        seed = _seed(key, self._tag if key in ("eye",) else 0)
        kid = KEY_ID[key]
        if i1 < i0 or j1 < j0 or k1 < k0:
            return
        ii, jj, kk = np.meshgrid(np.arange(i0, i1 + 1), np.arange(j0, j1 + 1), np.arange(k0, k1 + 1), indexing="ij")
        ii, jj, kk = ii.ravel(), jj.ravel(), kk.ravel()
        pw = np.stack([(ii + 0.5) * self.vx, (jj + 0.5) * self.vx, (kk + 0.5) * self.vz], axis=1)
        inv = np.linalg.inv(full)
        q = pw @ inv[:3, :3].T + inv[:3, 3]
        sel = inside(q)
        if not sel.any():
            # sub-voxel primitive: paint the cell holding its centre
            c = full[:3, 3]
            ci, cj, ck = int(math.floor(c[0] / self.vx)), int(math.floor(c[1] / self.vx)), int(math.floor(c[2] / self.vz))
            if -self.half <= ci < self.half and -self.half <= cj < self.half and 0 <= ck < self.layers:
                self.mat[ci + self.half, cj + self.half, ck] = kid
                self.jit[ci + self.half, cj + self.half, ck] = 0.0
            return
        qs = q[sel]
        cell = np.floor(qs / np.array([VX, VX, VZ])).astype(np.int64)
        jv = _hash(cell, seed)
        a, b, c = ii[sel] + self.half, jj[sel] + self.half, kk[sel]
        self.mat[a, b, c] = kid
        self.jit[a, b, c] = jv

    # -- primitives ---------------------------------------------------------------
    def ell(self, c, r, key: str, rot: np.ndarray | None = None, clip_lo=None, clip_hi=None) -> None:
        """Ellipsoid; clip_lo / clip_hi (local, relative to c) keep only a slab of it."""
        r = np.array((r, r, r) if np.isscalar(r) else r, dtype=np.float64)
        prim = T(*c) @ (rot if rot is not None else np.eye(4))
        lo = -r if clip_lo is None else np.maximum(-r, np.asarray(clip_lo, dtype=np.float64))
        hi = r if clip_hi is None else np.minimum(r, np.asarray(clip_hi, dtype=np.float64))

        def inside(q):
            return (((q / r) ** 2).sum(1) <= 1.0) & (q >= lo).all(1) & (q <= hi).all(1)

        self._paint(prim, lo, hi, inside, key)

    def box(self, c, size, key: str, rot: np.ndarray | None = None) -> None:
        h = np.maximum(np.array(size, dtype=np.float64) / 2, 1e-4)
        prim = T(*c) @ (rot if rot is not None else np.eye(4))
        self._paint(prim, -h, h, lambda q: (np.abs(q) <= h).all(1), key)

    def capsule(self, a, b, ra: float, rb: float | None = None, key: str = "skin", caps: bool = True,
                ref=(0.0, 1.0, 0.0)) -> None:
        rb = ra if rb is None else rb
        a = np.asarray(a, dtype=np.float64)
        b = np.asarray(b, dtype=np.float64)
        prim = frame_from_axis(a, b, ref)
        ln = float(np.linalg.norm(b - a))
        rm = max(ra, rb)
        lo = np.array([-rm, -rm, -(rm if caps else 0.0)])
        hi = np.array([rm, rm, ln + (rm if caps else 0.0)])

        def inside(q):
            t = np.clip(q[:, 2] / max(ln, 1e-9), 0.0, 1.0)
            rad = ra + (rb - ra) * t
            if caps:
                d = np.sqrt(q[:, 0] ** 2 + q[:, 1] ** 2 + (q[:, 2] - t * ln) ** 2)
                return d <= rad
            within = (q[:, 2] >= 0) & (q[:, 2] <= ln)
            return within & (q[:, 0] ** 2 + q[:, 1] ** 2 <= rad ** 2)

        self._paint(prim, lo, hi, inside, key)

    def cyl(self, a, b, r: float, key: str, ref=(0.0, 1.0, 0.0)) -> None:
        self.capsule(a, b, r, r, key, caps=False, ref=ref)

    def line(self, a, b, key: str, r: float = 0.012) -> None:
        """Thin rod: at least one voxel wide everywhere."""
        a = np.asarray(a, dtype=np.float64)
        b = np.asarray(b, dtype=np.float64)
        self.capsule(a, b, r, r, key)
        # make sure no gaps: paint the cells along the segment
        full_a = xfp(self.world @ self.stack[-1], a)
        full_b = xfp(self.world @ self.stack[-1], b)
        d = full_b - full_a
        n = int(max(abs(d[0]) / self.vx, abs(d[1]) / self.vx, abs(d[2]) / self.vz) * 2) + 1
        kid = KEY_ID[key]
        for t in np.linspace(0.0, 1.0, n + 1):
            p = full_a + d * t
            ci = int(math.floor(p[0] / self.vx)) + self.half
            cj = int(math.floor(p[1] / self.vx)) + self.half
            ck = int(math.floor(p[2] / self.vz))
            if 0 <= ci < 2 * self.half and 0 <= cj < 2 * self.half and 0 <= ck < self.layers:
                if self.mat[ci, cj, ck] != kid:
                    self.mat[ci, cj, ck] = kid
                    self.jit[ci, cj, ck] = 0.0

    def prism(self, poly, origin, u, v, thick: float, key: str) -> None:
        """Polygon `poly` (2D, in u/v units) extruded `thick` along u x v."""
        o = np.asarray(origin, dtype=np.float64)
        u = np.asarray(u, dtype=np.float64)
        v = np.asarray(v, dtype=np.float64)
        u = u / np.linalg.norm(u)
        v = v - u * float(u @ v)
        v = v / np.linalg.norm(v)
        w = np.cross(u, v)
        prim = np.eye(4)
        prim[:3, 0], prim[:3, 1], prim[:3, 2], prim[:3, 3] = u, v, w, o
        poly = np.asarray(poly, dtype=np.float64)
        th = max(thick, 1e-4) / 2
        lo = np.array([poly[:, 0].min(), poly[:, 1].min(), -th])
        hi = np.array([poly[:, 0].max(), poly[:, 1].max(), th])

        def inside(q):
            x, y = q[:, 0], q[:, 1]
            ins = np.zeros(len(q), dtype=bool)
            n = len(poly)
            for e in range(n):
                x1, y1 = poly[e]
                x2, y2 = poly[(e + 1) % n]
                cond = (y1 > y) != (y2 > y)
                xi = (x2 - x1) * (y - y1) / ((y2 - y1) if y2 != y1 else 1e-9) + x1
                ins ^= cond & (x < xi)
            return ins & (np.abs(q[:, 2]) <= th)

        self._paint(prim, lo, hi, inside, key)

    def disc(self, c, axis, r: float, thick: float, key: str, r_in: float = 0.0, ref=(0.0, 0.0, 1.0)) -> None:
        """Flat ring / disc (wheels): centre c, normal `axis`."""
        c = np.asarray(c, dtype=np.float64)
        ax = np.asarray(axis, dtype=np.float64)
        ax = ax / np.linalg.norm(ax)
        prim = frame_from_axis(c - ax * thick / 2, c + ax * thick / 2, ref)

        def inside(q):
            rr = q[:, 0] ** 2 + q[:, 1] ** 2
            return (q[:, 2] >= 0) & (q[:, 2] <= thick) & (rr <= r * r) & (rr >= r_in * r_in)

        self._paint(prim, np.array([-r, -r, 0.0]), np.array([r, r, thick]), inside, key)

    # -- queries ---------------------------------------------------------------------
    def screen_of(self, p_unit) -> tuple[float, float]:
        """Unit-local point -> 1x screen offset from the anchor (feet)."""
        w = xfp(self.world, p_unit)
        return 32.0 * (w[0] - w[1]), 16.0 * (w[0] + w[1]) - w[2] / VZ


# ---------------------------------------------------------------------------
# Renderer
# ---------------------------------------------------------------------------


@dataclass
class Frame:
    rgba: np.ndarray  # H x W x 4 uint8
    mask: np.ndarray  # H x W x 4 uint8 (alpha = team coverage, rgb = luma * 1.25)
    ax: int  # anchor (feet) pixel x in the image
    ay: int
    shadow: np.ndarray | None = None  # H x W x 4 uint8 black + alpha
    sax: int = 0
    say: int = 0
    points: dict = field(default_factory=dict)


def _grade(srgb: np.ndarray) -> np.ndarray:
    """style A post grade: sat 1.06, contrast 1.04, warm 0.4, cool shadows 0.5."""
    lum = lambda x: x[..., 0] * 0.2126 + x[..., 1] * 0.7152 + x[..., 2] * 0.0722  # noqa: E731
    x = srgb.copy()
    l = lum(x)[..., None]
    x = l + (x - l) * 1.06
    x = (x - 0.5) * 1.04 + 0.5
    l = lum(np.clip(x, 0, 1))[..., None]
    x = x + 0.4 * l * np.array([1.0, 0.45, -0.6]) * 0.1
    x = x + 0.5 * (1 - l) ** 2 * np.array([-0.4, -0.1, 0.8]) * 0.1
    return np.clip(x, 0, 1)


def _sun_dirs(n: int = 5) -> list[np.ndarray]:
    base = SUN_DIR / np.linalg.norm(SUN_DIR)
    if n <= 1:
        return [base]
    a = np.cross(base, [0.0, 0.0, 1.0])
    a /= np.linalg.norm(a)
    b = np.cross(base, a)
    out = [base]
    r = math.tan(math.radians(SUN_SOFT_DEG))
    for k in range(n - 1):
        t = 2 * math.pi * k / (n - 1)
        d = base + (a * math.cos(t) + b * math.sin(t)) * r
        out.append(d / np.linalg.norm(d))
    return out


SUN_DIRS = _sun_dirs(5)


def _march(occ: np.ndarray, start: np.ndarray, d_idx: np.ndarray, max_steps: int = 140) -> np.ndarray:
    """Fraction-free shadow test: True where a ray from `start` (index coords, N x 3)
    along `d_idx` (index units) hits an occupied cell."""
    ni, nj, nk = occ.shape
    step = d_idx / np.abs(d_idx).max() * 0.5
    p = start.copy()
    hit = np.zeros(len(p), dtype=bool)
    alive = np.ones(len(p), dtype=bool)
    for _ in range(max_steps):
        p += step
        c = np.floor(p).astype(np.int64)
        inb = (c[:, 0] >= 0) & (c[:, 0] < ni) & (c[:, 1] >= 0) & (c[:, 1] < nj) & (c[:, 2] >= 0) & (c[:, 2] < nk)
        alive &= inb | (p[:, 2] < nk)  # still below the top
        alive &= p[:, 2] < nk
        if not alive.any():
            break
        m = alive & inb
        if m.any():
            idx = np.where(m)[0]
            o = occ[c[idx, 0], c[idx, 1], c[idx, 2]]
            hit[idx[o]] = True
            alive[idx[o]] = False
    return hit


def render(mk: Mk, shadow: bool = False, rim: float = 0.0) -> Frame | None:
    occ = mk.mat > 0
    if not occ.any():
        return None
    half = mk.half
    ni, nj, nk = occ.shape
    vx, vz = mk.vx, mk.vz
    ii, jj, kk = np.nonzero(occ)
    ri, rj = ii - half, jj - half
    # screen bbox of every occupied cell (index screen coords: sx = i - j, sy = (i + j) / 2 - k)
    sx_lo = int(math.floor((ri - rj).min() - 2))
    sx_hi = int(math.ceil((ri - rj).max() + 2))
    sy_lo = int(math.floor(((ri + rj) / 2 - kk).min() - 2))
    sy_hi = int(math.ceil(((ri + rj) / 2 - kk).max() + 3))
    W, H = sx_hi - sx_lo, sy_hi - sy_lo
    px, py = np.meshgrid(np.arange(W), np.arange(H))
    n = px + sx_lo  # integer screen column, sx = n + 0.5
    sx = n + 0.5
    sy = py + sy_lo + 0.5
    a = sy + sx / 2.0
    b = sy - sx / 2.0
    even = (n % 2) == 0
    hit_c = np.full((H, W, 3), -1, dtype=np.int64)
    face = np.full((H, W), -1, dtype=np.int64)  # 0 top, 1 +x, 2 +y
    todo = np.ones((H, W), dtype=bool)
    # march from the top layer down; the three entry events per layer
    for t_int in range(nk - 1, -1, -1):
        for off, f_even, f_odd in ((0.875, 0, 0), (0.5, 2, 1), (0.125, 1, 2)):
            if not todo.any():
                break
            t = t_int + off
            ci = np.floor(a + t).astype(np.int64) + half
            cj = np.floor(b + t).astype(np.int64) + half
            m = todo & (ci >= 0) & (ci < ni) & (cj >= 0) & (cj < nj)
            if not m.any():
                continue
            ys, xs = np.nonzero(m)
            o = occ[ci[ys, xs], cj[ys, xs], t_int]
            ys, xs = ys[o], xs[o]
            if len(ys) == 0:
                continue
            hit_c[ys, xs] = np.stack([ci[ys, xs], cj[ys, xs], np.full(len(ys), t_int)], axis=1)
            face[ys, xs] = np.where(even[ys, xs], f_even, f_odd)
            todo[ys, xs] = False
    vis = face >= 0
    ys, xs = np.nonzero(vis)
    cells = hit_c[ys, xs]
    fcs = face[ys, xs]
    normals = np.array([[0, 0, 1], [1, 0, 0], [0, 1, 0]])[fcs]
    kid = mk.mat[cells[:, 0], cells[:, 1], cells[:, 2]]
    jit = mk.jit[cells[:, 0], cells[:, 1], cells[:, 2]].astype(np.float64)

    # ambient occlusion: occupancy around the cell in front of the face
    def occ_at(c):
        inb = (c[:, 0] >= 0) & (c[:, 0] < ni) & (c[:, 1] >= 0) & (c[:, 1] < nj) & (c[:, 2] < nk)
        res = c[:, 2] < 0  # the ground counts as occluder
        m = inb & (c[:, 2] >= 0)
        res[m] = occ[c[m, 0], c[m, 1], c[m, 2]]
        return res

    front = cells + normals
    tang = {0: ([1, 0, 0], [0, 1, 0]), 1: ([0, 1, 0], [0, 0, 1]), 2: ([1, 0, 0], [0, 0, 1])}
    ao_count = np.zeros(len(cells))
    ao2 = np.zeros(len(cells))
    for f_id, (u, v) in tang.items():
        sel = fcs == f_id
        if not sel.any():
            continue
        u, v = np.array(u), np.array(v)
        fr = front[sel]
        cnt = np.zeros(sel.sum())
        cnt2 = np.zeros(sel.sum())
        for du in (-1, 0, 1):
            for dv in (-1, 0, 1):
                if du == 0 and dv == 0:
                    continue
                cnt += occ_at(fr + u * du + v * dv)
        nrm = np.array([[0, 0, 1], [1, 0, 0], [0, 1, 0]][f_id])
        for du in (-2, 0, 2):
            for dv in (-2, 0, 2):
                cnt2 += occ_at(fr + nrm + u * du + v * dv)
        ao_count[sel] = cnt
        ao2[sel] = cnt2
    ao = np.clip(1.0 - 0.06 * ao_count - 0.035 * ao2, 0.35, 1.0)

    # sun visibility (soft: several rays)
    centre = cells.astype(np.float64) + 0.5 + normals * 0.52
    vis_sun = np.zeros(len(cells))
    ndl = normals @ SUN_DIR
    lit_faces = ndl > 0
    for d in SUN_DIRS:
        d_idx = np.array([d[0] / vx, d[1] / vx, d[2] / vz])
        blocked = np.zeros(len(cells), dtype=bool)
        if lit_faces.any():
            blocked[lit_faces] = _march(occ, centre[lit_faces], d_idx)
        vis_sun += ~blocked
    vis_sun /= len(SUN_DIRS)

    # lighting (linear)
    alb = ALBEDO[kid] * (1.0 + jit[:, None] * JIT_AMP[kid][:, None])
    sky_fac = np.where(fcs == 0, 1.0, 0.55)[:, None]
    bounce_fac = np.where(fcs == 0, 0.0, 1.0)[:, None]
    light = (SUN_RGB[None, :] * (np.maximum(ndl, 0.0) * vis_sun)[:, None]
             + SKY_RGB[None, :] * sky_fac * ao[:, None]
             + BOUNCE_RGB[None, :] * bounce_fac * ao[:, None]
             + FILL_RGB[None, :] * np.where(fcs == 0, 0.6, 1.0)[:, None] * ao[:, None])
    col = alb * light
    em = EMIT[kid] > 0
    col[em] = ALBEDO[kid[em]] * 1.6
    srgb = _grade(lin_to_srgb(col))

    rgba = np.zeros((H, W, 4), dtype=np.uint8)
    rgba[ys, xs, :3] = np.round(srgb * 255).astype(np.uint8)
    rgba[ys, xs, 3] = 255
    if rim > 0:
        a_ = rgba[..., 3] > 0
        edge = a_ & ~(np.roll(a_, 1, 0) & np.roll(a_, -1, 0) & np.roll(a_, 1, 1) & np.roll(a_, -1, 1))
        rgba[edge, :3] = np.round(rgba[edge, :3] * (1.0 - rim)).astype(np.uint8)
    mask = np.zeros((H, W, 4), dtype=np.uint8)
    is_team = np.isin(kid, TEAM_IDS)
    if is_team.any():
        luma = srgb[is_team] @ np.array([0.2126, 0.7152, 0.0722])
        v = np.clip(luma * 1.25, 0, 1)
        mask[ys[is_team], xs[is_team], :3] = np.round(v * 255).astype(np.uint8)[:, None]
        mask[ys[is_team], xs[is_team], 3] = 255
    fr = Frame(rgba=rgba, mask=mask, ax=-sx_lo, ay=-sy_lo)
    # unit-local named points -> screen offsets from the feet
    fr.points = {k: mk.screen_of(p) for k, p in mk.points.items()}
    if shadow:
        fr.shadow, fr.sax, fr.say = render_shadow(mk)
    return fr


def render_shadow(mk: Mk, contact: float = 0.0) -> tuple[np.ndarray, int, int]:
    """Ground shadow: rays from each ground pixel towards the sun through the voxels."""
    occ = mk.mat > 0
    half = mk.half
    ii, jj, kk = np.nonzero(occ)
    ri, rj = ii - half, jj - half
    # ground footprint of every voxel along -sun
    d = SUN_DIR
    gx = (ri + 0.5) * mk.vx - d[0] / d[2] * (kk + 0.5) * mk.vz
    gy = (rj + 0.5) * mk.vx - d[1] / d[2] * (kk + 0.5) * mk.vz
    sxs = 32 * (gx - gy) / (mk.vx * 32)
    sys_ = 16 * (gx + gy) / (mk.vx * 32)
    sx_lo = int(math.floor(min(sxs.min(), (ri - rj).min()) - 4))
    sx_hi = int(math.ceil(max(sxs.max(), (ri - rj).max()) + 4))
    sy_lo = int(math.floor(min(sys_.min(), ((ri + rj) / 2).min()) - 4))
    sy_hi = int(math.ceil(max(sys_.max(), ((ri + rj) / 2).max()) + 4))
    W, H = sx_hi - sx_lo, sy_hi - sy_lo
    px, py = np.meshgrid(np.arange(W), np.arange(H))
    sx = (px + sx_lo + 0.5).ravel()
    sy = (py + sy_lo + 0.5).ravel()
    # screen (index units) -> ground index coords: i - j = sx, (i + j) / 2 = sy
    gi = sy + sx / 2.0 + half
    gj = sy - sx / 2.0 + half
    start = np.stack([gi, gj, np.full_like(gi, 0.02)], axis=1)
    frac = np.zeros(len(start))
    for dd in SUN_DIRS:
        d_idx = np.array([dd[0] / mk.vx, dd[1] / mk.vx, dd[2] / mk.vz])
        frac += _march(occ, start.copy(), d_idx, max_steps=int(mk.layers * 2.2))
    frac /= len(SUN_DIRS)
    alpha = (frac * SHADOW_ALPHA).reshape(H, W)
    # soften: one box blur pass, then the contact occlusion under the feet
    pad = np.pad(alpha, 1, mode="edge")
    alpha = (pad[:-2, :-2] + pad[:-2, 1:-1] + pad[:-2, 2:] + pad[1:-1, :-2] + pad[1:-1, 1:-1] * 4
             + pad[1:-1, 2:] + pad[2:, :-2] + pad[2:, 1:-1] + pad[2:, 2:]) / 12.0
    if contact > 0:
        cx, cy = -sx_lo, -sy_lo
        yy, xx = np.mgrid[0:H, 0:W]
        e = ((xx + 0.5 - cx) / (contact * 1.0)) ** 2 + ((yy + 0.5 - cy) / (contact * 0.5)) ** 2
        alpha = np.maximum(alpha, np.clip(1.0 - e, 0, 1) ** 1.5 * 0.42)
    out = np.zeros((H, W, 4), dtype=np.uint8)
    out[..., 3] = np.round(np.clip(alpha, 0, 1) * 255).astype(np.uint8)
    return out, -sx_lo, -sy_lo


# ---------------------------------------------------------------------------
# PNG IO (no Pillow inside Blender)
# ---------------------------------------------------------------------------


def write_png(path: str, rgba: np.ndarray) -> None:
    h, w = rgba.shape[:2]
    raw = b"".join(b"\x00" + rgba[y].tobytes() for y in range(h))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as fh:
        fh.write(png)


def write_png_indexed(path: str, rgba: np.ndarray) -> bool:
    """8-bit palette PNG with tRNS when the image has at most 256 RGBA colours."""
    h, w = rgba.shape[:2]
    flat = rgba.reshape(-1, 4)
    flat = np.where(flat[:, 3:4] == 0, 0, flat)
    keys = flat.astype(np.uint32)
    packed = (keys[:, 0] << 24) | (keys[:, 1] << 16) | (keys[:, 2] << 8) | keys[:, 3]
    uniq, inv = np.unique(packed, return_inverse=True)
    if len(uniq) > 256:
        return False
    # transparent first so the tRNS chunk can stay short
    order = np.argsort((uniq & 0xFF).astype(np.int64), kind="stable")
    remap = np.empty_like(order)
    remap[order] = np.arange(len(order))
    pal = uniq[order]
    idx = remap[inv].astype(np.uint8).reshape(h, w)
    plte = bytes(np.stack([(pal >> 24) & 255, (pal >> 16) & 255, (pal >> 8) & 255], 1).astype(np.uint8).ravel())
    trns = bytes((pal & 255).astype(np.uint8))
    raw = b"".join(b"\x00" + idx[y].tobytes() for y in range(h))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 3, 0, 0, 0))
    png += chunk(b"PLTE", plte) + chunk(b"tRNS", trns) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as fh:
        fh.write(png)
    return True
