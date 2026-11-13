"""Picture icons for gen_icons.py: buildings cut from the style A building
atlas, units re-rendered from their voxel puppets at icon resolution.

Buildings: the sprite and its overlays (mill sails, the first flag frame) are
composed with the team mask tinted player-1 blue, cropped to the building
body, downscaled with a box filter and given a hard alpha edge, so the icon
is the in-game building at a clean small size. Producers that look alike at
icon size carry a small iron roundel with what they make.

Units: `scripts/blender/units_rig.py` renders the idle pose at the density
that fills the icon, so the 2x icon has twice the voxel detail instead of
being an upscale.
"""
from __future__ import annotations

import importlib
import json
import os
import sys

import numpy as np
from PIL import Image

from iconkit import OUTLINE, dilate
from pixkit import hexc

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SPRITES = os.path.join(ROOT, 'public', 'assets', 'sprites')
TEAM = np.array([0x2E, 0x86, 0xDE], float) / 255.0  # player 1 blue, like the unit portraits

# building key -> (crop l, t, r, b as fractions of the composed sprite, roundel symbol)
BUILDINGS: dict[str, tuple[tuple[float, float, float, float], str | None]] = {
    'town_center': ((0.06, 0.0, 0.94, 0.86), None),
    'house': ((0.0, 0.0, 1.0, 0.94), None),
    'farm': ((0.0, 0.0, 1.0, 1.0), None),
    'mill': ((0.08, 0.0, 0.92, 0.9), None),
    'barracks': ((0.04, 0.0, 0.92, 0.88), 'spears'),
    'archery_range': ((0.04, 0.0, 1.0, 0.9), 'bow'),
    'stable': ((0.04, 0.0, 1.0, 0.88), 'horseshoe'),
    'lumber_camp': ((0.0, 0.0, 1.0, 0.92), 'axe'),
    'gold_mine': ((0.0, 0.0, 1.0, 0.94), None),
    'stone_quarry': ((0.0, 0.0, 1.0, 0.94), None),
    'defensive_tower': ((0.0, 0.0, 1.0, 0.96), None),
    'foundry': ((0.04, 0.0, 0.96, 0.9), None),
    'wall': ((0.0, 0.0, 1.0, 1.0), None),
}
ERAS = ('dark', 'castle', 'gunpowder')

# unit -> (module, facing, anim, frame, fit) ; fit 'body' crops at the knees, 'whole' fits all
UNITS: dict[str, tuple[str, int, str, int, str]] = {
    'villager': ('units_villager', 0, 'idle', 0, 'body'),
    'militia': ('units_militia', 0, 'idle', 0, 'body'),
    'spearman': ('units_spearman', 0, 'idle', 0, 'body'),
    'archer': ('units_archer', 0, 'idle', 0, 'body'),
    'cavalry': ('units_cavalry', 7, 'idle', 0, 'whole'),
    'gunman': ('units_gunman', 0, 'idle', 0, 'body'),
    'cannon': ('units_cannon', 7, 'idle', 0, 'whole'),
}


# ---------------------------------------------------------------------------
# shared
# ---------------------------------------------------------------------------

def _finish(rgba01: np.ndarray, scale: int) -> np.ndarray:
    """float RGBA (0..1, straight alpha) -> uint8 with a hard edge and the icon outline."""
    a = rgba01[..., 3] > 0.5
    out = np.zeros(rgba01.shape[:2] + (4,), np.uint8)
    out[..., :3] = np.clip(np.round(rgba01[..., :3] * 255), 0, 255).astype(np.uint8)
    out[..., 3] = np.where(a, 255, 0)
    ring = dilate(a, scale) & ~a
    out[ring] = hexc(OUTLINE)
    return out


def _box_down(img: np.ndarray, w: int, h: int) -> np.ndarray:
    """Premultiplied area downscale of a float RGBA image to w x h."""
    pm = img.copy()
    pm[..., :3] *= pm[..., 3:4]
    pim = Image.fromarray(np.clip(np.round(pm * 255), 0, 255).astype(np.uint8))
    r = np.asarray(pim.resize((w, h), Image.BOX), float) / 255
    a = r[..., 3:4]
    rgb = np.where(a > 1e-3, r[..., :3] / np.maximum(a, 1e-3), 0)
    # a touch of local contrast so small features survive the reduction
    blur = np.asarray(Image.fromarray(np.clip(rgb * 255, 0, 255).astype(np.uint8)).resize((max(1, w // 2), max(1, h // 2)), Image.BOX).resize((w, h), Image.BILINEAR), float) / 255
    rgb = np.clip(rgb + (rgb - blur) * 0.35, 0, 1)
    # hard alpha keeps the silhouette crisp; thin bits survive at a lower threshold
    return np.concatenate([rgb, np.clip(a * 1.6, 0, 1)], axis=2)


def _place(src: np.ndarray, N: int, scale: int, pad: int = 1) -> np.ndarray:
    """Fit src (float RGBA) into an N*scale square, bottom centred."""
    S = N * scale
    p = pad * scale
    h, w = src.shape[:2]
    k = min((S - 2 * p) / w, (S - 2 * p) / h)
    nw, nh = max(1, round(w * k)), max(1, round(h * k))
    small = _box_down(src, nw, nh)
    out = np.zeros((S, S, 4))
    x0 = (S - nw) // 2
    y0 = S - p - nh
    out[y0:y0 + nh, x0:x0 + nw] = small
    return out


# ---------------------------------------------------------------------------
# buildings
# ---------------------------------------------------------------------------

class Atlas:
    def __init__(self) -> None:
        self.manifest = json.load(open(os.path.join(SPRITES, 'manifest.json')))
        self.frames = json.load(open(os.path.join(SPRITES, 'buildings-0.json')))['frames']
        self.image = np.asarray(Image.open(os.path.join(SPRITES, 'buildings-0.png')).convert('RGBA'), float) / 255

    def frame(self, name: str):
        f = self.frames[name]
        fr = f['frame']
        return self.image[fr['y']:fr['y'] + fr['h'], fr['x']:fr['x'] + fr['w']], f['spriteSourceSize'], f['sourceSize']

    def compose(self, var: dict) -> np.ndarray:
        _, _, src = self.frame(var['frame'])
        out = np.zeros((src['h'], src['w'], 4))

        def put(name: str, mask: str | None) -> None:
            img, ss, _ = self.frame(name)
            a = img.copy()
            if mask:
                mi, ms, _ = self.frame(mask)
                full = np.zeros_like(out)
                full[ms['y']:ms['y'] + ms['h'], ms['x']:ms['x'] + ms['w']] = mi
                mm = full[ss['y']:ss['y'] + ss['h'], ss['x']:ss['x'] + ss['w']]
                ma = mm[..., 3:4]
                a[..., :3] = a[..., :3] * (1 - ma) + TEAM * mm[..., :3] * ma
            reg = out[ss['y']:ss['y'] + ss['h'], ss['x']:ss['x'] + ss['w']]
            al = a[..., 3:4]
            reg[..., :3] = reg[..., :3] * (1 - al) + a[..., :3] * al
            reg[..., 3:4] = reg[..., 3:4] * (1 - al) + al

        put(var['frame'], var.get('mask'))
        for kind in ('sails', 'flag'):
            ov = var.get('overlays', {}).get(kind)
            if ov:
                put(ov[0]['frame'], ov[0].get('mask'))
        ys, xs = np.nonzero(out[..., 3] > 0.02)
        return out[ys.min():ys.max() + 1, xs.min():xs.max() + 1]

    def variants(self, key: str) -> dict[str, dict]:
        asset = self.manifest['assets'][f'building.{key}']
        v = asset['variants']
        if key == 'farm':
            return {'dark': v['ripe']}
        if key == 'wall':
            # a straight x-run of wall (mask 5 = +x and -x neighbours)
            return {era: v[f'{era}.5'] for era in ERAS if f'{era}.5' in v}
        return {era: v[era] for era in ERAS if era in v}


def _figure(unit: str, S: int, s: int, frac: float) -> np.ndarray:
    """A whole unit, feet down, about frac * S tall, outlined (uint8 RGBA, tight crop)."""
    modname, _, _, _, _ = UNITS[unit]
    anim, frame, facing = FIGURE_POSE.get(unit, ('idle', 0, 1))
    mod = _unit_module(modname)
    tall = HEAD_HEIGHT * (1.4 if unit == 'cavalry' else 1.0)
    d = S * frac / tall
    img, _, _ = _unit_frame(mod, facing, anim, frame, d)
    ys, xs = np.nonzero(img[..., 3] > 0)
    img = img[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    pad = np.zeros((img.shape[0] + 2 * s, img.shape[1] + 2 * s, 4))
    pad[s:-s, s:-s] = img
    return _finish(pad, s)


#: the unit shown in front of a producer whose building alone reads like its neighbours
FIGURE: dict[str, str] = {'barracks': 'spearman', 'archery_range': 'archer', 'stable': 'cavalry', 'lumber_camp': 'villager'}
#: (anim, frame, facing) for those figures
FIGURE_POSE: dict[str, tuple[str, int, int]] = {
    'spearman': ('idle', 0, 1), 'archer': ('idle', 0, 1), 'cavalry': ('idle', 0, 0), 'villager': ('chop', 1, 2),
}


def building_icons(N: int = 30) -> dict[str, dict[int, np.ndarray]]:
    atlas = Atlas()
    icons: dict[str, dict[int, np.ndarray]] = {}
    for key, (crop, _) in BUILDINGS.items():
        for i, (era, var) in enumerate(atlas.variants(key).items()):
            img = atlas.compose(var)
            h, w = img.shape[:2]
            l, t, r, b = crop
            img = img[int(t * h):max(int(t * h) + 1, int(round(b * h))), int(l * w):max(int(l * w) + 1, int(round(r * w)))]
            # the earliest era with art carries the plain name; the runtime falls back to it
            name = f'b-{key.replace("_", "-")}' + ('' if i == 0 else f'.{era}')
            icons[name] = {}
            for s in (1, 2):
                S = N * s
                fig_unit = FIGURE.get(key)
                if fig_unit:
                    # building up and to the left, the unit it trains in front, bottom right
                    pic = _place(img, N, s)
                    shifted = np.zeros_like(pic)
                    dx, dy = 3 * s, 2 * s
                    shifted[:S - dy, :S - dx] = pic[dy:, dx:]
                    out = _finish(shifted, s)
                    fig = _figure(fig_unit, S, s, 0.62 if fig_unit != 'cavalry' else 0.5)
                    fh, fw = fig.shape[:2]
                    fh, fw = min(fh, S), min(fw, S)
                    reg = out[S - fh:, S - fw:]
                    m = fig[-fh:, -fw:, 3] > 0
                    reg[m] = fig[-fh:, -fw:][m]
                else:
                    out = _finish(_place(img, N, s), s)
                icons[name][s] = out
    # foundation: the half-built 2x2 site
    v = atlas.manifest['assets'].get('construction.2x2')
    if v:
        stage = v['variants'].get('1') or next(iter(v['variants'].values()))
        img = atlas.compose(stage)
        icons['b-foundation'] = {s: _finish(_place(img, N, s), s) for s in (1, 2)}
    return icons


# ---------------------------------------------------------------------------
# units
# ---------------------------------------------------------------------------

#: feet to top of the head at density 1 (units-manifest.json `height`)
HEAD_HEIGHT = 37


def _unit_frame(mod, facing: int, anim: str, frame: int, d: float) -> tuple[np.ndarray, int, int]:
    """Rendered pose (float RGBA, team tinted) and the feet anchor inside it."""
    import units_rig as U
    mk = U.Mk(facing=facing, density=d, half=48, layers=96)
    with np.errstate(all='ignore'):
        mod.draw(mk, anim, frame)
        fr = U.render(mk)
    src = fr.rgba.astype(float) / 255
    m = fr.mask.astype(float) / 255
    ma = m[..., 3:4]
    src[..., :3] = src[..., :3] * (1 - ma) + m[..., :3] * TEAM * ma
    return src, int(fr.ax), int(fr.ay)


def _paste(out: np.ndarray, img: np.ndarray, x0: int, y0: int) -> None:
    H, W = out.shape[:2]
    h, w = img.shape[:2]
    sx, sy = max(0, -x0), max(0, -y0)
    dx, dy = max(0, x0), max(0, y0)
    cw, ch = min(w - sx, W - dx), min(h - sy, H - dy)
    if cw > 0 and ch > 0:
        out[dy:dy + ch, dx:dx + cw] = img[sy:sy + ch, sx:sx + cw]


def _unit_module(modname: str):
    blender = os.path.join(ROOT, 'scripts', 'blender')
    if blender not in sys.path:
        sys.path.insert(0, blender)
    return importlib.import_module(modname)


def unit_icons(N: int = 30) -> dict[str, dict[int, np.ndarray]]:
    icons: dict[str, dict[int, np.ndarray]] = {}
    for name, (modname, facing, anim, frame, fit) in UNITS.items():
        mod = _unit_module(modname)
        icons[f'u-{name}'] = {}
        for s in (1, 2):
            S = N * s
            out = np.zeros((S, S, 4))
            if fit == 'whole':
                base, _, _ = _unit_frame(mod, facing, anim, frame, 1.0)
                ys, xs = np.nonzero(base[..., 3] > 0)
                bh, bw = ys.max() - ys.min() + 1, xs.max() - xs.min() + 1
                d = (S - 2 * s) / max(bh, bw)
                img, _, _ = _unit_frame(mod, facing, anim, frame, d)
                ys, xs = np.nonzero(img[..., 3] > 0)
                img = img[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
                h, w = img.shape[:2]
                _paste(out, img, (S - w) // 2, S - s - h)
            else:
                # head near the top edge, cut around the knees, feet anchor centred
                d = S * 1.12 / HEAD_HEIGHT
                img, ax, ay = _unit_frame(mod, facing, anim, frame, d)
                head_top = ay - HEAD_HEIGHT * d
                _paste(out, img, S // 2 - ax + s, int(round(2 * s - head_top)))
            icons[f'u-{name}'][s] = _finish(out, s)
    return icons
