"""UI skin textures, art direction "carved wood and iron".

Dark oak frames, wrought iron brackets and studs, parchment insets and gold
leaf. Every texture is procedural (seeded value noise, ordered dithering and
hand-placed pixel patterns), drawn at 1x and shown at an integer scale in the
game (`--px`, see src/ui/skin/pixel-scale.ts). Re-running the script rewrites
the same files byte for byte.

Run from the repo root:
    python3 scripts/ui/gen_ui_skin.py [--sheet /path/to/preview.png]

Output: public/assets/ui/skin/*.png. The slice values the CSS uses are
listed next to each texture below; keep them in sync with
src/ui/styles/skin.css when a texture changes size.
"""
from __future__ import annotations

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pixkit import (canvas, clear_corners, contact_sheet, disc, fbm, hexc, paste, px,  # noqa: E402
                    quantize, rect, ring, save, shade_mask, stamp, value_noise)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'assets', 'ui', 'skin')

# ── Palette ──────────────────────────────────────────────────────────────────
OAK = ['#170f08', '#21160c', '#2b1d10', '#362414', '#422c18', '#4f351c', '#5e4021', '#6e4b27', '#8a5e33']
IRON = {'hi': '#b4bac0', 'lt': '#8d939a', 'md': '#686d74', 'mm': '#4c5057', 'dk': '#36393e', 'xd': '#24262a', 'bk': '#141518'}
GOLD = ['#5f4810', '#8a6a1c', '#c9a227', '#e7c45a', '#f6dd86']
PARCH = ['#8f7548', '#a88d5c', '#bfa572', '#d2bb88', '#e0cc9d', '#ebdcb3', '#f4e9cc']
RED = ['#2a0508', '#4a0a10', '#6c0f17', '#98202c', '#bb2733', '#e0645a']
ASH = ['#1b1a19', '#24221f', '#2d2a26', '#36322d', '#423d36', '#5a544b']
OUTL = '#0a0705'
SHADOW = '#0e0905'
RIV_IRON = {'a': IRON['hi'], 'b': IRON['md'], 'c': IRON['dk'], 'd': IRON['bk']}
RIV_GOLD = {'a': GOLD[4], 'b': GOLD[2], 'c': GOLD[1], 'd': GOLD[0]}
RIVET = ['.ab.', 'abbc', 'abcd', '.cd.']

written: list[str] = []


def out(a: np.ndarray, name: str) -> None:
    path = os.path.join(OUT, name + '.png')
    save(a, path)
    written.append(path)


def rivet(a: np.ndarray, x: int, y: int, pal: dict[str, str] = RIV_IRON) -> None:
    stamp(a, RIVET, x, y, pal)


def wood_planks(w: int, h: int, plank: int, seed: int, ramp: list[str], joints: bool = True) -> np.ndarray:
    grain = fbm(w, h, 32, 4, seed, 3) * 0.7 + value_noise(w, h, 8, 1, seed + 7) * 0.3
    rng = np.random.default_rng(seed)
    for p in range(h // plank):
        grain[p * plank:(p + 1) * plank] += rng.uniform(-0.12, 0.12)
    a = quantize(grain, ramp, 0.7)
    for p in range(h // plank):
        y0 = p * plank
        a[y0, :] = hexc(ramp[-1])
        a[y0 + plank - 1, :] = hexc(SHADOW)
        if joints:
            jx = int(rng.integers(4, w - 4))
            a[y0:y0 + plank, jx] = hexc(SHADOW)
            a[y0 + 1:y0 + plank - 1, jx + 1] = hexc(ramp[-1])
    return a


# ── Surfaces ────────────────────────────────────────────────────────────────
def gen_surfaces() -> None:
    # Plank tiles (background, tiled at 64x48 texels)
    out(wood_planks(64, 48, 12, 11, OAK[2:7]), 'wood')
    out(wood_planks(64, 48, 12, 14, OAK[1:5]), 'wood-dark')

    # Parchment tile 64x64 with fibres
    f = fbm(64, 64, 32, 32, 8, 4)
    a = quantize(f, PARCH[3:7], 0.9)
    rng = np.random.default_rng(9)
    for _ in range(36):
        x, y, n = int(rng.integers(0, 64)), int(rng.integers(0, 64)), int(rng.integers(2, 6))
        for i in range(n):
            a[y, (x + i) % 64] = hexc(PARCH[2])
    out(a, 'parch')

    # Darker, aged parchment for cards inside parchment panels
    a = quantize(fbm(64, 64, 32, 32, 10, 4), PARCH[2:6], 0.9)
    out(a, 'parch-dark')


# ── Frames ───────────────────────────────────────────────────────────────────
def gen_frames() -> None:
    # Heavy frame, slice 12: iron band, carved oak, gold leaf, iron L brackets
    # at the corners and a riveted stud in the middle of every edge segment
    # (border-image-repeat: repeat, so studs march along long edges).
    S = 56
    a = wood_planks(S, S, 56, 5, OAK[3:8], joints=False).copy()
    ring(a, 0, OUTL, OUTL)
    ring(a, 1, IRON['lt'], IRON['xd'])
    ring(a, 2, IRON['md'], IRON['dk'])
    ring(a, 3, IRON['dk'], IRON['bk'])
    ring(a, 4, OAK[8], OAK[1])
    ring(a, 7, OAK[1], OAK[7])
    ring(a, 8, OAK[7], OAK[2])
    ring(a, 10, GOLD[3], GOLD[1])
    ring(a, 11, OUTL, OUTL)
    a[12:S - 12, 12:S - 12] = 0
    mask = np.zeros((S, S), bool)
    for (x0, y0, sx, sy) in [(0, 0, 1, 1), (S - 1, 0, -1, 1), (0, S - 1, 1, -1), (S - 1, S - 1, -1, -1)]:
        for i in range(13):
            for j in range(13):
                if i < 6 or j < 6:
                    mask[y0 + sy * j, x0 + sx * i] = True
    plate = canvas(S, S)
    shade_mask(plate, mask, IRON['mm'], IRON['lt'], IRON['bk'], OUTL)
    paste(a, plate)
    for (x, y) in [(1, 1), (8, 1), (1, 8), (S - 5, 1), (S - 12, 1), (S - 5, 8), (1, S - 5), (8, S - 5),
                   (1, S - 12), (S - 5, S - 5), (S - 12, S - 5), (S - 5, S - 12)]:
        rivet(a, x, y)
    m = S // 2 - 3
    stud = np.zeros((S, S), bool)
    for (x, y) in [(m, 2), (m, S - 8), (2, m), (S - 8, m)]:
        stud[y:y + 6, x:x + 6] = True
    st = canvas(S, S)
    shade_mask(st, stud, IRON['md'], IRON['hi'], IRON['bk'], OUTL)
    paste(a, st)
    for (x, y) in [(m + 1, 3), (m + 1, S - 7), (3, m + 1), (S - 7, m + 1)]:
        rivet(a, x, y)
    out(a, 'frame')

    # Thin frame, slice 6: iron rim on dark oak, for cards and small panels.
    S = 24
    a = canvas(S, S)
    ring(a, 0, OUTL, OUTL)
    ring(a, 1, IRON['lt'], IRON['xd'])
    ring(a, 2, IRON['md'], IRON['dk'])
    ring(a, 3, OUTL, OUTL)
    ring(a, 4, OAK[7], OAK[1])
    ring(a, 5, OAK[3], OAK[3])
    a[6:S - 6, 6:S - 6] = quantize(fbm(S - 12, S - 12, 6, 6, 31), OAK[2:4])
    for (x, y) in [(1, 1), (S - 5, 1), (1, S - 5), (S - 5, S - 5)]:
        rivet(a, x, y)
    clear_corners(a, 1)
    out(a, 'frame-thin')

    # Gilded frame, slice 6: same build with gold leaf, for highlighted cards.
    a = canvas(S, S)
    ring(a, 0, OUTL, OUTL)
    ring(a, 1, GOLD[4], GOLD[1])
    ring(a, 2, GOLD[3], GOLD[0])
    ring(a, 3, OUTL, OUTL)
    ring(a, 4, OAK[8], OAK[1])
    ring(a, 5, OAK[4], OAK[4])
    a[6:S - 6, 6:S - 6] = quantize(fbm(S - 12, S - 12, 6, 6, 32), OAK[3:5])
    for (x, y) in [(1, 1), (S - 5, 1), (1, S - 5), (S - 5, S - 5)]:
        rivet(a, x, y, RIV_GOLD)
    clear_corners(a, 1)
    out(a, 'frame-gold')

    # Iron strap, 16x6, repeat-x: the lower edge of the top bar.
    a = canvas(16, 6)
    a[0, :] = hexc(OUTL)
    a[1, :] = hexc(IRON['lt'])
    a[2, :] = hexc(IRON['mm'])
    a[3, :] = hexc(IRON['dk'])
    a[4, :] = hexc(OUTL)
    a[5, :] = hexc(SHADOW)
    a[5, ::2] = 0
    stamp(a, ['ab', 'bc'], 7, 1, {'a': IRON['hi'], 'b': IRON['md'], 'c': IRON['bk']})
    out(a, 'strap')

    # Recessed slot, slice 6: command grid cells, queue, minimap socket floor.
    a = quantize(fbm(20, 20, 10, 10, 3), ['#120b06', '#170f08', '#1c130b'])
    ring(a, 0, OUTL, OUTL)
    ring(a, 1, '#070403', OAK[5])
    ring(a, 2, SHADOW, OAK[3])
    out(a, 'slot')

    # Resource well, slice 5: top bar counters, HP bar, timers.
    a = quantize(fbm(16, 16, 8, 8, 4), ['#110b06', '#160e08'])
    ring(a, 0, OUTL, OUTL)
    ring(a, 1, '#070403', OAK[6])
    ring(a, 2, SHADOW, OAK[3])
    out(a, 'well')

    # Parchment inlay rim, slice 5, transparent centre: the carved edge a
    # parchment panel sits in (selection panel, modal body cards).
    a = canvas(16, 16)
    ring(a, 0, OUTL, OUTL)
    ring(a, 1, '#070403', OAK[6])
    ring(a, 2, OAK[1], OAK[4])
    ring(a, 3, PARCH[0], PARCH[4])
    ring(a, 4, PARCH[2], PARCH[3])
    out(a, 'inlay')

    # Portrait frame, slice 6: iron outside, gold leaf bead, dark mat;
    # transparent centre for the portrait.
    S = 20
    a = canvas(S, S)
    ring(a, 0, OUTL, OUTL)
    ring(a, 1, IRON['hi'], IRON['xd'])
    ring(a, 2, IRON['md'], IRON['bk'])
    ring(a, 3, GOLD[4], GOLD[1])
    ring(a, 4, OUTL, OUTL)
    ring(a, 5, '#05030a', '#2a1d10')
    a[6:S - 6, 6:S - 6] = 0
    for (x, y) in [(0, 0), (S - 4, 0), (0, S - 4), (S - 4, S - 4)]:
        rivet(a, x, y)
    out(a, 'portrait')

    # Small tile rim, slice 3, transparent centre: mini portraits, queue
    # slots, kind chips. Iron for normal, gold leaf for hover and active.
    for name, (lt, dk) in (('tile', (IRON['lt'], IRON['xd'])), ('tile-gold', (GOLD[4], GOLD[1]))):
        a = canvas(8, 8)
        ring(a, 0, OUTL, OUTL)
        ring(a, 1, lt, dk)
        ring(a, 2, '#050302', OAK[4])
        a[3:5, 3:5] = 0
        out(a, name)

    # Minimap socket, slice 10: a thick round-cornered iron collar with a
    # gold bead, transparent centre.
    S = 32
    a = canvas(S, S)
    yy, xx = np.mgrid[0:S, 0:S]
    m = np.ones((S, S), bool)
    for (cx, cy) in [(0, 0), (S - 1, 0), (0, S - 1), (S - 1, S - 1)]:
        m &= ~(((xx - cx) ** 2 + (yy - cy) ** 2) < 5)
    collar = canvas(S, S)
    tex = quantize(fbm(S, S, 8, 8, 40), [IRON['dk'], IRON['mm'], IRON['md']])
    shade_mask(collar, m, IRON['mm'], IRON['hi'], IRON['bk'], OUTL, fill_arr=tex)
    paste(a, collar)
    ring(a, 6, OUTL, OUTL)
    ring(a, 7, GOLD[4], GOLD[1])
    ring(a, 8, OUTL, OUTL)
    ring(a, 9, '#05030a', '#24170c')
    a[10:S - 10, 10:S - 10] = 0
    for (x, y) in [(2, 2), (S - 6, 2), (2, S - 6), (S - 6, S - 6), (S // 2 - 2, 1), (S // 2 - 2, S - 5), (1, S // 2 - 2), (S - 5, S // 2 - 2)]:
        rivet(a, x, y)
    out(a, 'socket')


# ── Buttons ──────────────────────────────────────────────────────────────────
def gen_buttons() -> None:
    S = 26  # slice 8

    def base(faces: list[str], seed: int = 21) -> np.ndarray:
        return quantize(fbm(S, S, 13, 4, seed), faces)

    def finish(a: np.ndarray, name: str) -> None:
        clear_corners(a, 1)
        out(a, name)

    # Raised: lit top-left, dark bottom-right, 2 texel oak bevel.
    a = base(OAK[5:8])
    ring(a, 0, OUTL, OUTL)
    ring(a, 1, IRON['lt'], IRON['xd'])
    ring(a, 2, IRON['md'], IRON['dk'])
    ring(a, 3, OUTL, OUTL)
    ring(a, 4, OAK[8], OAK[2])
    ring(a, 5, OAK[7], OAK[3])
    a[S - 7, 6:S - 6] = hexc(OAK[4])
    finish(a, 'btn')

    # Hover: gold rim, lighter face.
    a = base(OAK[6:9])
    ring(a, 0, OUTL, OUTL)
    ring(a, 1, GOLD[4], GOLD[1])
    ring(a, 2, GOLD[3], GOLD[0])
    ring(a, 3, OUTL, OUTL)
    ring(a, 4, '#a8743f', OAK[2])
    ring(a, 5, OAK[8], OAK[4])
    finish(a, 'btn-hover')

    # Pressed: the face sinks. Highlight flips to the bottom-right, a two
    # texel shadow falls across the top-left, the face goes darker.
    a = base(OAK[3:6])
    ring(a, 0, OUTL, OUTL)
    ring(a, 1, IRON['xd'], IRON['lt'])
    ring(a, 2, IRON['dk'], IRON['md'])
    ring(a, 3, OUTL, OUTL)
    ring(a, 4, '#050302', OAK[7])
    ring(a, 5, OAK[0], OAK[5])
    a[6, 6:S - 6] = hexc(OAK[1])
    a[6:S - 6, 6] = hexc(OAK[1])
    a[7, 7:S - 6] = hexc(OAK[2])
    finish(a, 'btn-pressed')

    # Disabled: flat, desaturated, no bevel.
    a = base(['#2c2925', '#312d29', '#36312c'])
    ring(a, 0, OUTL, OUTL)
    ring(a, 1, '#4a4846', '#2a2928')
    ring(a, 2, '#3a3937', '#323130')
    ring(a, 3, OUTL, OUTL)
    ring(a, 4, '#3a3530', '#3a3530')
    ring(a, 5, '#34302b', '#34302b')
    finish(a, 'btn-disabled')

    # Active / latched: sunk like pressed, with a gold leaf rim.
    a = base(OAK[2:5])
    ring(a, 0, OUTL, OUTL)
    ring(a, 1, GOLD[1], GOLD[4])
    ring(a, 2, GOLD[0], GOLD[3])
    ring(a, 3, OUTL, OUTL)
    ring(a, 4, '#050302', GOLD[2])
    ring(a, 5, OAK[0], OAK[6])
    a[6, 6:S - 6] = hexc(OAK[1])
    a[6:S - 6, 6] = hexc(OAK[1])
    finish(a, 'btn-active')

    # Red lacquered button for destructive actions.
    a = base(RED[2:5], 22)
    ring(a, 0, OUTL, OUTL)
    ring(a, 1, IRON['lt'], IRON['xd'])
    ring(a, 2, IRON['md'], IRON['dk'])
    ring(a, 3, OUTL, OUTL)
    ring(a, 4, RED[5], RED[1])
    ring(a, 5, RED[4], RED[1])
    finish(a, 'btn-danger')

    # Banner (menu) buttons, 96x28, slice 8 vertical / 14 horizontal:
    # a plank face with riveted iron end caps.
    Wd, Hd = 96, 28

    def banner(name: str, faces: list[str], rim: tuple[str, str], cap: tuple[str, str, str],
               inner: tuple[str, str], sunk: bool = False, riv: dict[str, str] = RIV_IRON) -> None:
        a = wood_planks(Wd, Hd, Hd, 33, faces, joints=False).copy()
        ring(a, 0, OUTL, OUTL)
        ring(a, 1, *rim)
        ring(a, 2, *inner)
        if sunk:
            a[3, 12:Wd - 12] = hexc(OAK[0])
            a[4, 12:Wd - 12] = hexc(OAK[1])
        for x0 in (0, Wd - 12):
            m = np.zeros((Hd, Wd), bool)
            m[0:Hd, x0:x0 + 12] = True
            c = canvas(Wd, Hd)
            shade_mask(c, m, cap[1], cap[0], cap[2], OUTL)
            paste(a, c)
            rivet(a, x0 + 4, 5, riv)
            rivet(a, x0 + 4, Hd - 9, riv)
        clear_corners(a, 1)
        out(a, name)

    banner('banner', OAK[5:9], (OAK[8], OAK[1]), (IRON['lt'], IRON['mm'], IRON['bk']), (OAK[7], OAK[3]))
    banner('banner-hover', OAK[6:9] + ['#9c6c3b'], (GOLD[4], GOLD[1]), (GOLD[3], GOLD[1], GOLD[0]), ('#a8743f', OAK[4]), riv=RIV_GOLD)
    banner('banner-pressed', OAK[3:7], (OAK[0], OAK[7]), (IRON['dk'], IRON['xd'], IRON['bk']), (OAK[1], OAK[6]), sunk=True)
    banner('banner-disabled', ['#2c2925', '#312d29', '#36312c', '#3a352f'], ('#4a4846', '#2a2928'),
           ('#4a4846', '#3a3937', '#232221'), ('#3a3530', '#3a3530'))
    banner('banner-primary', RED[2:6], (RED[5], RED[0]), (GOLD[3], GOLD[1], GOLD[0]), (RED[4], RED[1]), riv=RIV_GOLD)
    banner('banner-primary-hover', RED[3:6] + ['#f08a7c'], (GOLD[4], GOLD[1]), (GOLD[4], GOLD[2], GOLD[0]), (RED[5], RED[2]), riv=RIV_GOLD)
    banner('banner-primary-pressed', RED[1:5], (RED[0], RED[5]), (GOLD[1], GOLD[0], OUTL), (RED[0], RED[3]), sunk=True, riv=RIV_GOLD)

    # Keycap, 10x11, slice 3 3 4 3: an ivory key with a dark front lip.
    a = canvas(10, 11)
    a[:] = hexc(PARCH[5])
    ring(a, 0, OUTL, OUTL)
    a[1, 1:9] = hexc(PARCH[6])
    a[1:7, 1] = hexc(PARCH[6])
    a[1:7, 8] = hexc(PARCH[3])
    a[7, 1:9] = hexc(PARCH[2])
    a[8:10, 1:9] = hexc(PARCH[0])
    a[7:10, 1] = hexc(PARCH[1])
    clear_corners(a, 1)
    out(a, 'keycap')

    # Lacquered plaque, 32x16, slice 6: the age plaque in the top bar.
    a = quantize(fbm(32, 16, 16, 8, 50), RED[2:5])
    ring(a, 0, OUTL, OUTL)
    ring(a, 1, GOLD[4], GOLD[1])
    ring(a, 2, GOLD[2], GOLD[0])
    ring(a, 3, OUTL, OUTL)
    ring(a, 4, RED[5], RED[1])
    clear_corners(a, 1)
    out(a, 'plaque')

    # Iron knob, 12x12: slider thumbs and switch handles.
    a = canvas(12, 12)
    m = disc(12, 12, 6, 6, 5.8)
    shade_mask(a, m, IRON['md'], IRON['hi'], IRON['bk'], OUTL)
    stamp(a, ['ab', 'bc'], 5, 5, {'a': IRON['hi'], 'b': IRON['lt'], 'c': IRON['dk']})
    out(a, 'knob')

    # Scrollbar: a ridged iron thumb (6x8, slice 2) and a sunken track (slice 2).
    a = canvas(6, 8)
    a[:] = hexc(IRON['mm'])
    ring(a, 0, OUTL, OUTL)
    ring(a, 1, IRON['lt'], IRON['bk'])
    for y in (2, 4):
        a[y, 2:4] = hexc(IRON['dk'])
        a[y + 1, 2:4] = hexc(IRON['hi'])
    clear_corners(a, 1)
    out(a, 'thumb')
    a = quantize(fbm(8, 8, 4, 4, 51), ['#0c0805', '#110b06'])
    ring(a, 0, OUTL, OUTL)
    ring(a, 1, '#050302', OAK[3])
    out(a, 'track')


# ── Notes, tooltips, seals, banners ─────────────────────────────────────────
def gen_ornaments() -> None:
    # Torn, aged parchment note, 48x48, slice 14.
    S = 48
    a = quantize(fbm(S, S, 24, 24, 15, 3), PARCH[3:7], 0.9)
    yy, xx = np.mgrid[0:S, 0:S]
    d = np.minimum(np.minimum(xx, S - 1 - xx), np.minimum(yy, S - 1 - yy)).astype(float)
    n = value_noise(S, S, 3, 3, 16) * 2.6
    alpha = d >= n
    a[(d < n + 2.2) & alpha] = hexc(PARCH[1])
    a[(d < n + 1.0) & alpha] = hexc(PARCH[0])
    a[~alpha] = 0
    out(a, 'note')

    # Stitched leather tooltip, 22x22, slice 7.
    S = 22
    a = quantize(fbm(S, S, 11, 11, 17), ['#1c120b', '#22160d', '#291b10', '#301f13'])
    ring(a, 0, '#050302', '#050302')
    ring(a, 1, '#5a3f29', '#120b06')
    for i in range(3, S - 3):
        if (i // 2) % 2 == 0:
            for (x, y) in [(i, 3), (i, S - 4), (3, i), (S - 4, i)]:
                px(a, x, y, '#a07a50')
    clear_corners(a, 1)
    out(a, 'tip')

    # Red ribbon header, 24x12, slice 3 vertical / 6 horizontal, notched ends.
    Wd, Hd = 24, 12
    a = quantize(fbm(Wd, Hd, 12, 6, 18), RED[3:5])
    ring(a, 0, RED[0], RED[0])
    a[1, 1:Wd - 1] = hexc(RED[5])
    a[Hd - 2, 1:Wd - 1] = hexc(RED[1])
    for y in range(3, Hd - 3):
        k = 2 - abs(y - (Hd - 1) / 2) // 1.5
        for x in range(int(k) + 1):
            a[y, x] = 0
            a[y, Wd - 1 - x] = 0
    out(a, 'ribbon')

    # Wax seals, 18x18: red (alerts), gold (won missions), grey (locked).
    def seal(name: str, ramp: list[str], mark: list[str], seed: int) -> None:
        S = 18
        a = canvas(S, S)
        n = value_noise(S, S, 3, 3, seed)
        yy, xx = np.mgrid[0:S, 0:S]
        m = ((xx + 0.5 - 9) ** 2 + (yy + 0.5 - 9) ** 2) <= (7.6 + n * 1.2) ** 2
        shade_mask(a, m, ramp[3], ramp[5], ramp[1], ramp[0])
        rm = disc(S, S, 9, 9, 5.2) & ~disc(S, S, 9, 9, 4.2)
        a[rm] = hexc(ramp[2])
        stamp(a, mark, 7, 7, {'x': ramp[5]})
        out(a, name)

    lion = ['.x.x.', 'xxxxx', '.xxx.', '.x.x.']
    seal('seal', RED, lion, 19)
    seal('seal-gold', [GOLD[0], GOLD[0], GOLD[1], GOLD[2], GOLD[3], GOLD[4]], lion, 20)
    seal('seal-grey', [ASH[0], ASH[1], ASH[2], ASH[3], ASH[4], ASH[5]], ['.....', '.xxx.', '.x.x.', '.xxx.'], 21)

    # Compass rose, 17x17.
    a = canvas(17, 17)
    stamp(a, [
        '........g........',
        '.......ggg.......',
        '.......gGg.......',
        '......ggGgg......',
        '.......gGg.......',
        '..i....gGg....i..',
        '...ii..gGg..ii...',
        '....iiigGgiii....',
        '.iiiiiiioiiiiiii.',
        '....iiidDdiii....',
        '...ii..dDd..ii...',
        '..i....dDd....i..',
        '.......dDd.......',
        '......ddDdd......',
        '.......dDd.......',
        '.......ddd.......',
        '........d........'], 0, 0,
        {'g': GOLD[3], 'G': GOLD[4], 'i': IRON['md'], 'o': GOLD[2], 'd': IRON['dk'], 'D': IRON['lt']})
    out(a, 'compass')

    # Gold rule, 8x5, repeat-x: section dividers.
    a = canvas(8, 5)
    a[1, :] = hexc(GOLD[4])
    a[2, :] = hexc(GOLD[2])
    a[3, :] = hexc(GOLD[0])
    stamp(a, ['.g.', 'gGg', 'gGg', '.g.'], 3, 0, {'g': GOLD[1], 'G': GOLD[4]})
    a[0, 4] = hexc(GOLD[3])
    out(a, 'rule')

    # Hanging cloth banners for the end of a match, 48x72,
    # slice 10 top / 8 sides / 20 bottom. The rod is iron with gold finials;
    # the bottom edge is dagged (repeating tongues) so it tiles across.
    def cloth(name: str, ramp: list[str], trim: tuple[str, str], seed: int, torn: bool) -> None:
        W, H = 48, 72
        a = canvas(W, H)
        folds = (np.sin(np.arange(W) / W * np.pi * 6) * 0.5 + 0.5)[None, :]
        f = fbm(W, H, 12, 24, seed, 3) * 0.45 + folds * 0.55
        cloth_tex = quantize(f, ramp, 0.8)
        top = 10
        a[top:H] = cloth_tex[top:H]
        # side trim, with a transparent margin outside it
        for x in (2, W - 3):
            a[top:H, x] = hexc(trim[0])
        for x in (3, W - 4):
            a[top:H, x] = hexc(trim[1])
        a[top:H, 0:2] = 0
        a[top:H, W - 2:W] = 0
        # dagged or torn bottom
        yy, xx = np.mgrid[0:H, 0:W]
        if torn:
            n = value_noise(W, H, 3, 3, seed + 3)
            edge = H - 4 - (n * 14).astype(int)
            a[yy > edge] = 0
            burnt = (yy > edge - 2) & (yy <= edge)
            a[burnt & (a[..., 3] > 0)] = hexc(ramp[0])
        else:
            period = 8
            phase = np.abs(((xx % period) + 0.5) - period / 2) / (period / 2)  # 0 at tongue centre
            tip = H - 3 - (phase * 10).astype(int)
            a[yy > tip] = 0
            band = (yy > tip - 3) & (yy <= tip) & (a[..., 3] > 0)
            a[band] = hexc(trim[0])
            a[(yy > tip - 4) & (yy == tip - 3) & (a[..., 3] > 0)] = hexc(trim[1])
        # rod
        a[0:top, :] = 0
        rod = np.zeros((H, W), bool)
        rod[3:8, 0:W] = True
        rc = canvas(W, H)
        shade_mask(rc, rod, IRON['md'], IRON['hi'], IRON['bk'], OUTL)
        paste(a, rc)
        a[8:top, 2:W - 2] = hexc(SHADOW)
        out(a, name)

    cloth('cloth-victory', RED[1:6], (GOLD[3], GOLD[1]), 52, torn=False)
    cloth('cloth-defeat', ASH[0:5], (ASH[5], ASH[2]), 53, torn=True)


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    gen_surfaces()
    gen_frames()
    gen_buttons()
    gen_ornaments()
    if '--sheet' in sys.argv:
        dest = sys.argv[sys.argv.index('--sheet') + 1]
        contact_sheet(sorted(written), dest)
    print(f'wrote {len(written)} textures to {os.path.relpath(OUT, ROOT)}')


if __name__ == '__main__':
    main()
