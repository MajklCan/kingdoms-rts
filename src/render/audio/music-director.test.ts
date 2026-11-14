import { describe, expect, it } from 'vitest';
import { MusicDirector } from './music-director';

const HZ = 20;
const s = (sec: number) => Math.round(sec * HZ);

/** Run the director tick by tick; `events(tick)` = combat events that tick. */
function run(d: MusicDirector, from: number, to: number, events: (tick: number) => number, atHome = false) {
  const moods: string[] = [];
  for (let t = from; t < to; t++) {
    const n = events(t);
    for (let i = 0; i < n; i++) d.noteCombat(t);
    moods.push(d.update(t, atHome).mood);
  }
  return moods;
}

describe('MusicDirector', () => {
  it('a lone tower arrow every 1.5 s never starts battle music', () => {
    const d = new MusicDirector({ tickHz: HZ });
    run(d, 0, s(120), (t) => (t % s(1.5) === 0 ? 1 : 0));
    expect(d.transitions).toHaveLength(0);
  });

  it('a real fight starts battle music within a few seconds', () => {
    const d = new MusicDirector({ tickHz: HZ });
    // ~4 local combat events per second.
    const moods = run(d, 0, s(10), (t) => (t % 5 === 0 ? 1 : 0));
    const first = moods.indexOf('battle');
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(s(4));
  });

  it('holds battle through lulls and leaves only after a calm stretch', () => {
    const d = new MusicDirector({ tickHz: HZ });
    // 30 s fight with a 6 s pause in the middle, then silence.
    const fight = (t: number) => ((t < s(12) || (t > s(18) && t < s(30))) && t % 5 === 0 ? 1 : 0);
    const moods = run(d, 0, s(80), fight);
    const battleTicks = moods.filter((m) => m === 'battle').length;
    expect(d.transitions.map((x) => x.mood)).toEqual(['battle', 'peace']);
    // Battle lasted past the fight's end by the calm hold, not much longer.
    expect(battleTicks).toBeGreaterThan(s(30));
    expect(battleTicks).toBeLessThan(s(55));
  });

  it('does not flap across 2 minutes of on-off skirmishing', () => {
    const d = new MusicDirector({ tickHz: HZ });
    // 4 s of fighting every 9 s, for 2 minutes.
    run(d, 0, s(120), (t) => (t % s(9) < s(4) && t % 5 === 0 ? 1 : 0));
    expect(d.transitions.length).toBeLessThanOrEqual(2);
  });

  it('after a battle, peace holds unless the next fight is big', () => {
    const d = new MusicDirector({ tickHz: HZ, minPeaceS: 45 });
    run(d, 0, s(8), (t) => (t % 5 === 0 ? 1 : 0));
    run(d, s(8), s(60), () => 0);
    expect(d.currentMood).toBe('peace');
    // A small flare-up right after: stays peaceful.
    run(d, s(60), s(64), (t) => (t % 5 === 0 ? 1 : 0));
    expect(d.currentMood).toBe('peace');
    // A big one (6+ events a second) breaks through.
    run(d, s(64), s(70), () => 1);
    expect(d.currentMood).toBe('battle');
  });

  it('village flavor only after lingering at home, with a short grace', () => {
    const d = new MusicDirector({ tickHz: HZ });
    expect(d.update(0, true).flavor).toBe('playlist');
    expect(d.update(s(6), true).flavor).toBe('village');
    // A quick glance away keeps it.
    expect(d.update(s(7), false).flavor).toBe('village');
    // Gone for longer than the grace: back to the playlist.
    expect(d.update(s(10), false).flavor).toBe('playlist');
  });

  it('reset clears mood, intensity and history', () => {
    const d = new MusicDirector({ tickHz: HZ });
    run(d, 0, s(10), () => 1);
    d.reset(s(10));
    expect(d.currentMood).toBe('peace');
    expect(d.intensityAt(s(10))).toBe(0);
    expect(d.transitions).toHaveLength(0);
  });
});
