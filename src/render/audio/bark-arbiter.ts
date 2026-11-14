// Unit voice lines, one at a time. Decides whether a new bark plays, replaces
// the one talking, or is skipped, and which line to use (never the same line
// twice in a row for a persona + type). Pure: time in ms, randomness injected.

export type BarkType = 'select' | 'move' | 'attack';

export interface BarkDecision {
  action: 'play' | 'replace' | 'skip';
  reason?: 'no-lines' | 'busy' | 'cooldown';
  /** Index into the available line list (only when not skipped). */
  line?: number;
}

export interface BarkArbiterOptions {
  /** Minimum ms between two line starts (spam-click guard). */
  minStartGapMs: number;
  /** A command may cut another command only after it has run this long. */
  commandCutAfterMs: number;
  /** Quiet gap after a line ends before a select line may start. */
  selectGapAfterEndMs: number;
}

const DEFAULTS: BarkArbiterOptions = { minStartGapMs: 250, commandCutAfterMs: 450, selectGapAfterEndMs: 120 };

interface Speaking {
  type: BarkType;
  startedAt: number;
  endsAt: number;
}

export class BarkArbiter {
  private readonly opts: BarkArbiterOptions;
  private speaking: Speaking | null = null;
  private lastStartAt = -Infinity;
  private lastEndAt = -Infinity;
  private readonly lastLine = new Map<string, number>();

  constructor(opts: Partial<BarkArbiterOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  isSpeaking(now: number): boolean {
    this.settle(now);
    return this.speaking !== null;
  }

  /**
   * @param lines indices of the lines that exist for this persona + type
   */
  request(now: number, persona: string, type: BarkType, lines: readonly number[], rand: () => number): BarkDecision {
    if (lines.length === 0) return { action: 'skip', reason: 'no-lines' };
    this.settle(now);
    let action: BarkDecision['action'] = 'play';
    if (this.speaking) {
      const cur = this.speaking;
      const isCommand = type !== 'select';
      const canCut = isCommand && (cur.type === 'select' || now - cur.startedAt >= this.opts.commandCutAfterMs);
      if (!canCut) return { action: 'skip', reason: 'busy' };
      action = 'replace';
    } else {
      if (now - this.lastStartAt < this.opts.minStartGapMs) return { action: 'skip', reason: 'cooldown' };
      if (type === 'select' && now - this.lastEndAt < this.opts.selectGapAfterEndMs) {
        return { action: 'skip', reason: 'cooldown' };
      }
    }
    return { action, line: this.pickLine(`${persona}:${type}`, lines, rand) };
  }

  /** The engine started `line` and it will last `durationMs`. */
  started(now: number, persona: string, type: BarkType, line: number, durationMs: number): void {
    this.speaking = { type, startedAt: now, endsAt: now + durationMs };
    this.lastStartAt = now;
    this.lastLine.set(`${persona}:${type}`, line);
  }

  /** The line was stopped early (pause, menu). */
  silence(now: number): void {
    if (this.speaking) this.lastEndAt = now;
    this.speaking = null;
  }

  private settle(now: number): void {
    if (this.speaking && now >= this.speaking.endsAt) {
      this.lastEndAt = this.speaking.endsAt;
      this.speaking = null;
    }
  }

  private pickLine(slot: string, lines: readonly number[], rand: () => number): number {
    const last = this.lastLine.get(slot);
    const pool = lines.length > 1 ? lines.filter((l) => l !== last) : lines;
    return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
  }
}
