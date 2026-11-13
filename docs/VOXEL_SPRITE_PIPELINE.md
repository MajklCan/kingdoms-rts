# Voxel Sprite Pipeline

Kingdoms currently builds custom unit sprites directly from TypeScript voxel models. No external `.vox`, MagicaVoxel, IsoVoxel, Aseprite, or atlas packing step is required for the current in-game pipeline.

## Mental Model

1. Author a model function in `src/render/voxel/models/<unit>.ts`.
2. Return a `Voxel[]`, where each voxel is `{ x, y, z, color }`.
3. Register the model in `VOXEL_UNIT_MODELS` and `VOXEL_UNIT_BAKE_ORDER` (`src/render/sprites/voxel-models.ts`).
4. `bakeVoxelTextures()` (`src/render/sprites/voxel-bake.ts`) bakes every pose into a Phaser texture at scene boot.
5. `VoxelSpriteSource` resolves the texture per entity at render time, behind the sprite registry (`src/render/sprites/sprite-registry.ts`). Pre-rendered atlas sprites override it per entry, see `docs/SPRITE_ATLAS.md`.

Canonical animated unit examples:

- `src/render/voxel/models/dark-scout-cavalry.ts`: mounted movement and melee attack.
- `src/render/voxel/models/dark-villager.ts`: walking, carrying, harvesting, and building work poses.

## Model Contract

Use this shape for new directional units:

```ts
export const UNIT_FACINGS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'] as const;
export const UNIT_ANIMS = ['idle', 'move', 'attack'] as const;

export type UnitFacing = (typeof UNIT_FACINGS)[number];
export type UnitAnim = (typeof UNIT_ANIMS)[number];

export const UNIT_FRAME_COUNTS: Record<UnitAnim, number> = {
  idle: 1,
  move: 2,
  attack: 2,
};

export function buildUnitVoxels(
  teamColor: number,
  pose: { facing?: UnitFacing; anim?: UnitAnim; frame?: number } = {}
): Voxel[] {
  // Build and return voxels for this pose.
}
```

Prefer a small local rig rather than duplicating 8 hand-written models. Scout cavalry uses local `forward/side/z` coordinates, then rotates those coordinates into the 8 facings. This makes head, tail, arms, weapons, and leg animation move together.

## Baking

Add one entry to `VOXEL_UNIT_MODELS` in `src/render/sprites/voxel-models.ts` and its id to `VOXEL_UNIT_BAKE_ORDER`. `bakeVoxelTextures()` then bakes every player x facing x anim x frame:

```ts
[UnitDefId.MY_UNIT]: {
  keyPrefix: 'voxel-my-unit-p',          // key: voxel-my-unit-p1-SE-move-0
  anims: UNIT_ANIMS,
  frameCounts: UNIT_FRAME_COUNTS,
  bounds: UNIT_BAKE_BOUNDS,
  originY: 0.7,                           // feet on the tile anchor
  build: (color, pose) => buildUnitVoxels(color, pose),
},
```

Use fixed `bounds` when animation frames change footprint, especially attacks with extended weapons. Without fixed bounds, the texture size changes between frames and sprites can appear to slide.

## Runtime Selection

For animated directional units, the renderer should choose:

- Facing from velocity while moving.
- Facing from `AttackTarget` while idle but attacking.
- Last known facing when idle with no target.
- `move` animation while velocity is non-zero.
- `attack` animation briefly after a matching `CombatEvent`.
- `idle` otherwise.

Keep this logic in render code. Do not add render-only animation state to the sim.

## Anchoring

Selection rings are drawn at the entity tile position. The sprite origin must make the unit feet line up with that position.

- Tight static sprites usually work with `originY = 0.85`.
- Fixed-bounds animated sheets may need a custom origin.
- Scout cavalry currently uses `originY = 0.73` because fixed bake bounds add transparent padding.

When adding a new animated unit, verify the selection ring sits under the feet in the normal game view, not in the inspection sheet only.

## Visual Inspection

Every new directional unit should get a zoomed inspection route similar to scout cavalry:

```txt
http://localhost:5173/?inspect=scout-cavalry
http://localhost:5173/?inspect=archer
http://localhost:5173/?inspect=spearman
```

The inspection sheet should show all 8 facings and every important animation frame at an enlarged scale. Use it for quick visual QA before checking the unit in live gameplay.

Minimum QA:

- All facings render non-empty.
- Movement frames differ visibly.
- Attack frames show the weapon/action clearly.
- No frame slides because of changing texture bounds.
- Normal game selection ring sits under the unit.
- Browser console has no warnings/errors.

## Backlog

Scout cavalry, villager, archer, and spearman now use the full directional/action sprite pipeline. Later, convert any newly added unit types to the same pattern:

- Future units: define facings, action states, frame counts, bake bounds, and inspection sheet before wiring into live gameplay.
