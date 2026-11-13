/**
 * Bake every voxel model in the catalogue into a Phaser texture. Runs once at
 * scene boot; textures live in the global texture manager and are shared by
 * every sprite of the same kind. Re-running is a no-op for keys that exist.
 */

import { TEAM_COLORS } from '../../config';
import { bakeVoxelTexture } from '../voxel/voxel-render';
import { FACINGS } from './facing';
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
  // voxelW values are tuned so on-screen sprite size matches the 64x32 grid;
  // sharpness comes from canvas-level nearest-neighbour scaling (pixelArt).
  for (const playerId of VOXEL_TEAM_PLAYERS) {
    const teamColor = TEAM_COLORS[playerId] ?? 0xffffff;
    for (const bake of voxelTeamBuildingBakes(playerId, teamColor)) {
      bakeStatic(scene, bake);
    }
    for (const unitDefId of VOXEL_UNIT_BAKE_ORDER) {
      const model = VOXEL_UNIT_MODELS[unitDefId];
      if (!model) continue;
      for (const facing of FACINGS) {
        for (const anim of model.anims) {
          for (let frame = 0; frame < (model.frameCounts[anim] ?? 0); frame++) {
            bakeIfMissing(
              scene,
              voxelUnitKey(model, playerId, facing, anim, frame),
              () => model.build(teamColor, { facing, anim, frame }),
              4,
              model.bounds
            );
          }
        }
      }
    }
  }
  for (const bake of VOXEL_SHARED_BAKES) bakeStatic(scene, bake);
}

function bakeStatic(scene: Phaser.Scene, bake: VoxelStaticBake): void {
  bakeIfMissing(scene, bake.key, bake.build, bake.voxelW, bake.bounds);
}

function bakeIfMissing(
  scene: Phaser.Scene,
  key: string,
  build: VoxelStaticBake['build'],
  voxelW: number,
  bounds: VoxelStaticBake['bounds']
): void {
  if (scene.textures.exists(key)) return;
  bakeVoxelTexture(scene, build(), { textureKey: key, voxelW, bounds });
}
