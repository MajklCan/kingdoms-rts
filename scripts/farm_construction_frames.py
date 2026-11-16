"""Farm construction frames: a field being laid out, not a house frame.

A farm under construction used the generic 2x2 timber scaffold. This script
composes its own stages from the packed farm art, so they share its pixels,
palette and light:

  stage 0   the plot staked out with string, a spade and a seed sack
  stage 1-4 the soil bed turned furrow by furrow from the back of the plot
            to the front, the freshest strip darker, a guide string
            marking the next furrow
  stage 5   the whole bed turned, stakes still up (the finished farm then
            swaps in the sown field and its scarecrow)

No Blender needed: it reads public/assets/sprites (manifest, buildings atlas),
appends the frames `construction_farm_<n>` (+ `__shadow`) to the buildings
atlas without touching any existing pixel, registers them as the asset
`construction.farm` and points `building.farm.construction` at it. Every new
pixel uses a colour the atlas palette already has. Re-running replaces the
frames in place. scripts/pack_sprites.py runs it after every pack, because
the packer only knows what Blender rendered.

  python3 scripts/farm_construction_frames.py [--preview out.png] [--sprites dir]

--preview writes a sheet of the stages next to the finished farm and leaves
the atlas alone; --sprites works on another copy of the sprites folder.
Needs Pillow only.
"""

from __future__ import annotations

import json
import os
import sys

from PIL import Image

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
SPRITES = os.path.join(REPO, "public", "assets", "sprites")
if "--sprites" in sys.argv:
    SPRITES = os.path.abspath(sys.argv[sys.argv.index("--sprites") + 1])

ASSET_ID = "construction.farm"
FRAME_PREFIX = "construction_farm_"
#: construction progress from which each stage shows
STAGE_PROGRESS = (0.0, 0.1, 0.28, 0.46, 0.64, 0.82)
#: how much of the bed is turned in each stage
STAGE_TURNED = (0.0, 0.2, 0.4, 0.6, 0.8, 1.0)
PAD = 2

# Farm frame geometry (all farm variants share it): 2x2 tiles, 64x32 diamond.
W, H = 146, 86
ANCHOR = (73, 83)
TOP = (73, 19)  # screen pixel of the footprint's top corner (tile 0, 0)
BED_RAISE = 2  # the soil bed's top face sits this many px above the ground
BED_SIDE = 3  # px height of the bed's side faces
BED_V0, BED_V1 = 0.08, 1.92  # the bed's extent across the furrows, in tiles

RGBA = tuple  # (r, g, b, a)
CLEAR: RGBA = (0, 0, 0, 0)

# Colours, all present in the buildings atlas palette.
SOIL_RAMP = [(42, 25, 19), (54, 36, 25), (78, 56, 40), (105, 72, 44), (114, 86, 51), (132, 90, 52), (138, 103, 49)]
SOIL_FILL = (114, 86, 51)
STRING = (239, 184, 110)
STRING_KNOT = (241, 195, 117)
STRING_BACK = (198, 168, 116)
WOOD_LIT = (176, 151, 109)
WOOD_MID = (135, 105, 73)
WOOD_DARK = (83, 69, 53)
IRON_LIT = (120, 117, 111)
IRON_DARK = (76, 73, 72)
SACK_LIT = (212, 180, 121)
SACK_MID = (176, 151, 109)
SACK_DARK = (117, 102, 79)
SACK_TIE = (105, 72, 44)
SHADOW: RGBA = (52, 40, 23, 88)


class Canvas:
    """A small RGBA pixel grid."""

    def __init__(self, w: int = W, h: int = H):
        self.w, self.h = w, h
        self.px: list[list[RGBA]] = [[CLEAR] * w for _ in range(h)]

    @classmethod
    def of(cls, image: Image.Image) -> "Canvas":
        c = cls(image.width, image.height)
        data = image.convert("RGBA").load()
        for y in range(c.h):
            for x in range(c.w):
                p = data[x, y]
                c.px[y][x] = p if p[3] > 0 else CLEAR
        return c

    def get(self, x: int, y: int) -> RGBA:
        return self.px[y][x] if 0 <= x < self.w and 0 <= y < self.h else CLEAR

    def opaque(self, x: int, y: int) -> bool:
        return self.get(x, y)[3] > 0

    def put(self, x: int, y: int, colour: tuple) -> None:
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[y][x] = colour if len(colour) == 4 else (*colour, 255)

    def over(self, other: "Canvas") -> None:
        for y in range(self.h):
            for x in range(self.w):
                p = other.px[y][x]
                if p[3] > 0:
                    self.px[y][x] = p

    def image(self) -> Image.Image:
        im = Image.new("RGBA", (self.w, self.h))
        im.putdata([p for row in self.px for p in row])
        return im

    def bbox(self) -> tuple[int, int, int, int] | None:
        xs = [x for y in range(self.h) for x in range(self.w) if self.px[y][x][3] > 0]
        ys = [y for y in range(self.h) for x in range(self.w) if self.px[y][x][3] > 0]
        return (min(xs), min(ys), max(xs) + 1, max(ys) + 1) if xs else None


def ground(u: float, v: float, lift: float = 0) -> tuple[int, int]:
    """Screen pixel of a point of the footprint (tiles from its top corner)."""
    return round(TOP[0] + (u - v) * 32), round(TOP[1] + (u + v) * 16 - lift)


def across(x: int, y: int) -> float:
    """How far across the furrows (tile +y) a pixel of the bed's top face is."""
    return (2 * (y + BED_RAISE - TOP[1]) - (x - TOP[0])) / 64


def shade(colour: RGBA, steps: int) -> RGBA:
    """Move a soil colour along the soil ramp; other colours stay."""
    rgb = colour[:3]
    if rgb not in SOIL_RAMP:
        return colour
    i = max(0, min(len(SOIL_RAMP) - 1, SOIL_RAMP.index(rgb) + steps))
    return (*SOIL_RAMP[i], 255)


# ---------------------------------------------------------------------------
# Source art
# ---------------------------------------------------------------------------


class Atlas:
    def __init__(self) -> None:
        with open(os.path.join(SPRITES, "manifest.json")) as fh:
            self.manifest = json.load(fh)
        farm = self.manifest["assets"]["building.farm"]
        self.key = farm["variants"]["sown"]["atlas"]
        desc = next(a for a in self.manifest["atlases"] if a["key"] == self.key)
        self.desc = desc
        self.json_path = os.path.join(SPRITES, desc["json"])
        self.png_path = os.path.join(SPRITES, desc["image"])
        with open(self.json_path) as fh:
            self.sheet = json.load(fh)
        # Style A atlases are 256 colour palette PNGs; --no-quantize packs are RGBA.
        self.image = Image.open(self.png_path)
        if self.image.mode != "P":
            self.image = self.image.convert("RGBA")

    def frame(self, name: str) -> Canvas:
        f = self.sheet["frames"][name]
        fr, src, size = f["frame"], f["spriteSourceSize"], f["sourceSize"]
        out = Image.new("RGBA", (size["w"], size["h"]))
        cut = self.image.crop((fr["x"], fr["y"], fr["x"] + fr["w"], fr["y"] + fr["h"])).convert("RGBA")
        out.paste(cut, (src["x"], src["y"]))
        return Canvas.of(out)


def bare_bed(sown: Canvas, depleted: Canvas) -> Canvas:
    """The farm's soil bed alone: no seedlings, stubble, scarecrow or their shade."""
    light = set(SOIL_RAMP[3:])
    clods = {(78, 56, 40), (83, 69, 53)}

    def inside(x: int, y: int) -> bool:
        # Above the bed's top corner there is only the scarecrow.
        return sown.opaque(x, y) and (y >= 28 or 110 - 2 * y <= x <= 2 * y + 35)

    def on_side(x: int, y: int) -> bool:
        return not inside(x, y + BED_SIDE)

    bed = Canvas()
    for y in range(H):
        for x in range(W):
            if not inside(x, y):
                continue
            if on_side(x, y):
                # Side faces are the same in every farm frame; a seedling
                # hanging over the edge is the only thing to avoid.
                for p in (depleted.get(x, y), sown.get(x, y)):
                    if p[3] > 0 and p[1] <= p[0]:
                        bed.put(x, y, p)
                        break
                continue
            # Top face: the stubble field's soil, minus the stubble; the dark
            # specks of the sown field are seedling shade, not soil.
            under_scarecrow = y < 36 and 58 <= x <= 104
            d, s = depleted.get(x, y), sown.get(x, y)
            if d[:3] in light or (d[:3] in clods and not under_scarecrow):
                bed.put(x, y, d)
            elif s[:3] in light:
                bed.put(x, y, s)
    # What plants or the scarecrow covered in both frames: the soil next to
    # it, along the furrow first.
    for y in range(H):
        for x in range(W):
            if not inside(x, y) or bed.opaque(x, y):
                continue
            for dx, dy in ((2, 1), (-2, -1), (4, 2), (-4, -2), (1, 0), (-1, 0), (0, 1), (0, -1), (6, 3), (-6, -3)):
                p = bed.get(x + dx, y + dy)
                if p[3] > 0 and p[:3] in light and inside(x + dx, y + dy) and not on_side(x + dx, y + dy):
                    bed.put(x, y, p)
                    break
            else:
                bed.put(x, y, SOIL_FILL)
    return bed


def bed_shadow(shadow: Canvas) -> Canvas:
    """The farm's ground shadow without the scarecrow's (the bed is symmetric)."""
    out = Canvas()
    for y in range(H):
        for x in range(W):
            a, b = shadow.get(x, y), shadow.get(W - 1 - x, y)
            out.put(x, y, a if a[3] <= b[3] else b)
    return out


# ---------------------------------------------------------------------------
# Stage art
# ---------------------------------------------------------------------------


def turned_bed(bed: Canvas, turned: float) -> tuple[Canvas, int]:
    """The bed turned from the back edge up to `turned` of its depth, cut along
    a furrow. Returns it and the shift (in 2:1 steps) of the cut from the front edge."""
    out = Canvas()
    if turned <= 0:
        return out, 0
    cut_v = BED_V0 + (BED_V1 - BED_V0) * turned
    k = round((BED_V1 - cut_v) * 16)  # front edge moved back by k steps of (2, -1) px
    dx, dy = 2 * k, -k
    for y in range(H):
        for x in range(W):
            if not bed.opaque(x, y) or not bed.opaque(x - dx, y - dy):
                continue
            # The cut shows the bed's front side face: the same pixels the full
            # bed has along its front edge, moved back to the cut.
            on_side = not bed.opaque(x - dx, y - dy + BED_SIDE)
            p = bed.get(x - dx, y - dy) if on_side else bed.get(x, y)
            if not on_side:
                v = across(x, y)
                s = 2 * (y + BED_RAISE - TOP[1]) - (x - TOP[0])  # 64 per tile across the furrows
                if s % 13 < 2:
                    p = shade(p, -2 if p[:3] in SOIL_RAMP[4:] else -1)  # the furrow between two ridges
                elif s % 13 in (5, 6, 7, 8):
                    p = shade(p, 1)  # the crown of the ridge
                if turned < 1 and v > cut_v - 0.2:
                    p = shade(p, -1)  # freshly turned, still damp
            out.put(x, y, p)
    return out, k


def turned_shadow(shadow: Canvas, k: int) -> Canvas:
    out = Canvas()
    dx, dy = 2 * k, -k
    for y in range(H):
        for x in range(W):
            a, b = shadow.get(x, y), shadow.get(x - dx, y - dy)
            out.put(x, y, a if a[3] <= b[3] else b)
    return out


def stake(c: Canvas, shadow: Canvas, x: int, y: int, height: int = 9) -> None:
    """A fresh-cut stake, 2 px wide, lit from the left; (x, y) is its foot."""
    for i in range(height):
        c.put(x, y - i, WOOD_MID)
        c.put(x + 1, y - i, WOOD_DARK)
    c.put(x, y - height + 1, WOOD_LIT)
    c.put(x + 1, y - height + 1, WOOD_MID)
    for i in range(1, 5):
        shadow.put(x + 1 + i, y + (i + 1) // 3, SHADOW)


def string(c: Canvas, a: tuple[int, int], b: tuple[int, int], colour: tuple) -> None:
    """A taut line along a tile edge (2 px across per px down)."""
    (x0, y0), (x1, y1) = (a, b) if a[0] <= b[0] else (b, a)
    n = max(1, x1 - x0)
    for i in range(n + 1):
        y = y0 + round((y1 - y0) * i / n)
        c.put(x0 + i, y, STRING_KNOT if colour == STRING and i % 9 == 4 else colour)


def spade(c: Canvas, shadow: Canvas, x: int, y: int) -> None:
    """A spade stood in the ground; (x, y) is where the blade enters the soil."""
    for i in range(3):
        c.put(x - 1, y - i, IRON_LIT)
        c.put(x, y - i, IRON_LIT if i else IRON_DARK)
        c.put(x + 1, y - i, IRON_DARK)
    for i in range(3, 11):
        c.put(x, y - i, WOOD_MID if i % 4 else WOOD_LIT)
    for dx in (-1, 0, 1):
        c.put(x + dx, y - 11, WOOD_DARK if dx == 1 else WOOD_MID)
    for i in range(1, 5):
        shadow.put(x + 1 + i, y + (i + 1) // 3, SHADOW)


def sack(c: Canvas, shadow: Canvas, x: int, y: int) -> None:
    """A tied seed sack sitting on the ground; (x, y) is its bottom centre."""
    rows = ["..t..", ".lmd.", "llmmd", "llmmd", ".mmd."]
    colours = {"l": SACK_LIT, "m": SACK_MID, "d": SACK_DARK, "t": SACK_TIE}
    for j, row in enumerate(rows):
        for i, ch in enumerate(row):
            if ch != ".":
                c.put(x - 2 + i, y - len(rows) + 1 + j, colours[ch])
    for i in range(1, 6):
        shadow.put(x + 1 + i, y + i // 3, SHADOW)


def barrow(c: Canvas, shadow: Canvas, x: int, y: int) -> None:
    """A wheelbarrow with a load of soil; (x, y) is where its wheel stands."""
    rows = [
        "....ssss....",
        "...sSSSSs...",
        "hh.WllllmD..",
        ".hhWlllmmD..",
        "...hWmmmD...",
        "...g.DDDkk..",
        "...g....kk..",
    ]
    colours = {
        "s": (105, 72, 44), "S": (78, 56, 40), "h": WOOD_MID, "W": WOOD_LIT, "l": WOOD_LIT, "m": WOOD_MID,
        "D": WOOD_DARK, "g": WOOD_DARK, "k": IRON_DARK,
    }
    for j, row in enumerate(rows):
        for i, ch in enumerate(row):
            if ch != ".":
                c.put(x - 8 + i, y - len(rows) + 1 + j, colours[ch])
    for i in range(1, 8):
        shadow.put(x - 4 + i, y + 1, SHADOW)
        shadow.put(x - 2 + i, y + 2, SHADOW)


def stage_frames(bed: Canvas, shadow0: Canvas, turned: float) -> tuple[Canvas, Canvas]:
    soil, k = turned_bed(bed, turned)
    shadow = turned_shadow(shadow0, k) if turned > 0 else Canvas()
    frame = Canvas()
    inset = 0.03
    top, right = ground(inset, inset), ground(2 - inset, inset)
    bottom, left = ground(2 - inset, 2 - inset), ground(inset, 2 - inset)
    lift = 6  # string height on the stakes

    def tied(p: tuple[int, int]) -> tuple[int, int]:
        return p[0], p[1] - lift

    # Behind the bed: the far stake and the two far strings.
    stake(frame, shadow, top[0] - 1, top[1])
    string(frame, tied(left), tied(top), STRING_BACK)
    string(frame, tied(top), tied(right), STRING_BACK)
    # The turf cut along the outline of the bed still to be dug.
    cut_at = BED_V0 + (BED_V1 - BED_V0) * turned
    for y in range(H):
        for x in range(W):
            if not bed.opaque(x, y) or across(x, y) < cut_at:
                continue
            edge = not (bed.opaque(x - 1, y) and bed.opaque(x + 1, y) and bed.opaque(x, y - 1) and bed.opaque(x, y + 1))
            if edge:
                frame.put(x, y, SOIL_RAMP[3] if (x + y) % 3 else SOIL_RAMP[2])
    frame.over(soil)
    # The guide string for the next furrow, pegged at both ends, with the
    # spade at work on it.
    cut_v = BED_V0 + (BED_V1 - BED_V0) * turned
    if turned < 1:
        guide_v = min(2 - inset - 0.12, cut_v + 0.2)
        g0, g1 = ground(0.1, guide_v), ground(1.9, guide_v)
        stake(frame, shadow, g0[0] - 1, g0[1], 5)
        stake(frame, shadow, g1[0] - 1, g1[1], 5)
        string(frame, (g0[0], g0[1] - 3), (g1[0], g1[1] - 3), STRING)
        dig = ground(1.28, cut_v + 0.07) if turned > 0 else ground(1.28, 0.2)
        spade(frame, shadow, dig[0], dig[1])
        seed = ground(0.42, min(1.72, guide_v + 0.2))
        sack(frame, shadow, seed[0], seed[1])
        if turned <= 0.6:
            cart = ground(0.95, min(1.6, guide_v + 0.45))
            barrow(frame, shadow, cart[0], cart[1])
    # In front: side stakes, near strings, near stake.
    stake(frame, shadow, left[0] - 1, left[1])
    stake(frame, shadow, right[0] - 1, right[1])
    string(frame, tied(left), tied(bottom), STRING)
    string(frame, tied(bottom), tied(right), STRING)
    stake(frame, shadow, bottom[0] - 1, bottom[1])
    return frame, shadow


# ---------------------------------------------------------------------------
# Atlas + manifest
# ---------------------------------------------------------------------------


def palette_of(image: Image.Image) -> list[RGBA]:
    pal = image.getpalette()
    alpha = image.info.get("transparency", b"")
    if isinstance(alpha, int):
        alpha = bytes(255 if i != alpha else 0 for i in range(256))
    return [(pal[3 * i], pal[3 * i + 1], pal[3 * i + 2], alpha[i] if i < len(alpha) else 255) for i in range(len(pal) // 3)]


def to_indices(c: Canvas, palette: list[RGBA], box: tuple[int, int, int, int]) -> Image.Image:
    lookup = {p: i for i, p in reversed(list(enumerate(palette)))}
    clear = next(i for i, p in enumerate(palette) if p[3] == 0)
    x0, y0, x1, y1 = box
    out = Image.new("P", (x1 - x0, y1 - y0), clear)
    for y in range(y0, y1):
        for x in range(x0, x1):
            p = c.px[y][x]
            if p[3] == 0:
                continue
            if p not in lookup:
                raise SystemExit(f"colour {p} is not in the atlas palette; pick one that is")
            out.putpixel((x - x0, y - y0), lookup[p])
    return out


def write(atlas: Atlas, stages: list[tuple[Canvas, Canvas]]) -> None:
    frames = atlas.sheet["frames"]
    for name in [n for n in frames if n.startswith(FRAME_PREFIX)]:
        del frames[name]
    # Everything the packer placed stays where it is; ours go in a strip below.
    width = atlas.image.width
    base_h = max(f["frame"]["y"] + f["frame"]["h"] for f in frames.values()) + PAD
    paletted = atlas.image.mode == "P"
    palette = palette_of(atlas.image) if paletted else []
    parts: list[tuple[str, Image.Image, tuple[int, int, int, int]]] = []
    for n, (frame, shadow) in enumerate(stages):
        for name, canvas in ((f"{FRAME_PREFIX}{n}", frame), (f"{FRAME_PREFIX}{n}__shadow", shadow)):
            box = canvas.bbox()
            if box:
                parts.append((name, to_indices(canvas, palette, box) if paletted else canvas.image().crop(box), box))
    x, y, row_h = PAD, base_h, 0
    placed = []
    for name, img, box in parts:
        if x + img.width + PAD > width:
            x, y, row_h = PAD, y + row_h + PAD, 0
        placed.append((name, img, box, x, y))
        x += img.width + PAD
        row_h = max(row_h, img.height)
    height = y + row_h + PAD
    if paletted:
        out = Image.new("P", (width, height), next(i for i, p in enumerate(palette) if p[3] == 0))
        out.putpalette(atlas.image.getpalette())
    else:
        out = Image.new("RGBA", (width, height), CLEAR)
    out.paste(atlas.image.crop((0, 0, width, base_h)), (0, 0))
    for name, img, box, px, py in placed:
        out.paste(img, (px, py))
        frames[name] = {
            "frame": {"x": px, "y": py, "w": img.width, "h": img.height},
            "rotated": False,
            "trimmed": True,
            "spriteSourceSize": {"x": box[0], "y": box[1], "w": img.width, "h": img.height},
            "sourceSize": {"w": W, "h": H},
            "pivot": {"x": round(ANCHOR[0] / W, 6), "y": round(ANCHOR[1] / H, 6)},
        }
    if paletted:
        out.save(atlas.png_path, optimize=True, compress_level=9, transparency=bytes(p[3] for p in palette))
    else:
        out.save(atlas.png_path, optimize=True, compress_level=9)
    atlas.sheet["meta"]["size"] = {"w": width, "h": height}
    with open(atlas.json_path, "w") as fh:
        json.dump(atlas.sheet, fh, separators=(",", ":"))

    manifest = atlas.manifest
    atlas.desc["size"] = [width, height]
    atlas.desc["frames"] = len(frames)
    variants = {}
    for n, progress in enumerate(STAGE_PROGRESS):
        name = f"{FRAME_PREFIX}{n}"
        ref = {"atlas": atlas.key, "frame": name, "anchor": list(ANCHOR), "size": [W, H]}
        if f"{name}__shadow" in frames:
            ref["shadow"] = f"{name}__shadow"
        ref["progress"] = progress
        variants[str(n)] = ref
    manifest["assets"][ASSET_ID] = {
        "kind": "construction",
        "footprint": [2, 2],
        "variants": variants,
        "stages": [str(n) for n in range(len(STAGE_PROGRESS))],
        "default": "0",
    }
    manifest["assets"]["building.farm"]["construction"] = ASSET_ID
    manifest["assets"] = dict(sorted(manifest["assets"].items()))
    with open(os.path.join(SPRITES, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=1)


def preview(path: str, stages: list[tuple[Canvas, Canvas]], finished: Canvas, zoom: int = 4) -> None:
    """All stages and the finished farm on grass, at 1x and zoomed."""
    cells = [*stages, (finished, Canvas())]
    sheet = Image.new("RGBA", (len(cells) * W * zoom, H * zoom + H + 8), (88, 122, 62, 255))
    for i, (frame, shadow) in enumerate(cells):
        for layer in (shadow.image(), frame.image()):
            sheet.alpha_composite(layer.resize((W * zoom, H * zoom), Image.NEAREST), (i * W * zoom, 0))
            sheet.alpha_composite(layer, (i * W * zoom + (W * zoom - W) // 2, H * zoom + 4))
    sheet.save(path)


def main() -> None:
    atlas = Atlas()
    sown, depleted = atlas.frame("farm_sown"), atlas.frame("farm_depleted")
    bed = bare_bed(sown, depleted)
    shadow0 = bed_shadow(atlas.frame("farm_sown__shadow"))
    stages = [stage_frames(bed, shadow0, turned) for turned in STAGE_TURNED]
    if "--preview" in sys.argv:
        preview(sys.argv[sys.argv.index("--preview") + 1], stages, sown)
        print("[farm-construction] preview written, atlas untouched")
        return
    write(atlas, stages)
    print(f"[farm-construction] {len(stages)} stages -> {os.path.basename(atlas.png_path)} ({ASSET_ID})")


if __name__ == "__main__":
    main()
