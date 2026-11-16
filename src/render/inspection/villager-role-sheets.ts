/**
 * `?inspect=villager-<role>` and `?inspect=villager-roles`: review sheets of
 * the pre-rendered villager role looks (unit atlases), drawn through the same
 * sprite registry the game uses, so a missing look shows its fallback art.
 *
 * - `villager-<role>`: every facing of the role's anims at 2x, player 1.
 * - `villager-roles`: all roles side by side, both team colours, at 1x (what
 *   the game shows at zoom 1) and 2x.
 */

import { RENDER } from '../../config';
import { UnitDefId } from '@sim/defs';
import { FACINGS, type Facing } from '../sprites/facing';
import { createSpriteRegistry } from '../sprites/sprite-registry';
import type { SpriteRef, SpriteSource } from '../sprites/sprite-source';

const FONT = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const LABEL = { fontFamily: FONT, fontSize: '13px', color: '#d9e2ec' };
const BACKDROP = 0x4e6b34;

interface RoleSheet {
  /** Look name in the unit manifest; undefined = default villager art (builder). */
  look: string | undefined;
  title: string;
  work: string;
  carry: string;
}

/** Inspection ids -> role looks. `builder` is the default villager art. */
export const VILLAGER_ROLE_SHEETS: Readonly<Record<string, RoleSheet>> = {
  'villager-builder': { look: undefined, title: 'Builder', work: 'build', carry: 'carry_wood' },
  'villager-lumberjack': { look: 'lumberjack', title: 'Lumberjack', work: 'chop', carry: 'carry_wood' },
  'villager-farmer': { look: 'farmer', title: 'Farmer', work: 'farm', carry: 'carry_food' },
  'villager-quarryman': { look: 'quarryman', title: 'Quarryman', work: 'mine', carry: 'carry_stone' },
  'villager-gold-miner': { look: 'gold-miner', title: 'Gold miner', work: 'mine', carry: 'carry_gold' },
};

export const VILLAGER_ROLES_COMPARISON = 'villager-roles';

export function isVillagerRoleSheet(id: string): boolean {
  return id === VILLAGER_ROLES_COMPARISON || id in VILLAGER_ROLE_SHEETS;
}

/** Draw one role sheet or the comparison in camera space. */
export function createVillagerRoleSheet(scene: Phaser.Scene, id: string): void {
  const sprites = createSpriteRegistry(scene);
  scene.add.rectangle(0, 0, RENDER.WIDTH, RENDER.HEIGHT, 0x161922).setOrigin(0).setScrollFactor(0);
  if (id === VILLAGER_ROLES_COMPARISON) {
    drawComparison(scene, sprites);
    return;
  }
  const sheet = VILLAGER_ROLE_SHEETS[id];
  if (sheet) drawRoleSheet(scene, sprites, sheet);
}

function drawRoleSheet(scene: Phaser.Scene, sprites: SpriteSource, sheet: RoleSheet): void {
  title(scene, `Villager: ${sheet.title}`, `8 facings / idle, walk, ${sheet.carry}, ${sheet.work}, death / 2x, player 1`);
  const rows: Array<[string, string, number]> = [
    ['idle', 'idle', 0],
    ['move 1', 'move', 1],
    ['move 5', 'move', 5],
    [`${sheet.carry} 2`, sheet.carry, 2],
    [`${sheet.work} 1`, sheet.work, 1],
    [`${sheet.work} 3`, sheet.work, 3],
    ['death 3', 'death', 3],
  ];
  const colW = Math.floor((RENDER.WIDTH - 190) / FACINGS.length);
  const rowH = 80;
  const top = 88;
  panel(scene, 150, top - 16, colW * FACINGS.length + 10, rowH * rows.length + 40);
  for (let c = 0; c < FACINGS.length; c++) {
    scene.add.text(170 + c * colW + colW / 2 - 8, top - 30, FACINGS[c], LABEL).setScrollFactor(0);
  }
  rows.forEach(([label, anim, frame], r) => {
    const y = top + r * rowH + rowH - 12;
    scene.add.text(24, y - 30, label, LABEL).setScrollFactor(0);
    for (let c = 0; c < FACINGS.length; c++) {
      drawUnit(scene, sprites, sheet.look, 1, FACINGS[c], anim, frame, 170 + c * colW + colW / 2, y, 2);
    }
  });
}

function drawComparison(scene: Phaser.Scene, sprites: SpriteSource): void {
  title(scene, 'Villager roles', 'builder (free villager) and worksite crews / player 1 and 2 / 1x and 2x');
  const roles = Object.values(VILLAGER_ROLE_SHEETS);
  const colW = Math.floor((RENDER.WIDTH - 160) / roles.length);
  const left = 140;
  roles.forEach((role, c) => {
    scene.add.text(left + c * colW + 10, 76, role.title, LABEL).setScrollFactor(0);
  });
  const bands: Array<{ label: string; player: number; scale: number; y: number }> = [
    { label: 'P1 1x', player: 1, scale: 1, y: 150 },
    { label: 'P2 1x', player: 2, scale: 1, y: 215 },
    { label: 'P1 2x', player: 1, scale: 2, y: 360 },
    { label: 'P2 2x', player: 2, scale: 2, y: 470 },
  ];
  panel(scene, left - 6, 98, colW * roles.length + 6, 500);
  for (const band of bands) {
    scene.add.text(24, band.y - 24, band.label, LABEL).setScrollFactor(0);
    roles.forEach((role, c) => {
      const poses: Array<[Facing, string, number]> = [
        ['SE', 'idle', 0],
        ['SW', 'move', 2],
        ['SE', role.work, 3],
      ];
      const step = band.scale === 1 ? 34 : 64;
      poses.forEach(([facing, anim, frame], i) => {
        const x = left + c * colW + 30 + i * step;
        drawUnit(scene, sprites, role.look, band.player, facing, anim, frame, x, band.y, band.scale);
      });
    });
  }
  // A crowd at 1x as the game shows it: each role twice, mixed teams.
  scene.add.text(24, 590, 'crowd 1x', LABEL).setScrollFactor(0);
  roles.forEach((role, c) => {
    for (let k = 0; k < 4; k++) {
      const facing = FACINGS[(c * 3 + k * 2) % FACINGS.length];
      const x = left + c * colW + 24 + k * 30;
      drawUnit(scene, sprites, role.look, 1 + (k % 2), facing, k % 2 ? 'move' : 'idle', k, x, 640, 1);
    }
  });
}

function title(scene: Phaser.Scene, text: string, subtitle: string): void {
  scene.add.text(24, 18, text, { fontFamily: FONT, fontSize: '20px', color: '#f1d58a' }).setScrollFactor(0);
  scene.add.text(24, 46, subtitle, { fontFamily: FONT, fontSize: '12px', color: '#aab5bf' }).setScrollFactor(0);
}

function panel(scene: Phaser.Scene, x: number, y: number, w: number, h: number): void {
  scene.add.rectangle(x, y, w, h, BACKDROP).setOrigin(0).setScrollFactor(0);
}

/** One unit frame with its ground shadow and tinted team mask, feet at (x, y). */
function drawUnit(
  scene: Phaser.Scene,
  sprites: SpriteSource,
  look: string | undefined,
  playerId: number,
  facing: Facing,
  anim: string,
  frame: number,
  x: number,
  y: number,
  scale: number
): void {
  const ref = sprites.unit({ unitDefId: UnitDefId.VILLAGER, playerId, facing, anim, frame, look });
  if (!ref) return;
  if (ref.shadow) {
    scene.add
      .image(Math.round(x), Math.round(y), ref.shadow.texture, ref.shadow.frame)
      .setOrigin(ref.shadow.originX, ref.shadow.originY)
      .setScale(scale)
      .setScrollFactor(0);
  }
  addFrame(scene, ref, x, y, scale);
  if (ref.teamMask) {
    scene.add
      .image(Math.round(x), Math.round(y), ref.teamMask.texture, ref.teamMask.frame)
      .setOrigin(ref.originX, ref.originY)
      .setScale(scale)
      .setTint(ref.teamMask.tint)
      .setScrollFactor(0);
  }
}

function addFrame(scene: Phaser.Scene, ref: SpriteRef, x: number, y: number, scale: number): void {
  scene.add
    .image(Math.round(x), Math.round(y), ref.texture, ref.frame)
    .setOrigin(ref.originX, ref.originY)
    .setScale(scale * ref.scale)
    .setScrollFactor(0);
}
