/** Title screen root: mode switching between the menu and the setup panels. */

import { appState, type TitleMode } from '../app-state';
import { updateCheatButtonsDisabled } from '../dev/cheats';
import { byId } from '../dom';

export function hideTitleScreen(): void {
  byId('title-screen')?.classList.add('hidden');
}

export function setTitleMode(mode: TitleMode): void {
  appState.titleMode = mode;
  const modeMenu = byId('mode-menu');
  const skirmishPanel = byId('skirmish-panel');
  const campaignPanel = byId('campaign-panel');
  const multiplayerPanel = byId('multiplayer-panel');
  const controls = byId('title-controls');

  modeMenu?.classList.toggle('hidden', mode !== 'root');
  skirmishPanel?.classList.toggle('hidden', mode !== 'skirmish');
  campaignPanel?.classList.toggle('hidden', mode !== 'campaign');
  multiplayerPanel?.classList.toggle('hidden', mode !== 'multiplayer');
  controls?.classList.toggle('hidden', mode === 'root');
  updateCheatButtonsDisabled();
}

export function bindMainMenu(): void {
  setTitleMode('root');
  for (const modeBtn of document.querySelectorAll<HTMLButtonElement>('[data-title-mode]')) {
    modeBtn.addEventListener('click', () => {
      const raw = modeBtn.dataset.titleMode;
      const mode: TitleMode =
        raw === 'campaign' ? 'campaign' : raw === 'multiplayer' ? 'multiplayer' : 'skirmish';
      setTitleMode(mode);
    });
  }
  for (const backBtn of document.querySelectorAll<HTMLButtonElement>('[data-title-back]')) {
    backBtn.addEventListener('click', () => setTitleMode('root'));
  }
}
