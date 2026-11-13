"""Small shaded pixel-art painter for the HUD icons (scripts/ui/gen_icons.py).

An icon is a list of primitives in design units (one unit = one pixel of the
1x icon). The painter rasterises them at scale 1 or 2 by sampling pixel
centres, shades every primitive with one sun from the top left (the same
light as the UI skin and the style A world), snaps the result onto short
colour ramps from a shared palette and draws a dark outline around the
silhouette. Strokes and outlines are `scale` pixels wide, so the @2x sheet is
the 1x art with smoother curves and finer shading, never thinner lines.

Everything is deterministic: no randomness at all.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable

import numpy as np

from pixkit import hexc

# Sun from the top left, a little toward the viewer.
LIGHT = np.array([-0.55, -0.68, 0.48])
LIGHT = LIGHT / np.linalg.norm(LIGHT)

OUTLINE = '#120a05'

# Colour ramps, darkest first. Shared by every icon so the set reads as one family.
RAMPS: dict[str, list[str]] = {
    'gold': ['#4a2806', '#7c4a0a', '#b67a12', '#e2aa28', '#f7d65e', '#fff4b4'],
    'wheat': ['#5c3a10', '#8c6218', '#c09026', '#e4bc46', '#f5db7e', '#fff3c6'],
    'bark': ['#24130a', '#3f2412', '#5e3a1e', '#7e522c', '#9c6a3c'],
    'cut': ['#6e4a26', '#9a7244', '#c49e6a', '#e2c592', '#f6e4bc'],
    'wood': ['#2e1a0c', '#4f3018', '#734824', '#9a6634', '#be8a4e', '#dcae74'],
    'stone': ['#25231f', '#433f39', '#635e56', '#88827a', '#aea89c', '#d6cfc0'],
    'steel': ['#1c1f26', '#343a44', '#56606c', '#828e9c', '#b4bec9', '#e8eef3'],
    'iron': ['#141518', '#25272c', '#3a3d44', '#55585f', '#74777e'],
    'leather': ['#23130a', '#40240f', '#61381b', '#854f27', '#a66a38'],
    'red': ['#2a0907', '#561310', '#8a1e17', '#ba3222', '#de5838', '#f48c70'],
    'blue': ['#0a172e', '#12325e', '#1d5394', '#2e7fd2', '#62aaea', '#b4d8f8'],
    'skin': ['#4a291a', '#844c32', '#bf7c58', '#e4a87e', '#f6cca8'],
    'hair': ['#1e120a', '#3a2214', '#5a3820', '#7c5230'],
    'linen': ['#4e4030', '#857256', '#b8a27c', '#dccaa4', '#f2e6cc'],
    'green': ['#0f1d0b', '#203c17', '#365e24', '#548634', '#7eac4c'],
    'glass': ['#2a3a44', '#4c6470', '#7e98a2', '#b4c8cc', '#e6f0f0'],
    'sand': ['#6a4614', '#9a6c20', '#c8982e', '#e8c058', '#f8de8c'],
    'ember': ['#5a1406', '#a8300a', '#e86414', '#ffb030', '#fff0a0'],
    'white': ['#6a645a', '#a49e92', '#d2ccc0', '#f0ece2', '#ffffff'],
}


@dataclass
class Prim:
    sdf: Callable[[np.ndarray, np.ndarray], np.ndarray]
    ramp: str
    shade: str = 'flat'  # flat | sphere | cyl | bevel | none
    level: float = 0.6  # base brightness for flat / none, 0..1
    bias: float = 0.0  # added to the lit value
    seg: tuple[float, float, float, float, float, float] | None = None  # cylinder ax, ay, bx, by, ra, rb
    centre: tuple[float, float, float, float] | None = None  # sphere cx, cy, rx, ry
    bevel: float = 1.2  # bevel width in design units
    edge: bool = False  # draw a dark seam where it sits on earlier shapes
    edge_color: str | None = None
    clip: Callable[[np.ndarray, np.ndarray], np.ndarray] | None = None


@dataclass
class Icon:
    size: int | tuple[int, int]
    prims: list[Prim] = field(default_factory=list)
    outline: bool = True
    # pixels to colour after shading: (fn(x, y) -> mask, colour)
    details: list[tuple[Callable[[np.ndarray, np.ndarray], np.ndarray], str]] = field(default_factory=list)

    @property
    def wh(self) -> tuple[int, int]:
        return (self.size, self.size) if isinstance(self.size, int) else self.size

    def add(self, p: Prim) -> Prim:
        self.prims.append(p)
        return p

    # -- primitive helpers (all coordinates in design units) ---------------------
    def ellipse(self, cx, cy, rx, ry, ramp, shade='sphere', rot=0.0, **kw) -> Prim:
        sdf = sdf_ellipse(cx, cy, rx, ry, rot)
        return self.add(Prim(sdf, ramp, shade, centre=(cx, cy, rx, ry), **kw))

    def circle(self, cx, cy, r, ramp, shade='sphere', **kw) -> Prim:
        return self.ellipse(cx, cy, r, r, ramp, shade, **kw)

    def capsule(self, a, b, r, ramp, shade='cyl', rb=None, **kw) -> Prim:
        seg = (a[0], a[1], b[0], b[1], r, r if rb is None else rb)
        return self.add(Prim(sdf_capsule(a, b, r, rb), ramp, shade, seg=seg, **kw))

    def poly(self, pts, ramp, shade='bevel', **kw) -> Prim:
        return self.add(Prim(sdf_poly(pts), ramp, shade, **kw))

    def rect(self, x0, y0, x1, y1, ramp, shade='bevel', **kw) -> Prim:
        return self.poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], ramp, shade, **kw)

    def detail(self, fn, color: str) -> None:
        self.details.append((fn, color))


# ---------------------------------------------------------------------------
# signed distance functions (negative inside), in design units
# ---------------------------------------------------------------------------

def sdf_ellipse(cx, cy, rx, ry, rot=0.0):
    c, s = math.cos(rot), math.sin(rot)

    def f(x, y):
        dx, dy = x - cx, y - cy
        u = dx * c + dy * s
        v = -dx * s + dy * c
        k = np.sqrt((u / rx) ** 2 + (v / ry) ** 2)
        return (k - 1.0) * min(rx, ry)
    return f


def sdf_capsule(a, b, r, rb=None):
    ax, ay = a
    bx, by = b
    rb = r if rb is None else rb

    def f(x, y):
        pax, pay = x - ax, y - ay
        bax, bay = bx - ax, by - ay
        h = np.clip((pax * bax + pay * bay) / max(1e-9, bax * bax + bay * bay), 0, 1)
        d = np.hypot(pax - bax * h, pay - bay * h)
        return d - (r + (rb - r) * h)
    return f


def sdf_poly(pts):
    P = np.array(pts, float)

    def f(x, y):
        d = np.full(x.shape, np.inf)
        sgn = np.ones(x.shape)
        n = len(P)
        for i in range(n):
            ax, ay = P[i]
            bx, by = P[(i + 1) % n]
            ex, ey = bx - ax, by - ay
            wx, wy = x - ax, y - ay
            h = np.clip((wx * ex + wy * ey) / max(1e-9, ex * ex + ey * ey), 0, 1)
            dd = np.hypot(wx - ex * h, wy - ey * h)
            d = np.minimum(d, dd)
            c1 = y >= ay
            c2 = y < by
            c3 = ex * wy > ey * wx
            flip = (c1 & c2 & c3) | (~c1 & ~c2 & ~c3)
            sgn = np.where(flip, -sgn, sgn)
        return d * sgn
    return f


def hash01(x: np.ndarray, y: np.ndarray, seed: int = 0, cell: float = 1.0) -> np.ndarray:
    """Deterministic 0..1 noise per design-unit cell."""
    ix = np.floor(x / cell).astype(np.int64)
    iy = np.floor(y / cell).astype(np.int64)
    h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFF) / 65535.0


def sdf_union(*fs):
    def f(x, y):
        return np.minimum.reduce([g(x, y) for g in fs])
    return f


def sdf_sub(a, b):
    def f(x, y):
        return np.maximum(a(x, y), -b(x, y))
    return f


def sdf_ring(cx, cy, r, w, a0=None, a1=None):
    """Annulus of radius r and half width w; optional arc a0..a1 (radians, screen y down)."""
    def f(x, y):
        d = np.abs(np.hypot(x - cx, y - cy) - r) - w
        if a0 is not None:
            ang = np.arctan2(y - cy, x - cx)
            span = (a1 - a0) % (2 * math.pi)
            t = (ang - a0) % (2 * math.pi)
            # outside the arc: distance to the nearer end cap, so bevels stay sane
            ends = []
            for a in (a0, a1):
                ex, ey = cx + r * math.cos(a), cy + r * math.sin(a)
                ends.append(np.hypot(x - ex, y - ey) - w)
            d = np.where(t <= span, d, np.maximum(np.minimum(*ends), 0.01))
        return d
    return f


# ---------------------------------------------------------------------------
# rendering
# ---------------------------------------------------------------------------

def _grid(w: int, h: int, scale: int):
    ys, xs = np.mgrid[0:h * scale, 0:w * scale].astype(float)
    return (xs + 0.5) / scale, (ys + 0.5) / scale


def _lit(normal_x, normal_y, normal_z) -> np.ndarray:
    return normal_x * LIGHT[0] + normal_y * LIGHT[1] + normal_z * LIGHT[2]


def _shade(p: Prim, x, y, d) -> np.ndarray:
    """0..1 brightness for the pixels of one primitive."""
    if p.shade == 'none':
        return np.full(x.shape, p.level)
    if p.shade == 'sphere' and p.centre:
        cx, cy, rx, ry = p.centre
        u = np.clip((x - cx) / rx, -1, 1)
        v = np.clip((y - cy) / ry, -1, 1)
        k = np.clip(u * u + v * v, 0, 1)
        nz = np.sqrt(1 - k)
        lit = _lit(u, v, nz)
    elif p.shade == 'cyl' and p.seg:
        ax, ay, bx, by, ra, rb = p.seg
        ex, ey = bx - ax, by - ay
        n = math.hypot(ex, ey) or 1.0
        ux, uy = ex / n, ey / n
        px_, py_ = -uy, ux  # across the cylinder
        h = np.clip(((x - ax) * ux + (y - ay) * uy) / n, 0, 1)
        r = ra + (rb - ra) * h
        t = np.clip(((x - ax) * px_ + (y - ay) * py_) / np.maximum(r, 1e-6), -1, 1)
        nz = np.sqrt(np.clip(1 - t * t, 0, 1))
        lit = _lit(px_ * t, py_ * t, nz)
    else:  # flat / bevel
        lit = np.full(x.shape, _lit(0, 0, 1))
        if p.shade == 'bevel':
            # numeric gradient of the sdf = outward normal of the nearest edge
            e = 0.25
            gx = p.sdf(x + e, y) - p.sdf(x - e, y)
            gy = p.sdf(x, y + e) - p.sdf(x, y - e)
            gn = np.hypot(gx, gy) + 1e-9
            gx, gy = gx / gn, gy / gn
            depth = np.clip(-d, 0, None)
            k = np.clip(1 - depth / p.bevel, 0, 1)
            # bevel tilts the face toward its edge
            nx, ny = gx * k * 0.85, gy * k * 0.85
            nz = np.sqrt(np.clip(1 - nx * nx - ny * ny, 0, 1))
            lit = _lit(nx, ny, nz)
        else:
            return np.full(x.shape, p.level)
    # map lit (-1..1) to 0..1 around the base level
    v = p.level + (lit - _lit(0, 0, 1)) * 0.9 + p.bias
    return np.clip(v, 0, 1)


def _shift(m: np.ndarray, dy: int, dx: int) -> np.ndarray:
    out = np.zeros_like(m)
    h, w = m.shape
    ys = slice(max(dy, 0), h + min(dy, 0))
    yd = slice(max(-dy, 0), h + min(-dy, 0))
    xs = slice(max(dx, 0), w + min(dx, 0))
    xd = slice(max(-dx, 0), w + min(-dx, 0))
    out[ys, xs] = m[yd, xd]
    return out


def dilate(m: np.ndarray, r: int, diag: bool = False) -> np.ndarray:
    out = m.copy()
    for _ in range(r):
        n = out.copy()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)) + (((1, 1), (1, -1), (-1, 1), (-1, -1)) if diag else ()):
            n |= _shift(out, dy, dx)
        out = n
    return out


def render(icon: Icon, scale: int) -> np.ndarray:
    w, h = icon.wh
    x, y = _grid(w, h, scale)
    H, W = x.shape
    rgba = np.zeros((H, W, 4), np.uint8)
    pid = np.full((H, W), -1, int)
    for i, p in enumerate(icon.prims):
        d = p.sdf(x, y)
        inside = d < 0
        if p.clip is not None:
            inside &= p.clip(x, y) < 0
        if not inside.any():
            continue
        if p.edge:
            band = dilate(inside, scale) & ~inside & (pid >= 0)
            rgba[band] = hexc(p.edge_color or OUTLINE)
        v = _shade(p, x, y, d)
        ramp = RAMPS[p.ramp]
        idx = np.clip(np.floor(v * len(ramp)).astype(int), 0, len(ramp) - 1)
        cols = np.stack([hexc(c) for c in ramp])
        rgba[inside] = cols[idx[inside]]
        pid[inside] = i
    for fn, col in icon.details:
        m = fn(x, y) & (rgba[..., 3] > 0)
        rgba[m] = hexc(col)
    if icon.outline:
        solid = rgba[..., 3] > 0
        ring = dilate(solid, scale) & ~solid
        rgba[ring] = hexc(OUTLINE)
    return rgba


def drop_shadow(rgba: np.ndarray, scale: int, alpha: int = 110) -> np.ndarray:
    """A hard one-texel shadow to the bottom right (light is top left)."""
    solid = rgba[..., 3] > 0
    sh = _shift(solid, scale, scale) & ~solid
    out = rgba.copy()
    out[sh] = np.array([8, 5, 2, alpha], np.uint8)
    return out
