/**
 * Pooled particles for world VFX. Three fixed-size pools, each a container of
 * reusable Images on the VFX sheet (one batch per pool):
 *
 *   ground  lies on the terrain under every entity (dust rings, scorch)
 *   normal  above the entities, normal blending (smoke, dust, chips, debris)
 *   add     above the entities, additive blending (fire, sparks, flashes)
 *
 * State lives in typed arrays; the per-frame update allocates nothing. A
 * full pool drops new particles instead of growing, and particles spawned
 * outside the camera view (plus a margin) are skipped, so a big battle off
 * screen costs nothing. All randomness here is render-local `Math.random`.
 */

import { BLEND_ADD, BLEND_NORMAL } from './fx-constants';
import { FX_SHEET, type FxFrame } from './fx-textures';

export type FxPoolId = 'ground' | 'normal' | 'add';

export interface ParticleSpec {
  frame: FxFrame;
  x: number;
  y: number;
  /** Velocity, px/s. */
  vx?: number;
  vy?: number;
  /** Acceleration, px/s^2 (gravity is +ay). */
  ax?: number;
  ay?: number;
  /** Exponential velocity damping per second (0 = none). */
  drag?: number;
  /** Lifetime, ms. */
  life: number;
  scale?: number;
  scaleEnd?: number;
  /** Extra vertical scale (flatten rings onto the iso ground). */
  squash?: number;
  alpha?: number;
  /** Fraction of the life spent fading in. */
  fadeIn?: number;
  /** Fraction of the life (at the end) spent fading out; default 0.5. */
  fadeOut?: number;
  tint?: number;
  rotation?: number;
  /** rad/s */
  spin?: number;
  /** Rotation follows the velocity (streaks). */
  align?: boolean;
  /** Screen y the particle bounces on (debris lands where it was thrown from). */
  floorY?: number;
  /** Delay before the particle appears, ms. */
  delay?: number;
}

const FLAG_ALIGN = 1;
const FLAG_FLOOR = 2;

class Pool {
  readonly container: Phaser.GameObjects.Container;
  private readonly images: Array<Phaser.GameObjects.Image | null>;
  private readonly free: Int32Array;
  private freeCount: number;
  private readonly active: Int32Array;
  private activeCount = 0;
  private readonly x: Float32Array;
  private readonly y: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly ax: Float32Array;
  private readonly ay: Float32Array;
  private readonly drag: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly s0: Float32Array;
  private readonly s1: Float32Array;
  private readonly squash: Float32Array;
  private readonly a0: Float32Array;
  private readonly fadeIn: Float32Array;
  private readonly fadeOut: Float32Array;
  private readonly rot: Float32Array;
  private readonly spin: Float32Array;
  private readonly floorY: Float32Array;
  private readonly flags: Uint8Array;

  constructor(
    private readonly scene: Phaser.Scene,
    parent: Phaser.GameObjects.Container,
    readonly capacity: number,
    private readonly blend: number
  ) {
    this.container = scene.add.container(0, 0);
    parent.add(this.container);
    this.images = new Array(capacity).fill(null);
    this.free = new Int32Array(capacity);
    for (let i = 0; i < capacity; i++) this.free[i] = capacity - 1 - i;
    this.freeCount = capacity;
    this.active = new Int32Array(capacity);
    const f32 = (): Float32Array => new Float32Array(capacity);
    this.x = f32();
    this.y = f32();
    this.vx = f32();
    this.vy = f32();
    this.ax = f32();
    this.ay = f32();
    this.drag = f32();
    this.age = f32();
    this.life = f32();
    this.s0 = f32();
    this.s1 = f32();
    this.squash = f32();
    this.a0 = f32();
    this.fadeIn = f32();
    this.fadeOut = f32();
    this.rot = f32();
    this.spin = f32();
    this.floorY = f32();
    this.flags = new Uint8Array(capacity);
  }

  get count(): number {
    return this.activeCount;
  }

  emit(p: ParticleSpec): boolean {
    if (this.freeCount === 0) return false;
    const i = this.free[--this.freeCount];
    this.active[this.activeCount++] = i;
    let img = this.images[i];
    if (!img) {
      img = this.scene.add.image(0, 0, FX_SHEET, p.frame);
      img.setBlendMode(this.blend);
      this.container.add(img);
      this.images[i] = img;
    } else {
      img.setFrame(p.frame);
    }
    img.setTint(p.tint ?? 0xffffff);
    this.x[i] = p.x;
    this.y[i] = p.y;
    this.vx[i] = p.vx ?? 0;
    this.vy[i] = p.vy ?? 0;
    this.ax[i] = p.ax ?? 0;
    this.ay[i] = p.ay ?? 0;
    this.drag[i] = p.drag ?? 0;
    this.age[i] = -(p.delay ?? 0);
    this.life[i] = Math.max(1, p.life);
    this.s0[i] = p.scale ?? 1;
    this.s1[i] = p.scaleEnd ?? p.scale ?? 1;
    this.squash[i] = p.squash ?? 1;
    this.a0[i] = p.alpha ?? 1;
    this.fadeIn[i] = p.fadeIn ?? 0;
    this.fadeOut[i] = p.fadeOut ?? 0.5;
    this.rot[i] = p.rotation ?? 0;
    this.spin[i] = p.spin ?? 0;
    this.floorY[i] = p.floorY ?? 0;
    this.flags[i] = (p.align ? FLAG_ALIGN : 0) | (p.floorY !== undefined ? FLAG_FLOOR : 0);
    img.setVisible(false);
    this.place(i, img, 0);
    return true;
  }

  update(dtMs: number): void {
    if (this.activeCount === 0) return;
    const dt = dtMs / 1000;
    let n = 0;
    while (n < this.activeCount) {
      const i = this.active[n];
      const img = this.images[i] as Phaser.GameObjects.Image;
      const wasWaiting = this.age[i] < 0;
      this.age[i] += dtMs;
      if (this.age[i] < 0) {
        n++;
        continue;
      }
      if (this.age[i] >= this.life[i]) {
        img.setVisible(false);
        this.free[this.freeCount++] = i;
        this.active[n] = this.active[--this.activeCount];
        continue;
      }
      const step = wasWaiting ? 0 : dt;
      this.vx[i] += this.ax[i] * step;
      this.vy[i] += this.ay[i] * step;
      if (this.drag[i] > 0) {
        const k = Math.exp(-this.drag[i] * step);
        this.vx[i] *= k;
        this.vy[i] *= k;
      }
      this.x[i] += this.vx[i] * step;
      this.y[i] += this.vy[i] * step;
      if ((this.flags[i] & FLAG_FLOOR) !== 0 && this.y[i] > this.floorY[i] && this.vy[i] > 0) {
        this.y[i] = this.floorY[i];
        this.vy[i] *= -0.32;
        this.vx[i] *= 0.55;
        this.spin[i] *= 0.4;
        if (Math.abs(this.vy[i]) < 12) {
          this.vy[i] = 0;
          this.ay[i] = 0;
          this.vx[i] *= 0.3;
        }
      }
      this.rot[i] += this.spin[i] * step;
      this.place(i, img, this.age[i] / this.life[i]);
      n++;
    }
  }

  clear(): void {
    for (let n = 0; n < this.activeCount; n++) {
      const i = this.active[n];
      this.images[i]?.setVisible(false);
      this.free[this.freeCount++] = i;
    }
    this.activeCount = 0;
  }

  private place(i: number, img: Phaser.GameObjects.Image, t: number): void {
    const eased = 1 - (1 - t) * (1 - t);
    const s = this.s0[i] + (this.s1[i] - this.s0[i]) * eased;
    let a = this.a0[i];
    const fin = this.fadeIn[i];
    if (fin > 0 && t < fin) a *= t / fin;
    const fout = this.fadeOut[i];
    if (fout > 0 && t > 1 - fout) a *= (1 - t) / fout;
    img.x = this.x[i];
    img.y = this.y[i];
    img.setScale(s, s * this.squash[i]);
    img.setAlpha(a);
    img.rotation = (this.flags[i] & FLAG_ALIGN) !== 0
      ? Math.atan2(this.vy[i], this.vx[i])
      : this.rot[i];
    if (this.age[i] >= 0) img.setVisible(true);
  }
}

export interface FxView {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export class FxParticles {
  private readonly pools: Record<FxPoolId, Pool>;
  /** Layer-local camera view, refreshed every frame by the owner. */
  readonly view: FxView = { left: 0, top: 0, right: 0, bottom: 0 };

  constructor(scene: Phaser.Scene, layers: { groundFx: Phaser.GameObjects.Container; effects: Phaser.GameObjects.Container }) {
    this.pools = {
      ground: new Pool(scene, layers.groundFx, 260, BLEND_NORMAL),
      normal: new Pool(scene, layers.effects, 1100, BLEND_NORMAL),
      add: new Pool(scene, layers.effects, 520, BLEND_ADD),
    };
  }

  /** True when a layer-local point is inside the camera view grown by `margin` px. */
  onScreen(x: number, y: number, margin = 48): boolean {
    const v = this.view;
    return x >= v.left - margin && x <= v.right + margin && y >= v.top - margin && y <= v.bottom + margin;
  }

  /** Spawn one particle; false when culled or the pool is full. */
  emit(pool: FxPoolId, spec: ParticleSpec): boolean {
    if (!this.onScreen(spec.x, spec.y, 96)) return false;
    return this.pools[pool].emit(spec);
  }

  update(dtMs: number): void {
    if (dtMs <= 0) return;
    this.pools.ground.update(dtMs);
    this.pools.normal.update(dtMs);
    this.pools.add.update(dtMs);
  }

  clear(): void {
    this.pools.ground.clear();
    this.pools.normal.clear();
    this.pools.add.clear();
  }

  get counts(): Record<FxPoolId, number> {
    return { ground: this.pools.ground.count, normal: this.pools.normal.count, add: this.pools.add.count };
  }

  /** Free slots in a pool (recipes thin themselves out when it runs low). */
  headroom(pool: FxPoolId): number {
    const p = this.pools[pool];
    return p.capacity - p.count;
  }
}

/** Uniform random in [min, max). Render-local, never the sim RNG. */
export function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
