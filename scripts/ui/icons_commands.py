"""Command, tech and stat icons for gen_icons.py, drawn on a 30 unit grid
(stat icons on 16). Steel, wood, leather, red and gold, lit from the top left."""
from __future__ import annotations

import math

import numpy as np

from iconkit import Icon, Prim, hash01, sdf_poly, sdf_ring


def _rot(pts, cx, cy, ang):
    c, s = math.cos(ang), math.sin(ang)
    return [(cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c) for x, y in pts]


def _blade(ic: Icon, a, b, w, ramp='steel', level=0.66, tip=0.32):
    """A straight blade from hilt a to point b, width w, with a ridge."""
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    n = math.hypot(dx, dy)
    ux, uy = dx / n, dy / n
    px, py = -uy, ux
    t = 1 - tip
    mx, my = ax + dx * t, ay + dy * t
    pts = [(ax + px * w / 2, ay + py * w / 2), (mx + px * w / 2, my + py * w / 2), (bx, by),
           (mx - px * w / 2, my - py * w / 2), (ax - px * w / 2, ay - py * w / 2)]
    ic.poly(pts, ramp, shade='bevel', level=level, bevel=w * 0.45, edge=True)


def _token(ic: Icon, x, y, s=1.0):
    """A little soldier: blue shoulders, a face, a steel kettle hat."""
    ic.ellipse(x, y + 2.4 * s, 2.7 * s, 2.0 * s, 'blue', shade='sphere', level=0.62, edge=True, clip=lambda xx, yy: yy - (y + 3.6 * s))
    ic.circle(x, y, 1.55 * s, 'skin', level=0.78, edge=True)
    ic.ellipse(x, y - 1.3 * s, 1.9 * s, 1.5 * s, 'steel', shade='sphere', level=0.7, clip=lambda xx, yy: yy - (y - 0.9 * s))
    ic.ellipse(x, y - 0.9 * s, 2.9 * s, 0.75 * s, 'steel', shade='flat', level=0.52, edge=True)


# ---------------------------------------------------------------------------
# commands (30)
# ---------------------------------------------------------------------------

def advance_age() -> Icon:
    ic = Icon(30)
    # velvet cap behind the points
    ic.ellipse(15, 13, 8.5, 6.5, 'red', shade='sphere', level=0.55, clip=lambda x, y: y - 17)
    # five points
    pts = [(5, 19), (5.6, 9.5), (9.4, 14.4), (11.4, 7.0), (15, 12.6), (18.6, 7.0), (20.6, 14.4), (24.4, 9.5), (25, 19)]
    ic.poly(pts, 'gold', shade='bevel', level=0.62, bevel=1.4, edge=True)
    for (x, y) in [(5.6, 8.6), (11.4, 6.0), (18.6, 6.0), (24.4, 8.6)]:
        ic.circle(x, y, 1.5, 'white', level=0.7, edge=True)
    ic.circle(15, 10.8, 1.8, 'gold', level=0.7, edge=True)
    # band with jewels
    ic.rect(4.4, 18.0, 25.6, 23.6, 'gold', shade='bevel', level=0.56, bevel=1.4, edge=True)
    ic.ellipse(15, 20.8, 2.0, 1.8, 'red', level=0.7, edge=True)
    ic.ellipse(9.0, 20.8, 1.4, 1.4, 'blue', level=0.7, edge=True)
    ic.ellipse(21.0, 20.8, 1.4, 1.4, 'blue', level=0.7, edge=True)
    # rising chevron
    ic.poly([(9.5, 29.0), (15, 25.4), (20.5, 29.0), (20.5, 30.0), (15, 27.4), (9.5, 30.0)], 'gold', shade='flat', level=0.8, edge=True)
    return ic


def rally() -> Icon:
    ic = Icon(30)
    ic.ellipse(10, 27.2, 6.5, 2.0, 'green', shade='sphere', level=0.5)
    ic.capsule((9.2, 27.6), (9.2, 4.6), 1.1, 'wood', level=0.55, edge=True)
    # swallowtail banner with a soft wave
    top = [(10.0, 4.8), (14, 4.0), (18, 5.4), (22, 4.6), (27.4, 5.0)]
    bot = [(27.4, 17.4), (23.0, 13.6), (22.4, 17.0), (18, 16.0), (14, 17.6), (10.0, 16.6)]
    ic.poly(top + bot, 'red', shade='bevel', level=0.58, bevel=2.0, edge=True)
    # gold hoist band and a gold roundel
    ic.rect(10.2, 4.8, 12.4, 16.6, 'gold', shade='flat', level=0.62)
    ic.circle(18.0, 10.4, 2.6, 'gold', level=0.66, edge=True)
    ic.circle(9.2, 3.4, 1.9, 'gold', level=0.7, edge=True)
    return ic


def demolish() -> Icon:
    ic = Icon(30)
    # cracked block
    ic.poly([(3, 28), (3.6, 20.4), (10.6, 18.6), (12.0, 22.6), (15.8, 21.0), (19.4, 22.2), (20.6, 28)], 'stone', shade='bevel', level=0.56, bevel=1.6, edge=True)
    ic.poly([(3.6, 20.4), (6.8, 17.4), (13.0, 16.4), (10.6, 18.6)], 'stone', shade='flat', level=0.86, edge=True)
    for (x, y, r) in [(22.8, 26.6, 1.6), (25.4, 23.2, 1.1), (17.6, 17.2, 1.0), (24.6, 28.0, 1.0)]:
        ic.circle(x, y, r, 'stone', level=0.6, edge=True)
    # sledgehammer
    ic.capsule((7.2, 24.6), (20.6, 8.8), 1.3, 'wood', level=0.58, edge=True)
    head = _rot([(15.8, 3.6), (26.6, 3.6), (26.6, 9.4), (15.8, 9.4)], 21.2, 6.5, 0.72)
    ic.poly(head, 'iron', shade='bevel', level=0.7, bevel=1.4, edge=True)

    def cracks(x, y):
        m = (np.abs((x - 9.4) - (y - 21.0) * 0.6) < 0.5) & (y > 21) & (y < 26.4)
        m |= (np.abs((y - 24.6) + (x - 13.0) * 0.3) < 0.5) & (x > 11.0) & (x < 16.4)
        return m
    ic.detail(cracks, '#25231f')
    return ic


def hold() -> Icon:
    ic = Icon(30)
    # planted spear behind
    ic.capsule((23.4, 29.0), (23.4, 6.0), 0.9, 'wood', level=0.5, edge=True)
    ic.poly([(23.4, 0.8), (25.4, 5.0), (23.4, 7.6), (21.4, 5.0)], 'steel', shade='bevel', level=0.7, bevel=1.0, edge=True)
    # heater shield: steel rim, red field, gold boss
    outer = [(4.0, 5.0), (22.0, 5.0), (22.0, 15.0), (20.4, 21.4), (13.0, 28.4), (5.6, 21.4), (4.0, 15.0)]
    inner = [(6.2, 7.2), (19.8, 7.2), (19.8, 14.8), (18.4, 20.4), (13.0, 25.6), (7.6, 20.4), (6.2, 14.8)]
    ic.poly(outer, 'steel', shade='bevel', level=0.62, bevel=1.6, edge=True)
    ic.poly(inner, 'red', shade='bevel', level=0.58, bevel=2.6)
    ic.rect(11.8, 7.2, 14.2, 25.0, 'white', shade='flat', level=0.66)
    ic.circle(13.0, 14.6, 2.6, 'gold', level=0.66, edge=True)
    return ic


def auto_defend() -> Icon:
    ic = Icon(30)
    for flip in (1, -1):
        cx = 15
        hx = cx - flip * 9.6
        _blade(ic, (cx - flip * 5.2, 20.6), (cx + flip * 10.4, 3.0), 3.0)
        ic.capsule((hx, 26.4), (cx - flip * 6.4, 22.0), 1.2, 'leather', level=0.55, edge=True)
        ic.capsule((cx - flip * 8.6, 18.0), (cx - flip * 2.6, 23.4), 1.1, 'gold', level=0.62, edge=True)
        ic.circle(hx - flip * 0.6, 27.0, 1.6, 'gold', level=0.66, edge=True)
    return ic


def formation_free() -> Icon:
    ic = Icon(30)
    for (x, y) in [(8.2, 6.6), (21.0, 5.0), (14.4, 13.4), (25.0, 16.0), (6.0, 19.8), (17.4, 23.6)]:
        _token(ic, x, y)
    return ic


def formation_line() -> Icon:
    ic = Icon(30)
    ic.rect(1.6, 19.6, 28.4, 21.0, 'leather', shade='flat', level=0.5)
    for x in (4.2, 9.6, 15.0, 20.4, 25.8):
        _token(ic, x, 14.6)
    return ic


def formation_compact() -> Icon:
    ic = Icon(30)
    for y in (6.6, 13.4, 20.2):
        for x in (8.4, 15.0, 21.6):
            _token(ic, x, y, 0.95)
    return ic


def _turn(ic: Icon, ccw: bool) -> None:
    # an arc around a little line of soldiers, open at the top; screen y points
    # down, so a growing angle turns clockwise
    a0, a1 = math.radians(-24), math.radians(204)
    r = 10.6
    ring = sdf_ring(15, 16.4, r, 1.6, a0, a1)
    ic.add(Prim(ring, 'gold', 'bevel', level=0.62, bevel=1.0, edge=True))
    end = a0 if ccw else a1
    ex, ey = 15 + r * math.cos(end), 16.4 + r * math.sin(end)
    tx, ty = (math.sin(end), -math.cos(end)) if ccw else (-math.sin(end), math.cos(end))
    nx, ny = math.cos(end), math.sin(end)
    head = [(ex + nx * 3.4 - tx * 0.8, ey + ny * 3.4 - ty * 0.8), (ex + tx * 5.2, ey + ty * 5.2), (ex - nx * 3.4 - tx * 0.8, ey - ny * 3.4 - ty * 0.8)]
    ic.poly(head, 'gold', shade='bevel', level=0.66, bevel=1.2, edge=True)
    for x in (10.2, 15.0, 19.8):
        _token(ic, x, 16.6, 0.85)


def rotate_ccw() -> Icon:
    ic = Icon(30)
    _turn(ic, True)
    return ic


def rotate_cw() -> Icon:
    ic = Icon(30)
    _turn(ic, False)
    return ic


def stop() -> Icon:
    """A raised steel gauntlet, palm out."""
    ic = Icon(30)
    ic.rect(9.6, 22.2, 21.4, 29.2, 'leather', shade='bevel', level=0.5, bevel=1.4, edge=True)
    ic.rect(8.6, 21.0, 22.4, 23.4, 'steel', shade='bevel', level=0.56, bevel=0.8, edge=True)
    ic.capsule((7.2, 19.2), (3.4, 12.0), 1.9, 'steel', level=0.6, edge=True)
    for x, top in ((10.0, 6.2), (13.6, 3.8), (17.2, 4.2), (20.6, 7.2)):
        ic.capsule((x, 16.0), (x, top), 1.65, 'steel', level=0.64, edge=True)
    ic.poly([(8.0, 13.4), (22.4, 13.4), (22.2, 19.4), (19.4, 22.0), (10.6, 22.0), (8.0, 19.4)], 'steel', shade='bevel', level=0.6, bevel=2.2, edge=True)

    def joints(x, y):
        m = np.zeros(x.shape, bool)
        for xx, top in ((10.0, 6.2), (13.6, 3.8), (17.2, 4.2), (20.6, 7.2)):
            jy = top + (16.0 - top) * 0.45
            m |= (np.abs(y - jy) < 0.45) & (np.abs(x - xx) < 1.3)
        return m
    ic.detail(joints, '#343a44')
    return ic


def more() -> Icon:
    ic = Icon(30)
    for x0 in (6.0, 14.4):
        ic.poly([(x0, 7.0), (x0 + 4.0, 7.0), (x0 + 10.0, 15.0), (x0 + 4.0, 23.0), (x0, 23.0), (x0 + 6.0, 15.0)], 'gold', shade='bevel', level=0.62, bevel=1.2, edge=True)
    return ic


def research() -> Icon:
    """A sealed scroll."""
    ic = Icon(30)
    ic.poly([(7.0, 7.0), (23.0, 5.0), (24.0, 23.0), (8.0, 25.0)], 'linen', shade='bevel', level=0.72, bevel=2.0, edge=True)
    ic.capsule((5.4, 7.4), (24.6, 5.0), 2.2, 'linen', level=0.6, edge=True)
    ic.capsule((6.4, 25.0), (25.6, 22.6), 2.2, 'linen', level=0.56, edge=True)

    def lines(x, y):
        m = np.zeros(x.shape, bool)
        for i, yy in enumerate((10.6, 13.6, 16.6)):
            yl = yy - (x - 8) * 0.12
            m |= (np.abs(y - yl) < 0.45) & (x > 10) & (x < 21 - i * 2)
        return m
    ic.detail(lines, '#857256')
    ic.circle(20.0, 21.0, 3.0, 'red', level=0.6, edge=True)
    ic.poly([(18.4, 23.4), (17.0, 28.4), (19.4, 26.6), (21.0, 28.6), (21.4, 23.6)], 'red', shade='flat', level=0.45, edge=True)
    return ic


# ---------------------------------------------------------------------------
# tech (30)
# ---------------------------------------------------------------------------

def tech_axe() -> Icon:
    ic = Icon(30)
    ic.ellipse(16, 25.4, 10.5, 3.4, 'cut', shade='sphere', level=0.6, edge=True)
    ic.ellipse(16, 24.6, 7.0, 1.8, 'cut', shade='flat', level=0.82)
    ic.capsule((8.0, 27.6), (19.6, 5.0), 1.3, 'wood', level=0.58, edge=True)
    blade = [(16.0, 4.4), (21.4, 6.8), (27.6, 2.6), (28.4, 12.6), (22.6, 10.6), (17.2, 11.6)]
    ic.poly(blade, 'steel', shade='bevel', level=0.64, bevel=1.6, edge=True)

    def edge_hi(x, y):
        return (np.abs(x - 27.4) < 0.5) & (y > 4.0) & (y < 11.0)
    ic.detail(edge_hi, '#e8eef3')
    return ic


def tech_pick() -> Icon:
    ic = Icon(30)
    ic.poly([(16.6, 28.6), (18.0, 22.0), (23.4, 19.4), (28.4, 22.6), (28.6, 28.6)], 'stone', shade='bevel', level=0.58, bevel=1.8, edge=True)
    ic.circle(22.4, 24.4, 1.4, 'gold', level=0.8)
    ic.circle(25.6, 26.4, 1.1, 'gold', level=0.8)
    ic.capsule((5.4, 27.4), (19.4, 8.4), 1.3, 'wood', level=0.58, edge=True)
    head = sdf_ring(19.0, 20.6, 15.0, 1.6, math.radians(232), math.radians(318))
    ic.add(Prim(head, 'steel', 'bevel', level=0.66, bevel=1.0, edge=True))
    return ic


def tech_castle() -> Icon:
    ic = Icon(30)
    # side towers
    for x0 in (2.4, 21.0):
        ic.rect(x0, 11.6, x0 + 6.6, 28.6, 'stone', shade='bevel', level=0.6, bevel=1.2, edge=True)
        ic.poly([(x0 - 0.8, 12.0), (x0 + 3.3, 3.4), (x0 + 7.4, 12.0)], 'red', shade='bevel', level=0.58, bevel=1.6, edge=True)
    # keep with merlons
    ic.rect(8.4, 9.6, 21.6, 28.6, 'stone', shade='bevel', level=0.66, bevel=1.4, edge=True)
    for x in (8.4, 12.8, 17.2):
        ic.rect(x, 6.6, x + 3.0, 9.8, 'stone', shade='bevel', level=0.7, bevel=0.8, edge=True)
    ic.poly([(12.4, 28.6), (12.4, 22.6), (15.0, 20.0), (17.6, 22.6), (17.6, 28.6)], 'wood', shade='flat', level=0.25, edge=True)
    ic.rect(14.2, 12.6, 15.8, 16.6, 'iron', shade='flat', level=0.1)
    # banner
    ic.capsule((15.0, 6.8), (15.0, 0.8), 0.5, 'wood', level=0.5)
    ic.poly([(15.4, 0.8), (21.0, 2.0), (15.4, 4.2)], 'blue', shade='flat', level=0.66, edge=True)
    return ic


def tech_gunpowder() -> Icon:
    ic = Icon(30)
    # cannonballs
    for (x, y) in [(22.4, 25.6), (26.6, 25.8), (24.4, 22.0)]:
        ic.circle(x, y, 2.4, 'iron', level=0.7, edge=True)
    # keg: barrel body, iron hoops, top lid
    body = lambda x, y: np.maximum(np.abs(x - 11.0) - (7.0 - ((y - 17.5) / 9.0) ** 2 * 1.4), np.abs(y - 17.5) - 9.0)  # noqa: E731
    ic.add(Prim(body, 'wood', 'cyl', level=0.6, seg=(11.0, 8.5, 11.0, 26.5, 7.0, 7.0), edge=True))
    for y in (11.6, 23.4):
        ic.rect(4.4, y - 1.0, 17.6, y + 1.0, 'iron', shade='flat', level=0.6)

    def staves(x, y):
        return ((np.abs(((x - 11.0) / 2.6) % 1.0 - 0.5) < 0.09) & (np.abs(y - 17.5) < 8.6))
    ic.detail(staves, '#4f3018')
    ic.ellipse(11.0, 8.6, 6.0, 1.8, 'cut', shade='flat', level=0.6, edge=True)
    # fuse and spark
    ic.capsule((11.6, 8.0), (16.4, 3.6), 0.6, 'linen', level=0.4)
    ic.circle(17.2, 3.0, 1.8, 'ember', shade='sphere', level=0.8)
    for (dx, dy) in [(2.6, -1.4), (2.2, 1.6), (-0.4, -2.6), (3.2, 0.2)]:
        ic.circle(17.2 + dx, 3.0 + dy, 0.7, 'ember', shade='none', level=0.95)
    return ic


# ---------------------------------------------------------------------------
# stat icons (16), shown on parchment in the selection sheet
# ---------------------------------------------------------------------------

def stat_attack() -> Icon:
    ic = Icon(16)
    _blade(ic, (5.0, 11.0), (14.6, 1.4), 2.4)
    ic.capsule((2.6, 8.4), (7.6, 13.4), 0.9, 'gold', level=0.6, edge=True)
    ic.capsule((1.8, 14.2), (4.8, 11.2), 0.9, 'leather', level=0.55, edge=True)
    return ic


def stat_range() -> Icon:
    ic = Icon(16)
    bow = sdf_ring(3.0, 13.0, 11.0, 0.9, math.radians(268), math.radians(2))
    ic.add(Prim(bow, 'wood', 'bevel', level=0.6, bevel=0.6, edge=True))
    ic.capsule((3.4, 2.2), (13.8, 12.6), 0.25, 'linen', shade='none', level=0.8)
    ic.capsule((3.6, 12.4), (12.4, 3.6), 0.5, 'wood', level=0.6)
    ic.poly([(14.6, 1.4), (10.6, 2.8), (13.2, 5.4)], 'steel', shade='flat', level=0.7, edge=True)
    ic.poly([(2.0, 11.6), (4.6, 12.4), (3.6, 14.4), (1.4, 14.6)], 'red', shade='flat', level=0.6)
    return ic


def stat_speed() -> Icon:
    ic = Icon(16)
    ic.poly([(6.0, 1.8), (10.6, 1.8), (10.6, 9.6), (14.8, 11.2), (14.8, 14.2), (5.4, 14.2)], 'leather', shade='bevel', level=0.6, bevel=1.2, edge=True)
    ic.rect(5.4, 12.6, 14.8, 14.2, 'iron', shade='flat', level=0.4)
    for y, x0 in ((5.0, 0.6), (8.4, 1.6), (11.6, 0.4)):
        ic.rect(x0, y - 0.5, x0 + 3.4, y + 0.5, 'linen', shade='flat', level=0.75)
    return ic


def stat_hp() -> Icon:
    ic = Icon(16)
    ic.poly([(2.0, 2.0), (14.0, 2.0), (14.0, 8.0), (8.0, 14.8), (2.0, 8.0)], 'steel', shade='bevel', level=0.6, bevel=1.0, edge=True)
    ic.poly([(3.6, 3.6), (12.4, 3.6), (12.4, 7.6), (8.0, 12.4), (3.6, 7.6)], 'red', shade='bevel', level=0.6, bevel=1.6)
    return ic


def stat_build() -> Icon:
    ic = Icon(16)
    ic.capsule((2.6, 14.0), (10.4, 5.4), 0.9, 'wood', level=0.58, edge=True)
    head = _rot([(6.6, 1.6), (15.0, 1.6), (15.0, 5.4), (6.6, 5.4)], 10.8, 3.5, 0.75)
    ic.poly(head, 'iron', shade='bevel', level=0.72, bevel=0.9, edge=True)
    return ic


COMMAND_ICONS = {
    'advance-age': advance_age, 'rally': rally, 'demolish': demolish, 'hold': hold, 'auto-defend': auto_defend,
    'formation-free': formation_free, 'formation-line': formation_line, 'formation-compact': formation_compact,
    'rotate-ccw': rotate_ccw, 'rotate-cw': rotate_cw, 'stop': stop, 'more': more, 'research': research,
    'tech-axe': tech_axe, 'tech-pick': tech_pick, 'tech-castle': tech_castle, 'tech-gunpowder': tech_gunpowder,
}
STAT_ICONS = {
    'stat-attack': stat_attack, 'stat-range': stat_range, 'stat-speed': stat_speed, 'stat-hp': stat_hp, 'stat-build': stat_build,
}

__all__ = ['COMMAND_ICONS', 'STAT_ICONS', 'hash01', 'sdf_poly']
