/**
 * Keyed pool of {@link SpriteView}s for one entity category. Per frame:
 * `begin()`, then `show()` every entity that should be on screen, then
 * `end()` destroys views for keys that were not shown.
 */

import type { SpriteRef } from '../sprites/sprite-source';
import { SpriteView, type SpriteViewLayers } from './sprite-view';

export class SpriteSync<K> {
  private readonly views = new Map<K, SpriteView>();
  private readonly seen = new Set<K>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly layers: SpriteViewLayers,
    private readonly onRemove?: (key: K) => void,
    /** Called with the view still alive, right before an unshown key is destroyed. */
    private readonly onBeforeRemove?: (key: K, view: SpriteView) => void
  ) {}

  begin(): void {
    this.seen.clear();
  }

  show(key: K, ref: SpriteRef, x: number, y: number): SpriteView {
    this.seen.add(key);
    let view = this.views.get(key);
    if (!view) {
      view = new SpriteView(this.scene, this.layers, ref, x, y);
      this.views.set(key, view);
    } else {
      view.apply(ref);
    }
    view.setPosition(x, y);
    return view;
  }

  end(): void {
    for (const [key, view] of this.views) {
      if (this.seen.has(key)) continue;
      this.onBeforeRemove?.(key, view);
      view.destroy();
      this.views.delete(key);
      this.onRemove?.(key);
    }
  }

  get(key: K): SpriteView | undefined {
    return this.views.get(key);
  }

  entries(): IterableIterator<[K, SpriteView]> {
    return this.views.entries();
  }

  allViews(): IterableIterator<SpriteView> {
    return this.views.values();
  }

  countBySource(source: SpriteRef['source']): number {
    let n = 0;
    for (const view of this.views.values()) if (view.ref.source === source) n++;
    return n;
  }

  get size(): number {
    return this.views.size;
  }

  clear(): void {
    for (const view of this.views.values()) view.destroy();
    this.views.clear();
    this.seen.clear();
  }
}
