import { describe, expect, it } from 'vitest';
import { MAP } from '../config';
import { Position, Resource, ResourceKindId } from './components';
import { MAP_DEFS, MapFeatureKind, MapId, generateMap, TileType } from './map-gen';
import { Rng } from './rng';
import { createSimWorld, resourceQuery } from './world';

function isWater(tile: number): boolean {
  return tile === TileType.WATER || tile === TileType.WATER_SHALLOW;
}

function countTiles(map: ReturnType<typeof generateMap>, tile: number): number {
  return map.tiles.reduce((count, value) => count + (value === tile ? 1 : 0), 0);
}

function countRadiusTiles(
  map: ReturnType<typeof generateMap>,
  cx: number,
  cy: number,
  radius: number,
  matches: (tile: number) => boolean
): number {
  let count = 0;
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 0 || y < 0 || x >= MAP.WIDTH || y >= MAP.HEIGHT) continue;
      if (Math.hypot(x - cx, y - cy) > radius) continue;
      if (matches(map.tiles[y * MAP.WIDTH + x])) count++;
    }
  }
  return count;
}

describe('map bridges', () => {
  it('raises bridge decks above their nearby banks', () => {
    const map = generateMap(new Rng(42));
    expect(map.bridgePositions.length).toBeGreaterThan(0);

    for (const bridge of map.bridgePositions) {
      const bridgeXs: number[] = [];
      for (let x = 0; x < MAP.WIDTH; x++) {
        if (map.tiles[bridge.y * MAP.WIDTH + x] === TileType.BRIDGE) {
          bridgeXs.push(x);
        }
      }

      expect(bridgeXs.length).toBeGreaterThan(0);
      const bridgeElevation = Math.min(
        ...bridgeXs.map((x) => map.elevation[bridge.y * MAP.WIDTH + x])
      );
      let maxNearbyLandElevation = -Infinity;

      for (const x of bridgeXs) {
        for (let ny = bridge.y - 1; ny <= bridge.y + 1; ny++) {
          for (let nx = x - 1; nx <= x + 1; nx++) {
            if (nx < 0 || ny < 0 || nx >= MAP.WIDTH || ny >= MAP.HEIGHT) continue;
            const tile = map.tiles[ny * MAP.WIDTH + nx];
            if (tile === TileType.BRIDGE || isWater(tile)) continue;
            maxNearbyLandElevation = Math.max(
              maxNearbyLandElevation,
              map.elevation[ny * MAP.WIDTH + nx]
            );
          }
        }
      }

      expect(maxNearbyLandElevation).toBeGreaterThanOrEqual(0);
      expect(bridgeElevation).toBeGreaterThanOrEqual(
        Math.min(7, maxNearbyLandElevation + 1)
      );
    }
  });

  it('does not place starting resources on bridge tiles', () => {
    for (const [i, def] of MAP_DEFS.entries()) {
      const world = createSimWorld(1000 + i, { mapId: def.id });
      for (const eid of resourceQuery(world.ecs)) {
        const x = Math.round(Position.x[eid]);
        const y = Math.round(Position.y[eid]);
        expect(world.map.tiles[y * MAP.WIDTH + x]).not.toBe(TileType.BRIDGE);
        expect(isWater(world.map.tiles[y * MAP.WIDTH + x])).toBe(false);
        expect(world.map.features.some((feature) => feature.x === x && feature.y === y)).toBe(false);
      }
    }
  });

  it('generates every selectable map with clear player spawns', () => {
    for (const [i, def] of MAP_DEFS.entries()) {
      const map = generateMap(new Rng(200 + i), def.id);
      expect(map.spawns[1]).toBeDefined();
      expect(map.spawns[2]).toBeDefined();
      for (const spawn of [map.spawns[1], map.spawns[2]]) {
        expect(map.walkability[spawn.y][spawn.x]).toBe(0);
        const tile = map.tiles[spawn.y * MAP.WIDTH + spawn.x];
        expect(tile === TileType.GRASS || tile === TileType.DIRT).toBe(true);
      }
    }
  });

  it('keeps themed maps visually coherent around their main terrain idea', () => {
    const forest = generateMap(new Rng(300), MapId.BOHEMIAN_BORDER_FOREST);
    expect(countTiles(forest, TileType.FOREST)).toBeGreaterThan(MAP.WIDTH * MAP.HEIGHT * 0.45);
    expect(countTiles(forest, TileType.DIRT)).toBeGreaterThan(MAP.WIDTH * 4);
    expect(countTiles(forest, TileType.WATER) + countTiles(forest, TileType.WATER_SHALLOW)).toBe(0);
    expect(countRadiusTiles(
      forest,
      Math.round(MAP.WIDTH * 0.50),
      Math.round(MAP.HEIGHT * 0.50),
      5,
      (tile) => tile === TileType.GRASS || tile === TileType.DIRT
    )).toBeGreaterThan(50);

    const ore = generateMap(new Rng(301), MapId.ORE_MOUNTAIN_PASS);
    expect(countTiles(ore, TileType.STONE)).toBeGreaterThan(MAP.WIDTH * MAP.HEIGHT * 0.28);
    expect(countTiles(ore, TileType.WATER) + countTiles(ore, TileType.WATER_SHALLOW)).toBe(0);
    expect(countTiles(ore, TileType.DIRT)).toBeGreaterThan(MAP.WIDTH * 4);

    const lake = generateMap(new Rng(302), MapId.MACHOVO_JEZERO);
    const center = Math.floor(MAP.HEIGHT / 2) * MAP.WIDTH + Math.floor(MAP.WIDTH / 2);
    expect(lake.tiles[center]).toBe(TileType.WATER);
    expect(countTiles(lake, TileType.WATER) + countTiles(lake, TileType.WATER_SHALLOW))
      .toBeGreaterThan(MAP.WIDTH * MAP.HEIGHT * 0.16);
    expect(countTiles(lake, TileType.FOREST)).toBeGreaterThan(MAP.WIDTH * MAP.HEIGHT * 0.14);

    const marsh = generateMap(new Rng(303), MapId.SILESIAN_MARSH);
    const marshWater = countTiles(marsh, TileType.WATER) + countTiles(marsh, TileType.WATER_SHALLOW);
    expect(marshWater).toBeGreaterThan(MAP.WIDTH * MAP.HEIGHT * 0.16);
    expect(marsh.bridgePositions.length).toBeGreaterThan(MAP.HEIGHT);
    expect(Math.max(...Array.from(marsh.elevation))).toBeLessThanOrEqual(3);
  });

  it('adds map-specific feature terrain without bleeding into other maps', () => {
    const ore = generateMap(new Rng(401), MapId.ORE_MOUNTAIN_PASS);
    const rocks = ore.features.filter((feature) => feature.kind === MapFeatureKind.ROCK_SPIRE);
    expect(rocks.length).toBeGreaterThanOrEqual(5);
    expect(rocks.some((rock) => rock.size === 2)).toBe(true);
    expect(rocks.some((rock) => rock.size === 4)).toBe(true);
    for (const rock of rocks) {
      const size = rock.size ?? 2;
      for (let dy = 0; dy < size; dy++) {
        for (let dx = 0; dx < size; dx++) {
          const x = rock.x + dx;
          const y = rock.y + dy;
          expect(ore.tiles[y * MAP.WIDTH + x]).toBe(TileType.STONE);
          expect(ore.walkability[y][x]).toBe(1);
        }
      }
    }

    const lake = generateMap(new Rng(402), MapId.MACHOVO_JEZERO);
    const lindens = lake.features.filter((feature) => feature.kind === MapFeatureKind.LINDEN_TREE);
    expect(lindens.length).toBeGreaterThanOrEqual(10);
    for (const linden of lindens) {
      const tile = lake.tiles[linden.y * MAP.WIDTH + linden.x];
      expect(tile === TileType.FOREST || tile === TileType.GRASS).toBe(true);
      expect(lake.walkability[linden.y][linden.x]).toBe(0);
    }

    for (const [i, def] of MAP_DEFS.entries()) {
      const map = generateMap(new Rng(500 + i), def.id);
      if (def.id !== MapId.ORE_MOUNTAIN_PASS) {
        expect(map.features.some((feature) => feature.kind === MapFeatureKind.ROCK_SPIRE)).toBe(false);
      }
      if (def.id !== MapId.MACHOVO_JEZERO) {
        expect(map.features.some((feature) => feature.kind === MapFeatureKind.LINDEN_TREE)).toBe(false);
      }
    }
  });

  it('creates durable gold and stone deposits', () => {
    const world = createSimWorld(601);
    const goldAmounts: number[] = [];
    const stoneAmounts: number[] = [];

    for (const eid of resourceQuery(world.ecs)) {
      if (Resource.kind[eid] === ResourceKindId.GOLD) goldAmounts.push(Resource.amount[eid]);
      if (Resource.kind[eid] === ResourceKindId.STONE) stoneAmounts.push(Resource.amount[eid]);
    }

    expect(goldAmounts.length).toBeGreaterThanOrEqual(10);
    expect(stoneAmounts.length).toBeGreaterThanOrEqual(8);
    expect(Math.min(...goldAmounts)).toBeGreaterThanOrEqual(500);
    expect(Math.min(...stoneAmounts)).toBeGreaterThanOrEqual(450);
  });
});
