/**
 * Global game constants. All values that other modules might want should live here
 * so they are easy to find and tune. Sim logic in /sim should import only from here
 * and from /sim itself — never from /render.
 */

export const SIM = {
  /** Fixed simulation tick rate. 20 Hz keeps state updates deterministic and cheap. */
  TICK_HZ: 20,
  /** Derived: ms per sim tick. */
  TICK_MS: 1000 / 20,
} as const;

export const MAP = {
  /** Grid width in tiles. 64×64 gives a 4096-tile playfield, ~2-3× the
   *  visible canvas — players need WASD pan + minimap. */
  WIDTH: 64,
  /** Grid height in tiles. */
  HEIGHT: 64,
} as const;

export const ISO = {
  /** Iso tile width in pixels. Tiles are 2:1 ratio. */
  TILE_W: 64,
  /** Iso tile height in pixels. */
  TILE_H: 32,
  /** Vertical pixels per elevation step. Used by terrain bake AND every iso
   *  tile-to-screen conversion that involves a tile that has elevation. */
  VPER: 4,
} as const;

export const RENDER = {
  /** Internal Phaser canvas size. Back to 1280×720 — bumping it to 1920×1080
   *  made the nearest-neighbour upscale chunkier (sprites appeared "bigger"
   *  due to the higher scale-up ratio when the browser fit the larger canvas
   *  to a smaller viewport). pixelArt + image-rendering: pixelated still give
   *  us sharp tile lines without distorting sprite proportions. */
  WIDTH: 1280,
  HEIGHT: 720,
  BACKGROUND_COLOR: 0x1b1b2f,
} as const;

/**
 * Player team colors (per GDD Section 8). Indexed by Owner.player. By convention
 * 0 = Gaia (neutral resources), 1 = Player 1 (human / Bohemia), 2..N = opponents.
 */
export const TEAM_COLORS = [
  0xb0a68a, // 0 — Gaia / neutral (sandy beige)
  0x2e86de, // 1 — Bohemia blue (default human player)
  0xee5253, // 2 — Frankia red
  0xfeca57, // 3 — Yellow
  0x1dd1a1, // 4 — Green
] as const;
