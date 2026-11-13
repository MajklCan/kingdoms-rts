/**
 * Unit sprites. Positions are interpolated between the previous and current
 * sim tick (60 fps motion on a 20 Hz sim); pose comes from the UnitAnimator,
 * art from the sprite source.
 *
 * Also render-only feedback on the unit itself: a hit flash when its HP
 * drops, an optional team-colour silhouette while it is hidden behind a tree
 * or building, and a death notice (with the last drawn frame) when a unit on
 * screen stops existing, which the VFX layer turns into a falling body.
 */

import { entityExists, hasComponent } from 'bitecs';
import { SIM } from '../../config';
import { Health, Owner, Position, PrevPosition, UnitKind } from '@sim/components';
import { unitQuery } from '@sim/world';
import type { ScreenPos } from '../iso';
import type { StatusOverlay, UnitStatusSize } from '../overlays/status-overlay';
import type { SceneContext } from '../scene-context';
import { DEFAULT_FACING, type Facing } from '../sprites/facing';
import type { SpriteRef, SpriteSource, UnitArtInfo } from '../sprites/sprite-source';
import { AlphaMasks } from './alpha-masks';
import { HitFlash } from './hit-flash';
import { SpriteSync } from './sprite-sync';
import type { SpriteSnapshot, SpriteView } from './sprite-view';
import { UnitAnimator } from './unit-animator';
import type { UnitOcclusion } from './unit-occlusion';

/** Peak additive hit-flash colour on units: a hot near-white. */
const UNIT_FLASH = 0xb09080;

export interface UnitDeath {
  eid: number;
  unitDefId: number;
  owner: number;
  /** Last tile position. */
  x: number;
  y: number;
  sprite: SpriteSnapshot;
  /** Pre-rendered death frames (atlas units), played by the remains FX instead of a tip-over. */
  deathFrames?: { refs: SpriteRef[]; frameMs: number };
}

export class UnitRenderer {
  readonly animator: UnitAnimator;
  private readonly units: SpriteSync<number>;
  private readonly flash: HitFlash;
  private occlusion: UnitOcclusion | null = null;
  /** eid -> kind / owner / tile / facing last frame, to tell a death from a recycled eid. */
  private readonly meta = new Map<number, { kind: number; owner: number; x: number; y: number; facing: Facing }>();
  private readonly deathListeners: Array<(death: UnitDeath) => void> = [];
  /** unitDefId -> px from the feet to the top of the art (status bar height). */
  private readonly lifts = new Map<number, number>();
  private readonly masks = new AlphaMasks();
  /** unitDefId -> ring / bar sizes of pre-rendered art (null = voxel defaults). */
  private readonly sizes = new Map<number, UnitStatusSize | null>();

  constructor(
    private readonly ctx: SceneContext,
    private readonly sprites: SpriteSource
  ) {
    this.animator = new UnitAnimator(
      ctx,
      (unitDefId, anim) => sprites.unitFrameCount(unitDefId, anim),
      (unitDefId) => sprites.unitArt?.(unitDefId) ?? null
    );
    this.flash = new HitFlash(UNIT_FLASH, () => ctx.scene.time.now);
    this.units = new SpriteSync(
      ctx.scene,
      ctx.layers,
      (eid) => {
        this.animator.forget(eid);
        this.flash.forget(eid);
        this.meta.delete(eid);
      },
      (eid, view) => this.noticeRemoval(eid, view)
    );
  }

  /** Draw team-colour silhouettes of units hidden behind trees and buildings. */
  setOcclusion(occlusion: UnitOcclusion): void {
    this.occlusion = occlusion;
  }

  /** Called when a unit that was on screen died (not when it walked into fog). */
  onDeath(listener: (death: UnitDeath) => void): void {
    this.deathListeners.push(listener);
  }

  /** Sync every visible unit sprite and draw its ground status (ring, bars). */
  draw(overlay: StatusOverlay): void {
    const world = this.ctx.world;
    const ecs = world.ecs;
    // alpha 0 = freshly stepped, 1 = about to step again.
    const alpha = Math.min(1, this.ctx.accumulatorMs / SIM.TICK_MS);
    this.occlusion?.begin();
    this.units.begin();
    for (const eid of unitQuery(ecs)) {
      if (!this.ctx.isEntityVisible(eid)) continue;
      const hasPrev = hasComponent(ecs, PrevPosition, eid);
      const px = hasPrev
        ? PrevPosition.x[eid] + (Position.x[eid] - PrevPosition.x[eid]) * alpha
        : Position.x[eid];
      const py = hasPrev
        ? PrevPosition.y[eid] + (Position.y[eid] - PrevPosition.y[eid]) * alpha
        : Position.y[eid];
      const pose = this.animator.pose(eid, px, py);
      if (!pose) continue;
      const owner = Owner.player[eid];
      const kind = UnitKind.kind[eid];
      const ref = this.sprites.unit({
        unitDefId: kind,
        playerId: owner,
        facing: pose.facing,
        anim: pose.anim,
        frame: pose.frame,
      });
      if (!ref) continue;

      const screen = this.ctx.tileToScreen(px, py);
      const view = this.units.show(eid, ref, screen.x, screen.y);
      view.setDepth(screen.y + 1);
      if (hasComponent(ecs, Health, eid)) view.setFlash(this.flash.colorFor(eid, Health.hp[eid]));
      this.occlusion?.track(view, px, py, owner);
      this.remember(eid, owner, px, py, pose.facing);
      const size = this.statusSize(kind);
      const lift = size ? ref.top : this.barLift(kind, view, ref.top);
      overlay.drawUnit(eid, screen, screen.y - lift, size ?? undefined);
    }
    this.units.end();
    this.occlusion?.end();
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
    this.flash.clear();
    this.meta.clear();
    this.occlusion?.clear();
  }

  /** Height of a unit kind's art above its feet (from its first drawn frame, then stable). */
  private barLift(kind: number, view: SpriteView, fallback: number): number {
    const known = this.lifts.get(kind);
    if (known !== undefined) return known;
    const lift = this.masks.opaqueLift(view.sprite) ?? fallback;
    this.lifts.set(kind, lift);
    return lift;
  }

  /** Ring / bar sizes from the unit's pre-rendered art, null for voxel units. */
  private statusSize(kind: number): UnitStatusSize | null {
    let size = this.sizes.get(kind);
    if (size === undefined) {
      const art: UnitArtInfo | null = this.sprites.unitArt?.(kind) ?? null;
      size = art
        ? { ringW: art.ring[0], ringH: art.ring[1], barW: Math.max(18, Math.round(art.ring[0] * 0.66)) }
        : null;
      this.sizes.set(kind, size);
    }
    return size;
  }

  /** Every frame of the death anim of a unit kind, in the facing it died in. */
  private deathFrames(kind: number, owner: number, facing: Facing): UnitDeath['deathFrames'] {
    const info = this.sprites.unitArt?.(kind)?.anim('death');
    if (!info || info.frames < 1) return undefined;
    const refs: SpriteRef[] = [];
    for (let frame = 0; frame < info.frames; frame++) {
      const ref = this.sprites.unit({ unitDefId: kind, playerId: owner, facing, anim: 'death', frame });
      if (!ref || ref.source !== 'atlas') return undefined;
      refs.push(ref);
    }
    return { refs, frameMs: info.ms };
  }

  private remember(eid: number, owner: number, x: number, y: number, facing: Facing): void {
    const kind = UnitKind.kind[eid];
    const m = this.meta.get(eid);
    if (m) {
      m.kind = kind;
      m.owner = owner;
      m.x = x;
      m.y = y;
      m.facing = facing;
    } else {
      this.meta.set(eid, { kind, owner, x, y, facing });
    }
  }

  /** A drawn unit is being dropped: dead (gone / 0 HP / recycled eid) or just hidden? */
  private noticeRemoval(eid: number, view: SpriteView): void {
    const m = this.meta.get(eid);
    if (!m || this.deathListeners.length === 0) return;
    const ecs = this.ctx.world.ecs;
    const alive = entityExists(ecs, eid) &&
      hasComponent(ecs, UnitKind, eid) &&
      UnitKind.kind[eid] === m.kind &&
      (!hasComponent(ecs, Health, eid) || Health.hp[eid] > 0);
    if (alive) return;
    const death: UnitDeath = { eid, unitDefId: m.kind, owner: m.owner, x: m.x, y: m.y, sprite: view.snapshot() };
    const frames = this.deathFrames(m.kind, m.owner, m.facing ?? DEFAULT_FACING);
    if (frames) death.deathFrames = frames;
    for (const listener of this.deathListeners) listener(death);
  }
}
