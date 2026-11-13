"""Style A terrain (hi-res voxel diorama), drawn from voxel rules in numpy.

Every terrain pixel is the face of one voxel: 32 x 32 voxels per tile, one
layer is 1 px tall and a top face is 2 px wide (the same lattice as the
voxelised sprites). A small orthographic ray caster finds the visible voxel
face per pixel (ground, tufts, pebbles, slabs, drifts, bridge rails) and a
sun ray from that point gives the contact shadows, so the tiles match the
sprites without a Cycles render and are exactly reproducible.

Seamless by construction: all noise and scatter is periodic with the tile
period P (cells mod 32 P), one P x P block is drawn at once and sliced into
P * P tile frames (variant = (x mod P) + P * (y mod P), as before).

Frames are 72 x 36 (64 x 32 diamond + 4 / 2 px of continuation), anchor at
the diamond's bottom corner (36, 34). Transition masks are binary per voxel,
foam rings follow each mask, cliff faces are 32 x 20 (one 4 px step).

Runs inside Blender (terrain.render dispatches here for style A) or
standalone: python3 scripts/blender/terrain_vox.py <out_dir> [only].
"""

from __future__ import annotations

import math
import os
import random
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

TILE_W, TILE_H = 64, 32
BLEED_X, BLEED_Y = 4, 2
FRAME_W, FRAME_H = TILE_W + 2 * BLEED_X, TILE_H + 2 * BLEED_Y
ANCHOR = (FRAME_W // 2, FRAME_H - BLEED_Y)
CELLS = 32  # voxels along a tile edge
STEP_PX = 4  # one elevation step
EDGE_VARIANTS = 3
FOAM_FRAMES = 2
RAIL_H = 10  # extra frame height above the tile for bridge rails

# face light (sun from the screen left): top, left (+y) face, right (+x) face
LIGHT = np.array([1.0, 0.86, 0.68])
SHADOW = np.array([0.70, 0.75, 0.88])
SUN = np.array([-0.75, 0.85, 0.95])
SUN = SUN / np.linalg.norm(SUN)

Writer = Callable[[str, np.ndarray], None]


# ---------------------------------------------------------------------------
# Periodic noise on the voxel lattice
# ---------------------------------------------------------------------------


def hash01(i, j, seed: int = 0) -> np.ndarray:
    i = np.asarray(i, np.int64)
    j = np.asarray(j, np.int64)
    h = (i * 374761393 + j * 668265263 + seed * 2246822519 + 0x27D4EB2F) & 0xFFFFFFFF
    h = ((h ^ (h >> 15)) * 2246822519) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 3266489917) & 0xFFFFFFFF
    h = h ^ (h >> 16)
    return h.astype(np.float64) / 4294967296.0


def pnoise(i: np.ndarray, j: np.ndarray, n: int, cell: int, seed: int) -> np.ndarray:
    """Smooth value noise with lattice `cell` voxels, periodic in n."""
    m = max(1, n // cell)
    x = (i + 0.5) / cell
    y = (j + 0.5) / cell
    x0 = np.floor(x)
    y0 = np.floor(y)
    fx = x - x0
    fy = y - y0
    fx = fx * fx * (3 - 2 * fx)
    fy = fy * fy * (3 - 2 * fy)
    a0 = x0.astype(np.int64) % m
    b0 = y0.astype(np.int64) % m
    a1 = (a0 + 1) % m
    b1 = (b0 + 1) % m
    v00 = hash01(a0, b0, seed)
    v10 = hash01(a1, b0, seed)
    v01 = hash01(a0, b1, seed)
    v11 = hash01(a1, b1, seed)
    return (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy


def fbm(i: np.ndarray, j: np.ndarray, n: int, cells: tuple[int, ...], seed: int) -> np.ndarray:
    acc = np.zeros(np.shape(i))
    tot = 0.0
    w = 1.0
    for k, c in enumerate(cells):
        acc += w * pnoise(i, j, n, c, seed + 31 * k)
        tot += w
        w *= 0.5
    return acc / tot


def pvoronoi(i: np.ndarray, j: np.ndarray, n: int, cell: int, seed: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Periodic voronoi: (F1, F2 - F1, cell id hash)."""
    m = max(1, n // cell)
    x = (i + 0.5) / cell
    y = (j + 0.5) / cell
    xi = np.floor(x).astype(np.int64)
    yi = np.floor(y).astype(np.int64)
    f1 = np.full(np.shape(i), 9.0)
    f2 = np.full(np.shape(i), 9.0)
    ident = np.zeros(np.shape(i))
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            cx = xi + dx
            cy = yi + dy
            a = cx % m
            b = cy % m
            px = cx + 0.15 + 0.7 * hash01(a, b, seed)
            py = cy + 0.15 + 0.7 * hash01(a, b, seed + 1)
            d = np.hypot(px - x, py - y) * cell
            closer = d < f1
            f2 = np.where(closer, f1, np.minimum(f2, d))
            ident = np.where(closer, hash01(a, b, seed + 2), ident)
            f1 = np.where(closer, d, f1)
    return f1, f2 - f1, ident


def hexc(h: int) -> np.ndarray:
    return np.array([(h >> 16) & 255, (h >> 8) & 255, h & 255], np.float64) / 255.0


def ramp(t: np.ndarray, stops: list[tuple[float, int]]) -> np.ndarray:
    xs = np.array([s[0] for s in stops])
    cs = np.stack([hexc(s[1]) for s in stops])
    out = np.empty(np.shape(t) + (3,))
    for ch in range(3):
        out[..., ch] = np.interp(t, xs, cs[:, ch])
    return out


def mix(a: np.ndarray, b, t) -> np.ndarray:
    b = hexc(b) if isinstance(b, int) else b
    t = np.asarray(t, np.float64)
    if t.ndim:
        t = t[..., None]
    return a * (1 - t) + b * t


def quant(t: np.ndarray, levels: int) -> np.ndarray:
    """Quantise a smooth field into flat tone steps (the diorama look)."""
    return np.round(t * levels) / levels


# ---------------------------------------------------------------------------
# Ground fields
# ---------------------------------------------------------------------------


@dataclass
class Field:
    """One periodic block of ground: colour per cell plus voxel columns."""

    n: int
    ground: np.ndarray  # (n, n, 3) top colour at z = 0
    height: np.ndarray  # (n, n) layers above the ground
    tip: np.ndarray  # (n, n, 3) colour of the top layer
    body: np.ndarray  # (n, n, 3) colour of lower layers


def _grid(n: int) -> tuple[np.ndarray, np.ndarray]:
    i, j = np.meshgrid(np.arange(n), np.arange(n), indexing="ij")
    return i, j


def _jitter(c: np.ndarray, i, j, amt: float, seed: int) -> np.ndarray:
    v = 1.0 + (hash01(i, j, seed) - 0.5) * 2 * amt
    hue = (hash01(i, j, seed + 5) - 0.5) * amt * 0.5
    out = c * v[..., None]
    out[..., 0] *= 1 + hue
    out[..., 2] *= 1 - hue
    return out


class Scatter:
    """Deterministic periodic scatter of voxel columns and flat specks."""

    def __init__(self, f: Field, seed: str):
        self.f = f
        self.rng = random.Random(seed)

    def cells(self, count: float, where: np.ndarray | None = None) -> list[tuple[int, int]]:
        n = self.f.n
        out = []
        want = int(round(count * (n // CELLS) ** 2))
        tries = 0
        while len(out) < want and tries < want * 40:
            tries += 1
            i = self.rng.randrange(n)
            j = self.rng.randrange(n)
            if (i - j) % 2:
                j = (j + 1) % n  # visible lattice: i - j even (2 px top faces)
            if where is not None and not where[i, j]:
                continue
            out.append((i, j))
        return out

    def column(self, count: float, h: tuple[int, int], tip: int, body: int, where=None, tip2: int | None = None) -> None:
        f = self.f
        for i, j in self.cells(count, where):
            f.height[i, j] = self.rng.randint(*h)
            f.tip[i, j] = hexc(tip2 if tip2 is not None and self.rng.random() < 0.5 else tip) * self.rng.uniform(0.94, 1.06)
            f.body[i, j] = hexc(body) * self.rng.uniform(0.94, 1.06)

    def speck(self, count: float, col: int, where=None, size: int = 1) -> None:
        f = self.f
        n = f.n
        for i, j in self.cells(count, where):
            c = hexc(col) * self.rng.uniform(0.94, 1.06)
            for k in range(size):
                f.ground[(i + k) % n, (j + k) % n] = c

    def twig(self, count: float, col: int, where=None) -> None:
        f = self.f
        n = f.n
        for i, j in self.cells(count, where):
            di, dj = self.rng.choice(((1, 0), (0, 1), (1, 1)))
            c = hexc(col) * self.rng.uniform(0.9, 1.1)
            for k in range(self.rng.randint(3, 5)):
                f.ground[(i + di * k) % n, (j + dj * k) % n] = c


def ground_field(kind: str, period: int, frame: int = 0, frames: int = 1) -> Field:
    n = CELLS * period
    i, j = _grid(n)
    zero = np.zeros((n, n, 3))
    f = Field(n, zero.copy(), np.zeros((n, n), np.int64), zero.copy(), zero.copy())
    sc = Scatter(f, f"scatter:{kind}")
    if kind in ("grass", "meadow"):
        pat = quant(fbm(i, j, n, (32, 16, 8), 11), 6)
        g = ramp(pat, [(0.3, 0x4e8231), (0.5, 0x5c9136), (0.72, 0x6aa03c)])
        dry = pnoise(i, j, n, 32, 17)
        g = mix(g, 0x85983f, np.clip((dry - 0.66) * 4, 0, 0.45))
        if kind == "meadow":
            g = mix(g, 0x74a840, 0.2)
        f.ground = _jitter(g, i, j, 0.05, 3)
        sc.column(20 if kind == "grass" else 26, (1, 2), 0x84bb4a, 0x5a9234, tip2=0x76ad42)
        flowers = (0.9, 0.7, 0.0) if kind == "grass" else (4.5, 3.5, 2.5)
        sc.speck(flowers[0], 0xf2f0e2)
        sc.speck(flowers[1], 0xf4cc3c)
        if flowers[2]:
            sc.speck(flowers[2], 0xb486d0)
        sc.column(0.4, (1, 1), 0xa09a8a, 0x77705f)
    elif kind == "forest":
        pat = quant(fbm(i, j, n, (32, 16, 8), 21), 5)
        g = ramp(pat, [(0.3, 0x3c5624), (0.5, 0x48602a), (0.72, 0x566830)])
        lit = pnoise(i, j, n, 16, 23)
        g = mix(g, 0x6b5432, np.clip((lit - 0.55) * 3, 0, 0.75) * (hash01(i, j, 4) < 0.8))
        f.ground = _jitter(g, i, j, 0.07, 5)
        sc.column(9, (1, 2), 0x5c8e36, 0x3c6826, tip2=0x6a9a3c)
        sc.column(1.5, (1, 1), 0x948e80, 0x6c665a)
        sc.twig(3, 0x4a3420)
        sc.speck(2, 0x8a5a30)
    elif kind == "dirt":
        pat = quant(fbm(i, j, n, (32, 16, 8), 31), 5)
        g = ramp(pat, [(0.3, 0x7a5c3a), (0.5, 0x896a44), (0.72, 0x987752)])
        grassy = pnoise(i, j, n, 32, 33)
        g = mix(g, 0x6c7f3a, np.clip((grassy - 0.62) * 4, 0, 0.7) * (hash01(i, j, 6) < 0.75))
        f.ground = _jitter(g, i, j, 0.08, 7)
        sc.column(10, (1, 1), 0xa39a88, 0x76705f)
        sc.column(3, (1, 2), 0x7aa844, 0x557e30)
        sc.speck(6, 0x5e452c)
    elif kind == "sand":
        pat = quant(fbm(i, j, n, (32, 16), 41), 5)
        g = ramp(pat, [(0.3, 0xccb07a), (0.5, 0xd7bc86), (0.72, 0xe2c994)])
        warp = pnoise(i, j, n, 32, 43)
        rip = np.sin(2 * np.pi * (7 * (i + j) / n + warp * 1.3))
        g = mix(g, 0xbfa26c, (rip > 0.72) * 0.6)
        g = mix(g, 0xeedaa8, ((rip < -0.85) & (hash01(i, j, 8) < 0.6)) * 0.5)
        f.ground = _jitter(g, i, j, 0.04, 9)
        sc.speck(2.5, 0xf2e6cc)
        sc.column(1.2, (1, 1), 0xb8ab90, 0x8c8068)
    elif kind in ("stone", "rock"):
        pat = quant(fbm(i, j, n, (32, 16), 51), 4)
        g = ramp(pat, [(0.3, 0x6c644f), (0.5, 0x786e58), (0.72, 0x7f7a5c)])
        f.ground = _jitter(g, i, j, 0.12, 11)
        rock = fbm(i, j, n, (16, 8, 4), 53)
        slab = rock > 0.6
        tone = ramp(pnoise(i, j, n, 8, 55), [(0.0, 0x77736a), (0.5, 0x86817a), (1.0, 0x958f84)])
        tone = _jitter(tone, i, j, 0.06, 13)
        f.height = np.where(slab, 1 + (rock > 0.69), 0)
        f.tip = tone * 1.06
        f.body = tone * 0.9
        sc.column(5, (1, 2), 0x7ea646, 0x587d32, where=~slab)
        sc.speck(5, 0x4d473b, where=~slab)
    elif kind == "mud":
        pat = quant(fbm(i, j, n, (32, 16, 8), 61), 5)
        g = ramp(pat, [(0.3, 0x5c4a2e), (0.5, 0x695535), (0.72, 0x76613e)])
        wet = pnoise(i, j, n, 16, 63)
        puddle = wet > 0.64
        g = mix(g, 0x46392a, puddle * 0.8)
        g = np.where((puddle & (hash01(i, j, 10) > 0.95))[..., None], hexc(0x8d9590), g)
        ruts = np.abs(np.sin(2 * np.pi * (3 * i / n + pnoise(i, j, n, 32, 65) * 0.6))) < 0.06
        g = mix(g, 0x45391f, ruts * 0.7)
        f.ground = _jitter(g, i, j, 0.07, 15)
        sc.column(3, (1, 1), 0x7e7464, 0x5c5444, where=~puddle)
        sc.column(2, (1, 2), 0x6d8a3a, 0x4c6a2a, where=~puddle)
    elif kind in ("snow", "snow_forest"):
        pat = quant(fbm(i, j, n, (32, 16, 8), 71), 5)
        g = ramp(pat, [(0.3, 0xd5e1ec), (0.5, 0xe6eef5), (0.72, 0xf4f8fb)])
        f.ground = _jitter(g, i, j, 0.025, 17)
        f.ground = np.where((hash01(i, j, 12) > 0.988)[..., None], hexc(0xffffff), f.ground)
        drift = pnoise(i, j, n, 16, 73) > 0.7
        f.height = np.where(drift, 1, 0)
        f.tip = np.broadcast_to(hexc(0xf7fafd), (n, n, 3)).copy()
        f.body = np.broadcast_to(hexc(0xc6d4e4), (n, n, 3)).copy()
        if kind == "snow_forest":
            needles = pnoise(i, j, n, 16, 75) > 0.55
            f.ground = mix(f.ground, 0x6a6244, (needles & (hash01(i, j, 16) < 0.18)) * 0.8)
            sc.twig(4, 0x4a3a28)
            sc.column(2, (1, 2), 0x3e5a3a, 0x2c4430, where=f.height == 0)
        else:
            sc.column(0.6, (1, 1), 0x9a9a98, 0x6e7072, where=f.height == 0)
    elif kind == "packed_snow":
        pat = quant(fbm(i, j, n, (32, 16, 8), 81), 5)
        g = ramp(pat, [(0.3, 0xc5ccd3), (0.5, 0xd3d9df), (0.72, 0xdfe4e9)])
        dirt = pnoise(i, j, n, 16, 83)
        g = mix(g, 0x9c9588, np.clip((dirt - 0.6) * 4, 0, 0.6) * (hash01(i, j, 18) < 0.7))
        tracks = np.abs(np.sin(2 * np.pi * (2 * (i - j) / n + pnoise(i, j, n, 32, 85) * 0.5))) < 0.05
        g = mix(g, 0xa8b0ba, tracks * 0.7)
        f.ground = _jitter(g, i, j, 0.04, 19)
        sc.column(0.8, (1, 1), 0x8c8a86, 0x66645f)
    elif kind == "ice":
        pat = quant(fbm(i, j, n, (32, 16), 91), 5)
        g = ramp(pat, [(0.3, 0x8fc3d6), (0.5, 0xa3d1e2), (0.72, 0xb9dfec)])
        _f1, edge, _id = pvoronoi(i, j, n, 16, 93)
        g = mix(g, 0xeaf7fb, (edge < 0.9) * 0.85)
        g = np.where((hash01(i, j, 20) > 0.985)[..., None], hexc(0xffffff), g)
        f.ground = _jitter(g, i, j, 0.025, 21)
    elif kind in ("bridge_x", "bridge_y"):
        along, across = (i, j) if kind == "bridge_x" else (j, i)
        plank = along // 4
        tone = ramp(hash01(plank % (n // 4), 0, 23), [(0.0, 0x6a4b2e), (0.5, 0x7d5b38), (1.0, 0x936f48)])
        grain = 1 + (pnoise(across * 0.25, along, n, 4, 25) - 0.5) * 0.18
        g = tone * grain[..., None]
        g = mix(g, 0x2c2015, (along % 4 == 3) * 0.9)
        nails = (along % 4 == 1) & np.isin(across % 32, (3, 4, 27, 28)) & ((along + across) % 2 == 0)
        g = np.where(nails[..., None], hexc(0xa89a84), g)
        beam = np.isin(across % 32, (0, 1, 30, 31))
        g = np.where(beam[..., None], hexc(0x4c3622) * (1 + (hash01(i, j, 27) - 0.5) * 0.1)[..., None], g)
        f.ground = _jitter(g, i, j, 0.04, 29)
    elif kind in ("water", "water_shallow"):
        ph = 2 * np.pi * frame / max(1, frames)
        depth = quant(fbm(i, j, n, (32, 16), 101), 4)
        if kind == "water":
            g = ramp(depth, [(0.3, 0x1c4763), (0.5, 0x21506d), (0.72, 0x285b78)])
            crest_c, glint_c = 0x4a83a0, 0xa4cfe0
        else:
            g = ramp(depth, [(0.3, 0x37767f), (0.5, 0x42828b), (0.72, 0x4d8f93)])
            sand = pnoise(i, j, n, 16, 103)
            g = mix(g, 0x7f9c7a, np.clip((sand - 0.55) * 3, 0, 0.5))
            crest_c, glint_c = 0x86bec2, 0xd0eef0
        warp = pnoise(i, j, n, 32, 105) * 2 * np.pi
        w1 = np.sin(2 * np.pi * (2 * i + 1 * j) / n * 3 + warp + ph)
        w2 = np.sin(2 * np.pi * (1 * i - 2 * j) / n * 2 + warp * 0.7 - ph)
        crest = (w1 + w2 > 1.55) & (hash01(i, j, 30) < 0.75)
        g = mix(g, crest_c, crest * 0.75)
        glint = (hash01(i, j, 31 + frame) > 0.992) & (w1 > 0.2)
        g = np.where(glint[..., None], hexc(glint_c), g)
        f.ground = _jitter(g, i, j, 0.03, 33)
    else:
        raise ValueError(kind)
    return f


# ---------------------------------------------------------------------------
# Ray caster
# ---------------------------------------------------------------------------

Occ = Callable[[np.ndarray, np.ndarray, np.ndarray], np.ndarray]


def _frac0(x: np.ndarray) -> np.ndarray:
    return np.abs((x + 0.5) % 1.0 - 0.5) < 1e-6


def raycast(u: np.ndarray, v: np.ndarray, occ: Occ, layers: int, ground: bool):
    """Visible voxel per pixel ray (u, v at z = 0, ray (1, 1, 1) toward the eye).

    Returns (i, j, k, face, hit) with k = -1 for the ground top face,
    face 0 = top, 1 = left (+y), 2 = right (+x).
    """
    shape = u.shape
    hit = np.zeros(shape, bool)
    ri = np.floor(u).astype(np.int64)
    rj = np.floor(v).astype(np.int64)
    rk = np.full(shape, -1, np.int64)
    rf = np.zeros(shape, np.int64)
    for m in range(4 * layers - 1, -1, -1):
        t = (m + 0.5) * 0.25
        ci = np.floor(u + t).astype(np.int64)
        cj = np.floor(v + t).astype(np.int64)
        ck = np.full(shape, int(math.floor(t)), np.int64)
        new = occ(ci, cj, ck) & ~hit
        if not new.any():
            continue
        thi = (m + 1) * 0.25
        face = np.where(_frac0(np.full(shape, thi)), 0, np.where(_frac0(u + thi), 2, 1))
        ri = np.where(new, ci, ri)
        rj = np.where(new, cj, rj)
        rk = np.where(new, ck, rk)
        rf = np.where(new, face, rf)
        hit |= new
    if ground:
        hit[:] = True
    return ri, rj, rk, rf, hit


def shadowed(u, v, i, j, k, face, occ: Occ, layers: int) -> np.ndarray:
    """Sun ray from the centre of each visible face."""
    px = i + 0.5
    py = j + 0.5
    pz = k + 0.5
    px = np.where(face == 2, i + 1.0, px)
    py = np.where(face == 1, j + 1.0, py)
    pz = np.where(face == 0, k + 1.0, pz)
    out = np.zeros(np.shape(u), bool)
    for s in np.arange(0.35, (layers + 1.5) / SUN[2], 0.3):
        qx = px + SUN[0] * s
        qy = py + SUN[1] * s
        qz = pz + SUN[2] * s
        out |= occ(np.floor(qx).astype(np.int64), np.floor(qy).astype(np.int64), np.floor(qz).astype(np.int64)) & (qz >= 0)
    return out


def pixel_uv(xs: np.ndarray, ys: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Global pixel -> ground lattice coordinates (tile (0, 0) top corner at 0, 0)."""
    return ys + 0.5 + (xs + 0.5) / 2, ys + 0.5 - (xs + 0.5) / 2


def field_occ(f: Field) -> Occ:
    n = f.n

    def occ(i, j, k):
        return (k >= 0) & (k < f.height[i % n, j % n])

    return occ


def shade_field(f: Field, xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
    u, v = pixel_uv(xs, ys)
    layers = int(f.height.max()) + 1
    occ = field_occ(f)
    i, j, k, face, _hit = raycast(u, v, occ, layers, ground=True)
    n = f.n
    ii, jj = i % n, j % n
    top_layer = (k + 1) == f.height[ii, jj]
    col = np.where((k < 0)[..., None], f.ground[ii, jj], np.where(top_layer[..., None], f.tip[ii, jj], f.body[ii, jj]))
    col = col * LIGHT[face][..., None]
    sh = shadowed(u, v, i, j, k, face, occ, layers)
    col = np.where(sh[..., None], col * SHADOW, col)
    return col


# ---------------------------------------------------------------------------
# Tiles
# ---------------------------------------------------------------------------


def to8(rgb: np.ndarray, alpha: np.ndarray | None = None) -> np.ndarray:
    h, w = rgb.shape[:2]
    out = np.zeros((h, w, 4), np.uint8)
    out[..., :3] = np.clip(np.round(rgb * 255), 0, 255).astype(np.uint8)
    out[..., 3] = 255 if alpha is None else np.where(alpha, 255, 0)
    if alpha is not None:
        out[~alpha] = 0
    return out


def block_tiles(f: Field, period: int) -> dict[tuple[int, int], np.ndarray]:
    out = {}
    ys, xs = np.mgrid[0:FRAME_H, 0:FRAME_W]
    for gx in range(period):
        for gy in range(period):
            ox = 32 * (gx - gy) - ANCHOR[0]
            oy = 16 * (gx + gy) - BLEED_Y
            out[(gx, gy)] = to8(shade_field(f, xs + ox, ys + oy))
    return out


TERRAINS = [
    # name, kind, period, tileType, frames
    ("grass", "grass", 4, "GRASS", 1),
    ("meadow", "meadow", 4, "GRASS", 1),
    ("forest", "forest", 4, "FOREST", 1),
    ("dirt", "dirt", 4, "DIRT", 1),
    ("sand", "sand", 4, "SAND", 1),
    ("stone", "stone", 4, "STONE", 1),
    ("mud", "mud", 4, "MUD", 1),
    ("snow", "snow", 4, "SNOW", 1),
    ("snow_forest", "snow_forest", 4, "SNOW_FOREST", 1),
    ("packed_snow", "packed_snow", 4, "PACKED_SNOW", 1),
    ("ice", "ice", 4, "ICE", 1),
    ("bridge_x", "bridge_x", 2, "BRIDGE", 1),
    ("bridge_y", "bridge_y", 2, "BRIDGE", 1),
    ("water", "water", 2, "WATER", 4),
    ("water_shallow", "water_shallow", 2, "WATER_SHALLOW", 4),
]


# ---------------------------------------------------------------------------
# Cliff faces
# ---------------------------------------------------------------------------

CLIFFS = [
    # name, face colours (dark, mid, light), lip colour (None = no lip variant), lip tip
    ("earth", (0x6a4c30, 0x83603c, 0x9a744a), 0x6aa23c, 0x8cc24e),
    ("rock", (0x77705f, 0x8f8775, 0xa39b88), 0x6aa23c, 0x8cc24e),
    ("sand", (0xb0925e, 0xc4a670, 0xd4b882), None, None),
    ("snow", (0x6c7682, 0x848e9a, 0x9aa4b0), 0xeef4f9, 0xffffff),
]


def cliff_face(recipe: str, side: str, lip: bool) -> np.ndarray:
    """One 4 px step of the left (+y facing) or right (+x facing) face of a raised tile."""
    _name, (dark, mid, light), lip_c, lip_tip = next(c for c in CLIFFS if c[0] == recipe)
    fw, fh = TILE_W // 2, TILE_H // 2 + STEP_PX
    ys, xs = np.mgrid[0:fh, 0:fw]
    if side == "left":
        layer = ys - (xs + 1) // 2
    else:
        layer = ys - TILE_H // 2 + xs // 2
    inside = (layer >= 0) & (layer < STEP_PX)
    c = xs  # voxel column along the face
    seed = 7 if side == "left" else 9
    if recipe == "rock":
        # blocky courses: bricks 3-6 voxels wide, offset per layer
        off = (hash01(layer, 0, seed) * 6).astype(np.int64)
        block = (c + off) // 5
        t = hash01(block, layer, seed + 1)
        col = ramp(t, [(0.0, dark), (0.5, mid), (1.0, light)])
        joint = (c + off) % 5 == 0
        col = mix(col, 0x3a362f, joint * 0.55)
    else:
        t = 0.5 + (hash01(c, layer, seed) - 0.5) * 0.7
        t = t - (layer == STEP_PX - 1) * 0.18 + (layer == 0) * 0.1
        col = ramp(np.clip(t, 0, 1), [(0.0, dark), (0.5, mid), (1.0, light)])
        speck = hash01(c, layer, seed + 3) > 0.93
        col = mix(col, 0x9a907e if recipe == "earth" else light, speck * 0.6)
    if lip and lip_c is not None:
        drip = hash01(c, 0, seed + 5)
        green = (layer == 0) | ((layer == 1) & (drip < 0.35)) | ((layer == 2) & (drip < 0.06))
        g = mix(np.broadcast_to(hexc(lip_c), col.shape).copy(), lip_tip, (layer == 0) * (hash01(c, 1, seed) < 0.7) * 1.0)
        g = _jitter(g, c, layer, 0.05, seed + 7)
        col = np.where(green[..., None], g, col)
        # contact shade right under the overhang
        under = (~green) & (layer <= 2) & (np.roll(green, 1, axis=0))
        col = np.where(under[..., None], col * 0.8, col)
    col = col * LIGHT[1 if side == "left" else 2]
    return to8(col, inside)


# ---------------------------------------------------------------------------
# Transition masks and foam
# ---------------------------------------------------------------------------


def _frame_cells() -> tuple[np.ndarray, np.ndarray]:
    ys, xs = np.mgrid[0:FRAME_H, 0:FRAME_W]
    u, v = pixel_uv(xs - ANCHOR[0], ys - BLEED_Y)
    return np.floor(u).astype(np.int64), np.floor(v).astype(np.int64)


def _pn1(t: np.ndarray, seed: int) -> np.ndarray:
    r = np.random.default_rng(seed)
    acc = np.zeros_like(t)
    for k in (1, 2, 3, 5):
        acc += r.uniform(0.3, 1.0) / k * np.sin(2 * np.pi * k * t + r.uniform(0, 6.28))
    return acc / 1.3


def transition_alpha() -> dict[str, np.ndarray]:
    """Binary per-voxel masks: True = draw the neighbour's ground here."""
    ci, cj = _frame_cells()
    u = (ci + 0.5) / CELLS
    v = (cj + 0.5) / CELLS
    dither = hash01(ci, cj, 77) - 0.5
    out: dict[str, np.ndarray] = {}

    def edge(dist: np.ndarray, along: np.ndarray, seed: int) -> np.ndarray:
        t = np.clip(along, 0.0, 1.0)
        depth = 0.2 * np.sin(np.pi * t) * (0.55 + 0.45 * np.clip(_pn1(t, seed), -1, 1))
        return dist + dither * 0.08 < depth + 0.06

    edges = {"edge_px": (1 - u, v), "edge_mx": (u, v), "edge_py": (1 - v, u), "edge_my": (v, u)}
    for idx, (k, (dist, along)) in enumerate(edges.items()):
        for nvar in range(EDGE_VARIANTS):
            out[f"{k}.{nvar}"] = edge(dist, along, 100 + 10 * idx + nvar)
    corners = {"corner_px_py": (1 - u, 1 - v), "corner_px_my": (1 - u, v), "corner_mx_py": (u, 1 - v), "corner_mx_my": (u, v)}
    for idx, (k, (du, dv)) in enumerate(corners.items()):
        du = np.maximum(du, 0.0)
        dv = np.maximum(dv, 0.0)
        d = np.hypot(du, dv)
        depth = 0.12 + 0.05 * np.clip(_pn1(np.arctan2(dv, du) / (np.pi / 2), 200 + idx), -1, 1)
        out[k] = d + dither * 0.08 < depth
    return out


def foam_ring(mask: np.ndarray, frame: int) -> tuple[np.ndarray, np.ndarray]:
    """Foam just outside a mask, on the water side, per voxel: (rgb, alpha)."""
    ci, cj = _frame_cells()
    # dilate on the voxel lattice: neighbours along i and j (one voxel = one cell step)
    lut: dict[tuple[int, int], bool] = {}
    for a, b, m in zip(ci.ravel(), cj.ravel(), mask.ravel()):
        if m:
            lut[(int(a), int(b))] = True

    # dilate on the visible lattice (i - j even): one brick step on screen is
    # (+-1, +-1) in cells
    ring1 = ((1, 1), (1, -1), (-1, 1), (-1, -1))
    ring2 = ((2, 2), (2, 0), (0, 2), (2, -2), (0, -2), (-2, 2), (-2, 0), (-2, -2))

    def near(offsets) -> np.ndarray:
        out = np.zeros(mask.shape, bool)
        for di, dj in offsets:
            out |= np.vectorize(lambda a, b: (a + di, b + dj) in lut)(ci, cj)
        return out

    n1 = near(ring1) & ~mask
    n2 = near(ring2) & ~mask & ~n1
    gap = hash01(ci, cj, 300 + frame)
    inner = n1 & (gap < (0.92 if frame == 0 else 0.7))
    outer = n2 & (gap < (0.25 if frame == 0 else 0.55))
    rgb = np.where(inner[..., None], hexc(0xe4f2f4), hexc(0x9fcad6))
    alpha = np.where(inner, 230, np.where(outer, 150, 0)).astype(np.uint8)
    return rgb, alpha


def edge_shade() -> dict[str, np.ndarray]:
    """Elevation accents per tile edge, drawn over the tile (source-atop).

    ao_mx / ao_my: contact shade on a lower tile along its back edges where
    the neighbour behind is higher (at the cliff foot). rim_px / rim_py: lit
    rim on the front edges of a raised tile, above its cliff faces.
    """
    ci, cj = _frame_cells()
    out = {}
    for key, ring, rgb, alphas in (
        ("ao_mx", ci, 0x101820, (110, 60)),
        ("ao_my", cj, 0x101820, (110, 60)),
        ("rim_px", CELLS - 1 - ci, 0xfff6d8, (70, 0)),
        ("rim_py", CELLS - 1 - cj, 0xfff6d8, (70, 0)),
    ):
        a = np.where(ring <= 1, alphas[0], np.where(ring <= 3, alphas[1], 0))
        a = np.where(ring < 0, 0, a)
        img = np.zeros((FRAME_H, FRAME_W, 4), np.uint8)
        img[..., :3] = (hexc(rgb) * 255).astype(np.uint8)
        img[..., 3] = a.astype(np.uint8)
        img[a == 0] = 0
        out[key] = img
    return out


# ---------------------------------------------------------------------------
# Bridge rails
# ---------------------------------------------------------------------------


def rail(edge: str) -> np.ndarray:
    """Posts and a top beam along one tile edge (an overlay above the deck)."""
    fh = FRAME_H + RAIL_H
    ys, xs = np.mgrid[0:fh, 0:FRAME_W]
    u, v = pixel_uv(xs - ANCHOR[0], ys - BLEED_Y - RAIL_H)
    last = CELLS - 1

    def occ(i, j, k):
        along, across = (i, j) if edge in ("py", "my") else (j, i)
        line = across == (last if edge in ("py", "px") else 0)
        inside = (along >= 0) & (along < CELLS) & line
        post = ((along % 8) < 2) & (k >= 0) & (k < 7)
        beam = (k >= 5) & (k < 7)
        return inside & (post | beam)

    i, j, k, face, hit = raycast(u, v, occ, 8, ground=False)
    along = np.where(np.isin(edge, ("py", "my")), i, j)
    wood = ramp(hash01(along // 2, k, 41), [(0.0, 0x5a3f26), (0.5, 0x6c4c2e), (1.0, 0x7e5a36)])
    wood = np.where(((along % 8) < 2)[..., None] & (k < 5)[..., None], wood * 0.82, wood)
    col = wood * LIGHT[face][..., None]
    return to8(col, hit)


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------


def render(out_dir: str, only: str | None, write_png: Writer) -> list[dict]:
    records: list[dict] = []
    keys = [k.strip() for k in only.split(",")] if only else None

    def want(n: str) -> bool:
        return keys is None or any(k in n for k in keys)

    def rec(name: str, img: np.ndarray, anchor, meta: dict) -> None:
        path = os.path.join(out_dir, name + ".png")
        write_png(path, img)
        records.append({"name": name, "width": int(img.shape[1]), "height": int(img.shape[0]), "anchor": list(anchor),
                        "footprint": [1, 1], "files": {"frame": path}, "meta": meta})

    for name, kind, period, tile_type, frames in TERRAINS:
        if not want(f"terrain_{name}"):
            continue
        for frame in range(frames):
            f = ground_field(kind, period, frame, frames)
            for (gx, gy), img in sorted(block_tiles(f, period).items()):
                idx = gx + period * gy
                fname = f"terrain_{name}_{idx:02d}" + (f"_f{frame}" if frames > 1 else "")
                variant = str(idx) if frames == 1 else f"{idx}.{frame}"
                rec(fname, img, ANCHOR, {"asset": f"terrain.{name}", "variant": variant, "kind": "terrain",
                                         "tileType": tile_type, "period": period, "frameIndex": frame})
            print(f"rendered terrain {name} frame {frame}")
    for recipe, _cols, lip_c, _tip in CLIFFS:
        for side in ("left", "right"):
            for lip in (False, True):
                if lip and lip_c is None:
                    continue
                fname = f"cliff_{recipe}_{side}" + ("_lip" if lip else "")
                if not want(fname):
                    continue
                img = cliff_face(recipe, side, lip)
                rec(fname, img, [TILE_W // 2, TILE_H // 2] if side == "left" else [0, TILE_H // 2],
                    {"asset": f"terrain.cliff_{recipe}", "variant": side + ("_lip" if lip else ""), "kind": "cliff",
                     "stepPx": STEP_PX})
    masks = transition_alpha() if (want("transition") or want("foam")) else {}
    if want("transition"):
        for k, m in masks.items():
            img = np.zeros((FRAME_H, FRAME_W, 4), np.uint8)
            img[..., :3] = 255
            img[..., 3] = np.where(m, 255, 0)
            rec("transition_" + k.replace(".", "_"), img, ANCHOR,
                {"asset": "terrain.transition", "variant": k, "kind": "transition_mask"})
    if want("foam"):
        for k, m in masks.items():
            for fr in range(FOAM_FRAMES):
                rgb, alpha = foam_ring(m, fr)
                img = to8(rgb)
                img[..., 3] = alpha
                img[alpha == 0] = 0
                rec(f"foam_{k.replace('.', '_')}_f{fr}", img, ANCHOR,
                    {"asset": "terrain.foam", "variant": f"{k}.{fr}", "kind": "foam"})
    if want("edge"):
        for k, img in edge_shade().items():
            rec(f"edge_{k}", img, ANCHOR, {"asset": "terrain.edge", "variant": k, "kind": "overlay"})
    if want("bridge_rail"):
        for edge in ("px", "mx", "py", "my"):
            img = rail(edge)
            rec(f"bridge_rail_{edge}", img, [ANCHOR[0], ANCHOR[1] + RAIL_H],
                {"asset": "terrain.bridge_rail", "variant": edge, "kind": "overlay"})
    return records


if __name__ == "__main__":
    import sys

    from PIL import Image

    def _write(path: str, img: np.ndarray) -> None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        Image.fromarray(img).save(path)

    recs = render(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None, _write)
    print(len(recs), "frames")
