/**
 * Team-colour silhouettes for units hidden behind a taller sprite (tree
 * canopies, buildings), so an army walking through a forest or a villager
 * behind the town centre stays findable.
 *
 * Per frame: `begin()` snapshots the screen bounds of every live building,
 * `track()` tests one point on each unit's body against the opaque pixels of
 * the buildings and trees drawn in front of it (half-res alpha maps, no
 * readbacks), and an occluded unit gets a pooled ghost: the same frame
 * filled with its team colour at half alpha, drawn above the entity layer.
 */

import { TEAM_COLORS } from '../../config';
import { TINT_FILL } from '../effects/fx-constants';
import type { SceneContext } from '../scene-context';
import { AlphaMasks } from './alpha-masks';
import type { SpriteView } from './sprite-view';

export interface OccluderSource {
  /** Live (drawn) building views. */
  buildingViews(): IterableIterator<SpriteView>;
  /** Tree drawn on a tile, if any. */
  treeViewAt(tileX: number, tileY: number): SpriteView | undefined;
}

/** Body point tested for occlusion: px above the feet. */
const BODY_LIFT = 9;
/** Alpha above which the occluder counts as covering the point. */
const COVER_ALPHA = 90;
const GHOST_ALPHA = 0.46;
/** Tree tiles in front of a unit that can reach its body (x + y steps ahead). */
const TREE_REACH = 7;

export class UnitOcclusion {
  private readonly container: Phaser.GameObjects.Container;
  private readonly masks = new AlphaMasks();
  private readonly ghosts: Phaser.GameObjects.Image[] = [];
  private used = 0;
  private readonly boxes: Array<{ view: SpriteView; l: number; r: number; t: number; b: number }> = [];
  private boxCount = 0;

  constructor(
    private readonly ctx: SceneContext,
    private readonly source: OccluderSource
  ) {
    this.container = ctx.scene.add.container(0, 0);
    // Under the rings and health bars, above every entity.
    ctx.layers.overlay.addAt(this.container, 0);
  }

  begin(): void {
    this.used = 0;
    this.boxCount = 0;
    for (const view of this.source.buildingViews()) {
      const s = view.sprite;
      if (!s.visible) continue;
      const l = s.x - s.displayOriginX * s.scaleX;
      const t = s.y - s.displayOriginY * s.scaleY;
      let box = this.boxes[this.boxCount];
      if (!box) {
        box = { view, l: 0, r: 0, t: 0, b: 0 };
        this.boxes.push(box);
      }
      box.view = view;
      box.l = l;
      box.t = t;
      box.r = l + s.width * s.scaleX;
      box.b = t + s.height * s.scaleY;
      this.boxCount++;
    }
  }

  /** Show a ghost for `unit` when its body is covered by something drawn in front. */
  track(unit: SpriteView, tileX: number, tileY: number, owner: number): void {
    if (!this.isOccluded(unit, tileX, tileY)) return;
    const s = unit.sprite;
    const ghost = this.ghost();
    ghost.setTexture(s.texture.key, s.frame.name);
    ghost.setOrigin(s.originX, s.originY);
    ghost.setScale(s.scaleX, s.scaleY);
    ghost.setPosition(s.x, s.y);
    ghost.setFlipX(s.flipX);
    ghost.setTint(ghostColor(owner));
    ghost.setAlpha(GHOST_ALPHA * s.alpha);
  }

  end(): void {
    for (let i = this.used; i < this.ghosts.length; i++) {
      const g = this.ghosts[i];
      if (g.visible) g.setVisible(false);
    }
  }

  clear(): void {
    this.used = 0;
    this.end();
    this.boxCount = 0;
  }

  private isOccluded(unit: SpriteView, tileX: number, tileY: number): boolean {
    const px = unit.x;
    const py = unit.y - BODY_LIFT;
    const depth = unit.sprite.depth;
    for (let i = 0; i < this.boxCount; i++) {
      const box = this.boxes[i];
      if (px < box.l || px > box.r || py < box.t || py > box.b) continue;
      if (box.view.sprite.depth <= depth) continue;
      if (this.masks.alphaAt(box.view.sprite, px, py) >= COVER_ALPHA) return true;
    }
    const tx = Math.round(tileX);
    const ty = Math.round(tileY);
    for (let d = 1; d <= TREE_REACH; d++) {
      for (let e = -1; e <= 1; e++) {
        if (((d + e) & 1) !== 0) continue;
        const tree = this.source.treeViewAt(tx + (d + e) / 2, ty + (d - e) / 2);
        if (!tree || tree.sprite.depth <= depth) continue;
        if (this.masks.alphaAt(tree.sprite, px, py) >= COVER_ALPHA) return true;
      }
    }
    return false;
  }

  private ghost(): Phaser.GameObjects.Image {
    let g = this.ghosts[this.used];
    if (!g) {
      g = this.ctx.scene.add.image(0, 0, '__WHITE');
      g.setTintMode(TINT_FILL);
      this.container.add(g);
      this.ghosts.push(g);
    }
    this.used++;
    if (!g.visible) g.setVisible(true);
    return g;
  }
}

/** Team colour lifted towards white: a lighter, less painted-on silhouette. */
function ghostColor(owner: number): number {
  const c = TEAM_COLORS[owner] ?? 0xffffff;
  const k = 0.42;
  const r = (c >> 16) & 0xff;
  const g = (c >> 8) & 0xff;
  const b = c & 0xff;
  return (Math.round(r + (255 - r) * k) << 16) | (Math.round(g + (255 - g) * k) << 8) | Math.round(b + (255 - b) * k);
}
