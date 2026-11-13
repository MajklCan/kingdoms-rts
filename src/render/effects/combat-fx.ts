/**
 * Weapon feel, from the combat events and sound cues the sim already emits
 * (render-only, nothing new asked of the sim):
 *
 *   arrow     a dust kick and a splinter where it lands
 *   melee     sparks on the contact point (dust and chips on a building)
 *   musket    muzzle flash + drifting white smoke, a dust kick on impact
 *   cannon    big muzzle smoke; the shell bursts on the `cannon_impact` cue
 *   mortar    smoke thump straight up; bigger burst, longer shake
 *
 * Impacts of arrows and shots wait for the projectile's flight time, so the
 * puff appears as the drawn projectile arrives. Explosions shake the camera,
 * scaled by distance to the view centre. Nothing is spawned in fog or off
 * screen; the pools also drop work when they run low.
 */

import { hasComponent } from 'bitecs';
import { SIM } from '../../config';
import { Building } from '@sim/components';
import { UnitDefId } from '@sim/defs';
import type { CombatEvent, SoundCue } from '@sim/world';
import type { FxHost } from './fx-host';
import { rand } from './fx-particles';
import { arrowThunk, bulletHit, chips, dustPuff, explosion, FX_COLORS, muzzleSmoke, swordClash } from './fx-recipes';

type ImpactKind = 'arrow' | 'bullet';

/** Pending projectile impacts (fixed ring, no per-shot allocation). */
const MAX_PENDING = 256;
/** Artillery shots remembered to tell a mortar burst from a cannon burst. */
const MAX_SHOTS = 32;

export class CombatFx {
  private readonly pAt = new Float64Array(MAX_PENDING);
  private readonly pX = new Float32Array(MAX_PENDING);
  private readonly pY = new Float32Array(MAX_PENDING);
  private readonly pKind: ImpactKind[] = new Array<ImpactKind>(MAX_PENDING).fill('arrow');
  private readonly pBuilding = new Uint8Array(MAX_PENDING);
  private pending = 0;

  private readonly shotX = new Float32Array(MAX_SHOTS);
  private readonly shotY = new Float32Array(MAX_SHOTS);
  private readonly shotAt = new Float64Array(MAX_SHOTS);
  private readonly shotMortar = new Uint8Array(MAX_SHOTS);
  private shotNext = 0;

  /** Machine guns fire fast: smoke every few shots only. */
  private mgShots = 0;

  constructor(
    private readonly host: FxHost,
    /** Screen offset of a unit's muzzle from its feet (pre-rendered art), if known. */
    private readonly muzzle: (eid: number) => { dx: number; dy: number } | null = () => null
  ) {}

  onCombatEvent(event: CombatEvent): void {
    const ctx = this.host.ctx;
    const fromSeen = ctx.isTileVisible(Math.round(event.fromX), Math.round(event.fromY));
    const toSeen = ctx.isTileVisible(Math.round(event.toX), Math.round(event.toY));
    if (!fromSeen && !toSeen) return;
    const ecs = ctx.world.ecs;
    const kind = event.attackerKind;
    const targetIsBuilding = hasComponent(ecs, Building, event.targetEid);
    const attackerIsBuilding = hasComponent(ecs, Building, event.attackerEid);
    const from = ctx.tileToScreen(event.fromX, event.fromY);
    const to = ctx.tileToScreen(event.toX, event.toY);

    if (kind === UnitDefId.CANNON || kind === UnitDefId.MORTAR) {
      if (event.phase === 'windup') return;
      const mortar = kind === UnitDefId.MORTAR;
      this.rememberShot(event.toX, event.toY, mortar);
      if (!fromSeen) return;
      if (mortar) {
        muzzleSmoke(this.host.fx, from.x, from.y - 16, 0.15, -1, true);
      } else {
        const m = this.muzzle(event.attackerEid);
        const mx = from.x + (m?.dx ?? 0);
        const my = m ? from.y + m.dy : from.y - 10;
        muzzleSmoke(this.host.fx, mx, my, to.x - mx, to.y - my, true);
      }
      this.host.shake(from.x, from.y, 0.0016, 90);
      return;
    }

    if (event.range <= 1) {
      if (!toSeen) return;
      if (targetIsBuilding) {
        const x = to.x + (from.x - to.x) * 0.35;
        const y = to.y - rand(8, 22);
        chips(this.host.fx, x, y, FX_COLORS.debris, 2, FX_COLORS.wood);
        dustPuff(this.host.fx, x, y + 6, 0.5, FX_COLORS.dust, 2);
      } else if (kind === UnitDefId.VILLAGER) {
        dustPuff(this.host.fx, (from.x + to.x) / 2, to.y - 4, 0.45, FX_COLORS.dust, 2);
      } else {
        swordClash(this.host.fx, (from.x + to.x) / 2 + rand(-2, 2), (from.y + to.y) / 2 - rand(10, 15));
      }
      return;
    }

    const gun = kind === UnitDefId.GUNMAN || kind === UnitDefId.MACHINE_GUN;
    if (gun && fromSeen) {
      const mg = kind === UnitDefId.MACHINE_GUN;
      if (!mg || this.mgShots++ % 3 === 0) {
        const m = mg ? null : this.muzzle(event.attackerEid);
        const mx = from.x + (m?.dx ?? 0);
        const my = m ? from.y + m.dy : from.y - (mg ? 9 : 14);
        muzzleSmoke(this.host.fx, mx, my, to.x - mx, to.y - my, false);
      } else {
        this.host.fx.emit('add', { frame: 'glow', x: from.x, y: from.y - 9, life: 50, scale: 0.3, alpha: 0.8, tint: 0xffe0a0 });
      }
    }
    const archer = kind === UnitDefId.ARCHER || attackerIsBuilding;
    if (!gun && !archer) return;
    if (!toSeen) return;
    this.schedule(
      this.host.time + flightMs(event, gun),
      to.x + rand(-3, 3),
      to.y - (targetIsBuilding ? rand(6, 26) : rand(4, 12)),
      gun ? 'bullet' : 'arrow',
      targetIsBuilding
    );
  }

  onCue(cue: SoundCue): void {
    if (cue.kind !== 'cannon_impact') return;
    const ctx = this.host.ctx;
    if (!ctx.isTileVisible(Math.round(cue.x), Math.round(cue.y))) return;
    const mortar = this.wasMortar(cue.x, cue.y);
    const p = ctx.tileToScreen(cue.x, cue.y);
    explosion(this.host.fx, p.x, p.y, mortar);
    this.host.shake(p.x, p.y, mortar ? 0.0062 : 0.0045, mortar ? 230 : 170);
  }

  update(): void {
    const now = this.host.time;
    let i = 0;
    while (i < this.pending) {
      if (this.pAt[i] > now) {
        i++;
        continue;
      }
      const x = this.pX[i];
      const y = this.pY[i];
      if (this.pKind[i] === 'bullet') {
        bulletHit(this.host.fx, x, y);
        if (this.pBuilding[i]) chips(this.host.fx, x, y, FX_COLORS.debrisStone, 2);
      } else {
        arrowThunk(this.host.fx, x, y);
      }
      this.removePending(i);
    }
  }

  clear(): void {
    this.pending = 0;
    this.shotAt.fill(0);
    this.mgShots = 0;
  }

  private schedule(at: number, x: number, y: number, kind: ImpactKind, building: boolean): void {
    if (this.pending >= MAX_PENDING) return;
    const i = this.pending++;
    this.pAt[i] = at;
    this.pX[i] = x;
    this.pY[i] = y;
    this.pKind[i] = kind;
    this.pBuilding[i] = building ? 1 : 0;
  }

  private removePending(i: number): void {
    const last = --this.pending;
    if (i === last) return;
    this.pAt[i] = this.pAt[last];
    this.pX[i] = this.pX[last];
    this.pY[i] = this.pY[last];
    this.pKind[i] = this.pKind[last];
    this.pBuilding[i] = this.pBuilding[last];
  }

  private rememberShot(x: number, y: number, mortar: boolean): void {
    const i = this.shotNext;
    this.shotNext = (this.shotNext + 1) % MAX_SHOTS;
    this.shotX[i] = x;
    this.shotY[i] = y;
    this.shotAt[i] = this.host.time;
    this.shotMortar[i] = mortar ? 1 : 0;
  }

  /** The most recent artillery shot aimed near (x, y) was a mortar's. */
  private wasMortar(x: number, y: number): boolean {
    let best = -1;
    let bestAt = -Infinity;
    const horizon = this.host.time - 4000;
    for (let i = 0; i < MAX_SHOTS; i++) {
      const at = this.shotAt[i];
      if (at <= horizon || at <= bestAt) continue;
      if (Math.abs(this.shotX[i] - x) > 2.5 || Math.abs(this.shotY[i] - y) > 2.5) continue;
      best = i;
      bestAt = at;
    }
    return best >= 0 && this.shotMortar[best] === 1;
  }
}

/** Same flight time the drawn projectile uses (combat-feedback.ts). */
function flightMs(event: CombatEvent, gun: boolean): number {
  const ticks = event.projectileTicks ?? 0;
  if (ticks > 0) return ticks * SIM.TICK_MS;
  const dist = Math.hypot(event.fromX - event.toX, event.fromY - event.toY);
  return gun ? clamp(dist * 24, 70, 160) : clamp(dist * 70, 180, 520);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
