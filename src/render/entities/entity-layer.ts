/**
 * Depth-sorted container for world sprites (buildings, units, resources, map
 * features). Phaser Containers render children in list order and ignore
 * `depth`, so painter ordering by screen y has to be applied explicitly: the
 * layer re-sorts its children whenever a depth changed or a child was added.
 */

export class EntityLayer {
  private dirty = false;

  constructor(readonly container: Phaser.GameObjects.Container) {}

  add(child: Phaser.GameObjects.GameObject): void {
    this.container.add(child);
    this.dirty = true;
  }

  setDepth(child: Phaser.GameObjects.Sprite, depth: number): void {
    if (child.depth === depth) return;
    child.setDepth(depth);
    this.dirty = true;
  }

  /** Apply painter ordering. Cheap no-op when nothing moved. */
  sort(): void {
    if (!this.dirty) return;
    this.container.sort('depth');
    this.dirty = false;
  }

  get childCount(): number {
    return this.container.length;
  }
}
