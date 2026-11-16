"""Building icons for gen_icons.py: one bold symbol per building (a bell for
the town center, crossed pikes for the barracks, ...), not a miniature of the
building. Each symbol is hand-placed pixel art on the 15 x 15 texel grid of a
HUD socket, kept as a crisp-edged SVG of 1-texel <rect>s in building-symbols/
(the source of truth: edit those, then re-run gen_icons.py).

A symbol is the same in every age, so there are no .castle / .gunpowder
variants; eraIcon() falls back to the plain name.
"""
from __future__ import annotations

import os
import re

import numpy as np

SYMBOL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'building-symbols')
GRID = 15
RECT = re.compile(r'<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" fill="#([0-9a-fA-F]{6})"/>')


def _grid(path: str) -> np.ndarray:
    """The 15 x 15 RGBA texel grid of a symbol SVG."""
    with open(path, encoding='utf-8') as f:
        src = f.read()
    assert 'viewBox="0 0 15 15"' in src, f'{path}: expected a 15 x 15 viewBox'
    grid = np.zeros((GRID, GRID, 4), np.uint8)
    rects = RECT.findall(src)
    assert rects, f'{path}: no texel rects'
    for x, y, w, h, hexcol in rects:
        x, y, w, h = int(x), int(y), int(w), int(h)
        rgb = [int(hexcol[i:i + 2], 16) for i in (0, 2, 4)]
        grid[y:y + h, x:x + w] = [*rgb, 255]
    return grid


def building_icons() -> dict[str, dict[int, np.ndarray]]:
    """b-<building> at both sheet scales: 2 px per texel at 1x, 4 px at 2x."""
    icons: dict[str, dict[int, np.ndarray]] = {}
    for fname in sorted(os.listdir(SYMBOL_DIR)):
        if not fname.endswith('.svg'):
            continue
        grid = _grid(os.path.join(SYMBOL_DIR, fname))
        icons[fname[:-4]] = {s: np.repeat(np.repeat(grid, 2 * s, 0), 2 * s, 1) for s in (1, 2)}
    return icons
