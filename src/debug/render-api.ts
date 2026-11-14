/**
 * `window.__RENDER__`: read-only render introspection (sprite counts per
 * source, active effects) plus a hook to fire a registered effect, so art and
 * VFX work can be checked from the console without pixels. Never touches the sim.
 */

export interface RenderSnapshot {
  sprites: {
    buildings: number;
    rememberedBuildings: number;
    units: number;
    resources: number;
    mapFeatures: number;
    /** Sprites currently drawn from an atlas instead of a voxel bake. */
    atlas: number;
    /** Rubble left by destroyed buildings. */
    ruins: number;
    /** Stumps left by felled trees. */
    stumps: number;
    /** Render-only ground decor pieces. */
    decor: number;
  };
  /** How the ground was drawn: 'atlas' chunk bake or 'flat' voxel fallback. */
  terrain: { mode: string; chunks: number; textures: number; bakeMs: number };
  /** Fog canvas repaints since load (repaints only when visibility changes). */
  fogRepaints: number;
  /** Display objects per world layer. */
  layers: Record<string, number>;
  atlasEntries: number;
  effects: { active: number; byId: Record<string, number>; registered: string[] };
  entityLayerChildren: number;
}

export interface WindowRenderApi {
  snapshot(): RenderSnapshot;
  /** Fire a registered effect at a tile; false if the id is unknown. */
  spawnEffect(id: string, tileX: number, tileY: number, params?: Record<string, unknown>): boolean;
  shake(intensity?: number, durationMs?: number): void;
  /** Page (client) pixel of a tile's surface, for scripted clicks in tests. */
  tileToClient(tileX: number, tileY: number): { x: number; y: number };
  /** Debug: start a skirmish on a map id (optional starting age id). */
  startSkirmish(mapId: string, age?: number): void;
  /** Debug: start a campaign mission by id. */
  startCampaign(missionId: string): void;
  /** Debug: load the late-game perf test world. */
  loadLateGame(): void;
  /** Jump to a resting zoom level (snapped to the nearest quarter step). */
  setZoom(zoom: number): void;
  /** Live camera: zoom on screen, the level it eases to, scroll. */
  camera(): { zoom: number; targetZoom: number; zooming: boolean; scrollX: number; scrollY: number };
  /** Camera-world point under a page (client) pixel. */
  worldAtClient(clientX: number, clientY: number): { x: number; y: number };
  /** Touch gesture state (recognizer state, fingers down, inertia glide). */
  touch(): { gesture: string; fingers: number; gliding: boolean };
  panToTile(tileX: number, tileY: number): void;
  fps(): number;
  /** The game scene, for console poking (debug only; never write sim state through it). */
  scene(): unknown;
}

declare global {
  interface Window {
    __RENDER__?: WindowRenderApi;
  }
}

export function installRenderApi(api: WindowRenderApi): void {
  if (typeof window === 'undefined') return;
  window.__RENDER__ = api;
}
