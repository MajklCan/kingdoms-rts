/** Mutable UI-wide state shared between screens (menu mode, live MP session). */

import type { MultiplayerSession } from '../net/session';

export type TitleMode = 'root' | 'skirmish' | 'campaign' | 'multiplayer';

export const appState: {
  mpSession: MultiplayerSession | null;
  titleMode: TitleMode;
} = {
  mpSession: null,
  titleMode: 'root',
};
