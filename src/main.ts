/**
 * Kingdoms - entry point. Boots Phaser with the GameScene and hands the page
 * to the DOM UI layer in src/ui (menus, HUD, panels).
 */

import Phaser from 'phaser';
import { RENDER } from './config';
import { GameScene } from './render/game-scene';
import { mountUi } from './ui';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: RENDER.WIDTH,
  height: RENDER.HEIGHT,
  parent: 'game-root',
  backgroundColor: RENDER.BACKGROUND_COLOR,
  // pixelArt: true -> disables antialiasing on textures + enables roundPixels.
  // Browser nearest-neighbour scales the canvas to fit instead of bilinear-
  // blurring it, so tile edges, voxel facets, and HUD elements all stay sharp.
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: {
    pixelArt: true,
    roundPixels: true,
    antialias: false,
    antialiasGL: false,
  },
  scene: [GameScene],
};

const game = new Phaser.Game(config);
mountUi(game);

// Phaser only rescales on window resize. A container-only resize (an
// embedded pane, a docked devtools panel) would leave the canvas at its old
// size, so refresh the scale whenever the host box changes.
const host = document.getElementById('game-root');
if (host && typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => game.scale.refresh()).observe(host);
}

// eslint-disable-next-line no-console
console.log('[Kingdoms] booted - Phaser', Phaser.VERSION);
