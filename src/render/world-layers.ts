/**
 * Fixed stacking order of everything drawn in world space. Each layer is a
 * child container of the world root, so the order below is the draw order:
 *
 *   terrain   baked terrain sprite
 *   ground    in-world UI drawn on the ground plane: building status bars,
 *             selection rings, health bars, carry dots, build ghost
 *   fog       fog-of-war overlays (explored dim + unexplored black)
 *   entities  buildings / units / resources / map features, painter-sorted
 *   effects   projectiles, particles and other VFX (EffectsLayer)
 *
 * Adding a new kind of world drawing = pick (or add) a layer here.
 */

import { ISO, MAP, RENDER } from '../config';
import { EntityLayer } from './entities/entity-layer';

export interface WorldLayers {
  /** Root container; its x/y is the world offset applied to every layer. */
  root: Phaser.GameObjects.Container;
  terrain: Phaser.GameObjects.Container;
  ground: Phaser.GameObjects.Container;
  fog: Phaser.GameObjects.Container;
  entities: EntityLayer;
  effects: Phaser.GameObjects.Container;
}

export function createWorldLayers(scene: Phaser.Scene): WorldLayers {
  const root = scene.add.container(
    RENDER.WIDTH / 2,
    RENDER.HEIGHT / 2 - (MAP.HEIGHT * ISO.TILE_H) / 4
  );
  const child = (): Phaser.GameObjects.Container => {
    const container = scene.add.container(0, 0);
    root.add(container);
    return container;
  };
  const terrain = child();
  const ground = child();
  const fog = child();
  const entities = new EntityLayer(child());
  const effects = child();
  return { root, terrain, ground, fog, entities, effects };
}

/** Add a fresh Graphics object to a layer (later additions draw on top). */
export function addLayerGraphics(
  scene: Phaser.Scene,
  layer: Phaser.GameObjects.Container
): Phaser.GameObjects.Graphics {
  const graphics = scene.add.graphics();
  layer.add(graphics);
  return graphics;
}
