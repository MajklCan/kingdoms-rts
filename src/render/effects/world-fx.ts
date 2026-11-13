/**
 * World VFX composition root: game feel on top of the sim, render-only.
 *
 * Owns the pooled particles and wires the feature modules to the hooks the
 * renderers, combat feedback and audio already expose:
 *
 *   CombatFx    weapon impacts, muzzle smoke, explosions, shake
 *   RemainsFx   falling bodies, toppling trees, collapsing buildings
 *   BuildingFx  chimneys, fire by damage, construction, placement thud
 *   EconomyFx   chips while gathering, drop-off pops
 *   AmbientFx   clouds, flocks, butterflies, weather, glints
 *   LifeFx      perched birds, leaves, wildlife, village life, voxel smoke
 *   CommandFx   red pulse on the enemy you ordered to attack
 *
 * Plus the team-colour silhouettes of units hidden behind trees/buildings.
 *
 * Everything runs on a game-time clock (paused match = frozen effects) and
 * uses render-local randomness only; nothing here writes sim state.
 */

import type { BuildingRenderer } from '../entities/building-renderer';
import type { ResourceRenderer } from '../entities/resource-renderer';
import type { UnitRenderer } from '../entities/unit-renderer';
import { UnitOcclusion } from '../entities/unit-occlusion';
import type { GameAudio } from '../game-audio';
import type { SceneContext } from '../scene-context';
import { AmbientFx } from './ambient-fx';
import { BuildingFx } from './building-fx';
import type { CombatFeedback } from './combat-feedback';
import { CombatFx } from './combat-fx';
import { CommandFx } from './command-fx';
import { EconomyFx } from './economy-fx';
import type { FxHost } from './fx-host';
import { FxParticles } from './fx-particles';
import { ensureFxTextures } from './fx-textures';
import { LifeFx } from './life-fx';
import { reducedMotion } from './motion-prefs';
import { RemainsFx } from './remains-fx';

export interface WorldFxDeps {
  units: UnitRenderer;
  buildings: BuildingRenderer;
  resources: ResourceRenderer;
  combat: CombatFeedback;
  audio: GameAudio;
}

/** Longest frame step fed to the effects (a background tab returning). */
const MAX_STEP_MS = 100;

export class WorldFx implements FxHost {
  readonly fx: FxParticles;
  time = 0;
  private readonly combat: CombatFx;
  private readonly remains: RemainsFx;
  private readonly buildingFx: BuildingFx;
  private readonly economy: EconomyFx;
  private readonly ambient: AmbientFx;
  private readonly life: LifeFx;
  private readonly commands: CommandFx;
  private shakeUntil = 0;
  private shakeLevel = 0;
  private needsReset = true;

  constructor(
    readonly ctx: SceneContext,
    deps: WorldFxDeps
  ) {
    ensureFxTextures(ctx.scene);
    this.fx = new FxParticles(ctx.scene, ctx.layers);
    this.combat = new CombatFx(this);
    this.remains = new RemainsFx(this);
    this.life = new LifeFx(this, deps.resources, deps.buildings);
    this.buildingFx = new BuildingFx(this, deps.buildings, deps.audio, this.life.smoke);
    this.economy = new EconomyFx(this, deps.units);
    this.ambient = new AmbientFx(this, deps.resources);
    this.commands = new CommandFx(this, deps.units);
    deps.units.setOcclusion(new UnitOcclusion(ctx, {
      buildingViews: () => deps.buildings.liveViews(),
      treeViewAt: (x, y) => deps.resources.treeViewAt(x, y),
    }));

    deps.combat.onEvent((event) => this.combat.onCombatEvent(event));
    deps.audio.onCue((cue) => this.combat.onCue(cue));
    deps.units.onDeath((death) => this.remains.unitDied(death));
    deps.buildings.onRemoved((removal) => this.remains.buildingRemoved(removal));
    deps.resources.onTreeFall((fall) => this.remains.treeFell(fall));
    deps.resources.onHit((hit) => {
      this.economy.onResourceHit(hit);
      this.life.onResourceHit(hit);
    });
  }

  /** Once per frame after the sim stepped and the renderers drew. `deltaMs` is real time. */
  update(deltaMs: number): void {
    const world = this.ctx.world;
    const dt = world.paused ? 0 : Math.min(MAX_STEP_MS, deltaMs) * this.ctx.gameSpeed;
    this.time += dt;
    this.refreshView();
    if (this.needsReset) {
      this.needsReset = false;
      this.ambient.reset();
      this.life.reset(this.ambient.climateNow);
    }
    this.combat.update();
    this.remains.update();
    this.buildingFx.update(dt);
    this.economy.update();
    this.ambient.update(dt);
    this.life.update(dt);
    this.commands.update();
    this.fx.update(dt);
  }

  /** New / loaded / multiplayer world: drop everything in flight. */
  clear(): void {
    this.fx.clear();
    this.combat.clear();
    this.remains.clear();
    this.buildingFx.clear();
    this.economy.clear();
    this.ambient.clear();
    this.life.clear();
    this.commands.clear();
    this.needsReset = true;
  }

  shake(x: number, y: number, intensity: number, durationMs: number): void {
    if (reducedMotion()) return;
    const v = this.fx.view;
    const cx = (v.left + v.right) / 2;
    const cy = (v.top + v.bottom) / 2;
    const reach = Math.max(200, (v.right - v.left) * 0.9);
    const k = 1 - Math.hypot(x - cx, (y - cy) * 1.4) / reach;
    if (k <= 0) return;
    const level = intensity * k;
    if (level < 0.0006) return;
    const now = this.ctx.scene.time.now;
    // A stronger shake replaces a weaker one; a weaker one never cuts it short.
    if (now < this.shakeUntil && level <= this.shakeLevel) return;
    this.shakeUntil = now + durationMs;
    this.shakeLevel = level;
    this.ctx.scene.cameras.main.shake(durationMs, level, true);
  }

  /** Debug / perf counters. */
  get stats(): {
    particles: Record<string, number>;
    remains: number;
    life: { forest: number; wild: number; village: number; smoke: number };
    time: number;
  } {
    return { particles: this.fx.counts, remains: this.remains.count, life: this.life.stats, time: Math.round(this.time) };
  }

  private refreshView(): void {
    const cam = this.ctx.scene.cameras.main;
    const view = cam.worldView;
    const root = this.ctx.layers.root;
    const v = this.fx.view;
    v.left = view.x - root.x;
    v.top = view.y - root.y;
    v.right = v.left + view.width;
    v.bottom = v.top + view.height;
  }
}
