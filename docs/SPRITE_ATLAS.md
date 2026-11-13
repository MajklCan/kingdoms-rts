# Sprite Atlases

Pre-rendered sprites (Blender renders packed into atlases) replace voxel bakes one entry at a time. Nothing in the renderers changes: they ask the sprite registry (`src/render/sprites/sprite-registry.ts`), which tries the atlas entry first and falls back to the voxel bake.

The manifest is optional. Missing, empty or partly invalid manifest = the game runs on voxels; invalid parts are dropped with a `[Kingdoms] sprite manifest:` console warning.

## Files

```
public/assets/sprites/
  manifest.json
  buildings.png  buildings.json     # Phaser / TexturePacker atlas (JSON hash or array)
```

## manifest.json

```json
{
  "version": 1,
  "atlases": [
    { "key": "buildings", "image": "buildings.png", "json": "buildings.json" }
  ],
  "sprites": {
    "building:TOWN_CENTER:CASTLE": {
      "atlas": "buildings",
      "frame": "tc-{age}",
      "originX": 0.5,
      "originY": 0.82,
      "scale": 1,
      "teamMask": { "frame": "tc-{age}-mask" }
    },
    "resource:WOOD:snow": { "atlas": "buildings", "frame": "tree-snow" },
    "unit:ARCHER": {
      "atlas": "units",
      "frame": "archer-{anim}-{facing}-{frame}",
      "frames": { "idle": 1, "move": 4, "attack": 3 }
    }
  }
}
```

Paths are relative to `public/assets/sprites/`. Atlases load in the scene preload, under texture key `sprite-atlas:<key>`.

## Sprite ids

Tried most specific first; the first id whose frame exists in the loaded atlas wins.

| Thing | Ids | Names come from |
|---|---|---|
| Building | `building:<DEF>:<variant>`, `building:<DEF>:<AGE>`, `building:<DEF>` | `BUILDING_TABLE[].id` (`TOWN_CENTER`, `HOUSE`, `WALL`...), `AgeId` (`DARK`, `CASTLE`, `GUNPOWDER`, `TOTAL_WAR`). Wall variant `x` / `y`. |
| Unit | `unit:<UNIT>:<anim>`, `unit:<UNIT>` | `UNIT_TABLE[].id` (`VILLAGER`, `ARCHER`...). Anims: `idle`, `move`, `attack`; villager also `carry`, `harvest`, `build`. |
| Resource | `resource:<KIND>:<variant>`, `resource:<KIND>` | `ResourceKindId` (`FOOD`, `WOOD`, `GOLD`, `STONE`). Wood variants `snow`, `dead`. |
| Map feature | `feature:<KIND>:<size>`, `feature:<KIND>` | `MapFeatureKind` upper-cased (`ROCK_SPIRE`, `LINDEN_TREE`). |

## Frame placeholders

`frame` and `teamMask.frame` may contain placeholders, filled per query; unknown ones become empty.

| Placeholder | Value |
|---|---|
| `{age}` | `dark`, `castle`, `gunpowder`, `total_war` |
| `{player}` | owner player id (`0` for resources and features) |
| `{variant}` | building / resource variant |
| `{facing}` | `E`, `SE`, `S`, `SW`, `W`, `NW`, `N`, `NE` |
| `{anim}` `{frame}` | unit anim and 0-based frame |
| `{size}` | map feature footprint size |

## Entry fields

- `atlas`, `frame`: required.
- `originX`, `originY` (default `0.5`): origin so the footprint centre (buildings) or feet (units, resources) sit on the tile anchor.
- `scale` (default `1`).
- `teamMask`: optional frame (same atlas unless `atlas` is given) drawn over the sprite, tinted with the owner's `TEAM_COLORS`. Paint the team-coloured parts white in the mask.
- `frames` (units only): frame count per anim; overrides the voxel model's counts. Without it the voxel counts apply.

A frame missing from the atlas falls back to the voxel bake, so half-finished sheets are safe. Check what is drawn from atlases in the browser console with `__RENDER__.snapshot().sprites.atlas`.

Terrain tiles are not in the registry yet; they still come from `bakeTerrain()`.
