"""Rebuild raw renders + records.json from the packed atlases and manifest.

The raw Blender renders (art-source/blender/renders/, gitignored) are not
kept in the repo. scripts/pack_sprites.py always repacks every family from
them, so re-rendering a handful of sprites on a fresh checkout would drop
everything else. This script reverses the packer: it cuts every frame, mask
and shadow back out of public/assets/sprites/*.png onto its full source
canvas and writes a records.json per family that pack_sprites.py accepts.

  python3 scripts/unpack_sprites.py [--force]

Then re-render only what changed (render_all.py --only merges records) and
repack:

  Blender -b --factory-startup -P scripts/blender/render_all.py -- \
      --families buildings --only wall_dark --no-pack
  python3 scripts/pack_sprites.py

Existing raw PNGs are kept unless --force is given.
"""

from __future__ import annotations

import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sprite_grade import ungrade_rgba  # noqa: E402

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
SPRITES = os.path.join(REPO, "public", "assets", "sprites")
RAW = os.path.join(REPO, "art-source", "blender", "renders")

ASSET_META = ("kind", "defId", "tileType", "construction", "rubble", "resource", "period", "stepPx")
VARIANT_META = ("progress", "connections", "era", "amount", "frameIndex")


def family_of(atlas_key: str) -> str:
    """'kr-buildings-0' -> 'buildings'."""
    return atlas_key[len("kr-"):].rsplit("-", 1)[0]


def main() -> None:
    force = "--force" in sys.argv
    with open(os.path.join(SPRITES, "manifest.json")) as fh:
        manifest = json.load(fh)
    # The packer grades colour frames (scripts/sprite_grade.py); undo it so
    # the raw renders stay ungraded and a repack does not grade twice.
    grade = manifest.get("grade")
    atlases = {}
    for a in manifest["atlases"]:
        with open(os.path.join(SPRITES, a["json"])) as fh:
            frames = json.load(fh)["frames"]
        image = np.asarray(Image.open(os.path.join(SPRITES, a["image"])).convert("RGBA"))
        atlases[a["key"]] = (frames, image)

    records: dict[str, list[dict]] = {}
    written = 0
    for asset_id, asset in manifest["assets"].items():
        for variant_key, v in asset["variants"].items():
            frames, image = atlases[v["atlas"]]
            family = family_of(v["atlas"])
            out_dir = os.path.join(RAW, family)
            os.makedirs(out_dir, exist_ok=True)
            name = v["frame"]
            files = {}
            for kind, frame_name in (("frame", name), ("mask", v.get("mask")), ("shadow", v.get("shadow"))):
                if not frame_name or frame_name not in frames:
                    continue
                path = os.path.join(out_dir, f"{frame_name}.png")
                files[kind] = os.path.relpath(path, REPO)
                if os.path.exists(path) and not force:
                    continue
                f = frames[frame_name]
                fr, ss, sp = f["frame"], f["sourceSize"], f["spriteSourceSize"]
                canvas = np.zeros((ss["h"], ss["w"], 4), np.uint8)
                cut = image[fr["y"]:fr["y"] + fr["h"], fr["x"]:fr["x"] + fr["w"]].copy()
                # The packer bled RGB into transparent pixels; keep them clean.
                cut[cut[..., 3] == 0] = 0
                canvas[sp["y"]:sp["y"] + fr["h"], sp["x"]:sp["x"] + fr["w"]] = cut
                if grade and kind == "frame" and asset_id != "terrain.transition":
                    canvas = ungrade_rgba(canvas, grade)
                    canvas[canvas[..., 3] == 0] = 0
                Image.fromarray(canvas).save(path)
                written += 1
            meta = {"asset": asset_id, "variant": variant_key}
            for k in ASSET_META:
                if k in asset:
                    meta[k] = asset[k]
            for k in VARIANT_META:
                if k in v:
                    meta[k] = v[k]
            records.setdefault(family, []).append({
                "name": name,
                "files": files,
                "anchor": v["anchor"],
                "width": v["size"][0],
                "height": v["size"][1],
                "footprint": asset["footprint"],
                "family": family,
                "meta": meta,
            })

    for family, recs in records.items():
        path = os.path.join(RAW, family, "records.json")
        merged: dict[str, dict] = {}
        if os.path.exists(path) and not force:
            with open(path) as fh:
                merged = {r["name"]: r for r in json.load(fh)}
        for r in recs:
            merged.setdefault(r["name"], r)
        with open(path, "w") as fh:
            json.dump(sorted(merged.values(), key=lambda r: r["name"]), fh, indent=1)
        print(f"[unpack] {family}: {len(recs)} records")
    print(f"[unpack] wrote {written} PNGs to {os.path.relpath(RAW, REPO)}")


if __name__ == "__main__":
    main()
