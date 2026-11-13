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
  };
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
