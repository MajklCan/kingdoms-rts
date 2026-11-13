/** Pure formatting / parsing helpers used by the HUD (unit tested). */

export type ResourceKey = 'food' | 'wood' | 'gold' | 'stone';
export const RESOURCE_KEYS: readonly ResourceKey[] = ['food', 'wood', 'gold', 'stone'];

export type CostMap = Partial<Record<ResourceKey, number>>;

/** Parse the scene's cost strings ("50 food 100 wood") into a map. */
export function parseCost(text: string | undefined | null): CostMap {
  const out: CostMap = {};
  if (!text) return out;
  const re = /(\d+)\s*(food|wood|gold|stone)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const key = m[2]!.toLowerCase() as ResourceKey;
    out[key] = (out[key] ?? 0) + Number(m[1]);
  }
  return out;
}

/** Which resources in `cost` the bank cannot cover. */
export function missingResources(cost: CostMap, bank: Record<ResourceKey, number>): ResourceKey[] {
  return RESOURCE_KEYS.filter((k) => (cost[k] ?? 0) > (bank[k] ?? 0));
}

/** Parse an action meta string ("25s / Pop 1", "40s", "Research"). */
export function parseMeta(meta: string | undefined | null): { seconds: number | null; pop: number | null; extra: string } {
  if (!meta) return { seconds: null, pop: null, extra: '' };
  const sec = /(\d+)\s*s\b/.exec(meta);
  const pop = /Pop\s*(\d+)/i.exec(meta);
  const extra = meta
    .replace(/(\d+)\s*s\b/, '')
    .replace(/Pop\s*\d+/i, '')
    .replace(/[/|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    seconds: sec ? Number(sec[1]) : null,
    pop: pop ? Number(pop[1]) : null,
    extra,
  };
}

/** Sim ticks to a mm:ss or h:mm:ss clock. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = String(minutes).padStart(hours > 0 ? 2 : 1, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Compact resource number: 1234 -> "1234", 12345 -> "12.3k". */
export function formatAmount(value: number): string {
  const v = Math.floor(value);
  if (Math.abs(v) < 10000) return String(v);
  if (Math.abs(v) < 1_000_000) return `${(v / 1000).toFixed(1)}k`;
  return `${(v / 1_000_000).toFixed(1)}M`;
}

/** Health fraction to a semantic bucket for colouring. */
export function hpBucket(frac: number): 'high' | 'mid' | 'low' {
  if (frac > 0.6) return 'high';
  if (frac > 0.3) return 'mid';
  return 'low';
}
