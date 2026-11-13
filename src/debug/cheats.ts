/**
 * Debug-panel cheats (reveal map, resources, spawn units by the town hall).
 * Single-player only: in a lockstep match they would desync the peers.
 */

import { MAP } from '../config';
import { Owner, Position, ResourceKindId } from '@sim/components';
import {
  clearSelection,
  findResourceAt,
  revealMapForPlayer,
  setSelected,
  spawnMachineGun,
  spawnMortar,
  spawnScoutCavalry,
  townCenterQuery,
  type SimWorld,
} from '@sim/world';
import { setLastEvent } from './overlay';

type SpawnFn = (world: SimWorld, x: number, y: number, playerId: number) => number;

export interface CheatHost {
  readonly world: SimWorld;
  readonly isMultiplayer: boolean;
  /** Called after the visibility grid changed outside a sim tick. */
  onFogChanged(): void;
}

export class Cheats {
  constructor(private readonly host: CheatHost) {}

  revealMap(playerId = 1): void {
    if (this.blocked()) return;
    revealMapForPlayer(this.host.world, playerId);
    this.host.onFogChanged();
    setLastEvent('cheat: map revealed');
  }

  addResources(playerId = 1, amount = 500): void {
    if (this.blocked()) return;
    const bank = this.host.world.resources[playerId];
    if (!bank) return;
    bank[ResourceKindId.FOOD] += amount;
    bank[ResourceKindId.WOOD] += amount;
    bank[ResourceKindId.GOLD] += amount;
    bank[ResourceKindId.STONE] += amount;
    setLastEvent(`cheat: +${amount} resources`);
  }

  spawnCavalryByTownHall(playerId = 1): number | null {
    return this.spawnByTownHall(playerId, spawnScoutCavalry, 'cavalry');
  }

  spawnMachineGunByTownHall(playerId = 1): number | null {
    return this.spawnByTownHall(playerId, spawnMachineGun, 'machine gun');
  }

  spawnMortarByTownHall(playerId = 1): number | null {
    return this.spawnByTownHall(playerId, spawnMortar, 'mortar');
  }

  private blocked(): boolean {
    if (!this.host.isMultiplayer) return false;
    setLastEvent('cheats disabled in multiplayer');
    return true;
  }

  private spawnByTownHall(playerId: number, spawn: SpawnFn, label: string): number | null {
    if (this.blocked()) return null;
    const world = this.host.world;
    let townHall: number | null = null;
    for (const eid of townCenterQuery(world.ecs)) {
      if (Owner.player[eid] !== playerId) continue;
      townHall = eid;
      break;
    }
    if (townHall === null) {
      setLastEvent('cheat: no town hall');
      return null;
    }
    const spot = this.findSpawnSpotNear(Position.x[townHall], Position.y[townHall]);
    if (!spot) {
      setLastEvent(`cheat: no ${label} spawn tile`);
      return null;
    }
    const eid = spawn(world, spot.x, spot.y, playerId);
    clearSelection(world);
    setSelected(world, eid, true);
    setLastEvent(`cheat: ${label} spawned (${spot.x},${spot.y})`);
    return eid;
  }

  /** First free walkable tile on square rings r = 2..8, else the pathfinder's pick. */
  private findSpawnSpotNear(cx: number, cy: number): { x: number; y: number } | null {
    const world = this.host.world;
    const baseX = Math.round(cx);
    const baseY = Math.round(cy);
    for (let r = 2; r <= 8; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = baseX + dx;
          const y = baseY + dy;
          if (x < 0 || y < 0 || x >= MAP.WIDTH || y >= MAP.HEIGHT) continue;
          if (world.map.walkability[y][x] !== 0) continue;
          if (findResourceAt(world, x, y, 0.7) !== null) continue;
          return { x, y };
        }
      }
    }
    return world.pathfinder.nearestWalkable(baseX, baseY, 10);
  }
}
