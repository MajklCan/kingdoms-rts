# Unit sprites (style A)

Pre-rendered unit sheets in the style A "hi-res voxel diorama" look: every
unit, 8 facings, every animation, a team-colour mask and a ground shadow per
frame, packed into one atlas page. Buildings, nature, terrain and decor come
from the Blender pipeline ([BLENDER_SPRITE_PIPELINE.md](BLENDER_SPRITE_PIPELINE.md));
units have their own, lighter pipeline described here. Machine gun and mortar
have no art yet and stay on the in-engine voxel bakes.

## Outputs

| Path | What |
| --- | --- |
| `public/assets/sprites/units-<n>.png` + `.json` | Atlas pages (2048 wide, Phaser JSON hash, trimmed frames, NEAREST filtered); every unit sits on one page, so a frame, its mask and its shadow share a texture |
| `public/assets/sprites/units-manifest.json` | Per unit: def ids, frame size, feet anchor, head height, ring size, anims, muzzle points |
| `public/assets/ui/portraits/units/<unit>.png` + `index.json` | 96x96 busts for the HUD; `index.json` maps `UnitDefId` names to files |
| `art-source/blender/units/.cache/<unit>.npz` | Per-unit render cache keyed by a hash of the unit's sources (gitignored) |

Two pages (2048x2048 + 2048x1024), about 3.8 MB, 5871 frames (5137 unique
after dedupe). The villager role looks added about 1.1 MB to the former single
2.7 MB page.

## Re-running

No Blender scene: the models are built voxel by voxel in Python and ray cast
with numpy, so plain Python is enough (Blender's bundled Python works too).

```sh
# everything, about 10 s on 18 cores (cached units are reused)
python3 scripts/blender/render_units.py

# one unit (others come from the cache), or ignore the cache
python3 scripts/blender/render_units.py --only cavalry
python3 scripts/blender/render_units.py --force

# headless Blender, same flags after "--"
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
    -P scripts/blender/render_units.py -- --only villager
```

`--no-portraits` skips the busts, `--jobs N` sets the worker count.

## Code layout (`scripts/blender/`)

| File | Role |
| --- | --- |
| `units_rig.py` | Voxel lattice, shape primitives (`Mk`: boxes, capsules, cylinders, clipped ellipsoids), palette, exact ray caster with top-left sun, AO, soft shadows and the style A grade; returns base, mask, shadow and named points per frame |
| `units_body.py` | Shared puppet: body proportions, joints, walk / idle / death poses |
| `units_common.py` | Shared props (hats, tools, carried loads) |
| `units_<unit>.py` | One unit: `NAME`, `DEF_IDS`, `ANIMS`, `draw(mk, anim, frame, facing)`, `PORTRAIT` |
| `render_units.py` | Renders every (unit, anim, facing) strip in a process pool, packs the atlas, writes the manifest and portraits |

The lattice is 1/32 tile horizontally and one screen pixel per layer
vertically, so one voxel is one pixel at zoom 1. Infantry stand about 37 px
to the top of the head, the rider of a scout cavalry about 52 px, a cannon
crew about 50 px.

## Roster

| Unit | `UnitDefId` | Anims (frames) |
| --- | --- | --- |
| villager (builder) | `VILLAGER` | idle 4, move 8, carry_wood / carry_food / carry_gold / carry_stone 8, chop 6, mine 6, build 6, farm 6, forage 4, death 4 |
| villager-lumberjack | `VILLAGER` look `lumberjack` | idle, move, carry_wood, chop, death |
| villager-farmer | `VILLAGER` look `farmer` | idle, move, carry_food, farm, death |
| villager-quarryman | `VILLAGER` look `quarryman` | idle, move, carry_stone, mine, death |
| villager-gold-miner | `VILLAGER` look `gold-miner` | idle, move, carry_gold, mine, death |
| militia | `MILITIA` (legacy) | idle 4, move 8, attack 6 (sword), death 4 |
| spearman | `SPEARMAN` | idle 4, move 8, attack 6 (pike thrust), death 4 |
| archer | `ARCHER` | idle 4, move 8, attack 6 (draw and loose), death 4 |
| cavalry | `SCOUT_CAVALRY` | idle 4, move 6 (gallop), attack 6 (couched lance), death 4 |
| gunman | `GUNMAN` | idle 4, move 8, attack 6 (fire and recoil), death 4 |
| cannon | `CANNON` | idle 2, move 6 (wheels spin), attack 8 (fire and push back), death 3 |

Every anim has all 8 facings. Aliases in the manifest (`attack` -> `chop` for
villagers, `carry` -> `carry_food`, ...) cover names older code asks for.

## Villager roles

Villagers wear the look of their job (`villagerRole` in
`src/sim/core/villager-role.ts`). One shared body, one `Kit` per role in
`scripts/blender/units_villager.py`: headwear, garment keys, gear (apron,
belt tools, back items) and the tool on the shoulder in idle and move. The
team tunic and skirt stay in the same place on every role.

| Role | Look | Reads as |
| --- | --- | --- |
| builder | default `villager` art | wide rust beret, beard, rolled sleeves, leather apron, mallet on the shoulder, saw on the back |
| lumberjack | `lumberjack` | moss wool cap on a fur brim, fur collar, bulkier, felling axe |
| farmer | `farmer` | wide straw hat, light linen trousers, hoe on the shoulder, sickle at the hip |
| quarryman | `quarryman` | grey visor cap, dusty sleeves and apron, beard, pick |
| gold-miner | `gold-miner` | white miner's hood and cape, lit lamp at the belt, leather seat patch, pick |
| miller | `farmer` | no art of its own (no mill crews today) |

The builder is the free villager and the villager's default art, so it has
every anim. A crew is its own atlas unit named `villager-<role>` with
`"look": "<role>"` in the manifest and only the anims its job plays (same
`SPECS`, so frame counts and timing match the builder). A look never claims
its `defIds`.

At runtime `UnitRenderer` asks `villagerLook(world, eid)`
(`src/render/sprites/villager-look.ts`, role -> look name) and passes it as
`look` in the unit query. `UnitAtlasSource` draws the look only when it has
that exact anim (or its own alias); otherwise, or when the look is missing
from the manifest or atlas, it draws the default villager art, so a crew
never blanks or plays another job's work. Death frames use the look the unit
was last drawn with.

To add a role: add a `Kit` and a `_role_unit(...)` entry in `ROLE_UNITS`,
list `"villager-<role>": "units_villager:<role>"` in `UNITS` of
`render_units.py`, map the sim role to the look in `villager-look.ts` and the
inspection id in `src/render/inspection/villager-role-sheets.ts`, then
`python3 scripts/blender/render_units.py --only villager-<role>`.

Review: `?inspect=villager-<role>` (every facing at 2x) and
`?inspect=villager-roles` (all roles, both teams, 1x and 2x).

## Frame names

```
<unit>/<anim>/<facing>/<frame>      colour (<unit> = manifest key, e.g. villager-lumberjack)
<unit>/<anim>/<facing>/<frame>/m    team mask
<unit>/<anim>/<facing>/<frame>/s    shadow (frame 0 of the anim unless shadow = "frame")
```

`<facing>` is an index into `["E","SE","S","SW","W","NW","N","NE"]`: facing
n points 45n degrees around in tile space (`atan2(dy, dx)`), so 1 (`SE`, +x+y)
walks straight down the screen toward the camera.

All frames of a unit share one `sourceSize` and one feet anchor, so the
origin is a per-unit constant and frames never slide. Mask and shadow frames
line up with the colour frame through the atlas trim offsets.

## units-manifest.json

```jsonc
{
  "version": 1,
  "atlases": [{ "key": "kr-units-0", "image": "units-0.png", "json": "units-0.json" }],
  "units": {
    "gunman": {
      "defIds": ["GUNMAN"],
      "size": [120, 78],          // frame source size, px
      "anchor": [49, 50],         // feet, px inside the source frame
      "height": 37,               // feet to top of head (bars, hit flashes)
      "ring": [24, 10],           // selection ring full width / height at 1x
      "anims": {
        "idle":   { "frames": 4, "ms": 260, "shadow": "static" },
        "move":   { "frames": 8, "stride": 0.68, "shadow": "static" },  // tiles per cycle
        "attack": { "frames": 6, "ms": 100, "hit": 3, "shadow": "static" },
        "death":  { "frames": 4, "ms": 110, "once": true, "shadow": "frame" }
      },
      "projectile": [[17.5, -9.6], [-7.0, -7.4], ...]  // 8 facings: muzzle offset from the feet on the hit frame
    }
  }
}
```

Role looks add `"look": "<role>"` to a unit entry with the same `defIds`
(see Villager roles). The file and its atlases are optional. `parseUnitManifest()` drops invalid
units with a console problem, and a unit counts as covered only when its
`idle/1/0` frame is really in a loaded atlas.

## Engine wiring (`src/render/`)

| Module | Role |
| --- | --- |
| `sprites/unit-manifest.ts` | Loads (`queueUnitManifest`, called from `queueSpriteManifest`) and parses the manifest |
| `sprites/unit-atlas-source.ts` | `UnitAtlasSource`: unit queries -> `SpriteRef` with the per-unit origin, tinted team mask and shadow; anim fallbacks (`mine` -> `harvest` -> `chop`, unknown -> `idle`) |
| `sprites/sprite-registry.ts` | Asks the unit atlas first, then voxels; `unitArt(defId)` exposes timing, height, ring and muzzle points; sets NEAREST on unit atlases |
| `sprites/voxel-bake.ts` | Skips voxel unit bakes for kinds the atlas covers |
| `entities/unit-animator.ts` | Picks anim and frame from the sim (below) |
| `entities/unit-renderer.ts` | Places sprites at the feet, sizes rings and bars per unit, hands death frames to the corpse effect |
| `effects/remains-fx.ts` | Plays the death frames, then darkens and fades the corpse |
| `effects/combat-feedback.ts`, `combat-fx.ts` | Projectiles and muzzle smoke start at the manifest's muzzle point |

Timing, all render side (the sim is never read back into):

- Walks are distance driven: frame = travelled tiles / `stride`, so feet do
  not skate at any speed; idles and work loops run on time with a per-unit
  phase so crowds do not move in lockstep.
- Attacks land on the sim: the combat event of tick T is shown at
  `(T + 1) * TICK_MS`; the swing starts early from the attacker's
  `Cooldown` while engaged so the `hit` frame meets that moment, and the
  follow-through plays after it. Cannons aim through the sim's windup and the
  fire frame lands on the shot.
- Villagers: `chop` (trees), `mine` (gold, stone), `farm` (farm buildings),
  `forage` (berries), `build` (construction), `carry_<resource>` while walking
  loaded.
- Death plays the `death` frames in the last facing, then the corpse lingers
  darkened and fades.

## Known weak spots

- Militia and spearman share the kettle hat and shield; only the weapon tells
  them apart.
- Villager roles read mostly by headwear colour at 1x; the shouldered tools are
  thin and the builder's saw only shows from behind. The HUD icon sheet
  (`scripts/ui/gen_icons.py`) still draws the old villager until regenerated.
- Static shadows per anim (only deaths have per-frame shadows), so a walking
  unit's shadow does not swing its legs.
- Sprites are 1x pixel art with NEAREST filtering; at zoom 1.3 and 2.5 pixels
  double unevenly next to the 2x world atlases.
