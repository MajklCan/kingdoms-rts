/** Victory / defeat modal driven by the scene's match outcome. */

import type { GameScene } from '../../render/game-scene';
import { byId } from '../dom';

let gameOverShown = false;

function showGameOver(winnerPlayerId: number, perspectivePlayerId: number): void {
  if (gameOverShown) return;
  gameOverShown = true;
  const modal = byId('game-over');
  const title = byId('game-over-title');
  const subtitle = byId('game-over-subtitle');
  if (!modal || !title || !subtitle) return;
  if (winnerPlayerId === perspectivePlayerId) {
    title.className = 'victory';
    title.textContent = 'VICTORY';
    subtitle.textContent = 'Bohemia stands triumphant. The kingdom endures.';
  } else {
    title.className = 'defeat';
    title.textContent = 'DEFEAT';
    subtitle.textContent = 'Bohemia has fallen. The realm is no more.';
  }
  modal.classList.add('show');
}

function hideGameOver(): void {
  if (!gameOverShown) return;
  gameOverShown = false;
  byId('game-over')?.classList.remove('show');
}

export function bindGameOver(): void {
  byId('game-over-play-again')?.addEventListener('click', () => location.reload());
}

export function updateGameOver(scene: GameScene, perspectivePlayerId: number): void {
  const outcome = scene.getOutcome();
  if (outcome.state === 'victory') {
    showGameOver(outcome.winnerPlayerId, perspectivePlayerId);
  } else {
    hideGameOver();
  }
}
