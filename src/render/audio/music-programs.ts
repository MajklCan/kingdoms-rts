// The three music programs the game uses, built from whichever tracks loaded.

import type { MusicProgram } from './music-player';
import { pickNext } from './music-plan';
import type { PeaceFlavor } from './music-director';
import { BATTLE_TRACKS, INGAME_TRACKS, MENU_MUSIC, VILLAGE_MUSIC } from './sound-map';

export interface MusicPrograms {
  menu: MusicProgram;
  peace: MusicProgram;
  battle: MusicProgram;
}

export function buildPrograms(
  has: (key: string) => boolean,
  flavor: () => PeaceFlavor,
  rand: () => number = Math.random
): MusicPrograms {
  const present = (keys: readonly string[]): string[] => keys.filter(has);
  return {
    // Menu: the theme, then a quiet stretch, then again.
    menu: {
      id: 'menu',
      kind: 'gapped',
      pick: () => (has(MENU_MUSIC) ? MENU_MUSIC : null),
      gap: [10, 18],
      fadeIn: 2.5,
      fadeOut: 2.5,
    },
    // Peace: one song, an ambience-only gap, the next song. The village theme
    // when the camera lingers at home, otherwise the in-game playlist. The
    // flavor only picks the NEXT song; a playing song is never cut for it.
    peace: {
      id: 'peace',
      kind: 'gapped',
      pick: (last) => {
        const village = present([VILLAGE_MUSIC]);
        const list = flavor() === 'village' && village.length > 0 ? village : present(INGAME_TRACKS);
        return pickNext(list.length > 0 ? list : village, last, rand);
      },
      gap: [8, 20],
      fadeIn: 3,
      fadeOut: 3,
    },
    // Battle: segments chained by 3 s equal-power crossfades, alternating
    // tracks, until the director calls the fight over.
    battle: {
      id: 'battle',
      kind: 'chain',
      pick: (last) => pickNext(present(BATTLE_TRACKS), last, rand),
      fadeIn: 1.5,
      xfade: 3,
    },
  };
}
