"""Shared building composition helpers (halls, banners, chimneys, stairs).

Used by buildings.py. Kept separate so the per-building recipes stay short.
"""

from __future__ import annotations

import math

from kr_kit import STYLES, B, Style

DOOR_W = 0.24
DOOR_H = 0.52  # a villager is about 0.6 units tall


def hall(b: B, x0: float, y0: float, x1: float, y1: float, wall_h: float, st: Style,
         roof: str = "gable", axis: str = "x", pitch: float | None = None, overhang: float | None = None,
         doors: tuple = (), windows: tuple = (), frame: bool = True, base: bool = True,
         wall_m: str | None = None, roof_m: str | None = None, z0: float = 0.0,
         shutters: str | None = None, gable_m: str | None = None, ridge: bool = True,
         arch_doors: bool = False) -> float:
    """A rectangular building body with roof. Returns the roof ridge height.

    doors: (side, t) or (side, t, w, h); windows: (side, t, z, w, h).
    """
    wall_m = wall_m or st.wall
    roof_m = roof_m or st.roof
    bh = st.base_h
    if base:
        b.box(x0 - 0.018, y0 - 0.018, z0, x1 + 0.018, y1 + 0.018, z0 + bh, st.base, 0.012)
    b.box(x0, y0, z0 + bh * 0.5, x1, y1, z0 + wall_h, wall_m, 0.006)
    skip = []
    for d in doors:
        side, t = d[0], d[1]
        w = d[2] if len(d) > 2 else DOOR_W
        span = (x1 - x0) if side in ("-y", "+y") else (y1 - y0)
        skip.append((side, t - (w / 2 + 0.03) / span, t + (w / 2 + 0.03) / span))
    for wnd in windows:
        side, t, _z, w, _h = wnd
        span = (x1 - x0) if side in ("-y", "+y") else (y1 - y0)
        skip.append((side, t - (w / 2 + 0.02) / span, t + (w / 2 + 0.02) / span))
    if st.frame and frame:
        b.timber_frame(x0, y0, x1, y1, z0 + bh, z0 + wall_h, st.frame, skip=skip)
    for d in doors:
        side, t = d[0], d[1]
        w = d[2] if len(d) > 2 else DOOR_W
        h = d[3] if len(d) > 3 else DOOR_H
        b.opening(side, x0, y0, x1, y1, t, z0 + bh * 0.6, w, h, "door", frame_m=st.trim, arch=arch_doors)
    for side, t, z, w, h in windows:
        b.opening(side, x0, y0, x1, y1, t, z0 + z, w, h, st.window, frame_m=st.trim, shutters=shutters, sill=True)
    top = z0 + wall_h
    if roof == "none":
        return top
    thatch = roof_m.startswith("thatch")
    pitch = pitch if pitch is not None else st.roof_pitch
    overhang = overhang if overhang is not None else (0.09 if thatch else 0.06)
    thick = 0.075 if thatch else 0.035
    rough = 0.014 if thatch else 0.0
    if roof == "gable":
        span = (y1 - y0) if axis == "x" else (x1 - x0)
        rise = pitch * span / 2
        b.gable_roof(x0, y0, x1, y1, top, rise, roof_m, axis=axis, overhang=overhang, thick=thick,
                     gable_m=gable_m or wall_m, rough=rough,
                     ridge_m=(("thatch_old" if thatch else roof_m) if ridge else None),
                     end_overhang=overhang * (0.7 if thatch else 1.0))
        return top + rise
    if roof == "hip":
        span = min(x1 - x0, y1 - y0)
        rise = pitch * span / 2
        b.hip_roof(x0, y0, x1, y1, top, rise, roof_m, overhang=overhang, thick=thick, rough=rough)
        return top + rise
    if roof == "shed":
        # mono pitch falling towards -y
        rise = pitch * (y1 - y0) * 0.35
        b._slab([(x0 - overhang, y0 - overhang, top), (x1 + overhang, y0 - overhang, top),
                 (x1 + overhang, y1 + overhang, top + rise), (x0 - overhang, y1 + overhang, top + rise)],
                thick, roof_m, rough)
        return top + rise
    raise ValueError(roof)


def wall_banner(b: B, side: str, x0: float, y0: float, x1: float, y1: float, t: float, z_top: float,
                w: float = 0.12, h: float = 0.24, rod_m: str = "timber") -> None:
    """Team-coloured pennon hanging flat on a wall face (pointed bottom)."""
    prof = [(-w / 2, 0.0), (w / 2, 0.0), (w / 2, -h * 0.78), (0.0, -h), (-w / 2, -h * 0.78)]
    if side in ("-y", "+y"):
        yy = y0 if side == "-y" else y1
        s = -1 if side == "-y" else 1
        cx = x0 + (x1 - x0) * t
        pts = [(cx + u, z_top + v) for u, v in prof]
        with b.anim("hang", top=z_top, normal=(0.0, float(s)), len=h, pivot=(cx, yy, z_top)):
            b.side_prism(pts, yy + s * 0.004, yy + s * 0.014, "team", axis="y")
        b.beam((cx - w / 2 - 0.02, yy + s * 0.02, z_top + 0.005), (cx + w / 2 + 0.02, yy + s * 0.02, z_top + 0.005), 0.012, rod_m)
    else:
        xx = x1 if side == "+x" else x0
        s = 1 if side == "+x" else -1
        cy = y0 + (y1 - y0) * t
        pts = [(cy + u, z_top + v) for u, v in prof]
        with b.anim("hang", top=z_top, normal=(float(s), 0.0), len=h, pivot=(xx, cy, z_top)):
            b.side_prism(pts, xx + s * 0.004, xx + s * 0.014, "team", axis="x")
        b.beam((xx + s * 0.02, cy - w / 2 - 0.02, z_top + 0.005), (xx + s * 0.02, cy + w / 2 + 0.02, z_top + 0.005), 0.012, rod_m)


def chimney(b: B, x: float, y: float, z0: float, z1: float, m: str = "fieldstone", s: float = 0.075) -> None:
    b.box(x - s / 2, y - s / 2, z0, x + s / 2, y + s / 2, z1, m, 0.006)
    b.box(x - s / 2 - 0.012, y - s / 2 - 0.012, z1, x + s / 2 + 0.012, y + s / 2 + 0.012, z1 + 0.025, m, 0.004)
    b.box(x - s / 2 + 0.015, y - s / 2 + 0.015, z1 + 0.02, x + s / 2 - 0.015, y + s / 2 - 0.015, z1 + 0.026, "void", 0.0)


def baroque_gable(b: B, x0: float, x1: float, y: float, z: float, h: float, m: str, trim: str,
                  depth: float = 0.05) -> None:
    """Curved Bohemian baroque gable on the -y face, standing above the eave line."""
    w = x1 - x0
    cx = (x0 + x1) / 2
    pts = [(x0, z)]
    # lower volute
    for i in range(7):
        a = math.pi * i / 6
        pts.append((x0 + w * 0.12 * (1 - math.cos(a)) * 0.5 + w * 0.02, z + h * 0.32 * math.sin(a / 2) ** 0.7))
    pts.append((x0 + w * 0.22, z + h * 0.42))
    for i in range(7):
        a = math.pi * i / 6
        pts.append((x0 + w * 0.22 + w * 0.08 * math.sin(a), z + h * 0.42 + h * 0.3 * i / 6))
    pts.append((cx - w * 0.14, z + h * 0.78))
    for i in range(9):
        a = math.pi * i / 8
        pts.append((cx - w * 0.14 * math.cos(a), z + h * 0.78 + h * 0.22 * math.sin(a)))
    right = [(2 * cx - px, pz) for px, pz in reversed(pts)]
    poly = pts + right[1:]
    b.side_prism(poly, y - depth, y + 0.02, m, axis="y")
    b.side_prism([(px, pz) for px, pz in _offset_top(poly, 0.012)], y - depth - 0.006, y + 0.02 - depth * 0.5, trim, axis="y")


def _offset_top(poly: list[tuple[float, float]], t: float) -> list[tuple[float, float]]:
    """Thin cornice strip following the gable outline (approximation)."""
    top = [(x, z) for x, z in poly]
    under = [(x, z - t) for x, z in reversed(poly)]
    return top + under


def stairs(b: B, x: float, y0: float, z_top: float, w: float, m: str, steps: int = 3, depth: float = 0.05) -> None:
    """Steps descending towards -y from (x, y0) at z_top to the ground."""
    for i in range(steps):
        zt = z_top * (steps - i) / steps
        b.box(x - w / 2, y0 - (i + 1) * depth, 0, x + w / 2, y0 - i * depth, zt, m, 0.004)


def style(era: str):
    return STYLES[era]
