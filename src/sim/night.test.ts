import { describe, expect, it } from 'vitest';
import { Owner } from './components';
import { checksumWorld } from './checksum';
import { MAP_DEFS, MapId, isNightMap } from './map-gen';
import { loadSimWorldSnapshot, serializeSimWorld } from './save-load';
import {
  DAY_SIGHT,
  LOCAL_PLAYER_ID,
  NIGHT_SIGHT,
  buildingQuery,
  createSimWorld,
  getPlayerVisibility,
  lineOfSightRadius,
  step,
  unitQuery,
  type SimWorld,
} from './world';

function visibleTiles(world: SimWorld): number {
  const vis = getPlayerVisibility(world, LOCAL_PLAYER_ID)!;
  let n = 0;
  for (const v of vis.visible) n += v;
  return n;
}

function ownEntities(world: SimWorld): number[] {
  return [...unitQuery(world.ecs), ...buildingQuery(world.ecs)].filter(
    (eid) => Owner.player[eid] === LOCAL_PLAYER_ID
  );
}

describe('night matches', () => {
  it('gives every kind of unit and building a shorter sight at night', () => {
    for (const key of Object.keys(DAY_SIGHT) as Array<keyof typeof DAY_SIGHT>) {
      expect(NIGHT_SIGHT[key]).toBeGreaterThan(0);
      expect(NIGHT_SIGHT[key]).toBeLessThan(DAY_SIGHT[key]);
    }
  });

  it('shrinks what the player sees, entity by entity, on the same map', () => {
    const day = createSimWorld(4107, { mapId: MapId.RIVERLANDS, night: false });
    const night = createSimWorld(4107, { mapId: MapId.RIVERLANDS, night: true });
    expect(day.night).toBe(false);
    expect(night.night).toBe(true);
    const dayOwn = ownEntities(day);
    const nightOwn = ownEntities(night);
    expect(nightOwn.length).toBe(dayOwn.length);
    expect(nightOwn.length).toBeGreaterThan(0);
    for (let i = 0; i < dayOwn.length; i++) {
      expect(lineOfSightRadius(night, nightOwn[i]!)).toBeLessThan(lineOfSightRadius(day, dayOwn[i]!));
    }
    for (const world of [day, night]) {
      world.paused = false;
      step(world);
    }
    expect(visibleTiles(night)).toBeGreaterThan(0);
    expect(visibleTiles(night)).toBeLessThan(visibleTiles(day) * 0.75);
  });

  it('plays the night map at night unless the setup says day, and other maps by day', () => {
    expect(MAP_DEFS.filter((def) => def.night).map((def) => def.id)).toEqual([MapId.BLANIK_NIGHT_WATCH]);
    expect(isNightMap(MapId.BLANIK_NIGHT_WATCH)).toBe(true);
    expect(createSimWorld(11, { mapId: MapId.BLANIK_NIGHT_WATCH }).night).toBe(true);
    expect(createSimWorld(11, { mapId: MapId.BLANIK_NIGHT_WATCH, night: false }).night).toBe(false);
    expect(createSimWorld(11, { mapId: MapId.RIVERLANDS }).night).toBe(false);
    expect(createSimWorld(11).night).toBe(false);
  });

  it('keeps the same world apart from the light: night changes no map or army', () => {
    const day = createSimWorld(52, { mapId: MapId.BLANIK_NIGHT_WATCH, night: false });
    const night = createSimWorld(52, { mapId: MapId.BLANIK_NIGHT_WATCH, night: true });
    expect(Array.from(night.map.tiles)).toEqual(Array.from(day.map.tiles));
    expect(unitQuery(night.ecs).length).toBe(unitQuery(day.ecs).length);
    expect(night.rng.getState()).toBe(day.rng.getState());
    // The flag is part of the lockstep checksum: a day client and a night client must not agree.
    expect(checksumWorld(night)).not.toBe(checksumWorld(day));
  });

  it('saves and loads the time of day; saves from before it are day', () => {
    const night = createSimWorld(77, { mapId: MapId.BLANIK_NIGHT_WATCH });
    night.paused = false;
    for (let i = 0; i < 20; i++) step(night);
    const snapshot = serializeSimWorld(night, 'night');
    expect(snapshot.night).toBe(true);

    const restored = createSimWorld(1);
    loadSimWorldSnapshot(restored, snapshot);
    expect(restored.night).toBe(true);
    expect(checksumWorld(restored)).toBe(checksumWorld(night));

    const legacy = { ...snapshot };
    delete legacy.night;
    const day = createSimWorld(1, { night: true });
    loadSimWorldSnapshot(day, legacy);
    expect(day.night).toBe(false);
  });
});
