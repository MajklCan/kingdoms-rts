/**
 * Phaser enum values used by the VFX modules, without a runtime Phaser import
 * (the render modules stay importable from headless tests).
 */

/** `Phaser.BlendModes.NORMAL` / `ADD` / `MULTIPLY`. */
export const BLEND_NORMAL = 0;
export const BLEND_ADD = 1;
export const BLEND_MULTIPLY = 2;

/** `Phaser.TintModes.MULTIPLY` / `FILL` / `ADD`. */
export const TINT_MULTIPLY = 0;
export const TINT_FILL = 1;
export const TINT_ADD = 2;
