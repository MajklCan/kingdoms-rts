"""HUD icon sheets: coloured, shaded pixel-art icons for the resource bar,
the command grid, the production queue, the tech tree and the selection
sheet.

    resources (20, and 16 for inline costs): icons_resources.py
    commands, tech and stats (30 / 16):       icons_commands.py, drawn with iconkit.py
    buildings and units (30):                 icon_pictures.py, from the style A atlas
                                              and the voxel unit puppets

Each icon is rendered twice, at 1x (one pixel per half texel, so a 30 px icon
fills 15 texels of the HUD) and at 2x with real extra detail, and packed into
one sheet per scale with the same layout. The CSS picks the sheet by the
texel size (`data-texel` on <html>, src/ui/skin/pixel-scale.ts).

Run from the repo root (plain Python 3 with numpy and Pillow):
    python3 scripts/ui/gen_icons.py [--sheet /path/to/preview.png]

Output:
    public/assets/ui/icons/icons.png, icons@2x.png
    src/ui/icons/raster-icons.ts (generated frame table)
Deterministic: re-running rewrites the same files.
"""
from __future__ import annotations

import argparse
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from iconkit import render  # noqa: E402
from icon_pictures import building_icons, unit_icons  # noqa: E402
from icons_commands import COMMAND_ICONS, STAT_ICONS  # noqa: E402
from icons_resources import RESOURCE_ICONS  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT_DIR = os.path.join(ROOT, 'public', 'assets', 'ui', 'icons')
TS_OUT = os.path.join(ROOT, 'src', 'ui', 'icons', 'raster-icons.ts')
SHEET_W = 256
GAP = 1


def collect() -> dict[str, dict[int, np.ndarray]]:
    """Every icon at both scales. Names carry a group prefix so they never
    collide with the SVG icon names: r- resources (r-food 20 px, r-food-s
    16 px), c- commands, tech-, stat-, b- buildings, u- units."""
    icons: dict[str, dict[int, np.ndarray]] = {}
    for name, fn in RESOURCE_ICONS.items():
        icons[f'r-{name}'] = {s: render(fn(20), s) for s in (1, 2)}
        icons[f'r-{name}-s'] = {s: render(fn(16), s) for s in (1, 2)}
    for name, fn in COMMAND_ICONS.items():
        ic = fn()
        key = name if name.startswith('tech-') else f'c-{name}'
        icons[key] = {s: render(ic, s) for s in (1, 2)}
    for name, fn in STAT_ICONS.items():
        ic = fn()
        icons[name] = {s: render(ic, s) for s in (1, 2)}
    icons.update(building_icons())
    icons.update(unit_icons())
    return icons


def pack(icons: dict[str, dict[int, np.ndarray]]) -> tuple[dict[str, tuple[int, int, int, int]], int]:
    """Shelf packer on the 1x sizes; tallest first, then by name for stable output."""
    order = sorted(icons, key=lambda n: (-icons[n][1].shape[0], -icons[n][1].shape[1], n))
    frames: dict[str, tuple[int, int, int, int]] = {}
    x = y = shelf = 0
    for n in order:
        h, w = icons[n][1].shape[:2]
        if x + w > SHEET_W:
            x = 0
            y += shelf + GAP
            shelf = 0
        frames[n] = (x, y, w, h)
        x += w + GAP
        shelf = max(shelf, h)
    return frames, y + shelf


def is_picture(name: str) -> bool:
    return name.startswith('b-') or name.startswith('u-')


def build_palette(icons) -> np.ndarray:
    """255 colours: every exact ramp colour the drawn icons use, the rest fitted to the pictures."""
    drawn = np.concatenate([icons[n][s][..., :3][icons[n][s][..., 3] > 0] for n in icons if not is_picture(n) for s in (1, 2)])
    exact = np.unique(drawn, axis=0)
    pics = np.concatenate([icons[n][s][..., :3][icons[n][s][..., 3] > 0] for n in icons if is_picture(n) for s in (1, 2)])
    room = 255 - len(exact)
    assert room > 64, f'too many drawn colours: {len(exact)}'
    strip = Image.fromarray(pics[None, :, :].astype(np.uint8))
    q = strip.quantize(colors=room, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    fitted = np.array(q.getpalette()[: room * 3], np.uint8).reshape(-1, 3)
    return np.concatenate([exact, fitted]).astype(np.int32)


def to_indexed(sheet: np.ndarray, pal: np.ndarray) -> Image.Image:
    """Nearest palette colour per opaque pixel; index 255 is transparent."""
    h, w = sheet.shape[:2]
    flat = sheet.reshape(-1, 4)
    idx = np.full(len(flat), 255, np.uint8)
    solid = np.nonzero(flat[:, 3] > 0)[0]
    rgb = flat[solid, :3].astype(np.int32)
    for i in range(0, len(rgb), 20000):
        chunk = rgb[i:i + 20000]
        d = ((chunk[:, None, :] - pal[None, :, :]) ** 2).sum(2)
        idx[solid[i:i + 20000]] = d.argmin(1).astype(np.uint8)
    im = Image.frombytes('P', (w, h), idx.tobytes())
    full = np.zeros((256, 3), np.uint8)
    full[: len(pal)] = pal
    im.putpalette(full.reshape(-1).tolist())
    im.info['transparency'] = 255
    return im


def write_sheets(icons, frames, height: int) -> None:
    pal = build_palette(icons)
    for s, suffix in ((1, ''), (2, '@2x')):
        sheet = np.zeros((height * s, SHEET_W * s, 4), np.uint8)
        for n, (x, y, w, h) in frames.items():
            img = icons[n][s]
            assert img.shape[:2] == (h * s, w * s), (n, img.shape, (h, w))
            assert set(np.unique(img[..., 3])) <= {0, 255}, f'{n}: alpha must be binary'
            sheet[y * s:(y + h) * s, x * s:(x + w) * s] = img
        path = os.path.join(OUT_DIR, f'icons{suffix}.png')
        to_indexed(sheet, pal).save(path, optimize=True, transparency=255)
        print(f'{path}: {os.path.getsize(path)} bytes')


def write_ts(frames, height: int) -> None:
    lines = [
        '// Generated by scripts/ui/gen_icons.py from the pixel-art icon sheets in',
        '// public/assets/ui/icons (icons.png, icons@2x.png). Do not edit by hand.',
        '// Frames are [x, y, w, h] in 1x sheet pixels; one pixel is half a texel.',
        '// Prefixes: r- resources (-s = 16 px inline size), c- commands, tech-,',
        '// stat-, b- buildings (.castle / .gunpowder era variants), u- units.',
        '',
        f'export const RASTER_SHEET = {{ w: {SHEET_W}, h: {height} }} as const;',
        '',
        'export const RASTER_ICONS = {',
    ]
    for n in sorted(frames):
        x, y, w, h = frames[n]
        lines.append(f"  '{n}': [{x}, {y}, {w}, {h}],")
    lines += ['} as const satisfies Record<string, readonly [number, number, number, number]>;', '',
              'export type RasterIconName = keyof typeof RASTER_ICONS;', '']
    with open(TS_OUT, 'w') as f:
        f.write('\n'.join(lines))
    print(f'{TS_OUT}: {len(frames)} icons')


def preview(icons, path: str) -> None:
    names = sorted(icons)
    per = 12
    cell = 70
    rows = (len(names) + per - 1) // per
    bgs = [(26, 18, 11, 255), (222, 206, 170, 255)]
    sheet = Image.new('RGBA', (per * cell, rows * cell * len(bgs)), (0, 0, 0, 255))
    for bi, bg in enumerate(bgs):
        for i, n in enumerate(names):
            r, c = divmod(i, per)
            x0, y0 = c * cell, (bi * rows + r) * cell
            sheet.paste(Image.new('RGBA', (cell, cell), bg), (x0, y0))
            sheet.alpha_composite(Image.fromarray(icons[n][2]), (x0 + 3, y0 + 3))
    sheet.resize((sheet.width * 2, sheet.height * 2), Image.NEAREST).save(path)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--sheet', help='also write a zoomed preview of every icon here')
    args = ap.parse_args()
    icons = collect()
    frames, height = pack(icons)
    os.makedirs(OUT_DIR, exist_ok=True)
    write_sheets(icons, frames, height)
    write_ts(frames, height)
    if args.sheet:
        preview(icons, args.sheet)


if __name__ == '__main__':
    main()
