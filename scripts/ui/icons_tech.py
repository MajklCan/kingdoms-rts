"""Research icons for gen_icons.py: one bold symbol per research, in the same
hand-placed 15 x 15 texel style as the building symbols (icons_buildings.py).

Research that unlocks a building wears that building's symbol (Levy the
crossed pikes of the barracks, Mills the mill sails, ...); see TECH_ICON in
src/ui/icons/catalog.ts. The symbols here are for research without a
building of its own, plus the settlement's crest for the centre of the
Technology panel.

Each symbol is a 15-row picture, one character per texel (PALETTE below,
'.' = empty). Only the coloured texels are drawn; the dark outline around
the silhouette is added here, as on the building symbols.
"""
from __future__ import annotations

import numpy as np

GRID = 15
OUTLINE = (0x1C, 0x10, 0x08)

# The building symbols' colours, so both sets read as one family.
PALETTE = {
    'W': '#f0f2f4', 'S': '#c3c9cf', 's': '#8d949c', 'd': '#5c636b', 'D': '#3a3f45',  # steel, stone
    'O': '#c98a4b', 'o': '#8a5a30', 'b': '#57391e',  # wood
    'Y': '#f6dd86', 'y': '#e7c45a', 'g': '#c9a227', 'G': '#8a6a1c',  # gold, straw
    'R': '#e0645a', 'r': '#98202c', 'm': '#560c12',  # red
    'L': '#8fd16a', 'l': '#4f8a34',  # green
    'C': '#f3e7c8', 'c': '#cdb486', 'T': '#e0a868',  # plaster, tan
    'K': '#1c1008',  # outline colour, for lines inside a shape
}

SYMBOLS: dict[str, list[str]] = {
    # Bowyers: a drawn bow with an arrow on the string.
    'tech-bow': [
        '...............',
        '....Oo.........',
        '....WOOo.......',
        '....W..Oo......',
        '....W...Oo.....',
        '....W....Oo....',
        '....W.....O....',
        '.RoOOOOOOOOSW..',
        '....W.....O....',
        '....W....Oo....',
        '....W...Oo.....',
        '....W..Oo......',
        '....WOOo.......',
        '....Oo.........',
        '...............',
    ],
    # Lumber Crews: a felling axe over two sawn logs.
    'tech-lumber': [
        '...............',
        '........Oo..W..',
        '.......OosSSW..',
        '......OoSSSSW..',
        '.....Oo.sSSSW..',
        '....Oo...sSSW..',
        '...Oo......sW..',
        '..Oo...........',
        '.Oo............',
        '.o...CCC..CCC..',
        '....CcTcCCcTcC.',
        '....CTcTCCTcTC.',
        '....CcTcCCcTcC.',
        '.....CCC..CCC..',
        '...............',
    ],
    # Carpentry: a timber roof truss on its posts.
    'tech-carpentry': [
        '...............',
        '.......O.......',
        '......OOo......',
        '.....OO.Oo.....',
        '....OO.O.Oo....',
        '...OO..O..Oo...',
        '..OO...O...Oo..',
        '.OOOOOOOOOOOOo.',
        '.ooooooooooooo.',
        '..Oo...Oo..Oo..',
        '..Oo...Oo..Oo..',
        '..Oo...Oo..Oo..',
        '..Oo...Oo..Oo..',
        '..ob...ob..ob..',
        '...............',
    ],
    # Burgher Houses: a tall half-timbered town house.
    'tech-burgher': [
        '.......R.......',
        '......RRr......',
        '.....RRRrr.....',
        '....RRRRrrr....',
        '...RRRRRrrrr...',
        '...CCbCCCbCc...',
        '...CYbCYCbYc...',
        '...CCbCCCbCc...',
        '...bbbbbbbbb...',
        '...CYYCCCYYc...',
        '...CYYCCCYYc...',
        '...CCCCbbCCc...',
        '...CYYCbbCCc...',
        '...ccccbbccc...',
        '...............',
    ],
    # Mining Crews: a pick and a hammer crossed.
    'tech-mining': [
        '...............',
        '.SSs.....sSSW..',
        'SSSSs......sSW.',
        'sSSSO....O..sS.',
        '.ssOOo..Oo...S.',
        '....oOoOo....s.',
        '.....oOo.......',
        '.....OoOo......',
        '....Oo.oOo.....',
        '...Oo...oOo....',
        '..Oo.....oOo...',
        '.Oo.......oOo..',
        '.o.........oO..',
        '...............',
        '...............',
    ],
    # Houfnice: a pile of cannon shot.
    'tech-houfnice': [
        '...............',
        '...............',
        '.....sdd.......',
        '....sSSdd......',
        '....dSdddD.....',
        '....dddDDD.....',
        '.....dDD.......',
        '..sdd.K..sdd...',
        '.sSSdd.KsSSdd..',
        '.dSdddDKdSdddD.',
        '.dddDDDKdddDDD.',
        '..dDD.K..dDD...',
        '...............',
        '...............',
        '...............',
    ],
    # Palisades: sharpened stakes lashed to two rails.
    'tech-palisade': [
        '...............',
        '..O....O....O..',
        '.OOo..OOo..OOo.',
        '.OOo..OOo..OOo.',
        '.OOo..OOo..OOo.',
        '.bbbbbbbbbbbbb.',
        '.OOo..OOo..OOo.',
        '.OOo..OOo..OOo.',
        '.OOo..OOo..OOo.',
        '.OOo..OOo..OOo.',
        '.bbbbbbbbbbbbb.',
        '.OOo..OOo..OOo.',
        '.OOo..OOo..OOo.',
        '.oob..oob..oob.',
        '...............',
    ],
    # Brick Walls: a crenellated wall of red brick.
    'tech-brick': [
        '...............',
        '...............',
        '.RRr..RRr..RRr.',
        '.Rrr..Rrr..Rrr.',
        '.RRRRRRRRRRRRR.',
        '.RrrcRrrcRrrcR.',
        '.ccccccccccccc.',
        '.rcRrrcRrrcRrr.',
        '.ccccccccccccc.',
        '.RrrcRrrcRrrcR.',
        '.ccccccccccccc.',
        '.rcRrrcRrrcRrr.',
        '.mmmmmmmmmmmmm.',
        '...............',
        '...............',
    ],
    # Heavy Plough: a wheeled plough cutting a furrow.
    'tech-plough': [
        '...............',
        'O..............',
        'OO.............',
        '.OO............',
        '..OO...........',
        '...OO..........',
        '....OOOOOOOOOO.',
        '....ooooooooOo.',
        '...SSo....oOOo.',
        '..SSSo...oO.bOo',
        '.WSSs....O.b.bO',
        'WSSs.....oOb.Oo',
        '..........oOOo.',
        'bobbobboobobbob',
        '...............',
    ],
    # Three Fields: one field green, one in grain, one lying fallow.
    'tech-fields': [
        '......Y.Y......',
        '.....YgYgY.....',
        '.....gYgYg.....',
        '.lLllKYgYKoooo.',
        '.llLlKgYgKbbbb.',
        '.lLllKYgYKoooo.',
        '.llLlKgYgKbbbb.',
        '.lLllKYgYKoooo.',
        '.llLlKgYgKbbbb.',
        '.lLllKYgYKoooo.',
        '.llLlKgYgKbbbb.',
        '.lLllKYgYKoooo.',
        '.llLlKgYgKbbbb.',
        '...............',
        '...............',
    ],
    # Commander: his war banner, swallow-tailed, with a gold star.
    'tech-banner': [
        '...............',
        '...Y...........',
        '..YgY..........',
        '...o...........',
        '...oRRRRRRRR...',
        '...oRRRRRRRRr..',
        '...oRRRYRRRRr..',
        '...oRRYgYRRRr..',
        '...oRRRYRRRRr..',
        '...oRRRRRRRRr..',
        '...orrrr.rrrr..',
        '...orr.....rr..',
        '...o...........',
        '...b...........',
        '...............',
    ],
    # The settlement's crest: a white tower on a red shield.
    'tech-settlement': [
        '...............',
        '.YyyyyyyyyyyyG.',
        '.yRRRRRRRRRRrG.',
        '.yRRWRWRWRWRrG.',
        '.yRRWWWWWWSRrG.',
        '.yRRRWWWWSrRrG.',
        '.yRRRWWKWSrRrG.',
        '.yRRRWWKWSrrrG.',
        '.yRRRWWKWSrrrG.',
        '..yRRRRrrrrrG..',
        '..yRRRrrrrrrG..',
        '...yRRrrrrrG...',
        '....yGrrrGG....',
        '......GGG......',
        '...............',
    ],
}


def _grid(name: str, rows: list[str]) -> np.ndarray:
    assert len(rows) == GRID and all(len(r) == GRID for r in rows), f'{name}: expected {GRID} rows of {GRID} texels'
    grid = np.zeros((GRID, GRID, 4), np.uint8)
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch == '.':
                continue
            assert ch in PALETTE, f'{name}: unknown colour {ch!r} at {x},{y}'
            hexcol = PALETTE[ch]
            grid[y, x] = [int(hexcol[i:i + 2], 16) for i in (1, 3, 5)] + [255]
    solid = grid[..., 3] > 0
    ring = np.zeros_like(solid)
    ring[1:, :] |= solid[:-1, :]
    ring[:-1, :] |= solid[1:, :]
    ring[:, 1:] |= solid[:, :-1]
    ring[:, :-1] |= solid[:, 1:]
    grid[ring & ~solid] = [*OUTLINE, 255]
    return grid


def tech_icons() -> dict[str, dict[int, np.ndarray]]:
    """tech-<symbol> at both sheet scales: 2 px per texel at 1x, 4 px at 2x."""
    icons: dict[str, dict[int, np.ndarray]] = {}
    for name, rows in SYMBOLS.items():
        grid = _grid(name, rows)
        icons[name] = {s: np.repeat(np.repeat(grid, 2 * s, 0), 2 * s, 1) for s in (1, 2)}
    return icons
