/**
 * The single seam between the DOM UI and the Phaser GameScene. UI modules
 * never reach for `game.scene` directly; they ask the bridge.
 */

import type Phaser from 'phaser';
import type { GameScene } from '../render/game-scene';

let gameRef: Phaser.Game | null = null;

export function attachGame(game: Phaser.Game): void {
  gameRef = game;
}

export function getScene(): GameScene | null {
  if (!gameRef) return null;
  return gameRef.scene.getScene('GameScene') as GameScene | null;
}
