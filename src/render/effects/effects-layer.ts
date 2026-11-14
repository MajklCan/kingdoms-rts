/**
 * World-space VFX: one-shot effects at a world position (impacts, projectiles,
 * dust), looping effects attached to an entity (fire on a damaged building,
 * smoke on a foundry) and a screen-shake hook.
 *
 * Effects are registered by id; each spawn creates an {@link EffectInstance}
 * that the layer advances every frame until it reports it is finished.
 * Instances can draw immediate-mode into the shared `gfx` (cleared every
 * frame), or own Phaser objects (particle emitters, tweened sprites) that
 * they add to `ctx.layer` and destroy themselves.
 *
 * Adding a new effect:
 *   effects.register('dust', (ctx, spawn) => particleBurst(ctx, spawn.at, {...}));
 *   effects.spawn('dust', { x: tileX, y: tileY });
 */

import { entityExists } from 'bitecs';
import type { ScreenPos } from '../iso';
import type { SceneContext } from '../scene-context';
import { addLayerGraphics } from '../world-layers';

/** A sim-world position: tile coordinates plus an optional pixel lift above
 *  the terrain surface (e.g. the muzzle of a tower 68 px above its base). */
export interface WorldPoint {
  x: number;
  y: number;
  lift?: number;
}

/** What a factory receives: positions already projected to layer-local px. */
export interface EffectSpawn {
  at: ScreenPos;
  /** Travel target for effects that move from `at` to `to` (projectiles). */
  to?: ScreenPos;
  durationMs?: number;
  params: Readonly<Record<string, unknown>>;
}

export interface EffectContext {
  scene: Phaser.Scene;
  /** Container the effect may add its own game objects to. */
  layer: Phaser.GameObjects.Container;
  /** Shared immediate-mode graphics, cleared at the start of every frame. */
  gfx: Phaser.GameObjects.Graphics;
  /** Key of a small soft white dot texture, generated on first use. */
  particleTexture(): string;
}

export interface EffectInstance {
  /**
   * Advance by `dtMs` (game-speed scaled) and draw. `anchor` is the attached
   * entity's current screen position, `null` when it is not on screen (fog),
   * and `undefined` for unattached effects. Return false when finished.
   */
  update(dtMs: number, anchor: ScreenPos | null | undefined): boolean;
  /** Release owned game objects. Called once, after the last update. */
  destroy?(): void;
}

export type EffectFactory = (ctx: EffectContext, spawn: EffectSpawn) => EffectInstance;

/** Resolves an entity id to its on-screen anchor (renderers' `anchorOf`). */
export type EntityAnchorResolver = (eid: number) => ScreenPos | null;

export interface EffectHandle {
  readonly id: string;
  stop(): void;
}

export interface EffectSpawnOptions {
  to?: WorldPoint;
  durationMs?: number;
  params?: Readonly<Record<string, unknown>>;
}

interface ActiveEffect {
  handle: EffectHandle;
  instance: EffectInstance;
  eid?: number;
  stopped: boolean;
}

const PARTICLE_TEXTURE_KEY = 'fx-particle';

export class EffectsLayer {
  private readonly factories = new Map<string, EffectFactory>();
  private readonly active: ActiveEffect[] = [];
  private readonly fx: EffectContext;
  private resolveAnchor: EntityAnchorResolver = () => null;

  constructor(private readonly ctx: SceneContext) {
    const scene = ctx.scene;
    this.fx = {
      scene,
      layer: ctx.layers.effects,
      gfx: addLayerGraphics(scene, ctx.layers.effects),
      particleTexture: () => ensureParticleTexture(scene),
    };
  }

  /** Where attached effects look up their entity each frame. */
  setAnchorResolver(resolve: EntityAnchorResolver): void {
    this.resolveAnchor = resolve;
  }

  register(id: string, factory: EffectFactory): void {
    this.factories.set(id, factory);
  }

  has(id: string): boolean {
    return this.factories.has(id);
  }

  registeredIds(): string[] {
    return [...this.factories.keys()];
  }

  /** One-shot effect at a world position. Null if `id` is not registered. */
  spawn(id: string, at: WorldPoint, opts: EffectSpawnOptions = {}): EffectHandle | null {
    const factory = this.factories.get(id);
    if (!factory) return null;
    const spawn: EffectSpawn = {
      at: this.project(at),
      to: opts.to ? this.project(opts.to) : undefined,
      durationMs: opts.durationMs,
      params: opts.params ?? {},
    };
    return this.track(id, factory(this.fx, spawn));
  }

  /**
   * Looping effect that follows an entity until stopped or the entity is
   * gone. While the entity is hidden by fog the instance gets a null anchor.
   */
  attach(id: string, eid: number, opts: Omit<EffectSpawnOptions, 'to'> = {}): EffectHandle | null {
    const factory = this.factories.get(id);
    if (!factory) return null;
    const anchor = this.resolveAnchor(eid);
    const spawn: EffectSpawn = {
      at: anchor ?? { x: 0, y: 0 },
      durationMs: opts.durationMs,
      params: opts.params ?? {},
    };
    return this.track(id, factory(this.fx, spawn), eid);
  }

  /** Camera shake. Intensity is a fraction of the viewport (0.004 = subtle). */
  shake(intensity = 0.004, durationMs = 120): void {
    this.ctx.scene.cameras.main.shake(durationMs, intensity);
  }

  /** Advance and draw every active effect. `dtMs` is game-speed scaled. */
  update(dtMs: number): void {
    this.fx.gfx.clear();
    if (this.active.length === 0) return;
    const ecs = this.ctx.world.ecs;
    let write = 0;
    for (let read = 0; read < this.active.length; read++) {
      const effect = this.active[read];
      let alive = !effect.stopped;
      if (alive && effect.eid !== undefined && !entityExists(ecs, effect.eid)) alive = false;
      if (alive) {
        const anchor = effect.eid === undefined ? undefined : this.resolveAnchor(effect.eid);
        alive = effect.instance.update(dtMs, anchor);
      }
      if (alive) {
        this.active[write++] = effect;
      } else {
        effect.stopped = true;
        effect.instance.destroy?.();
      }
    }
    this.active.length = write;
  }

  /** Drop every effect (new game / load / match start). */
  clear(): void {
    for (const effect of this.active) {
      effect.stopped = true;
      effect.instance.destroy?.();
    }
    this.active.length = 0;
    this.fx.gfx.clear();
  }

  get activeCount(): number {
    return this.active.length;
  }

  /** Active effect count per registered id (debug / tests). */
  countsById(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const effect of this.active) {
      counts[effect.handle.id] = (counts[effect.handle.id] ?? 0) + 1;
    }
    return counts;
  }

  private track(id: string, instance: EffectInstance, eid?: number): EffectHandle {
    const effect: ActiveEffect = {
      handle: { id, stop: () => { effect.stopped = true; } },
      instance,
      eid,
      stopped: false,
    };
    this.active.push(effect);
    return effect.handle;
  }

  private project(point: WorldPoint): ScreenPos {
    const screen = this.ctx.tileToScreen(point.x, point.y);
    return { x: screen.x, y: screen.y - (point.lift ?? 0) };
  }
}

function ensureParticleTexture(scene: Phaser.Scene): string {
  if (scene.textures.exists(PARTICLE_TEXTURE_KEY)) return PARTICLE_TEXTURE_KEY;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0xffffff, 0.5);
  g.fillCircle(4, 4, 4);
  g.fillStyle(0xffffff, 1);
  g.fillCircle(4, 4, 2.5);
  g.generateTexture(PARTICLE_TEXTURE_KEY, 8, 8);
  g.destroy();
  return PARTICLE_TEXTURE_KEY;
}

export interface ParticleBurstOptions {
  tint?: number | number[];
  count?: number;
  speed?: { min: number; max: number };
  lifespanMs?: number;
  scale?: { start: number; end: number };
  gravityY?: number;
}

/**
 * Ready-made one-shot particle burst (Phaser particle emitter). Use it from a
 * factory: `register('spark', (ctx, s) => particleBurst(ctx, s.at, {...}))`.
 */
export function particleBurst(
  ctx: EffectContext,
  at: ScreenPos,
  opts: ParticleBurstOptions = {}
): EffectInstance {
  const lifespan = opts.lifespanMs ?? 450;
  const emitter = ctx.scene.add.particles(at.x, at.y, ctx.particleTexture(), {
    speed: opts.speed ?? { min: 20, max: 70 },
    lifespan,
    scale: opts.scale ?? { start: 0.9, end: 0 },
    alpha: { start: 1, end: 0 },
    gravityY: opts.gravityY ?? 0,
    tint: opts.tint ?? 0xffffff,
    emitting: false,
  });
  ctx.layer.add(emitter);
  emitter.explode(opts.count ?? 12);
  let elapsed = 0;
  return {
    update(dtMs) {
      elapsed += dtMs;
      return elapsed < lifespan || emitter.getAliveParticleCount() > 0;
    },
    destroy() {
      emitter.destroy();
    },
  };
}

export const PARTICLE_BURST_EFFECT = 'particle-burst';

/** Generic burst registered by default; params map onto {@link ParticleBurstOptions}. */
export const particleBurstEffect: EffectFactory = (ctx, spawn) =>
  particleBurst(ctx, spawn.at, spawn.params as ParticleBurstOptions);
