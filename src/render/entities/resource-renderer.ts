/**
 * Gaia props: harvestable resources (trees, berries, gold, stone), stumps
 * left by felled trees, and static map features (rock spires, linden trees).
 * All stay drawn once explored; outside current vision they are tinted with
 * the fog dim instead of being covered.
 *
 * Looks are render-only and deterministic: tree species from a tile hash
 * (conifers favour forest tiles), pile looks from the remaining amount.
 *
 * Life on top of that, all render-only: trees in view sway gently with a
 * stable per-tile phase, a tree shakes when it is chopped (its amount drops),
 * and listeners hear about every hit on a pile and every tree that falls, so
 * the VFX layer can throw chips and topple the trunk.
 */

import { entityExists } from 'bitecs';
import { MAP, SIM } from '../../config';
import { Position, Resource, ResourceKindId } from '@sim/components';
import { CampaignMissionId } from '@sim/campaign';
import { MapFeatureKind, TileType, type MapFeature } from '@sim/map-gen';
import { resourceQuery } from '@sim/world';
import { reducedMotion } from '../effects/motion-prefs';
import type { ScreenPos } from '../iso';
import { FOG_DIM_TINT } from '../overlays/fog-style';
import type { SceneContext } from '../scene-context';
import type { SpriteSource } from '../sprites/sprite-source';
import { tileHash01 } from '../tile-hash';
import { spriteAnchorPoint } from '../world-projection';
import type { Occupancy } from './occupancy';
import { SpriteSync } from './sprite-sync';
import type { SpriteSnapshot, SpriteView } from './sprite-view';

/** A visible pile lost some of its amount this frame (someone is working it). */
export interface ResourceHit {
  eid: number;
  kind: number;
  /** Tile. */
  x: number;
  y: number;
  /** Screen anchor and the screen y of the top of the art. */
  screen: ScreenPos;
  top: number;
}

/** A visible tree was cut down. */
export interface TreeFall {
  x: number;
  y: number;
  conifer: boolean;
  sprite: SpriteSnapshot;
}

/** Tree sway: rad amplitude (broadleaf / conifer) and period range, ms. */
const SWAY_BROADLEAF = 0.016;
const SWAY_CONIFER = 0.009;
const SWAY_PERIOD_MS = 4200;
/** Chop shake: rad amplitude, length, wobble frequency. */
const SHAKE_RAD = 0.05;
const SHAKE_MS = 420;
const SHAKE_HZ = 11;

const SNOW_TILES: ReadonlySet<number> = new Set([
  TileType.SNOW,
  TileType.SNOW_FOREST,
  TileType.PACKED_SNOW,
  TileType.ICE,
]);
const FOREST_TILES: ReadonlySet<number> = new Set([TileType.FOREST, TileType.SNOW_FOREST]);

/** Typical starting amounts; a pile first seen bigger than this uses its own size. */
const NOMINAL_AMOUNT: Readonly<Record<number, number>> = {
  [ResourceKindId.FOOD]: 150,
  [ResourceKindId.WOOD]: 100,
  [ResourceKindId.GOLD]: 650,
  [ResourceKindId.STONE]: 600,
};

/** Stumps fade after a few minutes so a long game does not pile them up. */
const STUMP_TICKS = SIM.TICK_HZ * 240;

interface Stump {
  x: number;
  y: number;
  conifer: boolean;
  expiresTick: number;
}

export class ResourceRenderer {
  private readonly resources: SpriteSync<number>;
  private readonly features: SpriteSync<string>;
  private readonly stumpViews: SpriteSync<number>;
  /** eid -> largest amount seen, the "full" size of the pile. */
  private readonly fullAmount = new Map<number, number>();
  /** Live trees last frame: eid -> tile + species group. */
  private readonly trees = new Map<number, { x: number; y: number; conifer: boolean }>();
  private readonly treesSeen = new Set<number>();
  /** Tile index -> stump. */
  private readonly stumps = new Map<number, Stump>();
  /** Tile index -> tree eid drawn there this frame (occlusion lookups). */
  private readonly treeByTile = new Map<number, number>();
  /** eid -> amount last frame (hit detection). */
  private readonly lastAmount = new Map<number, number>();
  /** eid -> scene time (ms) of the last chop, for the shake. */
  private readonly shakeAt = new Map<number, number>();
  private readonly hitListeners: Array<(hit: ResourceHit) => void> = [];
  private readonly fallListeners: Array<(fall: TreeFall) => void> = [];
  /** Gold piles drawn and visible this frame (glints). */
  readonly goldInView: ScreenPos[] = [];
  private goldCount = 0;

  constructor(
    private readonly ctx: SceneContext,
    private readonly sprites: SpriteSource,
    private readonly occupancy: Occupancy
  ) {
    this.resources = new SpriteSync(
      ctx.scene,
      ctx.layers,
      (eid) => {
        this.fullAmount.delete(eid);
        this.lastAmount.delete(eid);
        this.shakeAt.delete(eid);
      },
      (eid, view) => this.noticeRemoval(eid, view)
    );
    this.features = new SpriteSync(ctx.scene, ctx.layers);
    this.stumpViews = new SpriteSync(ctx.scene, ctx.layers);
  }

  /** Called for every visible pile that lost amount this frame. */
  onHit(listener: (hit: ResourceHit) => void): void {
    this.hitListeners.push(listener);
  }

  /** Called when a visible tree is cut down (before its stump appears). */
  onTreeFall(listener: (fall: TreeFall) => void): void {
    this.fallListeners.push(listener);
  }

  /** Tree drawn on a tile this frame. */
  treeViewAt(tileX: number, tileY: number): SpriteView | undefined {
    if (tileX < 0 || tileY < 0 || tileX >= MAP.WIDTH || tileY >= MAP.HEIGHT) return undefined;
    const eid = this.treeByTile.get(tileY * MAP.WIDTH + tileX);
    return eid === undefined ? undefined : this.resources.get(eid);
  }

  /** Live trees by eid (tile + species group), for the ambient life. */
  get liveTrees(): ReadonlyMap<number, { readonly x: number; readonly y: number; readonly conifer: boolean }> {
    return this.trees;
  }

  /** Number of valid entries at the front of {@link goldInView}. */
  get goldInViewCount(): number {
    return this.goldCount;
  }

  drawMapFeatures(): void {
    const now = this.ctx.scene.time.now;
    const sway = !reducedMotion();
    this.features.begin();
    for (const feature of this.ctx.world.map.features) {
      if (!this.isFeatureExplored(feature)) continue;
      const size = featureSize(feature);
      const ref = this.sprites.mapFeature({ kind: feature.kind, size, x: feature.x, y: feature.y });
      if (!ref) continue;
      const id = `${feature.kind}:${feature.x},${feature.y}:${feature.size ?? 1}`;
      const c = this.featureScreenPosition(feature);
      // Footprint-anchored art sits on the bottom corner of the whole footprint.
      const p = spriteAnchorPoint(ref.anchor, c, size, size);
      const view = this.features.show(id, ref, p.x, p.y);
      view.setDepth(c.y - 1);
      const visible = this.isFeatureVisible(feature);
      view.setTintOrClear(visible ? null : FOG_DIM_TINT);
      if (ref.poses) {
        // The linden landmark sways like the trees (slower, it is big).
        const lean = visible && sway ? this.swayLean(feature.x, feature.y, now * 0.7, SWAY_BROADLEAF) : 0;
        applyLean(view, ref.poses, lean, SWAY_BROADLEAF);
      }
    }
    this.features.end();
  }

  drawResources(): void {
    const world = this.ctx.world;
    const now = this.ctx.scene.time.now;
    const sway = !reducedMotion();
    this.resources.begin();
    this.treesSeen.clear();
    this.treeByTile.clear();
    this.goldCount = 0;
    for (const eid of resourceQuery(world.ecs)) {
      // An emptied node is gone for the player (the sim may drop it a tick later).
      const amount = Resource.amount[eid];
      if (amount <= 0) continue;
      const kind = Resource.kind[eid];
      const x = Position.x[eid];
      const y = Position.y[eid];
      const conifer = kind === ResourceKindId.WOOD && this.isConiferTile(x, y);
      if (kind === ResourceKindId.WOOD) {
        this.treesSeen.add(eid);
        this.trees.set(eid, { x, y, conifer });
        this.stumps.delete(tileIndex(x, y));
      }
      if (!this.ctx.isResourceExplored(eid)) continue;
      const ref = this.sprites.resource({
        kind,
        variant: this.resourceVariant(x, y, kind, conifer),
        x,
        y,
        remaining: this.remaining(eid, kind),
      });
      if (!ref) continue;
      const c = this.ctx.tileToScreen(x, y);
      const p = spriteAnchorPoint(ref.anchor, c);
      const view = this.resources.show(eid, ref, p.x, p.y);
      view.setDepth(c.y);
      const visible = this.ctx.isTileVisible(Math.round(x), Math.round(y));
      view.setTintOrClear(visible ? null : FOG_DIM_TINT);

      const last = this.lastAmount.get(eid);
      if (last !== amount) {
        this.lastAmount.set(eid, amount);
        if (last !== undefined && amount < last && visible) this.hit(eid, kind, x, y, c, c.y - ref.top, now);
      }
      if (kind === ResourceKindId.WOOD) {
        this.treeByTile.set(tileIndex(x, y), eid);
        const lean = visible ? this.treeLean(eid, x, y, conifer, now, sway) : 0;
        applyLean(view, ref.poses, lean, conifer ? SWAY_CONIFER : SWAY_BROADLEAF);
      } else if (kind === ResourceKindId.GOLD && visible) {
        this.noteGold(c.x, c.y - ref.top * 0.45);
      }
    }
    this.resources.end();
    this.collectFelledTrees();
    this.drawStumps();
  }

  get counts(): { resources: number; features: number; stumps: number; atlas: number } {
    return {
      resources: this.resources.size,
      features: this.features.size,
      stumps: this.stumpViews.size,
      atlas: this.resources.countBySource('atlas') + this.features.countBySource('atlas') +
        this.stumpViews.countBySource('atlas'),
    };
  }

  clear(): void {
    this.resources.clear();
    this.features.clear();
    this.stumpViews.clear();
    this.fullAmount.clear();
    this.trees.clear();
    this.stumps.clear();
    this.treeByTile.clear();
    this.lastAmount.clear();
    this.shakeAt.clear();
    this.goldCount = 0;
  }

  // ── Life: sway, chop shake, hits, falls ─────────────────────────────────

  /** Sway (stable per-tile phase, slow gusts) plus the decaying chop shake. */
  private treeLean(eid: number, x: number, y: number, conifer: boolean, now: number, sway: boolean): number {
    let lean = sway ? this.swayLean(x, y, now, conifer ? SWAY_CONIFER : SWAY_BROADLEAF) : 0;
    const at = this.shakeAt.get(eid);
    if (at !== undefined) {
      const age = now - at;
      if (age >= SHAKE_MS) {
        this.shakeAt.delete(eid);
      } else {
        const k = 1 - age / SHAKE_MS;
        lean += Math.sin((age / 1000) * SHAKE_HZ * Math.PI * 2) * SHAKE_RAD * k * k;
      }
    }
    return lean;
  }

  /** Wind lean (rad): stable per-tile phase, gusts rolling in from the left. */
  private swayLean(x: number, y: number, now: number, amplitude: number): number {
    const phase = tileHash01(Math.round(x), Math.round(y), 0x5a7) * Math.PI * 2;
    const period = SWAY_PERIOD_MS * (0.8 + tileHash01(Math.round(x), Math.round(y), 0x9e1) * 0.5);
    const gust = 0.65 + 0.35 * Math.sin(now / 2600 - (x - y) * 0.09);
    return Math.sin((now / period) * Math.PI * 2 + phase) * amplitude * gust;
  }

  private hit(eid: number, kind: number, x: number, y: number, screen: ScreenPos, top: number, now: number): void {
    if (kind === ResourceKindId.WOOD) this.shakeAt.set(eid, now);
    if (this.hitListeners.length === 0) return;
    const hit: ResourceHit = { eid, kind, x, y, screen, top };
    for (const listener of this.hitListeners) listener(hit);
  }

  private noteGold(x: number, y: number): void {
    const spot = this.goldInView[this.goldCount];
    if (spot) {
      spot.x = x;
      spot.y = y;
    } else {
      this.goldInView.push({ x, y });
    }
    this.goldCount++;
  }

  /** A drawn resource is dropped: a visible tree that is gone fell. */
  private noticeRemoval(eid: number, view: SpriteView): void {
    const tree = this.trees.get(eid);
    if (!tree || this.fallListeners.length === 0) return;
    const ecs = this.ctx.world.ecs;
    if (entityExists(ecs, eid) && Resource.amount[eid] > 0) return;
    if (!this.ctx.isTileVisible(Math.round(tree.x), Math.round(tree.y))) return;
    const fall: TreeFall = { x: tree.x, y: tree.y, conifer: tree.conifer, sprite: view.snapshot() };
    for (const listener of this.fallListeners) listener(fall);
  }

  /** Trees that vanished since last frame leave a stump on their tile. */
  private collectFelledTrees(): void {
    for (const [eid, tree] of this.trees) {
      if (this.treesSeen.has(eid)) continue;
      this.trees.delete(eid);
      this.stumps.set(tileIndex(tree.x, tree.y), {
        x: Math.round(tree.x),
        y: Math.round(tree.y),
        conifer: tree.conifer,
        expiresTick: this.ctx.world.tick + STUMP_TICKS,
      });
    }
  }

  private drawStumps(): void {
    const tick = this.ctx.world.tick;
    this.stumpViews.begin();
    for (const [index, stump] of this.stumps) {
      if (tick >= stump.expiresTick || this.occupancy.hasBuilding(stump.x, stump.y)) {
        this.stumps.delete(index);
        continue;
      }
      if (!this.ctx.isTileExplored(stump.x, stump.y)) continue;
      const ref = this.sprites.stump(stump.conifer);
      if (!ref) continue;
      const c = this.ctx.tileToScreen(stump.x, stump.y);
      const p = spriteAnchorPoint(ref.anchor, c);
      const view = this.stumpViews.show(index, ref, p.x, p.y);
      view.setDepth(c.y - 8);
      view.setTintOrClear(this.ctx.isTileVisible(stump.x, stump.y) ? null : FOG_DIM_TINT);
    }
    this.stumpViews.end();
  }

  /** Remaining fraction of the pile, against the biggest amount it ever had. */
  private remaining(eid: number, kind: number): number {
    const amount = Resource.amount[eid];
    const full = Math.max(this.fullAmount.get(eid) ?? 0, NOMINAL_AMOUNT[kind] ?? 1, amount);
    this.fullAmount.set(eid, full);
    return full > 0 ? amount / full : 0;
  }

  /** Dead trees on the Zborov battlefield, snowy ones on snow, else the species group. */
  private resourceVariant(x: number, y: number, kind: number, conifer: boolean): string | undefined {
    if (kind !== ResourceKindId.WOOD) return undefined;
    if (this.ctx.world.campaign?.missionId === CampaignMissionId.BATTLE_OF_ZBOROV) return 'dead';
    if (SNOW_TILES.has(this.tileAt(x, y))) return 'snow';
    return conifer ? 'conifer' : 'broadleaf';
  }

  /** Forest tiles are mostly spruce and pine, open ground mostly broadleaf. */
  private isConiferTile(x: number, y: number): boolean {
    const share = FOREST_TILES.has(this.tileAt(x, y)) ? 0.72 : 0.3;
    return tileHash01(Math.round(x), Math.round(y), 0xc0f) < share;
  }

  private tileAt(x: number, y: number): number {
    const tx = Math.round(x);
    const ty = Math.round(y);
    if (tx < 0 || ty < 0 || tx >= MAP.WIDTH || ty >= MAP.HEIGHT) return TileType.GRASS;
    return this.ctx.world.map.tiles[ty * MAP.WIDTH + tx];
  }

  private featureScreenPosition(feature: MapFeature): ScreenPos {
    if (feature.kind !== MapFeatureKind.ROCK_SPIRE) {
      return this.ctx.tileToScreen(feature.x, feature.y);
    }
    const size = featureSize(feature);
    return this.ctx.tileToScreen(feature.x + (size - 1) / 2, feature.y + (size - 1) / 2);
  }

  private isFeatureExplored(feature: MapFeature): boolean {
    return this.someFeatureTile(feature, (x, y) => this.ctx.isTileExplored(x, y));
  }

  private isFeatureVisible(feature: MapFeature): boolean {
    return this.someFeatureTile(feature, (x, y) => this.ctx.isTileVisible(x, y));
  }

  private someFeatureTile(feature: MapFeature, test: (x: number, y: number) => boolean): boolean {
    const size = featureSize(feature);
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        if (test(feature.x + dx, feature.y + dy)) return true;
      }
    }
    return false;
  }
}

function tileIndex(x: number, y: number): number {
  return Math.round(y) * MAP.WIDTH + Math.round(x);
}

/** Lean past this share of the sway amplitude shows the bent pose frame. */
const POSE_THRESHOLD = 0.55;

/**
 * Show a lean: pixel art swaps to its pre-rendered bent frames (rotation
 * would smear the pixels), other art rotates.
 */
function applyLean(
  view: SpriteView,
  poses: Readonly<Record<string, string>> | undefined,
  lean: number,
  amplitude: number
): void {
  const sprite = view.sprite;
  if (!poses) {
    sprite.rotation = lean;
    return;
  }
  if (sprite.rotation !== 0) sprite.rotation = 0;
  const s = lean / amplitude;
  const pose = s > POSE_THRESHOLD ? poses.swayr : s < -POSE_THRESHOLD ? poses.swayl : undefined;
  const frame = pose ?? view.ref.frame;
  if (frame !== undefined && sprite.frame.name !== frame) sprite.setFrame(frame);
}

/** Footprint size in tiles: rock spires cover 2x2 or 4x4, everything else one tile. */
function featureSize(feature: MapFeature): number {
  return feature.kind === MapFeatureKind.ROCK_SPIRE ? Math.max(2, feature.size ?? 2) : 1;
}
