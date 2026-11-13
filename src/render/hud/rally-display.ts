/**
 * Shows the army rally point while one of the player's army buildings is
 * selected: a pennant at the rally tile with a dashed line from the building
 * (the rally point is shared by every army building of a player, so the line
 * starts at the lowest selected one). Pure presentation, reads sim state only.
 */

import { hasComponent } from 'bitecs';
import { Building, Owner, Position } from '@sim/components';
import { selectedQuery } from '@sim/world';
import { isArmyProducerDefId } from '../commands/economy';
import type { EffectHandle, EffectsLayer } from '../effects/effects-layer';
import { RALLY_FLAG_EFFECT } from '../effects/rally-flag';
import type { SceneContext } from '../scene-context';

export class RallyDisplay {
  private handle: EffectHandle | null = null;
  private signature = '';

  constructor(
    private readonly ctx: SceneContext,
    private readonly effects: EffectsLayer
  ) {}

  /** Call once per frame after the selection may have changed. */
  update(): void {
    const next = this.currentSignature();
    if (next === this.signature) return;
    this.handle?.stop();
    this.handle = null;
    this.signature = next;
    if (!next) return;
    const [bx, by, rx, ry] = next.split(',').map(Number) as [number, number, number, number];
    this.handle = this.effects.spawn(RALLY_FLAG_EFFECT, { x: rx, y: ry }, { to: { x: bx, y: by } });
  }

  /** The effects layer was cleared (new or loaded match): forget the handle. */
  reset(): void {
    this.handle = null;
    this.signature = '';
  }

  private currentSignature(): string {
    const world = this.ctx.world;
    const playerId = this.ctx.perspectivePlayerId;
    const rally = world.armyRallyPoints[playerId];
    if (!rally) return '';
    const ecs = world.ecs;
    let producer = -1;
    for (const eid of selectedQuery(ecs)) {
      if (!hasComponent(ecs, Building, eid) || Owner.player[eid] !== playerId) continue;
      if (!isArmyProducerDefId(Building.defId[eid]!)) continue;
      if (producer < 0 || eid < producer) producer = eid;
    }
    if (producer < 0) return '';
    return `${Position.x[producer]},${Position.y[producer]},${rally.x},${rally.y}`;
  }
}
