/**
 * Placement modes: building placement (B + key, action grid) with its
 * footprint ghost, and the army rally point picker. Also draws the standing
 * army rally flag.
 *
 * The ghost is the footprint diamond on the ground layer plus, when a sprite
 * source is given, a translucent preview of the building itself on the
 * overlay layer (red-tinted where it cannot be placed).
 *
 * Mouse: the ghost follows the cursor and a click places. Touch (the
 * "confirm" flow): the ghost starts at the view centre, follows the finger
 * while it drags, stays where it is released and only an on-screen Confirm
 * places it; a wall line is dragged from its start tile to its end tile.
 */

import { ISO } from '../../config';
import { Resource } from '@sim/components';
import { BUILDING_TABLE, BuildingDefId } from '@sim/defs';
import { isBuildingUnlocked } from '@sim/tech-tree';
import { buildingEraFor, findResourceAt, getBuildingCost, isPlacementInSight, wallLineTiles } from '@sim/world';
import { setLastEvent } from '../../debug/overlay';
import { ERROR as SFX_ERROR, PLACE_BUILDING } from '../audio/sound-map';
import { NO_BUILDER_FAILURE, type PlayerCommands } from '../commands/player-commands';
import { countOwnedArmyProducers } from '../commands/economy';
import type { GameAudio } from '../game-audio';
import type { SceneContext } from '../scene-context';
import type { SpriteRef, SpriteSource } from '../sprites/sprite-source';
import { addLayerGraphics } from '../world-layers';
import { buildingAnchorTileForDef, isInsideMap, spriteAnchorPoint } from '../world-projection';
import { hasNearbyResource, isBuildFootprintBlocked } from './placement-rules';

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

interface Tile {
  x: number;
  y: number;
}

/** What the touch Confirm / Cancel bar needs to show. */
export interface TouchPlacementState {
  kind: 'none' | 'building' | 'wall' | 'rally';
  /** A ghost (or wall line) is down and Confirm would send it. */
  canConfirm: boolean;
  /** The ghost reads green (the sim is expected to accept it). */
  valid: boolean;
  label: string;
}

export class BuildPlacement {
  mode: BuildMode = 'none';
  armyRallyMode = false;
  /** Picking where the selected town centers' new villagers go. */
  villagerRallyMode = false;
  /** B was pressed; waiting for the building key. */
  awaitingBuildKind = false;
  /** Touch confirm flow: the ghost stays put until Confirm (set by the touch UI mode). */
  confirmFlow = false;
  private readonly ghost: Phaser.GameObjects.Graphics;
  /** Villager rally flags: above the art, so a flag on a tree reads over its crown. */
  private readonly flags: Phaser.GameObjects.Graphics;
  private ghostSprite: Phaser.GameObjects.Sprite | null = null;
  private ghostRef: SpriteRef | null = null;
  /** WALL mode: first click of a line, waiting for the end tile. */
  private wallStart: Tile | null = null;
  /** The anchor was just pressed: releasing elsewhere finishes the line (drag). */
  private wallDragArmed = false;
  /** Confirm flow: where the ghost (or the wall line's end) sits. */
  private touchTile: Tile | null = null;
  private lastValid = false;

  constructor(
    private readonly ctx: SceneContext,
    private readonly commands: PlayerCommands,
    private readonly audio: GameAudio,
    private readonly sprites: SpriteSource | null = null
  ) {
    this.ghost = addLayerGraphics(ctx.scene, ctx.layers.ground);
    this.flags = addLayerGraphics(ctx.scene, ctx.layers.overlay);
  }

  /** True while any placement-like mode is armed. */
  get isActive(): boolean {
    return this.mode !== 'none' || this.awaitingBuildKind || this.anyRallyMode;
  }

  /** Either rally pick is armed (army or villager). */
  get anyRallyMode(): boolean {
    return this.armyRallyMode || this.villagerRallyMode;
  }

  /** HUD label for the current mode. */
  get label(): string {
    if (this.awaitingBuildKind) return 'waiting…';
    if (this.armyRallyMode) return 'army rally';
    if (this.villagerRallyMode) return 'villager rally';
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
    this.villagerRallyMode = false;
    this.wallStart = null;
    this.touchTile = null;
    const noBuilder = this.commands.builderFailure();
    if (noBuilder) {
      this.mode = 'none';
      this.commands.fail(noBuilder);
      return;
    }
    if (!isBuildingUnlocked(this.ctx.world, this.ctx.perspectivePlayerId, defId)) {
      this.mode = 'none';
      setLastEvent(`${def?.name ?? mode} is locked`);
      return;
    }
    if (defId === BuildingDefId.HOUSE) {
      const failure = this.commands.houseStartFailure();
      if (failure) {
        this.mode = 'none';
        this.commands.fail(failure);
        return;
      }
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
    this.villagerRallyMode = false;
    this.armyRallyMode = true;
    setLastEvent('army rally - click map');
  }

  /** Town center selected: the next click or tap sets where its new villagers go. */
  startVillagerRallyMode(): void {
    if (this.commands.selectedTownCenters().length === 0) {
      this.commands.fail({ reason: 'unavailable', text: 'Select your town center first' });
      return;
    }
    this.mode = 'none';
    this.awaitingBuildKind = false;
    this.armyRallyMode = false;
    this.villagerRallyMode = true;
    setLastEvent('villager rally - click a resource or the ground');
  }

  /** Drop every mode (Esc, world reload). */
  reset(): void {
    this.mode = 'none';
    this.wallStart = null;
    this.wallDragArmed = false;
    this.touchTile = null;
    this.armyRallyMode = false;
    this.villagerRallyMode = false;
    this.awaitingBuildKind = false;
    this.clear();
  }

  /**
   * Route a pointer-down while a mode is armed. Returns true when the click
   * was consumed (placed, picked or cancelled).
   */
  handlePointerDown(pointer: Phaser.Input.Pointer, tx: number, ty: number): boolean {
    if (this.armyRallyMode) {
      if (pointer.rightButtonDown()) {
        this.armyRallyMode = false;
        this.clear();
        setLastEvent('army rally cancelled');
        return true;
      }
      if (pointer.leftButtonDown()) return this.rallyAt(tx, ty);
    }
    if (this.villagerRallyMode) {
      if (pointer.rightButtonDown()) {
        this.villagerRallyMode = false;
        this.clear();
        setLastEvent('villager rally cancelled');
        return true;
      }
      if (pointer.leftButtonDown()) return this.villagerRallyAt(tx, ty, pointer.worldX, pointer.worldY);
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
        this.placeBuildingAt(tx, ty);
        return true;
      }
    }
    return false;
  }

  /** Army rally pick: set the point (when inside the map) and leave the mode. */
  rallyAt(tx: number, ty: number): boolean {
    if (!isInsideMap(tx, ty)) {
      setLastEvent(`rally outside map (${tx},${ty})`);
      return true;
    }
    this.commands.dispatch({ type: 'setArmyRallyPoint', playerId: this.ctx.perspectivePlayerId, x: tx, y: ty });
    setLastEvent(`army rally → (${tx},${ty})`);
    this.armyRallyMode = false;
    this.clear();
    return true;
  }

  /**
   * Villager rally pick at a tile: the explored resource under the point
   * (camera-world wx/wy) or on the tile, else the ground. Leaves the mode.
   */
  villagerRallyAt(tx: number, ty: number, wx?: number, wy?: number): boolean {
    this.villagerRallyMode = false;
    this.clear();
    if (!isInsideMap(tx, ty)) {
      this.commands.fail({ reason: 'unavailable', text: 'Pick a spot on the map' });
      return true;
    }
    const resource = this.villagerRallyResourceAt(tx, ty, wx, wy);
    this.commands.setVillagerRallyAt(tx, ty, resource);
    return true;
  }

  /** The explored resource a villager rally click lands on, or null. */
  villagerRallyResourceAt(tx: number, ty: number, wx?: number, wy?: number): number | null {
    const world = this.ctx.world;
    let eid: number | null = null;
    if (wx !== undefined && wy !== undefined) {
      const { tileX, tileY } = this.ctx.pickTile(wx, wy);
      eid = findResourceAt(world, tileX, tileY, 0.7);
    }
    eid ??= findResourceAt(world, tx, ty, 0.7);
    if (eid === null || Resource.amount[eid] <= 0) return null;
    return this.ctx.isResourceExplored(eid) ? eid : null;
  }

  private placeBuildingAt(tx: number, ty: number): void {
    if (this.mode === 'none' || this.mode === 'WALL') return;
    const playerId = this.ctx.perspectivePlayerId;
    const defId = BUILD_MODE_TO_DEF[this.mode];
    if (!isBuildingUnlocked(this.ctx.world, playerId, defId)) {
      setLastEvent(`${BUILDING_TABLE[defId]?.name ?? this.mode} is locked`);
      this.audio.playUi(SFX_ERROR);
      this.reset();
      return;
    }
    const eids = this.commands.selectedBuilderEids();
    if (eids.length === 0) {
      this.commands.fail(NO_BUILDER_FAILURE);
      this.reset();
      return;
    }
    this.commands.dispatch({ type: 'placeBuilding', defId, x: tx, y: ty, playerId, eids });
    this.audio.playUi(PLACE_BUILDING);
    setLastEvent(`place ${this.mode} → (${tx},${ty})`);
    this.reset();
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
    if (!isInsideMap(tx, ty)) return true;
    if (!this.wallsUnlocked()) return true;
    if (!this.wallStart) {
      this.wallStart = { x: tx, y: ty };
      this.wallDragArmed = true;
      setLastEvent(`wall from (${tx},${ty}) - drag or click the end tile`);
      return true;
    }
    this.placeWallLine(this.wallStart, { x: tx, y: ty });
    return true;
  }

  private wallsUnlocked(): boolean {
    if (isBuildingUnlocked(this.ctx.world, this.ctx.perspectivePlayerId, BuildingDefId.WALL)) return true;
    setLastEvent('walls are locked');
    this.audio.playUi(SFX_ERROR);
    this.reset();
    return false;
  }

  private placeWallLine(from: Tile, to: Tile): void {
    const playerId = this.ctx.perspectivePlayerId;
    const eids = this.commands.selectedBuilderEids();
    if (eids.length === 0) {
      this.commands.fail(NO_BUILDER_FAILURE);
      this.reset();
      return;
    }
    this.commands.dispatch({ type: 'placeWallLine', playerId, x0: from.x, y0: from.y, x1: to.x, y1: to.y, eids });
    this.audio.playUi(PLACE_BUILDING);
    setLastEvent(`wall (${from.x},${from.y}) to (${to.x},${to.y})`);
    this.reset();
  }

  /** A tap outside the confirm flow: place (or anchor the wall line) right away, like a click. */
  clickPlace(tx: number, ty: number): void {
    if (this.armyRallyMode) {
      this.rallyAt(tx, ty);
      return;
    }
    if (this.villagerRallyMode) {
      this.villagerRallyAt(tx, ty);
      return;
    }
    if (this.mode === 'WALL') {
      this.handleWallClick(tx, ty);
      return;
    }
    if (this.mode === 'none') return;
    const failure = this.commands.placementFailure(BUILD_MODE_TO_DEF[this.mode], tx, ty);
    if (failure) {
      this.commands.fail(failure);
      return;
    }
    this.placeBuildingAt(tx, ty);
  }

  // ── Touch confirm flow ────────────────────────────────────────────────────

  /** Put the ghost (or the wall line's end) on a tile; a drag calls this every move. */
  setTouchGhost(tx: number, ty: number, wallStart?: Tile): void {
    if (this.mode === 'none' || !isInsideMap(tx, ty)) return;
    if (this.mode === 'WALL' && wallStart && isInsideMap(wallStart.x, wallStart.y)) this.wallStart = { ...wallStart };
    else if (this.mode === 'WALL' && !this.wallStart) this.wallStart = { x: tx, y: ty };
    this.touchTile = { x: tx, y: ty };
  }

  /** Confirm: place at the ghost. A refusal keeps the mode armed and says why. */
  confirmTouch(): boolean {
    const tile = this.touchTile;
    if (this.mode === 'none' || !tile) return false;
    if (this.mode === 'WALL') {
      if (!this.wallsUnlocked()) return false;
      this.placeWallLine(this.wallStart ?? tile, tile);
      return true;
    }
    const failure = this.commands.placementFailure(BUILD_MODE_TO_DEF[this.mode], tile.x, tile.y);
    if (failure) {
      this.commands.fail(failure);
      return false;
    }
    this.placeBuildingAt(tile.x, tile.y);
    return true;
  }

  /** Cancel (touch bar, Esc): drop whatever mode is armed. */
  cancel(): void {
    if (!this.isActive) return;
    this.reset();
    setLastEvent('placement cancelled');
  }

  touchState(): TouchPlacementState {
    if (this.armyRallyMode) return { kind: 'rally', canConfirm: false, valid: true, label: 'Tap the map to set the rally point' };
    if (this.villagerRallyMode) return { kind: 'rally', canConfirm: false, valid: true, label: 'Tap a tree, bush or rock, or the ground' };
    if (this.mode === 'none') return { kind: 'none', canConfirm: false, valid: false, label: '' };
    const name = BUILDING_TABLE[BUILD_MODE_TO_DEF[this.mode]]?.name ?? this.mode.toLowerCase();
    if (this.mode === 'WALL') {
      return {
        kind: 'wall',
        canConfirm: this.touchTile !== null,
        valid: this.touchTile !== null,
        label: this.touchTile ? 'Drag to change the wall line' : 'Drag from start to end',
      };
    }
    return { kind: 'building', canConfirm: this.touchTile !== null, valid: this.lastValid, label: `Place ${name}` };
  }

  /** Where the ghost goes this frame: the touch tile, else the mouse. */
  private ghostTile(): Tile | null {
    if (this.confirmFlow) {
      if (!this.touchTile && this.mode !== 'none' && this.mode !== 'WALL') this.touchTile = this.viewCentreTile();
      return this.touchTile;
    }
    const { tx, ty } = this.ctx.pointerTile(this.ctx.scene.input.activePointer);
    return { x: tx, y: ty };
  }

  private viewCentreTile(): Tile | null {
    const view = this.ctx.scene.cameras.main.worldView;
    const { tx, ty } = this.ctx.pickTile(view.centerX, view.centerY);
    return isInsideMap(tx, ty) ? { x: tx, y: ty } : null;
  }

  // ── Drawing ───────────────────────────────────────────────────────────────

  /** Standing rally flag + the ghost for whichever mode is armed. */
  draw(): void {
    const g = this.ghost;
    const world = this.ctx.world;
    const playerId = this.ctx.perspectivePlayerId;
    this.clear();
    const rally = world.armyRallyPoints[playerId];
    if (rally) this.drawRallyMarker(rally, 0x4ecdc4, 0.9);
    // Selected town centers show where their villagers go (gold flag).
    for (const tc of this.commands.selectedTownCenters()) {
      const villagerRally = world.villagerRallies.get(tc);
      if (villagerRally) this.drawRallyMarker(villagerRally, 0xfeca57, 0.95, this.flags);
    }

    if (this.villagerRallyMode) {
      if (this.confirmFlow) return;
      const pointer = this.ctx.scene.input.activePointer;
      const { tx, ty } = this.ctx.pointerTile(pointer);
      if (isInsideMap(tx, ty)) {
        const onResource = this.villagerRallyResourceAt(tx, ty, pointer.worldX, pointer.worldY) !== null;
        const walkable = world.map.walkability[ty][tx] === 0;
        this.drawRallyMarker({ x: tx, y: ty }, onResource || walkable ? 0xfeca57 : 0xff4757, 0.95, this.flags);
      }
      return;
    }

    if (this.armyRallyMode) {
      if (this.confirmFlow) return;
      const { tx, ty } = this.ctx.pointerTile(this.ctx.scene.input.activePointer);
      if (isInsideMap(tx, ty)) {
        const valid = world.map.walkability[ty][tx] === 0;
        this.drawRallyMarker({ x: tx, y: ty }, valid ? 0xfbc36b : 0xff4757, 0.95);
      }
      return;
    }
    if (this.mode === 'none') return;
    const tile = this.ghostTile();
    if (!tile || !isInsideMap(tile.x, tile.y)) return;
    const { x: tx, y: ty } = tile;
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
    const unlocked = isBuildingUnlocked(world, playerId, defId) &&
      !(defId === BuildingDefId.HOUSE && this.commands.houseStartFailure() !== null) &&
      isPlacementInSight(world, playerId, def, tx, ty);
    const valid = unlocked && !tileBlocked && canAffordBuild && nearResource;
    this.lastValid = valid;

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
  private drawWallLineGhost(from: Tile, to: Tile): void {
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
      const blocked = isBuildFootprintBlocked(world, def, tile.x, tile.y) ||
        !isPlacementInSight(world, this.ctx.perspectivePlayerId, def, tile.x, tile.y);
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
    this.flags.clear();
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
    // Walls preview their research tier, other buildings the owner's era.
    const age = buildingEraFor(this.ctx.world, playerId, defId);
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

  private drawRallyMarker(point: Tile, color: number, alpha: number, g = this.ghost): void {
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
