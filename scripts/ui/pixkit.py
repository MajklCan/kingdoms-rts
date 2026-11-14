"""Tiny deterministic pixel-art helpers (PIL + numpy) shared by the UI generators.

Every texture is drawn at 1x (one texel per pixel) and shown in the game at
an integer scale (`--px` in src/ui/skin/pixel-scale.ts), so edges stay crisp.
All randomness is seeded, so re-running a generator reproduces the same files.
"""
from __future__ import annotations

import numpy as np
from PIL import Image

BAYER4 = (np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) + 0.5) / 16.0


def hexc(h: str) -> np.ndarray:
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)] + [255], dtype=np.uint8)


def canvas(w: int, h: int, color: str | None = None) -> np.ndarray:
    a = np.zeros((h, w, 4), dtype=np.uint8)
    if color is not None:
        a[:, :] = hexc(color)
    return a


def save(a: np.ndarray, path: str) -> None:
    Image.fromarray(a).save(path, optimize=True)


def value_noise(w: int, h: int, cx: int, cy: int, seed: int) -> np.ndarray:
    """Tileable smooth value noise; w % cx == 0 and h % cy == 0 for a clean wrap."""
    rng = np.random.default_rng(seed)
    gx, gy = max(1, w // cx), max(1, h // cy)
    g = rng.random((gy, gx))
    xs = np.arange(w) / cx
    ys = np.arange(h) / cy
    x0 = np.floor(xs).astype(int)
    y0 = np.floor(ys).astype(int)
    fx = xs - x0
    fy = ys - y0
    fx = fx * fx * (3 - 2 * fx)
    fy = fy * fy * (3 - 2 * fy)
    x1 = (x0 + 1) % gx
    y1 = (y0 + 1) % gy
    x0 %= gx
    y0 %= gy
    a = g[np.ix_(y0, x0)]
    b = g[np.ix_(y0, x1)]
    c = g[np.ix_(y1, x0)]
    d = g[np.ix_(y1, x1)]
    top = a + (b - a) * fx[None, :]
    bot = c + (d - c) * fx[None, :]
    return top + (bot - top) * fy[:, None]


def fbm(w: int, h: int, cx: int, cy: int, seed: int, octaves: int = 3) -> np.ndarray:
    total = np.zeros((h, w))
    amp = 1.0
    norm = 0.0
    for o in range(octaves):
        sx = max(1, cx >> o)
        sy = max(1, cy >> o)
        total += amp * value_noise(w, h, sx, sy, seed + o * 101)
        norm += amp
        amp *= 0.5
    return total / norm


def quantize(field: np.ndarray, ramp: list[str], dither: float = 0.6) -> np.ndarray:
    """Map a 0..1 field onto a colour ramp with ordered (Bayer) dithering."""
    h, w = field.shape
    f = (field - field.min()) / max(1e-9, field.max() - field.min())
    n = len(ramp)
    b = np.tile(BAYER4, (h // 4 + 1, w // 4 + 1))[:h, :w]
    idx = np.floor(f * (n - 1) + (b - 0.5) * dither + 0.5).astype(int)
    idx = np.clip(idx, 0, n - 1)
    cols = np.stack([hexc(c) for c in ramp])
    return cols[idx]


def ring(a: np.ndarray, inset: int, tl: str, br: str) -> None:
    """1px rectangle ring at `inset`: top/left in tl, bottom/right in br."""
    h, w = a.shape[:2]
    x0, y0, x1, y1 = inset, inset, w - 1 - inset, h - 1 - inset
    if x1 < x0 or y1 < y0:
        return
    a[y0, x0:x1 + 1] = hexc(tl)
    a[y0:y1 + 1, x0] = hexc(tl)
    a[y1, x0:x1 + 1] = hexc(br)
    a[y0:y1 + 1, x1] = hexc(br)


def rect(a: np.ndarray, x: int, y: int, w: int, h: int, color: str) -> None:
    a[y:y + h, x:x + w] = hexc(color)


def px(a: np.ndarray, x: int, y: int, color: str) -> None:
    if 0 <= y < a.shape[0] and 0 <= x < a.shape[1]:
        a[y, x] = hexc(color)


def clear_corners(a: np.ndarray, r: int = 1) -> None:
    """Pixel-round the four outer corners (transparent)."""
    h, w = a.shape[:2]
    pts = [(0, 0)]
    if r >= 2:
        pts += [(1, 0), (0, 1)]
    for (x, y) in pts:
        for (xx, yy) in [(x, y), (w - 1 - x, y), (x, h - 1 - y), (w - 1 - x, h - 1 - y)]:
            a[yy, xx] = 0


def paste(a: np.ndarray, b: np.ndarray, x: int = 0, y: int = 0) -> None:
    """Alpha-over paste of b (binary alpha) onto a at (x, y)."""
    h, w = b.shape[:2]
    region = a[y:y + h, x:x + w]
    m = b[..., 3:4] > 0
    region[:] = np.where(m, b, region)


def stamp(a: np.ndarray, pattern: list[str], x: int, y: int, palette: dict[str, str]) -> None:
    """Paint an ASCII pattern; each char maps to a colour, others are skipped."""
    for j, row in enumerate(pattern):
        for i, ch in enumerate(row):
            if ch in palette:
                px(a, x + i, y + j, palette[ch])


def erode(mask: np.ndarray) -> np.ndarray:
    m = mask.copy()
    m[1:, :] &= mask[:-1, :]
    m[:-1, :] &= mask[1:, :]
    m[:, 1:] &= mask[:, :-1]
    m[:, :-1] &= mask[:, 1:]
    m[0, :] = False
    m[-1, :] = False
    m[:, 0] = False
    m[:, -1] = False
    return m


def shade_mask(a: np.ndarray, mask: np.ndarray, fill: str, light: str, dark: str, outline: str,
               fill_arr: np.ndarray | None = None) -> None:
    """Draw an arbitrary shape lit from the top-left: outline, rim light, rim shadow."""
    inner = erode(mask)
    edge = mask & ~inner
    core = erode(inner)
    rim = inner & ~core
    if fill_arr is not None:
        a[inner] = fill_arr[inner]
    else:
        a[inner] = hexc(fill)
    up = np.zeros_like(mask)
    up[1:, :] = ~inner[:-1, :]
    left = np.zeros_like(mask)
    left[:, 1:] = ~inner[:, :-1]
    down = np.zeros_like(mask)
    down[:-1, :] = ~inner[1:, :]
    right = np.zeros_like(mask)
    right[:, :-1] = ~inner[:, 1:]
    a[rim & (up | left)] = hexc(light)
    a[rim & (down | right) & ~(up | left)] = hexc(dark)
    a[edge] = hexc(outline)


def disc(w: int, h: int, cx: float, cy: float, r: float) -> np.ndarray:
    yy, xx = np.mgrid[0:h, 0:w]
    return (xx + 0.5 - cx) ** 2 + (yy + 0.5 - cy) ** 2 <= r * r


def contact_sheet(paths: list[str], out: str, scale: int = 4, width: int = 1600) -> None:
    """Preview every texture at `scale` on a grass-green ground."""
    tiles = []
    for p in paths:
        im = Image.open(p).convert('RGBA')
        tiles.append(im.resize((im.width * scale, im.height * scale), Image.NEAREST))
    x = y = rowh = 0
    pos = []
    for t in tiles:
        if x + t.width > width:
            x = 0
            y += rowh + 8
            rowh = 0
        pos.append((x, y))
        x += t.width + 8
        rowh = max(rowh, t.height)
    sheet = Image.new('RGBA', (width, y + rowh), (70, 128, 52, 255))
    for t, p in zip(tiles, pos):
        sheet.alpha_composite(t, p)
    sheet.save(out)
