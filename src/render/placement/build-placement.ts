/**
 * Placement modes: building placement (B + key, action grid) with its
 * footprint ghost, and the army rally point picker. Also draws the standing
 * army rally flag.
 *
 * The ghost is the footprint diamond on the ground layer plus, when a sprite
 * source is given, a translucent preview of the building itself on the
 * overlay layer (red-tinted where it cannot be placed).
 */

import { ISO, MAP } from '../../config';
import { Building, Position, Resource } from '@sim/components';
import { BUILDING_TABLE, BuildingDefId, type BuildingDef } from '@sim/defs';
import { isBuildingUnlocked } from '@sim/tech-tree';
import {
  buildingQuery,
  findResourceAt,
  getBuildingCost,
  resourceQuery,
  wallLineTiles,
  type SimWorld,
} from '@sim/world';
import { setLastEvent } from '../../debug/overlay';
import { ERROR as SFX_ERROR, PLACE_BUILDING } from '../audio/sound-map';
import type { PlayerCommands } from '../commands/player-commands';
import { countOwnedArmyProducers } from '../commands/economy';
import type { GameAudio } from '../game-audio';
import type { SceneContext } from '../scene-context';
import type { SpriteRef, SpriteSource } from '../sprites/sprite-source';
import { addLayerGraphics } from '../world-layers';
import { buildingAnchorTileForDef, isInsideMap, spriteAnchorPoint } from '../world-projection';

const GHOST_ALPHA = 0.6;
/** Multiplicative tints on the ghost sprite: green = can build here, red = can't. */
const GHOST_VALID_TINT = 0xa8f0a0;
const GHOST_INVALID_TINT = 0xff6b6b;

export type BuildMode =
  | 'none'
  | 'HOUSE'
  | 'FARM'
  | 'MILL'
  | 'LUMBER_CAMP'
  | 'GOLD_MINE'
  | 'STONE_QUARRY'
  | 'BARRACKS'
  | 'ARCHERY_RANGE'
  | 'STABLE'
  | 'FOUNDRY'
  | 'DEFENSIVE_TOWER'
  | 'WALL';

export const BUILD_MODE_TO_DEF: Record<Exclude<BuildMode, 'none'>, number> = {
  HOUSE: BuildingDefId.HOUSE,
  FARM: BuildingDefId.FARM,
  MILL: BuildingDefId.MILL,
  LUMBER_CAMP: BuildingDefId.LUMBER_CAMP,
  GOLD_MINE: BuildingDefId.GOLD_MINE,
  STONE_QUARRY: BuildingDefId.STONE_QUARRY,
  BARRACKS: BuildingDefId.BARRACKS,
  ARCHERY_RANGE: BuildingDefId.ARCHERY_RANGE,
  STABLE: BuildingDefId.STABLE,
  FOUNDRY: BuildingDefId.FOUNDRY,
  DEFENSIVE_TOWER: BuildingDefId.DEFENSIVE_TOWER,
  WALL: BuildingDefId.WALL,
};

export class BuildPlacement {
  mode: BuildMode = 'none';
  armyRallyMode = false;
  /** B was pressed; waiting for the building key. */
  awaitingBuildKind = false;
  private readonly ghost: Phaser.GameObjects.Graphics;
  private ghostSprite: Phaser.GameObjects.Sprite | null = null;
  private ghostRef: SpriteRef | null = null;
  /** WALL mode: first click of a line, waiting for the end tile. */
  private wallStart: { x: number; y: number } | null = null;
  /** The anchor was just pressed: releasing elsewhere finishes the line (drag). */
  private wallDragArmed = false;

  constructor(
    private readonly ctx: SceneContext,
    private readonly commands: PlayerCommands,
    private readonly audio: GameAudio,
    private readonly sprites: SpriteSource | null = null
  ) {
    this.ghost = addLayerGraphics(ctx.scene, ctx.layers.ground);
  }

  /** True while any placement-like mode is armed. */
  get isActive(): boolean {
    return this.mode !== 'none' || this.awaitingBuildKind || this.armyRallyMode;
  }

  /** HUD label for the current mode. */
  get label(): string {
    if (this.awaitingBuildKind) return 'waiting…';
    if (this.armyRallyMode) return 'army rally';
    return this.mode === 'none' ? '-' : this.mode.toLowerCase();
  }

  awaitBuildKind(): void {
    this.awaitingBuildKind = true;
    this.mode = 'none';
  }

  startBuildMode(mode: Exclude<BuildMode, 'none'>, message: string): void {
    const defId = BUILD_MODE_TO_DEF[mode];
    const def = BUILDING_TABLE[defId];
    this.awaitingBuildKind = false;
    this.armyRallyMode = false;
    if (!isBuildingUnlocked(this.ctx.world, this.ctx.perspectivePlayerId, defId)) {
      this.mode = 'none';
      setLastEvent(`${def?.name ?? mode} is locked`);
      return;
    }
    this.mode = mode;
    setLastEvent(message);
  }

  startArmyRallyMode(): void {
    if (countOwnedArmyProducers(this.ctx.world, this.ctx.perspectivePlayerId) === 0) {
      setLastEvent('army rally needs an army building');
      return;
    }
    this.mode = 'none';
    this.awaitingBuildKind = false;
    this.armyRallyMode = true;
    setLastEvent('army rally - click map');
  }

  /** Drop every mode (Esc, world reload). */
  reset(): void {
    this.mode = 'none';
    this.wallStart = null;
    this.wallDragArmed = false;
    this.armyRallyMode = false;
    this.awaitingBuildKind = false;
    this.clear();
  }

  /**
   * Route a pointer-down while a mode is armed. Returns true when the click
   * was consumed (placed, picked or cancelled).
   */
  handlePointerDown(pointer: Phaser.Input.Pointer, tx: number, ty: number): boolean {
    const playerId = this.ctx.perspectivePlayerId;
    if (this.armyRallyMode) {
      if (pointer.rightButtonDown()) {
        this.armyRallyMode = false;
        this.clear();
        setLastEvent('army rally cancelled');
        return true;
      }
      if (pointer.leftButtonDown()) {
        if (!isInsideMap(tx, ty)) {
          setLastEvent(`rally outside map (${tx},${ty})`);
          return true;
        }
        this.commands.dispatch({ type: 'setArmyRallyPoint', playerId, x: tx, y: ty });
        setLastEvent(`army rally → (${tx},${ty})`);
        this.armyRallyMode = false;
        this.clear();
        return true;
      }
    }

    if (this.mode !== 'none') {
      if (pointer.rightButtonDown()) {
        this.mode = 'none';
        this.wallStart = null;
        this.clear();
        setLastEvent('build mode cancelled');
        return true;
      }
      if (pointer.leftButtonDown() && this.mode === 'WALL') return this.handleWallClick(tx, ty);
      if (pointer.leftButtonDown()) {
        const defId = BUILD_MODE_TO_DEF[this.mode];
        if (!isBuildingUnlocked(this.ctx.world, playerId, defId)) {
          setLastEvent(`${BUILDING_TABLE[defId]?.name ?? this.mode} is locked`);
          this.audio.playUi(SFX_ERROR);
          this.mode = 'none';
          this.clear();
          return true;
        }
        this.commands.dispatch({ type: 'placeBuilding', defId, x: tx, y: ty, playerId });
        this.audio.playUi(PLACE_BUILDING);
        setLastEvent(`place ${this.mode} → (${tx},${ty})`);
        this.mode = 'none';
        this.clear();
        return true;
      }
    }
    return false;
  }

  /**
   * Pointer released. In WALL mode a drag from the anchor tile sends the line
   * on release; releasing on the anchor itself keeps the two-click flow.
   */
  handlePointerUp(tx: number, ty: number): boolean {
    if (this.mode !== 'WALL' || !this.wallStart || !this.wallDragArmed) return false;
    this.wallDragArmed = false;
    if (!isInsideMap(tx, ty) || (tx === this.wallStart.x && ty === this.wallStart.y)) return false;
    return this.handleWallClick(tx, ty);
  }

  /** WALL mode: the first click anchors the line, the second (or a drag release) sends it. */
  private handleWallClick(tx: number, ty: number): boolean {
    const playerId = this.ctx.perspectivePlayerId;
    if (!isInsideMap(tx, ty)) return true;
    if (!isBuildingUnlocked(this.ctx.world, playerId, BuildingDefId.WALL)) {
      setLastEvent('walls are locked');
      this.audio.playUi(SFX_ERROR);
      this.mode = 'none';
      this.wallStart = null;
      this.clear();
      return true;
    }
    if (!this.wallStart) {
      this.wallStart = { x: tx, y: ty };
      this.wallDragArmed = true;
      setLastEvent(`wall from (${tx},${ty}) - drag or click the end tile`);
      return true;
    }
    const { x: x0, y: y0 } = this.wallStart;
    this.commands.dispatch({ type: 'placeWallLine', playerId, x0, y0, x1: tx, y1: ty });
    this.audio.playUi(PLACE_BUILDING);
    setLastEvent(`wall (${x0},${y0}) to (${tx},${ty})`);
    this.mode = 'none';
    this.wallStart = null;
    this.clear();
    return true;
  }

  /** Standing rally flag + the ghost for whichever mode is armed. */
  draw(): void {
    const g = this.ghost;
    const world = this.ctx.world;
    const playerId = this.ctx.perspectivePlayerId;
    this.clear();
    const rally = world.armyRallyPoints[playerId];
    if (rally) this.drawRallyMarker(rally, 0x4ecdc4, 0.9);

    if (this.armyRallyMode) {
      const { tx, ty } = this.ctx.pointerTile(this.ctx.scene.input.activePointer);
      if (isInsideMap(tx, ty)) {
        const valid = world.map.walkability[ty][tx] === 0;
        this.drawRallyMarker({ x: tx, y: ty }, valid ? 0xfbc36b : 0xff4757, 0.95);
      }
      return;
    }
    if (this.mode === 'none') return;
    const { tx, ty } = this.ctx.pointerTile(this.ctx.scene.input.activePointer);
    if (!isInsideMap(tx, ty)) return;
    if (this.mode === 'WALL' && this.wallStart) {
      this.drawWallLineGhost(this.wallStart, { x: tx, y: ty });
      return;
    }

    const defId = BUILD_MODE_TO_DEF[this.mode];
    const def = BUILDING_TABLE[defId];
    if (!def) return;
    const anchor = buildingAnchorTileForDef(def, tx, ty);
    const c = this.ctx.tileToScreen(anchor.x, anchor.y);
    const w = (ISO.TILE_W / 2) * def.footprint.w;
    const h = (ISO.TILE_H / 2) * def.footprint.h;

    // Valid = unlocked, footprint free, affordable, and near its resource.
    const tileBlocked = isBuildFootprintBlocked(world, def, tx, ty);
    const nearResource =
      def.harvestKind === undefined ||
      def.requiresNearbyResource === false ||
      hasNearbyResource(world, tx, ty, def.harvestKind, def.harvestRadius ?? 6);
    const bank = world.resources[playerId];
    const cost = getBuildingCost(world, playerId, defId);
    const canAffordBuild =
      bank[0] >= cost.food &&
      bank[1] >= cost.wood &&
      bank[2] >= cost.gold &&
      bank[3] >= cost.stone;
    const unlocked = isBuildingUnlocked(world, playerId, defId);
    const valid = unlocked && !tileBlocked && canAffordBuild && nearResource;

    const preview = this.drawGhostSprite(defId, playerId, c, def.footprint.w, def.footprint.h, valid);
    g.fillStyle(valid ? def.color : 0xff4757, preview ? 0.22 : 0.4);
    g.beginPath();
    g.moveTo(c.x, c.y - h);
    g.lineTo(c.x + w, c.y);
    g.lineTo(c.x, c.y + h);
    g.lineTo(c.x - w, c.y);
    g.closePath();
    g.fillPath();
    g.lineStyle(2, valid ? 0xfeca57 : 0xff4757, 0.9);
    g.strokePath();
  }

  /** Footprint diamonds along the wall line; red where a tile cannot take a wall
   *  or the bank runs out (the sim skips or stops there the same way). */
  private drawWallLineGhost(from: { x: number; y: number }, to: { x: number; y: number }): void {
    const world = this.ctx.world;
    const playerId = this.ctx.perspectivePlayerId;
    const def = BUILDING_TABLE[BuildingDefId.WALL];
    if (!def) return;
    const cost = getBuildingCost(world, playerId, BuildingDefId.WALL);
    const bank = world.resources[playerId];
    let budget = Number.POSITIVE_INFINITY;
    for (const [k, need] of [[0, cost.food], [1, cost.wood], [2, cost.gold], [3, cost.stone]] as const) {
      if (need > 0) budget = Math.min(budget, Math.floor(bank[k] / need));
    }
    const g = this.ghost;
    const w = ISO.TILE_W / 2;
    const h = ISO.TILE_H / 2;
    for (const tile of wallLineTiles(from.x, from.y, to.x, to.y)) {
      const blocked = isBuildFootprintBlocked(world, def, tile.x, tile.y);
      const valid = !blocked && budget > 0;
      if (valid) budget--;
      const c = this.ctx.tileToScreen(tile.x, tile.y);
      g.fillStyle(valid ? def.color : 0xff4757, 0.4);
      g.beginPath();
      g.moveTo(c.x, c.y - h);
      g.lineTo(c.x + w, c.y);
      g.lineTo(c.x, c.y + h);
      g.lineTo(c.x - w, c.y);
      g.closePath();
      g.fillPath();
      g.lineStyle(1, valid ? 0xfeca57 : 0xff4757, 0.9);
      g.strokePath();
    }
  }

  clear(): void {
    this.ghost.clear();
    this.ghostSprite?.setVisible(false);
  }

  /** Translucent building preview; false when there is no sprite to show. */
  private drawGhostSprite(
    defId: number,
    playerId: number,
    c: { x: number; y: number },
    w: number,
    h: number,
    valid: boolean
  ): boolean {
    if (!this.sprites) return false;
    const age = this.ctx.world.ages[playerId]?.current ?? 0;
    const ref = this.sprites.building({ defId, age, playerId });
    if (!ref) return false;
    let sprite = this.ghostSprite;
    if (!sprite) {
      sprite = this.ctx.scene.add.sprite(0, 0, ref.texture, ref.frame);
      this.ctx.layers.overlay.add(sprite);
      this.ghostSprite = sprite;
    }
    if (ref !== this.ghostRef) {
      sprite.setTexture(ref.texture, ref.frame);
      sprite.setOrigin(ref.originX, ref.originY);
      sprite.setScale(ref.scale);
      this.ghostRef = ref;
    }
    const p = spriteAnchorPoint(ref.anchor, c, w, h);
    sprite.setPosition(p.x, p.y);
    sprite.setAlpha(GHOST_ALPHA);
    sprite.setTint(valid ? GHOST_VALID_TINT : GHOST_INVALID_TINT);
    sprite.setVisible(true);
    return true;
  }

  private drawRallyMarker(point: { x: number; y: number }, color: number, alpha: number): void {
    const g = this.ghost;
    const c = this.ctx.tileToScreen(point.x, point.y);
    g.lineStyle(2, color, alpha);
    g.strokeEllipse(c.x, c.y + 3, 30, 12);
    g.fillStyle(color, alpha * 0.22);
    g.fillEllipse(c.x, c.y + 3, 30, 12);
    g.lineStyle(2, color, alpha);
    g.lineBetween(c.x, c.y + 3, c.x, c.y - 24);
    g.fillStyle(color, alpha);
    g.fillTriangle(c.x + 1, c.y - 24, c.x + 17, c.y - 19, c.x + 1, c.y - 14);
  }
}

function isBuildFootprintBlocked(world: SimWorld, def: BuildingDef, x: number, y: number): boolean {
  const x0 = x - Math.floor(def.footprint.w / 2);
  const y0 = y - Math.floor(def.footprint.h / 2);
  for (let dy = 0; dy < def.footprint.h; dy++) {
    for (let dx = 0; dx < def.footprint.w; dx++) {
      const tx = x0 + dx;
      const ty = y0 + dy;
      if (tx < 0 || ty < 0 || tx >= MAP.WIDTH || ty >= MAP.HEIGHT) return true;
      if (world.map.walkability[ty][tx] !== 0) return true;
      if (findResourceAt(world, tx, ty, 0.6) !== null) return true;
      if (findBuildingNear(world, tx, ty, 0.01) !== null) return true;
    }
  }
  return false;
}

function hasNearbyResource(world: SimWorld, x: number, y: number, kind: number, radius: number): boolean {
  for (const eid of resourceQuery(world.ecs)) {
    if (Resource.kind[eid] !== kind) continue;
    if (Resource.amount[eid] <= 0) continue;
    if (Math.hypot(Position.x[eid] - x, Position.y[eid] - y) <= radius) return true;
  }
  return false;
}

/** Closest building whose footprint is within `radius` tiles of (x, y). */
function findBuildingNear(world: SimWorld, x: number, y: number, radius: number): number | null {
  let best: number | null = null;
  let bestDist = radius;
  for (const eid of buildingQuery(world.ecs)) {
    const d = distToBuildingFootprint(x, y, eid);
    if (d < bestDist) {
      bestDist = d;
      best = eid;
    }
  }
  return best;
}

function distToBuildingFootprint(x: number, y: number, eid: number): number {
  const def = BUILDING_TABLE[Building.defId[eid]];
  if (!def) return Math.hypot(Position.x[eid] - x, Position.y[eid] - y);
  const x0 = Math.round(Position.x[eid]) - Math.floor(def.footprint.w / 2);
  const y0 = Math.round(Position.y[eid]) - Math.floor(def.footprint.h / 2);
  const minX = x0 - 0.5;
  const maxX = x0 + def.footprint.w - 0.5;
  const minY = y0 - 0.5;
  const maxY = y0 + def.footprint.h - 0.5;
  const dx = x < minX ? minX - x : x > maxX ? x - maxX : 0;
  const dy = y < minY ? minY - y : y > maxY ? y - maxY : 0;
  return Math.hypot(dx, dy);
}
