/**
 * Bake every voxel model in the catalogue into a Phaser texture. Runs once at
 * scene boot; textures live in the global texture manager and are shared by
 * every sprite of the same kind. Re-running is a no-op for keys that exist.
 */

import { TEAM_COLORS } from '../../config';
import { outlineCanvasTexture } from '../voxel/voxel-outline';
import { bakeVoxelTexture } from '../voxel/voxel-render';
import { FACINGS } from './facing';
import { createUnitAtlasSource, LINEAR_FILTER } from './sprite-registry';
import { UNIT_SHADOW_KEY } from './voxel-sprite-source';
import {
  VOXEL_SHARED_BAKES,
  VOXEL_TEAM_PLAYERS,
  VOXEL_UNIT_BAKE_ORDER,
  VOXEL_UNIT_MODELS,
  voxelTeamBuildingBakes,
  voxelUnitKey,
  type VoxelStaticBake,
} from './voxel-models';

export function bakeVoxelTextures(scene: Phaser.Scene): void {
  // Units drawn from the pre-rendered unit atlases need no voxel bake (the
  // unit manifest and its atlases are loaded in preload, before this runs).
  const covered = new Set(createUnitAtlasSource(scene)?.coveredUnitDefIds ?? []);
  // voxelW values are tuned so on-screen sprite size matches the 64x32 grid;
  // sharpness comes from canvas-level nearest-neighbour scaling (pixelArt).
  for (const playerId of VOXEL_TEAM_PLAYERS) {
    const teamColor = TEAM_COLORS[playerId] ?? 0xffffff;
    for (const bake of voxelTeamBuildingBakes(playerId, teamColor)) {
      bakeStatic(scene, bake);
    }
    const rim = unitRimColor(teamColor);
    for (const unitDefId of VOXEL_UNIT_BAKE_ORDER) {
      const model = VOXEL_UNIT_MODELS[unitDefId];
      if (!model || covered.has(unitDefId)) continue;
      for (const facing of FACINGS) {
        for (const anim of model.anims) {
          for (let frame = 0; frame < (model.frameCounts[anim] ?? 0); frame++) {
            const key = voxelUnitKey(model, playerId, facing, anim, frame);
            const baked = bakeIfMissing(
              scene,
              key,
              () => model.build(teamColor, { facing, anim, frame }),
              4,
              model.bounds
            );
            // Dark team-tinted rim: units pop off the busy pre-rendered ground.
            if (baked) outlineCanvasTexture(scene.textures, key, rim, UNIT_RIM_ALPHA);
          }
        }
      }
    }
  }
  for (const bake of VOXEL_SHARED_BAKES) bakeStatic(scene, bake);
  bakeUnitShadow(scene);
}

/**
 * Soft elliptical contact shadow for units (2:1, like the ground plane), so
 * voxel units sit on the pre-rendered art instead of floating over it.
 */
function bakeUnitShadow(scene: Phaser.Scene): void {
  if (scene.textures.exists(UNIT_SHADOW_KEY)) return;
  const w = 64;
  const h = 32;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, h / w, 0, 0);
  const gradient = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
  gradient.addColorStop(0.55, 'rgba(0, 0, 0, 0.75)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, w);
  scene.textures.addImage(UNIT_SHADOW_KEY, canvas as unknown as HTMLImageElement)?.setFilter(LINEAR_FILTER);
}

function bakeStatic(scene: Phaser.Scene, bake: VoxelStaticBake): void {
  bakeIfMissing(scene, bake.key, bake.build, bake.voxelW, bake.bounds);
}

/** True when it baked (the key did not exist yet). */
function bakeIfMissing(
  scene: Phaser.Scene,
  key: string,
  build: VoxelStaticBake['build'],
  voxelW: number,
  bounds: VoxelStaticBake['bounds']
): boolean {
  if (scene.textures.exists(key)) return false;
  bakeVoxelTexture(scene, build(), { textureKey: key, voxelW, bounds });
  return true;
}

/** Opacity of the unit rim. */
const UNIT_RIM_ALPHA = 0.9;

/** Unit rim colour: the team colour pushed almost to black. */
export function unitRimColor(teamColor: number): number {
  const k = 0.22;
  const r = Math.round(((teamColor >> 16) & 0xff) * k);
  const g = Math.round(((teamColor >> 8) & 0xff) * k);
  const b = Math.round((teamColor & 0xff) * k);
  return (r << 16) | (g << 8) | b;
}
