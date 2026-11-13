/**
 * Kingdoms - entry point. Boots Phaser with the GameScene and hands the page
 * to the DOM UI layer in src/ui (menus, HUD, panels).
 */

import Phaser from 'phaser';
import { RENDER } from './config';
import { GameScene } from './render/game-scene';
import { mountUi } from './ui';

/**
 * The playfield always fills the window. The internal height stays at
 * RENDER.HEIGHT (so the world keeps its pixel scale and zoom feel at any
 * window size); the internal width follows the window's aspect ratio,
 * clamped to 4:3 .. 21:9. Wider or narrower windows letterbox beyond that.
 */
const MIN_ASPECT = 4 / 3;
const MAX_ASPECT = 21 / 9;

function hostSize(): { w: number; h: number } {
  const host = document.getElementById('game-root');
  const w = host?.clientWidth || window.innerWidth;
  const h = host?.clientHeight || window.innerHeight;
  return { w, h };
}

function gameWidthFor(w: number, h: number): number {
  if (w <= 0 || h <= 0) return RENDER.WIDTH;
  const aspect = Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, w / h));
  // Even widths keep the centred world on whole pixels.
  return Math.round((RENDER.HEIGHT * aspect) / 2) * 2;
}

const initial = hostSize();

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: gameWidthFor(initial.w, initial.h),
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

/** Match the internal width to the host aspect, then let FIT rescale. */
function fitGameToHost(): void {
  const { w, h } = hostSize();
  const width = gameWidthFor(w, h);
  if (game.scale.width !== width || game.scale.height !== RENDER.HEIGHT) {
    game.scale.setGameSize(width, RENDER.HEIGHT);
  }
  game.scale.refresh();
}

// Phaser only rescales on window resize. A container-only resize (an
// embedded pane, a docked devtools panel) would leave the canvas at its old
// size, so refresh the scale whenever the host box changes.
const host = document.getElementById('game-root');
if (host && typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => fitGameToHost()).observe(host);
} else {
  window.addEventListener('resize', fitGameToHost);
}

// eslint-disable-next-line no-console
console.log('[Kingdoms] booted - Phaser', Phaser.VERSION);
