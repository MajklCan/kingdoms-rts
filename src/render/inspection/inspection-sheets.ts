/**
 * `?inspect=<unit>` debug sheets: every facing x animation frame of one voxel
 * unit laid out in a grid (world hidden, sim paused). Art review tool only.
 */

import { RENDER } from '../../config';
import { UnitDefId } from '@sim/defs';
import { FACINGS } from '../sprites/facing';
import { voxelUnitTextureKey } from '../sprites/voxel-models';

interface SheetRow {
  label: string;
  anim: string;
  frame: number;
}

interface SheetConfig {
  unitDefId: number;
  title: string;
  subtitle: string;
  rows: SheetRow[];
  /** Horizontal separator lines: y from `from` to `to` every `step`. */
  lines: { from: number; to: number; step: number };
  startX: number;
  startY: number;
  rowH: number;
  facingLabelY: number;
  scale: number;
  originY: number;
}

const COL_W = 135;
const FONT = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const HIDDEN_DOM_IDS = [
  'title-screen',
  'resource-bar',
  'minimap-panel',
  'bottom-hud',
  'debug-overlay',
  'save-load-panel',
  'tech-tree-panel',
  'game-over',
];

const combatSheet = (
  unitDefId: number,
  title: string,
  subtitle: string,
  rows: SheetRow[],
  originY = 0.82,
  scale = 1.9
): SheetConfig => ({
  unitDefId,
  title,
  subtitle,
  rows,
  lines: { from: 105, to: 650, step: 105 },
  startX: 150,
  startY: 130,
  rowH: 105,
  facingLabelY: 82,
  scale,
  originY,
});

const SHEETS: Record<string, SheetConfig> = {
  'scout-cavalry': {
    unitDefId: UnitDefId.SCOUT_CAVALRY,
    title: 'Scout Cavalry Sprite Draft',
    subtitle: '8 facings / idle, movement, attack frames / fixed voxel bake bounds',
    rows: [
      { label: 'idle', anim: 'idle', frame: 0 },
      { label: 'move 0', anim: 'move', frame: 0 },
      { label: 'move 1', anim: 'move', frame: 1 },
      { label: 'attack 0', anim: 'attack', frame: 0 },
      { label: 'attack 1', anim: 'attack', frame: 1 },
    ],
    lines: { from: 110, to: 670, step: 125 },
    startX: 160,
    startY: 140,
    rowH: 125,
    facingLabelY: 86,
    scale: 1.45,
    originY: 0.85,
  },
  villager: {
    unitDefId: UnitDefId.VILLAGER,
    title: 'Villager Sprite Draft',
    subtitle: '8 facings / idle, movement, carry, harvest, build frames',
    rows: [
      { label: 'idle', anim: 'idle', frame: 0 },
      { label: 'move 0', anim: 'move', frame: 0 },
      { label: 'move 1', anim: 'move', frame: 1 },
      { label: 'carry 0', anim: 'carry', frame: 0 },
      { label: 'carry 1', anim: 'carry', frame: 1 },
      { label: 'harvest 0', anim: 'harvest', frame: 0 },
      { label: 'harvest 1', anim: 'harvest', frame: 1 },
      { label: 'build 0', anim: 'build', frame: 0 },
      { label: 'build 1', anim: 'build', frame: 1 },
    ],
    lines: { from: 100, to: 690, step: 66 },
    startX: 150,
    startY: 116,
    rowH: 66,
    facingLabelY: 78,
    scale: 1.8,
    originY: 0.73,
  },
  archer: combatSheet(
    UnitDefId.ARCHER,
    'Archer Sprite Draft',
    '8 facings / idle, movement, draw and release attack frames',
    [
      { label: 'idle', anim: 'idle', frame: 0 },
      { label: 'move 0', anim: 'move', frame: 0 },
      { label: 'move 1', anim: 'move', frame: 1 },
      { label: 'draw', anim: 'attack', frame: 0 },
      { label: 'release', anim: 'attack', frame: 1 },
    ]
  ),
  spearman: combatSheet(
    UnitDefId.SPEARMAN,
    'Spearman Sprite Draft',
    '8 facings / idle, movement, spear thrust attack frames',
    [
      { label: 'idle', anim: 'idle', frame: 0 },
      { label: 'move 0', anim: 'move', frame: 0 },
      { label: 'move 1', anim: 'move', frame: 1 },
      { label: 'brace', anim: 'attack', frame: 0 },
      { label: 'thrust', anim: 'attack', frame: 1 },
    ]
  ),
  cannon: combatSheet(
    UnitDefId.CANNON,
    'Field Cannon Sprite Draft',
    '8 facings / idle, wheel phase, recoil and muzzle-flash frames',
    [
      { label: 'idle', anim: 'idle', frame: 0 },
      { label: 'move 0', anim: 'move', frame: 0 },
      { label: 'move 1', anim: 'move', frame: 1 },
      { label: 'aim', anim: 'attack', frame: 0 },
      { label: 'fire', anim: 'attack', frame: 1 },
    ],
    0.645,
    1.55
  ),
};

/** The sheet requested by `?inspect=`, or null for normal play. */
export function requestedInspectionSheet(): string | null {
  if (typeof window === 'undefined') return null;
  const id = new URLSearchParams(window.location.search).get('inspect');
  return id && id in SHEETS ? id : null;
}

/** Draw the sheet in camera space. Caller hides the world and pauses the sim. */
export function createInspectionSheet(scene: Phaser.Scene, id: string): void {
  const config = SHEETS[id];
  if (!config) return;
  scene.cameras.main.setZoom(1);
  scene.cameras.main.setScroll(0, 0);
  for (const domId of HIDDEN_DOM_IDS) {
    const el = document.getElementById(domId);
    if (el) el.style.display = 'none';
  }

  scene.add.rectangle(0, 0, RENDER.WIDTH, RENDER.HEIGHT, 0x161922).setOrigin(0).setScrollFactor(0);
  scene.add
    .text(24, 18, config.title, { fontFamily: FONT, fontSize: '20px', color: '#f1d58a' })
    .setScrollFactor(0);
  scene.add
    .text(24, 46, config.subtitle, { fontFamily: FONT, fontSize: '12px', color: '#aab5bf' })
    .setScrollFactor(0);

  const g = scene.add.graphics();
  g.setScrollFactor(0);
  g.lineStyle(1, 0x2b3140, 1);
  for (let y = config.lines.from; y <= config.lines.to; y += config.lines.step) {
    g.lineBetween(24, y, RENDER.WIDTH - 24, y);
  }

  const labelStyle = { fontFamily: FONT, fontSize: '13px', color: '#d9e2ec' };
  for (let c = 0; c < FACINGS.length; c++) {
    scene.add
      .text(config.startX + c * COL_W - 12, config.facingLabelY, FACINGS[c], labelStyle)
      .setScrollFactor(0);
  }
  for (let r = 0; r < config.rows.length; r++) {
    const row = config.rows[r];
    const y = config.startY + r * config.rowH;
    scene.add.text(34, y - 8, row.label, labelStyle).setScrollFactor(0);
    for (let c = 0; c < FACINGS.length; c++) {
      const key = voxelUnitTextureKey(config.unitDefId, 1, FACINGS[c], row.anim, row.frame);
      if (!key) continue;
      scene.add
        .sprite(config.startX + c * COL_W, y, key)
        .setOrigin(0.5, config.originY)
        .setScale(config.scale)
        .setScrollFactor(0);
    }
  }
}
