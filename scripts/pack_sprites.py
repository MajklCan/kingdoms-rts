"""Pack raw Blender renders into Phaser atlases and write the sprite manifest.

Reads art-source/blender/renders/<family>/records.json (written by
scripts/blender/render_all.py), trims every frame / mask / shadow to its
alpha bounds, packs them with a MaxRects packer into <=4096 px atlases per
family and writes:

  public/assets/sprites/<family>-<n>.png    atlas image
  public/assets/sprites/<family>-<n>.json   TexturePacker "JSON hash" (Phaser load.atlas)
  public/assets/sprites/manifest.json       logical assets -> frames, anchors, variants

Runs with any Python 3.9+ that has numpy plus either Pillow (system python)
or OpenImageIO (Blender's bundled python):

  python3 scripts/pack_sprites.py [--quantize]
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P scripts/pack_sprites.py

See docs/BLENDER_SPRITE_PIPELINE.md for the manifest format.
"""

from __future__ import annotations

import glob
import json
import os
import sys

import numpy as np

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
RAW = os.path.join(REPO, "art-source", "blender", "renders")
OUT = os.path.join(REPO, "public", "assets", "sprites")
MAX_SIZE = 4096
PAD = 2
RENDER_SCALE = 2

# ---------------------------------------------------------------------------
# Image IO (Pillow or OpenImageIO)
# ---------------------------------------------------------------------------

try:
    from PIL import Image  # type: ignore

    def load_rgba(path: str) -> np.ndarray:
        return np.asarray(Image.open(path).convert("RGBA")).copy()

    def save_rgba(path: str, arr: np.ndarray, quantize: bool = False) -> None:
        im = Image.fromarray(np.ascontiguousarray(arr))
        if quantize:
            im = im.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
        im.save(path, optimize=True, compress_level=9)

except ImportError:  # Blender's python
    import OpenImageIO as oiio  # type: ignore

    def load_rgba(path: str) -> np.ndarray:
        inp = oiio.ImageInput.open(path)
        spec = inp.spec()
        data = np.asarray(inp.read_image(0, 0, 0, spec.nchannels, "uint8")).reshape(spec.height, spec.width, spec.nchannels)
        inp.close()
        if spec.nchannels == 3:
            data = np.concatenate([data, np.full(data.shape[:2] + (1,), 255, np.uint8)], axis=2)
        return data.copy()

    def save_rgba(path: str, arr: np.ndarray, quantize: bool = False) -> None:
        h, w, c = arr.shape
        spec = oiio.ImageSpec(w, h, c, "uint8")
        spec.attribute("png:compressionLevel", 9)
        out = oiio.ImageOutput.create(path)
        out.open(path, spec)
        out.write_image(np.ascontiguousarray(arr))
        out.close()


# ---------------------------------------------------------------------------
# MaxRects bin packer (best short side fit)
# ---------------------------------------------------------------------------


class MaxRects:
    def __init__(self, w: int, h: int):
        self.w, self.h = w, h
        self.free = [(0, 0, w, h)]
        self.used: list[tuple[int, int, int, int]] = []

    def insert(self, w: int, h: int) -> tuple[int, int] | None:
        best = None
        best_score = (1 << 30, 1 << 30)
        for fx, fy, fw, fh in self.free:
            if w <= fw and h <= fh:
                short = min(fw - w, fh - h)
                long_ = max(fw - w, fh - h)
                if (short, long_) < best_score:
                    best_score = (short, long_)
                    best = (fx, fy)
        if best is None:
            return None
        rect = (best[0], best[1], w, h)
        self._split(rect)
        self.used.append(rect)
        return best

    def _split(self, r: tuple[int, int, int, int]) -> None:
        rx, ry, rw, rh = r
        new_free = []
        for f in self.free:
            fx, fy, fw, fh = f
            if rx >= fx + fw or rx + rw <= fx or ry >= fy + fh or ry + rh <= fy:
                new_free.append(f)
                continue
            if rx > fx:
                new_free.append((fx, fy, rx - fx, fh))
            if rx + rw < fx + fw:
                new_free.append((rx + rw, fy, fx + fw - rx - rw, fh))
            if ry > fy:
                new_free.append((fx, fy, fw, ry - fy))
            if ry + rh < fy + fh:
                new_free.append((fx, ry + rh, fw, fy + fh - ry - rh))
        # prune contained rectangles
        pruned = []
        for i, a in enumerate(new_free):
            contained = False
            for j, b in enumerate(new_free):
                if i != j and a[0] >= b[0] and a[1] >= b[1] and a[0] + a[2] <= b[0] + b[2] and a[1] + a[3] <= b[1] + b[3]:
                    if a != b or i > j:
                        contained = True
                        break
            if not contained:
                pruned.append(a)
        self.free = pruned


# ---------------------------------------------------------------------------
# Packing
# ---------------------------------------------------------------------------


def trim(arr: np.ndarray) -> tuple[np.ndarray, int, int]:
    a = arr[..., 3]
    ys, xs = np.nonzero(a)
    if len(xs) == 0:
        return arr[:1, :1].copy(), 0, 0
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    return arr[y0:y1, x0:x1].copy(), int(x0), int(y0)


def bleed(arr: np.ndarray) -> np.ndarray:
    """Copy RGB of opaque neighbours into fully transparent pixels so linear
    filtering at 0.5 scale does not pull dark fringes in from the background."""
    out = arr.copy()
    a = out[..., 3] > 0
    rgb = out[..., :3].astype(np.float32)
    for _ in range(2):
        acc = np.zeros_like(rgb)
        cnt = np.zeros(a.shape, np.float32)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            sh_a = np.roll(a, (dy, dx), (0, 1))
            sh_rgb = np.roll(rgb, (dy, dx), (0, 1))
            acc += sh_rgb * sh_a[..., None]
            cnt += sh_a
        fill = (~a) & (cnt > 0)
        rgb[fill] = acc[fill] / cnt[fill][:, None]
        a = a | fill
    out[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    return out


MASK_LUMA_GAIN = 1.25


def shaded_mask(mask: np.ndarray, colour: np.ndarray) -> np.ndarray:
    """Team mask RGB = the colour frame's luma * MASK_LUMA_GAIN (alpha unchanged).

    The engine tints the mask with the team colour and draws it over the frame
    with normal blending, which gives mix(rgb, team * luma * 1.25, alpha): the
    painted cloth keeps the render's light and shade instead of a flat fill.
    """
    rgb = colour[..., :3].astype(np.float32)
    luma = rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114
    shade = np.clip(luma * MASK_LUMA_GAIN, 0, 255).astype(np.uint8)
    out = mask.copy()
    out[..., 0] = shade
    out[..., 1] = shade
    out[..., 2] = shade
    return out


def pack_family(family: str, records: list[dict], quantize: bool) -> tuple[list[dict], dict[str, dict]]:
    """Returns (atlas descriptors, frame index name -> {atlas, w, h})."""
    sprites = []
    for rec in records:
        frame_path = os.path.join(REPO, rec["files"].get("frame", ""))
        colour = load_rgba(frame_path) if "frame" in rec["files"] and os.path.exists(frame_path) else None
        for kind, rel in rec["files"].items():
            path = os.path.join(REPO, rel)
            if not os.path.exists(path):
                continue
            arr = load_rgba(path)
            name = rec["name"] if kind == "frame" else f"{rec['name']}__{kind}"
            if kind == "mask" and colour is not None and colour.shape == arr.shape:
                arr = shaded_mask(arr, colour)
            t, ox, oy = trim(arr)
            if kind in ("frame", "mask"):
                t = bleed(t)
            sprites.append({"name": name, "img": t, "ox": ox, "oy": oy, "sw": arr.shape[1], "sh": arr.shape[0],
                            "anchor": rec["anchor"]})
    sprites.sort(key=lambda s: (-s["img"].shape[0], -s["img"].shape[1], s["name"]))
    atlases: list[dict] = []
    index: dict[str, dict] = {}
    remaining = sprites
    n = 0
    while remaining:
        size = _choose_size(remaining)
        packer = MaxRects(size, size)
        placed, left = [], []
        for s in remaining:
            h, w = s["img"].shape[:2]
            pos = packer.insert(w + PAD, h + PAD)
            if pos is None:
                left.append(s)
            else:
                placed.append((s, pos))
        if not placed:
            raise RuntimeError(f"sprite too large for {MAX_SIZE} atlas: {remaining[0]['name']}")
        used_w = max(p[0] + s["img"].shape[1] for s, p in placed) + PAD
        used_h = max(p[1] + s["img"].shape[0] for s, p in placed) + PAD
        canvas = np.zeros((used_h, used_w, 4), np.uint8)
        frames = {}
        key = f"kr-{family}-{n}"
        for s, (x, y) in placed:
            img = s["img"]
            h, w = img.shape[:2]
            canvas[y:y + h, x:x + w] = img
            frames[s["name"]] = {
                "frame": {"x": x, "y": y, "w": w, "h": h},
                "rotated": False,
                "trimmed": True,
                "spriteSourceSize": {"x": s["ox"], "y": s["oy"], "w": w, "h": h},
                "sourceSize": {"w": s["sw"], "h": s["sh"]},
                "pivot": {"x": round(s["anchor"][0] / s["sw"], 6), "y": round(s["anchor"][1] / s["sh"], 6)},
            }
            index[s["name"]] = {"atlas": key}
        img_name = f"{family}-{n}.png"
        json_name = f"{family}-{n}.json"
        save_rgba(os.path.join(OUT, img_name), canvas, quantize)
        with open(os.path.join(OUT, json_name), "w") as fh:
            json.dump({"frames": frames, "meta": {
                "app": "kingdoms-rts scripts/pack_sprites.py", "version": "1.0", "image": img_name,
                "format": "RGBA8888", "size": {"w": used_w, "h": used_h}, "scale": "1"}}, fh, separators=(",", ":"))
        atlases.append({"key": key, "image": img_name, "json": json_name, "size": [used_w, used_h],
                        "frames": len(frames)})
        remaining = left
        n += 1
    return atlases, index


def _choose_size(sprites: list[dict]) -> int:
    area = sum((s["img"].shape[0] + PAD) * (s["img"].shape[1] + PAD) for s in sprites)
    size = 512
    while size < MAX_SIZE and size * size < area * 1.25:
        size *= 2
    return size


# ---------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------

ERA_ORDER = ["dark", "castle", "gunpowder", "total_war"]
FARM_STAGES = ["sown", "growing", "ripe", "depleted"]


def sprite_ref(rec: dict, index: dict[str, dict]) -> dict:
    name = rec["name"]
    ref = {"atlas": index[name]["atlas"], "frame": name, "anchor": rec["anchor"], "size": [rec["width"], rec["height"]]}
    if f"{name}__mask" in index:
        ref["mask"] = f"{name}__mask"
    if f"{name}__shadow" in index:
        ref["shadow"] = f"{name}__shadow"
    return ref


def build_manifest(all_records: list[dict], atlases: dict[str, list[dict]], index: dict[str, dict]) -> dict:
    assets: dict[str, dict] = {}
    for rec in all_records:
        meta = rec.get("meta", {})
        aid = meta.get("asset", rec["name"])
        a = assets.setdefault(aid, {"kind": meta.get("kind", "sprite"), "footprint": rec["footprint"], "variants": {}})
        for k in ("defId", "tileType", "construction", "rubble", "resource", "period", "stepPx"):
            if k in meta:
                a[k] = meta[k]
        ref = sprite_ref(rec, index)
        for k in ("progress", "connections", "era", "amount", "frameIndex"):
            if k in meta:
                ref[k] = meta[k]
        a["variants"][meta.get("variant", "default")] = ref
    for aid, a in assets.items():
        keys = list(a["variants"].keys())
        eras = [e for e in ERA_ORDER if e in keys]
        if eras:
            a["eras"] = eras
            a["default"] = eras[0]
        elif a["kind"] == "construction":
            a["stages"] = sorted(keys, key=lambda k: a["variants"][k].get("progress", 0))
            a["default"] = a["stages"][0]
        elif set(keys) <= set(FARM_STAGES):
            a["stages"] = [k for k in FARM_STAGES if k in keys]
            a["default"] = "ripe" if "ripe" in keys else a["stages"][0]
        else:
            a["default"] = "default" if "default" in keys else sorted(keys)[0]
        a["variants"] = dict(sorted(a["variants"].items(), key=lambda kv: _vkey(kv[0])))
    return {
        "version": 1,
        "generator": "scripts/blender/render_all.py + scripts/pack_sprites.py",
        "doc": "docs/BLENDER_SPRITE_PIPELINE.md",
        "renderScale": RENDER_SCALE,
        "scale": 1.0 / RENDER_SCALE,
        "tile": {"w": 64, "h": 32, "elevationStepPx": 4},
        "eraOrder": ERA_ORDER,
        "conventions": {
            "anchor": "pixel (in sourceSize, render scale) of the bottom corner of the footprint diamond, for every "
                      "kind incl. terrain tiles; cliff faces: the tile's bottom corner at the top of that step",
            "terrain": "tile frame = variant str((x mod period) + period * (y mod period)); animated water "
                       "'<index>.<frame>'; cliff faces are one elevationStepPx step, stack them down to the "
                       "lower tile, use the *_lip variant for the topmost step",
            "transition": "white masks, alpha = how much of the neighbour's ground to draw over this tile; edge_px "
                          "= neighbour at x+1, corner_px_py = diagonal neighbour at x+1,y+1 (only when neither "
                          "adjacent edge neighbour matches)",
            "walls": "variant '<era>.<mask>', mask bits 1 = +x, 2 = +y, 4 = -x, 8 = -y (game tile directions)",
            "mask": "RGB = colour frame luma * 1.25 (grey shading), alpha = team colour coverage; tint (multiply) "
                    "with the team colour and draw over the frame with normal blending, same sourceSize and anchor",
            "shadow": "black RGB, alpha = shadow; draw on a ground layer below all objects, same sourceSize and anchor",
            "sun": "from screen top-left, shadows fall to the screen right",
            "gameToBlender": "game tile +x = Blender +X, game tile +y = Blender -Y, 1 tile = 1 Blender unit",
        },
        "atlases": [a for fam in sorted(atlases) for a in atlases[fam]],
        "assets": dict(sorted(assets.items())),
    }


def _vkey(k: str):
    parts = k.split(".")
    out = []
    for p in parts:
        if p in ERA_ORDER:
            out.append((0, ERA_ORDER.index(p), ""))
        elif p.isdigit():
            out.append((1, int(p), ""))
        else:
            out.append((2, 0, p))
    return out


def main() -> None:
    quantize = "--quantize" in sys.argv
    os.makedirs(OUT, exist_ok=True)
    for f in glob.glob(os.path.join(OUT, "*-[0-9]*.png")) + glob.glob(os.path.join(OUT, "*-[0-9]*.json")):
        os.remove(f)
    all_records: list[dict] = []
    atlases: dict[str, list[dict]] = {}
    index: dict[str, dict] = {}
    for rec_path in sorted(glob.glob(os.path.join(RAW, "*", "records.json"))):
        family = os.path.basename(os.path.dirname(rec_path))
        with open(rec_path) as fh:
            records = json.load(fh)
        if not records:
            continue
        fam_atlases, fam_index = pack_family(family, records, quantize)
        atlases[family] = fam_atlases
        index.update(fam_index)
        all_records.extend(records)
        print(f"[pack] {family}: {len(records)} sprites -> {len(fam_atlases)} atlas(es)")
    manifest = build_manifest(all_records, atlases, index)
    with open(os.path.join(OUT, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=1)
    total = sum(os.path.getsize(f) for f in glob.glob(os.path.join(OUT, "*.png")))
    print(f"[pack] {len(manifest['assets'])} assets, PNG payload {total / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
