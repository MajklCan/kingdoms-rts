/** Campaign mission list on the title screen. */

import { normalizeCampaignMissionId, type CampaignMissionIdValue } from '../../sim/campaign';
import { getScene } from '../game-bridge';
import { hideTitleScreen } from './main-menu';

export function parseCampaignMission(value: string | undefined): CampaignMissionIdValue {
  return normalizeCampaignMissionId(value);
}

export function bindCampaignSelect(): void {
  for (const missionBtn of document.querySelectorAll<HTMLButtonElement>('[data-campaign-mission]')) {
    missionBtn.addEventListener('click', () => {
      const missionId = parseCampaignMission(missionBtn.dataset.campaignMission);
      const scene = getScene();
      if (scene) scene.startCampaignMission(missionId);
      hideTitleScreen();
    });
  }
}
