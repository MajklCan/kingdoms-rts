/**
 * Unit sprites. Positions are interpolated between the previous and current
 * sim tick (60 fps motion on a 20 Hz sim); pose comes from the UnitAnimator,
 * art from the sprite source.
 */

import { hasComponent } from 'bitecs';
import { SIM } from '../../config';
import { Owner, Position, PrevPosition, UnitKind } from '@sim/components';
import { unitQuery } from '@sim/world';
import type { ScreenPos } from '../iso';
import type { StatusOverlay } from '../overlays/status-overlay';
import type { SceneContext } from '../scene-context';
import type { SpriteSource } from '../sprites/sprite-source';
import { SpriteSync } from './sprite-sync';
import { UnitAnimator } from './unit-animator';

export class UnitRenderer {
  readonly animator: UnitAnimator;
  private readonly units: SpriteSync<number>;

  constructor(
    private readonly ctx: SceneContext,
    private readonly sprites: SpriteSource
  ) {
    this.animator = new UnitAnimator(ctx, (unitDefId, anim) => sprites.unitFrameCount(unitDefId, anim));
    this.units = new SpriteSync(ctx.scene, ctx.layers, (eid) => this.animator.forget(eid));
  }

  /** Sync every visible unit sprite and draw its ground status (ring, bars). */
  draw(overlay: StatusOverlay): void {
    const world = this.ctx.world;
    // alpha 0 = freshly stepped, 1 = about to step again.
    const alpha = Math.min(1, this.ctx.accumulatorMs / SIM.TICK_MS);
    this.units.begin();
    for (const eid of unitQuery(world.ecs)) {
      if (!this.ctx.isEntityVisible(eid)) continue;
      const pose = this.animator.pose(eid);
      if (!pose) continue;
      const ref = this.sprites.unit({
        unitDefId: UnitKind.kind[eid],
        playerId: Owner.player[eid],
        facing: pose.facing,
        anim: pose.anim,
        frame: pose.frame,
      });
      if (!ref) continue;

      const hasPrev = hasComponent(world.ecs, PrevPosition, eid);
      const px = hasPrev
        ? PrevPosition.x[eid] + (Position.x[eid] - PrevPosition.x[eid]) * alpha
        : Position.x[eid];
      const py = hasPrev
        ? PrevPosition.y[eid] + (Position.y[eid] - PrevPosition.y[eid]) * alpha
        : Position.y[eid];
      const screen = this.ctx.tileToScreen(px, py);
      const view = this.units.show(eid, ref, screen.x, screen.y);
      view.setDepth(screen.y + 1);
      overlay.drawUnit(eid, screen, screen.y - ref.top);
    }
    this.units.end();
  }

  /** Current (interpolated) on-screen anchor of a unit (effects attach here). */
  anchorOf(eid: number): ScreenPos | null {
    const view = this.units.get(eid);
    return view ? { x: view.x, y: view.y } : null;
  }

  get counts(): { live: number; atlas: number } {
    return { live: this.units.size, atlas: this.units.countBySource('atlas') };
  }

  clear(): void {
    this.units.clear();
    this.animator.clear();
  }
}
