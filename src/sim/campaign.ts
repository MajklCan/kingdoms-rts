import { AgeId, type AgeIdValue } from './defs';
import { MapId, type MapIdValue } from './map-gen';
import { TechId, type TechIdValue } from './tech-tree';

export const CampaignMissionId = {
  SIEGE_OF_BRNO: 'siege_of_brno',
  BATTLE_OF_BILA_HORA: 'battle_of_bila_hora',
  BATTLE_OF_KUTNA_HORA: 'battle_of_kutna_hora',
} as const;

export type CampaignMissionIdValue =
  (typeof CampaignMissionId)[keyof typeof CampaignMissionId];

export interface CampaignObjectiveDef {
  id: string;
  label: string;
  optional?: boolean;
}

export interface CampaignMissionDef {
  id: CampaignMissionIdValue;
  name: string;
  description: string;
  briefing: string;
  startingAge: AgeIdValue;
  enemyAge: AgeIdValue;
  mapId: MapIdValue;
  lockedTechs: TechIdValue[];
  objectives: CampaignObjectiveDef[];
}

export const CAMPAIGN_MISSIONS: CampaignMissionDef[] = [
  {
    id: CampaignMissionId.SIEGE_OF_BRNO,
    name: 'Siege of Brno',
    description: 'Break a fortified Castle Age city from a Dark Age foothold.',
    briefing:
      'Your host begins with only a town center outside Brno. The city is already built, guarded, and supplied by outer camps. Destroy those camps to slow fresh defenders, then bring down the Brno town center.',
    startingAge: AgeId.DARK,
    enemyAge: AgeId.CASTLE,
    mapId: MapId.RIVERLANDS,
    lockedTechs: [TechId.GUNPOWDER_AGE],
    objectives: [
      { id: 'destroy_brno_tc', label: 'Destroy the Brno Town Center' },
      { id: 'destroy_outer_lumber', label: 'Destroy the outer lumber camp', optional: true },
      { id: 'destroy_outer_mine', label: 'Destroy the outer mining camp', optional: true },
    ],
  },
  {
    id: CampaignMissionId.BATTLE_OF_BILA_HORA,
    name: 'Battle of Bílá Hora',
    description: 'A town-center-less defensive field battle on the road to Prague.',
    briefing:
      '8 November 1620. Christian of Anhalt has drawn the Bohemian Estates onto the White Mountain plateau west of Prague. Hold the pass with pikemen, gunmen, and cannon as Tilly and Bucquoy’s Imperial-Catholic League army advances from the far ridge.',
    startingAge: AgeId.GUNPOWDER,
    enemyAge: AgeId.GUNPOWDER,
    mapId: MapId.ORE_MOUNTAIN_PASS,
    lockedTechs: [],
    objectives: [
      { id: 'destroy_imperial_field_army', label: 'Destroy all Imperial-Catholic League troops' },
    ],
  },
  {
    id: CampaignMissionId.BATTLE_OF_KUTNA_HORA,
    name: 'Battle of Kutná Hora',
    description: 'Command a prepared Hussite city through repeated crusader assaults.',
    briefing:
      'December 1421. Jan Žižka’s Hussites are pressed near the silver city of Kutná Hora by King Sigismund’s crusading host. Hold the fortified town, keep training defenders, and break each assault wave before the city center falls.',
    startingAge: AgeId.GUNPOWDER,
    enemyAge: AgeId.GUNPOWDER,
    mapId: MapId.BOHEMIAN_BORDER_FOREST,
    lockedTechs: [],
    objectives: [
      { id: 'survive_kutna_hora', label: 'Survive all crusader assault waves' },
      { id: 'hold_kutna_hora_tc', label: 'Keep the Kutná Hora Town Center standing' },
    ],
  },
];

export function getCampaignMissionDef(
  missionId: CampaignMissionIdValue
): CampaignMissionDef | null {
  return CAMPAIGN_MISSIONS.find((mission) => mission.id === missionId) ?? null;
}

export function normalizeCampaignMissionId(
  value: string | undefined
): CampaignMissionIdValue {
  return CAMPAIGN_MISSIONS.some((mission) => mission.id === value)
    ? (value as CampaignMissionIdValue)
    : CampaignMissionId.SIEGE_OF_BRNO;
}
