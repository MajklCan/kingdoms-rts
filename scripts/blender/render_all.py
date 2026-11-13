"""Render every sprite family and pack the atlases + manifest.

Headless:
    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        -P scripts/blender/render_all.py -- [--families buildings,nature] [--only house] \
        [--samples 96] [--no-pack] [--no-blend]

Inside a live Blender (MCP execute_blender_code):
    import sys; sys.argv = ["blender", "--", "--only", "house"]
    exec(open("<repo>/scripts/blender/render_all.py").read())

Each family renders into its own scene (KR_<family>), never touching other
scenes. Raw PNGs and records.json go to art-source/blender/renders/<family>/,
the scene is written to art-source/blender/<family>.blend, then
scripts/pack_sprites.py builds public/assets/sprites/.
"""

from __future__ import annotations

import argparse
import importlib
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else None
if HERE is None:  # exec() from MCP without __file__
    HERE = os.path.join(os.environ.get("KR_REPO", os.getcwd()), "scripts", "blender")
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy  # noqa: E402

import kr_lib  # noqa: E402

FAMILIES = ("buildings", "nature", "terrain", "decor")


def _args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--families", default=",".join(FAMILIES))
    p.add_argument("--only", default=None, help="substring filter on job names")
    p.add_argument("--samples", type=int, default=96)
    p.add_argument("--no-pack", action="store_true")
    p.add_argument("--no-blend", action="store_true")
    return p.parse_args(argv)


def run_family(family: str, only: str | None, samples: int, save_blend: bool) -> list[dict]:
    mod = importlib.import_module(family)
    importlib.reload(mod)
    jobs = mod.jobs(only)
    if not jobs:
        return []
    out_dir = os.path.join(kr_lib.RAW_DIR, family)
    os.makedirs(out_dir, exist_ok=True)
    scene = kr_lib.new_scene(f"KR_{family}", samples=samples)
    if hasattr(mod, "setup_scene"):
        mod.setup_scene(scene)
    t0 = time.time()
    records = kr_lib.run_jobs(scene, jobs, out_dir)
    print(f"[{family}] {len(records)} sprites in {time.time() - t0:.1f}s")
    for rec in records:
        rec["family"] = family
        for k, v in list(rec["files"].items()):
            rec["files"][k] = os.path.relpath(v, kr_lib.REPO_ROOT)
    rec_path = os.path.join(out_dir, "records.json")
    merged: dict[str, dict] = {}
    if only and os.path.exists(rec_path):
        with open(rec_path) as fh:
            merged = {r["name"]: r for r in json.load(fh)}
    for rec in records:
        merged[rec["name"]] = rec
    with open(rec_path, "w") as fh:
        json.dump(sorted(merged.values(), key=lambda r: r["name"]), fh, indent=1)
    if save_blend and not only:
        path = os.path.join(kr_lib.ART_DIR, f"{family}.blend")
        bpy.data.libraries.write(path, {scene}, fake_user=True, compress=True)
        print(f"[{family}] wrote {path}")
    return records


def main() -> None:
    args = _args()
    fams = [f.strip() for f in args.families.split(",") if f.strip()]
    for fam in fams:
        run_family(fam, args.only, args.samples, not args.no_blend)
    if not args.no_pack:
        pack = os.path.join(kr_lib.REPO_ROOT, "scripts", "pack_sprites.py")
        if os.path.exists(pack):
            sys.argv = [pack]
            ns: dict = {"__name__": "__main__", "__file__": pack}
            with open(pack) as fh:
                exec(compile(fh.read(), pack, "exec"), ns)


main()
