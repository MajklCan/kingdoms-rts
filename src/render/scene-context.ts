/**
 * Shared, mutable per-scene state that every render module reads: the current
 * sim world (replaced on new game / load / multiplayer start), whose eyes we
 * render through, the lockstep session, and the world layers. Also hosts the
 * small perspective-relative queries (visibility, selection, projection) that
 * nearly every module needs.
 */

import { hasComponent } from 'bitecs';
import { Owner, Position, UnitKind, VillagerTag } from '@sim/components';
import {
  LOCAL_PLAYER_ID,
  isEntityVisibleTo,
  isTileExploredBy,
  isTileVisibleTo,
  selectedQuery,
  type SimWorld,
} from '@sim/world';
import type { MultiplayerSession } from '../net/session';
import type { ScreenPos } from './iso';
import type { WorldLayers } from './world-layers';
import {
  buildingScreenPosition,
  screenToTileElev,
  tileToScreenElev,
  type PickedTile,
} from './world-projection';

export class SceneContext {
  world: SimWorld;
  /** The player this client renders, selects and commands as. Always
   *  LOCAL_PLAYER_ID (1) in single-player; the assigned slot in multiplayer. */
  perspectivePlayerId: number = LOCAL_PLAYER_ID;
  /** Active lockstep session; null in single-player. When set it drives ticks. */
  multiplayer: MultiplayerSession | null = null;
  /** Fixed-timestep accumulator; also the interpolation alpha source. */
  accumulatorMs = 0;
  /** Single-player speed multiplier (1 or 2). */
  gameSpeed = 1;
  private selected: ReadonlySet<number> = new Set();

  constructor(
    readonly scene: Phaser.Scene,
    readonly layers: WorldLayers,
    world: SimWorld
  ) {
    this.world = world;
  }

  /** Snapshot the selection once per frame so draw passes can test it in O(1). */
  snapshotSelection(): void {
    this.selected = new Set(selectedQuery(this.world.ecs));
  }

  isSelected(eid: number): boolean {
    return this.selected.has(eid);
  }

  isEntityVisible(eid: number): boolean {
    return isEntityVisibleTo(this.world, this.perspectivePlayerId, eid);
  }

  isTileVisible(x: number, y: number): boolean {
    return isTileVisibleTo(this.world, this.perspectivePlayerId, x, y);
  }

  isTileExplored(x: number, y: number): boolean {
    return isTileExploredBy(this.world, this.perspectivePlayerId, x, y);
  }

  isResourceExplored(eid: number): boolean {
    return this.isTileExplored(Position.x[eid], Position.y[eid]);
  }

  ownerOf(eid: number): number {
    return hasComponent(this.world.ecs, Owner, eid) ? Owner.player[eid] : 0;
  }

  /** A unit (not a building) owned by the perspective player. */
  isOwnUnit(eid: number): boolean {
    return hasComponent(this.world.ecs, UnitKind, eid) &&
      Owner.player[eid] === this.perspectivePlayerId;
  }

  isVillager(eid: number): boolean {
    return hasComponent(this.world.ecs, VillagerTag, eid);
  }

  /** Tile -> container-local screen position on top of the terrain. */
  tileToScreen(tileX: number, tileY: number): ScreenPos {
    return tileToScreenElev(this.world, tileX, tileY);
  }

  buildingScreenPosition(eid: number): ScreenPos {
    return buildingScreenPosition(this.world, eid);
  }

  /** Container-local -> camera world coordinates. */
  localToWorld(local: ScreenPos): ScreenPos {
    return { x: local.x + this.layers.root.x, y: local.y + this.layers.root.y };
  }

  /** Camera world point -> tile under it (elevation corrected). */
  pickTile(worldX: number, worldY: number): PickedTile {
    return screenToTileElev(this.world, worldX - this.layers.root.x, worldY - this.layers.root.y);
  }

  pointerTile(pointer: Phaser.Input.Pointer): PickedTile {
    return this.pickTile(pointer.worldX, pointer.worldY);
  }
}
