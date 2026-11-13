# Sprite Atlases in the engine

How the game draws the Blender art. The art itself, the manifest format and
how to re-render live in [BLENDER_SPRITE_PIPELINE.md](BLENDER_SPRITE_PIPELINE.md);
the Blender manifest is the source of truth and the engine adapts to it.

The art is optional. A missing, empty or partly invalid manifest (or atlas
PNG) means the game runs on voxel bakes and the flat-colour terrain; invalid
parts are dropped with a `[Kingdoms] sprite manifest:` console warning, and a
frame missing from a loaded atlas falls back per query.

## Loading

`queueSpriteManifest()` loads `public/assets/sprites/manifest.json` in the
scene preload, then every atlas under texture key `sprite-atlas:<key>`
(for example `sprite-atlas:kr-buildings-0`). Style A art (`manifest.scale` 1)
keeps the game's NEAREST filtering and is drawn at integer positions, so every
art pixel lands on whole screen pixels. Smooth 2x art (`scale` 0.5) switches
its atlases to LINEAR filtering instead.

## Camera zoom

Zoom moves in fixed steps (0.5, 0.75, 1, 1.5, 2, 2.5; a match starts at 1.5)
and the scroll is snapped, so style A pixels never shimmer while panning.
`camera/camera-controller.ts` owns the steps.

| Module (`src/render/`) | Role |
| --- | --- |
| `sprites/sprite-manifest.ts` | Parses and validates the Blender manifest |
| `sprites/art-catalog.ts` | Phaser-free lookup: exact variant, nearest earlier era, construction stage by progress, pile look by amount, hashed pick. Only returns frames that exist in a loaded atlas |
| `sprites/atlas-sprite-source.ts` | Answers building / rubble / resource / stump / map feature queries from the catalog |
| `sprites/unit-atlas-source.ts` | Units from `units-manifest.json` (see [UNIT_SPRITES.md](UNIT_SPRITES.md)) |
| `sprites/voxel-sprite-source.ts` | Voxel bakes; machine gun and mortar always, everything else as fallback |
| `sprites/sprite-registry.ts` | Atlas first, voxel per query; exposes the catalog as `registry.art` for terrain and decor |
| `terrain/` | Terrain chunk bake, transitions, cliffs, water loop, decor scatter |

## What maps to what

| Game thing | Asset / variant |
| --- | --- |
| Building of `BuildingDefId` X | `building.<x>` (by `defId`), variant = era of the owner's age (`AgeId` name lower-cased, `total_war` falls back to `gunpowder`, missing eras to the nearest earlier one) |
| Building under construction | `construction.<w>x<h>`, stage by `ConstructionSite.progress / totalTicks` (0 / 0.34 / 0.67), no team mask |
| Destroyed building | `rubble.<w>x<h>`, left for 75 s (fades over the last 6 s), only where the player saw it go down |
| Farm | `building.farm` stage: render-only cycle (sim farms never deplete) `sown` > `growing` > `ripe` over 90 s per farm; `depleted` while no worker is assigned |
| Wall | `building.wall` variant `<era>.<mask>`, mask bits 1 = +x, 2 = +y, 4 = -x, 8 = -y; neighbours are live walls and towers, or remembered ones in fog |
| Tree (`ResourceKindId.WOOD`) | `resource.tree` species by tile hash; conifers favoured on forest tiles, `resource.tree_snow` on snow, `resource.tree_dead` in Zborov |
| Felled tree | `resource.stump` (`conifer` / `broadleaf`) for 4 min where a tree vanished |
| Gold, stone, berries | `resource.gold` / `resource.stone` / `resource.berry_bush`, look by remaining fraction (`full` / `half` / `low`) |
| Linden landmark | `resource.tree` `linden` at 1.35x |
| Rock spire | `feature.rock_spire`, own art per footprint size (2x2, 4x4) |
| Flags, windmill | `variant.overlays` `flag` / `sails` frames, looped per building with a seeded phase (`effects/part-animator.ts`) |
| Tree and grass sway | `variant.poses` `swayl` / `swayr`, picked by rolling gust bands (`gustPose` in `terrain/decor-layer.ts`), frozen under reduced motion |
| Units | `units-manifest.json` frames `<unit>/<anim>/<facing>/<frame>` ([UNIT_SPRITES.md](UNIT_SPRITES.md)); machine gun and mortar stay voxel |
| Terrain `TileType` | `terrain.<name>` via `TILE_TERRAIN` in `terrain/terrain-art.ts`; GRASS also draws `meadow` in noise patches, BRIDGE as `bridge_x` / `bridge_y`, BARBED_WIRE as `mud` with wire drawn on top |

## Placement

Every atlas frame is anchored at the bottom corner of its footprint diamond
(`anchor` / atlas `pivot`). Renderers place the sim's footprint centre with
`buildingScreenPosition()` and offset it by `footprintBottomOffset(w, h)`
(`world-projection.ts`). Voxel refs keep `anchor: 'center'`.

Depth is the screen y of the footprint centre (farms and rubble use the back
corner so units walk over them). Status bars sit at `ref.top` above the anchor.
Clicks still go through the sim's tile pick, but a click on a building's drawn
pixels (a roof or tower top over another tile) selects that building.

## Layers

`world-layers.ts`, back to front:

| Layer | Content |
| --- | --- |
| `terrain` | 8x8 tile chunk images (64 per map), water chunks swap 4 textures every 240 ms |
| `decor` | render-only grass, flowers, rocks, ferns, reeds |
| `shadows` | every `__shadow` frame and the unit contact blobs |
| `ground` | back half of selection rings, placement footprint |
| `fog` | explored dimming and unexplored black, soft-edged, quarter resolution |
| `entities` | buildings, team masks, resources, units; depth-sorted |
| `overlay` | front half of rings, HP bars, placement preview sprite |
| `effects` | projectiles, bursts |

Entities in explored-but-not-visible tiles (remembered buildings, resources,
stumps) are tinted `FOG_DIM_TINT` instead of being covered, so tall art is
never cut by a fogged tile.

## Team colour

The `__mask` frame is drawn as a second image right above the frame, tinted
with the owner's `TEAM_COLORS` entry. The packer writes the mask RGB as the
colour frame's luma * 1.25, so tint (multiply) plus normal blending gives
`mix(rgb, team * luma * 1.25, maskAlpha)`, the formula of the contact sheet.

## Terrain bake

`terrain/terrain-baker.ts` composes each tile on a 2D canvas: cliff faces
down to the lower neighbour (`cliff_<kind>`, lip on the top step), the tile
frame (`(x mod p) + p * (y mod p)`), then each higher-priority neighbour
terrain masked by the transition masks, shore foam on water next to land,
edge AO and lit rims at elevation steps, and bridge rails last. Style A tiles
are clipped to their exact pixel staircase (smooth art: the diamond with a
small bleed). The result is one image per chunk (four for chunks with water),
baked once per map in about 1.5 s.

Chunk origins sit on a 4 px grid, and every chunk bakes the ring of neighbour
tiles from later chunks under its own tiles. At 1.5x or 2.5x a screen pixel can
sample exactly on a chunk seam, and each chunk may round to the other one's
transparent texel; the underlay keeps those pixels opaque (later chunks paint
over it, so it never shows otherwise).

## Ambient life

`effects/life-fx.ts` adds render-only life on top of the world FX: perched
birds that flush from units and chopping, flyers and flocks, falling leaves,
snow slipping off spruces (`forest-life.ts`); deer herds, rabbits, ducks, fish
rings, frogs and dragonflies (`wildlife.ts`); chickens, a dog, braziers and
voxel chimney smoke around buildings (`village-life.ts`). Sprites are small
pixel grids baked into one canvas texture (`life-sprites.ts`). Everything is
seeded from the map (`LifeRng`, never `world.rng`), pooled with hard caps,
culled to the view and fog, never interactive, and stopped under
`prefers-reduced-motion`. `__RENDER__.scene().worldFx.stats.life` counts the
live pieces.

Render-only randomness (meadow patches, decor, tree species, farm phase)
hashes tile coordinates with a seed taken from the map bytes, never
`Math.random`, so every peer draws the same and the sim never sees it.

## Debugging

`window.__RENDER__.snapshot()` reports sprite counts (incl. `atlas`, `ruins`,
`stumps`, `decor`), terrain mode / chunks / bake time, fog repaints and layer
sizes. `__RENDER__.startSkirmish(mapId, age)`, `loadLateGame()`, `setZoom()`
and `panToTile()` drive the view for checks.
