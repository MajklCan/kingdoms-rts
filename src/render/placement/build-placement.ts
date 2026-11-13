/**
 * Placement modes: building placement (B + key, action grid) with its
 * footprint ghost, and the army rally point picker. Also draws the standing
 * army rally flag.
 */

import { ISO, MAP } from '../../config';
import { Building, Position, Resource } from '@sim/components';
import { BUILDING_TABLE, BuildingDefId, type BuildingDef } from '@sim/defs';
import { isBuildingUnlocked } from '@sim/tech-tree';
import { buildingQuery, findResourceAt, resourceQuery, type SimWorld } from '@sim/world';
import { setLastEvent } from '../../debug/overlay';
import { ERROR as SFX_ERROR, PLACE_BUILDING } from '../audio/sound-map';
import type { PlayerCommands } from '../commands/player-commands';
import { countOwnedArmyProducers } from '../commands/economy';
import type { GameAudio } from '../game-audio';
import type { SceneContext } from '../scene-context';
import { addLayerGraphics } from '../world-layers';
import { buildingAnchorTileForDef, isInsideMap } from '../world-projection';

export type BuildMode =
  | 'none'
  | 'HOUSE'
  | 'FARM'
  | 'MILL'
  | 'LUMBER_CAMP'
  | 'GOLD_MINE'
  | 'STONE_QUARRY'
  | 'BARRACKS'
  | 'STABLE'
  | 'FOUNDRY'
  | 'DEFENSIVE_TOWER';

export const BUILD_MODE_TO_DEF: Record<Exclude<BuildMode, 'none'>, number> = {
  HOUSE: BuildingDefId.HOUSE,
  FARM: BuildingDefId.FARM,
  MILL: BuildingDefId.MILL,
  LUMBER_CAMP: BuildingDefId.LUMBER_CAMP,
  GOLD_MINE: BuildingDefId.GOLD_MINE,
  STONE_QUARRY: BuildingDefId.STONE_QUARRY,
  BARRACKS: BuildingDefId.BARRACKS,
  STABLE: BuildingDefId.STABLE,
  FOUNDRY: BuildingDefId.FOUNDRY,
  DEFENSIVE_TOWER: BuildingDefId.DEFENSIVE_TOWER,
};

export class BuildPlacement {
  mode: BuildMode = 'none';
  armyRallyMode = false;
  /** B was pressed; waiting for the building key. */
  awaitingBuildKind = false;
  private readonly ghost: Phaser.GameObjects.Graphics;

  constructor(
    private readonly ctx: SceneContext,
    private readonly commands: PlayerCommands,
    private readonly audio: GameAudio
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
    this.armyRallyMode = false;
    this.awaitingBuildKind = false;
    this.ghost.clear();
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
        this.ghost.clear();
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
        this.ghost.clear();
        return true;
      }
    }

    if (this.mode !== 'none') {
      if (pointer.rightButtonDown()) {
        this.mode = 'none';
        this.ghost.clear();
        setLastEvent('build mode cancelled');
        return true;
      }
      if (pointer.leftButtonDown()) {
        const defId = BUILD_MODE_TO_DEF[this.mode];
        if (!isBuildingUnlocked(this.ctx.world, playerId, defId)) {
          setLastEvent(`${BUILDING_TABLE[defId]?.name ?? this.mode} is locked`);
          this.audio.playUi(SFX_ERROR);
          this.mode = 'none';
          this.ghost.clear();
          return true;
        }
        this.commands.dispatch({ type: 'placeBuilding', defId, x: tx, y: ty, playerId });
        this.audio.playUi(PLACE_BUILDING);
        setLastEvent(`place ${this.mode} → (${tx},${ty})`);
        this.mode = 'none';
        this.ghost.clear();
        return true;
      }
    }
    return false;
  }

  /** Standing rally flag + the ghost for whichever mode is armed. */
  draw(): void {
    const g = this.ghost;
    const world = this.ctx.world;
    const playerId = this.ctx.perspectivePlayerId;
    g.clear();
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
    const canAffordBuild =
      bank[0] >= def.cost.food &&
      bank[1] >= def.cost.wood &&
      bank[2] >= def.cost.gold &&
      bank[3] >= def.cost.stone;
    const unlocked = isBuildingUnlocked(world, playerId, defId);
    const valid = unlocked && !tileBlocked && canAffordBuild && nearResource;

    g.fillStyle(valid ? def.color : 0xff4757, 0.4);
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

  clear(): void {
    this.ghost.clear();
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
