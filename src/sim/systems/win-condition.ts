/**
 * Match outcome detection.
 */

import { Health, Owner } from '../components';
import { CampaignMissionId } from '../campaign';
import { AI_PLAYER_ID, LOCAL_PLAYER_ID } from '../core/constants';
import { findOwnedTownCenter } from '../core/lookup';
import { townCenterQuery } from '../core/queries';
import type { SimWorld } from '../core/types';
import { countLiveMilitary, countLiveTrackedEids } from '../world';

export function winConditionSystem(world: SimWorld): void {
  if (world.outcome.state !== 'playing') return;
  if (world.campaign?.missionId === CampaignMissionId.BATTLE_OF_BILA_HORA) {
    const playerArmy = countLiveMilitary(world, LOCAL_PLAYER_ID);
    const enemyArmy = countLiveMilitary(world, AI_PLAYER_ID);
    if (playerArmy <= 0 && enemyArmy > 0) {
      world.outcome = { state: 'victory', winnerPlayerId: AI_PLAYER_ID, mode: 'conquest' };
    } else if (enemyArmy <= 0 && playerArmy > 0) {
      world.outcome = { state: 'victory', winnerPlayerId: LOCAL_PLAYER_ID, mode: 'conquest' };
    }
    return;
  }
  if (world.campaign?.missionId === CampaignMissionId.BATTLE_OF_KUTNA_HORA) {
    const townCenter = findOwnedTownCenter(world, LOCAL_PLAYER_ID);
    if (townCenter === null) {
      world.outcome = { state: 'victory', winnerPlayerId: AI_PLAYER_ID, mode: 'conquest' };
      return;
    }
    const survived = world.campaign.objectives.find((objective) =>
      objective.id === 'survive_kutna_hora'
    )?.completed;
    if (survived) {
      world.outcome = { state: 'victory', winnerPlayerId: LOCAL_PLAYER_ID, mode: 'conquest' };
    }
    return;
  }
  if (world.campaign?.missionId === CampaignMissionId.BATTLE_OF_SUDOMER) {
    // Town defense: lose if the Town Hall falls, win by surviving every wave.
    if (findOwnedTownCenter(world, LOCAL_PLAYER_ID) === null) {
      world.outcome = { state: 'victory', winnerPlayerId: AI_PLAYER_ID, mode: 'conquest' };
      return;
    }
    const survived = world.campaign.objectives.find((objective) =>
      objective.id === 'survive_sudomer_assault'
    )?.completed;
    if (survived) {
      world.outcome = { state: 'victory', winnerPlayerId: LOCAL_PLAYER_ID, mode: 'conquest' };
    }
    return;
  }
  if (world.campaign?.missionId === CampaignMissionId.BATTLE_OF_ZBOROV) {
    // Economy trench duel: either command foundry falling decides the mission.
    const playerCommand = world.campaign.trackedObjectiveEids.hold_legion_command ?? [];
    const playerCommandDown = playerCommand.length > 0 && countLiveTrackedEids(world, playerCommand) === 0;
    if (playerCommandDown) {
      world.outcome = { state: 'victory', winnerPlayerId: AI_PLAYER_ID, mode: 'conquest' };
      return;
    }
    const bunker = world.campaign.trackedObjectiveEids.take_command_bunker ?? [];
    const bunkerDown = bunker.length > 0 && countLiveTrackedEids(world, bunker) === 0;
    if (bunkerDown) {
      world.outcome = { state: 'victory', winnerPlayerId: LOCAL_PLAYER_ID, mode: 'conquest' };
    }
    return;
  }
  // Conquest victory: only one player still has a Town Center.
  const tcs = townCenterQuery(world.ecs);
  let p1 = 0;
  let p2 = 0;
  for (const eid of tcs) {
    if (Health.hp[eid] <= 0) continue;
    const player = Owner.player[eid];
    if (player === 1) p1++;
    else if (player === 2) p2++;
  }
  if (p1 === 0 && p2 > 0) {
    world.outcome = { state: 'victory', winnerPlayerId: 2, mode: 'conquest' };
  } else if (p2 === 0 && p1 > 0) {
    world.outcome = { state: 'victory', winnerPlayerId: 1, mode: 'conquest' };
  }
}
