# Voxel Sprite Pipeline

Kingdoms currently builds custom unit sprites directly from TypeScript voxel models. No external `.vox`, MagicaVoxel, IsoVoxel, Aseprite, or atlas packing step is required for the current in-game pipeline.

## Mental Model

1. Author a model function in `src/render/voxel/models/<unit>.ts`.
2. Return a `Voxel[]`, where each voxel is `{ x, y, z, color }`.
3. Register every needed pose in `GameScene.bakeAllTextures()`.
4. `bakeVoxelTexture()` projects the voxels into a Phaser texture at scene boot.
5. `GameScene.unitTextureKey()` chooses the texture per entity at render time.

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

Register all variants in `GameScene.bakeAllTextures()`:

```ts
for (const facing of UNIT_FACINGS) {
  for (const anim of UNIT_ANIMS) {
    for (let frame = 0; frame < UNIT_FRAME_COUNTS[anim]; frame++) {
      this.bakeIfMissing(
        unitTextureKey(playerId, facing, anim, frame),
        () => buildUnitVoxels(teamColor, { facing, anim, frame }),
        { voxelW: 4, bounds: UNIT_BAKE_BOUNDS }
      );
    }
  }
}
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
