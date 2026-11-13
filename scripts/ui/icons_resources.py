"""Resource and small HUD icons for gen_icons.py: wheat, logs, gold, stone,
population, time. Drawn on a 20 unit grid and scaled for the 16 px variants."""
from __future__ import annotations

import math

import numpy as np

from iconkit import Icon, hash01, sdf_ellipse, sdf_union


def food(n: int = 20) -> Icon:
    """A wheat sheaf tied with twine."""
    k = n / 20
    ic = Icon(n)
    cx = 10 * k
    waist = 12.6 * k
    # stalks: a wide fan of ears above the band, a tight bundle below it
    tops = [-6.0, -3.6, -1.2, 1.2, 3.6, 6.0]
    bots = [-2.9, -1.7, -0.6, 0.6, 1.7, 2.9]
    for i, (t, b) in enumerate(zip(tops, bots)):
        w = t * 0.28
        ic.capsule((cx + w * k, waist), (cx + b * k, 18.6 * k), 0.75 * k, 'wheat', level=0.55 - 0.04 * (i % 2))
    for i, t in enumerate(tops):
        ic.capsule((cx + t * 0.28 * k, waist), (cx + t * k, 6.2 * k), 0.7 * k, 'wheat', level=0.5)
    # ears: plump grain heads leaning out
    for i, t in enumerate(tops):
        ang = math.atan2(-(6.2 - 1.6) * k, t * 0.75 * k) + math.pi / 2
        ex = cx + t * 1.12 * k
        ey = (4.0 + abs(t) * 0.22) * k
        ic.ellipse(ex, ey, 1.35 * k, 3.0 * k, 'wheat', rot=-ang * 0.35 * (1 if t > 0 else -1) + (0.25 if t > 0 else -0.25),
                   shade='sphere', level=0.66, bias=0.05)
    # twine band
    ic.rect(cx - 3.0 * k, waist - 1.1 * k, cx + 3.0 * k, waist + 1.1 * k, 'red', shade='bevel', level=0.55, bevel=0.8 * k, edge=True)
    # grain notches on the ears
    def notches(x, y):
        m = np.zeros(x.shape, bool)
        for t in tops:
            ex = cx + t * 1.12 * k
            ey = (4.0 + abs(t) * 0.22) * k
            m |= (np.abs(x - ex) < 0.45 * k) & (np.abs(((y - ey) / k) % 2.0 - 1.0) < 0.35) & (np.abs(y - ey) < 2.0 * k)
        return m
    if n >= 20:
        ic.detail(notches, '#9a6a1c')
    return ic


def wood(n: int = 20) -> Icon:
    """Three logs stacked, pale cut ends toward the viewer."""
    k = n / 20
    ic = Icon(n)
    logs = [(5.6, 14.0), (13.0, 14.0), (9.3, 7.8)]
    r = 3.5 * k
    L = 4.6 * k  # visible length toward the back-right
    dx, dy = 0.86, -0.5
    for (x, y) in logs:
        x, y = x * k, y * k
        bx, by = x + dx * L, y + dy * L
        ic.capsule((x, y), (bx, by), r, 'bark', level=0.55, edge=True)
        # the cut end: an ellipse facing front-left
        ic.ellipse(x, y, r * 0.86, r, 'cut', rot=0.5, shade='sphere', level=0.62, bias=0.08, edge=True, edge_color='#3f2412')

    # growth rings
    def rings(x, y):
        m = np.zeros(x.shape, bool)
        for (lx, ly) in logs:
            lx, ly = lx * k, ly * k
            d = np.hypot((x - lx) / 0.86, y - ly)
            m |= (np.abs(d - 1.7 * k) < 0.42 * max(k, 0.8)) & (x < lx + 0.5 * k)
            m |= d < 0.55 * k
        return m
    ic.detail(rings, '#9a7244')
    return ic


def gold(n: int = 20) -> Icon:
    """A short stack of coins and a nugget."""
    k = n / 20
    ic = Icon(n)
    # coin stack (back right)
    for i in range(4):
        y = (15.5 - i * 2.0) * k
        ic.ellipse(13.0 * k, y + 0.9 * k, 5.0 * k, 2.3 * k, 'gold', shade='flat', level=0.42)
        ic.ellipse(13.0 * k, y, 5.0 * k, 2.3 * k, 'gold', shade='sphere', level=0.7, edge=i == 0)
    # front coins lying flat
    ic.ellipse(6.4 * k, 16.4 * k, 4.6 * k, 2.1 * k, 'gold', shade='flat', level=0.42, edge=True)
    ic.ellipse(6.4 * k, 15.6 * k, 4.6 * k, 2.1 * k, 'gold', shade='sphere', level=0.72)
    # nugget
    ic.poly([(3.0 * k, 11.6 * k), (4.6 * k, 7.6 * k), (7.6 * k, 6.4 * k), (10.2 * k, 8.4 * k), (9.6 * k, 12.4 * k), (6.4 * k, 13.6 * k)],
            'gold', shade='bevel', level=0.6, bevel=2.2 * k, edge=True)

    def marks(x, y):
        # coin face rims and a glint
        m = np.abs(sdf_ellipse(13.0 * k, 9.5 * k, 3.4 * k, 1.4 * k)(x, y)) < 0.35 * max(k, 0.85)
        m &= y > 9.5 * k
        g = (np.abs(x - 5.6 * k) < 0.5 * k) & (np.abs(y - 8.6 * k) < 0.5 * k)
        return m | g
    ic.detail(marks, '#b67a12')
    return ic


def _block(ic: Icon, k: float, x, y, w, h, d, lv=0.0, jag=None) -> None:
    """A hewn block in 3/4 view; x, y = front bottom-left corner, depth d to the back right."""
    ox, oy = d * 0.85, -d * 0.55
    j = jag or [0.0] * 4
    front = [(x + j[0] * k, y - h), (x + w, y - h + j[1] * k), (x + w, y), (x, y + j[2] * k)]
    top = [(x + j[0] * k, y - h), (x + ox, y - h + oy), (x + w + ox, y - h + oy + j[3] * k), (x + w, y - h + j[1] * k)]
    side = [(x + w, y - h + j[1] * k), (x + w + ox, y - h + oy + j[3] * k), (x + w + ox, y + oy), (x + w, y)]
    ic.poly(front, 'stone', shade='bevel', level=0.58 + lv, bevel=1.0 * k, edge=True)
    ic.poly(top, 'stone', shade='bevel', level=0.86 + lv, bevel=0.8 * k, edge=True)
    ic.poly(side, 'stone', shade='flat', level=0.32 + lv, edge=True)


def _ashlar(ic: Icon, k: float, x0, y0, x1, y1, depth=2.2, lv=0.0) -> None:
    """A dressed block seen almost from the front: a lit top strip and a bevelled face."""
    d = depth * k
    ic.poly([(x0, y0), (x0 + d * 0.7, y0 - d), (x1 + d * 0.7, y0 - d), (x1, y0)], 'stone', shade='flat', level=0.88 + lv, edge=True)
    ic.poly([(x1, y0), (x1 + d * 0.7, y0 - d), (x1 + d * 0.7, y1 - d), (x1, y1)], 'stone', shade='flat', level=0.28 + lv, edge=True)
    ic.rect(x0, y0, x1, y1, 'stone', shade='bevel', level=0.6 + lv, bevel=1.3 * k, edge=True)


def stone(n: int = 20) -> Icon:
    """Three dressed blocks stacked, lit top and left, with tool marks."""
    k = n / 20
    ic = Icon(n)
    _ashlar(ic, k, 0.8 * k, 12.4 * k, 9.4 * k, 19.2 * k, lv=-0.04)
    _ashlar(ic, k, 9.4 * k, 12.4 * k, 17.6 * k, 19.2 * k, lv=-0.1)
    _ashlar(ic, k, 4.6 * k, 5.4 * k, 13.4 * k, 12.4 * k, lv=0.02)

    def specks(x, y):
        return hash01(x, y, 7, 1.0 / max(1.0, n / 20)) > 0.92
    ic.detail(specks, '#7a756b')
    return ic

    def specks(x, y):
        return hash01(x, y, 7, 1.0 / max(1.0, n / 20)) > 0.9
    ic.detail(specks, '#77746c')
    return ic


def pop(n: int = 20) -> Icon:
    """A villager in a straw hat and a soldier in a kettle helmet behind him."""
    k = n / 20
    ic = Icon(n)
    # soldier (back right): linen tunic, steel kettle hat
    ic.poly([(9.4 * k, 19.4 * k), (10.0 * k, 13.4 * k), (12.6 * k, 11.4 * k), (16.6 * k, 11.4 * k), (19.2 * k, 13.4 * k), (19.6 * k, 19.4 * k)],
            'linen', shade='bevel', level=0.46, bevel=1.6 * k, edge=True)
    ic.circle(14.6 * k, 8.0 * k, 3.0 * k, 'skin', level=0.66)
    ic.ellipse(14.6 * k, 5.6 * k, 2.9 * k, 2.6 * k, 'steel', shade='sphere', level=0.62, clip=lambda x, y: y - 6.2 * k)
    ic.ellipse(14.6 * k, 6.2 * k, 4.8 * k, 1.1 * k, 'steel', shade='flat', level=0.5, edge=True)
    # villager (front left): team blue tunic, straw hat
    ic.poly([(0.6 * k, 19.6 * k), (1.2 * k, 14.2 * k), (4.0 * k, 12.2 * k), (8.8 * k, 12.2 * k), (11.6 * k, 14.4 * k), (12.2 * k, 19.6 * k)],
            'blue', shade='bevel', level=0.62, bevel=1.8 * k, edge=True)
    ic.circle(6.4 * k, 9.0 * k, 3.3 * k, 'skin', level=0.78, edge=True)
    ic.ellipse(6.4 * k, 6.0 * k, 2.8 * k, 2.4 * k, 'wheat', shade='sphere', level=0.7, clip=lambda x, y: y - 6.8 * k)
    ic.ellipse(6.4 * k, 6.8 * k, 5.8 * k, 1.4 * k, 'wheat', shade='sphere', level=0.62, edge=True)

    def eyes(x, y):
        m = np.zeros(x.shape, bool)
        for ex in (5.4, 7.8):
            m |= (np.abs(x - ex * k) < 0.5 * k) & (np.abs(y - 9.4 * k) < 0.55 * k)
        for ex in (13.8, 15.8):
            m |= (np.abs(x - ex * k) < 0.5 * k) & (np.abs(y - 8.6 * k) < 0.55 * k)
        return m
    ic.detail(eyes, '#1e1410')
    return ic


def time(n: int = 20) -> Icon:
    """An hourglass: wooden caps, glass bulbs, running sand."""
    k = n / 20
    ic = Icon(n)
    cx = 10 * k
    ic.capsule((4.6 * k, 3.0 * k), (4.6 * k, 17.0 * k), 0.9 * k, 'wood', level=0.5)
    ic.capsule((15.4 * k, 3.0 * k), (15.4 * k, 17.0 * k), 0.9 * k, 'wood', level=0.5)
    bulbs = sdf_union(sdf_ellipse(cx, 6.6 * k, 4.4 * k, 4.0 * k), sdf_ellipse(cx, 13.4 * k, 4.4 * k, 4.0 * k),
                      lambda x, y: np.maximum(np.abs(x - cx) - 1.2 * k, np.abs(y - 10 * k) - 2 * k))
    from iconkit import Prim
    ic.add(Prim(bulbs, 'glass', 'flat', level=0.55))
    ic.ellipse(cx, 14.6 * k, 3.6 * k, 2.6 * k, 'sand', shade='sphere', level=0.62, clip=lambda x, y: 12.6 * k - y)
    ic.ellipse(cx, 5.8 * k, 3.2 * k, 1.6 * k, 'sand', shade='sphere', level=0.6, clip=lambda x, y: 5.6 * k - y)
    ic.rect(cx - 0.5 * k, 7.0 * k, cx + 0.5 * k, 13.0 * k, 'sand', shade='none', level=0.7)
    ic.rect(2.6 * k, 1.4 * k, 17.4 * k, 3.4 * k, 'wood', shade='bevel', level=0.6, bevel=0.8 * k, edge=True)
    ic.rect(2.6 * k, 16.6 * k, 17.4 * k, 18.6 * k, 'wood', shade='bevel', level=0.5, bevel=0.8 * k, edge=True)

    def glint(x, y):
        return (np.abs(x - 7.6 * k) < 0.5 * k) & (y > 4.6 * k) & (y < 7.6 * k)
    ic.detail(glint, '#e6f0f0')
    return ic


RESOURCE_ICONS = {'food': food, 'wood': wood, 'gold': gold, 'stone': stone, 'pop': pop, 'time': time}
