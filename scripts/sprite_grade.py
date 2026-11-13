"""Colour grade applied to every colour frame when the atlases are packed.

The raw Blender renders come out a little dark and muddy at game scale (dark
low-contrast greens, buildings in gloom). Instead of re-lighting every scene,
the packer lifts the midtones, adds a touch of saturation and warmth to each
colour frame before it is trimmed and packed. Shadows keep their depth (the
curve barely moves values near black) and highlights stay below clipping.

Masks are derived from the graded colour frame (packer), shadow frames are
never graded. `unpack_sprites.py` applies the inverse grade so an unpack +
repack round trip does not grade twice; the manifest records the grade that
was applied under `"grade"`.

  python3 scripts/sprite_grade.py --preview in.png out.png   # grade any PNG
"""

from __future__ import annotations

import sys

import numpy as np

# Bump `version` whenever the numbers change, so a stale unpack can tell.
GRADE = {
    "version": 1,
    # out = x + lift * x^power * (1 - x): lifts mids, keeps blacks and whites.
    "lift": 0.5,
    "power": 1.4,
    "saturation": 1.07,
    # Per-channel gain after the curve: a slightly warmer sun.
    "warm": [1.03, 1.0, 0.955],
}

_LUMA = np.array([0.299, 0.587, 0.114], np.float32)
_SAMPLES = 4096


def _curve(x: np.ndarray, lift: float, power: float) -> np.ndarray:
    return x + lift * np.power(x, power) * (1.0 - x)


def _inverse_curve(y: np.ndarray, lift: float, power: float) -> np.ndarray:
    xs = np.linspace(0.0, 1.0, _SAMPLES, dtype=np.float64)
    ys = _curve(xs, lift, power)  # monotonic for lift < 1
    return np.interp(y, ys, xs).astype(np.float32)


def grade_rgba(arr: np.ndarray, grade: dict = GRADE) -> np.ndarray:
    """Forward grade of an RGBA uint8 image (alpha untouched)."""
    rgb = arr[..., :3].astype(np.float32) / 255.0
    rgb = _curve(rgb, grade["lift"], grade["power"])
    luma = (rgb * _LUMA).sum(-1, keepdims=True)
    rgb = luma + (rgb - luma) * grade["saturation"]
    rgb = rgb * np.array(grade["warm"], np.float32)
    out = arr.copy()
    out[..., :3] = np.clip(rgb * 255.0 + 0.5, 0, 255).astype(np.uint8)
    return out


def ungrade_rgba(arr: np.ndarray, grade: dict = GRADE) -> np.ndarray:
    """Inverse of :func:`grade_rgba` (up to rounding and highlight clipping)."""
    rgb = arr[..., :3].astype(np.float32) / 255.0
    rgb = rgb / np.array(grade["warm"], np.float32)
    luma = (rgb * _LUMA).sum(-1, keepdims=True)
    rgb = luma + (rgb - luma) / grade["saturation"]
    rgb = _inverse_curve(np.clip(rgb, 0.0, 1.0), grade["lift"], grade["power"])
    out = arr.copy()
    out[..., :3] = np.clip(rgb * 255.0 + 0.5, 0, 255).astype(np.uint8)
    return out


def _preview(src: str, dst: str) -> None:
    from PIL import Image  # type: ignore

    arr = np.asarray(Image.open(src).convert("RGBA")).copy()
    Image.fromarray(grade_rgba(arr)).save(dst)


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "--preview":
        _preview(sys.argv[2], sys.argv[3])
    else:
        print(__doc__)
