/**
 * Procedural map generation. Public barrel for the maps/ modules:
 *   maps/types.ts     TileType, MapId, MapData and feature types
 *   maps/generate.ts  MAP_DEFS catalog and the generateMap() dispatcher
 *   maps/terrain.ts   shared painting, carving and walkability helpers
 *   maps/<map>.ts     one generator per skirmish/campaign map
 * Keep this file a barrel: add new code to the module that owns it.
 */

export { MapFeatureKind, MapId, TileType } from './maps/types';
export type {
  MapData,
  MapDef,
  MapFeature,
  MapFeatureKindValue,
  MapIdValue,
  TileTypeValue,
} from './maps/types';
export { getElevation, getTile } from './maps/terrain';
export { MAP_DEFS, generateMap, normalizeMapId } from './maps/generate';
export { isZborovMudPatch } from './maps/zborov';
