// Adaptive music mood: peace or battle, with hysteresis so a stray arrow does
// not flip the score and a lull mid-fight does not drop it. Also tracks which
// peaceful flavor the next song should have (village when the camera lingers
// at home). Pure: driven by sim ticks, no audio calls.

export type MusicMood = 'peace' | 'battle';
export type PeaceFlavor = 'village' | 'playlist';

export interface DirectorOptions {
  tickHz: number;
  /** Combat intensity decays with this time constant (s). */
  intensityTauS: number;
  /** Intensity needed to start battle music (~ one local combat event per
   *  second sustained for a few seconds; one tower arrow is not a battle). */
  enterBattle: number;
  /** Battle ends once intensity stays under this for `exitHoldS`. */
  exitBattle: number;
  exitHoldS: number;
  /** Battle music plays at least this long once started. */
  minBattleS: number;
  /** After a battle, peace holds this long unless the next fight is big. */
  minPeaceS: number;
  bigBattle: number;
  /** Camera dwell at home before the next peaceful song is the village theme. */
  villageLingerS: number;
  homeGraceS: number;
}

export const DEFAULT_DIRECTOR: Omit<DirectorOptions, 'tickHz'> = {
  intensityTauS: 6,
  enterBattle: 10,
  exitBattle: 3,
  exitHoldS: 10,
  minBattleS: 20,
  minPeaceS: 12,
  bigBattle: 20,
  villageLingerS: 6,
  homeGraceS: 2,
};

export interface MoodChange {
  tick: number;
  mood: MusicMood;
  intensity: number;
}

export interface DirectorState {
  mood: MusicMood;
  flavor: PeaceFlavor;
  changed: boolean;
  intensity: number;
}

export class MusicDirector {
  private readonly o: DirectorOptions;
  private mood: MusicMood = 'peace';
  private moodSince = -Infinity;
  private value = 0;
  private valueTick = 0;
  private belowExitSince = -1;
  private homeSince = -1;
  private lastHome = -Infinity;
  readonly transitions: MoodChange[] = [];

  constructor(opts: Partial<DirectorOptions> & { tickHz: number }) {
    this.o = { ...DEFAULT_DIRECTOR, ...opts };
  }

  get currentMood(): MusicMood {
    return this.mood;
  }

  /** Fresh match: peace, no intensity, no history. */
  reset(tick: number): void {
    this.mood = 'peace';
    this.moodSince = -Infinity;
    this.value = 0;
    this.valueTick = tick;
    this.belowExitSince = -1;
    this.homeSince = -1;
    this.lastHome = -Infinity;
    this.transitions.length = 0;
  }

  intensityAt(tick: number): number {
    const dt = Math.max(0, tick - this.valueTick) / this.o.tickHz;
    return this.value * Math.exp(-dt / this.o.intensityTauS);
  }

  /** A combat event involving the local player. */
  noteCombat(tick: number, weight = 1): void {
    this.value = this.intensityAt(tick) + weight;
    this.valueTick = tick;
  }

  update(tick: number, atHome: boolean): DirectorState {
    const hz = this.o.tickHz;
    const i = this.intensityAt(tick);
    let changed = false;
    if (this.mood === 'peace') {
      const dwell = tick - this.moodSince;
      if (i >= this.o.enterBattle && (dwell >= this.o.minPeaceS * hz || i >= this.o.bigBattle)) {
        this.setMood('battle', tick, i);
        changed = true;
      }
    } else {
      if (i < this.o.exitBattle) {
        if (this.belowExitSince < 0) this.belowExitSince = tick;
      } else {
        this.belowExitSince = -1;
      }
      const calm = this.belowExitSince >= 0 && tick - this.belowExitSince >= this.o.exitHoldS * hz;
      if (calm && tick - this.moodSince >= this.o.minBattleS * hz) {
        this.setMood('peace', tick, i);
        changed = true;
      }
    }
    return { mood: this.mood, flavor: this.flavor(tick, atHome), changed, intensity: i };
  }

  private flavor(tick: number, atHome: boolean): PeaceFlavor {
    const hz = this.o.tickHz;
    if (atHome) {
      this.lastHome = tick;
      if (this.homeSince < 0) this.homeSince = tick;
    } else if (tick - this.lastHome > this.o.homeGraceS * hz) {
      this.homeSince = -1;
    }
    return this.homeSince >= 0 && tick - this.homeSince >= this.o.villageLingerS * hz ? 'village' : 'playlist';
  }

  private setMood(mood: MusicMood, tick: number, intensity: number): void {
    this.mood = mood;
    this.moodSince = tick;
    this.belowExitSince = -1;
    this.transitions.push({ tick, mood, intensity: Math.round(intensity * 10) / 10 });
    if (this.transitions.length > 50) this.transitions.shift();
  }
}
