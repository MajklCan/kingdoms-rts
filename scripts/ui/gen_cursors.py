"""Game cursors, art direction "carved wood and iron".

Each cursor is a hand-placed 16x16 pixel pattern (one character per texel),
written as PNG at 2x (32x32, used at 1x DPR) and 4x (64x64, used through
image-set at 2x DPR). Hotspots are in 32x32 cursor pixels and must match
CURSOR_HOTSPOTS in src/ui/skin/cursors.ts.

Run from the repo root:
    python3 scripts/ui/gen_cursors.py
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pixkit import hexc  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'assets', 'ui', 'cursors')

PAL = {
    'k': '#0a0705',  # outline
    'W': '#f4f5f2',  # steel highlight
    'w': '#c9ced3',  # steel light
    's': '#8d939a',  # steel mid
    'd': '#55595f',  # steel dark
    'G': '#f6dd86',  # gold light
    'g': '#c9a227',  # gold
    'b': '#8a6a1c',  # gold dark
    'T': '#c48a52',  # wood light
    't': '#8a5e33',  # wood
    'r': '#5a3a1c',  # wood dark
    'R': '#e0645a',  # red light
    'e': '#bb2733',  # red
    'E': '#6c0f17',  # red dark
    'L': '#bfe08a',  # leaf light
    'l': '#6fa83f',  # leaf
    'y': '#e7c45a',  # straw
    'Y': '#a8841c',  # straw dark
}

# Hotspots in 16x16 texels (multiplied by 2 for the 32px cursor).
CURSORS: dict[str, tuple[tuple[int, int], list[str]]] = {
    # Armoured gauntlet pointing up-left: the default arrow.
    'default': ((1, 1), [
        'kk..............',
        'kWkk............',
        'kWwwkk..........',
        'kWwwwwkk........',
        'kwwwsswwkk......',
        'kwwsssssswkk....',
        'kwsssssssssk....',
        'kwsssssdddk.....',
        'ksssssdk.kk.....',
        'ksssdddk........',
        'kssdkksdk.......',
        'ksdk..ksdk......',
        'kdk....ksdk.....',
        'kk......kddk....',
        '.........kk.....',
        '................',
    ]),
    # Raised sword: attack.
    'attack': ((1, 1), [
        'kkk.............',
        'kWWk............',
        'kWwsk...........',
        '.kwwsk..........',
        '..kwwsk.........',
        '...kwwsk........',
        '....kwwsk.......',
        '.....kwwsk.kk...',
        '......kwwskgk...',
        '.......kwwgbk...',
        '........kgbk....',
        '.......kgbkrk...',
        '......kgbk.krk..',
        '.......kk...krk.',
        '.............kk.',
        '................',
    ]),
    # Felling axe: trees.
    'gather-wood': ((2, 2), [
        '................',
        '..kkkk..........',
        '.kWwwsk.........',
        'kWwwssk.........',
        'kwwsssdk........',
        'kwsskkdk........',
        '.kskTtkk........',
        '..kktTtk........',
        '.....ktTk.......',
        '......ktTk......',
        '.......ktTk.....',
        '........ktTk....',
        '.........ktrk...',
        '..........krrk..',
        '...........kk...',
        '................',
    ]),
    # Pickaxe: stone and gold.
    'gather-mine': ((1, 2), [
        '................',
        '.kkk.....kkk....',
        'kWwsk...kswdk...',
        '.kwwsk.kswdk....',
        '..kkwsksswk.....',
        '....kwssdk......',
        '....ksTtk.......',
        '...kssktTk......',
        '..kdk..ktTk.....',
        '..kk....ktTk....',
        '.........ktTk...',
        '..........ktrk..',
        '...........krrk.',
        '............kk..',
        '................',
        '................',
    ]),
    # Sickle with a straw tuft: farms and berries.
    'gather-food': ((1, 6), [
        '................',
        '....kkkk........',
        '..kkWwwskk......',
        '.kWwkkkkssk.....',
        'kWwk....kssk....',
        'kwk......ksk....',
        'kwk......ksk....',
        'kk......kssk....',
        '.......kssk.....',
        '......kddk......',
        '.....ktTk.......',
        '....ktTk...kyk..',
        '...ktTk...kyYyk.',
        '..ktrk...kyYyYk.',
        '..krk.....kkkk..',
        '...k............',
    ]),
    # Builder's hammer: placement and repairs.
    'build': ((3, 3), [
        '................',
        '..kkkkkk........',
        '.kWwwwssk.......',
        '.kwwsssddk......',
        '.kksssdkkk......',
        '...kssdk........',
        '...kkTtkk.......',
        '.....ktTk.......',
        '......ktTk......',
        '.......ktTk.....',
        '........ktTk....',
        '.........ktTk...',
        '..........ktrk..',
        '...........krk..',
        '............k...',
        '................',
    ]),
    # Planted pennant: rally point and move target.
    'rally': ((2, 14), [
        '..kk............',
        '..kGkkkkk.......',
        '..kgkReeekk.....',
        '..kgkeeeeeEkk...',
        '..kgkeeeeeEEEk..',
        '..kgkeeeEEEkk...',
        '..kgkEEEkk......',
        '..kgkkkk........',
        '..kgk...........',
        '..kgk...........',
        '..kbk...........',
        '..kbk...........',
        '.kbbbk..........',
        'kbbbbbk.........',
        '.kkkkk..........',
        '................',
    ]),
    # Barred red ring: cannot place here.
    'forbidden': ((8, 8), [
        '................',
        '.....kkkkkk.....',
        '...kkReeeeEkk...',
        '..kReEkkkkEEEk..',
        '..keEk....kEEk..',
        '.kReEk...kEeEEk.',
        '.keek...kEeEkEk.',
        '.keek..kEeEk.Ek.',
        '.keek.kEeEk..Ek.',
        '.keEkkEeEk..kEk.',
        '.kReEEeEk...kEk.',
        '..keEeEk...kEEk.',
        '..kEEEkkkkkEEk..',
        '...kkEEEEEEkk...',
        '.....kkkkkk.....',
        '................',
    ]),
}


def render(pattern: list[str], scale: int) -> Image.Image:
    a = np.zeros((16, 16, 4), dtype=np.uint8)
    for y, row in enumerate(pattern):
        assert len(row) == 16, (row, len(row))
        for x, ch in enumerate(row):
            if ch in PAL:
                a[y, x] = hexc(PAL[ch])
    # drop shadow one texel down-right, half transparent, under the art
    shadow = np.zeros_like(a)
    m = a[..., 3] > 0
    sm = np.zeros_like(m)
    sm[1:, 1:] = m[:-1, :-1]
    shadow[sm & ~m] = np.array([0, 0, 0, 110], dtype=np.uint8)
    out = np.where(m[..., None], a, shadow)
    im = Image.fromarray(out)
    return im.resize((16 * scale, 16 * scale), Image.NEAREST)


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    hotspots = {}
    for name, (hot, pattern) in CURSORS.items():
        assert len(pattern) == 16, name
        render(pattern, 2).save(os.path.join(OUT, f'{name}.png'), optimize=True)
        render(pattern, 4).save(os.path.join(OUT, f'{name}@2x.png'), optimize=True)
        hotspots[name] = [hot[0] * 2, hot[1] * 2]
    print(json.dumps(hotspots))


if __name__ == '__main__':
    main()
