/**
 * Kingdoms — entry point. Boots Phaser, mounts the GameScene, and drives all
 * DOM HUD updates each animation frame (resource bar, minimap canvas,
 * selection panel, action grid, debug overlay).
 */

import Phaser from 'phaser';
import { RENDER } from './config';
import { GameScene } from './render/game-scene';
import { setLastEvent, updateDebugOverlay, updateResourceBar } from './debug/overlay';
import { AgeId, type AgeIdValue } from './sim/defs';
import { normalizeCampaignMissionId, type CampaignMissionIdValue } from './sim/campaign';
import { TileType, normalizeMapId, type MapIdValue } from './sim/map-gen';
import { LATE_GAME_TEST_SAVE_ID, parseSavedGame } from './sim/save-load';
import { TechId, type TechIdValue } from './sim/tech-tree';
import { normalizeAiDifficulty, type AiDifficulty } from './sim/world';

const LOCAL_SAVE_KEY = 'kingdoms.manualSave.v1';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: RENDER.WIDTH,
  height: RENDER.HEIGHT,
  parent: 'game-root',
  backgroundColor: RENDER.BACKGROUND_COLOR,
  // pixelArt: true → disables antialiasing on textures + enables roundPixels.
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

// ── Title screen → unpause sim ─────────────────────────────────────────────
function hideTitleScreen(): void {
  document.getElementById('title-screen')?.classList.add('hidden');
}

function parseStartingAge(value: string | undefined): AgeIdValue {
  const parsed = Number(value);
  if (parsed === AgeId.CASTLE) return AgeId.CASTLE;
  if (parsed === AgeId.GUNPOWDER) return AgeId.GUNPOWDER;
  if (parsed === AgeId.TOTAL_WAR) return AgeId.TOTAL_WAR;
  return AgeId.DARK;
}

function parseStartingMap(value: string | undefined): MapIdValue {
  return normalizeMapId(value);
}

function parseAiDifficulty(value: string | undefined): AiDifficulty {
  return normalizeAiDifficulty(value);
}

function parseCampaignMission(value: string | undefined): CampaignMissionIdValue {
  return normalizeCampaignMissionId(value);
}

function bindTitleScreen(): void {
  const titleEl = document.getElementById('title-screen');
  const startBtn = document.getElementById('start-button');
  const ageSelect = document.getElementById('starting-age-select') as HTMLSelectElement | null;
  const mapSelect = document.getElementById('starting-map-select') as HTMLSelectElement | null;
  const difficultySelect = document.getElementById('ai-difficulty-select') as HTMLSelectElement | null;
  if (!titleEl || !startBtn) return;
  startBtn.addEventListener('click', () => {
    const startingAge = parseStartingAge(ageSelect?.value);
    const startingMap = parseStartingMap(mapSelect?.value);
    const aiDifficulty = parseAiDifficulty(difficultySelect?.value);
    const scene = game.scene.getScene('GameScene') as GameScene | null;
    if (scene) scene.startNewGame(startingAge, startingMap, aiDifficulty);
    hideTitleScreen();
  });
  for (const missionBtn of document.querySelectorAll<HTMLButtonElement>('[data-campaign-mission]')) {
    missionBtn.addEventListener('click', () => {
      const missionId = parseCampaignMission(missionBtn.dataset.campaignMission);
      const scene = game.scene.getScene('GameScene') as GameScene | null;
      if (scene) scene.startCampaignMission(missionId);
      hideTitleScreen();
    });
  }
}
bindTitleScreen();

// ── Game speed toggle ─────────────────────────────────────────────────────
function bindSpeedToggle(): void {
  const speedBtn = document.getElementById('speed-toggle');
  if (!speedBtn) return;
  speedBtn.addEventListener('click', () => {
    const scene = game.scene.getScene('GameScene') as GameScene | null;
    scene?.toggleGameSpeed();
  });
}
bindSpeedToggle();

// ── Pause toggle ──────────────────────────────────────────────────────────
function updatePauseToggle(scene: GameScene): void {
  const pauseBtn = document.getElementById('pause-toggle') as HTMLButtonElement | null;
  if (!pauseBtn) return;
  const paused = scene.isPaused();
  pauseBtn.textContent = paused ? 'Resume' : 'Pause';
  pauseBtn.classList.toggle('active', paused);
  pauseBtn.setAttribute('aria-pressed', paused ? 'true' : 'false');
  pauseBtn.setAttribute('aria-label', paused ? 'Resume game' : 'Pause game');
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
}

function togglePausedFromUi(): void {
  const scene = game.scene.getScene('GameScene') as GameScene | null;
  if (!scene) return;
  const paused = !scene.isPaused();
  scene.setPaused(paused);
  setLastEvent(paused ? 'paused' : 'resumed');
  updatePauseToggle(scene);
}

function bindPauseToggle(): void {
  const pauseBtn = document.getElementById('pause-toggle');
  pauseBtn?.addEventListener('click', togglePausedFromUi);
  window.addEventListener('keydown', (ev) => {
    if (ev.key.toLowerCase() !== 'p') return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey || isTextEntryTarget(ev.target)) return;
    ev.preventDefault();
    togglePausedFromUi();
  });
}
bindPauseToggle();

// ── Technology tree ───────────────────────────────────────────────────────
type VoxelBlock = [number, number, string];
type ResourceIconKey = 'food' | 'wood' | 'gold' | 'stone';

const TECH_ICON_BLOCKS: Record<string, VoxelBlock[]> = {
  lumber: [[1, 4, '#6b3f1f'], [2, 4, '#6b3f1f'], [3, 3, '#2f7d38'], [4, 2, '#3d9a49'], [5, 3, '#2f7d38'], [4, 4, '#2b6d32']],
  stone: [[2, 4, '#8d939a'], [3, 3, '#b2b8be'], [4, 4, '#6f767d'], [5, 3, '#9fa6ad']],
  barracks: [[2, 4, '#8c5a2b'], [3, 3, '#b78343'], [4, 3, '#b78343'], [5, 4, '#8c5a2b'], [3, 2, '#d0b078'], [4, 2, '#d0b078']],
  house: [[2, 4, '#c7a56b'], [3, 4, '#a97843'], [4, 4, '#6b3f1f'], [5, 4, '#a97843'], [2, 3, '#e1c17c'], [3, 3, '#c7a56b'], [4, 3, '#a97843'], [5, 3, '#6b3f1f'], [1, 2, '#d56c43'], [2, 1, '#c65636'], [3, 1, '#a6402c'], [4, 1, '#7f3128'], [5, 2, '#4d1c16']],
  archer: [[2, 4, '#7a4b27'], [3, 3, '#caa46a'], [4, 2, '#3d7ecb'], [5, 3, '#caa46a'], [5, 1, '#e5d3a4']],
  axe: [[2, 4, '#7a4b27'], [3, 3, '#7a4b27'], [4, 2, '#bfc6cc'], [5, 1, '#dce2e7'], [5, 2, '#9aa3aa']],
  pick: [[2, 4, '#7a4b27'], [3, 3, '#7a4b27'], [4, 2, '#9aa3aa'], [5, 2, '#c6cdd3'], [3, 1, '#c6cdd3']],
  castle: [[2, 4, '#8f7858'], [3, 3, '#b79b70'], [4, 3, '#8f7858'], [5, 4, '#b79b70'], [2, 2, '#d1ba86'], [5, 2, '#d1ba86']],
  gold: [[2, 4, '#9f7a16'], [3, 3, '#d6a91e'], [4, 4, '#f1c84b'], [5, 3, '#b98918'], [4, 2, '#ffe07a']],
  horse: [[2, 4, '#5b341c'], [3, 3, '#8b542b'], [4, 3, '#8b542b'], [5, 4, '#5b341c'], [5, 2, '#d0d5da'], [3, 2, '#2e86de']],
  farm: [[1, 4, '#7a4b27'], [2, 3, '#3f8d3a'], [3, 4, '#6bbf52'], [4, 3, '#d8b253'], [5, 4, '#6bbf52']],
  mill: [[1, 4, '#8f7858'], [2, 4, '#b79b70'], [3, 4, '#8f7858'], [4, 4, '#6b3f1f'], [5, 4, '#8f7858'], [3, 2, '#d8ba72'], [4, 1, '#caa45d'], [5, 2, '#8c5a2b']],
  gunpowder: [[1, 4, '#34383b'], [2, 4, '#5f6569'], [3, 4, '#34383b'], [4, 4, '#5f6569'], [5, 4, '#34383b'], [3, 3, '#9aa0a8'], [4, 2, '#d6a51f'], [5, 1, '#f06a43']],
};

const BUILDING_ICON_BLOCKS: Record<string, VoxelBlock[]> = {
  lumberCamp: [
    [2, 1, '#d8ba72'], [3, 1, '#caa45d'], [1, 2, '#b88748'], [2, 2, '#e0c37a'], [3, 2, '#d0a95f'], [4, 2, '#9b6230'],
    [1, 3, '#805026'], [2, 3, '#a56832'], [3, 3, '#6b3f1f'], [4, 3, '#805026'],
    [1, 4, '#b97b3a'], [2, 4, '#6f3f20'], [3, 4, '#9c632f'], [4, 4, '#4a2815'],
    [5, 2, '#2f7d38'], [6, 2, '#3d9a49'], [5, 3, '#27642e'], [6, 3, '#2f7d38'], [5, 4, '#6b3f1f'],
  ],
  stoneQuarry: [
    [2, 1, '#aeb5bb'], [3, 1, '#d3d7db'], [4, 1, '#8d939a'],
    [1, 2, '#7d858d'], [2, 2, '#b7bdc2'], [3, 2, '#4a4f55'], [4, 2, '#666d74'], [5, 2, '#9aa2aa'],
    [1, 3, '#676f77'], [2, 3, '#2b2f34'], [3, 3, '#1b1d21'], [4, 3, '#30343a'], [5, 3, '#858d95'],
    [2, 4, '#555c63'], [3, 4, '#22262b'], [4, 4, '#5f666d'], [5, 4, '#c4c9ce'],
  ],
  house: [
    // Roof Top
    [3, 0, '#d56c43'], [4, 0, '#c65636'],
    // Roof Upper Slope
    [2, 1, '#d56c43'], [3, 1, '#c65636'], [4, 1, '#a6402c'], [5, 1, '#7f3128'],
    // Roof Lower Slope
    [1, 2, '#d56c43'], [2, 2, '#c65636'], [3, 2, '#a6402c'], [4, 2, '#a6402c'], [5, 2, '#7f3128'], [6, 2, '#4d1c16'],
    // Timber Walls
    [2, 3, '#e1c17c'], [3, 3, '#c7a56b'], [4, 3, '#a97843'], [5, 3, '#6b3f1f'],
    [2, 4, '#c7a56b'], [3, 4, '#c7a56b'], [4, 4, '#a97843'], [5, 4, '#6b3f1f'],
    // Door
    [3, 5, '#6b3f1f'], [4, 5, '#4a2815'],
    // Foundation
    [1, 4, '#8d939a'], [6, 4, '#6f767d'],
    [1, 5, '#8d939a'], [2, 5, '#6f767d'], [5, 5, '#6f767d'], [6, 5, '#4a4f55'],
  ],
  barracks: [
    [1, 1, '#9e3f2f'], [2, 1, '#bd5939'], [3, 1, '#d36b43'], [4, 1, '#bd5939'], [5, 1, '#8f3429'],
    [1, 2, '#d2ad68'], [2, 2, '#e0c07a'], [3, 2, '#c59452'], [4, 2, '#e0c07a'], [5, 2, '#b78343'],
    [1, 3, '#8c5a2b'], [2, 3, '#a56832'], [3, 3, '#6b3f1f'], [4, 3, '#a56832'], [5, 3, '#8c5a2b'],
    [2, 4, '#2f79c7'], [3, 4, '#244f85'], [5, 4, '#c7d0d8'], [5, 5, '#6f3f20'],
  ],
  archeryRange: [
    [1, 2, '#b88748'], [2, 1, '#d8ba72'], [3, 1, '#caa45d'], [4, 2, '#8c5a2b'],
    [1, 3, '#7a4b27'], [2, 3, '#9c632f'], [3, 3, '#6f3f20'],
    [5, 1, '#d8d0ba'], [5, 2, '#9e3f2f'], [4, 2, '#e5d3a4'], [6, 2, '#e5d3a4'], [5, 3, '#e5d3a4'],
    [3, 4, '#6b3f1f'], [4, 4, '#c7d0d8'], [5, 4, '#6b3f1f'],
  ],
  goldMine: [
    [1, 1, '#8d8580'], [2, 1, '#b5afa6'], [3, 1, '#756d67'], [4, 1, '#9d948d'],
    [1, 2, '#6b5f56'], [2, 2, '#2a2520'], [3, 2, '#1a1714'], [4, 2, '#40362f'], [5, 2, '#776a5f'],
    [2, 3, '#1c1916'], [3, 3, '#29231e'], [4, 3, '#5d5249'],
    [5, 3, '#d6a51f'], [6, 3, '#f4d35e'], [4, 4, '#9c7214'], [5, 4, '#ffd45a'],
  ],
  stable: [
    [2, 0, '#8f4b2e'], [3, 0, '#b45f35'], [4, 0, '#8f4b2e'],
    [1, 1, '#c69a58'], [2, 1, '#e0bd72'], [3, 1, '#c69a58'], [4, 1, '#e0bd72'], [5, 1, '#9f6b38'],
    [1, 2, '#6b3f1f'], [2, 2, '#8c5429'], [3, 2, '#8c5429'], [4, 2, '#5a3219'], [5, 2, '#8b542b'],
    [1, 3, '#5b341c'], [2, 3, '#8b542b'], [3, 3, '#8b542b'], [4, 3, '#6b3f1f'], [5, 3, '#3a2417'],
    [2, 4, '#2a1a12'], [4, 4, '#2a1a12'], [5, 4, '#1f1611'],
  ],
  farm: [
    [1, 1, '#4a3018'], [2, 1, '#6f4a26'], [3, 1, '#4a3018'], [4, 1, '#6f4a26'], [5, 1, '#4a3018'],
    [1, 2, '#7e5a32'], [2, 2, '#6a8c40'], [3, 2, '#9c7848'], [4, 2, '#d9b76e'], [5, 2, '#7e5a32'],
    [1, 3, '#563c20'], [2, 3, '#547034'], [3, 3, '#7e5a32'], [4, 3, '#a68850'], [5, 3, '#563c20'],
    [1, 4, '#7e5a32'], [2, 4, '#6a8c40'], [3, 4, '#9c7848'], [4, 4, '#d9b76e'], [5, 4, '#7e5a32'],
    [1, 5, '#4a3018'], [2, 5, '#6f4a26'], [3, 5, '#4a3018'], [4, 5, '#6f4a26'], [5, 5, '#4a3018'],
  ],
  mill: [
    [1, 4, '#7e5a32'], [2, 4, '#b79b70'], [3, 4, '#8f7858'], [4, 4, '#b79b70'], [5, 4, '#6b3f1f'],
    [1, 3, '#8f7858'], [2, 3, '#d1ba86'], [3, 3, '#b79b70'], [4, 3, '#8f7858'], [5, 3, '#7e5a32'],
    [2, 2, '#d8ba72'], [3, 1, '#caa45d'], [4, 2, '#8c5a2b'],
    [3, 3, '#6f4a26'], [4, 2, '#f1dfb0'], [5, 1, '#d8d0ba'], [5, 3, '#f1dfb0'],
  ],
  foundry: [
    [3, 0, '#ffb13d'], [2, 1, '#f06a43'], [3, 1, '#ffd45a'], [4, 1, '#d94b2b'], [5, 1, '#6e7479'],
    [1, 2, '#8a9299'], [2, 2, '#4a5055'], [3, 2, '#34383b'], [4, 2, '#5f6569'], [5, 2, '#9aa3aa'],
    [1, 3, '#4a5055'], [2, 3, '#202327'], [3, 3, '#d6a51f'], [4, 3, '#202327'], [5, 3, '#5f6569'],
    [2, 4, '#34383b'], [3, 4, '#5f6569'], [4, 4, '#34383b'],
  ],
  defensiveTower: [
    [2, 0, '#b8c0c8'], [4, 0, '#b8c0c8'], [2, 1, '#8d969f'], [3, 1, '#c7cdd3'], [4, 1, '#8d969f'],
    [2, 2, '#9aa3aa'], [3, 2, '#4a5259'], [4, 2, '#b8c0c8'],
    [2, 3, '#808890'], [3, 3, '#2e3338'], [4, 3, '#9aa3aa'],
    [1, 4, '#6d757d'], [2, 4, '#aeb6bd'], [3, 4, '#858d95'], [4, 4, '#aeb6bd'], [5, 4, '#6d757d'],
  ],
  townCenter: [
    // Left Tower Roof
    [1, 0, '#4ecdc4'], [2, 0, '#2e86de'],
    [1, 1, '#2e86de'], [2, 1, '#1b5d9e'],
    // Right Tower Roof
    [5, 0, '#2e86de'], [6, 0, '#1b5d9e'],
    [5, 1, '#1b5d9e'], [6, 1, '#103e6b'],
    // Central Roof
    [3, 1, '#4ecdc4'], [4, 1, '#2e86de'],
    [3, 2, '#2e86de'], [4, 2, '#1b5d9e'],
    // Left Tower Body
    [1, 2, '#e1c17c'], [2, 2, '#c7a56b'],
    [1, 3, '#c7a56b'], [2, 3, '#a97843'],
    [1, 4, '#a97843'], [2, 4, '#6b3f1f'],
    // Right Tower Body
    [5, 2, '#c7a56b'], [6, 2, '#a97843'],
    [5, 3, '#a97843'], [6, 3, '#6b3f1f'],
    [5, 4, '#6b3f1f'], [6, 4, '#4a2815'],
    // Central Hall Stone Walls
    [3, 3, '#e1c17c'], [4, 3, '#c7a56b'],
    [3, 4, '#c7a56b'], [4, 4, '#a97843'],
    [3, 5, '#a97843'], [4, 5, '#6b3f1f'],
    // Central Gate
    [3, 6, '#4a2815'], [4, 6, '#28140a'],
    // Foundations
    [0, 5, '#6b3f1f'], [7, 5, '#4a2815'],
    [1, 5, '#6b3f1f'], [2, 5, '#6b3f1f'], [5, 5, '#4a2815'], [6, 5, '#4a2815'],
    [2, 6, '#4a2815'], [5, 6, '#28140a'],
  ],
};

const RESOURCE_ICON_BLOCKS: Record<ResourceIconKey, VoxelBlock[]> = {
  food: [
    [2, 1, '#3e8f3f'], [3, 1, '#55b85a'],
    [1, 3, '#a92d2d'], [2, 3, '#d64a39'], [3, 2, '#f06a43'],
    [4, 3, '#b93832'], [3, 4, '#7b2d20'],
  ],
  wood: [
    [1, 2, '#5a3219'], [2, 2, '#8f5a2d'], [3, 2, '#b8793a'], [4, 2, '#7a451f'],
    [1, 3, '#c58a4b'], [2, 3, '#6f3f20'], [3, 3, '#8b532b'], [4, 3, '#4a2815'],
    [2, 4, '#6a3d20'], [3, 4, '#9c632f'], [4, 4, '#c58a4b'], [5, 4, '#5a3219'],
  ],
  gold: [
    [2, 2, '#9c7214'], [3, 1, '#f4d35e'], [4, 2, '#d6a51f'],
    [2, 4, '#b88719'], [3, 3, '#ffd45a'], [4, 4, '#936814'],
  ],
  stone: [
    [1, 4, '#676f77'], [2, 3, '#9aa2aa'], [3, 2, '#c4c9ce'],
    [4, 3, '#858d95'], [5, 4, '#5e656c'], [3, 4, '#aeb5bb'],
  ],
};

const RESOURCE_TOKEN_TO_ICON: Record<string, ResourceIconKey> = {
  f: 'food',
  food: 'food',
  w: 'wood',
  wood: 'wood',
  g: 'gold',
  gold: 'gold',
  s: 'stone',
  stone: 'stone',
};

const TECH_TREE_LINKS: Array<{
  from: TechIdValue;
  to: TechIdValue;
  branch: 'military' | 'housing' | 'economy' | 'food' | 'castle' | 'gunpowder';
}> = [
  { from: TechId.BARRACKS_PIKEMEN, to: TechId.ARCHERS, branch: 'military' },
  { from: TechId.ARCHERS, to: TechId.CASTLE_AGE, branch: 'military' },
  { from: TechId.HOUSING_I, to: TechId.HOUSING_II, branch: 'housing' },
  { from: TechId.LUMBER_CREWS, to: TechId.MINING_CREWS, branch: 'economy' },
  { from: TechId.MINING_CREWS, to: TechId.CASTLE_AGE, branch: 'economy' },
  { from: TechId.CASTLE_AGE, to: TechId.GOLD_MINES, branch: 'castle' },
  { from: TechId.GOLD_MINES, to: TechId.KNIGHTS, branch: 'castle' },
  { from: TechId.FARMS, to: TechId.FARMS_II, branch: 'food' },
  { from: TechId.FARMS_II, to: TechId.MILLS, branch: 'food' },
  { from: TechId.KNIGHTS, to: TechId.GUNPOWDER_AGE, branch: 'gunpowder' },
];

function renderResourceIcon(kind: ResourceIconKey, size: 'bar' | 'mini' = 'mini'): string {
  const label = kind[0].toUpperCase() + kind.slice(1);
  return `<span class="resource-icon ${kind} ${size}" aria-label="${label}" title="${label}">${RESOURCE_ICON_BLOCKS[kind]
    .map(([x, y, color]) => `<i style="--x:${x};--y:${y};--c:${color}"></i>`)
    .join('')}</span>`;
}

function installStaticResourceIcons(): void {
  for (const slot of document.querySelectorAll<HTMLElement>('[data-resource-icon]')) {
    const kind = slot.dataset.resourceIcon as ResourceIconKey | undefined;
    if (!kind || !(kind in RESOURCE_ICON_BLOCKS)) continue;
    slot.innerHTML = renderResourceIcon(kind, 'bar');
  }
}

function renderResourceCost(cost: string): string {
  const clean = cost.trim();
  if (!clean) return '';
  if (clean.toLowerCase() === 'free') return '<span class="cost-free">Free</span>';
  const items: string[] = [];
  const tokenRe = /(\d+)\s*(food|wood|gold|stone|[fwgs])/gi;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(clean)) !== null) {
    const amount = match[1];
    const kind = RESOURCE_TOKEN_TO_ICON[match[2].toLowerCase()];
    if (!kind) continue;
    items.push(
      `<span class="resource-cost-item">${renderResourceIcon(kind, 'mini')}<span class="amount">${amount}</span></span>`
    );
  }
  if (items.length === 0) return clean;
  return `<span class="resource-cost">${items.join(' ')}</span>`;
}

installStaticResourceIcons();

function bindTechTreeControls(): void {
  const panel = document.getElementById('tech-tree-panel');
  const toggle = document.getElementById('tech-toggle') as HTMLButtonElement | null;
  const close = document.getElementById('tech-close') as HTMLButtonElement | null;
  if (!panel || !toggle || !close) return;
  const setOpen = (open: boolean) => {
    panel.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  toggle.addEventListener('click', () => setOpen(!panel.classList.contains('open')));
  close.addEventListener('click', () => setOpen(false));
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && panel.classList.contains('open')) setOpen(false);
  });
}
bindTechTreeControls();

// ── Mission card ──────────────────────────────────────────────────────────
const missionPanelEl = document.getElementById('mission-panel');
const missionBodyEl = document.getElementById('mission-body');
const missionToggleEl = document.getElementById('mission-toggle') as HTMLButtonElement | null;
let lastMissionSig = '';
let lastMissionId = '';

function setMissionPanelOpen(open: boolean): void {
  if (!missionPanelEl || !missionToggleEl) return;
  missionPanelEl.classList.toggle('open', open);
  missionToggleEl.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function bindMissionControls(): void {
  const close = document.getElementById('mission-close') as HTMLButtonElement | null;
  if (!missionPanelEl || !missionToggleEl || !close) return;
  missionToggleEl.addEventListener('click', () => {
    setMissionPanelOpen(!missionPanelEl.classList.contains('open'));
  });
  close.addEventListener('click', () => setMissionPanelOpen(false));
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && missionPanelEl.classList.contains('open')) setMissionPanelOpen(false);
  });
}
bindMissionControls();

// ── Save / load controls ──────────────────────────────────────────────────
function bindSaveLoadControls(): void {
  const saveBtn = document.getElementById('save-game-button') as HTMLButtonElement | null;
  const loadBtn = document.getElementById('load-game-button') as HTMLButtonElement | null;
  const slotSelect = document.getElementById('save-slot-select') as HTMLSelectElement | null;
  if (!saveBtn || !loadBtn || !slotSelect) return;

  const refreshManualSlot = () => {
    const manualOption = slotSelect.querySelector<HTMLOptionElement>('option[value="manual"]');
    if (!manualOption) return;
    const saved = localStorage.getItem(LOCAL_SAVE_KEY);
    manualOption.disabled = saved === null;
    manualOption.textContent = saved === null ? 'Manual Save (empty)' : 'Manual Save';
    if (slotSelect.value === 'manual' && saved === null) {
      slotSelect.value = LATE_GAME_TEST_SAVE_ID;
    }
  };

  saveBtn.addEventListener('click', () => {
    const scene = game.scene.getScene('GameScene') as GameScene | null;
    if (!scene) return;
    const snapshot = scene.createSaveSnapshot('Manual Save');
    localStorage.setItem(LOCAL_SAVE_KEY, JSON.stringify(snapshot));
    refreshManualSlot();
    slotSelect.value = 'manual';
    setLastEvent('manual save written');
  });

  loadBtn.addEventListener('click', () => {
    const scene = game.scene.getScene('GameScene') as GameScene | null;
    if (!scene) return;
    hideTitleScreen();

    if (slotSelect.value === LATE_GAME_TEST_SAVE_ID) {
      scene.loadLateGameTestSave();
      return;
    }

    const raw = localStorage.getItem(LOCAL_SAVE_KEY);
    const snapshot = raw ? parseSavedGame(raw) : null;
    if (!snapshot) {
      refreshManualSlot();
      setLastEvent('no valid manual save');
      return;
    }
    scene.loadSaveSnapshot(snapshot, 'Manual Save');
  });

  refreshManualSlot();
}
bindSaveLoadControls();

// ── Cheat controls ────────────────────────────────────────────────────────
function bindCheatControls(): void {
  const revealBtn = document.getElementById('cheat-reveal-map') as HTMLButtonElement | null;
  const resourcesBtn = document.getElementById('cheat-add-resources') as HTMLButtonElement | null;
  const cavalryBtn = document.getElementById('cheat-spawn-cavalry') as HTMLButtonElement | null;
  const machineGunBtn = document.getElementById('cheat-spawn-machine-gun') as HTMLButtonElement | null;
  const dumpBtn = document.getElementById('cheat-dump-state') as HTMLButtonElement | null;
  if (!revealBtn || !resourcesBtn || !cavalryBtn || !machineGunBtn || !dumpBtn) return;

  const getScene = () => game.scene.getScene('GameScene') as GameScene | null;
  revealBtn.addEventListener('click', () => getScene()?.cheatRevealMap(1));
  resourcesBtn.addEventListener('click', () => getScene()?.cheatAddResources(1, 500));
  cavalryBtn.addEventListener('click', () => getScene()?.cheatSpawnCavalryByTownHall(1));
  machineGunBtn.addEventListener('click', () => getScene()?.cheatSpawnMachineGunByTownHall(1));
  dumpBtn.addEventListener('click', () => {
    const scene = getScene();
    if (!scene) return;
    const snapshot = scene.createSaveSnapshot('Debug Dump');
    const gameApi = (window as unknown as {
      __GAME__?: { debugDump?: () => Record<string, unknown> };
    }).__GAME__;
    const payload = {
      debug: gameApi?.debugDump?.() ?? null,
      save: snapshot,
    };
    downloadTextFile(
      `kingdoms-state-${snapshot.tick}.json`,
      JSON.stringify(payload, null, 2),
      'application/json'
    );
    setLastEvent(`debug dump downloaded (${snapshot.tick})`);
  });
}
bindCheatControls();

function downloadTextFile(filename: string, text: string, mimeType: string): void {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// ── Game-over modal ────────────────────────────────────────────────────────
let gameOverShown = false;
function showGameOver(
  winnerPlayerId: number,
  _mode: 'conquest'
): void {
  if (gameOverShown) return;
  gameOverShown = true;
  const modal = document.getElementById('game-over');
  const title = document.getElementById('game-over-title');
  const subtitle = document.getElementById('game-over-subtitle');
  if (!modal || !title || !subtitle) return;
  if (winnerPlayerId === 1) {
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

// ── Debug overlay toggle (backtick key) ────────────────────────────────────
window.addEventListener('keydown', (ev) => {
  if (ev.key === '`' || ev.key === '~') {
    const dbg = document.getElementById('debug-overlay');
    dbg?.classList.toggle('hidden');
  }
});

// ── Minimap canvas ─────────────────────────────────────────────────────────
const minimapCanvas = document.getElementById('minimap-canvas') as HTMLCanvasElement | null;
const minimapCtx = minimapCanvas?.getContext('2d') ?? null;
const MM_SIZE = 170;

const TILE_COLORS: Record<number, string> = {
  [TileType.GRASS]:         '#547034',
  [TileType.FOREST]:        '#2b3a18',
  [TileType.DIRT]:          '#7e5a32',
  [TileType.SAND]:          '#c4ab70',
  [TileType.WATER]:         '#1f4870',
  [TileType.WATER_SHALLOW]: '#346e98',
  [TileType.STONE]:         '#8c8a82',
  [TileType.BRIDGE]:        '#7e5a32',
};

const TEAM_HEX: Record<number, string> = {
  0: '#b0a68a',
  1: '#2e86de',
  2: '#ee5253',
};

let mmFrame = 0;
function renderMinimap(scene: GameScene): void {
  if (!minimapCtx) return;
  mmFrame++;
  if (mmFrame % 6 !== 0) return; // throttle to ~10 fps
  const data = scene.getMinimapData();
  const tileSize = MM_SIZE / Math.max(data.mapW, data.mapH);
  minimapCtx.fillStyle = '#0a0810';
  minimapCtx.fillRect(0, 0, MM_SIZE, MM_SIZE);
  // Terrain
  for (let y = 0; y < data.mapH; y++) {
    for (let x = 0; x < data.mapW; x++) {
      const t = data.tiles[y * data.mapW + x];
      minimapCtx.fillStyle = TILE_COLORS[t] ?? '#000';
      minimapCtx.fillRect(
        Math.floor(x * tileSize),
        Math.floor(y * tileSize),
        Math.ceil(tileSize),
        Math.ceil(tileSize)
      );
    }
  }
  // Entities — units brighter, buildings as squares, resources as small dots.
  for (const e of data.entities) {
    const sx = Math.floor(e.x * tileSize);
    const sy = Math.floor(e.y * tileSize);
    if (e.kind === 3) {
      // Building — 3x3 square in team color
      minimapCtx.fillStyle = TEAM_HEX[e.player] ?? '#fff';
      minimapCtx.fillRect(sx - 1, sy - 1, 4, 4);
      minimapCtx.strokeStyle = '#000';
      minimapCtx.lineWidth = 0.5;
      minimapCtx.strokeRect(sx - 1, sy - 1, 4, 4);
    } else if (e.kind === 1 || e.kind === 2) {
      // Unit — small filled circle
      minimapCtx.fillStyle = TEAM_HEX[e.player] ?? '#fff';
      minimapCtx.beginPath();
      minimapCtx.arc(sx, sy, e.kind === 2 ? 1.5 : 1.2, 0, Math.PI * 2);
      minimapCtx.fill();
    }
    // Resources are baked into terrain colors via FOREST/STONE/etc.; skip extra dots.
  }
  for (const alert of data.combatAlerts) {
    const sx = Math.floor(alert.x * tileSize);
    const sy = Math.floor(alert.y * tileSize);
    const pulse = 1 - alert.age;
    const radius = 4 + 10 * pulse;
    minimapCtx.strokeStyle = `rgba(255, 54, 54, ${0.25 + 0.65 * pulse})`;
    minimapCtx.lineWidth = 1.5;
    minimapCtx.beginPath();
    minimapCtx.arc(sx, sy, radius, 0, Math.PI * 2);
    minimapCtx.stroke();
    minimapCtx.fillStyle = `rgba(255, 230, 110, ${0.35 + 0.45 * pulse})`;
    minimapCtx.fillRect(sx - 1, sy - 1, 3, 3);
  }
}

// Minimap click → pan camera to that tile.
minimapCanvas?.addEventListener('click', (ev) => {
  const scene = game.scene.getScene('GameScene') as GameScene | null;
  if (!scene) return;
  const rect = minimapCanvas.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  const y = ev.clientY - rect.top;
  const data = scene.getMinimapData();
  const tileSize = MM_SIZE / Math.max(data.mapW, data.mapH);
  const tx = Math.floor(x / tileSize);
  const ty = Math.floor(y / tileSize);
  scene.panToTile(tx, ty);
});

// ── Selection panel ────────────────────────────────────────────────────────
function updateSelectionPanel(scene: GameScene): void {
  const panel = document.getElementById('selection-panel');
  const glyph = document.getElementById('sel-glyph');
  const countBadge = document.getElementById('sel-count');
  const nameEl = document.getElementById('sel-name');
  const hpFill = document.getElementById('sel-hp-fill');
  const statsEl = document.getElementById('sel-stats');
  if (!panel || !glyph || !countBadge || !nameEl || !hpFill || !statsEl) return;
  const info = scene.getSelectionInfo();
  if (info.kind === 'none') {
    panel.classList.add('empty');
    return;
  }
  panel.classList.remove('empty');
  glyph.textContent = info.glyph;
  if (info.count > 1) {
    countBadge.classList.add('show');
    countBadge.textContent = '×' + info.count;
  } else {
    countBadge.classList.remove('show');
  }
  nameEl.textContent = info.name;
  // HP bar.
  if (info.hpMax > 0) {
    const frac = Math.max(0, Math.min(1, info.hp / info.hpMax));
    (hpFill as HTMLElement).style.width = (frac * 100).toFixed(0) + '%';
    (hpFill as HTMLElement).style.background =
      frac > 0.6 ? '#4caf50' : frac > 0.3 ? '#ffc107' : '#ff4757';
    statsEl.textContent = `HP ${info.hp}/${info.hpMax}  ${info.stats}`;
  } else {
    (hpFill as HTMLElement).style.width = '0%';
    statsEl.textContent = info.stats || '—';
  }
}

// ── Action grid ────────────────────────────────────────────────────────────
const actionGridEl = document.getElementById('action-grid');
let lastActionsKey = '';
function updateActionGrid(scene: GameScene): void {
  if (!actionGridEl) return;
  const actions = scene.getAvailableActions();
  // Build a signature so we only rebuild on change.
  const sig = actions
    .map((a) =>
      [
        a.id,
        a.kind,
        a.label,
        a.enabled ? 1 : 0,
        a.cost ?? '',
        a.meta ?? '',
        a.queue ?? 0,
        a.active ? 1 : 0,
        a.disabledReason ?? '',
        a.hudIcon ?? '',
      ].join(':')
    )
    .join(',') || 'empty';
  if (sig === lastActionsKey) return;
  lastActionsKey = sig;
  actionGridEl.innerHTML = '';

  const hasTraining = actions.some((a) => a.kind === 'train');
  actionGridEl.classList.toggle('training-mode', hasTraining);

  const header = document.createElement('div');
  header.className = 'action-header';
  const title = document.createElement('span');
  title.textContent = hasTraining ? 'Production' : 'Actions';
  const detail = document.createElement('small');
  detail.textContent = hasTraining ? `${actions.filter((a) => a.kind === 'train').length} unit types` : `${actions.length} available`;
  header.append(title, detail);
  actionGridEl.appendChild(header);

  const cells = document.createElement('div');
  cells.className = 'action-cells' + (hasTraining ? ' training-cells' : '');
  actionGridEl.appendChild(cells);

  const slotCount = hasTraining ? Math.max(4, Math.min(6, actions.length + (actions.length % 2))) : 12;
  for (let i = 0; i < slotCount; i++) {
    const a = actions[i];
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cell' +
      (a ? ` ${a.kind}-card` : ' empty') +
      (a?.active ? ' active' : '') +
      (a && a.enabled ? '' : ' disabled');
    if (a) {
      cell.disabled = !a.enabled;
      cell.title = a.disabledReason ? `${a.label} - ${a.disabledReason}` : a.label;
      cell.dataset.actionId = a.id;

      const key = document.createElement('span');
      key.className = 'key';
      key.textContent = a.key;

      const icon = document.createElement('span');
      if (a.hudIcon) {
        icon.className = 'icon voxel-action-icon-wrap';
        icon.innerHTML = renderHudVoxelIcon(a.hudIcon);
      } else {
        icon.className = 'icon';
        icon.textContent = a.glyph;
      }

      const body = document.createElement('span');
      body.className = 'action-body';
      const label = document.createElement('span');
      label.className = 'action-label';
      label.textContent = a.kind === 'build'
        ? a.label.replace(/^Build\s+/, '')
        : a.label.replace(/^Train\s+/, '');
      body.appendChild(label);
      if (a.meta || a.disabledReason) {
        const meta = document.createElement('span');
        meta.className = 'action-meta';
        meta.textContent = a.enabled ? (a.meta ?? '') : (a.disabledReason ?? a.meta ?? '');
        body.appendChild(meta);
      }

      cell.append(key, icon, body);

      if (a.cost) {
        const cost = document.createElement('span');
        cost.className = 'cost';
        cost.innerHTML = renderResourceCost(a.cost);
        cell.appendChild(cost);
      }

      if ((a.queue ?? 0) > 0) {
        const queue = document.createElement('span');
        queue.className = 'queue-badge';
        queue.textContent = String(a.queue);
        cell.appendChild(queue);
      }

      const tooltip = document.createElement('span');
      tooltip.className = 'tooltip';
      tooltip.textContent = a.disabledReason ? `${a.label}: ${a.disabledReason}` : a.label;
      cell.appendChild(tooltip);

      if (a.enabled) {
        cell.addEventListener('click', () => scene.triggerAction(a.id));
      }
    } else {
      cell.disabled = true;
    }
    cells.appendChild(cell);
  }
}

// ── Tech tree panel ────────────────────────────────────────────────────────
const techTreeBoardEl = document.getElementById('tech-tree-board');
let lastTechTreeSig = '';
const TECH_TREE_CANVAS_WIDTH = 1720;
const TECH_TREE_CANVAS_HEIGHT = 680;
const TECH_TREE_NODE_WIDTH = 250;
const TECH_TREE_NODE_HEIGHT = 84;
const TECH_TREE_X_SCALE = 14;
const TECH_TREE_Y_SCALE = 4;
const TECH_TREE_LEFT_PAD = 12;
const TECH_TREE_TOP_PAD = 20;

function renderVoxelIcon(icon: string): string {
  const blocks = TECH_ICON_BLOCKS[icon] ?? TECH_ICON_BLOCKS.stone;
  return renderBlockIcon(blocks, 'voxel-icon');
}

function renderHudVoxelIcon(icon: string): string {
  const blocks = BUILDING_ICON_BLOCKS[icon] ?? BUILDING_ICON_BLOCKS.house;
  return renderBlockIcon(blocks, 'hud-voxel-icon');
}

function renderBlockIcon(blocks: VoxelBlock[], className: string): string {
  return `<span class="${className}" aria-hidden="true">${blocks
    .map(([x, y, color]) => `<i style="--x:${x};--y:${y};--c:${color}"></i>`)
    .join('')}</span>`;
}

function techTreePoint(node: { x: number; y: number }): { x: number; y: number } {
  return {
    x: TECH_TREE_LEFT_PAD + node.x * TECH_TREE_X_SCALE,
    y: TECH_TREE_TOP_PAD + node.y * TECH_TREE_Y_SCALE,
  };
}

function renderTechTree(scene: GameScene): void {
  if (!techTreeBoardEl) return;
  const nodes = scene.getTechTree(1);
  const sig = nodes
    .map((node) =>
      `${node.id}:${node.status}:${node.affordable ? 1 : 0}:${Math.floor(node.progressFrac * 100)}`
    )
    .join('|');
  if (sig === lastTechTreeSig) return;
  lastTechTreeSig = sig;

  const byId = new Map<TechIdValue, (typeof nodes)[number]>();
  for (const node of nodes) byId.set(node.id, node);

  const linkParts: string[] = [];
  const cardEdgeX = TECH_TREE_NODE_WIDTH / 2;
  const cardEdgeY = TECH_TREE_NODE_HEIGHT / 2;
  const formatPoints = (points: Array<[number, number]>) =>
    points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const addLink = (
    fromId: TechIdValue,
    toId: TechIdValue,
    branch: 'military' | 'housing' | 'economy' | 'food' | 'castle' | 'gunpowder'
  ) => {
    const from = byId.get(fromId);
    const to = byId.get(toId);
    if (!from) return;
    if (!to) return;
    const fromPoint = techTreePoint(from);
    const toPoint = techTreePoint(to);
    const dx = toPoint.x - fromPoint.x;
    const dy = toPoint.y - fromPoint.y;
    const sx = dx >= 0 ? 1 : -1;
    const sy = dy >= 0 ? 1 : -1;
    let points: Array<[number, number]>;
    if (Math.abs(dx) < 0.01) {
      points = [
        [fromPoint.x, fromPoint.y + sy * cardEdgeY],
        [toPoint.x, toPoint.y - sy * cardEdgeY],
      ];
    } else if (Math.abs(dy) < 0.01) {
      points = [
        [fromPoint.x + sx * cardEdgeX, fromPoint.y],
        [toPoint.x - sx * cardEdgeX, toPoint.y],
      ];
    } else {
      const start: [number, number] = [fromPoint.x + sx * cardEdgeX, fromPoint.y];
      const end: [number, number] = [toPoint.x - sx * cardEdgeX, toPoint.y];
      const midX = (start[0] + end[0]) / 2;
      points = [start, [midX, start[1]], [midX, end[1]], end];
    }
    linkParts.push(
      `<polyline class="${branch}" points="${formatPoints(points)}" />`
    );
  };
  for (const link of TECH_TREE_LINKS) addLink(link.from, link.to, link.branch);

  techTreeBoardEl.innerHTML =
    `<div class="tech-tree-canvas"><svg class="tech-links" viewBox="0 0 ${TECH_TREE_CANVAS_WIDTH} ${TECH_TREE_CANVAS_HEIGHT}" preserveAspectRatio="none">${linkParts.join('')}</svg>` +
    `${nodes.map(renderTechNode).join('')}</div>`;

  for (const button of techTreeBoardEl.querySelectorAll<HTMLButtonElement>('[data-tech-id]')) {
    button.addEventListener('click', () => {
      scene.researchTech(button.dataset.techId as TechIdValue);
      lastTechTreeSig = '';
      renderTechTree(scene);
    });
  }
}

function renderTechNode(node: ReturnType<GameScene['getTechTree']>[number]): string {
  const affordableClass = node.affordable || node.status !== 'available' ? 'affordable' : 'unaffordable';
  const disabled = node.status !== 'available' || !node.affordable ? 'disabled' : '';
  const progress =
    node.status === 'researching'
      ? `<span class="tech-progress"><span style="width:${Math.floor(node.progressFrac * 100)}%"></span></span>`
      : '';
  const status =
    node.status === 'researched'
      ? 'Done'
      : node.status === 'researching'
        ? `${Math.floor(node.progressFrac * 100)}%`
        : node.status === 'available'
          ? node.affordable ? 'Ready' : 'Need res'
          : 'Locked';
  const point = techTreePoint(node);
  return `
    <button class="tech-node ${node.path} ${node.status} ${affordableClass}" data-tech-id="${node.id}" ${disabled}
      style="left:${point.x}px;top:${point.y}px">
      ${renderVoxelIcon(node.icon)}
      <span class="tech-copy">
        <span class="tech-name">${node.name}</span>
        <span class="tech-desc">${node.description}</span>
        <span class="tech-unlocks">${node.unlocks.join(' / ')}</span>
      </span>
      <span class="tech-meta">
        <span class="tech-cost">${renderResourceCost(node.cost || 'Free')}</span>
        <span class="tech-status">${status}</span>
      </span>
      ${progress}
    </button>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderMissionCard(scene: GameScene): void {
  if (!missionPanelEl || !missionBodyEl || !missionToggleEl) return;
  const mission = scene.getCampaignMission();
  if (!mission) {
    missionToggleEl.classList.add('hidden');
    setMissionPanelOpen(false);
    lastMissionSig = '';
    lastMissionId = '';
    return;
  }

  missionToggleEl.classList.remove('hidden');
  if (mission.id !== lastMissionId) {
    lastMissionId = mission.id;
    setMissionPanelOpen(true);
  }

  const sig = [
    mission.id,
    mission.name,
    mission.lockedTechs.join(','),
    ...mission.objectives.map((objective) => `${objective.id}:${objective.completed ? 1 : 0}`),
  ].join('|');
  if (sig === lastMissionSig) return;
  lastMissionSig = sig;

  missionBodyEl.innerHTML = `
    <h3 class="mission-name">${escapeHtml(mission.name)}</h3>
    <p class="mission-briefing">${escapeHtml(mission.briefing)}</p>
    <ul class="mission-objectives">
      ${mission.objectives.map((objective) => `
        <li class="mission-objective ${objective.completed ? 'done' : ''}">
          <input type="checkbox" disabled ${objective.completed ? 'checked' : ''} aria-label="${escapeHtml(objective.label)}">
          <span>
            ${escapeHtml(objective.label)}
            ${objective.optional ? '<span class="optional">Side objective - weakens enemy troop refresh</span>' : ''}
          </span>
        </li>
      `).join('')}
    </ul>
    ${mission.lockedTechs.includes(TechId.GUNPOWDER_AGE)
      ? '<p class="mission-note">Gunpowder Age is locked in this mission.</p>'
      : '<p class="mission-note">No town center. No economy. Victory requires destroying every enemy unit.</p>'}
  `;
}

// ── Main HUD pump ──────────────────────────────────────────────────────────
function tickOverlay(): void {
  const scene = game.scene.getScene('GameScene') as GameScene | null;
  if (scene && scene.scene.isActive()) {
    const pop = scene.getPop(1);
    const age = scene.getAge(1);
    let ageLabel = age.name;
    if (age.advancing && age.nextName) {
      ageLabel = `${age.name} → ${age.nextName} ${Math.floor(age.progressFrac * 100)}%`;
    }
    updateResourceBar({
      ...scene.getResources(1),
      popCurrent: pop.current,
      popCap: pop.cap,
      age: ageLabel,
      speed: scene.getGameSpeed(),
    });
    updatePauseToggle(scene);
    const status = scene.getStatusInfo();
    updateDebugOverlay({
      fps: scene.fps ?? 0,
      tick: scene.getTick(),
      entities: scene.getEntityCount(),
      selected: scene.getSelectedSummary(),
      gather: status.text,
      build: scene.getBuildMode(),
      zoom: scene.zoom,
      speed: scene.getGameSpeed(),
    });
    renderMinimap(scene);
    updateSelectionPanel(scene);
    updateActionGrid(scene);
    renderTechTree(scene);
    renderMissionCard(scene);
    // Tick label on minimap.
    const mmTick = document.getElementById('mm-tick');
    if (mmTick) mmTick.textContent = 'tick ' + scene.getTick();
    // Ticker (last event + build mode).
    const evt = document.getElementById('ticker-event');
    const bldLine = document.getElementById('ticker-build');
    if (evt) {
      evt.textContent = '';
      const label = document.createElement('span');
      label.className = 'status-label';
      label.textContent = status.text || 'Idle';
      evt.appendChild(label);
      if (status.progressFrac !== null) {
        const progress = document.createElement('span');
        progress.className = 'status-progress';
        const fill = document.createElement('span');
        fill.style.width = `${Math.floor(status.progressFrac * 100)}%`;
        progress.appendChild(fill);
        evt.appendChild(progress);
      }
    }
    if (bldLine) bldLine.textContent = 'Build mode: ' + scene.getBuildMode();
    const outcome = scene.getOutcome();
    if (outcome.state === 'victory') {
      showGameOver(outcome.winnerPlayerId, outcome.mode);
    }
  }
  requestAnimationFrame(tickOverlay);
}
requestAnimationFrame(tickOverlay);

// eslint-disable-next-line no-console
console.log('[Kingdoms] booted — Phaser', Phaser.VERSION);
