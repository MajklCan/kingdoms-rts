/**
 * Huntable game (deer, boar) from the sim: drawn with the ambient-life pixel
 * sprites (life-sprites.ts), scaled up so a hunt target reads at play zoom.
 * Placeholder art until real atlas frames exist; the ambient decor deer in
 * effects/wildlife.ts stay separate (they are render-only and never hunted).
 *
 * An animal is only drawn while its tile is in vision: it moves, so a
 * remembered position under fog would lie. A carcass lies still and is drawn
 * like any explored resource (fog-dimmed outside vision).
 */

import { SIM } from '../../config';
import {
  GameAnimal,
  GameAnimalStateId,
  GameSpeciesId,
  Position,
  PrevPosition,
  Resource,
} from '@sim/components';
import { gameAnimalQuery } from '@sim/world';
import { ensureLifeSheet, LIFE_SHEET, lifeFrameSize, type LifeFrame } from '../effects/life-sprites';
import { FOG_DIM_TINT } from '../overlays/fog-style';
import type { SceneContext } from '../scene-context';
import type { SpriteRef } from '../sprites/sprite-source';
import { SpriteSync } from './sprite-sync';

/** Life sprites are drawn at 1x for decor; game is a gameplay target. */
const GAME_SCALE = 2.4;

export class GameRenderer {
  private readonly views: SpriteSync<number>;
  private readonly refs = new Map<LifeFrame, SpriteRef>();
  /** eid -> last screen-x heading, so a standing animal keeps its facing. */
  private readonly facingLeft = new Map<number, boolean>();

  constructor(private readonly ctx: SceneContext) {
    ensureLifeSheet(ctx.scene);
    this.views = new SpriteSync(ctx.scene, ctx.layers, (eid) => this.facingLeft.delete(eid));
  }

  draw(): void {
    const world = this.ctx.world;
    const alpha = Math.min(1, this.ctx.accumulatorMs / SIM.TICK_MS);
    const now = this.ctx.scene.time.now;
    this.views.begin();
    for (const eid of gameAnimalQuery(world.ecs)) {
      if (Resource.amount[eid] <= 0) continue;
      const carcass = GameAnimal.state[eid] === GameAnimalStateId.CARCASS;
      const visible = this.ctx.isTileVisible(Math.round(Position.x[eid]), Math.round(Position.y[eid]));
      if (!visible && (!carcass || !this.ctx.isResourceExplored(eid))) continue;
      const x = PrevPosition.x[eid] + (Position.x[eid] - PrevPosition.x[eid]) * alpha;
      const y = PrevPosition.y[eid] + (Position.y[eid] - PrevPosition.y[eid]) * alpha;
      const moving = Position.x[eid] !== PrevPosition.x[eid] || Position.y[eid] !== PrevPosition.y[eid];
      const frame = gameFrame(GameAnimal.species[eid], carcass, moving, now + eid * 97);
      const c = this.ctx.tileToScreen(x, y);
      const view = this.views.show(eid, this.refFor(frame), c.x, c.y);
      view.setDepth(c.y);
      view.setTintOrClear(visible ? null : FOG_DIM_TINT);
      if (moving) {
        // Screen x grows with (x - y): heading left on screen flips the art.
        const dx = (Position.x[eid] - PrevPosition.x[eid]) - (Position.y[eid] - PrevPosition.y[eid]);
        if (Math.abs(dx) > 0.0001) this.facingLeft.set(eid, dx < 0);
      }
      view.sprite.setFlipX(this.facingLeft.get(eid) ?? (eid % 2 === 0));
    }
    this.views.end();
  }

  clear(): void {
    this.views.clear();
    this.facingLeft.clear();
  }

  private refFor(frame: LifeFrame): SpriteRef {
    let ref = this.refs.get(frame);
    if (!ref) {
      const size = lifeFrameSize(frame);
      ref = {
        texture: LIFE_SHEET,
        frame,
        originX: 0.5,
        originY: 0.92,
        scale: GAME_SCALE,
        anchor: 'center',
        top: Math.round(size.h * GAME_SCALE),
        source: 'voxel',
      };
      this.refs.set(frame, ref);
    }
    return ref;
  }
}

function gameFrame(species: number, carcass: boolean, moving: boolean, now: number): LifeFrame {
  const boar = species === GameSpeciesId.BOAR;
  if (carcass) return boar ? 'boar_carcass' : 'deer_carcass';
  if (boar) return moving && Math.floor(now / 220) % 2 === 0 ? 'boar_walk' : 'boar_stand';
  if (moving) return Math.floor(now / 260) % 2 === 0 ? 'deer_run0' : 'deer_run1';
  // Standing deer graze now and then.
  return Math.floor(now / 2300) % 3 === 0 ? 'deer_stand' : 'deer_graze';
}
