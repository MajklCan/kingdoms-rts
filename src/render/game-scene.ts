/**
 * Main Phaser scene and composition root of the render layer.
 *
 * The scene owns the sim world (creates it, ticks it at the fixed sim rate in
 * single-player) and wires the render modules together. The sim imports
 * nothing from Phaser; render reads the sim and only writes to it through
 * `world.inputs` (or the lockstep session) via the command layer.
 *
 * Module map (all under src/render/):
 *   world-layers / scene-context    draw order + shared per-scene state
 *   sprites/                        sprite-source registry (voxel bakes, atlas overrides)
 *   terrain/                        chunk-baked ground tiles, render-only decor
 *   entities/                       building / unit / resource sprite renderers
 *   overlays/                       selection rings, health bars, fog of war
 *   effects/                        EffectsLayer, projectiles, combat feedback
 *   camera/ input/ placement/       camera, mouse + keyboard, build ghost
 *   commands/ hud/                  validated player commands, HUD queries
 *
 * Public methods below are the surface `src/main.ts` drives; keep them stable.
 */

import Phaser from 'phaser';
import { SIM } from '../config';
import { AgeId, getAgeDef, type AgeIdValue } from '@sim/defs';
import { CampaignMissionId, type CampaignMissionIdValue } from '@sim/campaign';
import type { MapIdValue } from '@sim/map-gen';
import {
  createLateGameTestSave,
  loadSimWorldSnapshot,
  serializeSimWorld,
  type SavedGameV1,
} from '@sim/save-load';
import type { TechIdValue } from '@sim/tech-tree';
import {
  createSimWorld,
  positionQuery,
  pruneHiddenSelectionForPlayer,
  selectedQuery,
  step,
  type AiDifficulty,
  type MatchOutcome,
  type SimWorld,
} from '@sim/world';
import { Cheats } from '../debug/cheats';
import { setLastEvent } from '../debug/overlay';
import { installRenderApi } from '../debug/render-api';
import { installWindowApi } from '../debug/window-api';
import type { MultiplayerSession } from '../net/session';
import { AudioManager } from './audio/audio-manager';
import { AMBIENCE_KEYS, MUSIC_KEYS, SFX_KEYS, UI_CLICK, UI_HOVER, VOICE_KEYS } from './audio/sound-map';
import { CameraController, INITIAL_ZOOM } from './camera/camera-controller';
import { PlayerCommands } from './commands/player-commands';
import { CombatFeedback } from './effects/combat-feedback';
import { EffectsLayer, PARTICLE_BURST_EFFECT, particleBurstEffect } from './effects/effects-layer';
import { registerProjectileEffects } from './effects/projectile-effects';
import { WorldFx } from './effects/world-fx';
import { BuildingRenderer } from './entities/building-renderer';
import { Occupancy } from './entities/occupancy';
import { ResourceRenderer } from './entities/resource-renderer';
import { UnitRenderer } from './entities/unit-renderer';
import { GameAudio } from './game-audio';
import { ActionGrid, type ActionGridAction } from './hud/action-grid';
import { MinimapAlerts, buildMinimapData, type MinimapData } from './hud/minimap-data';
import {
  getAge,
  getCampaignMission,
  getPop,
  getResources,
  getTechTree,
  type CampaignMissionInfo,
  type TechTreeNode,
} from './hud/player-queries';
import { getSelectionInfo, getStatusInfo, type SelectionInfo } from './hud/selection-info';
import { installHotkeys } from './input/hotkeys';
import { PointerController } from './input/pointer-controller';
import { createInspectionSheet, requestedInspectionSheet } from './inspection/inspection-sheets';
import { FogRenderer } from './overlays/fog-renderer';
import { StatusOverlay } from './overlays/status-overlay';
import { BuildPlacement } from './placement/build-placement';
import { SceneContext } from './scene-context';
import { queueSpriteManifest } from './sprites/sprite-manifest';
import { createSpriteRegistry, type SpriteSourceRegistry } from './sprites/sprite-registry';
import { bakeVoxelTextures } from './sprites/voxel-bake';
import { DecorLayer } from './terrain/decor-layer';
import { TerrainLayer } from './terrain/terrain-layer';
import { hashBytes } from './tile-hash';
import { createWorldLayers, type WorldLayers } from './world-layers';

/** Max sim steps per frame when catching up (avoids a spiral of death). */
const MAX_STEPS_PER_FRAME = 8;

export class GameScene extends Phaser.Scene {
  public fps = 0;
  private ctx!: SceneContext;
  private layers!: WorldLayers;
  private sprites!: SpriteSourceRegistry;
  private audio!: GameAudio;
  private camera!: CameraController;
  private buildings!: BuildingRenderer;
  private units!: UnitRenderer;
  private resources!: ResourceRenderer;
  private status!: StatusOverlay;
  private fog!: FogRenderer;
  private effects!: EffectsLayer;
  private combat!: CombatFeedback;
  private worldFx!: WorldFx;
  private alerts!: MinimapAlerts;
  private commands!: PlayerCommands;
  private placement!: BuildPlacement;
  private pointer!: PointerController;
  private actions!: ActionGrid;
  private cheats!: Cheats;
  private occupancy!: Occupancy;
  private terrain!: TerrainLayer;
  private decor!: DecorLayer;
  /** `?inspect=` sprite sheet is showing instead of the game. */
  private inspectionMode = false;
  /** True once create() has finished (graphics + textures exist). */
  private created = false;
  /** A multiplayer match that arrived before create() finished; flushed in create(). */
  private pendingMpMatch: {
    session: MultiplayerSession;
    world: SimWorld;
    localPlayerId: number;
  } | null = null;

  constructor() {
    super({ key: 'GameScene' });
  }

  /** Camera zoom, clamped to [0.5, 2.5]. */
  get zoom(): number {
    return this.camera?.zoom ?? INITIAL_ZOOM;
  }

  private get world(): SimWorld {
    return this.ctx.world;
  }

  preload(): void {
    // Queue all SFX + music so they're decoded before create(). Render-only.
    AudioManager.queueLoad(this.load, SFX_KEYS);
    AudioManager.queueLoadMusic(this.load, [...MUSIC_KEYS, ...AMBIENCE_KEYS]);
    AudioManager.queueLoadVoices(this.load, VOICE_KEYS);
    // Optional pre-rendered sprite atlases; absent/empty manifest = voxels only.
    queueSpriteManifest(this.load);
  }

  create(): void {
    this.layers = createWorldLayers(this);
    this.ctx = new SceneContext(this, this.layers, createSimWorld(Date.now() & 0xffff));
    this.audio = new GameAudio(this.ctx);
    this.audio.manager.playMenuMusic();

    bakeVoxelTextures(this);
    this.sprites = createSpriteRegistry(this);

    this.occupancy = new Occupancy(this.ctx);
    this.terrain = new TerrainLayer(this, this.layers.terrain);
    this.decor = new DecorLayer(this, this.layers.decor, this.layers.shadows, this.occupancy);

    // Graphics in the ground / overlay layers stack in construction order:
    // building bars, rings + health bars, build ghost.
    this.buildings = new BuildingRenderer(this.ctx, this.sprites);
    this.status = new StatusOverlay(this.ctx);
    this.commands = new PlayerCommands(this.ctx, this.audio);
    this.placement = new BuildPlacement(this.ctx, this.commands, this.audio, this.sprites);
    this.units = new UnitRenderer(this.ctx, this.sprites);
    this.resources = new ResourceRenderer(this.ctx, this.sprites, this.occupancy);
    this.fog = new FogRenderer(this.ctx, () => this.terrain.bounds);
    this.effects = new EffectsLayer(this.ctx);
    this.effects.setAnchorResolver((eid) => this.units.anchorOf(eid) ?? this.buildings.anchorOf(eid));
    this.effects.register(PARTICLE_BURST_EFFECT, particleBurstEffect);
    registerProjectileEffects(this.effects);
    this.alerts = new MinimapAlerts(this.ctx);
    this.combat = new CombatFeedback(this.ctx, {
      alerts: this.alerts,
      audio: this.audio,
      animator: this.units.animator,
      effects: this.effects,
    });
    this.worldFx = new WorldFx(this.ctx, { units: this.units, buildings: this.buildings, resources: this.resources, combat: this.combat, audio: this.audio });
    this.actions = new ActionGrid(this.ctx, this.commands, this.placement);
    this.cheats = this.createCheats();

    this.refreshTerrain();
    this.camera = new CameraController(this.ctx);
    this.camera.install();
    this.camera.panToLocalTownCenter();

    const sheet = requestedInspectionSheet();
    if (sheet) {
      this.inspectionMode = true;
      this.world.paused = true;
      this.layers.root.setVisible(false);
      createInspectionSheet(this, sheet);
    }

    this.pointer = new PointerController(this.ctx, {
      commands: this.commands,
      placement: this.placement,
      audio: this.audio,
      pickBuilding: (x, y) => this.buildings.pickAt(x, y),
    });
    this.pointer.install();
    installHotkeys(this, {
      placement: this.placement,
      commands: this.commands,
      camera: this.camera,
      pointer: this.pointer,
      toggleGameSpeed: () => this.toggleGameSpeed(),
    });

    this.installDebugWindowApi();
    this.installRenderApi();
    setLastEvent('Economy pivot - place farms, mills, and worksites with B+M/I/L/G/C');

    // If a multiplayer match start arrived before create() finished (fast
    // relay vs. slow texture bake), flush it now.
    this.created = true;
    if (this.pendingMpMatch) {
      const m = this.pendingMpMatch;
      this.pendingMpMatch = null;
      this.beginMultiplayerMatch(m.session, m.world, m.localPlayerId);
    }
  }

  update(_time: number, delta: number): void {
    if (this.inspectionMode) return;
    const ctx = this.ctx;
    this.stepSim(delta);
    pruneHiddenSelectionForPlayer(this.world, ctx.perspectivePlayerId);
    ctx.snapshotSelection();
    this.camera.update();
    this.terrain.update(delta);
    this.occupancy.update();
    this.decor.update();

    this.resources.drawMapFeatures();
    this.buildings.draw();
    this.resources.drawResources();
    this.status.begin();
    this.buildings.drawStatus(this.status);
    this.units.draw(this.status);
    this.buildings.drawRemembered();

    this.combat.consume();
    this.consumeAiEvents();
    this.audio.consumeSoundCues();
    this.audio.update();
    this.effects.update(delta * ctx.gameSpeed);
    this.worldFx.update(delta);
    this.placement.draw();
    const pointer = this.input.activePointer;
    if (this.placement.mode === 'none' && !this.placement.armyRallyMode && !pointer.rightButtonDown()) {
      this.status.drawAttackHover(ctx.pointerTile(pointer));
    }
    this.fog.draw();
    this.layers.entities.sort();
    this.fps = this.game.loop.actualFps;
  }

  /** Single-player: fixed-step accumulator. Multiplayer: lockstep owns ticks
   *  and interpolation follows its step time, or motion would jitter. */
  private stepSim(delta: number): void {
    const ctx = this.ctx;
    if (ctx.multiplayer) {
      ctx.accumulatorMs = ctx.multiplayer.interpolationMs();
      return;
    }
    ctx.accumulatorMs += delta * ctx.gameSpeed;
    let safety = 0;
    while (ctx.accumulatorMs >= SIM.TICK_MS && safety++ < MAX_STEPS_PER_FRAME) {
      step(this.world);
      ctx.accumulatorMs -= SIM.TICK_MS;
    }
  }

  private consumeAiEvents(): void {
    if (this.world.aiEvents.length === 0) return;
    const events = this.world.aiEvents.splice(0);
    const latest = events[events.length - 1];
    if (latest) setLastEvent(latest.message);
  }

  // ── Audio ─────────────────────────────────────────────────────────────────

  getAudio(): AudioManager | undefined {
    return this.audio?.manager;
  }

  playUiClick(): void {
    this.audio?.playUi(UI_CLICK);
  }

  playUiHover(): void {
    this.audio?.playUi(UI_HOVER);
  }

  // ── Camera ────────────────────────────────────────────────────────────────

  /** Change zoom by `delta`, keeping the optional anchor point under the cursor. */
  applyZoom(delta: number, anchorWorldX?: number, anchorWorldY?: number): void {
    this.camera.applyZoom(delta, anchorWorldX, anchorWorldY);
  }

  /** Pan the camera so that tile (tx, ty) is centred in the viewport. */
  panToTile(tx: number, ty: number): void {
    this.camera.panToTile(tx, ty);
  }

  // ── Match flow ────────────────────────────────────────────────────────────

  /** Used by main.ts overlay pump to show the game-over modal. */
  getOutcome(): MatchOutcome {
    return this.world.outcome;
  }

  getCampaignMission(): CampaignMissionInfo | null {
    return getCampaignMission(this.world);
  }

  /** Toggle the sim's paused state. No-op in multiplayer: pause is not synced,
   *  so a local pause would diverge tick counts and desync the lockstep. */
  setPaused(paused: boolean): void {
    if (this.ctx.multiplayer) return;
    this.world.paused = paused;
  }

  isPaused(): boolean {
    return this.world.paused;
  }

  getGameSpeed(): number {
    return this.ctx.gameSpeed;
  }

  setGameSpeed(multiplier: number): void {
    const next = multiplier >= 2 ? 2 : 1;
    if (next === this.ctx.gameSpeed) return;
    this.ctx.gameSpeed = next;
    setLastEvent(`game speed ${next}x`);
  }

  toggleGameSpeed(): number {
    this.setGameSpeed(this.ctx.gameSpeed === 1 ? 2 : 1);
    return this.ctx.gameSpeed;
  }

  getWorld(): SimWorld {
    return this.world;
  }

  createSaveSnapshot(label = 'Manual Save'): SavedGameV1 {
    return serializeSimWorld(this.world, label);
  }

  loadSaveSnapshot(snapshot: SavedGameV1, label = snapshot.label): void {
    loadSimWorldSnapshot(this.world, snapshot);
    this.afterWorldLoaded(`loaded ${label}`);
  }

  loadLateGameTestSave(): void {
    this.loadSaveSnapshot(createLateGameTestSave(), 'Late Game Test');
  }

  startNewGame(
    startingAge: AgeIdValue = AgeId.DARK,
    mapId?: MapIdValue,
    aiDifficulty: AiDifficulty = 'medium'
  ): void {
    const age = getAgeDef(startingAge) ?? getAgeDef(AgeId.DARK);
    this.ctx.world = createSimWorld(Date.now() & 0xffff, { startingAge, mapId, aiDifficulty });
    this.afterWorldLoaded(`started in ${age?.name ?? 'Dark Age'} - ${aiDifficulty} AI`);
  }

  startCampaignMission(missionId: CampaignMissionIdValue = CampaignMissionId.SIEGE_OF_BRNO): void {
    this.ctx.world = createSimWorld(Date.now() & 0xffff, { campaignMissionId: missionId });
    this.afterWorldLoaded(this.world.campaign?.name ?? 'campaign started');
  }

  /** The player id this client controls (host=1, guest=2 in multiplayer). */
  getPerspectivePlayerId(): number {
    return this.ctx.perspectivePlayerId;
  }

  /** True while a networked match is live (used by the HUD pump). */
  isMultiplayer(): boolean {
    return this.ctx.multiplayer !== null;
  }

  /**
   * Enter a lockstep multiplayer match. The session has already built the
   * deterministic world (identical on every client) and says which player we
   * control. From here the session drives the sim and local commands leave
   * as network frames (see commands/command-dispatch).
   */
  beginMultiplayerMatch(session: MultiplayerSession, world: SimWorld, localPlayerId: number): void {
    if (!this.created) {
      // Scene still baking; defer until create() finishes.
      this.pendingMpMatch = { session, world, localPlayerId };
      return;
    }
    this.ctx.multiplayer = session;
    this.ctx.world = world;
    this.ctx.perspectivePlayerId = localPlayerId;
    this.afterWorldLoaded(`Multiplayer match - you are Player ${localPlayerId}`);
  }

  // ── Cheats (debug panel) ──────────────────────────────────────────────────

  cheatRevealMap(playerId = 1): void {
    this.cheats.revealMap(playerId);
  }

  cheatAddResources(playerId = 1, amount = 500): void {
    this.cheats.addResources(playerId, amount);
  }

  cheatSpawnCavalryByTownHall(playerId = 1): number | null {
    return this.cheats.spawnCavalryByTownHall(playerId);
  }

  cheatSpawnMachineGunByTownHall(playerId = 1): number | null {
    return this.cheats.spawnMachineGunByTownHall(playerId);
  }

  cheatSpawnMortarByTownHall(playerId = 1): number | null {
    return this.cheats.spawnMortarByTownHall(playerId);
  }

  // ── HUD queries ───────────────────────────────────────────────────────────

  getSelectedSummary(): string {
    const sel = selectedQuery(this.world.ecs);
    if (sel.length === 0) return 'none';
    return Array.from(sel).slice(0, 5).join(',');
  }

  getEntityCount(): number {
    return positionQuery(this.world.ecs).length;
  }

  getTick(): number {
    return this.world.tick;
  }

  getResources(playerId: number): { food: number; wood: number; gold: number; stone: number } {
    return getResources(this.world, playerId);
  }

  getPop(playerId: number): { current: number; cap: number } {
    return getPop(this.world, playerId);
  }

  getAge(playerId: number): ReturnType<typeof getAge> {
    return getAge(this.world, playerId);
  }

  getTechTree(playerId = this.ctx.perspectivePlayerId): TechTreeNode[] {
    return getTechTree(this.world, playerId);
  }

  researchTech(techId: TechIdValue, playerId = this.ctx.perspectivePlayerId): void {
    this.commands.research(techId, playerId);
  }

  /** Combined status line: gather + build state for the first selected unit. */
  getStatusLine(): string {
    return this.getStatusInfo().text;
  }

  getStatusInfo(): { text: string; progressFrac: number | null } {
    return getStatusInfo(this.ctx);
  }

  getBuildMode(): string {
    return this.placement.label;
  }

  /** Minimap data: tiles + entity dots + combat pings. */
  getMinimapData(): MinimapData {
    return buildMinimapData(this.ctx, this.alerts);
  }

  /** Selection summary for the portrait panel. */
  getSelectionInfo(): SelectionInfo {
    return getSelectionInfo(this.world);
  }

  /** Available actions for the action grid, based on current selection. */
  getAvailableActions(): ActionGridAction[] {
    return this.actions.available();
  }

  /** Trigger an action by id (called from action grid clicks). */
  triggerAction(actionId: string, trainCount = 1): void {
    this.actions.trigger(actionId, trainCount);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private createCheats(): Cheats {
    const ctx = this.ctx;
    const fog = (): FogRenderer => this.fog;
    return new Cheats({
      get world() {
        return ctx.world;
      },
      get isMultiplayer() {
        return ctx.multiplayer !== null;
      },
      onFogChanged: () => fog().invalidate(),
    });
  }

  private installDebugWindowApi(): void {
    installWindowApi(
      this.world,
      (n) => {
        for (let i = 0; i < n; i++) step(this.world);
      },
      () => Array.from(selectedQuery(this.world.ecs))
    );
  }

  private installRenderApi(): void {
    installRenderApi({
      snapshot: () => {
        const b = this.buildings.counts;
        const u = this.units.counts;
        const r = this.resources.counts;
        return {
          sprites: {
            buildings: b.live,
            rememberedBuildings: b.remembered,
            units: u.live,
            resources: r.resources,
            mapFeatures: r.features,
            atlas: b.atlas + u.atlas + r.atlas,
            ruins: b.ruins,
            stumps: r.stumps,
            decor: this.decor.count,
          },
          terrain: { ...this.terrain.stats },
          fogRepaints: this.fog.repaints,
          layers: {
            terrain: this.layers.terrain.length,
            decor: this.layers.decor.length,
            shadows: this.layers.shadows.length,
            ground: this.layers.ground.length,
            fog: this.layers.fog.length,
            overlay: this.layers.overlay.length,
          },
          atlasEntries: this.sprites.atlasEntryCount,
          effects: {
            active: this.effects.activeCount,
            byId: this.effects.countsById(),
            registered: this.effects.registeredIds(),
          },
          entityLayerChildren: this.layers.entities.childCount,
        };
      },
      spawnEffect: (id, tileX, tileY, params) =>
        this.effects.spawn(id, { x: tileX, y: tileY }, { params }) !== null,
      shake: (intensity, durationMs) => this.effects.shake(intensity, durationMs),
      startSkirmish: (mapId, age) => this.startNewGame(age as AgeIdValue | undefined, mapId as MapIdValue),
      startCampaign: (missionId) => this.startCampaignMission(missionId as CampaignMissionIdValue),
      loadLateGame: () => this.loadLateGameTestSave(),
      setZoom: (zoom) => this.camera.applyZoom(zoom - this.camera.zoom),
      panToTile: (x, y) => this.camera.panToTile(x, y),
      fps: () => this.game.loop.actualFps,
      scene: () => this,
      tileToClient: (tileX, tileY) => {
        const p = this.ctx.localToWorld(this.ctx.tileToScreen(tileX, tileY));
        const cam = this.cameras.main;
        const canvas = this.scale.canvas;
        const rect = canvas.getBoundingClientRect();
        const sx = cam.x + (p.x - cam.worldView.x) * cam.zoom;
        const sy = cam.y + (p.y - cam.worldView.y) * cam.zoom;
        return {
          x: rect.left + (sx * rect.width) / canvas.width,
          y: rect.top + (sy * rect.height) / canvas.height,
        };
      },
    });
  }

  /** Reset render state for a new / loaded / multiplayer world. */
  private afterWorldLoaded(message: string): void {
    this.world.paused = false;
    this.ctx.accumulatorMs = 0;
    this.placement.reset();
    this.effects.clear();
    this.worldFx.clear();
    this.status.clear();
    this.alerts.clear();
    this.buildings.clear();
    this.units.clear();
    this.resources.clear();
    this.refreshTerrain();
    this.installDebugWindowApi();
    this.camera.panToLocalTownCenter();
    this.audio.enterMatch();
    setLastEvent(message);
  }

  /**
   * Re-bake the ground and decor for the current map and rebuild the fog to
   * match. The render seed comes from the map bytes (the sim keeps no seed),
   * so every peer of a multiplayer match draws the same details.
   */
  private refreshTerrain(): void {
    const map = this.world.map;
    const seed = hashBytes(map.elevation, hashBytes(map.tiles));
    this.terrain.build(map, this.sprites.art, seed);
    this.decor.build(map, this.terrain.names, this.sprites.art, seed);
    this.fog.rebuild();
  }
}
