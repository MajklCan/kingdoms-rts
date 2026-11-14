/**
 * Who controls which player slot.
 */

import { AI_PLAYER_ID } from './constants';
import type { SimWorld } from './types';

/**
 * True when the sim's AI drives `playerId`. Player 2 is the skirmish AI; any
 * other seat only when it carries an AI state (a headless AI-vs-AI match).
 * Human seats, which is every seat in multiplayer, never are.
 */
export function isAiControlledPlayer(world: SimWorld, playerId: number): boolean {
  if (playerId <= 0 || playerId >= world.resources.length) return false;
  if (world.humanPlayers.has(playerId)) return false;
  return playerId === AI_PLAYER_ID || world.aiPlayers[playerId] != null;
}

/** True when `owner` is a rival of `playerId` (gaia, player 0, is nobody's). */
export function isRivalPlayer(owner: number, playerId: number): boolean {
  return owner > 0 && owner !== playerId;
}
