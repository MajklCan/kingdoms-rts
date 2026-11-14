/**
 * Fog-of-war look shared by the ground fog (fog-renderer.ts) and the entity
 * renderers. Ground in explored-but-not-visible tiles gets a black wash of
 * `FOG_EXPLORED_ALPHA`; sprites standing there (resources, remembered
 * buildings, features, ruins) are tinted with the matching `FOG_DIM_TINT`
 * instead of being covered, so tall art never gets cut by a tile edge.
 */

export const FOG_EXPLORED_ALPHA = 0.45;

/** Multiply tint equal to the explored wash, nudged cool so memory reads as memory. */
export const FOG_DIM_TINT = 0x828894;
