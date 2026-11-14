#!/usr/bin/env python3
"""Contact sheet of every packed sprite plus a mock village, at game scale (1x).

Reads only public/assets/sprites/manifest.json and the atlases, i.e. exactly
what the game gets, so it doubles as a check of anchors, masks, shadows and
terrain tiling. Writes art-source/blender/contact-sheet.png.

    python3 scripts/contact_sheet.py [--out path.png]
"""

from __future__ import annotations

import argparse
import json
import os
import random
from functools import lru_cache

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SPRITES = os.path.join(ROOT, "public", "assets", "sprites")
OUT = os.path.join(ROOT, "art-source", "blender", "contact-sheet.png")

BG = (34, 36, 40, 255)
TEAMS = {"blue": (64, 120, 230), "red": (210, 52, 44)}
TW, TH, STEP = 64, 32, 4

with open(os.path.join(SPRITES, "manifest.json")) as fh:
    MAN = json.load(fh)
ASSETS = MAN["assets"]
SCALE = MAN["scale"]

FRAMES: dict[str, tuple[str, dict]] = {}
ATLAS_IMG: dict[str, Image.Image] = {}
for at in MAN["atlases"]:
    ATLAS_IMG[at["key"]] = Image.open(os.path.join(SPRITES, at["image"])).convert("RGBA")
    with open(os.path.join(SPRITES, at["json"])) as fh:
        for name, fr in json.load(fh)["frames"].items():
            FRAMES[name] = (at["key"], fr)


def font(size: int) -> ImageFont.ImageFont:
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


F_SMALL, F_MED, F_BIG = font(11), font(15), font(24)


@lru_cache(maxsize=None)
def frame_img(name: str) -> Image.Image:
    """Full sourceSize frame at game scale (1x)."""
    key, fr = FRAMES[name]
    f, sss, src = fr["frame"], fr["spriteSourceSize"], fr["sourceSize"]
    crop = ATLAS_IMG[key].crop((f["x"], f["y"], f["x"] + f["w"], f["y"] + f["h"]))
    full = Image.new("RGBA", (src["w"], src["h"]), (0, 0, 0, 0))
    full.paste(crop, (sss["x"], sss["y"]))
    # premultiply-aware downscale
    arr = np.asarray(full).astype(np.float32) / 255.0
    arr[..., :3] *= arr[..., 3:4]
    w, h = max(1, round(src["w"] * SCALE)), max(1, round(src["h"] * SCALE))
    # box filter = what mipmapped GPU sampling at 0.5x does (no ringing at alpha edges)
    chans = [Image.fromarray(arr[..., i]).resize((w, h), Image.BOX) for i in range(4)]
    out = np.stack([np.asarray(c) for c in chans], -1)
    a = np.clip(out[..., 3:4], 0, 1)
    rgb = np.where(a > 1e-4, out[..., :3] / np.maximum(a, 1e-4), 0)
    res = np.concatenate([np.clip(rgb, 0, 1), a], -1)
    return Image.fromarray((res * 255 + 0.5).astype(np.uint8))


@lru_cache(maxsize=None)
def tinted(name: str, mask: str, team: str) -> Image.Image:
    base = frame_img(name)
    m = np.asarray(frame_img(mask))[..., 3:4].astype(np.float32) / 255.0
    b = np.asarray(base).astype(np.float32)
    lum = b[..., :3].mean(-1, keepdims=True) / 255.0
    col = np.array(TEAMS[team], np.float32)[None, None] * np.clip(lum * 1.25, 0, 1.2)
    rgb = b[..., :3] * (1 - m) + col * m
    out = np.concatenate([np.clip(rgb, 0, 255), b[..., 3:4]], -1).astype(np.uint8)
    return Image.fromarray(out)


def ref(asset: str, variant: str | None = None) -> dict:
    a = ASSETS[asset]
    v = variant if variant is not None else a["default"]
    if v not in a["variants"]:  # era fallback: nearest earlier era, else default
        order = MAN.get("eraOrder", [])
        era, _, rest = v.partition(".")
        if era in order:
            for e in reversed(order[: order.index(era)]):
                cand = f"{e}.{rest}" if rest else e
                if cand in a["variants"]:
                    v = cand
                    break
        if v not in a["variants"]:
            v = a["default"]
    return a["variants"][v]


def paste(canvas: Image.Image, img: Image.Image, x: float, y: float) -> None:
    canvas.alpha_composite(img, (int(round(x)), int(round(y))))


def draw_sprite(canvas: Image.Image, r: dict, x: float, y: float, team: str | None = None, shadow_layer=None) -> None:
    """Draw so the anchor lands on (x, y) (1x canvas pixels)."""
    ax, ay = r["anchor"][0] * SCALE, r["anchor"][1] * SCALE
    if shadow_layer is not None and "shadow" in r:
        paste(shadow_layer, frame_img(r["shadow"]), x - ax, y - ay)
    img = tinted(r["frame"], r["mask"], team) if team and "mask" in r else frame_img(r["frame"])
    paste(canvas, img, x - ax, y - ay)


# ---------------------------------------------------------------------------
# Terrain helpers
# ---------------------------------------------------------------------------

def tile_ref(ttype: str, x: int, y: int, frame: int = 0) -> dict:
    a = ASSETS[f"terrain.{ttype}"]
    p = a.get("period", 1)
    idx = (x % p) + p * (y % p)
    key = str(idx) if str(idx) in a["variants"] else f"{idx}.{frame}"
    return a["variants"][key]


CLIFF_FOR = {"grass": "earth", "meadow": "earth", "forest": "earth", "dirt": "earth", "mud": "earth",
             "stone": "rock", "sand": "sand", "snow": "snow", "packed_snow": "snow", "snow_forest": "snow"}
PRIORITY = {"water": 0, "water_shallow": 1, "sand": 2, "mud": 3, "dirt": 4, "stone": 5, "grass": 6, "meadow": 7,
            "forest": 8, "snow": 9}


@lru_cache(maxsize=None)
def mask_alpha(key: str) -> np.ndarray:
    r = ASSETS["terrain.transition"]["variants"][key]
    return np.asarray(frame_img(r["frame"]))[..., 3].astype(np.float32) / 255.0


def tile_with_transitions(types: dict, x: int, y: int) -> Image.Image:
    t = types[(x, y)]
    base = frame_img(tile_ref(t, x, y)["frame"]).copy()
    over: dict[str, np.ndarray] = {}
    edges = {(1, 0): "px", (-1, 0): "mx", (0, 1): "py", (0, -1): "my"}
    tv = ASSETS["terrain.transition"]["variants"]
    for (dx, dy), k in edges.items():
        n = types.get((x + dx, y + dy))
        if n and n != t and PRIORITY.get(n, 0) > PRIORITY.get(t, 0) and n != "bridge_y":
            nvar = sum(1 for v in tv if v.startswith(f"edge_{k}."))
            key = f"edge_{k}.{(x * 7 + y * 13) % nvar}" if nvar else f"edge_{k}"
            over[n] = np.maximum(over.get(n, 0), mask_alpha(key))
    for dx in (1, -1):
        for dy in (1, -1):
            n = types.get((x + dx, y + dy))
            if not n or n == t or PRIORITY.get(n, 0) <= PRIORITY.get(t, 0) or n == "bridge_y":
                continue
            if types.get((x + dx, y)) == n or types.get((x, y + dy)) == n:
                continue
            k = f"corner_{'px' if dx > 0 else 'mx'}_{'py' if dy > 0 else 'my'}"
            over[n] = np.maximum(over.get(n, 0), mask_alpha(k))
    # mix the neighbour's ground into this tile's colour, keep this tile's alpha
    # (a plain "over" would let this tile's bleed leak through at the cut edge)
    out = np.asarray(base).astype(np.float32)
    for n in sorted(over, key=lambda k: PRIORITY.get(k, 0)):
        src = np.asarray(frame_img(tile_ref(n, x, y)["frame"])).astype(np.float32)
        m = over[n][..., None]
        out[..., :3] = out[..., :3] * (1 - m) + src[..., :3] * m
    return Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8))


def draw_terrain(canvas, types, elev, ox, oy, xs, ys) -> None:
    for x, y in sorted(((x, y) for x in xs for y in ys), key=lambda c: (c[0] + c[1], c[0])):
        t = types[(x, y)]
        e = elev.get((x, y), 0)
        bx = ox + (x - y) * TW / 2
        by = oy + (x + y + 2) * TH / 2 - e * STEP
        if e > 0:
            ck = CLIFF_FOR.get(t, "earth")
            ca = ASSETS[f"terrain.cliff_{ck}"]["variants"]
            for side in ("left", "right"):
                for s in range(e):
                    v = f"{side}_lip" if s == 0 and f"{side}_lip" in ca else side
                    draw_sprite(canvas, ca[v], bx, by + s * STEP)
        img = tile_with_transitions(types, x, y)
        r = tile_ref(t, x, y)
        paste(canvas, img, bx - r["anchor"][0] * SCALE, by - r["anchor"][1] * SCALE)


# ---------------------------------------------------------------------------
# Mock village
# ---------------------------------------------------------------------------

def mock_village() -> Image.Image:
    rng = random.Random(7)
    N = 24
    types: dict[tuple[int, int], str] = {}
    elev: dict[tuple[int, int], int] = {}
    for x in range(N):
        for y in range(N):
            t = "grass"
            if (x - 5) ** 2 + (y - 18) ** 2 < 6 or (x - 13) ** 2 + (y - 3) ** 2 < 4:
                t = "meadow"
            if x < 6 and y < 9:
                t = "forest"
            if 8 <= x <= 12 and 5 <= y <= 9:
                t = "dirt"
            if x >= 16 and y <= 8:
                elev[(x, y)] = 1
                t = "stone" if (x >= 19 and y >= 5) else "grass"
            if x >= 18 and y <= 4:
                elev[(x, y)] = 2
            if y in (16, 20):
                t = "sand"
            if y in (17, 19):
                t = "water_shallow"
            if y == 18:
                t = "water"
            if x == 10 and y in (17, 18, 19):
                t = "bridge_y"
            types[(x, y)] = t
    for y in range(10, 16):  # dirt road to the bridge
        types[(10, y)] = "dirt"

    W = N * TW + 120
    H = N * TH + 360
    ox, oy = W / 2, 260
    shadows = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    objs: list[tuple[float, float, int, dict, float, float, str | None]] = []
    occ: set[tuple[int, int]] = set()

    def place(asset: str, variant: str | None, x: int, y: int, team: str | None = None, force: bool = False) -> bool:
        a = ASSETS[asset]
        fw, fh = a["footprint"]
        cells = [(x + i, y + j) for i in range(int(fw)) for j in range(int(fh))]
        if not force and any(c in occ for c in cells):
            return False
        occ.update(cells)
        e = elev.get((x, y), 0)
        px = ox + ((x + fw) - (y + fh)) * TW / 2
        py = oy + ((x + fw) + (y + fh)) * TH / 2 - e * STEP
        objs.append((py, px, len(objs), ref(asset, variant), px, py, team))
        return True

    # town
    place("building.town_center", "castle", 9, 6, "blue")
    for (x, y, era) in ((6, 4, "castle"), (13, 5, "dark"), (13, 8, "castle"), (7, 9, "gunpowder"), (6, 6, "dark"),
                        (12, 3, "castle")):
        place("building.house", era, x, y, "blue")
    place("building.barracks", "castle", 12, 11, "blue")
    place("building.archery_range", "dark", 7, 12, "blue")
    place("building.mill", "castle", 4, 11, "blue")
    for (x, y, st) in ((1, 10, "ripe"), (1, 12, "growing"), (1, 14, "sown"), (4, 13, "depleted")):
        place("building.farm", st, x, y, "blue")
    place("building.lumber_camp", "castle", 6, 2, "blue")
    place("building.gold_mine", "castle", 17, 2, "blue")
    place("building.stone_quarry", "castle", 18, 6, "blue")
    place("building.defensive_tower", "castle", 15, 10, "red")
    for y in range(11, 15):
        place("building.wall", f"castle.{2 | 8 if y < 14 else 8}", 15, y, "red")
    for x in range(16, 20):
        place("building.wall", f"castle.{1 | 4 if x < 19 else 4}", x, 10, "red")
    place("construction.2x2", "1", 12, 13)
    place("rubble.1x1", None, 14, 7)
    place("building.stable", "dark", 17, 12, "red")
    # resources
    for (x, y, v) in ((19, 1, "full"), (20, 2, "half"), (21, 1, "low")):
        place("resource.gold", v, x, y)
    for (x, y, v) in ((21, 6, "full"), (20, 7, "half"), (22, 5, "low")):
        place("resource.stone", v, x, y)
    for (x, y) in ((8, 2), (9, 2), (8, 3)):
        place("resource.berry_bush", "full", x, y)
    trees = ["spruce_a", "spruce_b", "pine", "oak", "beech", "birch", "linden"]
    for x in range(0, 6):
        for y in range(0, 9):
            if (x, y) in occ:
                continue
            if x >= 4 and y >= 6 and rng.random() < 0.5:
                place("resource.stump", rng.choice(["conifer", "broadleaf"]), x, y)
            elif rng.random() < 0.82:
                place("resource.tree", rng.choice(trees), x, y)
    for (x, y) in ((22, 12), (23, 13), (21, 14), (0, 22), (2, 23), (23, 22)):
        place("resource.tree", rng.choice(trees), x, y)
    # decor
    for x in range(1, 4):
        place("decor.fence_rail", "x", x, 9)
    place("decor.hay", "stack", 3, 15)
    place("decor.cart", "hay", 6, 14)
    place("decor.well", None, 12, 9)
    place("decor.woodpile", None, 7, 1)
    place("decor.barrels", None, 14, 4)
    place("decor.wayside_shrine", None, 11, 15)
    place("decor.signpost", None, 9, 15)
    for x in range(0, N):
        if types[(x, 16)] == "sand" and rng.random() < 0.35:
            place("decor.reeds", None, x, 16)
    scatter = ["decor.grass", "decor.flowers", "decor.rocks", "decor.bush", "decor.fern"]
    for x in range(N):
        for y in range(N):
            if (x, y) in occ or types[(x, y)] not in ("grass", "meadow") or rng.random() > 0.08:
                continue
            a = rng.choice(scatter)
            place(a, rng.choice(list(ASSETS[a]["variants"])), x, y)
    for _py, _px, _i, r, x, y, _team in objs:
        if "shadow" in r:
            paste(shadows, frame_img(r["shadow"]), x - r["anchor"][0] * SCALE, y - r["anchor"][1] * SCALE)
    final = Image.new("RGBA", (W, H), BG)
    draw_terrain(final, types, elev, ox, oy, range(N), range(N))
    final.alpha_composite(shadows)
    for py, px, _i, r, x, y, team in sorted(objs):
        draw_sprite(final, r, x, y, team)
    # villager scale markers (0.3 tile wide, about door height)
    d = ImageDraw.Draw(final)
    for gx, gy in ((10.4, 9.6), (7.3, 6.0), (11.0, 14.2), (5.6, 13.2)):
        px = ox + (gx - gy) * TW / 2
        py = oy + (gx + gy) * TH / 2
        d.ellipse((px - 9, py - 3, px + 9, py + 3), fill=(0, 0, 0, 70))
        d.rounded_rectangle((px - 6, py - 21, px + 6, py), radius=5, fill=(220, 200, 150, 255), outline=(60, 40, 20, 255))
        d.ellipse((px - 4, py - 28, px + 4, py - 20), fill=(232, 196, 160, 255), outline=(60, 40, 20, 255))
    return final


# ---------------------------------------------------------------------------
# Asset grid
# ---------------------------------------------------------------------------

def cell_for(asset: str, variant: str) -> Image.Image:
    a = ASSETS[asset]
    r = a["variants"][variant]
    kind = a["kind"]
    if kind in ("terrain",):
        p = a.get("period", 1)
        n = 4 if p <= 4 else p
        types = {(x, y): asset.split(".", 1)[1] for x in range(-1, n + 1) for y in range(-1, n + 1)}
        w, h = n * TW + 8, n * TH + 8
        c = Image.new("RGBA", (w, h), BG)
        draw_terrain(c, types, {}, w / 2, 4, range(n), range(n))
        return c
    if kind == "cliff":
        types = {(x, y): {"earth": "grass", "rock": "stone", "sand": "sand", "snow": "snow"}[asset.split("_")[-1]]
                 for x in range(-1, 4) for y in range(-1, 4)}
        elev = {(x, y): (2 if 1 <= x <= 2 and 1 <= y <= 2 else 0) for x in range(4) for y in range(4)}
        c = Image.new("RGBA", (4 * TW + 8, 4 * TH + 24), BG)
        draw_terrain(c, types, elev, c.size[0] / 2, 12, range(4), range(4))
        return c
    if kind == "transition_mask":
        img = frame_img(r["frame"])
        c = Image.new("RGBA", img.size, (90, 90, 96, 255))
        c.alpha_composite(img)
        return c
    fw, fh = a["footprint"]
    img = frame_img(r["frame"])
    ax, ay = r["anchor"][0] * SCALE, r["anchor"][1] * SCALE
    # grass footprint under the sprite: its bottom corner lands on the anchor
    types = {(x, y): "grass" for x in range(-1, int(fw) + 1) for y in range(-1, int(fh) + 1)}
    out = Image.new("RGBA", img.size, BG)
    draw_terrain(out, types, {}, ax - (fw - fh) * TW / 2, ay - (fw + fh) * TH / 2, range(int(fw)), range(int(fh)))
    if "shadow" in r:
        paste(out, frame_img(r["shadow"]), 0, 0)
    draw_sprite(out, r, ax, ay, "blue")
    return out


def grid_section(title: str, items: list[tuple[str, Image.Image]], width: int) -> Image.Image:
    rows, row, x = [], [], 0
    probe = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    padded = []
    for label, img in items:
        tw = int(probe.textlength(label, font=F_SMALL)) + 6
        if tw > img.size[0]:
            c = Image.new("RGBA", (tw, img.size[1]), BG)
            c.alpha_composite(img, ((tw - img.size[0]) // 2, 0))
            img = c
        padded.append((label, img))
    for label, img in padded:
        w = img.size[0] + 10
        if row and x + w > width:
            rows.append(row)
            row, x = [], 0
        row.append((label, img))
        x += w
    if row:
        rows.append(row)
    heights = [max(i.size[1] for _, i in r) + 18 for r in rows]
    H = 40 + sum(heights)
    sheet = Image.new("RGBA", (width, H), BG)
    d = ImageDraw.Draw(sheet)
    d.text((8, 8), title, font=F_BIG, fill=(240, 236, 226, 255))
    y = 40
    for r, h in zip(rows, heights):
        x = 0
        for label, img in r:
            sheet.alpha_composite(img, (x, y + h - 18 - img.size[1]))
            d.text((x + 2, y + h - 15), label, font=F_SMALL, fill=(210, 210, 210, 255))
            x += img.size[0] + 10
        y += h
    return sheet


def trim(img: Image.Image, pad: int = 4) -> Image.Image:
    arr = np.asarray(img)
    diff = np.any(arr[..., :3] != np.array(BG[:3]), -1)
    ys, xs = np.nonzero(diff)
    if len(xs) == 0:
        return img
    return img.crop((max(0, xs.min() - pad), max(0, ys.min() - pad), min(img.size[0], xs.max() + pad + 1),
                     min(img.size[1], ys.max() + pad + 1)))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=OUT)
    args = ap.parse_args()
    village = trim(mock_village(), 8)
    width = max(village.size[0], 1800)
    sections = []
    groups = [
        ("Buildings", lambda k, a: k.startswith("building.")),
        ("Construction and rubble", lambda k, a: k.startswith(("construction.", "rubble."))),
        ("Nature and resources", lambda k, a: k.startswith("resource.")),
        ("Decor", lambda k, a: k.startswith("decor.")),
        ("Terrain (4x4 tiles each, frame 0)", lambda k, a: a["kind"] == "terrain"),
        ("Cliff steps and transition masks", lambda k, a: a["kind"] in ("cliff", "transition_mask")),
    ]
    for title, pred in groups:
        items = []
        for k, a in ASSETS.items():
            if not pred(k, a):
                continue
            variants = list(a["variants"])
            if a["kind"] in ("terrain", "cliff"):
                variants = [a["default"]]
            if k == "building.wall":
                variants = [v for v in variants if v.endswith((".0", ".5", ".10", ".15"))]
            for v in variants:
                items.append((f"{k.split('.', 1)[1]} {v}" if len(a["variants"]) > 1 and a["kind"] not in ("terrain", "cliff")
                              else k.split(".", 1)[1], trim(cell_for(k, v), 2)))
        sections.append(grid_section(title, items, width))
    head = Image.new("RGBA", (width, 40), BG)
    ImageDraw.Draw(head).text((8, 8), "Mock village (game scale 1x, team blue vs red, tan pawns = villager size)",
                              font=F_BIG, fill=(240, 236, 226, 255))
    parts = [head, village] + sections
    H = sum(p.size[1] for p in parts) + 20 * len(parts)
    sheet = Image.new("RGBA", (width, H), BG)
    y = 0
    for p in parts:
        sheet.alpha_composite(p, (0, y))
        y += p.size[1] + 20
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    sheet.convert("RGB").save(args.out, optimize=True)
    print(f"wrote {args.out} {sheet.size}")


if __name__ == "__main__":
    main()
