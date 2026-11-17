/**
 * Loading screen data and rules, kept pure for tests: the four real start-up
 * phases and where the progress rule stands for each, the minimum time on
 * screen per kind of match, and the chronicle lines shown while it loads.
 */

export type LoadingKind = 'skirmish' | 'campaign' | 'multiplayer' | 'loaded' | 'continue';

/** One label per notch, in order. Each completes on real work (loading.ts). */
export const LOADING_PHASES = ['Preparing the realm', 'Raising the map', 'Mustering the host', 'Ready'] as const;
export const PHASE_COUNT = LOADING_PHASES.length;

/** How far into a running phase the rule may creep before it really ends. */
const CREEP = 0.6;

/** Rule fill (0..1) once `done` phases have finished. */
export function phaseFill(done: number): number {
  return Math.max(0, Math.min(PHASE_COUNT, done)) / PHASE_COUNT;
}

/** Where the rule eases to while phase `done + 1` is still running. */
export function phaseCreep(done: number): number {
  if (done >= PHASE_COUNT) return 1;
  return (Math.max(0, done) + CREEP) / PHASE_COUNT;
}

const EYEBROW: Record<LoadingKind, string> = {
  skirmish: 'Skirmish',
  campaign: 'Campaign',
  multiplayer: 'Multiplayer',
  loaded: 'Saved game',
  continue: 'Continue',
};

export function eyebrowFor(kind: LoadingKind): string {
  return EYEBROW[kind];
}

/** Long enough for the destination and one line to register; a rival is
 *  waiting in multiplayer, so it gets the shortest. */
export function minDisplayMs(kind: LoadingKind): number {
  if (kind === 'multiplayer') return 900;
  if (kind === 'loaded' || kind === 'continue') return 1200;
  return 1600;
}

/** A line rotates only when loading runs past this. */
export const LORE_ROTATE_MS = 4500;

/** Short Czech history and legend lines. Legends say so. */
export const LORE: readonly string[] = [
  'Charles Bridge in Prague was begun in 1357, under Charles IV.',
  'Hussite war wagons, chained into a fort, turned back armies of knights.',
  'Jan Žižka kept leading his armies after he went blind.',
  'Silver from Kutná Hora was struck into the Prague groschen.',
  'Charles University, founded in 1348, is the oldest in Central Europe.',
  'In 1645 Brno held its walls against a Swedish army for months.',
  'The Battle of Bílá Hora in 1620 was over in about two hours.',
  'In 1526 the Bohemian estates elected Ferdinand of Habsburg king.',
  "Prague's astronomical clock has told the hours since 1410.",
  'Legend says Přemysl the Ploughman kept his bast shoes to recall his roots.',
  'Legend says Libuše foresaw a city whose glory would touch the stars.',
  'Karlštejn Castle was built to keep the imperial regalia safe.',
];

/** A random line index, never `prev` again. */
export function pickLore(prev: number, rand: () => number, count: number = LORE.length): number {
  if (count <= 1) return 0;
  if (prev < 0 || prev >= count) return Math.min(count - 1, Math.floor(rand() * count));
  const i = Math.min(count - 2, Math.floor(rand() * (count - 1)));
  return i >= prev ? i + 1 : i;
}
