# Blender sprite pipeline

Pre-rendered sprites for buildings, nature, terrain and decor, built from
procedural Blender models (no imported or generated meshes, no external
textures). Units have their own numpy pipeline, see
[UNIT_SPRITES.md](UNIT_SPRITES.md). Everything is reproducible from the
scripts in `scripts/blender/`.

The default look is **style A, the hi-res voxel diorama**
(`art-source/style-explore/style-A.png`): every model is voxelised onto one
global lattice (`kr_voxel.py`, a voxel is 1/32 tile wide and exactly 1 px per
layer) and rendered at 1x with no anti-aliasing, so sprites are crisp pixel art
drawn at scale 1 with nearest filtering. Terrain is not rendered in Cycles at
all: `terrain_vox.py` ray casts the same voxel lattice in numpy, which makes the
tiles exactly reproducible. The previous smooth 2x look stays available behind
`--style smooth`.

## Outputs

| Path | What |
| --- | --- |
| `public/assets/sprites/<family>-<n>.png` + `.json` | Packed atlases, Phaser JSON hash (TexturePacker format, trimmed frames) |
| `public/assets/sprites/manifest.json` | Every asset, its variants, frames, anchors, masks, shadows |
| `art-source/blender/<family>.blend` | The generated scene of each family (for inspection, not edited by hand) |
| `art-source/blender/contact-sheet.png` | All assets at game scale plus a mock village, built from the packed output |
| `art-source/blender/renders/` | Raw per-sprite PNGs and `records.json` (gitignored, regenerated) |

Families: `buildings`, `nature`, `terrain`, `decor`. Style A atlases are packed
as 256 colour PNGs: about 0.56 MB in total (the smooth 2x set was 7.28 MB,
style A without quantizing about 3 MB).

## Re-running

Blender 5.2 (tested 5.2.1, Cycles on Metal GPU). The binary is not on PATH:

```sh
BLENDER=/Applications/Blender.app/Contents/MacOS/Blender

# everything: render, save .blend files, pack atlases + manifest (about 2 minutes)
$BLENDER -b --factory-startup -P scripts/blender/render_all.py

# one family, or a substring filter on sprite names (merges into existing records)
$BLENDER -b --factory-startup -P scripts/blender/render_all.py -- --families buildings --only house,mill_
# options: --style A|smooth  --samples 96  --no-pack  --no-blend

# pack only (after renders exist). Style A is 256 colour quantized by default
# (--no-quantize to skip); smooth renders only with --quantize
python3 scripts/pack_sprites.py [--quantize | --no-quantize]

# style A terrain alone, without Blender
python3 scripts/blender/terrain_vox.py art-source/blender/renders/terrain [only]

# fresh checkout: the raw renders are gitignored and the packer repacks every
# family from them, so rebuild them from the packed atlases first, then
# re-render only what changed (--only merges records) and pack
python3 scripts/unpack_sprites.py
$BLENDER -b --factory-startup -P scripts/blender/render_all.py -- --families buildings --only wall_dark --no-pack
python3 scripts/pack_sprites.py

# contact sheet from the packed output
python3 scripts/contact_sheet.py
```

Inside a live Blender session (for example through MCP) the same script runs
in its own scenes (`KR_<family>`) and never touches other scenes:

```python
import os, sys
os.environ["KR_REPO"] = "/path/to/kingdoms-rts"
sys.argv = ["blender", "--", "--families", "decor", "--no-blend"]
exec(open(os.environ["KR_REPO"] + "/scripts/blender/render_all.py").read())
```

Python packages used outside Blender: `numpy`, `Pillow`. `render_all.py` runs
the packer with the system `python3` when it has both (Blender's bundled
Python has no Pillow, so it could not quantize).

## Code layout

| File | Role |
| --- | --- |
| `scripts/blender/kr_lib.py` | Scene, camera, sun, passes, framing, render + pass extraction, procedural `Surface` materials, style switch (`configure`) and the style A grade |
| `scripts/blender/kr_voxel.py` | Style A voxeliser: samples a built collection onto the global lattice, colours voxels from the `Surface` recipes, emits exposed faces; pose deformations (tree sway) |
| `scripts/blender/terrain_vox.py` | Style A terrain: numpy voxel ray caster for ground, cliffs, transitions, shore foam, edge AO / rims, bridge rails |
| `scripts/blender/kr_kit.py` | Building kit: palette `M`, era `STYLES`, builder `B` (boxes, beams, roofs, openings, timber frame, props) |
| `scripts/blender/bld_common.py` | Shared hall/wall helpers for buildings |
| `scripts/blender/buildings.py` | All 13 building types per era, farm stages, wall connection masks, construction stages, rubble |
| `scripts/blender/nature.py` | Trees, stumps, berry bushes, gold and stone piles |
| `scripts/blender/terrain.py` | Periodic ground materials, block render and slicing, cliff steps, transition masks |
| `scripts/blender/decor.py` | Fences, hay, carts, rocks, grass, flowers, small props |
| `scripts/blender/render_all.py` | Entry point, runs families and the packer |
| `scripts/pack_sprites.py` | Trim, bleed, MaxRects packing, atlas JSON, manifest |
| `scripts/contact_sheet.py` | Contact sheet and mock village from the manifest (also a usage reference) |

A family module exposes `jobs(only)` returning `kr_lib.Job`s (one 3D build
function per sprite), or `render(scene, out_dir, only)` when it composes its
own frames (terrain).

## Sprite conventions

- **Projection**: orthographic, azimuth 45 deg, elevation 30 deg, 1 tile = 1
  Blender unit. Game tile +x = Blender +X, game tile +y = Blender -Y. The 64x32
  diamond is exact.
- **Scale**: style A renders at 1x (64x32 per tile, `renderScale` 1) and every
  frame is drawn at `manifest.scale` = 1 with nearest filtering on integer
  positions. Smooth renders at 2x and draws at 0.5 with linear filtering.
- **Anchor**: `anchor` is the pixel (in the frame's full `sourceSize`, at render scale)
  of the bottom corner of the footprint diamond. For an object whose
  footprint starts at tile (x, y) with size (w, h), put the anchor at the
  screen position of the tile corner (x + w, y + h). Atlas `pivot` holds the
  same point normalised, so `setOrigin(pivot.x, pivot.y)` works directly.
  Variants of one asset (eras, stages) share frame size and anchor.
- **Light**: one sun from the screen top-left (shadows fall to the screen
  right), warm key, cool sky fill. Faces toward screen bottom-left are lit,
  faces toward bottom-right are in shade.
- **Shadow**: separate frame `<frame>__shadow`, same size and anchor, black
  with alpha (strength baked in, about 0.6 max). Draw all shadows on a ground
  layer above terrain and below all objects. The colour frame has no ground
  shadow in it, only self-shadowing.
- **Team colour**: separate frame `<frame>__mask`, same size and anchor, alpha
  = team coverage. In the colour frame team parts are neutral light grey. The
  renderer writes a white mask; the packer replaces its RGB with the colour
  frame's luma * 1.25, so the engine only tints the mask with the player
  colour and draws it over the frame with normal blending, which gives
  `rgb = mix(rgb, playerColor * luma * 1.25, maskAlpha)` (the contact sheet
  formula).
- **Sizes**: doors are about 0.52 tile high (villager height), a villager is
  about 0.3 tile wide.

## Colour grade

Style A is graded at render time (`kr_lib.grade_a`: saturation, contrast, warm
sun, cool shadows, the same numbers as the style exploration); the manifest
says so in `"grade"` and the packer leaves those frames alone.

For smooth renders the packer grades every colour frame before trimming
(`scripts/sprite_grade.py`): a midtone lift that leaves blacks and whites in
place, a touch of saturation and a slightly warmer sun. Masks are derived from
the graded colour, shadow frames and terrain transition masks are not graded.
The grade that was applied is stored in `manifest.json` under `"grade"`, and
`unpack_sprites.py` applies the inverse, so unpack + repack never grades twice.
Change the numbers in `GRADE` (and bump its `version`), then unpack and repack
to regrade without re-rendering. Preview a grade on any screenshot with
`python3 scripts/sprite_grade.py --preview in.png out.png`.

## manifest.json

```jsonc
{
  "version": 1,
  "style": "A",                         // or "smooth"
  "renderScale": 1,                     // smooth: 2
  "scale": 1.0,                         // smooth: 0.5
  "tile": { "w": 64, "h": 32, "elevationStepPx": 4 },
  "eraOrder": ["dark", "castle", "gunpowder", "total_war"],
  "conventions": { ... },               // the rules above as short strings
  "atlases": [{ "key": "kr-buildings-0", "image": "buildings-0.png", "json": "buildings-0.json", "size": [w, h], "frames": n }],
  "assets": {
    "building.house": {
      "kind": "building",
      "footprint": [1, 1],
      "defId": "HOUSE",                  // BuildingDefId key in src/sim/defs.ts
      "construction": "construction.1x1",
      "rubble": "rubble.1x1",
      "eras": ["dark", "castle", "gunpowder"],
      "default": "dark",
      "variants": {
        "dark": { "atlas": "kr-buildings-0", "frame": "house_dark", "anchor": [ax, ay], "size": [w, h],
                  "mask": "house_dark__mask", "shadow": "house_dark__shadow" }
      }
    }
  }
}
```

Load each atlas with `this.load.atlas(key, image, json)`. A variant names its
atlas key and frame; `mask` and `shadow` frames live in the same atlas.

Animation is baked as frames, never as runtime transforms, so it stays on the
pixel lattice:

- `variant.poses` = whole-sprite frames drawn instead of the base. Trees and
  the swaying decor (`decor.grass`, `decor.reeds`, `decor.fern`) have `swayl`
  and `swayr`; the engine picks one per gust band.
- `variant.overlays` = looping frame lists (each with its team mask) drawn
  over the base with the same size and anchor: `flag` (6 frames of banners on
  every building with a pole: town centre, house, barracks, range, stable,
  tower, mill, foundry and the camps) and `sails` (8 frames of windmill
  blades).

### Variant keys

| Asset | Keys | Notes |
| --- | --- | --- |
| `building.*` | `dark`, `castle`, `gunpowder` | Missing era: use the nearest earlier era in `eraOrder` that exists, else `default`. `total_war` has no sprites yet, so it falls back to `gunpowder`. Archery range, stable, lumber camp, gold mine and stone quarry have dark + castle; the foundry only gunpowder. |
| `building.farm` | `sown`, `growing`, `ripe`, `depleted` | Listed in `stages`, default `ripe`. Not era dependent. |
| `building.wall` | `<era>.<mask>` | `mask` = sum of connected neighbours: 1 = +x, 2 = +y, 4 = -x, 8 = -y (game tile directions), 0..15. |
| `construction.NxN` | `0`, `1`, `2` | `stages` in order, each variant has `progress` (0, 0.34, 0.67): show the last stage whose progress is reached. One set per footprint size (1x1, 2x2, 3x3). |
| `rubble.NxN` | `default` | Per footprint size. |
| `resource.tree` | `spruce_a`, `spruce_b`, `pine`, `oak`, `beech`, `linden`, `birch` | Pick per tile with a position hash. Also `resource.tree_snow` (`a`, `b`), `resource.tree_dead`, `resource.stump` (`conifer`, `broadleaf`). |
| `resource.berry_bush`, `resource.gold`, `resource.stone` | `full`, `half`, `low` | `amount` 1.0 / 0.5 / 0.2: show the variant whose amount is closest to remaining / initial. |
| `decor.*` | per asset | `decor.fence_rail` / `decor.fence_wattle` have `x` and `y` (along the tile centre line in game +x or +y); put both on one tile for a corner. |
| `terrain.<type>` | tile frames, see below | `tileType` = `TileType` key in `src/sim/map-gen.ts`. |
| `terrain.cliff_<kind>` | `left`, `right`, `left_lip`, `right_lip` | `kind` = earth, rock, sand (no lip), snow. |
| `terrain.transition` | `edge_px.0..2`, `edge_mx.*`, `edge_py.*`, `edge_my.*`, `corner_px_py`, `corner_px_my`, `corner_mx_py`, `corner_mx_my` | See below. |
| `terrain.foam` | `<transition key>.<frame>` | Shore foam ring just outside that transition mask, drawn on the water tile under the land, animated with the water. |
| `terrain.edge` | `ao_mx`, `ao_my`, `rim_px`, `rim_py` | `ao_*` darkens a lower tile along a higher back neighbour, `rim_*` lights the lip of a raised tile over a lower front neighbour. |
| `terrain.bridge_rail` | `mx`, `my`, `px`, `py` | Railing drawn after a bridge tile on each open side. |
| `feature.rock_spire` | per footprint size | Own sprite per size, drawn at scale 1. |

### Terrain tiles

Every ground type is rendered as a seamless block of `period` x `period` tiles
(style A: 4 for every ground, 2 for bridges and water). Tile (x, y) uses
variant `String((x % period) + period * (y % period))`; neighbouring tiles of
one type then always continue each other, and the voxel scatter (tufts,
pebbles, slabs, drifts) is periodic too, so the ground never shows a repeat
inside a block. Water and shallow water have 4 looping animation frames:
variant `"<index>.<frame>"`.

Style A tile frames are 72x36: the 64x32 diamond plus 4 / 2 px of
continuation. Anchor (36, 34) is the bottom corner of the diamond. The engine
clips every tile to its exact pixel staircase, so each screen pixel belongs to
one tile. Draw back to front (x + y). (Smooth: 144x72 at 2x with a filtering
bleed, anchor (72, 68).)

In the engine the tiles are baked into 8x8 tile chunk textures
(`src/render/terrain/terrain-baker.ts`). Chunk origins sit on a 4 px grid and
each chunk bakes the ring of neighbour tiles from later chunks under its own
tiles, so the fractional zoom steps (1.5, 2.5) never open 1 px seams between
chunks.

Types: `grass`, `meadow` (grass with flowers, also `GRASS`), `forest`, `dirt`,
`sand`, `stone`, `mud`, `snow`, `snow_forest`, `packed_snow`, `ice`,
`bridge_x` / `bridge_y` (planks across travel along game x or y), `water`,
`water_shallow`. `BARBED_WIRE` has no tile yet (use mud).

### Elevation

A raised tile is drawn `elevation * elevationStepPx` higher. Cliff frames are
one step (4 px at 1x) tall and stack: for elevation `e` draw `e` copies of the
left and right face below the tile edges, the topmost one as `*_lip` (grass or
snow overhang). Their anchor is the tile's bottom corner at the top of that
step, so step `s` (0 = top) goes at `tileBottomCorner + (0, s * 4)` at 1x.
Suggested mapping: grass, meadow, forest, dirt, mud = `earth`; stone = `rock`;
sand = `sand`; snow types = `snow`.

### Transitions

Masks are white with alpha = how much of the neighbour's ground to show on this
tile; they are not cut to the diamond. For tile T and a neighbour type N of
higher priority (suggested: water < shallow < sand < mud < dirt < stone < grass
< meadow < forest < snow):

- `edge_px.k` when the neighbour at x+1 is N (`mx` = x-1, `py` = y+1,
  `my` = y-1). Pick `k` per tile, for example `(x * 7 + y * 13) % 3`; every
  variant joins every other at the tile corners.
- `corner_px_py` when only the diagonal x+1, y+1 is N (neither x+1 nor y+1).
- Combine several masks for one N with `max`, then **mix** N's tile frame for
  the same (x, y) into T's colour and keep T's alpha:
  `rgb = mix(T.rgb, N.rgb, mask)`. A plain alpha "over" leaks T's bleed at the
  cut edge as a thin line.

`scripts/contact_sheet.py` (`tile_with_transitions`, `draw_terrain`) is a
working reference of tiles, transitions and cliffs.

## Adding or changing an asset

1. Add a build function (and a `Job`, or a terrain entry) to the family module.
   Use `kr_kit.B` primitives and palette keys from `kr_kit.M`; team parts use
   `team` or `team_paint`.
2. Set `meta.asset` (manifest id), `meta.variant`, and `group` when variants must
   share a frame.
3. Render it with `--only`, then `python3 scripts/contact_sheet.py` and look at
   it at game scale before committing.

How the game consumes all of this (layers, anchors, fog, terrain bake): see
[SPRITE_ATLAS.md](SPRITE_ATLAS.md).

## Known weak spots

- Elevation is stronger than before (edge AO under higher neighbours, lit rims
  on raised lips) but a single 4 px step still reads as a thin line, and there
  are no slope sprites.
- Archery range, stable, lumber camp, gold mine and stone quarry have no
  gunpowder look (they fall back to castle); `total_war` has no sprites.
- Sprite renders (Cycles) are not bit-identical between runs, so re-rendering
  changes PNG bytes slightly. Style A terrain (numpy) is exact.
