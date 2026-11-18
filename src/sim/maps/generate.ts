/**
 * Map catalog and the generateMap() dispatcher.
 */

import type { Rng } from '../rng';
import { generateAdrspachRockTownMap } from './adrspach';
import { generateKrkonoseWinterCrownMap } from './krkonose';
import { generateMilesovkaUplandsMap } from './milesovka';
import { generateMoravskyKrasMap } from './moravsky-kras';
import {
  generateBlanikNightWatchMap,
  generateBohemianBorderForestMap,
  generateFloodedBasinMap,
  generateMachovoJezeroMap,
  generateOreMountainPassMap,
  generateSilesianMarshMap,
} from './regional';
import { generateRiverlandsMap } from './riverlands';
import { generateSudomerPondsMap } from './sudomer';
import { type MapData, type MapDef, MapId, type MapIdValue } from './types';
import { generateZborovMap } from './zborov';

export const MAP_DEFS: MapDef[] = [
  {
    id: MapId.RIVERLANDS,
    name: 'Bohemian Riverlands',
    description: 'Balanced river valley with bridges, forests, and central resources.',
  },
  {
    id: MapId.BOHEMIAN_BORDER_FOREST,
    name: 'Bohemian Border Forest',
    description: 'Dense woodland clearings linked by logging paths and exposed outer mines.',
  },
  {
    id: MapId.ORE_MOUNTAIN_PASS,
    name: 'Ore Mountain Pass',
    description: 'High ridges, stone plateaus, and a dirt trade road through the hills.',
  },
  {
    id: MapId.MACHOVO_JEZERO,
    name: 'Machovo Jezero',
    description: 'Large central lake with sandy banks and woodlands around the shore.',
  },
  {
    id: MapId.SILESIAN_MARSH,
    name: 'Silesian Marsh',
    description: 'Braided wetlands, shallow channels, causeways, and scattered dry islands.',
  },
  {
    id: MapId.SUDOMER_PONDS,
    name: 'Sudoměř Ponds',
    description: 'Upper-left Sudoměř, a blocked lower pond, a dry choke, and a muddy right-pond flank.',
    campaignOnly: true,
  },
  {
    id: MapId.KRKONOSE_WINTER_CROWN,
    name: 'Krkonoše Winter Crown',
    description: 'A mirrored highland snow map with frozen crown ice, packed passes, and balanced pine lines.',
  },
  {
    id: MapId.ZBOROV_LINES,
    name: 'Zborov Lines',
    description: 'A WWI battlefield: a southern jump-off trench, churned no-man’s-land of shell craters, and fortified enemy lines to the north.',
  },
  {
    id: MapId.FLOODED_BASIN,
    name: 'Flooded Basin',
    description: 'A round, shell-cratered battlefield ringed by impassable floodwater. Symmetric north/south bases for a tight 1v1.',
  },
  {
    id: MapId.BLANIK_NIGHT_WATCH,
    name: 'Blaník Night Watch',
    description: 'A night battle around the wooded hill of the sleeping knights. Torches light only a short way, so scouts and towers are your eyes.',
    night: true,
  },
  {
    id: MapId.MILESOVKA_UPLANDS,
    name: 'Milešovka Uplands',
    description: 'A large map of volcanic cones. Milešovka blocks the middle; brooks, fords, and two saddles decide the way across.',
    large: true,
  },
  {
    id: MapId.ADRSPACH_ROCK_TOWN,
    name: 'Adršpach Rock Town',
    description: 'A large map split by a maze of sandstone towers. Narrow lanes, a central glade, and quarry lakes with gold.',
    large: true,
  },
  {
    id: MapId.MORAVSKY_KRAS,
    name: 'Moravský Kras',
    description: 'A large karst plateau around the Macocha abyss. Walled gorges on the flanks are fast hidden roads with gold in their caves.',
    large: true,
  },
];

/** Whether a map is played at night when the setup does not say. */
export function isNightMap(mapId: MapIdValue | undefined): boolean {
  return MAP_DEFS.find((def) => def.id === mapId)?.night === true;
}

/** The maps a skirmish can be played on (campaign-only maps left out). */
export const SKIRMISH_MAP_DEFS: MapDef[] = MAP_DEFS.filter((def) => !def.campaignOnly);

/** A stored or typed map id to a skirmish map; anything else is the Riverlands. */
export function normalizeSkirmishMapId(value: string | undefined): MapIdValue {
  return SKIRMISH_MAP_DEFS.some((def) => def.id === value) ? (value as MapIdValue) : MapId.RIVERLANDS;
}

export function normalizeMapId(value: string | undefined): MapIdValue {
  return MAP_DEFS.some((def) => def.id === value)
    ? (value as MapIdValue)
    : MapId.RIVERLANDS;
}

export function generateMap(rng: Rng, mapId: MapIdValue = MapId.RIVERLANDS): MapData {
  switch (mapId) {
    case MapId.BOHEMIAN_BORDER_FOREST:
      return generateBohemianBorderForestMap();
    case MapId.ORE_MOUNTAIN_PASS:
      return generateOreMountainPassMap();
    case MapId.MACHOVO_JEZERO:
      return generateMachovoJezeroMap();
    case MapId.SILESIAN_MARSH:
      return generateSilesianMarshMap(rng);
    case MapId.SUDOMER_PONDS:
      return generateSudomerPondsMap();
    case MapId.KRKONOSE_WINTER_CROWN:
      return generateKrkonoseWinterCrownMap();
    case MapId.ZBOROV_LINES:
      return generateZborovMap();
    case MapId.FLOODED_BASIN:
      return generateFloodedBasinMap();
    case MapId.BLANIK_NIGHT_WATCH:
      return generateBlanikNightWatchMap();
    case MapId.MILESOVKA_UPLANDS:
      return generateMilesovkaUplandsMap();
    case MapId.ADRSPACH_ROCK_TOWN:
      return generateAdrspachRockTownMap();
    case MapId.MORAVSKY_KRAS:
      return generateMoravskyKrasMap();
    default:
      return generateRiverlandsMap(rng);
  }
}
