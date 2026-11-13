/**
 * Hit flash: notices an entity's HP dropping between frames (melee, arrow
 * impact, splash, whatever the sim did) and hands renderers an additive flash
 * colour that decays over a short window. Render-only bookkeeping.
 */

/** Flash length, ms of real time. */
export const HIT_FLASH_MS = 150;

export class HitFlash {
  private readonly lastHp = new Map<number, number>();
  private readonly hitAt = new Map<number, number>();

  constructor(
    /** Peak additive colour per channel (0xRRGGBB). */
    private readonly peak: number,
    private readonly now: () => number
  ) {}

  /** Additive flash colour for `eid` this frame (0 = none). Call once per frame per entity. */
  colorFor(eid: number, hp: number): number {
    const prev = this.lastHp.get(eid);
    if (prev !== hp) this.lastHp.set(eid, hp);
    const t = this.now();
    if (prev !== undefined && hp < prev) this.hitAt.set(eid, t);
    const at = this.hitAt.get(eid);
    if (at === undefined) return 0;
    const k = 1 - (t - at) / HIT_FLASH_MS;
    if (k <= 0) {
      this.hitAt.delete(eid);
      return 0;
    }
    return scaleColor(this.peak, k * k);
  }

  forget(eid: number): void {
    this.lastHp.delete(eid);
    this.hitAt.delete(eid);
  }

  clear(): void {
    this.lastHp.clear();
    this.hitAt.clear();
  }
}

/** 0xRRGGBB scaled per channel by k in [0, 1]; quantised so tints stay stable. */
export function scaleColor(color: number, k: number): number {
  const q = Math.round(Math.max(0, Math.min(1, k)) * 16) / 16;
  const r = Math.round(((color >> 16) & 0xff) * q);
  const g = Math.round(((color >> 8) & 0xff) * q);
  const b = Math.round((color & 0xff) * q);
  return (r << 16) | (g << 8) | b;
}
