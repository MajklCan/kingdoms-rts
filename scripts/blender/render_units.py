"""Render every unit as style A sprite sheets: 8 facings x every animation,
team-colour masks and ground shadows, packed into Phaser JSON-hash atlases
plus `units-manifest.json`, and a 96x96 portrait per unit.

The renderer is a pure numpy voxel ray caster (units_rig.py), so this runs
under plain Python or headless Blender alike:

    python3 scripts/blender/render_units.py [--only villager,archer] [--jobs 8]
    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \\
        -P scripts/blender/render_units.py -- --only villager

Outputs (relative to the repo root):
    public/assets/sprites/units-<n>.png / .json   atlas pages
    public/assets/sprites/units-manifest.json     what the engine reads
    public/assets/ui/portraits/units/<unit>.png   96x96 busts + index.json
    art-source/blender/units/.cache/<unit>.npz    per-unit render cache (not committed),
                                                  so --only re-renders just those units

Frame names: `<unit>/<anim>/<facing>/<frame>` (base), `.../m` (team mask) and
`<unit>/<anim>/<facing>/<frame>/s` (shadow; frame 0 only unless the anim has
per-frame shadows). Every frame of a unit shares one source size and anchor.
See docs/UNIT_SPRITES.md.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import math
import os
import struct
import sys
import time
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import numpy as np  # noqa: E402

import units_rig as U  # noqa: E402
from units_body import HEAD_R  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SPRITES = os.path.join(ROOT, "public", "assets", "sprites")
PORTRAITS = os.path.join(ROOT, "public", "assets", "ui", "portraits", "units")
CACHE = os.path.join(ROOT, "art-source", "blender", "units", ".cache")

# unit name -> module (draw/ANIMS/DEF_IDS/PORTRAIT)
UNITS = {
    "villager": "units_villager",
    "militia": "units_militia",
    "spearman": "units_spearman",
    "archer": "units_archer",
    "cavalry": "units_cavalry",
    "gunman": "units_gunman",
    "cannon": "units_cannon",
}
# selection ring full width / height (px at 1x) and the projectile / effect point per unit
RINGS = {"cavalry": (44, 20), "cannon": (48, 22)}
DEFAULT_RING = (24, 10)
PROJECTILE_POINT = {"archer": "bow", "gunman": "muzzle", "cannon": "muzzle", "spearman": "tip",
                    "militia": None, "cavalry": "tip", "villager": None}
FACINGS = 8
PAGE = 2048
PAD = 1
PORTRAIT_SIZE = 96
PORTRAIT_TEAM = (0x2E, 0x86, 0xDE)  # player 1 blue, so the busts read as "your" units
CACHE_VERSION = 3


# ---------------------------------------------------------------------------
# rendering
# ---------------------------------------------------------------------------


def _anims(mod) -> dict:
    return {k: v for k, v in mod.ANIMS.items()}


def render_task(task: tuple) -> tuple:
    """(unit, anim, facing) -> list of frame dicts. Runs in worker processes."""
    unit, anim, facing = task
    mod = importlib.import_module(UNITS[unit])
    spec = mod.ANIMS[anim]
    out = []
    with np.errstate(all="ignore"):
        for fi in range(spec.frames):
            mk = U.Mk(facing=facing)
            mod.draw(mk, anim, fi)
            want_shadow = spec.shadow == "frame" or fi == 0
            fr = U.render(mk, shadow=want_shadow)
            out.append({
                "rgba": fr.rgba, "mask": fr.mask, "ax": fr.ax, "ay": fr.ay,
                "shadow": fr.shadow, "sax": fr.sax, "say": fr.say,
                "points": {k: (round(v[0], 2), round(v[1], 2)) for k, v in fr.points.items()},
            })
    return unit, anim, facing, out


def _source_hash(unit: str) -> str:
    h = hashlib.sha1(str(CACHE_VERSION).encode())
    for name in sorted(os.listdir(HERE)):
        if name.startswith("units") and name.endswith(".py"):
            with open(os.path.join(HERE, name), "rb") as fh:
                h.update(name.encode() + fh.read())
    h.update(unit.encode())
    return h.hexdigest()[:16]


def render_units(names: list[str], jobs: int) -> dict:
    tasks = []
    for unit in names:
        mod = importlib.import_module(UNITS[unit])
        for anim, spec in mod.ANIMS.items():
            if spec.alias:
                continue
            for f in range(FACINGS):
                tasks.append((unit, anim, f))
    res: dict = {u: {} for u in names}
    t0 = time.time()
    done = 0
    if jobs > 1:
        import multiprocessing as mp

        with mp.get_context("spawn").Pool(jobs) as pool:
            for unit, anim, facing, frames in pool.imap_unordered(render_task, tasks):
                res[unit][(anim, facing)] = frames
                done += 1
                if done % 40 == 0:
                    print(f"  {done}/{len(tasks)} strips, {time.time() - t0:.0f}s", flush=True)
    else:
        for t in tasks:
            unit, anim, facing, frames = render_task(t)
            res[unit][(anim, facing)] = frames
            done += 1
            if done % 40 == 0:
                print(f"  {done}/{len(tasks)} strips, {time.time() - t0:.0f}s", flush=True)
    return res


def save_cache(unit: str, strips: dict) -> None:
    os.makedirs(CACHE, exist_ok=True)
    flat = {}
    meta = []
    for (anim, facing), frames in strips.items():
        for i, fr in enumerate(frames):
            k = f"{anim}|{facing}|{i}"
            flat[k + "|rgba"] = fr["rgba"]
            flat[k + "|mask"] = fr["mask"]
            if fr["shadow"] is not None:
                flat[k + "|shadow"] = fr["shadow"]
            meta.append({"k": k, "ax": fr["ax"], "ay": fr["ay"], "sax": fr["sax"], "say": fr["say"],
                         "points": fr["points"], "shadow": fr["shadow"] is not None})
    flat["meta"] = np.frombuffer(json.dumps({"hash": _source_hash(unit), "frames": meta}).encode(), dtype=np.uint8)
    np.savez_compressed(os.path.join(CACHE, unit + ".npz"), **flat)


def load_cache(unit: str) -> dict | None:
    path = os.path.join(CACHE, unit + ".npz")
    if not os.path.exists(path):
        return None
    data = np.load(path)
    meta = json.loads(bytes(data["meta"]).decode())
    strips: dict = {}
    for m in meta["frames"]:
        anim, facing, i = m["k"].split("|")
        key = (anim, int(facing))
        strips.setdefault(key, [])
        fr = {"rgba": data[m["k"] + "|rgba"], "mask": data[m["k"] + "|mask"], "ax": m["ax"], "ay": m["ay"],
              "shadow": data[m["k"] + "|shadow"] if m["shadow"] else None, "sax": m["sax"], "say": m["say"],
              "points": {k: tuple(v) for k, v in m["points"].items()}}
        strips[key].append((int(i), fr))
    out = {k: [fr for _, fr in sorted(v, key=lambda t: t[0])] for k, v in strips.items()}
    out["__hash__"] = meta.get("hash")
    return out


# ---------------------------------------------------------------------------
# packing
# ---------------------------------------------------------------------------


def trim(img: np.ndarray) -> tuple[np.ndarray, int, int] | None:
    a = img[..., 3] > 0
    if not a.any():
        return None
    ys, xs = np.nonzero(a)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    return img[y0:y1, x0:x1], int(x0), int(y0)


class Packer:
    """Shelf packer over fixed-width pages, tallest sprites first."""

    def __init__(self, width: int = PAGE, height: int = PAGE):
        self.w, self.h = width, height
        self.pages: list[dict] = []

    def _new_page(self) -> dict:
        p = {"shelves": [], "used_h": 0}
        self.pages.append(p)
        return p

    def place(self, w: int, h: int) -> tuple[int, int, int]:
        w2, h2 = w + PAD * 2, h + PAD * 2
        for pi, p in enumerate(self.pages):
            for s in p["shelves"]:
                if h2 <= s["h"] and s["x"] + w2 <= self.w:
                    x = s["x"]
                    s["x"] += w2
                    return pi, x + PAD, s["y"] + PAD
            if p["used_h"] + h2 <= self.h:
                s = {"y": p["used_h"], "h": h2, "x": w2}
                p["shelves"].append(s)
                p["used_h"] += h2
                return pi, PAD, s["y"] + PAD
        p = self._new_page()
        s = {"y": 0, "h": h2, "x": w2}
        p["shelves"].append(s)
        p["used_h"] = h2
        return len(self.pages) - 1, PAD, PAD


def png_bytes(rgba: np.ndarray) -> bytes:
    """RGBA PNG with per-row adaptive filtering (numpy, no Pillow inside Blender)."""
    h, w = rgba.shape[:2]
    x = rgba.reshape(h, w * 4).astype(np.int16)
    left = np.zeros_like(x)
    left[:, 4:] = x[:, :-4]
    up = np.zeros_like(x)
    up[1:] = x[:-1]
    ul = np.zeros_like(x)
    ul[1:, 4:] = x[:-1, :-4]
    p = left + up - ul
    pa, pb, pc = np.abs(p - left), np.abs(p - up), np.abs(p - ul)
    paeth = np.where((pa <= pb) & (pa <= pc), left, np.where(pb <= pc, up, ul))
    cands = [x, x - left, x - up, x - ((left + up) >> 1), x - paeth]
    filt = [((c & 0xFF).astype(np.uint8)) for c in cands]
    score = np.stack([np.abs(f.astype(np.int8).astype(np.int32)).sum(1) for f in filt], 0)
    best = score.argmin(0)
    rows = np.choose(best[:, None], filt)
    raw = np.concatenate([best.astype(np.uint8)[:, None], rows], 1).tobytes()

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def build_atlas(all_strips: dict) -> tuple[list, dict]:
    """Trim, dedupe and pack every frame. Returns (pages, per-unit layout)."""
    items = []  # (name, image, ox, oy, canvas w, canvas h)
    layout = {}
    for unit, strips in all_strips.items():
        frames = [fr for k, v in strips.items() if k != "__hash__" for fr in v]
        left = max(max(fr["ax"] for fr in frames), max(fr["sax"] for fr in frames if fr["shadow"] is not None))
        up = max(max(fr["ay"] for fr in frames), max(fr["say"] for fr in frames if fr["shadow"] is not None))
        right = max(max(fr["rgba"].shape[1] - fr["ax"] for fr in frames),
                    max(fr["shadow"].shape[1] - fr["sax"] for fr in frames if fr["shadow"] is not None))
        down = max(max(fr["rgba"].shape[0] - fr["ay"] for fr in frames),
                   max(fr["shadow"].shape[0] - fr["say"] for fr in frames if fr["shadow"] is not None))
        cw, ch = left + right, up + down
        layout[unit] = {"size": [int(cw), int(ch)], "anchor": [int(left), int(up)]}
        for (anim, facing), frs in ((k, v) for k, v in strips.items() if k != "__hash__"):
            for i, fr in enumerate(frs):
                base = f"{unit}/{anim}/{facing}/{i}"
                for suffix, img, ax, ay in (("", fr["rgba"], fr["ax"], fr["ay"]), ("/m", fr["mask"], fr["ax"], fr["ay"]),
                                            ("/s", fr["shadow"], fr["sax"], fr["say"])):
                    if img is None:
                        continue
                    t = trim(img)
                    if t is None:
                        continue
                    sub, x0, y0 = t
                    items.append((base + suffix, sub, left - ax + x0, up - ay + y0, cw, ch))
    # dedupe identical trimmed images (same pixels + same offset)
    uniq: dict = {}
    for name, sub, ox, oy, cw, ch in items:
        key = hashlib.sha1(sub.tobytes() + struct.pack(">4i", ox, oy, *sub.shape[:2])).hexdigest()
        uniq.setdefault(key, {"img": sub, "names": [], "ox": ox, "oy": oy, "cw": cw, "ch": ch})
        uniq[key]["names"].append(name)
    order = sorted(uniq.values(), key=lambda e: (-e["img"].shape[0], -e["img"].shape[1]))
    packer = Packer()
    placed = []
    for e in order:
        h, w = e["img"].shape[:2]
        pi, x, y = packer.place(w, h)
        placed.append((pi, x, y, e))
    pages = []
    for pi, p in enumerate(packer.pages):
        hh = min(int(2 ** math.ceil(math.log2(max(p["used_h"], 64)))), PAGE)
        pages.append({"img": np.zeros((hh, PAGE, 4), dtype=np.uint8), "frames": {}})
    for pi, x, y, e in placed:
        img = e["img"]
        h, w = img.shape[:2]
        pages[pi]["img"][y:y + h, x:x + w] = img
        for name in e["names"]:
            pages[pi]["frames"][name] = {
                "frame": {"x": x, "y": y, "w": w, "h": h},
                "rotated": False,
                "trimmed": True,
                "spriteSourceSize": {"x": e["ox"], "y": e["oy"], "w": w, "h": h},
                "sourceSize": {"w": e["cw"], "h": e["ch"]},
            }
    print(f"packed {len(items)} frames ({len(uniq)} unique) into {len(pages)} page(s)")
    return pages, layout


# ---------------------------------------------------------------------------
# manifest
# ---------------------------------------------------------------------------


def unit_manifest(unit: str, strips: dict, layout: dict) -> dict:
    mod = importlib.import_module(UNITS[unit])
    anims = {}
    for name, spec in mod.ANIMS.items():
        a: dict = {"frames": spec.frames}
        if spec.alias:
            a = {"alias": spec.alias}
        else:
            if spec.stride:
                a["stride"] = spec.stride
            if spec.ms:
                a["ms"] = spec.ms
            if spec.hit >= 0:
                a["hit"] = spec.hit
            if spec.once:
                a["once"] = True
            a["shadow"] = spec.shadow
        anims[name] = a
    ax, ay = layout["anchor"]
    # height to the top of the head (idle frame 0, highest facing) for bars / hit flashes
    heads = [-strips[("idle", f)][0]["points"].get("head", (0, -36))[1] for f in range(FACINGS)]
    height = int(math.ceil(max(heads)))
    out = {
        "defIds": list(mod.DEF_IDS),
        "size": layout["size"],
        "anchor": [ax, ay],
        "height": height,
        "ring": list(RINGS.get(unit, DEFAULT_RING)),
        "anims": anims,
    }
    point = PROJECTILE_POINT.get(unit)
    if point and "attack" in mod.ANIMS:
        hit = max(mod.ANIMS["attack"].hit, 0)
        pts = []
        for f in range(FACINGS):
            p = strips[("attack", f)][hit]["points"].get(point)
            pts.append([round(p[0], 1), round(p[1], 1)] if p else [0, -height * 0.6])
        out["projectile"] = pts
    return out


# ---------------------------------------------------------------------------
# portraits
# ---------------------------------------------------------------------------


def portrait(unit: str) -> np.ndarray:
    mod = importlib.import_module(UNITS[unit])
    spec = getattr(mod, "PORTRAIT", {"fit": "head", "density": 4.0, "anim": "idle", "frame": 0, "facing": 1})
    facing = spec.get("facing", 1)

    def shot(d: float, half: int, layers: int):
        mk = U.Mk(facing=facing, density=d, half=half, layers=layers)
        with np.errstate(all="ignore"):
            mod.draw(mk, spec["anim"], spec["frame"])
            return mk, U.render(mk)

    if spec.get("fit") == "whole":
        # fit the whole unit (cavalry, guns) with a small margin, centred
        _, small = shot(1.0, 48, 96)
        ys, xs = np.nonzero(small.rgba[..., 3])
        d = (PORTRAIT_SIZE - 10) / max(xs.max() - xs.min() + 1, ys.max() - ys.min() + 1)
        mk, fr = shot(d, 48, 96)
        ys, xs = np.nonzero(fr.rgba[..., 3])
        col0 = int(round((xs.min() + xs.max()) / 2 - PORTRAIT_SIZE / 2))
        row0 = int(round(ys.max() + 6 - PORTRAIT_SIZE))
    else:
        # bust: head centre at (48, 42), shoulders and chest below
        d = spec.get("density", 4.0)
        mk, fr = shot(d, 24, 60)
        hx, hy = mk.screen_of(mk.points.get("head", np.array([0.0, 0.0, 0.85])))
        head_c = (fr.ax + hx * d, fr.ay + (hy + 1.5 * HEAD_R / U.VZ) * d)
        col0 = int(round(head_c[0] - PORTRAIT_SIZE / 2))
        row0 = int(round(head_c[1] - 42))
    out = np.zeros((PORTRAIT_SIZE, PORTRAIT_SIZE, 4), dtype=np.float64)
    # backdrop: warm sky to meadow, soft vignette (style A grade)
    yy, xx = np.mgrid[0:PORTRAIT_SIZE, 0:PORTRAIT_SIZE] / (PORTRAIT_SIZE - 1)
    sky = np.array([0.80, 0.86, 0.90])
    meadow = np.array([0.55, 0.66, 0.40])
    t = np.clip((yy - 0.45) / 0.55, 0, 1)[..., None]
    bg = sky * (1 - t) + meadow * t
    vig = 1.0 - 0.28 * (((xx - 0.5) ** 2 + (yy - 0.45) ** 2) * 2.2)[..., None]
    out[..., :3] = np.clip(bg * vig, 0, 1) * 255
    out[..., 3] = 255
    src = fr.rgba.astype(np.float64)
    m = fr.mask.astype(np.float64)
    team = np.array(PORTRAIT_TEAM, dtype=np.float64)
    ma = m[..., 3:4] / 255.0
    src[..., :3] = src[..., :3] * (1 - ma) + (m[..., :3] / 255.0) * team * ma
    h, w = src.shape[:2]
    for y in range(PORTRAIT_SIZE):
        sy = row0 + y
        if not 0 <= sy < h:
            continue
        x0, x1 = max(col0, 0), min(col0 + PORTRAIT_SIZE, w)
        if x1 <= x0:
            continue
        a = src[sy, x0:x1, 3:4] / 255.0
        dst = out[y, x0 - col0:x1 - col0, :3]
        out[y, x0 - col0:x1 - col0, :3] = dst * (1 - a) + src[sy, x0:x1, :3] * a
    return np.clip(np.round(out), 0, 255).astype(np.uint8)


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def main(argv: list[str]) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--only", default="", help="comma separated units to re-render (others come from the cache)")
    ap.add_argument("--jobs", type=int, default=0, help="worker processes (default: CPU count, 1 inside Blender)")
    ap.add_argument("--no-portraits", action="store_true")
    ap.add_argument("--force", action="store_true", help="ignore the render cache")
    args = ap.parse_args(argv)
    in_blender = "bpy" in sys.modules
    jobs = args.jobs or (1 if in_blender else max(1, (os.cpu_count() or 2) - 1))
    only = [u.strip() for u in args.only.split(",") if u.strip()]
    for u in only:
        if u not in UNITS:
            raise SystemExit(f"unknown unit {u!r}; known: {', '.join(UNITS)}")

    all_strips: dict = {}
    todo = []
    for unit in UNITS:
        cached = None if (args.force or (only and unit in only)) else load_cache(unit)
        if cached is not None and cached.get("__hash__") == _source_hash(unit):
            cached.pop("__hash__", None)
            all_strips[unit] = cached
        elif cached is not None and only and unit not in only:
            print(f"{unit}: cache is stale but not requested; reusing it (run without --only to refresh)")
            cached.pop("__hash__", None)
            all_strips[unit] = cached
        else:
            todo.append(unit)
    if todo:
        print(f"rendering {', '.join(todo)} with {jobs} job(s)")
        fresh = render_units(todo, jobs)
        for unit in todo:
            save_cache(unit, fresh[unit])
            all_strips[unit] = fresh[unit]

    pages, layout = build_atlas(all_strips)
    os.makedirs(SPRITES, exist_ok=True)
    for name in os.listdir(SPRITES):
        if name.startswith("units-") and name[6:7].isdigit():
            os.remove(os.path.join(SPRITES, name))
    atlases = []
    total = 0
    for i, p in enumerate(pages):
        png = png_bytes(p["img"])
        total += len(png)
        with open(os.path.join(SPRITES, f"units-{i}.png"), "wb") as fh:
            fh.write(png)
        meta = {"app": "kingdoms-rts scripts/blender/render_units.py", "image": f"units-{i}.png",
                "format": "RGBA8888", "size": {"w": int(p["img"].shape[1]), "h": int(p["img"].shape[0])},
                "scale": "1"}
        with open(os.path.join(SPRITES, f"units-{i}.json"), "w") as fh:
            json.dump({"frames": p["frames"], "meta": meta}, fh, separators=(",", ":"))
        atlases.append({"key": f"kr-units-{i}", "image": f"units-{i}.png", "json": f"units-{i}.json"})
        print(f"units-{i}.png {p['img'].shape[1]}x{p['img'].shape[0]} {len(png) / 1e6:.2f} MB")
    manifest = {
        "version": 1,
        "scale": 1,
        "facings": ["E", "SE", "S", "SW", "W", "NW", "N", "NE"],
        "frameName": "<unit>/<anim>/<facing>/<frame>[/m|/s]",
        "atlases": atlases,
        "units": {u: unit_manifest(u, all_strips[u], layout[u]) for u in UNITS},
    }
    with open(os.path.join(SPRITES, "units-manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=1)
        fh.write("\n")
    print(f"atlas total {total / 1e6:.2f} MB")

    if not args.no_portraits:
        os.makedirs(PORTRAITS, exist_ok=True)
        index = {}
        for unit in (only or list(UNITS)):
            img = portrait(unit)
            with open(os.path.join(PORTRAITS, unit + ".png"), "wb") as fh:
                fh.write(png_bytes(img))
            mod = importlib.import_module(UNITS[unit])
            for d in mod.DEF_IDS:
                index[d] = f"{unit}.png"
        idx_path = os.path.join(PORTRAITS, "index.json")
        old = {}
        if only and os.path.exists(idx_path):
            with open(idx_path) as fh:
                old = json.load(fh).get("units", {})
        old.update(index)
        with open(idx_path, "w") as fh:
            json.dump({"size": PORTRAIT_SIZE, "units": dict(sorted(old.items()))}, fh, indent=1)
            fh.write("\n")
        print(f"portraits -> {os.path.relpath(PORTRAITS, ROOT)}")


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    if "bpy" in sys.modules and "--" not in sys.argv:
        argv = []
    main(argv)
