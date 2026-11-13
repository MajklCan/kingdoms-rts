/**
 * Fixed stacking order of everything drawn in world space. Each layer is a
 * child container of the world root, so the order below is the draw order:
 *
 *   terrain   baked terrain chunks (Blender tiles, or the flat-colour bake)
 *   decor     render-only scatter (grass tufts, flowers, rocks, reeds)
 *   shadows   ground shadows of every entity + unit contact blobs
 *   groundFx  VFX lying on the ground: cloud shadows, scorch marks, dust
 *             rings, fallen units (WorldFx), so units walk over them
 *   ground    in-world UI on the ground plane: rally flags, build ghost
 *             footprint, the back half of selection rings
 *   fog       fog of war over the ground (explored dim + unexplored black)
 *   entities  buildings / units / resources / map features, painter-sorted;
 *             fogged-but-explored ones are tinted instead of covered
 *   overlay   UI that must read above the art: front half of selection
 *             rings, health / progress bars, worker dots, the ghost building
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
  decor: Phaser.GameObjects.Container;
  shadows: Phaser.GameObjects.Container;
  groundFx: Phaser.GameObjects.Container;
  ground: Phaser.GameObjects.Container;
  fog: Phaser.GameObjects.Container;
  entities: EntityLayer;
  overlay: Phaser.GameObjects.Container;
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
  const decor = child();
  const shadows = child();
  const groundFx = child();
  const ground = child();
  const fog = child();
  const entities = new EntityLayer(child());
  const overlay = child();
  const effects = child();
  return { root, terrain, decor, shadows, groundFx, ground, fog, entities, overlay, effects };
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
