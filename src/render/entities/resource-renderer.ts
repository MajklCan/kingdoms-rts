/**
 * Gaia props: harvestable resources (trees, berries, gold, stone), stumps
 * left by felled trees, and static map features (rock spires, linden trees).
 * All stay drawn once explored; outside current vision they are tinted with
 * the fog dim instead of being covered.
 *
 * Looks are render-only and deterministic: tree species from a tile hash
 * (conifers favour forest tiles), pile looks from the remaining amount.
 */

import { MAP, SIM } from '../../config';
import { Position, Resource, ResourceKindId } from '@sim/components';
import { CampaignMissionId } from '@sim/campaign';
import { MapFeatureKind, TileType, type MapFeature } from '@sim/map-gen';
import { resourceQuery } from '@sim/world';
import type { ScreenPos } from '../iso';
import { FOG_DIM_TINT } from '../overlays/fog-style';
import type { SceneContext } from '../scene-context';
import type { SpriteSource } from '../sprites/sprite-source';
import { tileHash01 } from '../tile-hash';
import { spriteAnchorPoint } from '../world-projection';
import type { Occupancy } from './occupancy';
import { SpriteSync } from './sprite-sync';

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

  constructor(
    private readonly ctx: SceneContext,
    private readonly sprites: SpriteSource,
    private readonly occupancy: Occupancy
  ) {
    this.resources = new SpriteSync(ctx.scene, ctx.layers, (eid) => this.fullAmount.delete(eid));
    this.features = new SpriteSync(ctx.scene, ctx.layers);
    this.stumpViews = new SpriteSync(ctx.scene, ctx.layers);
  }

  drawMapFeatures(): void {
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
      view.setTintOrClear(this.isFeatureVisible(feature) ? null : FOG_DIM_TINT);
    }
    this.features.end();
  }

  drawResources(): void {
    const world = this.ctx.world;
    this.resources.begin();
    this.treesSeen.clear();
    for (const eid of resourceQuery(world.ecs)) {
      // An emptied node is gone for the player (the sim may drop it a tick later).
      if (Resource.amount[eid] <= 0) continue;
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
      view.setTintOrClear(this.ctx.isTileVisible(Math.round(x), Math.round(y)) ? null : FOG_DIM_TINT);
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

/** Footprint size in tiles: rock spires cover 2x2 or 4x4, everything else one tile. */
function featureSize(feature: MapFeature): number {
  return feature.kind === MapFeatureKind.ROCK_SPIRE ? Math.max(2, feature.size ?? 2) : 1;
}
