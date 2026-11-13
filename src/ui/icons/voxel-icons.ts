/**
 * Voxel-block icon art (tech tree, building actions, resources) rendered as
 * absolutely positioned <i> cells, plus the resource cost formatter.
 */

export type VoxelBlock = [number, number, string];
export type ResourceIconKey = 'food' | 'wood' | 'gold' | 'stone';

export const TECH_ICON_BLOCKS: Record<string, VoxelBlock[]> = {
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

export const BUILDING_ICON_BLOCKS: Record<string, VoxelBlock[]> = {
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

export const RESOURCE_ICON_BLOCKS: Record<ResourceIconKey, VoxelBlock[]> = {
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

export function renderResourceIcon(kind: ResourceIconKey, size: 'bar' | 'mini' = 'mini'): string {
  const label = kind[0].toUpperCase() + kind.slice(1);
  return `<span class="resource-icon ${kind} ${size}" aria-label="${label}" title="${label}">${RESOURCE_ICON_BLOCKS[kind]
    .map(([x, y, color]) => `<i style="--x:${x};--y:${y};--c:${color}"></i>`)
    .join('')}</span>`;
}

export function installStaticResourceIcons(): void {
  for (const slot of document.querySelectorAll<HTMLElement>('[data-resource-icon]')) {
    const kind = slot.dataset.resourceIcon as ResourceIconKey | undefined;
    if (!kind || !(kind in RESOURCE_ICON_BLOCKS)) continue;
    slot.innerHTML = renderResourceIcon(kind, 'bar');
  }
}

export function renderResourceCost(cost: string): string {
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

function renderBlockIcon(blocks: VoxelBlock[], className: string): string {
  return `<span class="${className}" aria-hidden="true">${blocks
    .map(([x, y, color]) => `<i style="--x:${x};--y:${y};--c:${color}"></i>`)
    .join('')}</span>`;
}

export function renderVoxelIcon(icon: string): string {
  const blocks = TECH_ICON_BLOCKS[icon] ?? TECH_ICON_BLOCKS.stone;
  return renderBlockIcon(blocks, 'voxel-icon');
}

export function renderHudVoxelIcon(icon: string): string {
  const blocks = BUILDING_ICON_BLOCKS[icon] ?? BUILDING_ICON_BLOCKS.house;
  return renderBlockIcon(blocks, 'hud-voxel-icon');
}
