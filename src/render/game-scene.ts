/**
 * Main Phaser scene. Renders an isometric grid, draws units / resources / buildings
 * as coloured shapes, handles input (left-click select, right-click context, WASD pan,
 * B+M/I/L/G/C/H/R/A/T build mode, Q/E train or advance).
 *
 * The scene OWNS the sim world (creates it, ticks it at the fixed sim rate), but the
 * sim itself imports nothing from Phaser. This file is the only place where sim and
 * render meet.
 */

import Phaser from 'phaser';
import { hasComponent } from 'bitecs';
import { ISO, MAP, RENDER, SIM, TEAM_COLORS } from '../config';
import {
  ArcherTag,
  AttackTarget,
  Building,
  BuildOrder,
  Combat,
  ConstructionSite,
  Gatherer,
  GathererStateId,
  CannonTag,
  GunmanTag,
  Health,
  MachineGunDeployment,
  MachineGunTag,
  MortarTag,
  Owner,
  Position,
  PrevPosition,
  Producer,
  Resource,
  ResourceCarry,
  ResourceKindId,
  ResourceWorksite,
  ScoutCavalryTag,
  Speed,
  SpearmanTag,
  TownCenterTag,
  UnitKind,
  UnitStance,
  UnitStanceId,
  VillagerTag,
  Velocity,
  WorksiteWorker,
  type UnitStanceValue,
} from '../sim/components';
import {
  BUILDING_TABLE,
  AgeId,
  type AgeIdValue,
  type BuildingDef,
  BuildingDefId,
  type CostTuple,
  UNIT_TABLE,
  UnitDefId,
  getAgeDef,
  getUnitDef,
} from '../sim/defs';
import { CampaignMissionId, type CampaignMissionIdValue } from '../sim/campaign';
import {
  buildingQuery,
  clearSelection,
  createSimWorld,
  findEntityNear,
  findResourceAt,
  getBuildingPopProvided,
  getPlayerVisibility,
  getWorksiteWorkerSlots,
  isBuildingFootprintVisibleTo,
  isEntityVisibleTo,
  isEnemyOf,
  isTileExploredBy,
  isTileVisibleTo,
  LOCAL_PLAYER_ID,
  positionQuery,
  pruneHiddenSelectionForPlayer,
  resourceQuery,
  revealMapForPlayer,
  selectedQuery,
  selectUnitsOfSameKindInRadius,
  setSelected,
  spawnScoutCavalry,
  spawnMachineGun,
  spawnMortar,
  step,
  townCenterQuery,
  unitQuery,
  type AiDifficulty,
  type CombatEvent,
  type MatchOutcome,
  type SimWorld,
  type SimInput,
} from '../sim/world';
import {
  MapFeatureKind,
  TileType,
  type MapFeature,
  type MapFeatureKindValue,
  type MapIdValue,
} from '../sim/map-gen';
import {
  createLateGameTestSave,
  loadSimWorldSnapshot,
  serializeSimWorld,
  type SavedGameV1,
} from '../sim/save-load';
import {
  TECH_TREE,
  TechId,
  type TechIdValue,
  isBuildingUnlocked,
  isUnitUnlocked,
  techDef,
  techStatus,
} from '../sim/tech-tree';
import { screenToTile, tileToScreen } from './iso';
import { setLastEvent } from '../debug/overlay';
import { installWindowApi } from '../debug/window-api';
import { MultiplayerSession } from '../net/session';
import { AudioManager } from './audio/audio-manager';
import {
  SFX_KEYS,
  MUSIC_KEYS,
  AMBIENCE_KEYS,
  VILLAGE_MUSIC,
  BATTLE_TRACKS,
  BATTLE_AMBIENCE,
  NATURE_AMBIENCE,
  cueSound,
  combatSound,
  isNonSpatialCue,
  UI_CLICK,
  UI_HOVER,
  UNIT_SELECT,
  COMMAND_MOVE,
  ERROR as SFX_ERROR,
  PLACE_BUILDING,
  ALERT,
  VOICE_KEYS,
  VOICE_LINE_COUNTS,
  type SfxConfig,
  type VoiceCategory,
  type VoiceBarkType,
} from './audio/sound-map';
import { bakeVoxelTexture } from './voxel/voxel-render';
import { bakeTerrain } from './voxel/terrain';
import { buildDarkTcVoxels } from './voxel/models/dark-tc';
import { buildDarkHouseVoxels } from './voxel/models/dark-house';
import { buildDarkFarmVoxels } from './voxel/models/dark-farm';
import { buildDarkBarracksVoxels } from './voxel/models/dark-barracks';
import {
  VILLAGER_ANIMS,
  VILLAGER_BAKE_BOUNDS,
  VILLAGER_FACINGS,
  VILLAGER_FRAME_COUNTS,
  buildVillagerVoxels,
  type VillagerAnim,
  type VillagerFacing,
} from './voxel/models/dark-villager';
import {
  ARCHER_ANIMS,
  ARCHER_BAKE_BOUNDS,
  ARCHER_FACINGS,
  ARCHER_FRAME_COUNTS,
  buildArcherVoxels,
  type ArcherAnim,
  type ArcherFacing,
} from './voxel/models/dark-archer';
import {
  SPEARMAN_ANIMS,
  SPEARMAN_BAKE_BOUNDS,
  SPEARMAN_FACINGS,
  SPEARMAN_FRAME_COUNTS,
  buildSpearmanVoxels,
  type SpearmanAnim,
  type SpearmanFacing,
} from './voxel/models/dark-spearman';
import {
  SCOUT_CAVALRY_ANIMS,
  SCOUT_CAVALRY_BAKE_BOUNDS,
  SCOUT_CAVALRY_FACINGS,
  SCOUT_CAVALRY_FRAME_COUNTS,
  buildScoutCavalryVoxels,
  type ScoutCavalryAnim,
  type ScoutCavalryFacing,
} from './voxel/models/dark-scout-cavalry';
import {
  GUNMAN_ANIMS,
  GUNMAN_BAKE_BOUNDS,
  GUNMAN_FACINGS,
  GUNMAN_FRAME_COUNTS,
  buildGunmanVoxels,
  type GunmanAnim,
  type GunmanFacing,
} from './voxel/models/gunpowder-gunman';
import {
  CANNON_ANIMS,
  CANNON_BAKE_BOUNDS,
  CANNON_FACINGS,
  CANNON_FRAME_COUNTS,
  buildCannonVoxels,
  type CannonAnim,
  type CannonFacing,
} from './voxel/models/gunpowder-cannon';
import {
  MACHINE_GUN_ANIMS,
  MACHINE_GUN_BAKE_BOUNDS,
  MACHINE_GUN_FACINGS,
  MACHINE_GUN_FRAME_COUNTS,
  buildMachineGunVoxels,
  type MachineGunAnim,
  type MachineGunFacing,
} from './voxel/models/total-war-machine-gun';
import {
  MORTAR_ANIMS,
  MORTAR_BAKE_BOUNDS,
  MORTAR_FACINGS,
  MORTAR_FRAME_COUNTS,
  buildMortarVoxels,
  type MortarAnim,
  type MortarFacing,
} from './voxel/models/total-war-mortar';
import { buildDarkArcheryRangeVoxels } from './voxel/models/dark-archery-range';
import { buildDarkStableVoxels } from './voxel/models/dark-stable';
import { buildGunpowderFoundryVoxels } from './voxel/models/gunpowder-foundry';
import { buildDarkLumberCampVoxels } from './voxel/models/dark-lumber-camp';
import { buildDarkMillVoxels } from './voxel/models/dark-mill';
import { buildDarkGoldMineVoxels } from './voxel/models/dark-gold-mine';
import { buildDarkStoneQuarryVoxels } from './voxel/models/dark-stone-quarry';
import { buildDarkDefensiveTowerVoxels } from './voxel/models/dark-defensive-tower';
import { buildWallVoxels } from './voxel/models/wall';
import {
  buildTreeVoxels,
  buildSnowTreeVoxels,
  buildDeadTreeVoxels,
  buildLindenTreeVoxels,
  buildJaggedRockVoxels,
  buildGoldVoxels,
  buildStoneVoxels,
  buildBerryVoxels,
} from './voxel/models/resources';

const RESOURCE_COLOR: Record<number, number> = {
  [ResourceKindId.FOOD]: 0xc0392b,
  [ResourceKindId.WOOD]: 0x2e7d32,
  [ResourceKindId.GOLD]: 0xe8b923,
  [ResourceKindId.STONE]: 0x9aa0a6,
};

type BuildMode =
  | 'none'
  | 'HOUSE'
  | 'FARM'
  | 'MILL'
  | 'LUMBER_CAMP'
  | 'GOLD_MINE'
  | 'STONE_QUARRY'
  | 'BARRACKS'
  | 'STABLE'
  | 'FOUNDRY'
  | 'DEFENSIVE_TOWER';

const BUILD_MODE_TO_DEF: Record<Exclude<BuildMode, 'none'>, number> = {
  HOUSE: BuildingDefId.HOUSE,
  FARM: BuildingDefId.FARM,
  MILL: BuildingDefId.MILL,
  LUMBER_CAMP: BuildingDefId.LUMBER_CAMP,
  GOLD_MINE: BuildingDefId.GOLD_MINE,
  STONE_QUARRY: BuildingDefId.STONE_QUARRY,
  BARRACKS: BuildingDefId.BARRACKS,
  STABLE: BuildingDefId.STABLE,
  FOUNDRY: BuildingDefId.FOUNDRY,
  DEFENSIVE_TOWER: BuildingDefId.DEFENSIVE_TOWER,
};

type ProjectileKind = 'arrow' | 'bullet' | 'cannon' | 'mortar';

interface AttackProjectile {
  kind: ProjectileKind;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  elapsedMs: number;
  durationMs: number;
}

interface MinimapCombatAlert {
  x: number;
  y: number;
  tick: number;
}

type ActionKind = 'build' | 'train' | 'tech' | 'command';

interface ActionGridAction {
  id: string;
  label: string;
  key: string;
  glyph: string;
  hudIcon?: string;
  cost?: string;
  enabled: boolean;
  kind: ActionKind;
  meta?: string;
  queue?: number;
  active?: boolean;
  disabledReason?: string;
}

export class GameScene extends Phaser.Scene {
  private world!: SimWorld;
  private audio!: AudioManager;
  /** Sim tick of the most recent combat event involving the local player —
   *  drives music ducking. -1 = never. */
  private lastLocalCombatTick = -1;
  /** Sim tick the last "under attack" alert fired — throttles the stinger. */
  private lastAlertTick = -1;
  /** True once a match is running (drives the in-game music director). */
  private inMatch = false;
  /** Tick the camera began dwelling on the home base; -1 when away. */
  private villageEnteredTick = -1;
  /** Most recent tick the camera was at the home base (for leave-grace). */
  private lastHomeTick = -1;
  /** Battle track chosen for the current combat episode; null when not fighting
   *  (re-picked at random each time combat begins). */
  private battleTrack: string | null = null;
  /** Active in-game music context + the tick it was entered (dwell tracking). */
  private musicContext: 'playlist' | 'village' | 'battle' = 'playlist';
  private contextSinceTick = -1;
  private gridGfx!: Phaser.GameObjects.Graphics;
  private buildingsGfx!: Phaser.GameObjects.Graphics;
  private resourcesGfx!: Phaser.GameObjects.Graphics;
  private unitsGfx!: Phaser.GameObjects.Graphics;
  private projectilesGfx!: Phaser.GameObjects.Graphics;
  private selectionGfx!: Phaser.GameObjects.Graphics;
  private ghostGfx!: Phaser.GameObjects.Graphics;
  private fogGfx!: Phaser.GameObjects.Graphics;
  private fogExploredTexture?: Phaser.Textures.CanvasTexture;
  private fogUnexploredTexture?: Phaser.Textures.CanvasTexture;
  private fogExploredSprite?: Phaser.GameObjects.Sprite;
  private fogUnexploredSprite?: Phaser.GameObjects.Sprite;
  private fogTextureTick = -1;
  private worldContainer!: Phaser.GameObjects.Container;
  private terrainSprite?: Phaser.GameObjects.Sprite;
  private accumulatorMs = 0;
  /** The player this client renders, selects, and issues commands AS. Always
   *  LOCAL_PLAYER_ID (1) in single-player; set to the assigned slot (1 host,
   *  2 guest) when a multiplayer match begins. */
  private perspectivePlayerId = LOCAL_PLAYER_ID;
  /** Active multiplayer session. Null in single-player. When set + playing, the
   *  session — not the local accumulator — drives sim tick advancement. */
  private multiplayer: MultiplayerSession | null = null;
  /** True once create() has finished (graphics + textures exist). */
  private created = false;
  /** A multiplayer match that arrived before create() finished; flushed in create(). */
  private pendingMpMatch: {
    session: MultiplayerSession;
    world: SimWorld;
    localPlayerId: number;
  } | null = null;
  private buildMode: BuildMode = 'none';
  private armyRallyMode = false;
  /** Awaiting a building hotkey after B keypress. */
  private awaitingBuildKind = false;
  public fps = 0;
  private gameSpeed = 1;
  /** Per-entity sprite refs for voxel-rendered entities. */
  private buildingSprites = new Map<number, Phaser.GameObjects.Sprite>();
  private lastSeenBuildingSprites = new Map<number, Phaser.GameObjects.Sprite>();
  private unitSprites = new Map<number, Phaser.GameObjects.Sprite>();
  private resourceSprites = new Map<number, Phaser.GameObjects.Sprite>();
  private mapFeatureSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private activeProjectiles: AttackProjectile[] = [];
  private minimapCombatAlerts: MinimapCombatAlert[] = [];
  private scoutFacing = new Map<number, ScoutCavalryFacing>();
  private archerFacing = new Map<number, ArcherFacing>();
  private spearmanFacing = new Map<number, SpearmanFacing>();
  private gunmanFacing = new Map<number, GunmanFacing>();
  private cannonFacing = new Map<number, CannonFacing>();
  private machineGunFacing = new Map<number, MachineGunFacing>();
  private mortarFacing = new Map<number, MortarFacing>();
  private villagerFacing = new Map<number, VillagerFacing>();
  private unitAttackUntilTick = new Map<number, number>();
  private scoutInspectionMode = false;
  /** Camera zoom — clamped to [ZOOM_MIN, ZOOM_MAX]. */
  private static readonly INITIAL_ZOOM = 1.3;
  public zoom = GameScene.INITIAL_ZOOM;
  private static readonly ZOOM_MIN = 0.5;
  private static readonly ZOOM_MAX = 2.5;
  /** Step for keyboard +/-. */
  private static readonly ZOOM_KEY_STEP = 0.1;
  /** Wheel-pixel → zoom-delta multiplier. Smaller = gentler. */
  private static readonly ZOOM_WHEEL_SCALE = 0.0012;
  /** Hard cap on the zoom delta from a single wheel event — prevents Mac
   *  trackpad gestures (which fire many large-deltaY events per swipe) from
   *  jumping the camera. */
  private static readonly ZOOM_WHEEL_CLAMP = 0.05;
  private static readonly UNIT_VISUAL_SCALE = 0.8;
  private static readonly CANNON_UNIT_ORIGIN_Y = 0.645;
  private static readonly MORTAR_UNIT_ORIGIN_Y = 0.64;
  private static readonly TRAIN_BATCH_COUNT = 5;
  private static readonly COMBAT_ATTACK_ANIM_TICKS = 10;
  private static readonly MINIMAP_COMBAT_ALERT_TICKS = SIM.TICK_HZ * 5;
  /** How long battle music/ambience persist after the last local combat event.
   *  Long, so the score never snaps back the instant a skirmish ends. */
  private static readonly BATTLE_HOLD_TICKS = SIM.TICK_HZ * 15;
  /** Minimum time in the village/playlist context before it may switch to the
   *  other — prevents rapid flapping at the edges of triggers. */
  private static readonly CONTEXT_MIN_DWELL_TICKS = SIM.TICK_HZ * 10;
  /** Minimum gap between "under attack" alert stingers. */
  private static readonly ALERT_COOLDOWN_TICKS = SIM.TICK_HZ * 10;
  /** Max stereo pan for world-positioned SFX — keeps off-screen sounds audible
   *  in both ears instead of hard-panning fully left/right. */
  private static readonly MAX_SPATIAL_PAN = 0.6;
  /** How long the camera must dwell on the home base (while safe) before the
   *  peaceful village theme takes over. */
  private static readonly VILLAGE_LINGER_TICKS = SIM.TICK_HZ * 6;
  /** Grace window where the base still counts as "home" after panning away,
   *  so small camera nudges don't flap the village/playlist switch. */
  private static readonly HOME_LEAVE_GRACE_TICKS = SIM.TICK_HZ * 2;
  /** Camera-to-town-centre distance (world px) that counts as "at home". */
  private static readonly HOME_RADIUS_PX = 260;
  // Texture keys.
  private static readonly DARK_TC_KEY_PREFIX = 'voxel-dark-tc-p';
  private static readonly CASTLE_TC_KEY_PREFIX = 'voxel-castle-tc-p';
  private static readonly GUNPOWDER_TC_KEY_PREFIX = 'voxel-gunpowder-tc-p';
  private static readonly HOUSE_KEY = 'voxel-dark-house';
  private static readonly FARM_KEY = 'voxel-dark-farm';
  private static readonly MILL_KEY = 'voxel-dark-mill';
  private static readonly BARRACKS_KEY = 'voxel-dark-barracks';
  private static readonly ARCHERY_RANGE_KEY = 'voxel-dark-archery-range';
  private static readonly STABLE_KEY = 'voxel-dark-stable';
  private static readonly LUMBER_CAMP_KEY = 'voxel-dark-lumber-camp';
  private static readonly GOLD_MINE_KEY = 'voxel-dark-gold-mine';
  private static readonly STONE_QUARRY_KEY = 'voxel-dark-stone-quarry';
  private static readonly DEFENSIVE_TOWER_KEY_PREFIX = 'voxel-dark-defensive-tower-p';
  private static readonly WALL_X_KEY = 'voxel-palisade-wall-x';
  private static readonly WALL_Y_KEY = 'voxel-palisade-wall-y';
  private static readonly VILLAGER_KEY_PREFIX = 'voxel-villager-p';
  private static readonly ARCHER_KEY_PREFIX = 'voxel-archer-p';
  private static readonly SPEARMAN_KEY_PREFIX = 'voxel-spearman-p';
  private static readonly SCOUT_CAVALRY_KEY_PREFIX = 'voxel-scout-cavalry-p';
  private static readonly GUNMAN_KEY_PREFIX = 'voxel-gunman-p';
  private static readonly CANNON_KEY_PREFIX = 'voxel-cannon-p';
  private static readonly MACHINE_GUN_KEY_PREFIX = 'voxel-machine-gun-p';
  private static readonly MORTAR_KEY_PREFIX = 'voxel-mortar-p';
  private static readonly TREE_KEY = 'voxel-tree';
  private static readonly SNOW_TREE_KEY = 'voxel-snow-tree';
  private static readonly DEAD_TREE_KEY = 'voxel-dead-tree';
  private static readonly LINDEN_TREE_KEY = 'voxel-linden-tree';
  private static readonly JAGGED_ROCK_KEY = 'voxel-jagged-rock';
  private static readonly GOLD_KEY = 'voxel-gold';
  private static readonly STONE_KEY = 'voxel-stone';
  private static readonly BERRY_KEY = 'voxel-berry';
  private static readonly FOUNDRY_KEY = 'voxel-gunpowder-foundry';
  private static readonly FOG_EXPLORED_KEY = 'fog-of-war-explored';
  private static readonly FOG_UNEXPLORED_KEY = 'fog-of-war-unexplored';
  /** Drag-box select state. dragStart is set on left-pointer-down; cleared on up. */
  private dragStart: { x: number; y: number } | null = null;
  private dragCurrent: { x: number; y: number } | null = null;
  private isDragging = false;
  private dragGfx?: Phaser.GameObjects.Graphics;
  private static readonly DRAG_THRESHOLD_PX = 6;
  private lastLeftUnitClick: { eid: number; atMs: number } | null = null;
  private static readonly DOUBLE_CLICK_MS = 300;
  private static readonly SAME_TYPE_SELECT_RADIUS_TILES = 12;

  constructor() {
    super({ key: 'GameScene' });
  }

  private static isTextEntryTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
  }

  private static isTextEntryActive(): boolean {
    if (typeof document === 'undefined') return false;
    return GameScene.isTextEntryTarget(document.activeElement);
  }

  preload(): void {
    // Queue all SFX + music so they're decoded before create(). Render-only.
    AudioManager.queueLoad(this.load, SFX_KEYS);
    AudioManager.queueLoadMusic(this.load, [...MUSIC_KEYS, ...AMBIENCE_KEYS]);
    AudioManager.queueLoadVoices(this.load, VOICE_KEYS);
  }

  create(): void {
    this.world = createSimWorld(Date.now() & 0xffff);
    this.audio = new AudioManager(this);
    this.audio.playMenuMusic();

    // Bake all voxel textures once at scene boot.
    this.bakeAllTextures();

    this.worldContainer = this.add.container(
      RENDER.WIDTH / 2,
      RENDER.HEIGHT / 2 - (MAP.HEIGHT * ISO.TILE_H) / 4
    );

    // Terrain — single baked texture, lives at the bottom of the world container.
    this.terrainSprite = bakeTerrain(this, this.worldContainer, this.world.map);

    this.gridGfx = this.add.graphics();
    this.buildingsGfx = this.add.graphics();
    this.resourcesGfx = this.add.graphics();
    this.selectionGfx = this.add.graphics();
    this.unitsGfx = this.add.graphics();
    this.projectilesGfx = this.add.graphics();
    this.ghostGfx = this.add.graphics();
    this.fogGfx = this.add.graphics();
    this.worldContainer.add([
      this.gridGfx,
      this.buildingsGfx,
      this.resourcesGfx,
      this.selectionGfx,
      this.unitsGfx,
      this.projectilesGfx,
      this.ghostGfx,
      this.fogGfx,
    ]);
    this.fogGfx.setDepth(90000);
    this.projectilesGfx.setDepth(100000);
    this.createFogTextures();

    this.drawGrid();
    this.cameras.main.setZoom(this.zoom);
    this.panToLocalTownCenter();
    if (this.isScoutCavalryInspectionMode()) {
      this.createScoutCavalryInspectionSheet();
    } else if (this.isVillagerInspectionMode()) {
      this.createVillagerInspectionSheet();
    } else if (this.isArcherInspectionMode()) {
      this.createArcherInspectionSheet();
    } else if (this.isSpearmanInspectionMode()) {
      this.createSpearmanInspectionSheet();
    } else if (this.isCannonInspectionMode()) {
      this.createCannonInspectionSheet();
    }
    this.input.mouse?.disableContextMenu();
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      this.onPointerDown(pointer);
    });
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
      this.onPointerMove(pointer);
    });
    this.input.on(Phaser.Input.Events.POINTER_UP, (pointer: Phaser.Input.Pointer) => {
      this.onPointerUp(pointer);
    });
    window.addEventListener('pointermove', this.onWindowPointerMove, true);
    window.addEventListener('pointerup', this.onWindowPointerUp, true);
    window.addEventListener('pointercancel', this.onWindowPointerUp, true);
    window.addEventListener('blur', this.onWindowBlur);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('pointermove', this.onWindowPointerMove, true);
      window.removeEventListener('pointerup', this.onWindowPointerUp, true);
      window.removeEventListener('pointercancel', this.onWindowPointerUp, true);
      window.removeEventListener('blur', this.onWindowBlur);
    });
    // Top-most graphics layer dedicated to drawing the drag-box rectangle.
    this.dragGfx = this.add.graphics();
    this.dragGfx.setDepth(20000);

    const onHotkey = (eventName: string, handler: (ev: KeyboardEvent) => void): void => {
      this.input.keyboard?.on(eventName, (ev: KeyboardEvent) => {
        if (GameScene.isTextEntryTarget(ev.target)) return;
        handler(ev);
      });
    };

    onHotkey('keydown-B', () => {
      this.awaitingBuildKind = true;
      this.buildMode = 'none';
      setLastEvent('build: M farm · I mill · L wood · C stone · other buildings unlock through research');
    });
    onHotkey('keydown-H', () => {
      if (this.awaitingBuildKind) {
        this.startBuildMode('HOUSE', 'build HOUSE — left-click to place, right-click to cancel');
      } else {
        this.setSelectedUnitStance(UnitStanceId.HOLD_POSITION);
      }
    });
    onHotkey('keydown-M', () => {
      if (this.awaitingBuildKind) {
        this.startBuildMode('FARM', 'build FARM — left-click to place');
      }
    });
    onHotkey('keydown-I', () => {
      if (this.awaitingBuildKind) {
        this.startBuildMode('MILL', 'build MILL — left-click to place');
      }
    });
    onHotkey('keydown-L', () => {
      if (this.awaitingBuildKind) {
        this.startBuildMode('LUMBER_CAMP', 'build LUMBER HUT — left-click near trees');
      }
    });
    onHotkey('keydown-G', () => {
      if (this.awaitingBuildKind) {
        this.startBuildMode('GOLD_MINE', 'build GOLD MINE — left-click near gold');
      }
    });
    onHotkey('keydown-C', () => {
      if (this.awaitingBuildKind) {
        this.startBuildMode('STONE_QUARRY', 'build STONE QUARRY — left-click near stone');
      }
    });
    onHotkey('keydown-R', () => {
      if (this.awaitingBuildKind) {
        this.startBuildMode('BARRACKS', 'build BARRACKS — left-click to place');
      }
    });
    onHotkey('keydown-A', () => {
      if (this.awaitingBuildKind) {
        this.awaitingBuildKind = false;
        setLastEvent('archers train at barracks — no separate range');
      }
    });
    onHotkey('keydown-T', () => {
      if (this.awaitingBuildKind) {
        this.startBuildMode('STABLE', 'build STABLE — left-click to place');
      }
    });
    onHotkey('keydown-F', () => {
      if (this.awaitingBuildKind) {
        this.startBuildMode('FOUNDRY', 'build FOUNDRY — left-click to place');
      }
    });
    onHotkey('keydown-Y', () => {
      if (this.awaitingBuildKind) {
        this.startBuildMode('DEFENSIVE_TOWER', 'build DEFENSIVE TOWER — left-click to place');
      }
    });
    onHotkey('keydown-ESC', () => {
      if (this.buildMode !== 'none' || this.awaitingBuildKind || this.armyRallyMode) {
        this.buildMode = 'none';
        this.armyRallyMode = false;
        this.awaitingBuildKind = false;
        this.ghostGfx.clear();
        setLastEvent('placement cancelled');
      }
    });
    onHotkey('keydown-Q', () => this.onTrainHotkey(0));
    onHotkey('keydown-E', () => this.onSecondaryActionHotkey());
    onHotkey('keydown-V', () => this.startArmyRallyMode());
    onHotkey('keydown-DELETE', () => this.removeSelectedBuildings());

    // Zoom: mouse wheel scales by event deltaY (Mac trackpad pinch sends many
    // small events per gesture; we scale-then-clamp so gestures feel smooth
    // rather than jumpy).
    this.input.on(
      'wheel',
      (
        pointer: Phaser.Input.Pointer,
        _over: Phaser.GameObjects.GameObject[],
        _dx: number,
        dy: number
      ) => {
        let delta = -dy * GameScene.ZOOM_WHEEL_SCALE;
        if (delta > GameScene.ZOOM_WHEEL_CLAMP) delta = GameScene.ZOOM_WHEEL_CLAMP;
        if (delta < -GameScene.ZOOM_WHEEL_CLAMP) delta = -GameScene.ZOOM_WHEEL_CLAMP;
        if (Math.abs(delta) < 0.001) return; // ignore micro-events
        this.applyZoom(delta, pointer.worldX, pointer.worldY);
      }
    );
    onHotkey('keydown-PLUS', () => this.applyZoom(GameScene.ZOOM_KEY_STEP));
    onHotkey('keydown-EQUALS', () => this.applyZoom(GameScene.ZOOM_KEY_STEP));
    onHotkey('keydown-MINUS', () => this.applyZoom(-GameScene.ZOOM_KEY_STEP));
    onHotkey('keydown-F1', (ev: KeyboardEvent) => {
      ev.preventDefault();
      this.selectAllVillagers();
    });
    onHotkey('keydown-F2', (ev: KeyboardEvent) => {
      ev.preventDefault();
      this.selectAllMilitary();
    });
    onHotkey('keydown-X', () => this.toggleGameSpeed());

    this.installDebugWindowApi();

    setLastEvent('Economy pivot — place farms, mills, and worksites with B+M/I/L/G/C');

    // Scene is fully built (graphics + textures). If a multiplayer match start
    // arrived before create() finished (fast relay vs. slow texture bake), flush
    // it now.
    this.created = true;
    if (this.pendingMpMatch) {
      const m = this.pendingMpMatch;
      this.pendingMpMatch = null;
      this.beginMultiplayerMatch(m.session, m.world, m.localPlayerId);
    }
  }

  update(_time: number, delta: number): void {
    if (this.scoutInspectionMode) return;

    if (this.multiplayer) {
      // Lockstep owns tick advancement. Interpolation must follow the actual
      // lockstep step time, not a free-running render accumulator, or render
      // alpha drifts against PrevPosition -> Position and movement jitters.
      this.accumulatorMs = this.multiplayer.interpolationMs();
    } else {
      this.accumulatorMs += delta * this.gameSpeed;
      let safety = 0;
      while (this.accumulatorMs >= SIM.TICK_MS && safety++ < 8) {
        step(this.world);
        this.accumulatorMs -= SIM.TICK_MS;
      }
    }

    pruneHiddenSelectionForPlayer(this.world, this.perspectivePlayerId);

    const cam = this.cameras.main;
    const speed = 6;
    const keys = GameScene.isTextEntryActive()
      ? undefined
      : this.input.keyboard?.addKeys('W,A,S,D', false) as
        | Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>
        | undefined;
    if (keys) {
      if (keys.W.isDown) cam.scrollY -= speed;
      if (keys.S.isDown) cam.scrollY += speed;
      if (keys.A.isDown) cam.scrollX -= speed;
      if (keys.D.isDown) cam.scrollX += speed;
    }

    this.drawMapFeatures();
    this.drawBuildings();
    this.drawResources();
    this.drawUnits();
    this.drawLastSeenBuildings();
    this.consumeCombatEvents();
    this.consumeAiEvents();
    this.consumeSoundCues();
    this.updateMusicDirector();
    this.drawProjectiles(delta * this.gameSpeed);
    this.drawGhost();
    this.drawAttackCursorIndicator();
    this.drawFogOfWar();
    this.fps = this.game.loop.actualFps;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Drawing
  // ──────────────────────────────────────────────────────────────────────────

  private drawGrid(): void {
    // No-op now — terrain is baked into a single static texture in create().
    this.gridGfx.clear();
  }

  private drawBuildings(): void {
    const g = this.buildingsGfx;
    g.clear();
    const ents = buildingQuery(this.world.ecs);
    const seenEids = new Set<number>();

    for (const eid of ents) {
      const defId = Building.defId[eid];
      const def = BUILDING_TABLE[defId];
      if (!def) continue;
      if (!this.isEntityVisibleToLocal(eid)) continue;
      // Lift to the tile's elevation so the building visually sits on the
      // terrain tile (which is also rendered at e × VPER above flat).
      const c = this.buildingScreenPosition(eid);
      const player = Owner.player[eid];
      const isFoundation = hasComponent(this.world.ecs, ConstructionSite, eid);
      const key = this.buildingTextureKeyForEntity(eid, defId, player);
      const originY = this.buildingSpriteOriginY(defId, player);
      if (!key || !this.textures.exists(key)) continue;

      seenEids.add(eid);
      let sprite = this.buildingSprites.get(eid);
      if (!sprite) {
        sprite = this.add.sprite(c.x, c.y, key);
        sprite.setOrigin(0.5, originY);
        this.worldContainer.add(sprite);
        this.buildingSprites.set(eid, sprite);
      } else if (sprite.texture.key !== key) {
        sprite.setTexture(key);
        sprite.setOrigin(0.5, originY);
      }
      sprite.setPosition(c.x, c.y);
      sprite.clearTint();
      sprite.setAlpha(isFoundation ? 0.5 : 1.0);
      sprite.setDepth(c.y);

      // Foundation progress bar.
      if (isFoundation) {
        const total = ConstructionSite.totalTicks[eid] || 1;
        const frac = Math.min(1, ConstructionSite.progress[eid] / total);
        const barW = 40, barH = 5;
        const barX = c.x - barW / 2, barY = c.y - 50;
        g.fillStyle(0x000000, 0.6);
        g.fillRect(barX, barY, barW, barH);
        g.fillStyle(0xfeca57, 0.95);
        g.fillRect(barX, barY, barW * frac, barH);
        g.lineStyle(1, 0xffffff, 0.6);
        g.strokeRect(barX, barY, barW, barH);
      }

      // Producer queue progress bar.
      if (hasComponent(this.world.ecs, Producer, eid) && !isFoundation) {
        const queue = this.world.productionQueues.get(eid);
        if (queue && queue.length > 0) {
          const trainDef = getUnitDef(queue[0]);
          if (trainDef) {
            const frac = Producer.currentProgress[eid] / trainDef.trainTimeTicks;
            const barW = 30, barH = 4;
            const barX = c.x - barW / 2, barY = c.y - 44;
            g.fillStyle(0x000000, 0.6);
            g.fillRect(barX, barY, barW, barH);
            g.fillStyle(0x4ecdc4, 0.95);
            g.fillRect(barX, barY, barW * frac, barH);
          }
        }
      }

      if (hasComponent(this.world.ecs, ResourceWorksite, eid) && !isFoundation) {
        const workers = ResourceWorksite.assignedWorkers[eid];
        const slots = getWorksiteWorkerSlots(this.world, eid);
        const dotY = c.y - 42;
        for (let i = 0; i < slots; i++) {
          const x = c.x - (slots - 1) * 4 + i * 8;
          g.fillStyle(i < workers ? 0x4ecdc4 : 0x2c3e50, i < workers ? 1 : 0.65);
          g.fillCircle(x, dotY, 2.5);
          g.lineStyle(1, 0x000000, 0.65);
          g.strokeCircle(x, dotY, 2.5);
        }
      }
    }

    // Cleanup sprites for destroyed entities.
    for (const [eid, sprite] of this.buildingSprites) {
      if (!seenEids.has(eid)) {
        sprite.destroy();
        this.buildingSprites.delete(eid);
      }
    }
  }

  private drawMapFeatures(): void {
    const seen = new Set<string>();
    for (const feature of this.world.map.features) {
      if (!this.isMapFeatureExploredByLocal(feature)) continue;
      const key = this.mapFeatureTextureKey(feature.kind);
      if (!key || !this.textures.exists(key)) continue;
      const id = `${feature.kind}:${feature.x},${feature.y}:${feature.size ?? 1}`;
      seen.add(id);
      const screen = this.mapFeatureScreenPosition(feature);
      const originY = feature.kind === MapFeatureKind.ROCK_SPIRE ? 0.88 : 0.86;
      const scale = feature.kind === MapFeatureKind.ROCK_SPIRE
        ? (this.mapFeatureSize(feature) === 4 ? 2.1 : 1.15)
        : 1;
      let sprite = this.mapFeatureSprites.get(id);
      if (!sprite) {
        sprite = this.add.sprite(screen.x, screen.y, key);
        sprite.setOrigin(0.5, originY);
        sprite.setScale(scale);
        this.worldContainer.add(sprite);
        this.mapFeatureSprites.set(id, sprite);
      } else if (sprite.texture.key !== key) {
        sprite.setTexture(key);
        sprite.setOrigin(0.5, originY);
      }
      sprite.setPosition(screen.x, screen.y);
      sprite.setScale(scale);
      sprite.setDepth(screen.y - 1);
    }
    for (const [id, sprite] of this.mapFeatureSprites) {
      if (!seen.has(id)) {
        sprite.destroy();
        this.mapFeatureSprites.delete(id);
      }
    }
  }

  private drawResources(): void {
    this.resourcesGfx.clear();
    const ents = resourceQuery(this.world.ecs);
    const seen = new Set<number>();
    for (const eid of ents) {
      if (!this.isResourceExploredByLocal(eid)) continue;
      const kind = Resource.kind[eid];
      const key = this.resourceTextureKey(eid, kind);
      if (!key || !this.textures.exists(key)) continue;
      seen.add(eid);
      const screen = this.tileToScreenElev(Position.x[eid], Position.y[eid]);
      let sprite = this.resourceSprites.get(eid);
      if (!sprite) {
        sprite = this.add.sprite(screen.x, screen.y, key);
        sprite.setOrigin(0.5, 0.85);
        this.worldContainer.add(sprite);
        this.resourceSprites.set(eid, sprite);
      }
      sprite.setPosition(screen.x, screen.y);
      sprite.setDepth(screen.y);
    }
    for (const [eid, sprite] of this.resourceSprites) {
      if (!seen.has(eid)) {
        sprite.destroy();
        this.resourceSprites.delete(eid);
      }
    }
  }

  private drawLastSeenBuildings(): void {
    const vis = getPlayerVisibility(this.world, this.perspectivePlayerId);
    const seen = new Set<number>();
    if (!vis) {
      this.clearLastSeenBuildingSprites(seen);
      return;
    }

    for (const snap of vis.lastSeenBuildings.values()) {
      if (!isTileExploredBy(this.world, this.perspectivePlayerId, snap.x, snap.y)) continue;
      if (
        isBuildingFootprintVisibleTo(
          this.world,
          this.perspectivePlayerId,
          snap.defId,
          snap.x,
          snap.y
        )
      ) continue;
      const key = this.buildingTextureKeyForAge(snap.defId, snap.owner, snap.age);
      if (!key || !this.textures.exists(key)) continue;
      seen.add(snap.eid);

      const def = BUILDING_TABLE[snap.defId];
      const anchor = def
        ? this.buildingAnchorTileForDef(def, snap.x, snap.y)
        : { x: snap.x, y: snap.y };
      const screen = this.tileToScreenElev(anchor.x, anchor.y);
      const originY = this.buildingSpriteOriginY(snap.defId, snap.owner, snap.age);
      let sprite = this.lastSeenBuildingSprites.get(snap.eid);
      if (!sprite) {
        sprite = this.add.sprite(screen.x, screen.y, key);
        sprite.setOrigin(0.5, originY);
        this.worldContainer.add(sprite);
        this.lastSeenBuildingSprites.set(snap.eid, sprite);
      } else if (sprite.texture.key !== key) {
        sprite.setTexture(key);
        sprite.setOrigin(0.5, originY);
      }
      sprite.setPosition(screen.x, screen.y);
      sprite.setDepth(screen.y - 1);
      sprite.setAlpha(snap.isFoundation ? 0.28 : 0.5);
      sprite.setTint(0x8d93a0);
    }

    this.clearLastSeenBuildingSprites(seen);
  }

  private clearLastSeenBuildingSprites(seen: Set<number>): void {
    for (const [eid, sprite] of this.lastSeenBuildingSprites) {
      if (!seen.has(eid)) {
        sprite.destroy();
        this.lastSeenBuildingSprites.delete(eid);
      }
    }
  }

  private drawUnits(): void {
    this.unitsGfx.clear();
    this.selectionGfx.clear();

    // Selection rings + health bars for buildings.
    const buildings = buildingQuery(this.world.ecs);
    for (const eid of buildings) {
      if (!this.isEntityVisibleToLocal(eid)) continue;
      const c = this.buildingScreenPosition(eid);
      const defId = Building.defId[eid];
      if (this.isSelected(eid)) {
        const ellipse = this.buildingSelectionEllipse(defId);
        this.selectionGfx.lineStyle(2, 0xfeca57, 1);
        this.selectionGfx.strokeEllipse(
          c.x,
          c.y + ellipse.yOffset,
          ellipse.width,
          ellipse.height
        );
      }
      if (!hasComponent(this.world.ecs, ConstructionSite, eid)) {
        this.drawHealthBar(eid, c.x, c.y - 60, 40);
      }
    }

    // Unit voxel sprites.
    const ents = unitQuery(this.world.ecs);
    const seen = new Set<number>();
    for (const eid of ents) {
      if (!this.isEntityVisibleToLocal(eid)) continue;
      const player = Owner.player[eid];
      const key = this.unitTextureKey(eid, player);
      if (!key || !this.textures.exists(key)) continue;
      seen.add(eid);

      // Interpolate between previous-tick and current-tick positions using
      // the fixed-timestep accumulator. alpha=0 means "freshly stepped", 1
      // means "about to step again". Eliminates 20 Hz sim judder at 60 fps.
      const alpha = Math.min(1, this.accumulatorMs / SIM.TICK_MS);
      const px = hasComponent(this.world.ecs, PrevPosition, eid)
        ? PrevPosition.x[eid] + (Position.x[eid] - PrevPosition.x[eid]) * alpha
        : Position.x[eid];
      const py = hasComponent(this.world.ecs, PrevPosition, eid)
        ? PrevPosition.y[eid] + (Position.y[eid] - PrevPosition.y[eid]) * alpha
        : Position.y[eid];
      const screen = this.tileToScreenElev(px, py);
      let sprite = this.unitSprites.get(eid);
      if (!sprite) {
        sprite = this.add.sprite(screen.x, screen.y, key);
        sprite.setOrigin(0.5, this.unitSpriteOriginY(eid));
        this.worldContainer.add(sprite);
        this.unitSprites.set(eid, sprite);
      } else if (sprite.texture.key !== key) {
        sprite.setTexture(key);
        sprite.setOrigin(0.5, this.unitSpriteOriginY(eid));
      }
      sprite.setPosition(screen.x, screen.y);
      sprite.setDepth(screen.y + 1);
      sprite.setScale(GameScene.UNIT_VISUAL_SCALE);

      // Selection ring under the unit.
      if (this.isSelected(eid)) {
        this.selectionGfx.lineStyle(2, 0xfeca57, 1);
        this.selectionGfx.strokeEllipse(screen.x, screen.y + 2, 20, 8);
      }

      // Carry indicator: small colored dot near head.
      const carryAmt = hasComponent(this.world.ecs, ResourceCarry, eid)
        ? ResourceCarry.amount[eid]
        : 0;
      const carryKind = hasComponent(this.world.ecs, ResourceCarry, eid)
        ? ResourceCarry.kind[eid]
        : 0;
      if (carryAmt > 0) {
        const cc = RESOURCE_COLOR[carryKind] ?? 0xffffff;
        this.unitsGfx.fillStyle(cc, 1);
        this.unitsGfx.fillCircle(screen.x + 8, screen.y - 26, 3.5);
        this.unitsGfx.lineStyle(1, 0x000000, 0.7);
        this.unitsGfx.strokeCircle(screen.x + 8, screen.y - 26, 3.5);
      }
      // Build / combat marker.
      if (hasComponent(this.world.ecs, Gatherer, eid)) {
        const st = Gatherer.state[eid];
        if (st === GathererStateId.BUILDING || st === GathererStateId.WALKING_TO_BUILD) {
          this.unitsGfx.fillStyle(0xfeca57, 1);
          this.unitsGfx.fillRect(screen.x - 10, screen.y - 30, 3, 3);
        }
      }
      // Health bar.
      this.drawHealthBar(eid, screen.x, screen.y - 34, 22);
    }
    // Cleanup sprites for dead units.
    for (const [eid, sprite] of this.unitSprites) {
      if (!seen.has(eid)) {
        sprite.destroy();
        this.unitSprites.delete(eid);
        this.scoutFacing.delete(eid);
        this.archerFacing.delete(eid);
        this.spearmanFacing.delete(eid);
        this.gunmanFacing.delete(eid);
        this.cannonFacing.delete(eid);
        this.machineGunFacing.delete(eid);
        this.mortarFacing.delete(eid);
        this.villagerFacing.delete(eid);
        this.unitAttackUntilTick.delete(eid);
      }
    }
  }

  private consumeCombatEvents(): void {
    if (this.world.combatEvents.length === 0) return;
    const events = this.world.combatEvents.splice(0);
    for (const event of events) {
      this.recordMinimapCombatAlert(event);
      this.playCombatSound(event);
      this.noteCombatForAdaptiveAudio(event);
      if (
        event.attackerKind === UnitDefId.SCOUT_CAVALRY ||
        event.attackerKind === UnitDefId.ARCHER ||
        event.attackerKind === UnitDefId.SPEARMAN ||
        event.attackerKind === UnitDefId.GUNMAN ||
        event.attackerKind === UnitDefId.CANNON ||
        event.attackerKind === UnitDefId.MACHINE_GUN ||
        event.attackerKind === UnitDefId.MORTAR
      ) {
        const animTicks =
          (event.attackerKind === UnitDefId.CANNON || event.attackerKind === UnitDefId.MORTAR) &&
          event.phase === 'windup'
            ? Math.max(GameScene.COMBAT_ATTACK_ANIM_TICKS, event.windupTicks ?? 0)
            : GameScene.COMBAT_ATTACK_ANIM_TICKS;
        this.unitAttackUntilTick.set(
          event.attackerEid,
          this.world.tick + animTicks
        );
      }
      if (
        (event.attackerKind === UnitDefId.CANNON || event.attackerKind === UnitDefId.MORTAR) &&
        event.phase === 'windup'
      ) {
        continue;
      }
      if (
        event.range > 1 &&
        (isTileVisibleTo(this.world, this.perspectivePlayerId, event.fromX, event.fromY) ||
          isTileVisibleTo(this.world, this.perspectivePlayerId, event.toX, event.toY))
      ) {
        if (event.attackerKind === UnitDefId.GUNMAN || event.attackerKind === UnitDefId.MACHINE_GUN) {
          this.spawnAttackProjectile(event, 'bullet');
        } else if (event.attackerKind === UnitDefId.CANNON) {
          this.spawnAttackProjectile(event, 'cannon');
        } else if (event.attackerKind === UnitDefId.MORTAR) {
          this.spawnAttackProjectile(event, 'mortar');
        } else if (
          event.attackerKind === UnitDefId.ARCHER ||
          hasComponent(this.world.ecs, Building, event.attackerEid)
        ) {
          this.spawnAttackProjectile(event, 'arrow');
        }
      }
    }
  }

  private recordMinimapCombatAlert(event: CombatEvent): void {
    if (event.phase === 'windup') return;
    const attackerPlayer = hasComponent(this.world.ecs, Owner, event.attackerEid)
      ? Owner.player[event.attackerEid]
      : 0;
    const targetPlayer = hasComponent(this.world.ecs, Owner, event.targetEid)
      ? Owner.player[event.targetEid]
      : 0;
    if (attackerPlayer !== this.perspectivePlayerId && targetPlayer !== this.perspectivePlayerId) return;
    const x = targetPlayer === this.perspectivePlayerId ? event.toX : event.fromX;
    const y = targetPlayer === this.perspectivePlayerId ? event.toY : event.fromY;
    this.minimapCombatAlerts.push({ x, y, tick: this.world.tick });
    const cutoff = this.world.tick - GameScene.MINIMAP_COMBAT_ALERT_TICKS;
    this.minimapCombatAlerts = this.minimapCombatAlerts.filter((alert) => alert.tick >= cutoff);
  }

  private consumeAiEvents(): void {
    if (this.world.aiEvents.length === 0) return;
    const events = this.world.aiEvents.splice(0);
    const latest = events[events.length - 1];
    if (latest) setLastEvent(latest.message);
  }

  /** Per-frame music director. Chooses the in-game music context by priority:
   *  combat (battle theme, or duck the playlist as fallback) > lingering safely
   *  at the home base (village theme) > the default filler playlist. */
  private updateMusicDirector(): void {
    if (!this.inMatch) return;
    const tick = this.world.tick;
    const recentCombat =
      this.lastLocalCombatTick >= 0 &&
      tick - this.lastLocalCombatTick < GameScene.BATTLE_HOLD_TICKS;
    const recentlyAttacked =
      this.lastAlertTick >= 0 && tick - this.lastAlertTick < GameScene.BATTLE_HOLD_TICKS;
    // Stay in "battle" only while there's a live reason: a surviving army still
    // in the field, or the base under recent attack. If the local army is wiped
    // and nothing's hitting home, the fight is over → let the score wind down
    // (still a slow crossfade, not a snap) instead of holding empty battle music.
    const danger =
      recentCombat && (recentlyAttacked || this.localHasLivingMilitary());

    // Ambience tracks danger directly (its own slow crossfade): battle din while
    // fighting, calm nature bed otherwise — so quiet is never truly silent.
    this.audio.playAmbience(danger ? BATTLE_AMBIENCE : NATURE_AMBIENCE);

    // Decide the desired music context.
    let desired: 'playlist' | 'village' | 'battle';
    if (danger) {
      desired = 'battle';
      this.villageEnteredTick = -1;
    } else {
      const rawHome = this.cameraNearHomeBase();
      if (rawHome) this.lastHomeTick = tick;
      const atHome =
        rawHome ||
        (this.lastHomeTick >= 0 && tick - this.lastHomeTick < GameScene.HOME_LEAVE_GRACE_TICKS);
      if (atHome) {
        if (this.villageEnteredTick < 0) this.villageEnteredTick = tick;
        desired =
          tick - this.villageEnteredTick >= GameScene.VILLAGE_LINGER_TICKS ? 'village' : 'playlist';
      } else {
        this.villageEnteredTick = -1;
        desired = 'playlist';
      }
    }

    this.applyMusicContext(desired);
  }

  /** Switch to the desired context subject to dwell rules. Battle interrupts
   *  immediately; leaving battle is already gated by BATTLE_HOLD_TICKS; the
   *  village↔playlist swap needs a minimum dwell so it can't flap. */
  private applyMusicContext(desired: 'playlist' | 'village' | 'battle'): void {
    if (desired !== this.musicContext) {
      const dwell = this.contextSinceTick < 0 ? Infinity : this.world.tick - this.contextSinceTick;
      const canSwitch =
        desired === 'battle' ||
        this.musicContext === 'battle' ||
        dwell >= GameScene.CONTEXT_MIN_DWELL_TICKS;
      if (!canSwitch) {
        this.playContext(this.musicContext);
        return;
      }
      this.musicContext = desired;
      this.contextSinceTick = this.world.tick;
      if (desired !== 'battle') this.battleTrack = null;
    }
    this.playContext(this.musicContext);
  }

  /** Drive the audio layer for the active context (idempotent every frame). */
  private playContext(ctx: 'playlist' | 'village' | 'battle'): void {
    if (ctx === 'battle') {
      if (this.battleTrack === null) this.battleTrack = this.pickBattleTrack();
      if (this.battleTrack) {
        this.audio.setMusicDucked(false);
        this.audio.playLooping(this.battleTrack);
      } else {
        // No battle track supplied — keep the playlist but duck it.
        this.audio.playGamePlaylist();
        this.audio.setMusicDucked(true);
      }
      return;
    }
    this.audio.setMusicDucked(false);
    // Village + playlist both breathe (song → ambience-only gap → song); only
    // battle stays a continuous loop. So peaceful music never plays endlessly.
    if (ctx === 'village') this.audio.playGappedSingle(VILLAGE_MUSIC);
    else this.audio.playGamePlaylist();
  }

  /** Random battle track whose asset exists, or null if none supplied yet. */
  private pickBattleTrack(): string | null {
    const present = BATTLE_TRACKS.filter((k) => this.audio.hasTrack(k));
    if (present.length === 0) return null;
    return present[Math.floor(Math.random() * present.length)];
  }

  /** True when the camera is centred close to the local player's town centre. */
  private cameraNearHomeBase(): boolean {
    const tc = this.localTownCenterPos();
    if (!tc) return false;
    const local = tileToScreen(tc.x, tc.y);
    const absX = this.worldContainer.x + local.x;
    const absY = this.worldContainer.y + local.y;
    const view = this.cameras.main.worldView;
    return Math.hypot(absX - view.centerX, absY - view.centerY) <= GameScene.HOME_RADIUS_PX;
  }

  /** Position of the local player's (living) town centre, or null if none. */
  private localTownCenterPos(): { x: number; y: number } | null {
    for (const eid of buildingQuery(this.world.ecs)) {
      if (Owner.player[eid] !== this.perspectivePlayerId) continue;
      if (!hasComponent(this.world.ecs, TownCenterTag, eid)) continue;
      if (hasComponent(this.world.ecs, Health, eid) && Health.hp[eid] <= 0) continue;
      return { x: Position.x[eid], y: Position.y[eid] };
    }
    return null;
  }

  /** True if the local player still has at least one living military unit
   *  (villagers excluded). Drives battle-music wind-down when an army is wiped. */
  private localHasLivingMilitary(): boolean {
    for (const eid of unitQuery(this.world.ecs)) {
      if (Owner.player[eid] !== this.perspectivePlayerId) continue;
      if (hasComponent(this.world.ecs, VillagerTag, eid)) continue;
      if (hasComponent(this.world.ecs, Health, eid) && Health.hp[eid] <= 0) continue;
      return true;
    }
    return false;
  }

  /** Play the fire-sound for a combat event, gated by fog (only audible if the
   *  attacker or target tile is visible to the local player). */
  private playCombatSound(event: CombatEvent): void {
    const isBuildingAttacker = hasComponent(this.world.ecs, Building, event.attackerEid);
    const cfg = combatSound(event.attackerKind, event.range, event.phase, isBuildingAttacker);
    if (!cfg) return;
    const fromVisible = isTileVisibleTo(this.world, this.perspectivePlayerId, event.fromX, event.fromY);
    const toVisible = isTileVisibleTo(this.world, this.perspectivePlayerId, event.toX, event.toY);
    if (!fromVisible && !toVisible) return;
    // Pan/attenuate around the attacker for fire, the target for melee impact.
    const x = event.range <= 1 ? event.toX : event.fromX;
    const y = event.range <= 1 ? event.toY : event.fromY;
    this.playSpatial(cfg, x, y);
  }

  /** Feed adaptive audio: duck music while the local player is fighting and
   *  fire an "under attack" stinger (throttled) when local assets take hits. */
  private noteCombatForAdaptiveAudio(event: CombatEvent): void {
    if (event.phase === 'windup') return;
    const attackerPlayer = hasComponent(this.world.ecs, Owner, event.attackerEid)
      ? Owner.player[event.attackerEid]
      : 0;
    const targetPlayer = hasComponent(this.world.ecs, Owner, event.targetEid)
      ? Owner.player[event.targetEid]
      : 0;
    if (attackerPlayer === this.perspectivePlayerId || targetPlayer === this.perspectivePlayerId) {
      this.lastLocalCombatTick = this.world.tick;
    }
    // We're being hit → warn the player, but not more than once per cooldown.
    if (targetPlayer === this.perspectivePlayerId) {
      const elapsed = this.world.tick - this.lastAlertTick;
      if (this.lastAlertTick < 0 || elapsed >= GameScene.ALERT_COOLDOWN_TICKS) {
        this.lastAlertTick = this.world.tick;
        this.audio.play(ALERT.key, { volume: ALERT.volume, minIntervalMs: ALERT.minIntervalMs });
      }
    }
  }

  /** Drain sim sound cues (non-combat state transitions). Fog-gated; non-spatial
   *  cues (age-up fanfare) only play for the local player. */
  private consumeSoundCues(): void {
    if (this.world.soundCues.length === 0) return;
    const cues = this.world.soundCues.splice(0);
    for (const cue of cues) {
      const cfg = cueSound(cue.kind);
      if (isNonSpatialCue(cue.kind)) {
        if (cue.player === this.perspectivePlayerId) {
          this.audio.play(cfg.key, { volume: cfg.volume, minIntervalMs: cfg.minIntervalMs });
        }
        continue;
      }
      if (
        cue.player !== this.perspectivePlayerId &&
        !isTileVisibleTo(this.world, this.perspectivePlayerId, cue.x, cue.y)
      ) {
        continue;
      }
      this.playSpatial(cfg, cue.x, cue.y);
    }
  }

  /** Play a sound positioned in the world: stereo pan + volume falloff relative
   *  to the camera's visible region. */
  private playSpatial(cfg: SfxConfig, tileX: number, tileY: number): void {
    const local = tileToScreen(tileX, tileY);
    const absX = this.worldContainer.x + local.x;
    const absY = this.worldContainer.y + local.y;
    const view = this.cameras.main.worldView;
    const halfW = Math.max(1, view.width / 2);
    const halfH = Math.max(1, view.height / 2);
    // Soften stereo pan: never hard-pan fully to one ear (felt like the sound
    // "only plays on the left"). Scale to ±MAX_SPATIAL_PAN.
    const pan = Phaser.Math.Clamp(
      ((absX - view.centerX) / halfW) * GameScene.MAX_SPATIAL_PAN,
      -GameScene.MAX_SPATIAL_PAN,
      GameScene.MAX_SPATIAL_PAN
    );
    const overshootX = Math.max(0, Math.abs(absX - view.centerX) - halfW);
    const overshootY = Math.max(0, Math.abs(absY - view.centerY) - halfH);
    const overshoot = Math.hypot(overshootX, overshootY);
    const falloff = Phaser.Math.Clamp(1 - overshoot / halfW, 0.2, 1);
    this.audio.play(cfg.key, {
      pan,
      volume: cfg.volume * falloff,
      minIntervalMs: cfg.minIntervalMs,
    });
  }

  /** Play a non-spatial UI/command sound (centre pan, fixed volume). */
  private playUi(cfg: SfxConfig): void {
    this.audio.play(cfg.key, { volume: cfg.volume, minIntervalMs: cfg.minIntervalMs });
  }

  /** Voice persona for a unit: villagers by gender (farm → female), soldiers by
   *  kind across three voices. null for units with no voice (e.g. siege). */
  private voiceCategoryForUnit(eid: number): VoiceCategory | null {
    if (hasComponent(this.world.ecs, VillagerTag, eid)) {
      return this.isFarmWorker(eid) ? 'villager_female' : 'villager_male';
    }
    if (hasComponent(this.world.ecs, SpearmanTag, eid)) return 'soldier_1';
    if (hasComponent(this.world.ecs, ArcherTag, eid)) return 'soldier_2';
    if (hasComponent(this.world.ecs, ScoutCavalryTag, eid)) return 'soldier_3';
    if (hasComponent(this.world.ecs, GunmanTag, eid)) return 'soldier_1';
    if (hasComponent(this.world.ecs, CannonTag, eid)) return 'soldier_2';
    if (hasComponent(this.world.ecs, MachineGunTag, eid)) return 'soldier_3';
    // Mortar teams are siege crews — no callouts.
    if (hasComponent(this.world.ecs, MortarTag, eid)) return null;
    return null;
  }

  /** True if the villager is staffing a food (farm) worksite → female voice. */
  private isFarmWorker(eid: number): boolean {
    if (!hasComponent(this.world.ecs, WorksiteWorker, eid)) return false;
    const site = WorksiteWorker.siteEid[eid];
    return (
      site >= 0 &&
      hasComponent(this.world.ecs, ResourceWorksite, site) &&
      ResourceWorksite.kind[site] === ResourceKindId.FOOD
    );
  }

  /** First local-owned unit in the current selection (the one that "speaks"). */
  private representativeSelectedUnit(): number | null {
    for (const eid of selectedQuery(this.world.ecs)) {
      if (Owner.player[eid] === this.perspectivePlayerId && hasComponent(this.world.ecs, UnitKind, eid)) {
        return eid;
      }
    }
    return null;
  }

  /** Play a unit's voice bark; returns false if the unit has no clip for that
   *  type (caller falls back to a UI blip). */
  private playUnitBark(eid: number, type: VoiceBarkType): boolean {
    const category = this.voiceCategoryForUnit(eid);
    if (!category) return false;
    return this.audio.playVoiceBark(category, type, VOICE_LINE_COUNTS[type]);
  }

  /** Voice bark (or blip fallback) for a single selected unit. */
  private barkSelect(eid: number): void {
    if (!this.playUnitBark(eid, 'select')) this.playUi(UNIT_SELECT);
  }

  /** Move/gather acknowledgement: representative selected unit speaks a calm
   *  "on our way" line; blip fallback. No-op when nothing commandable selected. */
  private barkMove(): void {
    const eid = this.representativeSelectedUnit();
    if (eid === null) return;
    if (!this.playUnitBark(eid, 'move')) this.playUi(COMMAND_MOVE);
  }

  /** Attack / attack-move acknowledgement: aggressive battle-cry line; blip
   *  fallback. No-op when nothing commandable selected. */
  private barkAttack(): void {
    const eid = this.representativeSelectedUnit();
    if (eid === null) return;
    if (!this.playUnitBark(eid, 'attack')) this.playUi(COMMAND_MOVE);
  }

  /** Public accessors so the HUD (volume slider / mute, button clicks/hovers)
   *  can reach audio. Undefined until create() has run. */
  getAudio(): AudioManager | undefined {
    return this.audio;
  }

  playUiClick(): void {
    if (!this.audio) return;
    this.playUi(UI_CLICK);
  }

  playUiHover(): void {
    if (!this.audio) return;
    this.playUi(UI_HOVER);
  }

  private spawnAttackProjectile(event: CombatEvent, kind: ProjectileKind): void {
    const start = this.tileToScreenElev(event.fromX, event.fromY);
    const end = this.tileToScreenElev(event.toX, event.toY);
    const startOffsetY = hasComponent(this.world.ecs, Building, event.attackerEid)
      ? -68
      : kind === 'cannon'
        ? -18
        : kind === 'mortar'
          ? -34
          : -28;
    const targetOffsetY = hasComponent(this.world.ecs, Building, event.targetEid)
      ? -42
      : kind === 'cannon' || kind === 'mortar'
        ? -16
        : -22;
    const distTiles = Math.hypot(event.fromX - event.toX, event.fromY - event.toY);
    const eventMs = (event.projectileTicks ?? 0) > 0 ? event.projectileTicks! * SIM.TICK_MS : 0;
    const durationMs = kind === 'bullet'
      ? eventMs > 0
        ? eventMs
        : Math.max(70, Math.min(160, distTiles * 24))
      : kind === 'cannon'
        ? eventMs > 0
          ? eventMs
          : Math.max(240, Math.min(620, distTiles * 72))
        : kind === 'mortar'
          ? eventMs > 0
            ? eventMs
            : Math.max(300, Math.min(760, distTiles * 95))
          : eventMs > 0
            ? eventMs
            : Math.max(180, Math.min(520, distTiles * 70));
    this.activeProjectiles.push({
      kind,
      startX: start.x,
      startY: start.y + startOffsetY,
      endX: end.x,
      endY: end.y + targetOffsetY,
      elapsedMs: 0,
      durationMs,
    });
  }

  private drawProjectiles(deltaMs: number): void {
    const g = this.projectilesGfx;
    g.clear();
    if (this.activeProjectiles.length === 0) return;

    const remaining: AttackProjectile[] = [];
    for (const projectile of this.activeProjectiles) {
      projectile.elapsedMs += deltaMs;
      const t = Math.min(1, projectile.elapsedMs / projectile.durationMs);
      if (t >= 1) continue;

      if (projectile.kind === 'bullet') {
        const tailT = Math.max(0, t - 0.22);
        const x = Phaser.Math.Linear(projectile.startX, projectile.endX, t);
        const y = Phaser.Math.Linear(projectile.startY, projectile.endY, t);
        const tx = Phaser.Math.Linear(projectile.startX, projectile.endX, tailT);
        const ty = Phaser.Math.Linear(projectile.startY, projectile.endY, tailT);
        g.lineStyle(4, 0x2c2418, 0.45);
        g.lineBetween(tx, ty, x, y);
        g.lineStyle(2, 0xfff0a6, 0.95);
        g.lineBetween(tx, ty, x, y);
      } else if (projectile.kind === 'cannon') {
        const arc = -Math.sin(t * Math.PI) * 18;
        const x = Phaser.Math.Linear(projectile.startX, projectile.endX, t);
        const y = Phaser.Math.Linear(projectile.startY, projectile.endY, t) + arc;
        const pulse = Math.sin(t * Math.PI);
        g.fillStyle(0x0f1114, 0.75);
        g.fillCircle(x + 2, y + 2, 5);
        g.fillStyle(0x34383b, 1);
        g.fillCircle(x, y, 4);
        g.fillStyle(0x9aa0a8, 0.7);
        g.fillCircle(x - 1.5, y - 1.5, 1.5);
        if (t > 0.75) {
          g.lineStyle(2, 0xd6a51f, (t - 0.75) * 2.2);
          g.strokeCircle(projectile.endX, projectile.endY, 8 + pulse * 5);
        }
      } else if (projectile.kind === 'mortar') {
        // High, slow lob with a smoke trail; bigger impact bloom than a cannon.
        const arc = -Math.sin(t * Math.PI) * 46;
        const x = Phaser.Math.Linear(projectile.startX, projectile.endX, t);
        const y = Phaser.Math.Linear(projectile.startY, projectile.endY, t) + arc;
        const tailT = Math.max(0, t - 0.12);
        const tailArc = -Math.sin(tailT * Math.PI) * 46;
        const tx = Phaser.Math.Linear(projectile.startX, projectile.endX, tailT);
        const ty = Phaser.Math.Linear(projectile.startY, projectile.endY, tailT) + tailArc;
        const pulse = Math.sin(t * Math.PI);
        g.lineStyle(3, 0xb7bdc0, 0.35 * (1 - t));
        g.lineBetween(tx, ty, x, y);
        g.fillStyle(0x0f1114, 0.7);
        g.fillCircle(x + 2, y + 2, 4.5);
        g.fillStyle(0x2a2f32, 1);
        g.fillCircle(x, y, 3.5);
        g.fillStyle(0xb89a4a, 0.85);
        g.fillCircle(x - 1, y - 1.5, 1.3);
        if (t > 0.7) {
          g.lineStyle(2, 0xd6a51f, (t - 0.7) * 2.4);
          g.strokeCircle(projectile.endX, projectile.endY, 10 + pulse * 8);
        }
      } else {
        const tailT = Math.max(0, t - 0.1);
        const arc = -Math.sin(t * Math.PI) * 10;
        const tailArc = -Math.sin(tailT * Math.PI) * 10;
        const x = Phaser.Math.Linear(projectile.startX, projectile.endX, t);
        const y = Phaser.Math.Linear(projectile.startY, projectile.endY, t) + arc;
        const tx = Phaser.Math.Linear(projectile.startX, projectile.endX, tailT);
        const ty = Phaser.Math.Linear(projectile.startY, projectile.endY, tailT) + tailArc;

        g.lineStyle(3, 0x2c2418, 0.45);
        g.lineBetween(tx, ty, x, y);
        g.lineStyle(2, 0xf1d58a, 1);
        g.lineBetween(tx, ty, x, y);

        const angle = Math.atan2(y - ty, x - tx);
        const headLen = 4;
        const wing = 2.5;
        const bx = x - Math.cos(angle) * headLen;
        const by = y - Math.sin(angle) * headLen;
        const px = Math.cos(angle + Math.PI / 2) * wing;
        const py = Math.sin(angle + Math.PI / 2) * wing;
        g.fillStyle(0xc0c4d0, 1);
        g.fillTriangle(x, y, bx + px, by + py, bx - px, by - py);
      }

      remaining.push(projectile);
    }
    this.activeProjectiles = remaining;
  }

  private drawHealthBar(eid: number, cx: number, topY: number, width: number): void {
    if (!hasComponent(this.world.ecs, Health, eid)) return;
    const hp = Health.hp[eid];
    const max = Health.hpMax[eid];
    if (hp >= max || max <= 0) return;
    const frac = Math.max(0, hp / max);
    const w = width;
    const h = 3;
    const x = cx - w / 2;
    this.unitsGfx.fillStyle(0x000000, 0.7);
    this.unitsGfx.fillRect(x, topY, w, h);
    const fillColor = frac > 0.6 ? 0x4caf50 : frac > 0.3 ? 0xffc107 : 0xff4757;
    this.unitsGfx.fillStyle(fillColor, 1);
    this.unitsGfx.fillRect(x, topY, w * frac, h);
  }

  private drawAttackCursorIndicator(): void {
    if (this.buildMode !== 'none' || this.armyRallyMode || this.input.activePointer.rightButtonDown()) {
      return;
    }
    if (!this.hasSelectedAttackCommandSource()) {
      return;
    }

    const pointer = this.input.activePointer;
    const { tileX, tileY } = this.pointerToTile(pointer);
    const hoveredEid = findEntityNear(this.world, tileX, tileY, 0.7);
    if (hoveredEid === null || !this.isAttackableEnemy(hoveredEid)) {
      return;
    }

    const isBuilding = hasComponent(this.world.ecs, Building, hoveredEid);
    const target = isBuilding
      ? this.buildingScreenPosition(hoveredEid)
      : this.tileToScreenElev(Position.x[hoveredEid], Position.y[hoveredEid]);
    const ellipse = isBuilding
      ? this.buildingSelectionEllipse(Building.defId[hoveredEid])
      : { yOffset: 2, width: 26, height: 10 };
    const targetY = target.y + ellipse.yOffset;
    const targetW = ellipse.width;
    const targetH = ellipse.height;
    this.selectionGfx.lineStyle(2, 0xff4757, 0.9);
    this.selectionGfx.strokeEllipse(target.x, targetY, targetW, targetH);
  }

  private drawFogOfWar(): void {
    this.fogGfx.clear();
    const vis = getPlayerVisibility(this.world, this.perspectivePlayerId);
    if (!vis) return;
    if (!this.fogExploredTexture || !this.fogUnexploredTexture || !this.terrainSprite) {
      this.createFogTextures();
    }
    if (!this.fogExploredTexture || !this.fogUnexploredTexture || !this.terrainSprite) return;
    if (this.fogTextureTick === this.world.tick) return;

    const exploredCtx = this.fogExploredTexture.context;
    const unexploredCtx = this.fogUnexploredTexture.context;
    exploredCtx.clearRect(0, 0, this.fogExploredTexture.width, this.fogExploredTexture.height);
    unexploredCtx.clearRect(0, 0, this.fogUnexploredTexture.width, this.fogUnexploredTexture.height);
    exploredCtx.fillStyle = '#000';
    unexploredCtx.fillStyle = '#000';

    for (let sum = 0; sum <= MAP.WIDTH + MAP.HEIGHT - 2; sum++) {
      for (let y = 0; y < MAP.HEIGHT; y++) {
        const x = sum - y;
        if (x < 0 || x >= MAP.WIDTH) continue;
        const idx = y * MAP.WIDTH + x;
        if (vis.visible[idx] === 1) continue;
        const explored = vis.explored[idx] === 1;
        this.drawFogTileToCanvas(explored ? exploredCtx : unexploredCtx, x, y);
      }
    }
    this.fogExploredTexture.refresh();
    this.fogUnexploredTexture.refresh();
    this.fogTextureTick = this.world.tick;
  }

  private drawFogTileToCanvas(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number
  ): void {
    if (!this.terrainSprite) return;
    const halfW = ISO.TILE_W / 2 + 1;
    const halfH = ISO.TILE_H / 2 + 1;
    const c = this.tileToScreenElev(x, y);
    const sx = c.x - this.terrainSprite.x;
    const sy = c.y - this.terrainSprite.y;
    const sideH = this.elevationAt(x, y) * ISO.VPER;
    if (sideH > 0) {
      ctx.beginPath();
      ctx.moveTo(sx + halfW, sy);
      ctx.lineTo(sx + halfW, sy + sideH);
      ctx.lineTo(sx, sy + halfH + sideH);
      ctx.lineTo(sx, sy + halfH);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(sx - halfW, sy);
      ctx.lineTo(sx - halfW, sy + sideH);
      ctx.lineTo(sx, sy + halfH + sideH);
      ctx.lineTo(sx, sy + halfH);
      ctx.closePath();
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(sx, sy - halfH);
    ctx.lineTo(sx + halfW, sy);
    ctx.lineTo(sx, sy + halfH);
    ctx.lineTo(sx - halfW, sy);
    ctx.closePath();
    ctx.fill();
  }

  private isEntityVisibleToLocal(eid: number): boolean {
    return isEntityVisibleTo(this.world, this.perspectivePlayerId, eid);
  }

  private isResourceExploredByLocal(eid: number): boolean {
    return isTileExploredBy(
      this.world,
      this.perspectivePlayerId,
      Position.x[eid],
      Position.y[eid]
    );
  }

  private hasSelectedAttackCommandSource(): boolean {
    for (const eid of selectedQuery(this.world.ecs)) {
      if (Owner.player[eid] !== this.perspectivePlayerId) continue;
      if (this.canEntityAttack(eid)) return true;
    }
    return false;
  }

  private canEntityAttack(eid: number): boolean {
    return hasComponent(this.world.ecs, Combat, eid) &&
      hasComponent(this.world.ecs, AttackTarget, eid) &&
      hasComponent(this.world.ecs, Health, eid) &&
      Health.hp[eid] > 0 &&
      Combat.atk[eid] > 0;
  }

  private isAttackableEnemy(eid: number): boolean {
    return isEnemyOf(this.world, eid, this.perspectivePlayerId) &&
      this.isEntityVisibleToLocal(eid) &&
      hasComponent(this.world.ecs, Health, eid) &&
      Health.hp[eid] > 0 &&
      (
        hasComponent(this.world.ecs, UnitKind, eid) ||
        hasComponent(this.world.ecs, Building, eid)
      );
  }

  private drawGhost(): void {
    this.ghostGfx.clear();
    const rally = this.world.armyRallyPoints[this.perspectivePlayerId];
    if (rally) {
      this.drawRallyMarker(rally, 0x4ecdc4, 0.9);
    }
    if (this.armyRallyMode) {
      const pointer = this.input.activePointer;
      const { tx, ty } = this.pointerToTile(pointer);
      if (tx >= 0 && ty >= 0 && tx < MAP.WIDTH && ty < MAP.HEIGHT) {
        const valid = this.world.map.walkability[ty][tx] === 0;
        this.drawRallyMarker({ x: tx, y: ty }, valid ? 0xfbc36b : 0xff4757, 0.95);
      }
      return;
    }
    if (this.buildMode === 'none') return;
    const pointer = this.input.activePointer;
    const { tx, ty } = this.pointerToTile(pointer);
    if (tx < 0 || ty < 0 || tx >= MAP.WIDTH || ty >= MAP.HEIGHT) return;

    const defId = BUILD_MODE_TO_DEF[this.buildMode];
    const def = BUILDING_TABLE[defId];
    if (!def) return;
    const anchor = this.buildingAnchorTileForDef(def, tx, ty);
    const c = this.tileToScreenElev(anchor.x, anchor.y);
    const halfW = ISO.TILE_W / 2;
    const halfH = ISO.TILE_H / 2;
    const w = halfW * def.footprint.w;
    const h = halfH * def.footprint.h;

    // Validity: tile must be free and player must be able to afford.
    const tileBlocked = this.isBuildFootprintBlocked(def, tx, ty);
    const hasNearbyResource =
      def.harvestKind === undefined ||
      def.requiresNearbyResource === false ||
      this.hasNearbyResource(tx, ty, def.harvestKind, def.harvestRadius ?? 6);
    const bank = this.world.resources[this.perspectivePlayerId];
    const canAffordBuild =
      bank[0] >= def.cost.food &&
      bank[1] >= def.cost.wood &&
      bank[2] >= def.cost.gold &&
      bank[3] >= def.cost.stone;
    const unlocked = isBuildingUnlocked(this.world, this.perspectivePlayerId, defId);
    const valid = unlocked && !tileBlocked && canAffordBuild && hasNearbyResource;

    const ghostColor = valid ? def.color : 0xff4757;
    this.ghostGfx.fillStyle(ghostColor, 0.4);
    this.ghostGfx.beginPath();
    this.ghostGfx.moveTo(c.x, c.y - h);
    this.ghostGfx.lineTo(c.x + w, c.y);
    this.ghostGfx.lineTo(c.x, c.y + h);
    this.ghostGfx.lineTo(c.x - w, c.y);
    this.ghostGfx.closePath();
    this.ghostGfx.fillPath();
    this.ghostGfx.lineStyle(2, valid ? 0xfeca57 : 0xff4757, 0.9);
    this.ghostGfx.strokePath();
  }

  private drawRallyMarker(point: { x: number; y: number }, color: number, alpha: number): void {
    const c = this.tileToScreenElev(point.x, point.y);
    this.ghostGfx.lineStyle(2, color, alpha);
    this.ghostGfx.strokeEllipse(c.x, c.y + 3, 30, 12);
    this.ghostGfx.fillStyle(color, alpha * 0.22);
    this.ghostGfx.fillEllipse(c.x, c.y + 3, 30, 12);
    this.ghostGfx.lineStyle(2, color, alpha);
    this.ghostGfx.lineBetween(c.x, c.y + 3, c.x, c.y - 24);
    this.ghostGfx.fillStyle(color, alpha);
    this.ghostGfx.fillTriangle(c.x + 1, c.y - 24, c.x + 17, c.y - 19, c.x + 1, c.y - 14);
  }

  private isSelected(eid: number): boolean {
    const sel = selectedQuery(this.world.ecs);
    for (const e of sel) if (e === eid) return true;
    return false;
  }


  // ──────────────────────────────────────────────────────────────────────────
  // Input
  // ──────────────────────────────────────────────────────────────────────────

  /** Selected entities this client may command — owned by the perspective
   *  player, excluding worksite workers. Mirror of the sim's commandableSelection
   *  but resolved against the perspective player (host=1, guest=2). */
  private selectedCommandableEids(): number[] {
    const out: number[] = [];
    for (const eid of selectedQuery(this.world.ecs)) {
      if (hasComponent(this.world.ecs, WorksiteWorker, eid)) continue;
      if (Owner.player[eid] === this.perspectivePlayerId) out.push(eid);
    }
    return out;
  }

  /**
   * Route a command. In single-player it goes straight into the sim input queue.
   * In a live multiplayer match it is translated into a self-describing,
   * network-safe form (selection-relative → cmd* carrying playerId + eids) and
   * handed to the lockstep session, which schedules it for a common future tick
   * on every client. Already self-describing commands pass through unchanged.
   */
  private dispatch(input: SimInput): void {
    const mp = this.multiplayer;
    if (mp && mp.state === 'playing') {
      const pid = this.perspectivePlayerId;
      const eids = this.selectedCommandableEids();
      let net: SimInput;
      switch (input.type) {
        case 'moveSelected':
          net = { type: 'cmdMove', playerId: pid, eids, to: input.to };
          break;
        case 'attackSelected':
          net = { type: 'cmdAttack', playerId: pid, eids, targetEid: input.targetEid };
          break;
        case 'gatherSelected':
          net = { type: 'cmdGather', playerId: pid, eids, targetEid: input.targetEid };
          break;
        case 'stopSelected':
          net = { type: 'cmdStop', playerId: pid, eids };
          break;
        case 'attackMoveSelected':
          net = { type: 'cmdAttackMove', playerId: pid, eids, to: input.to };
          break;
        case 'toggleSelectedUnitStance':
          net = { type: 'cmdToggleStance', playerId: pid, eids };
          break;
        case 'setSelectedUnitStance':
          net = { type: 'cmdSetStance', playerId: pid, eids, stance: input.stance };
          break;
        case 'setFormationMode':
          net = { type: 'cmdSetFormationMode', playerId: pid, eids, mode: input.mode };
          break;
        case 'adjustFormationMode':
          net = { type: 'cmdAdjustFormationMode', playerId: pid, eids, delta: input.delta };
          break;
        case 'rotateSelectedFormation':
          net = { type: 'cmdRotateFormation', playerId: pid, eids, delta: input.delta };
          break;
        case 'reformSelectedFormation':
          net = { type: 'cmdReformFormation', playerId: pid, eids };
          break;
        default:
          net = input; // placeBuilding/trainUnit/researchTech/etc. already carry playerId
      }
      mp.sendCommand(net);
      return;
    }
    // Single-player (or pre-match): straight into the sim input queue.
    this.world.inputs.push(input);
  }

  private onWindowPointerMove = (ev: PointerEvent): void => {
    if (!this.dragStart) return;
    const point = this.clientPointerToWorld(ev.clientX, ev.clientY);
    if ((ev.buttons & 1) === 0) {
      this.finishDragAt(point);
      return;
    }
    this.updateDragBox(point);
  };

  private onWindowPointerUp = (ev: PointerEvent): void => {
    if (!this.dragStart) return;
    this.finishDragAt(this.clientPointerToWorld(ev.clientX, ev.clientY));
  };

  private onWindowBlur = (): void => {
    this.cancelDragBox();
  };

  private clientPointerToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const canvas = this.scale.canvas;
    const rect = canvas.getBoundingClientRect();
    const canvasX = Phaser.Math.Clamp(
      (clientX - rect.left) * (canvas.width / Math.max(1, rect.width)),
      0,
      canvas.width
    );
    const canvasY = Phaser.Math.Clamp(
      (clientY - rect.top) * (canvas.height / Math.max(1, rect.height)),
      0,
      canvas.height
    );
    const worldPoint = this.cameras.main.getWorldPoint(canvasX, canvasY);
    return { x: worldPoint.x, y: worldPoint.y };
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    const { tx, ty, tileX, tileY } = this.pointerToTile(pointer);
    // Fractional coords for sub-tile picking (e.g. unit selection precision).
    const tile = { x: tileX, y: tileY };

    // Army rally mode: one global rally point for all local army producers.
    if (this.armyRallyMode) {
      if (pointer.rightButtonDown()) {
        this.armyRallyMode = false;
        this.ghostGfx.clear();
        setLastEvent('army rally cancelled');
        return;
      }
      if (pointer.leftButtonDown()) {
        if (tx < 0 || ty < 0 || tx >= MAP.WIDTH || ty >= MAP.HEIGHT) {
          setLastEvent(`rally outside map (${tx},${ty})`);
          return;
        }
        this.dispatch({
          type: 'setArmyRallyPoint',
          playerId: this.perspectivePlayerId,
          x: tx,
          y: ty,
        });
        setLastEvent(`army rally → (${tx},${ty})`);
        this.armyRallyMode = false;
        this.ghostGfx.clear();
        return;
      }
    }

    // Build mode: left-click places (if valid), right-click cancels.
    if (this.buildMode !== 'none') {
      if (pointer.rightButtonDown()) {
        this.buildMode = 'none';
        this.ghostGfx.clear();
        setLastEvent('build mode cancelled');
        return;
      }
      if (pointer.leftButtonDown()) {
        const defId = BUILD_MODE_TO_DEF[this.buildMode];
        if (!isBuildingUnlocked(this.world, this.perspectivePlayerId, defId)) {
          setLastEvent(`${BUILDING_TABLE[defId]?.name ?? this.buildMode} is locked`);
          this.playUi(SFX_ERROR);
          this.buildMode = 'none';
          this.ghostGfx.clear();
          return;
        }
        this.dispatch({
          type: 'placeBuilding',
          defId,
          x: tx,
          y: ty,
          playerId: this.perspectivePlayerId,
        });
        this.playUi(PLACE_BUILDING);
        setLastEvent(`place ${this.buildMode} → (${tx},${ty})`);
        this.buildMode = 'none';
        this.ghostGfx.clear();
        return;
      }
    }

    if (pointer.rightButtonDown()) {
      if (tx < 0 || ty < 0 || tx >= MAP.WIDTH || ty >= MAP.HEIGHT) {
        setLastEvent(`right-click outside map (${tx},${ty})`);
        return;
      }
      // Priority: enemy entity → attack; resource → gather; tile → move.
      const targetEid = findEntityNear(this.world, tile.x, tile.y, 0.7);
      if (
        targetEid !== null &&
        this.isEntityVisibleToLocal(targetEid) &&
        isEnemyOf(this.world, targetEid, this.perspectivePlayerId)
      ) {
        this.dispatch({ type: 'attackSelected', targetEid });
        this.barkAttack();
        setLastEvent(`attack eid=${targetEid}`);
        return;
      }
      const resourceEid = findResourceAt(this.world, tile.x, tile.y, 0.7);
      if (resourceEid !== null && this.isResourceExploredByLocal(resourceEid)) {
        const kind = Resource.kind[resourceEid];
        this.playUi(SFX_ERROR);
        setLastEvent(
          kind === ResourceKindId.FOOD
            ? 'food comes from farms'
            : `${this.resourceKindName(kind)} is harvested by nearby worksite buildings`
        );
      } else {
        this.dispatch({ type: 'moveSelected', to: { x: tx, y: ty } });
        this.barkMove();
        setLastEvent(`move → (${tx},${ty})`);
      }
    } else if (pointer.leftButtonDown()) {
      // Record the drag origin in case the user is starting a box-select. Even
      // if they end up clicking, we still want to do the existing single-pick
      // selection immediately for snappy feedback — the drag logic in
      // onPointerMove/onPointerUp will clear/replace selection if a drag actually
      // happens.
      this.dragStart = { x: pointer.worldX, y: pointer.worldY };
      this.dragCurrent = this.dragStart;
      this.isDragging = false;

      // Attack-move modifier: A held → attackMove the clicked tile.
      const aKey = this.input.keyboard?.addKey('A', false);
      if (aKey?.isDown) {
        this.lastLeftUnitClick = null;
        if (tx < 0 || ty < 0 || tx >= MAP.WIDTH || ty >= MAP.HEIGHT) return;
        this.dispatch({
          type: 'attackMoveSelected',
          to: { x: tx, y: ty },
        });
        this.barkAttack();
        setLastEvent(`attack-move → (${tx},${ty})`);
        return;
      }
      const picked = findEntityNear(this.world, tile.x, tile.y, 0.7);
      const eid = picked !== null && this.isEntityVisibleToLocal(picked) ? picked : null;
      if (eid !== null && this.isOwnedUnit(eid) && this.isDoubleClickOnSameUnit(eid)) {
        const n = selectUnitsOfSameKindInRadius(
          this.world,
          eid,
          GameScene.SAME_TYPE_SELECT_RADIUS_TILES,
          this.perspectivePlayerId
        );
        setLastEvent(
          `double-click: selected ${n} nearby ${this.entityKindName(eid)} unit${n === 1 ? '' : 's'}`
        );
        return;
      }

      if (eid === null || !this.isOwnedUnit(eid)) this.lastLeftUnitClick = null;
      clearSelection(this.world);
      if (eid !== null) {
        setSelected(this.world, eid, true);
        if (this.isOwnedUnit(eid)) this.barkSelect(eid);
        setLastEvent(`selected ${this.entityKindName(eid)} eid=${eid}`);
      } else {
        setLastEvent(`cleared selection`);
      }
    }
  }

  /** Pointer-move: update drag-box rectangle if we're dragging. */
  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.dragStart) return;
    if (!pointer.isDown) {
      this.finishDragAt(this.dragCurrent ?? this.dragStart);
      return;
    }
    this.updateDragBox({ x: pointer.worldX, y: pointer.worldY });
  }

  private updateDragBox(point: { x: number; y: number }): void {
    if (!this.dragStart) return;
    this.dragCurrent = point;
    const dx = point.x - this.dragStart.x;
    const dy = point.y - this.dragStart.y;
    if (!this.isDragging && Math.hypot(dx, dy) > GameScene.DRAG_THRESHOLD_PX) {
      this.isDragging = true;
      this.lastLeftUnitClick = null;
      // We've crossed the drag threshold — the user is box-selecting, so
      // ditch the single-pick selection we did on pointerdown.
      clearSelection(this.world);
    }
    if (!this.isDragging || !this.dragGfx) return;
    const x = Math.min(this.dragStart.x, point.x);
    const y = Math.min(this.dragStart.y, point.y);
    const w = Math.abs(dx);
    const h = Math.abs(dy);
    this.dragGfx.clear();
    this.dragGfx.lineStyle(2, 0xfeca57, 1);
    this.dragGfx.strokeRect(x, y, w, h);
    this.dragGfx.fillStyle(0xfeca57, 0.12);
    this.dragGfx.fillRect(x, y, w, h);
  }

  /** Pointer-up: finalise the drag-box, or clean up the no-op single-click case. */
  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    this.finishDragAt({ x: pointer.worldX, y: pointer.worldY });
  }

  private finishDragAt(point: { x: number; y: number }): void {
    if (!this.dragStart) return;
    this.dragCurrent = point;
    if (this.isDragging) {
      const x0 = Math.min(this.dragStart.x, point.x);
      const y0 = Math.min(this.dragStart.y, point.y);
      const x1 = Math.max(this.dragStart.x, point.x);
      const y1 = Math.max(this.dragStart.y, point.y);
      this.selectUnitsInWorldBox(x0, y0, x1, y1);
    }
    this.cancelDragBox();
  }

  private cancelDragBox(): void {
    this.dragGfx?.clear();
    this.dragStart = null;
    this.dragCurrent = null;
    this.isDragging = false;
  }

  /** Select all of the perspective player's units whose sprite anchor falls inside the
   *  given world-space rectangle. */
  private selectUnitsInWorldBox(
    x0: number,
    y0: number,
    x1: number,
    y1: number
  ): void {
    clearSelection(this.world);
    let n = 0;
    const ents = unitQuery(this.world.ecs);
    for (const eid of ents) {
      if (Owner.player[eid] !== this.perspectivePlayerId) continue;
      const local = this.tileToScreenElev(Position.x[eid], Position.y[eid]);
      // Convert container-local coords to world coords (matches the dragRect
      // coordinate system which uses pointer.worldX/Y).
      const sx = local.x + this.worldContainer.x;
      const sy = local.y + this.worldContainer.y;
      if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) {
        setSelected(this.world, eid, true);
        n++;
      }
    }
    const rep = this.representativeSelectedUnit();
    if (rep !== null) this.barkSelect(rep);
    setLastEvent(`box-selected ${n} unit${n === 1 ? '' : 's'}`);
  }

  private isOwnedUnit(eid: number): boolean {
    return hasComponent(this.world.ecs, UnitKind, eid) && Owner.player[eid] === this.perspectivePlayerId;
  }

  private isDoubleClickOnSameUnit(eid: number): boolean {
    const now = this.time.now;
    const last = this.lastLeftUnitClick;
    this.lastLeftUnitClick = { eid, atMs: now };
    return last !== null &&
      last.eid === eid &&
      now - last.atMs <= GameScene.DOUBLE_CLICK_MS;
  }

  /** Public — used by main.ts overlay pump to show game-over modal. */
  getOutcome(): MatchOutcome {
    return this.world.outcome;
  }

  getCampaignMission(): {
    id: CampaignMissionIdValue;
    name: string;
    description: string;
    briefing: string;
    lockedTechs: TechIdValue[];
    objectives: Array<{ id: string; label: string; optional: boolean; completed: boolean }>;
  } | null {
    const campaign = this.world.campaign;
    if (!campaign) return null;
    return {
      id: campaign.missionId,
      name: campaign.name,
      description: campaign.description,
      briefing: campaign.briefing,
      lockedTechs: campaign.lockedTechs.slice(),
      objectives: campaign.objectives.map((objective) => ({ ...objective })),
    };
  }

  /**
   * Change camera zoom by `delta`, optionally keeping the world point under
   * (anchorWorldX, anchorWorldY) at the same screen position. Clamped.
   */
  applyZoom(delta: number, anchorWorldX?: number, anchorWorldY?: number): void {
    const cam = this.cameras.main;
    const newZoom = Math.max(
      GameScene.ZOOM_MIN,
      Math.min(GameScene.ZOOM_MAX, this.zoom + delta)
    );
    if (newZoom === this.zoom) return;
    if (anchorWorldX !== undefined && anchorWorldY !== undefined) {
      // Compute scroll adjustment so the anchor world point stays under the
      // same screen pixel after the zoom change.
      const oldZoom = this.zoom;
      const sxBefore = (anchorWorldX - cam.scrollX) * oldZoom;
      const syBefore = (anchorWorldY - cam.scrollY) * oldZoom;
      cam.setZoom(newZoom);
      this.zoom = newZoom;
      cam.scrollX = anchorWorldX - sxBefore / newZoom;
      cam.scrollY = anchorWorldY - syBefore / newZoom;
    } else {
      cam.setZoom(newZoom);
      this.zoom = newZoom;
    }
  }

  private selectAllVillagers(): void {
    clearSelection(this.world);
    const ents = unitQuery(this.world.ecs);
    let n = 0;
    for (const eid of ents) {
      if (Owner.player[eid] !== this.perspectivePlayerId) continue;
      if (!hasComponent(this.world.ecs, VillagerTag, eid)) continue;
      setSelected(this.world, eid, true);
      n++;
    }
    setLastEvent(`F1: selected ${n} worker${n === 1 ? '' : 's'}`);
  }

  private selectAllMilitary(): void {
    clearSelection(this.world);
    const ents = unitQuery(this.world.ecs);
    let n = 0;
    for (const eid of ents) {
      if (Owner.player[eid] !== this.perspectivePlayerId) continue;
      if (hasComponent(this.world.ecs, VillagerTag, eid)) continue;
      setSelected(this.world, eid, true);
      n++;
    }
    setLastEvent(`F2: selected ${n} unit${n === 1 ? '' : 's'}`);
  }

  /** Toggle the sim's paused state. Used by the title screen + future pause menu.
   *  No-op during a networked match: pause is not synced across clients, so a
   *  local pause would diverge tick counts and desync the lockstep. */
  setPaused(paused: boolean): void {
    if (this.multiplayer) return;
    this.world.paused = paused;
  }

  isPaused(): boolean {
    return this.world.paused;
  }

  getGameSpeed(): number {
    return this.gameSpeed;
  }

  setGameSpeed(multiplier: number): void {
    const next = multiplier >= 2 ? 2 : 1;
    if (next === this.gameSpeed) return;
    this.gameSpeed = next;
    setLastEvent(`game speed ${this.gameSpeed}x`);
  }

  toggleGameSpeed(): number {
    this.setGameSpeed(this.gameSpeed === 1 ? 2 : 1);
    return this.gameSpeed;
  }

  cheatRevealMap(playerId = 1): void {
    revealMapForPlayer(this.world, playerId);
    this.fogTextureTick = -1;
    setLastEvent('cheat: map revealed');
  }

  cheatAddResources(playerId = 1, amount = 500): void {
    const bank = this.world.resources[playerId];
    if (!bank) return;
    bank[ResourceKindId.FOOD] += amount;
    bank[ResourceKindId.WOOD] += amount;
    bank[ResourceKindId.GOLD] += amount;
    bank[ResourceKindId.STONE] += amount;
    setLastEvent(`cheat: +${amount} resources`);
  }

  cheatSpawnCavalryByTownHall(playerId = 1): number | null {
    let townHall: number | null = null;
    for (const eid of townCenterQuery(this.world.ecs)) {
      if (Owner.player[eid] !== playerId) continue;
      townHall = eid;
      break;
    }
    if (townHall === null) {
      setLastEvent('cheat: no town hall');
      return null;
    }

    const spot = this.findCheatSpawnSpotNear(Position.x[townHall], Position.y[townHall]);
    if (!spot) {
      setLastEvent('cheat: no cavalry spawn tile');
      return null;
    }
    const eid = spawnScoutCavalry(this.world, spot.x, spot.y, playerId);
    clearSelection(this.world);
    setSelected(this.world, eid, true);
    setLastEvent(`cheat: cavalry spawned (${spot.x},${spot.y})`);
    return eid;
  }

  cheatSpawnMachineGunByTownHall(playerId = 1): number | null {
    let townHall: number | null = null;
    for (const eid of townCenterQuery(this.world.ecs)) {
      if (Owner.player[eid] !== playerId) continue;
      townHall = eid;
      break;
    }
    if (townHall === null) {
      setLastEvent('cheat: no town hall');
      return null;
    }

    const spot = this.findCheatSpawnSpotNear(Position.x[townHall], Position.y[townHall]);
    if (!spot) {
      setLastEvent('cheat: no machine gun spawn tile');
      return null;
    }
    const eid = spawnMachineGun(this.world, spot.x, spot.y, playerId);
    clearSelection(this.world);
    setSelected(this.world, eid, true);
    setLastEvent(`cheat: machine gun spawned (${spot.x},${spot.y})`);
    return eid;
  }

  cheatSpawnMortarByTownHall(playerId = 1): number | null {
    let townHall: number | null = null;
    for (const eid of townCenterQuery(this.world.ecs)) {
      if (Owner.player[eid] !== playerId) continue;
      townHall = eid;
      break;
    }
    if (townHall === null) {
      setLastEvent('cheat: no town hall');
      return null;
    }

    const spot = this.findCheatSpawnSpotNear(Position.x[townHall], Position.y[townHall]);
    if (!spot) {
      setLastEvent('cheat: no mortar spawn tile');
      return null;
    }
    const eid = spawnMortar(this.world, spot.x, spot.y, playerId);
    clearSelection(this.world);
    setSelected(this.world, eid, true);
    setLastEvent(`cheat: mortar spawned (${spot.x},${spot.y})`);
    return eid;
  }

  private findCheatSpawnSpotNear(
    cx: number,
    cy: number
  ): { x: number; y: number } | null {
    const baseX = Math.round(cx);
    const baseY = Math.round(cy);
    for (let r = 2; r <= 8; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = baseX + dx;
          const y = baseY + dy;
          if (x < 0 || y < 0 || x >= MAP.WIDTH || y >= MAP.HEIGHT) continue;
          if (this.world.map.walkability[y][x] !== 0) continue;
          if (findResourceAt(this.world, x, y, 0.7) !== null) continue;
          return { x, y };
        }
      }
    }
    return this.world.pathfinder.nearestWalkable(baseX, baseY, 10);
  }

  private startBuildMode(mode: Exclude<BuildMode, 'none'>, message: string): void {
    const defId = BUILD_MODE_TO_DEF[mode];
    const def = BUILDING_TABLE[defId];
    this.awaitingBuildKind = false;
    this.armyRallyMode = false;
    if (!isBuildingUnlocked(this.world, this.perspectivePlayerId, defId)) {
      this.buildMode = 'none';
      setLastEvent(`${def?.name ?? mode} is locked`);
      return;
    }
    this.buildMode = mode;
    setLastEvent(message);
  }

  private startArmyRallyMode(): void {
    if (this.countOwnedArmyProducers(this.perspectivePlayerId) === 0) {
      setLastEvent('army rally needs an army building');
      return;
    }
    this.buildMode = 'none';
    this.awaitingBuildKind = false;
    this.armyRallyMode = true;
    setLastEvent('army rally — click map');
  }

  private canAffordCost(
    playerId: number,
    cost: { food: number; wood: number; gold: number; stone: number }
  ): boolean {
    const bank = this.world.resources[playerId];
    return Boolean(
      bank &&
      bank[ResourceKindId.FOOD] >= cost.food &&
      bank[ResourceKindId.WOOD] >= cost.wood &&
      bank[ResourceKindId.GOLD] >= cost.gold &&
      bank[ResourceKindId.STONE] >= cost.stone
    );
  }

  private affordableCountForCost(playerId: number, cost: CostTuple, requestedCount: number): number {
    const bank = this.world.resources[playerId];
    if (!bank) return 0;
    let count = Math.max(0, Math.trunc(requestedCount));
    if (cost.food > 0) count = Math.min(count, Math.floor(bank[ResourceKindId.FOOD] / cost.food));
    if (cost.wood > 0) count = Math.min(count, Math.floor(bank[ResourceKindId.WOOD] / cost.wood));
    if (cost.gold > 0) count = Math.min(count, Math.floor(bank[ResourceKindId.GOLD] / cost.gold));
    if (cost.stone > 0) count = Math.min(count, Math.floor(bank[ResourceKindId.STONE] / cost.stone));
    return count;
  }

  private formatCost(cost: { food: number; wood: number; gold: number; stone: number }): string {
    const parts: string[] = [];
    if (cost.food) parts.push(`${cost.food} food`);
    if (cost.wood) parts.push(`${cost.wood} wood`);
    if (cost.gold) parts.push(`${cost.gold} gold`);
    if (cost.stone) parts.push(`${cost.stone} stone`);
    return parts.join(' ');
  }

  private formatTrainTime(ticks: number): string {
    return `${Math.ceil(ticks / SIM.TICK_HZ)}s`;
  }

  private countQueuedPopCost(playerId: number): number {
    let total = 0;
    for (const [producerEid, queue] of this.world.productionQueues) {
      if (!hasComponent(this.world.ecs, Owner, producerEid)) continue;
      if (Owner.player[producerEid] !== playerId) continue;
      for (const defId of queue) {
        if (
          defId === UnitDefId.VILLAGER &&
          hasComponent(this.world.ecs, ResourceWorksite, producerEid)
        ) {
          continue;
        }
        total += getUnitDef(defId)?.popCost ?? 0;
      }
    }
    return total;
  }

  private hasPopulationRoomForUnit(playerId: number, unitDefId: number): boolean {
    const unit = UNIT_TABLE[unitDefId];
    const pop = this.world.population[playerId];
    if (!unit || !pop) return false;
    return pop.current + this.countQueuedPopCost(playerId) + unit.popCost <= pop.cap;
  }

  private populationRoomForUnitCount(playerId: number, unitDefId: number, requestedCount: number): number {
    const unit = UNIT_TABLE[unitDefId];
    const pop = this.world.population[playerId];
    if (!unit || !pop) return 0;
    if (unit.popCost <= 0) return Math.max(0, Math.trunc(requestedCount));
    const room = pop.cap - pop.current - this.countQueuedPopCost(playerId);
    return Math.max(0, Math.min(Math.trunc(requestedCount), Math.floor(room / unit.popCost)));
  }

  private countOwnedArmyProducers(playerId: number): number {
    let count = 0;
    for (const eid of buildingQuery(this.world.ecs)) {
      if (Owner.player[eid] !== playerId) continue;
      if (this.isArmyProducerDefId(Building.defId[eid])) count++;
    }
    return count;
  }

  private isArmyProducerDefId(defId: number): boolean {
    return defId === BuildingDefId.BARRACKS ||
      defId === BuildingDefId.STABLE ||
      defId === BuildingDefId.FOUNDRY;
  }

  private onAdvanceAgeHotkey(): void {
    const techId = this.nextAgeTechId(this.perspectivePlayerId);
    if (!techId) {
      setLastEvent('maximum age reached');
      return;
    }
    this.researchTech(techId, this.perspectivePlayerId);
  }

  private nextAgeTechId(playerId: number): TechIdValue | null {
    const current = this.world.ages[playerId]?.current ?? AgeId.DARK;
    if (current === AgeId.DARK) return TechId.CASTLE_AGE;
    if (current === AgeId.CASTLE) return TechId.GUNPOWDER_AGE;
    return null;
  }

  private onTrainHotkey(slot = 0, quiet = false): boolean {
    const sel = selectedQuery(this.world.ecs);
    for (const eid of sel) {
      if (!hasComponent(this.world.ecs, Producer, eid)) continue;
      if (Owner.player[eid] !== this.perspectivePlayerId) continue;
      // Pick the first trainable unit listed on this building's def.
      const buildingDefId = Building.defId[eid];
      const buildingDef = BUILDING_TABLE[buildingDefId];
      if (hasComponent(this.world.ecs, ResourceWorksite, eid)) {
        if (slot === 0) {
          this.trainUnitAtSelectedProducer(UnitDefId.VILLAGER);
          return true;
        }
        if (!quiet) setLastEvent(`no unit in slot ${slot + 1}`);
        return false;
      }
      const trainIds = buildingDef?.trains ?? [];
      if (trainIds.length === 0) {
        if (!quiet) setLastEvent(`Q: ${buildingDef?.name ?? 'building'} trains nothing`);
        return false;
      }
      // Map the string id (e.g. "SPEARMAN") to the numeric UnitDefId index.
      const idStr = trainIds[slot];
      if (!idStr) {
        if (!quiet) setLastEvent(`no unit in slot ${slot + 1}`);
        return false;
      }
      const unitDefId = UNIT_TABLE.findIndex((u) => u.id === idStr);
      if (unitDefId < 0) {
        if (!quiet) setLastEvent(`Q: unknown unit ${idStr}`);
        return false;
      }
      const unitDef = UNIT_TABLE[unitDefId];
      if (!unitDef) return false;
      if (!isUnitUnlocked(this.world, this.perspectivePlayerId, unitDefId)) {
        if (!quiet) setLastEvent(`${unitDef.name} is locked`);
        return false;
      }
      this.trainUnitAtSelectedProducer(unitDefId);
      return true;
    }
    if (!quiet) setLastEvent('Q: no producer selected');
    return false;
  }

  private onSecondaryActionHotkey(): void {
    if (this.onTrainHotkey(1, true)) return;
    this.onAdvanceAgeHotkey();
  }

  private selectedPlayerStanceUnits(): number[] {
    return selectedQuery(this.world.ecs).filter((eid) =>
      hasComponent(this.world.ecs, UnitStance, eid) &&
      Owner.player[eid] === this.perspectivePlayerId
    );
  }

  private setSelectedUnitStance(stance: UnitStanceValue): void {
    const military = this.selectedPlayerStanceUnits();
    if (military.length === 0) return;
    this.dispatch({ type: 'setSelectedUnitStance', stance });
    setLastEvent(
      stance === UnitStanceId.HOLD_POSITION
        ? 'units holding position'
        : 'units set to auto-defend'
    );
  }

  private setFormationMode(mode: number): void {
    const military = this.selectedPlayerStanceUnits();
    if (military.length <= 1) return;
    const nextMode = this.clampFormationMode(mode);
    this.dispatch({ type: 'setFormationMode', mode: nextMode });
    setLastEvent(`formation: ${this.formationModeLabel(nextMode)}`);
  }

  private rotateFormation(delta: number): void {
    const military = this.selectedPlayerStanceUnits();
    if (military.length <= 1) return;
    if (this.clampFormationMode(this.perspectiveFormationMode()) === 0) return;
    const nextFacing = this.normalizeFormationFacing(this.perspectiveFormationFacing() + delta);
    this.dispatch({ type: 'rotateSelectedFormation', delta });
    setLastEvent(`formation facing: ${this.formationFacingLabel(nextFacing)}`);
  }

  /** This client's own formation shape (host=1, guest=2 perspective). */
  private perspectiveFormationMode(): number {
    return this.world.formationModes[this.perspectivePlayerId] ?? 0;
  }

  /** This client's own formation facing. */
  private perspectiveFormationFacing(): number {
    return this.world.formationFacings[this.perspectivePlayerId] ?? 0;
  }

  private clampFormationMode(mode: number): number {
    if (!Number.isFinite(mode)) return 0;
    return Math.max(0, Math.min(2, Math.trunc(mode)));
  }

  private normalizeFormationFacing(facing: number): number {
    return ((Math.trunc(facing) % 8) + 8) % 8;
  }

  private formationModeLabel(mode = this.perspectiveFormationMode()): string {
    switch (this.clampFormationMode(mode)) {
      case 1: return 'line';
      case 2: return 'compact';
      default: return 'free';
    }
  }

  private formationFacingLabel(facing = this.perspectiveFormationFacing()): string {
    const labels = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE'];
    return labels[this.normalizeFormationFacing(facing)];
  }

  private removeSelectedBuildings(): void {
    const selectedBuildings = selectedQuery(this.world.ecs).filter((eid) =>
      hasComponent(this.world.ecs, Building, eid) &&
      Owner.player[eid] === this.perspectivePlayerId &&
      Building.defId[eid] !== BuildingDefId.TOWN_CENTER
    );
    if (selectedBuildings.length === 0) {
      setLastEvent('no removable building selected');
      return;
    }
    this.dispatch({
      type: 'cmdRemoveBuildings',
      playerId: this.perspectivePlayerId,
      eids: selectedBuildings,
    });
    setLastEvent(
      selectedBuildings.length === 1
        ? 'removing selected building'
        : `removing ${selectedBuildings.length} selected buildings`
    );
  }

  private trainUnitAtSelectedProducer(unitDefId: number, requestedCount = 1): void {
    const unitDef = UNIT_TABLE[unitDefId];
    if (!unitDef) return;
    const numericCount = Number.isFinite(requestedCount) ? requestedCount : 1;
    const targetCount = Math.max(
      1,
      Math.min(GameScene.TRAIN_BATCH_COUNT, Math.trunc(numericCount))
    );
    const sel = selectedQuery(this.world.ecs);
    for (const eid of sel) {
      if (!hasComponent(this.world.ecs, Producer, eid)) continue;
      if (!hasComponent(this.world.ecs, Building, eid)) continue;
      if (Owner.player[eid] !== this.perspectivePlayerId) continue;
      const playerId = Owner.player[eid];
      const buildingDef = BUILDING_TABLE[Building.defId[eid]];
      if (
        unitDefId === UnitDefId.VILLAGER &&
        hasComponent(this.world.ecs, ResourceWorksite, eid)
      ) {
        const queue = this.world.productionQueues.get(eid) ?? [];
        const queuedWorkers = queue.filter((defId) => defId === UnitDefId.VILLAGER).length;
        const slots = getWorksiteWorkerSlots(this.world, eid);
        const slotRoom = slots - ResourceWorksite.assignedWorkers[eid] - queuedWorkers;
        if (slotRoom <= 0) {
          setLastEvent(`workers full (${slots}/${slots})`);
          return;
        }
        const queueRoom = Math.max(0, 2 - queue.length);
        if (queueRoom <= 0) {
          setLastEvent('worker queue full');
          return;
        }
        const affordable = this.affordableCountForCost(playerId, unitDef.cost, targetCount);
        if (affordable <= 0) {
          this.playUi(SFX_ERROR);
          setLastEvent(`${unitDef.name} needs ${this.formatCost(unitDef.cost)}`);
          return;
        }
        const trainCount = Math.min(targetCount, slotRoom, queueRoom, affordable);
        this.dispatch({
          type: 'trainUnit',
          atEid: eid,
          defId: unitDefId,
          count: trainCount,
          playerId: this.perspectivePlayerId,
        });
        setLastEvent(
          trainCount === 1
            ? `queued worker at eid=${eid}`
            : `queued ${trainCount}x worker at eid=${eid}`
        );
        return;
      }
      if (!buildingDef?.trains.includes(unitDef.id)) continue;
      if (!isUnitUnlocked(this.world, playerId, unitDefId)) {
        this.playUi(SFX_ERROR);
        setLastEvent(`${unitDef.name} is locked`);
        return;
      }
      const affordable = this.affordableCountForCost(playerId, unitDef.cost, targetCount);
      if (affordable <= 0) {
        this.playUi(SFX_ERROR);
        setLastEvent(`${unitDef.name} needs ${this.formatCost(unitDef.cost)}`);
        return;
      }
      const popRoom = this.populationRoomForUnitCount(playerId, unitDefId, targetCount);
      if (popRoom <= 0) {
        this.playUi(SFX_ERROR);
        const pop = this.world.population[playerId];
        setLastEvent(`${unitDef.name} needs pop space (${pop?.current ?? 0}/${pop?.cap ?? 0})`);
        return;
      }
      const trainCount = Math.min(targetCount, affordable, popRoom);
      this.dispatch({
        type: 'trainUnit',
        atEid: eid,
        defId: unitDefId,
        count: trainCount,
        playerId: this.perspectivePlayerId,
      });
      setLastEvent(
        trainCount === 1
          ? `queued ${unitDef.name} at eid=${eid}`
          : `queued ${trainCount}x ${unitDef.name} at eid=${eid}`
      );
      return;
    }
    setLastEvent(`${unitDef.name}: no ${unitDef.trainAt.toLowerCase().replace('_', ' ')} selected`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Public introspection
  // ──────────────────────────────────────────────────────────────────────────

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

  getResources(playerId: number): {
    food: number;
    wood: number;
    gold: number;
    stone: number;
  } {
    const r = this.world.resources[playerId];
    if (!r) return { food: 0, wood: 0, gold: 0, stone: 0 };
    return {
      food: r[ResourceKindId.FOOD],
      wood: r[ResourceKindId.WOOD],
      gold: r[ResourceKindId.GOLD],
      stone: r[ResourceKindId.STONE],
    };
  }

  getPop(playerId: number): { current: number; cap: number } {
    const p = this.world.population[playerId];
    return p ? { current: p.current, cap: p.cap } : { current: 0, cap: 0 };
  }

  getAge(playerId: number): {
    name: string;
    current: number;
    progressFrac: number;
    nextName: string | null;
    advancing: boolean;
  } {
    const age = this.world.ages[playerId];
    if (!age) {
      return { name: 'Dark Age', current: 0, progressFrac: 0, nextName: null, advancing: false };
    }
    const def = getAgeDef(age.current);
    const nextDef = getAgeDef(age.current + 1);
    const advancing = age.progress >= 0;
    return {
      name: def?.name ?? 'Dark Age',
      current: age.current,
      progressFrac: advancing && age.totalTicks > 0 ? age.progress / age.totalTicks : 0,
      nextName: nextDef?.name ?? null,
      advancing,
    };
  }

  getTechTree(playerId = this.perspectivePlayerId): Array<{
    id: TechIdValue;
    name: string;
    description: string;
    icon: string;
    path: string;
    x: number;
    y: number;
    cost: string;
    unlocks: string[];
    requires: TechIdValue[];
    requiresAny: TechIdValue[][];
    status: string;
    affordable: boolean;
    progressFrac: number;
  }> {
    const age = this.world.ages[playerId];
    return TECH_TREE.filter((tech) => tech.path !== 'start').map((tech) => ({
      id: tech.id,
      name: tech.name,
      description: tech.description,
      icon: tech.icon,
      path: tech.path,
      x: tech.x,
      y: tech.y,
      cost: this.formatCost(tech.cost),
      unlocks: tech.unlocks,
      requires: tech.requires ?? [],
      requiresAny: tech.requiresAny ?? [],
      status: techStatus(this.world, playerId, tech.id),
      affordable: this.canAffordCost(playerId, tech.cost),
      progressFrac:
        tech.id === this.nextAgeTechId(playerId) &&
        age &&
        age.progress >= 0 &&
        age.totalTicks > 0
          ? age.progress / age.totalTicks
          : 0,
    }));
  }

  researchTech(techId: TechIdValue, playerId = this.perspectivePlayerId): void {
    const tech = techDef(techId);
    if (!tech) return;
    const status = techStatus(this.world, playerId, techId);
    if (status === 'researched') {
      setLastEvent(`${tech.name} already researched`);
      return;
    }
    if (status === 'researching') {
      setLastEvent(`${tech.name} already in progress`);
      return;
    }
    if (status === 'locked') {
      if (this.world.campaign?.lockedTechs.includes(techId)) {
        setLastEvent(`${tech.name} is locked for this mission`);
        return;
      }
      setLastEvent(`${tech.name} prerequisites missing`);
      return;
    }
    if (!this.canAffordCost(playerId, tech.cost)) {
      setLastEvent(`${tech.name} needs ${this.formatCost(tech.cost) || 'no resources'}`);
      return;
    }
    this.dispatch({ type: 'researchTech', playerId, techId });
    setLastEvent(`research ${tech.name}`);
  }

  /** Combined status line: gather + build state for the first selected unit. */
  getStatusLine(): string {
    return this.getStatusInfo().text;
  }

  getStatusInfo(): { text: string; progressFrac: number | null } {
    const sel = selectedQuery(this.world.ecs);
    for (const eid of sel) {
      if (hasComponent(this.world.ecs, Gatherer, eid)) {
        const st = Gatherer.state[eid];
        const carry = hasComponent(this.world.ecs, ResourceCarry, eid)
          ? ResourceCarry.amount[eid]
          : 0;
        const stateName = [
          'idle',
          'walking→',
          'gathering',
          'returning',
          'depositing',
          'walking-to-build',
          'building',
        ][st] ?? '?';
        if (st === GathererStateId.IDLE && carry === 0) return { text: 'idle', progressFrac: null };
        return { text: `${stateName}${carry > 0 ? ` (${carry}/10)` : ''}`, progressFrac: null };
      }
      if (hasComponent(this.world.ecs, Producer, eid)) {
        const q = this.world.productionQueues.get(eid);
        if (!q || q.length === 0) return { text: 'producer idle', progressFrac: null };
        const trainDef = getUnitDef(q[0]);
        if (!trainDef) return { text: 'producer', progressFrac: null };
        const frac = Producer.currentProgress[eid] / trainDef.trainTimeTicks;
        return {
          text: q.length > 1 ? `training ${trainDef.name} (${q.length})` : `training ${trainDef.name}`,
          progressFrac: Math.max(0, Math.min(1, frac)),
        };
      }
    }
    return { text: '', progressFrac: null };
  }

  getBuildMode(): string {
    if (this.awaitingBuildKind) return 'waiting…';
    if (this.armyRallyMode) return 'army rally';
    return this.buildMode === 'none' ? '-' : this.buildMode.toLowerCase();
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
    this.world = createSimWorld(Date.now() & 0xffff, { startingAge, mapId, aiDifficulty });
    this.afterWorldLoaded(`started in ${age?.name ?? 'Dark Age'} - ${aiDifficulty} AI`);
  }

  startCampaignMission(missionId: CampaignMissionIdValue = CampaignMissionId.SIEGE_OF_BRNO): void {
    this.world = createSimWorld(Date.now() & 0xffff, { campaignMissionId: missionId });
    this.afterWorldLoaded(this.world.campaign?.name ?? 'campaign started');
  }

  /** The player id this client controls (host=1, guest=2 in multiplayer). */
  getPerspectivePlayerId(): number {
    return this.perspectivePlayerId;
  }

  /** True while a networked match is live (used by the HUD pump). */
  isMultiplayer(): boolean {
    return this.multiplayer !== null;
  }

  /**
   * Enter a lockstep multiplayer match. The session has already built the
   * deterministic world (identical on every client) and tells us which player
   * we control. From here the session — not the local accumulator — drives the
   * sim, and local commands are routed through {@link dispatch} as network
   * frames.
   */
  beginMultiplayerMatch(
    session: MultiplayerSession,
    world: SimWorld,
    localPlayerId: number
  ): void {
    if (!this.created) {
      // Scene still baking — defer until create() finishes.
      this.pendingMpMatch = { session, world, localPlayerId };
      return;
    }
    this.multiplayer = session;
    this.world = world;
    this.perspectivePlayerId = localPlayerId;
    this.afterWorldLoaded(`Multiplayer match — you are Player ${localPlayerId}`);
  }

  /** Hand music off from the menu to the in-game director on match start. Also
   *  resets every adaptive-audio timer so a new/loaded match never inherits stale
   *  combat/alert/village state from the previous one. */
  private enterMatchMusic(): void {
    this.inMatch = true;
    this.villageEnteredTick = -1;
    this.lastHomeTick = -1;
    this.lastLocalCombatTick = -1;
    this.lastAlertTick = -1;
    this.musicContext = 'playlist';
    this.contextSinceTick = -1;
    this.battleTrack = null;
    this.audio.playGamePlaylist();
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

  private afterWorldLoaded(message: string): void {
    this.world.paused = false;
    this.accumulatorMs = 0;
    this.buildMode = 'none';
    this.armyRallyMode = false;
    this.awaitingBuildKind = false;
    this.activeProjectiles = [];
    this.projectilesGfx.clear();
    this.selectionGfx.clear();
    this.ghostGfx.clear();
    this.clearEntitySprites();
    this.refreshTerrainBake();
    this.installDebugWindowApi();
    this.panToLocalTownCenter();
    this.enterMatchMusic();
    setLastEvent(message);
  }

  private clearEntitySprites(): void {
    for (const sprite of this.buildingSprites.values()) sprite.destroy();
    for (const sprite of this.lastSeenBuildingSprites.values()) sprite.destroy();
    for (const sprite of this.unitSprites.values()) sprite.destroy();
    for (const sprite of this.resourceSprites.values()) sprite.destroy();
    for (const sprite of this.mapFeatureSprites.values()) sprite.destroy();
    this.buildingSprites.clear();
    this.lastSeenBuildingSprites.clear();
    this.unitSprites.clear();
    this.resourceSprites.clear();
    this.mapFeatureSprites.clear();
    this.scoutFacing.clear();
    this.archerFacing.clear();
    this.spearmanFacing.clear();
    this.gunmanFacing.clear();
    this.cannonFacing.clear();
    this.machineGunFacing.clear();
    this.mortarFacing.clear();
    this.villagerFacing.clear();
    this.unitAttackUntilTick.clear();
    this.fogGfx.clear();
    this.fogTextureTick = -1;
  }

  private refreshTerrainBake(): void {
    this.terrainSprite?.destroy();
    this.terrainSprite = bakeTerrain(this, this.worldContainer, this.world.map);
    this.worldContainer.sendToBack(this.terrainSprite);
    this.createFogTextures();
  }

  private createFogTextures(): void {
    if (!this.terrainSprite) return;
    this.destroyFogTextures();
    const width = Math.ceil(this.terrainSprite.width);
    const height = Math.ceil(this.terrainSprite.height);
    this.fogExploredTexture = this.textures.createCanvas(
      GameScene.FOG_EXPLORED_KEY,
      width,
      height
    ) ?? undefined;
    this.fogUnexploredTexture = this.textures.createCanvas(
      GameScene.FOG_UNEXPLORED_KEY,
      width,
      height
    ) ?? undefined;
    if (!this.fogExploredTexture || !this.fogUnexploredTexture) return;

    this.fogExploredTexture.context.imageSmoothingEnabled = false;
    this.fogUnexploredTexture.context.imageSmoothingEnabled = false;
    this.fogExploredSprite = this.add
      .sprite(this.terrainSprite.x, this.terrainSprite.y, GameScene.FOG_EXPLORED_KEY)
      .setOrigin(0, 0)
      .setAlpha(0.48)
      .setDepth(90000);
    this.fogUnexploredSprite = this.add
      .sprite(this.terrainSprite.x, this.terrainSprite.y, GameScene.FOG_UNEXPLORED_KEY)
      .setOrigin(0, 0)
      .setAlpha(1)
      .setDepth(90001);
    this.worldContainer.add([this.fogExploredSprite, this.fogUnexploredSprite]);
    this.fogTextureTick = -1;
  }

  private destroyFogTextures(): void {
    this.fogExploredSprite?.destroy();
    this.fogUnexploredSprite?.destroy();
    this.fogExploredSprite = undefined;
    this.fogUnexploredSprite = undefined;
    this.fogExploredTexture = undefined;
    this.fogUnexploredTexture = undefined;
    if (this.textures.exists(GameScene.FOG_EXPLORED_KEY)) {
      this.textures.remove(GameScene.FOG_EXPLORED_KEY);
    }
    if (this.textures.exists(GameScene.FOG_UNEXPLORED_KEY)) {
      this.textures.remove(GameScene.FOG_UNEXPLORED_KEY);
    }
    this.fogTextureTick = -1;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // HUD support
  // ──────────────────────────────────────────────────────────────────────────

  /** Elevation at integer tile (tx, ty); 3 (default ground) if out of bounds. */
  private elevationAt(tx: number, ty: number): number {
    if (tx < 0 || ty < 0 || tx >= MAP.WIDTH || ty >= MAP.HEIGHT) return 3;
    return this.world.map.elevation[ty * MAP.WIDTH + tx];
  }

  /**
   * Tile (tx, ty) → screen coords WITH terrain elevation applied. Entities,
   * the build ghost, and any other on-tile rendering must use this rather
   * than raw `tileToScreen` so they line up with the visible terrain tile.
   * Fractional tile coords are OK — elevation is sampled from the rounded tile.
   */
  private tileToScreenElev(tileX: number, tileY: number): { x: number; y: number } {
    const c = tileToScreen(tileX, tileY);
    const e = this.elevationAt(Math.round(tileX), Math.round(tileY));
    return { x: c.x, y: c.y - e * ISO.VPER };
  }

  private buildingAnchorTile(eid: number): { x: number; y: number } {
    const def = BUILDING_TABLE[Building.defId[eid]];
    if (!def) return { x: Position.x[eid], y: Position.y[eid] };
    return this.buildingAnchorTileForDef(def, Position.x[eid], Position.y[eid]);
  }

  private buildingAnchorTileForDef(
    def: BuildingDef,
    x: number,
    y: number
  ): { x: number; y: number } {
    return {
      x: x - (def.footprint.w % 2 === 0 ? 0.5 : 0),
      y: y - (def.footprint.h % 2 === 0 ? 0.5 : 0),
    };
  }

  private buildingScreenPosition(eid: number): { x: number; y: number } {
    const anchor = this.buildingAnchorTile(eid);
    return this.tileToScreenElev(anchor.x, anchor.y);
  }

  private buildingSelectionEllipse(defId: number): {
    yOffset: number;
    width: number;
    height: number;
  } {
    const def = BUILDING_TABLE[defId];
    if (!def) return { yOffset: 6, width: 60, height: 16 };
    return {
      yOffset: 6,
      width: Math.max(54, def.footprint.w * ISO.TILE_W * 0.68),
      height: Math.max(16, def.footprint.h * ISO.TILE_H * 0.45),
    };
  }

  private isBuildFootprintBlocked(def: BuildingDef, x: number, y: number): boolean {
    const x0 = x - Math.floor(def.footprint.w / 2);
    const y0 = y - Math.floor(def.footprint.h / 2);
    for (let dy = 0; dy < def.footprint.h; dy++) {
      for (let dx = 0; dx < def.footprint.w; dx++) {
        const tx = x0 + dx;
        const ty = y0 + dy;
        if (tx < 0 || ty < 0 || tx >= MAP.WIDTH || ty >= MAP.HEIGHT) return true;
        if (this.world.map.walkability[ty][tx] !== 0) return true;
        if (findResourceAt(this.world, tx, ty, 0.6) !== null) return true;
        if (findBuildingAtRender(this.world, tx, ty, 0.01) !== null) return true;
      }
    }
    return false;
  }

  /**
   * Convert a Phaser pointer to a tile coord, compensating for the elevation
   * of the tile under the pointer. The terrain bake lifts each tile by
   * `elev × VPER` pixels — a click on a high-elevation tile is therefore at a
   * smaller screen-y than its naive flat-projection coord would suggest. We
   * do one elevation lookup and back-correct.
   */
  private pointerToTile(pointer: Phaser.Input.Pointer): {
    tx: number;
    ty: number;
    tileX: number;
    tileY: number;
  } {
    const localX = pointer.worldX - this.worldContainer.x;
    const localY = pointer.worldY - this.worldContainer.y;
    // First pass — naive.
    let tile = screenToTile(localX, localY);
    let tx = Math.round(tile.x);
    let ty = Math.round(tile.y);
    // Second pass — pretend the cursor was at the elevation of the guessed
    // tile, so we shift the pointer y back down by `e × VPER` before
    // re-projecting. Usually converges in one step.
    const e = this.elevationAt(tx, ty);
    if (e !== 0) {
      tile = screenToTile(localX, localY + e * ISO.VPER);
      tx = Math.round(tile.x);
      ty = Math.round(tile.y);
    }
    return { tx, ty, tileX: tile.x, tileY: tile.y };
  }

  /** Pan the camera so that tile (tx, ty) is centred in the viewport. */
  panToTile(tx: number, ty: number): void {
    const c = tileToScreen(tx, ty);
    // The world container is positioned at (W/2, H/2 - offset). The camera
    // scroll is in screen-space, so we move the camera to centre the world's
    // (c.x, c.y) point.
    const screenX = this.worldContainer.x + c.x;
    const screenY = this.worldContainer.y + c.y;
    this.cameras.main.centerOn(screenX, screenY);
  }

  private panToLocalTownCenter(): void {
    for (const eid of buildingQuery(this.world.ecs)) {
      if (Owner.player[eid] !== this.perspectivePlayerId) continue;
      if (!hasComponent(this.world.ecs, TownCenterTag, eid)) continue;
      this.panToTile(Position.x[eid], Position.y[eid]);
      return;
    }
    let unitCount = 0;
    let sumX = 0;
    let sumY = 0;
    for (const eid of unitQuery(this.world.ecs)) {
      if (Owner.player[eid] !== this.perspectivePlayerId) continue;
      if (hasComponent(this.world.ecs, Health, eid) && Health.hp[eid] <= 0) continue;
      sumX += Position.x[eid];
      sumY += Position.y[eid];
      unitCount++;
    }
    if (unitCount > 0) {
      this.panToTile(sumX / unitCount, sumY / unitCount);
      return;
    }
    const spawn = this.world.map.spawns[1];
    if (spawn) this.panToTile(spawn.x, spawn.y);
  }

  private isScoutCavalryInspectionMode(): boolean {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('inspect') === 'scout-cavalry';
  }

  private isVillagerInspectionMode(): boolean {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('inspect') === 'villager';
  }

  private isArcherInspectionMode(): boolean {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('inspect') === 'archer';
  }

  private isSpearmanInspectionMode(): boolean {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('inspect') === 'spearman';
  }

  private isCannonInspectionMode(): boolean {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('inspect') === 'cannon';
  }

  private createScoutCavalryInspectionSheet(): void {
    this.scoutInspectionMode = true;
    this.world.paused = true;
    this.worldContainer.setVisible(false);
    this.cameras.main.setZoom(1);
    this.cameras.main.setScroll(0, 0);
    for (const id of [
      'title-screen',
      'resource-bar',
      'minimap-panel',
      'bottom-hud',
      'debug-overlay',
      'save-load-panel',
      'tech-tree-panel',
      'game-over',
    ]) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    }

    this.add
      .rectangle(0, 0, RENDER.WIDTH, RENDER.HEIGHT, 0x161922)
      .setOrigin(0)
      .setScrollFactor(0);
    this.add
      .text(24, 18, 'Scout Cavalry Sprite Draft', {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '20px',
        color: '#f1d58a',
      })
      .setScrollFactor(0);
    this.add
      .text(24, 46, '8 facings / idle, movement, attack frames / fixed voxel bake bounds', {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '12px',
        color: '#aab5bf',
      })
      .setScrollFactor(0);

    const g = this.add.graphics();
    g.setScrollFactor(0);
    g.lineStyle(1, 0x2b3140, 1);
    for (let y = 110; y <= 670; y += 125) g.lineBetween(24, y, RENDER.WIDTH - 24, y);

    const startX = 160;
    const startY = 140;
    const colW = 135;
    const rowH = 125;
    const scale = 1.45;
    const rows: Array<{ label: string; anim: ScoutCavalryAnim; frame: number }> = [
      { label: 'idle', anim: 'idle', frame: 0 },
      { label: 'move 0', anim: 'move', frame: 0 },
      { label: 'move 1', anim: 'move', frame: 1 },
      { label: 'attack 0', anim: 'attack', frame: 0 },
      { label: 'attack 1', anim: 'attack', frame: 1 },
    ];

    for (let c = 0; c < SCOUT_CAVALRY_FACINGS.length; c++) {
      this.add
        .text(startX + c * colW - 12, 86, SCOUT_CAVALRY_FACINGS[c], {
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: '13px',
          color: '#d9e2ec',
        })
        .setScrollFactor(0);
    }

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const y = startY + r * rowH;
      this.add
        .text(34, y - 8, row.label, {
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: '13px',
          color: '#d9e2ec',
        })
        .setScrollFactor(0);
      for (let c = 0; c < SCOUT_CAVALRY_FACINGS.length; c++) {
        const key = GameScene.scoutCavalryTextureKey(
          1,
          SCOUT_CAVALRY_FACINGS[c],
          row.anim,
          row.frame
        );
        this.add
          .sprite(startX + c * colW, y, key)
          .setOrigin(0.5, 0.85)
          .setScale(scale)
          .setScrollFactor(0);
      }
    }
  }

  private createVillagerInspectionSheet(): void {
    this.scoutInspectionMode = true;
    this.world.paused = true;
    this.worldContainer.setVisible(false);
    this.cameras.main.setZoom(1);
    this.cameras.main.setScroll(0, 0);
    for (const id of [
      'title-screen',
      'resource-bar',
      'minimap-panel',
      'bottom-hud',
      'debug-overlay',
      'save-load-panel',
      'tech-tree-panel',
      'game-over',
    ]) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    }

    this.add
      .rectangle(0, 0, RENDER.WIDTH, RENDER.HEIGHT, 0x161922)
      .setOrigin(0)
      .setScrollFactor(0);
    this.add
      .text(24, 18, 'Villager Sprite Draft', {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '20px',
        color: '#f1d58a',
      })
      .setScrollFactor(0);
    this.add
      .text(24, 46, '8 facings / idle, movement, carry, harvest, build frames', {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '12px',
        color: '#aab5bf',
      })
      .setScrollFactor(0);

    const g = this.add.graphics();
    g.setScrollFactor(0);
    g.lineStyle(1, 0x2b3140, 1);
    for (let y = 100; y <= 690; y += 66) g.lineBetween(24, y, RENDER.WIDTH - 24, y);

    const startX = 150;
    const startY = 116;
    const colW = 135;
    const rowH = 66;
    const scale = 1.8;
    const rows: Array<{ label: string; anim: VillagerAnim; frame: number }> = [
      { label: 'idle', anim: 'idle', frame: 0 },
      { label: 'move 0', anim: 'move', frame: 0 },
      { label: 'move 1', anim: 'move', frame: 1 },
      { label: 'carry 0', anim: 'carry', frame: 0 },
      { label: 'carry 1', anim: 'carry', frame: 1 },
      { label: 'harvest 0', anim: 'harvest', frame: 0 },
      { label: 'harvest 1', anim: 'harvest', frame: 1 },
      { label: 'build 0', anim: 'build', frame: 0 },
      { label: 'build 1', anim: 'build', frame: 1 },
    ];

    for (let c = 0; c < VILLAGER_FACINGS.length; c++) {
      this.add
        .text(startX + c * colW - 12, 78, VILLAGER_FACINGS[c], {
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: '13px',
          color: '#d9e2ec',
        })
        .setScrollFactor(0);
    }

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const y = startY + r * rowH;
      this.add
        .text(34, y - 8, row.label, {
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: '13px',
          color: '#d9e2ec',
        })
        .setScrollFactor(0);
      for (let c = 0; c < VILLAGER_FACINGS.length; c++) {
        const key = GameScene.villagerTextureKey(1, VILLAGER_FACINGS[c], row.anim, row.frame);
        this.add
          .sprite(startX + c * colW, y, key)
          .setOrigin(0.5, 0.73)
          .setScale(scale)
          .setScrollFactor(0);
      }
    }
  }

  private createArcherInspectionSheet(): void {
    this.createCombatUnitInspectionSheet({
      title: 'Archer Sprite Draft',
      subtitle: '8 facings / idle, movement, draw and release attack frames',
      facings: ARCHER_FACINGS,
      rows: [
        { label: 'idle', anim: 'idle', frame: 0 },
        { label: 'move 0', anim: 'move', frame: 0 },
        { label: 'move 1', anim: 'move', frame: 1 },
        { label: 'draw', anim: 'attack', frame: 0 },
        { label: 'release', anim: 'attack', frame: 1 },
      ],
      textureKey: (facing, anim, frame) =>
        GameScene.archerTextureKey(1, facing as ArcherFacing, anim as ArcherAnim, frame),
    });
  }

  private createSpearmanInspectionSheet(): void {
    this.createCombatUnitInspectionSheet({
      title: 'Spearman Sprite Draft',
      subtitle: '8 facings / idle, movement, spear thrust attack frames',
      facings: SPEARMAN_FACINGS,
      rows: [
        { label: 'idle', anim: 'idle', frame: 0 },
        { label: 'move 0', anim: 'move', frame: 0 },
        { label: 'move 1', anim: 'move', frame: 1 },
        { label: 'brace', anim: 'attack', frame: 0 },
        { label: 'thrust', anim: 'attack', frame: 1 },
      ],
      textureKey: (facing, anim, frame) =>
        GameScene.spearmanTextureKey(1, facing as SpearmanFacing, anim as SpearmanAnim, frame),
    });
  }

  private createCannonInspectionSheet(): void {
    this.createCombatUnitInspectionSheet({
      title: 'Field Cannon Sprite Draft',
      subtitle: '8 facings / idle, wheel phase, recoil and muzzle-flash frames',
      facings: CANNON_FACINGS,
      rows: [
        { label: 'idle', anim: 'idle', frame: 0 },
        { label: 'move 0', anim: 'move', frame: 0 },
        { label: 'move 1', anim: 'move', frame: 1 },
        { label: 'aim', anim: 'attack', frame: 0 },
        { label: 'fire', anim: 'attack', frame: 1 },
      ],
      textureKey: (facing, anim, frame) =>
        GameScene.cannonTextureKey(1, facing as CannonFacing, anim as CannonAnim, frame),
      originY: GameScene.CANNON_UNIT_ORIGIN_Y,
      scale: 1.55,
    });
  }

  private createCombatUnitInspectionSheet(config: {
    title: string;
    subtitle: string;
    facings: readonly string[];
    rows: Array<{ label: string; anim: string; frame: number }>;
    textureKey: (facing: string, anim: string, frame: number) => string;
    originY?: number;
    scale?: number;
  }): void {
    this.scoutInspectionMode = true;
    this.world.paused = true;
    this.worldContainer.setVisible(false);
    this.cameras.main.setZoom(1);
    this.cameras.main.setScroll(0, 0);
    for (const id of [
      'title-screen',
      'resource-bar',
      'minimap-panel',
      'bottom-hud',
      'debug-overlay',
      'save-load-panel',
      'tech-tree-panel',
      'game-over',
    ]) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    }

    this.add
      .rectangle(0, 0, RENDER.WIDTH, RENDER.HEIGHT, 0x161922)
      .setOrigin(0)
      .setScrollFactor(0);
    this.add
      .text(24, 18, config.title, {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '20px',
        color: '#f1d58a',
      })
      .setScrollFactor(0);
    this.add
      .text(24, 46, config.subtitle, {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '12px',
        color: '#aab5bf',
      })
      .setScrollFactor(0);

    const g = this.add.graphics();
    g.setScrollFactor(0);
    g.lineStyle(1, 0x2b3140, 1);
    for (let y = 105; y <= 650; y += 105) g.lineBetween(24, y, RENDER.WIDTH - 24, y);

    const startX = 150;
    const startY = 130;
    const colW = 135;
    const rowH = 105;
    const scale = config.scale ?? 1.9;

    for (let c = 0; c < config.facings.length; c++) {
      this.add
        .text(startX + c * colW - 12, 82, config.facings[c], {
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: '13px',
          color: '#d9e2ec',
        })
        .setScrollFactor(0);
    }

    for (let r = 0; r < config.rows.length; r++) {
      const row = config.rows[r];
      const y = startY + r * rowH;
      this.add
        .text(34, y - 8, row.label, {
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: '13px',
          color: '#d9e2ec',
        })
        .setScrollFactor(0);
      for (let c = 0; c < config.facings.length; c++) {
        const key = config.textureKey(config.facings[c], row.anim, row.frame);
        this.add
          .sprite(startX + c * colW, y, key)
          .setOrigin(0.5, config.originY ?? 0.82)
          .setScale(scale)
          .setScrollFactor(0);
      }
    }
  }

  /** Minimap data — tiles + entity dots. Returns by reference for perf. */
  getMinimapData(): {
    mapW: number;
    mapH: number;
    tiles: Uint8Array;
    entities: Array<{ x: number; y: number; player: number; kind: number }>;
    combatAlerts: Array<{ x: number; y: number; age: number }>;
  } {
    const ents: Array<{ x: number; y: number; player: number; kind: number }> = [];
    const alertCutoff = this.world.tick - GameScene.MINIMAP_COMBAT_ALERT_TICKS;
    this.minimapCombatAlerts = this.minimapCombatAlerts.filter((alert) => alert.tick >= alertCutoff);
    const combatAlerts = this.minimapCombatAlerts.map((alert) => ({
      x: alert.x,
      y: alert.y,
      age: Math.min(1, (this.world.tick - alert.tick) / GameScene.MINIMAP_COMBAT_ALERT_TICKS),
    }));
    const vis = getPlayerVisibility(this.world, this.perspectivePlayerId);
    const tiles = new Uint8Array(this.world.map.tiles.length);
    for (let i = 0; i < tiles.length; i++) {
      tiles[i] = vis?.explored[i] === 1 ? this.world.map.tiles[i] : 255;
    }

    const unitEnts = unitQuery(this.world.ecs);
    for (const eid of unitEnts) {
      if (!this.isEntityVisibleToLocal(eid)) continue;
      ents.push({
        x: Position.x[eid],
        y: Position.y[eid],
        player: Owner.player[eid],
        kind: hasComponent(this.world.ecs, VillagerTag, eid)
          ? 1
          : 2 + UnitKind.kind[eid],
      });
    }
    const buildEnts = buildingQuery(this.world.ecs);
    for (const eid of buildEnts) {
      if (!this.isEntityVisibleToLocal(eid)) continue;
      ents.push({
        x: Position.x[eid],
        y: Position.y[eid],
        player: Owner.player[eid],
        kind: 3, // building
      });
    }
    for (const snap of vis?.lastSeenBuildings.values() ?? []) {
      if (!isTileExploredBy(this.world, this.perspectivePlayerId, snap.x, snap.y)) continue;
      if (
        isBuildingFootprintVisibleTo(
          this.world,
          this.perspectivePlayerId,
          snap.defId,
          snap.x,
          snap.y
        )
      ) continue;
      ents.push({
        x: snap.x,
        y: snap.y,
        player: snap.owner,
        kind: 3,
      });
    }
    const resEnts = resourceQuery(this.world.ecs);
    for (const eid of resEnts) {
      if (!this.isResourceExploredByLocal(eid)) continue;
      ents.push({
        x: Position.x[eid],
        y: Position.y[eid],
        player: 0,
        kind: 10 + Resource.kind[eid], // resources are >= 10
      });
    }
    return {
      mapW: MAP.WIDTH,
      mapH: MAP.HEIGHT,
      tiles,
      entities: ents,
      combatAlerts,
    };
  }

  /** Selection summary for the portrait panel. */
  getSelectionInfo(): {
    kind:
      | 'villager'
      | 'archer'
      | 'spearman'
      | 'scoutCavalry'
      | 'gunman'
      | 'cannon'
      | 'machineGun'
      | 'mortar'
      | 'tc'
      | 'house'
      | 'farm'
      | 'mill'
      | 'lumberCamp'
      | 'goldMine'
      | 'stoneQuarry'
      | 'barracks'
      | 'archeryRange'
      | 'stable'
      | 'foundry'
      | 'defensiveTower'
      | 'foundation'
      | 'mixed'
      | 'none';
    name: string;
    glyph: string;
    hp: number;
    hpMax: number;
    count: number;
    team: number;
    stats: string;
  } {
    const sel = selectedQuery(this.world.ecs);
    if (sel.length === 0) {
      return { kind: 'none', name: '—', glyph: '·', hp: 0, hpMax: 0, count: 0, team: 0, stats: '' };
    }
    // Determine the dominant kind. Buildings + units in mixed select → 'mixed'.
    type SelKind = ReturnType<GameScene['getSelectionInfo']>['kind'];
    let firstKind: SelKind = 'none';
    let mixed = false;
    let totalHp = 0;
    let totalHpMax = 0;
    let team = 0;
    for (const eid of sel) {
      let k: SelKind = 'none';
      if (hasComponent(this.world.ecs, VillagerTag, eid)) k = 'villager';
      else if (hasComponent(this.world.ecs, ArcherTag, eid)) k = 'archer';
      else if (hasComponent(this.world.ecs, SpearmanTag, eid)) k = 'spearman';
      else if (hasComponent(this.world.ecs, ScoutCavalryTag, eid)) k = 'scoutCavalry';
      else if (hasComponent(this.world.ecs, GunmanTag, eid)) k = 'gunman';
      else if (hasComponent(this.world.ecs, CannonTag, eid)) k = 'cannon';
      else if (hasComponent(this.world.ecs, MachineGunTag, eid)) k = 'machineGun';
      else if (hasComponent(this.world.ecs, MortarTag, eid)) k = 'mortar';
      else if (hasComponent(this.world.ecs, TownCenterTag, eid)) k = 'tc';
      else if (hasComponent(this.world.ecs, Building, eid)) {
        if (hasComponent(this.world.ecs, ConstructionSite, eid)) {
          k = 'foundation';
        } else {
          const defId = Building.defId[eid];
          k = defId === BuildingDefId.HOUSE ? 'house'
            : defId === BuildingDefId.FARM ? 'farm'
            : defId === BuildingDefId.MILL ? 'mill'
            : defId === BuildingDefId.LUMBER_CAMP ? 'lumberCamp'
            : defId === BuildingDefId.GOLD_MINE ? 'goldMine'
            : defId === BuildingDefId.STONE_QUARRY ? 'stoneQuarry'
            : defId === BuildingDefId.BARRACKS ? 'barracks'
            : defId === BuildingDefId.ARCHERY_RANGE ? 'archeryRange'
            : defId === BuildingDefId.STABLE ? 'stable'
            : defId === BuildingDefId.FOUNDRY ? 'foundry'
            : defId === BuildingDefId.DEFENSIVE_TOWER ? 'defensiveTower'
            : 'tc';
        }
      }
      if (firstKind === 'none') firstKind = k;
      else if (firstKind !== k) mixed = true;
      if (hasComponent(this.world.ecs, Health, eid)) {
        totalHp += Health.hp[eid];
        totalHpMax += Health.hpMax[eid];
      }
      team = Owner.player[eid] ?? team;
    }
    const kind = mixed ? 'mixed' : firstKind;
    const NAME_BY_KIND: Record<string, string> = {
      villager: 'Villager',
      archer: 'Archer',
      spearman: 'Pikeman',
      scoutCavalry: 'Scout Cavalry',
      gunman: 'Gunman',
      cannon: 'Field Cannon',
      machineGun: 'Machine Gun',
      mortar: 'Mortar Team',
      tc: 'Town Center',
      house: 'House',
      farm: 'Farm',
      mill: 'Mill',
      lumberCamp: 'Lumber Camp',
      goldMine: 'Gold Mine',
      stoneQuarry: 'Stone Quarry',
      barracks: 'Barracks',
      archeryRange: 'Archery Range',
      stable: 'Stable',
      foundry: 'Foundry',
      defensiveTower: 'Defensive Tower',
      foundation: 'Foundation',
      mixed: 'Mixed Selection',
    };
    const GLYPH_BY_KIND: Record<string, string> = {
      villager: '🧑',
      archer: '🏹',
      spearman: '♜',
      scoutCavalry: '♞',
      gunman: '•',
      cannon: '●',
      machineGun: '▰',
      mortar: '◤',
      tc: '🏰',
      house: '🏠',
      farm: '🌾',
      mill: '◈',
      lumberCamp: '🪵',
      goldMine: '⛏',
      stoneQuarry: '▣',
      barracks: '⚒',
      archeryRange: '🏹',
      stable: '♞',
      foundry: '●',
      defensiveTower: '♜',
      foundation: '🪜',
      mixed: '⊞',
    };
    // Build stats line.
    let stats = '';
    if (
      kind === 'villager' ||
      kind === 'archer' ||
      kind === 'spearman' ||
      kind === 'scoutCavalry' ||
      kind === 'gunman' ||
      kind === 'cannon' ||
      kind === 'machineGun' ||
      kind === 'mortar'
    ) {
      const e0 = sel[0];
      const speed = Speed.value[e0];
      const atk = hasComponent(this.world.ecs, Combat, e0) ? Combat.atk[e0] : 0;
      const range = hasComponent(this.world.ecs, Combat, e0) ? Combat.range[e0] : 0;
      stats = `Atk ${atk}  Rng ${this.formatRange(range)}  Spd ${speed.toFixed(1)}`;
      if (kind === 'villager') {
        const carry = hasComponent(this.world.ecs, ResourceCarry, e0)
          ? ResourceCarry.amount[e0]
          : 0;
        if (carry > 0) stats += `  Carry ${carry}/10`;
      } else if (kind === 'machineGun' && hasComponent(this.world.ecs, MachineGunDeployment, e0)) {
        stats += MachineGunDeployment.deployed[e0] === 1
          ? '  Deployed'
          : `  Deploy ${Math.ceil(MachineGunDeployment.setupTicks[e0] / SIM.TICK_HZ)}s`;
      }
    } else if (
      kind === 'tc' ||
      kind === 'house' ||
      kind === 'farm' ||
      kind === 'mill' ||
      kind === 'lumberCamp' ||
      kind === 'goldMine' ||
      kind === 'stoneQuarry' ||
      kind === 'barracks' ||
      kind === 'archeryRange' ||
      kind === 'stable' ||
      kind === 'foundry' ||
      kind === 'defensiveTower'
    ) {
      const e0 = sel[0];
      const defId = Building.defId[e0];
      const def = BUILDING_TABLE[defId];
      if (def) {
        stats = `Pop +${getBuildingPopProvided(this.world, Owner.player[e0], defId)}`;
        if (hasComponent(this.world.ecs, ResourceWorksite, e0)) {
          const workers = ResourceWorksite.assignedWorkers[e0];
          const slots = getWorksiteWorkerSlots(this.world, e0);
          stats += `  Workers ${workers}/${slots}  ${this.resourceKindName(ResourceWorksite.kind[e0])}`;
        } else if (defId === BuildingDefId.MILL) {
          stats += '  Food drop-off +50%';
        } else if (def.trains.length > 0) {
          stats += '  Producer';
        } else if (def.combat) {
          stats += `  Atk ${def.combat.atk}  Rng ${this.formatRange(def.combat.range)}`;
        }
      }
    } else if (kind === 'foundation') {
      const e0 = sel[0];
      const prog = ConstructionSite.progress[e0];
      const total = ConstructionSite.totalTicks[e0] || 1;
      stats = `Build ${Math.floor(prog / total * 100)}%`;
    }
    return {
      kind,
      name: NAME_BY_KIND[kind] ?? '—',
      glyph: GLYPH_BY_KIND[kind] ?? '·',
      hp: totalHp,
      hpMax: totalHpMax,
      count: sel.length,
      team,
      stats,
    };
  }

  /** Available actions for the action grid, based on current selection. */
  getAvailableActions(): ActionGridAction[] {
    const sel = selectedQuery(this.world.ecs);
    const fmtCost = (cost: { food: number; wood: number; gold: number; stone: number }) =>
      this.formatCost(cost);
    const canAfford = (cost: { food: number; wood: number; gold: number; stone: number }) =>
      this.canAffordCost(1, cost);

    // Mixed: pick the most useful set while keeping worksite workers autonomous.
    let hasVillager = false, hasWorksiteWorker = false, hasMilitary = false, hasTc = false;
    let removableBuildingCount = 0;
    const selectedProducerDefs = new Set<number>();
    const selectedProducerEids: number[] = [];
    const selectedWorksiteEids: number[] = [];
    const selectedMilitaryEids: number[] = [];
    for (const eid of sel) {
      if (hasComponent(this.world.ecs, VillagerTag, eid)) {
        if (hasComponent(this.world.ecs, WorksiteWorker, eid)) {
          hasWorksiteWorker = true;
        } else {
          hasVillager = true;
        }
      }
      if (
        hasComponent(this.world.ecs, ArcherTag, eid) ||
        hasComponent(this.world.ecs, SpearmanTag, eid) ||
        hasComponent(this.world.ecs, ScoutCavalryTag, eid) ||
        hasComponent(this.world.ecs, GunmanTag, eid) ||
        hasComponent(this.world.ecs, CannonTag, eid) ||
        hasComponent(this.world.ecs, MachineGunTag, eid)
      ) {
        hasMilitary = true;
        if (Owner.player[eid] === this.perspectivePlayerId && hasComponent(this.world.ecs, UnitStance, eid)) {
          selectedMilitaryEids.push(eid);
        }
      }
      if (hasComponent(this.world.ecs, TownCenterTag, eid)) hasTc = true;
      if (
        hasComponent(this.world.ecs, Building, eid) &&
        Owner.player[eid] === this.perspectivePlayerId &&
        Building.defId[eid] !== BuildingDefId.TOWN_CENTER
      ) {
        removableBuildingCount++;
      }
      if (
        hasComponent(this.world.ecs, Producer, eid) &&
        hasComponent(this.world.ecs, Building, eid) &&
        Owner.player[eid] === this.perspectivePlayerId
      ) {
        selectedProducerDefs.add(Building.defId[eid]);
        selectedProducerEids.push(eid);
        if (hasComponent(this.world.ecs, ResourceWorksite, eid)) {
          selectedWorksiteEids.push(eid);
        }
      }
    }

    const actions: ActionGridAction[] = [];
    const queuedAtSelectedProducers = (unitDefId: number) =>
      selectedProducerEids.reduce((sum, eid) => {
        const buildingDef = BUILDING_TABLE[Building.defId[eid]];
        const unit = UNIT_TABLE[unitDefId];
        if (!buildingDef || !unit) return sum;
        if (unit.trainAt !== buildingDef.id && unitDefId !== UnitDefId.VILLAGER) return sum;
        const queued = this.world.productionQueues.get(eid) ?? [];
        return sum + queued.filter((defId) => defId === unitDefId).length;
      }, 0);
    const addBuildActions = () => {
      const addBuild = (defId: number, id: string, key: string, glyph: string, hudIcon: string) => {
        if (!isBuildingUnlocked(this.world, this.perspectivePlayerId, defId)) return;
        const def = BUILDING_TABLE[defId];
        if (!def) return;
        const affordable = canAfford(def.cost);
        actions.push({
          id,
          label: `Build ${def.name}`,
          key,
          glyph,
          hudIcon,
          cost: fmtCost(def.cost),
          enabled: affordable,
          kind: 'build',
          meta: `${Math.ceil(def.buildTimeTicks / SIM.TICK_HZ)}s`,
          disabledReason: affordable ? undefined : `Needs ${fmtCost(def.cost)}`,
        });
      };
      addBuild(BuildingDefId.LUMBER_CAMP, 'build-lumber-camp', 'L', '▥', 'lumberCamp');
      addBuild(BuildingDefId.STONE_QUARRY, 'build-stone-quarry', 'C', '▣', 'stoneQuarry');
      addBuild(BuildingDefId.HOUSE, 'build-house', 'H', '⌂', 'house');
      addBuild(BuildingDefId.BARRACKS, 'build-barracks', 'R', '⚒', 'barracks');
      addBuild(BuildingDefId.GOLD_MINE, 'build-gold-mine', 'G', '⛏', 'goldMine');
      addBuild(BuildingDefId.STABLE, 'build-stable', 'T', '♞', 'stable');
      addBuild(BuildingDefId.FARM, 'build-farm', 'M', '🌾', 'farm');
      addBuild(BuildingDefId.MILL, 'build-mill', 'I', '◈', 'mill');
      addBuild(BuildingDefId.FOUNDRY, 'build-foundry', 'F', '●', 'foundry');
      addBuild(BuildingDefId.DEFENSIVE_TOWER, 'build-defensive-tower', 'Y', '♜', 'defensiveTower');
    };
    const addTrainAction = (unitDefId: number, key: string, glyph: string) => {
      const unit = UNIT_TABLE[unitDefId];
      if (!unit) return;
      if (!isUnitUnlocked(this.world, this.perspectivePlayerId, unitDefId)) return;
      const affordable = canAfford(unit.cost);
      const hasPopRoom =
        unitDefId === UnitDefId.VILLAGER ||
        this.hasPopulationRoomForUnit(this.perspectivePlayerId, unitDefId);
      const enabled = affordable && hasPopRoom;
      actions.push({
        id: `train-unit-${unitDefId}`,
        label: `Train ${unit.name}`,
        key,
        glyph,
        cost: fmtCost(unit.cost),
        enabled,
        kind: 'train',
        meta: `${this.formatTrainTime(unit.trainTimeTicks)} / Pop ${unit.popCost}`,
        queue: queuedAtSelectedProducers(unitDefId),
        disabledReason: affordable ? (hasPopRoom ? undefined : 'Population cap reached') : `Needs ${fmtCost(unit.cost)}`,
      });
    };
    const hasOpenWorksiteWorkerSlot = (eid: number) => {
      const queue = this.world.productionQueues.get(eid) ?? [];
      const queuedWorkers = queue.filter((defId) => defId === UnitDefId.VILLAGER).length;
      return ResourceWorksite.assignedWorkers[eid] + queuedWorkers < getWorksiteWorkerSlots(this.world, eid) &&
        queue.length < 2;
    };
    const addWorksiteWorkerAction = () => {
      const unit = UNIT_TABLE[UnitDefId.VILLAGER];
      const affordable = canAfford(unit.cost);
      const hasSlot = selectedWorksiteEids.some(hasOpenWorksiteWorkerSlot);
      actions.push({
        id: `train-unit-${UnitDefId.VILLAGER}`,
        label: 'Train Worker',
        key: 'Q',
        glyph: '🧑',
        cost: fmtCost(unit.cost),
        enabled: affordable && hasSlot,
        kind: 'train',
        meta: `${this.formatTrainTime(unit.trainTimeTicks)} / Worksite`,
        queue: queuedAtSelectedProducers(UnitDefId.VILLAGER),
        disabledReason: affordable ? (hasSlot ? undefined : 'Worker slots full') : `Needs ${fmtCost(unit.cost)}`,
      });
    };

    if (
      sel.length === 0 ||
      hasVillager ||
      (selectedProducerDefs.size === 0 && !hasMilitary && !hasWorksiteWorker)
    ) {
      addBuildActions();
    }
    if (hasTc) {
      const nextAgeTechId = this.nextAgeTechId(this.perspectivePlayerId);
      const nextAgeDef = getAgeDef((this.world.ages[this.perspectivePlayerId]?.current ?? AgeId.DARK) + 1);
      const nextAgeTech = nextAgeTechId ? techDef(nextAgeTechId) : null;
      const status = nextAgeTechId
        ? techStatus(this.world, this.perspectivePlayerId, nextAgeTechId)
        : 'locked';
      if (nextAgeTech && nextAgeDef) {
        const available = status === 'available';
        const affordable = canAfford(nextAgeTech.cost);
        actions.push({
          id: 'advance-age', label: nextAgeDef.name, key: 'E', glyph: '^',
          cost: fmtCost(nextAgeTech.cost),
          enabled: available && affordable,
          kind: 'tech',
          meta: 'Research',
          disabledReason: available ? (affordable ? undefined : `Needs ${fmtCost(nextAgeTech.cost)}`) : 'Locked',
        });
      }
    }
    if (selectedWorksiteEids.length > 0) {
      addWorksiteWorkerAction();
    }
    if (selectedProducerDefs.has(BuildingDefId.BARRACKS)) {
      addTrainAction(UnitDefId.SPEARMAN, 'Q', '♜');
      addTrainAction(UnitDefId.ARCHER, 'E', '🏹');
    }
    if (selectedProducerDefs.has(BuildingDefId.STABLE)) {
      addTrainAction(UnitDefId.SCOUT_CAVALRY, 'Q', '♞');
    }
    if (selectedProducerDefs.has(BuildingDefId.FOUNDRY)) {
      addTrainAction(UnitDefId.GUNMAN, 'Q', '•');
      addTrainAction(UnitDefId.CANNON, 'E', '●');
    }
    const ownedArmyProducerCount = this.countOwnedArmyProducers(this.perspectivePlayerId);
    if (ownedArmyProducerCount > 0) {
      const rally = this.world.armyRallyPoints[this.perspectivePlayerId];
      actions.push({
        id: 'set-army-rally',
        label: 'Army Rally Point',
        key: 'V',
        glyph: '⚑',
        enabled: true,
        kind: 'command',
        meta: rally
          ? `${rally.x},${rally.y} / ${ownedArmyProducerCount} buildings`
          : `${ownedArmyProducerCount} buildings`,
        active: this.armyRallyMode,
      });
    }
    if (removableBuildingCount > 0) {
      actions.push({
        id: 'remove-building',
        label: removableBuildingCount === 1 ? 'Remove Building' : 'Remove Buildings',
        key: 'Del',
        glyph: '⌫',
        enabled: true,
        kind: 'command',
        meta: removableBuildingCount === 1 ? 'Delete selected' : `${removableBuildingCount} selected`,
      });
    }
    if (hasMilitary && !hasVillager) {
      const holdCount = selectedMilitaryEids.filter((eid) =>
        UnitStance.stance[eid] === UnitStanceId.HOLD_POSITION
      ).length;
      const allHolding = selectedMilitaryEids.length > 0 &&
        holdCount === selectedMilitaryEids.length;
      const allAutoDefending = selectedMilitaryEids.length > 0 && holdCount === 0;
      const stanceMeta = allHolding || allAutoDefending ? 'Active' : 'Mixed';
      const formationMode = this.clampFormationMode(this.perspectiveFormationMode());
      const facingLabel = `Face ${this.formationFacingLabel()}`;
      actions.push({
        id: 'stance-hold-position',
        label: 'Hold Position',
        key: 'H',
        glyph: 'H',
        enabled: selectedMilitaryEids.length > 0,
        kind: 'command',
        meta: allHolding ? stanceMeta : 'No auto-chase',
        active: allHolding,
      });
      actions.push({
        id: 'stance-auto-defend',
        label: 'Auto Defend',
        key: '',
        glyph: 'A',
        enabled: selectedMilitaryEids.length > 0,
        kind: 'command',
        meta: allAutoDefending ? stanceMeta : 'Chase nearby',
        active: allAutoDefending,
      });
      actions.push({
        id: 'formation-free',
        label: 'Free Formation',
        key: '',
        glyph: '··',
        enabled: selectedMilitaryEids.length > 1,
        kind: 'command',
        meta: formationMode === 0 ? 'Active' : 'Loose movement',
        active: formationMode === 0,
      });
      actions.push({
        id: 'formation-line',
        label: 'Line Formation',
        key: '',
        glyph: '↔',
        enabled: selectedMilitaryEids.length > 1,
        kind: 'command',
        meta: formationMode === 1 ? 'Active' : 'Spread line',
        active: formationMode === 1,
      });
      actions.push({
        id: 'formation-compact',
        label: 'Compact Formation',
        key: '',
        glyph: '▦',
        enabled: selectedMilitaryEids.length > 1,
        kind: 'command',
        meta: formationMode === 2 ? 'Active' : 'Dense block',
        active: formationMode === 2,
      });
      actions.push({
        id: 'formation-rotate-ccw',
        label: 'Rotate CCW',
        key: '',
        glyph: '⟲',
        enabled: selectedMilitaryEids.length > 1 && formationMode !== 0,
        kind: 'command',
        meta: facingLabel,
      });
      actions.push({
        id: 'formation-rotate-cw',
        label: 'Rotate CW',
        key: '',
        glyph: '⟳',
        enabled: selectedMilitaryEids.length > 1 && formationMode !== 0,
        kind: 'command',
        meta: facingLabel,
      });
      actions.push({ id: 'stop', label: 'Stop', key: 'S', glyph: 'X', enabled: true, kind: 'command' });
    }
    return actions;
  }

  /** Trigger an action by id (called from action grid clicks). */
  triggerAction(actionId: string, trainCount = 1): void {
    if (actionId.startsWith('train-unit-')) {
      const defId = Number(actionId.slice('train-unit-'.length));
      this.trainUnitAtSelectedProducer(defId, trainCount);
      return;
    }
    switch (actionId) {
      case 'build-house': this.startBuildMode('HOUSE', 'build HOUSE — click to place'); return;
      case 'build-farm': this.startBuildMode('FARM', 'build FARM — click to place'); return;
      case 'build-mill': this.startBuildMode('MILL', 'build MILL — click to place'); return;
      case 'build-lumber-camp': this.startBuildMode('LUMBER_CAMP', 'build LUMBER HUT — click near trees'); return;
      case 'build-gold-mine': this.startBuildMode('GOLD_MINE', 'build GOLD MINE — click near gold'); return;
      case 'build-stone-quarry': this.startBuildMode('STONE_QUARRY', 'build STONE QUARRY — click near stone'); return;
      case 'build-barracks': this.startBuildMode('BARRACKS', 'build BARRACKS — click to place'); return;
      case 'build-stable': this.startBuildMode('STABLE', 'build STABLE — click to place'); return;
      case 'build-foundry': this.startBuildMode('FOUNDRY', 'build FOUNDRY — click to place'); return;
      case 'build-defensive-tower': this.startBuildMode('DEFENSIVE_TOWER', 'build DEFENSIVE TOWER — click to place'); return;
      case 'set-army-rally': this.startArmyRallyMode(); return;
      case 'remove-building': this.removeSelectedBuildings(); return;
      case 'stance-hold-position': this.setSelectedUnitStance(UnitStanceId.HOLD_POSITION); return;
      case 'stance-auto-defend': this.setSelectedUnitStance(UnitStanceId.AUTO_DEFEND); return;
      case 'formation-free': this.setFormationMode(0); return;
      case 'formation-line': this.setFormationMode(1); return;
      case 'formation-compact': this.setFormationMode(2); return;
      case 'formation-rotate-ccw': this.rotateFormation(-1); return;
      case 'formation-rotate-cw': this.rotateFormation(1); return;
      case 'stop': this.dispatch({ type: 'stopSelected' }); return;
      case 'advance-age': this.onAdvanceAgeHotkey(); return;
    }
  }

  /**
   * Bake every voxel texture we'll need. Called once during scene create().
   * The textures live in Phaser's texture cache and are reused by every sprite
   * of the matching type.
   */
  private bakeAllTextures(): void {
    // Back to original voxelW values — sprite size on screen stays the same;
    // the sharpness win now comes from canvas-level nearest-neighbour scaling
    // (pixelArt mode + image-rendering: pixelated), not from oversized bakes.
    for (let p = 1; p <= 2; p++) {
      const teamColor = TEAM_COLORS[p] ?? 0xffffff;
      this.bakeIfMissing(GameScene.DARK_TC_KEY_PREFIX + p, () =>
        buildDarkTcVoxels(teamColor), { voxelW: 5 });
      this.bakeIfMissing(GameScene.CASTLE_TC_KEY_PREFIX + p, () =>
        buildDarkTcVoxels(teamColor, 'castle'), { voxelW: 5 });
      this.bakeIfMissing(GameScene.GUNPOWDER_TC_KEY_PREFIX + p, () =>
        buildDarkTcVoxels(teamColor, 'gunpowder'), { voxelW: 5 });
      this.bakeIfMissing(GameScene.DEFENSIVE_TOWER_KEY_PREFIX + p, () =>
        buildDarkDefensiveTowerVoxels(teamColor), { voxelW: 4 });
      for (const facing of VILLAGER_FACINGS) {
        for (const anim of VILLAGER_ANIMS) {
          for (let frame = 0; frame < VILLAGER_FRAME_COUNTS[anim]; frame++) {
            this.bakeIfMissing(
              GameScene.villagerTextureKey(p, facing, anim, frame),
              () => buildVillagerVoxels(teamColor, { facing, anim, frame }),
              { voxelW: 4, bounds: VILLAGER_BAKE_BOUNDS }
            );
          }
        }
      }
      for (const facing of ARCHER_FACINGS) {
        for (const anim of ARCHER_ANIMS) {
          for (let frame = 0; frame < ARCHER_FRAME_COUNTS[anim]; frame++) {
            this.bakeIfMissing(
              GameScene.archerTextureKey(p, facing, anim, frame),
              () => buildArcherVoxels(teamColor, { facing, anim, frame }),
              { voxelW: 4, bounds: ARCHER_BAKE_BOUNDS }
            );
          }
        }
      }
      for (const facing of SPEARMAN_FACINGS) {
        for (const anim of SPEARMAN_ANIMS) {
          for (let frame = 0; frame < SPEARMAN_FRAME_COUNTS[anim]; frame++) {
            this.bakeIfMissing(
              GameScene.spearmanTextureKey(p, facing, anim, frame),
              () => buildSpearmanVoxels(teamColor, { facing, anim, frame }),
              { voxelW: 4, bounds: SPEARMAN_BAKE_BOUNDS }
            );
          }
        }
      }
      for (const facing of SCOUT_CAVALRY_FACINGS) {
        for (const anim of SCOUT_CAVALRY_ANIMS) {
          for (let frame = 0; frame < SCOUT_CAVALRY_FRAME_COUNTS[anim]; frame++) {
            this.bakeIfMissing(
              GameScene.scoutCavalryTextureKey(p, facing, anim, frame),
              () => buildScoutCavalryVoxels(teamColor, { facing, anim, frame }),
              { voxelW: 4, bounds: SCOUT_CAVALRY_BAKE_BOUNDS }
            );
          }
        }
      }
      for (const facing of GUNMAN_FACINGS) {
        for (const anim of GUNMAN_ANIMS) {
          for (let frame = 0; frame < GUNMAN_FRAME_COUNTS[anim]; frame++) {
            this.bakeIfMissing(
              GameScene.gunmanTextureKey(p, facing, anim, frame),
              () => buildGunmanVoxels(teamColor, { facing, anim, frame }),
              { voxelW: 4, bounds: GUNMAN_BAKE_BOUNDS }
            );
          }
        }
      }
      for (const facing of CANNON_FACINGS) {
        for (const anim of CANNON_ANIMS) {
          for (let frame = 0; frame < CANNON_FRAME_COUNTS[anim]; frame++) {
            this.bakeIfMissing(
              GameScene.cannonTextureKey(p, facing, anim, frame),
              () => buildCannonVoxels(teamColor, { facing, anim, frame }),
              { voxelW: 4, bounds: CANNON_BAKE_BOUNDS }
            );
          }
        }
      }
      for (const facing of MACHINE_GUN_FACINGS) {
        for (const anim of MACHINE_GUN_ANIMS) {
          for (let frame = 0; frame < MACHINE_GUN_FRAME_COUNTS[anim]; frame++) {
            this.bakeIfMissing(
              GameScene.machineGunTextureKey(p, facing, anim, frame),
              () => buildMachineGunVoxels(teamColor, { facing, anim, frame }),
              { voxelW: 4, bounds: MACHINE_GUN_BAKE_BOUNDS }
            );
          }
        }
      }
      for (const facing of MORTAR_FACINGS) {
        for (const anim of MORTAR_ANIMS) {
          for (let frame = 0; frame < MORTAR_FRAME_COUNTS[anim]; frame++) {
            this.bakeIfMissing(
              GameScene.mortarTextureKey(p, facing, anim, frame),
              () => buildMortarVoxels(teamColor, { facing, anim, frame }),
              { voxelW: 4, bounds: MORTAR_BAKE_BOUNDS }
            );
          }
        }
      }
    }

    this.bakeIfMissing(GameScene.HOUSE_KEY, buildDarkHouseVoxels, { voxelW: 4 });
    this.bakeIfMissing(GameScene.FARM_KEY, buildDarkFarmVoxels, { voxelW: 4 });
    this.bakeIfMissing(GameScene.MILL_KEY, buildDarkMillVoxels, { voxelW: 4 });
    this.bakeIfMissing(GameScene.BARRACKS_KEY, buildDarkBarracksVoxels, { voxelW: 4 });
    this.bakeIfMissing(GameScene.ARCHERY_RANGE_KEY, buildDarkArcheryRangeVoxels, { voxelW: 4 });
    this.bakeIfMissing(GameScene.STABLE_KEY, buildDarkStableVoxels, { voxelW: 4 });
    this.bakeIfMissing(GameScene.LUMBER_CAMP_KEY, buildDarkLumberCampVoxels, { voxelW: 4 });
    this.bakeIfMissing(GameScene.GOLD_MINE_KEY, buildDarkGoldMineVoxels, { voxelW: 4 });
    this.bakeIfMissing(GameScene.STONE_QUARRY_KEY, buildDarkStoneQuarryVoxels, { voxelW: 4 });
    this.bakeIfMissing(GameScene.FOUNDRY_KEY, buildGunpowderFoundryVoxels, { voxelW: 4 });
    const wallBounds = { minX: -1, maxX: 17, minY: -1, maxY: 17, minZ: 0, maxZ: 11 };
    this.bakeIfMissing(GameScene.WALL_X_KEY, () => buildWallVoxels('x'), { voxelW: 4, bounds: wallBounds });
    this.bakeIfMissing(GameScene.WALL_Y_KEY, () => buildWallVoxels('y'), { voxelW: 4, bounds: wallBounds });

    this.bakeIfMissing(GameScene.TREE_KEY, buildTreeVoxels, { voxelW: 4 });
    this.bakeIfMissing(GameScene.SNOW_TREE_KEY, buildSnowTreeVoxels, { voxelW: 4 });
    this.bakeIfMissing(GameScene.DEAD_TREE_KEY, buildDeadTreeVoxels, { voxelW: 4 });
    this.bakeIfMissing(GameScene.LINDEN_TREE_KEY, buildLindenTreeVoxels, { voxelW: 4 });
    this.bakeIfMissing(GameScene.JAGGED_ROCK_KEY, buildJaggedRockVoxels, { voxelW: 4 });
    this.bakeIfMissing(GameScene.GOLD_KEY, buildGoldVoxels, { voxelW: 4 });
    this.bakeIfMissing(GameScene.STONE_KEY, buildStoneVoxels, { voxelW: 4 });
    this.bakeIfMissing(GameScene.BERRY_KEY, buildBerryVoxels, { voxelW: 4 });
  }

  private static scoutCavalryTextureKey(
    playerId: number,
    facing: ScoutCavalryFacing,
    anim: ScoutCavalryAnim,
    frame: number
  ): string {
    return `${GameScene.SCOUT_CAVALRY_KEY_PREFIX}${playerId}-${facing}-${anim}-${frame}`;
  }

  private static gunmanTextureKey(
    playerId: number,
    facing: GunmanFacing,
    anim: GunmanAnim,
    frame: number
  ): string {
    return `${GameScene.GUNMAN_KEY_PREFIX}${playerId}-${facing}-${anim}-${frame}`;
  }

  private static cannonTextureKey(
    playerId: number,
    facing: CannonFacing,
    anim: CannonAnim,
    frame: number
  ): string {
    return `${GameScene.CANNON_KEY_PREFIX}${playerId}-${facing}-${anim}-${frame}`;
  }

  private static machineGunTextureKey(
    playerId: number,
    facing: MachineGunFacing,
    anim: MachineGunAnim,
    frame: number
  ): string {
    return `${GameScene.MACHINE_GUN_KEY_PREFIX}${playerId}-${facing}-${anim}-${frame}`;
  }

  private static mortarTextureKey(
    playerId: number,
    facing: MortarFacing,
    anim: MortarAnim,
    frame: number
  ): string {
    return `${GameScene.MORTAR_KEY_PREFIX}${playerId}-${facing}-${anim}-${frame}`;
  }

  private static archerTextureKey(
    playerId: number,
    facing: ArcherFacing,
    anim: ArcherAnim,
    frame: number
  ): string {
    return `${GameScene.ARCHER_KEY_PREFIX}${playerId}-${facing}-${anim}-${frame}`;
  }

  private static spearmanTextureKey(
    playerId: number,
    facing: SpearmanFacing,
    anim: SpearmanAnim,
    frame: number
  ): string {
    return `${GameScene.SPEARMAN_KEY_PREFIX}${playerId}-${facing}-${anim}-${frame}`;
  }

  private static villagerTextureKey(
    playerId: number,
    facing: VillagerFacing,
    anim: VillagerAnim,
    frame: number
  ): string {
    return `${GameScene.VILLAGER_KEY_PREFIX}${playerId}-${facing}-${anim}-${frame}`;
  }

  private bakeIfMissing(
    key: string,
    builder: () => ReturnType<typeof buildDarkTcVoxels>,
    opts: { voxelW: number; bounds?: Parameters<typeof bakeVoxelTexture>[2]['bounds'] }
  ): void {
    if (this.textures.exists(key)) return;
    bakeVoxelTexture(this, builder(), {
      textureKey: key,
      voxelW: opts.voxelW,
      bounds: opts.bounds,
    });
  }

  /** Look up the texture key for a building defId. */
  private buildingTextureKey(defId: number, playerId: number): string | null {
    return this.buildingTextureKeyForAge(
      defId,
      playerId,
      this.world.ages[playerId]?.current ?? AgeId.DARK
    );
  }

  private buildingTextureKeyForEntity(eid: number, defId: number, playerId: number): string | null {
    if (defId === BuildingDefId.WALL) return this.wallTextureKeyForEntity(eid);
    return this.buildingTextureKey(defId, playerId);
  }

  private wallTextureKeyForEntity(eid: number): string {
    const x = Math.round(Position.x[eid]);
    const y = Math.round(Position.y[eid]);
    const xConnections =
      Number(this.hasWallConnectionAt(x - 1, y)) +
      Number(this.hasWallConnectionAt(x + 1, y));
    const yConnections =
      Number(this.hasWallConnectionAt(x, y - 1)) +
      Number(this.hasWallConnectionAt(x, y + 1));
    return xConnections >= yConnections
      ? GameScene.WALL_X_KEY
      : GameScene.WALL_Y_KEY;
  }

  private hasWallConnectionAt(x: number, y: number): boolean {
    for (const eid of buildingQuery(this.world.ecs)) {
      if (Health.hp[eid] <= 0) continue;
      if (Math.round(Position.x[eid]) !== x || Math.round(Position.y[eid]) !== y) continue;
      const defId = Building.defId[eid];
      return defId === BuildingDefId.WALL || defId === BuildingDefId.DEFENSIVE_TOWER;
    }
    return false;
  }

  private buildingTextureKeyForAge(
    defId: number,
    playerId: number,
    age: number
  ): string | null {
    switch (defId) {
      case BuildingDefId.TOWN_CENTER: {
        if (age >= AgeId.GUNPOWDER) return GameScene.GUNPOWDER_TC_KEY_PREFIX + playerId;
        return age >= AgeId.CASTLE
          ? GameScene.CASTLE_TC_KEY_PREFIX + playerId
          : GameScene.DARK_TC_KEY_PREFIX + playerId;
      }
      case BuildingDefId.HOUSE:
        return GameScene.HOUSE_KEY;
      case BuildingDefId.FARM:
        return GameScene.FARM_KEY;
      case BuildingDefId.MILL:
        return GameScene.MILL_KEY;
      case BuildingDefId.LUMBER_CAMP:
        return GameScene.LUMBER_CAMP_KEY;
      case BuildingDefId.GOLD_MINE:
        return GameScene.GOLD_MINE_KEY;
      case BuildingDefId.STONE_QUARRY:
        return GameScene.STONE_QUARRY_KEY;
      case BuildingDefId.BARRACKS:
        return GameScene.BARRACKS_KEY;
      case BuildingDefId.ARCHERY_RANGE:
        return GameScene.ARCHERY_RANGE_KEY;
      case BuildingDefId.STABLE:
        return GameScene.STABLE_KEY;
      case BuildingDefId.FOUNDRY:
        return GameScene.FOUNDRY_KEY;
      case BuildingDefId.DEFENSIVE_TOWER:
        return GameScene.DEFENSIVE_TOWER_KEY_PREFIX + playerId;
      case BuildingDefId.WALL:
        return GameScene.WALL_X_KEY;
      default:
        return null;
    }
  }

  private buildingSpriteOriginY(defId: number, playerId: number, ageOverride?: number): number {
    switch (defId) {
      case BuildingDefId.TOWN_CENTER: {
        const age = ageOverride ?? this.world.ages[playerId]?.current ?? AgeId.DARK;
        if (age >= AgeId.GUNPOWDER) return 0.705;
        return age >= AgeId.CASTLE ? 0.706 : 0.66;
      }
      case BuildingDefId.HOUSE:
        return 0.609;
      case BuildingDefId.FARM:
        return 0.59;
      case BuildingDefId.MILL:
        return 0.67;
      case BuildingDefId.LUMBER_CAMP:
        return 0.581;
      case BuildingDefId.GOLD_MINE:
        return 0.5;
      case BuildingDefId.STONE_QUARRY:
        return 0.514;
      case BuildingDefId.BARRACKS:
        return 0.596;
      case BuildingDefId.ARCHERY_RANGE:
        return 0.632;
      case BuildingDefId.STABLE:
        return 0.611;
      case BuildingDefId.FOUNDRY:
        return 0.61;
      case BuildingDefId.DEFENSIVE_TOWER:
        return 0.743;
      case BuildingDefId.WALL:
        return 0.67;
      default:
        return 0.66;
    }
  }

  /** Look up the texture key for a unit eid. */
  private unitTextureKey(eid: number, playerId: number): string | null {
    switch (UnitKind.kind[eid]) {
      case UnitDefId.VILLAGER:
        return this.villagerTextureKeyForUnit(eid, playerId);
      case UnitDefId.ARCHER:
        return this.archerTextureKeyForUnit(eid, playerId);
      case UnitDefId.SPEARMAN:
        return this.spearmanTextureKeyForUnit(eid, playerId);
      case UnitDefId.SCOUT_CAVALRY:
        return this.scoutCavalryTextureKeyForUnit(eid, playerId);
      case UnitDefId.GUNMAN:
        return this.gunmanTextureKeyForUnit(eid, playerId);
      case UnitDefId.CANNON:
        return this.cannonTextureKeyForUnit(eid, playerId);
      case UnitDefId.MACHINE_GUN:
        return this.machineGunTextureKeyForUnit(eid, playerId);
      case UnitDefId.MORTAR:
        return this.mortarTextureKeyForUnit(eid, playerId);
      default:
        return null;
    }
  }

  private unitSpriteOriginY(eid: number): number {
    const kind = UnitKind.kind[eid];
    if (kind === UnitDefId.SCOUT_CAVALRY || kind === UnitDefId.VILLAGER) return 0.73;
    if (kind === UnitDefId.ARCHER || kind === UnitDefId.SPEARMAN) return 0.7;
    if (kind === UnitDefId.GUNMAN) return 0.7;
    if (kind === UnitDefId.CANNON) return GameScene.CANNON_UNIT_ORIGIN_Y;
    if (kind === UnitDefId.MACHINE_GUN) return 0.69;
    if (kind === UnitDefId.MORTAR) return GameScene.MORTAR_UNIT_ORIGIN_Y;
    return 0.82;
  }

  private villagerTextureKeyForUnit(eid: number, playerId: number): string {
    const moving = this.isUnitMoving(eid);
    const facing = this.villagerFacingForUnit(eid, moving);
    const anim = this.villagerAnimForUnit(eid, moving);
    let frame = 0;
    if (anim === 'move' || anim === 'carry') {
      frame = Math.floor(this.world.tick / 6) % VILLAGER_FRAME_COUNTS[anim];
    } else if (anim === 'harvest' || anim === 'build') {
      frame = Math.floor(this.world.tick / 5) % VILLAGER_FRAME_COUNTS[anim];
    }
    return GameScene.villagerTextureKey(playerId, facing, anim, frame);
  }

  private villagerAnimForUnit(eid: number, moving: boolean): VillagerAnim {
    const carryAmt = hasComponent(this.world.ecs, ResourceCarry, eid)
      ? ResourceCarry.amount[eid]
      : 0;
    if (hasComponent(this.world.ecs, Gatherer, eid)) {
      const state = Gatherer.state[eid];
      if (state === GathererStateId.GATHERING) return 'harvest';
      if (state === GathererStateId.BUILDING) return 'build';
      if (moving && carryAmt > 0) return 'carry';
      if (state === GathererStateId.DEPOSITING && carryAmt > 0) return 'carry';
    }
    return moving ? 'move' : 'idle';
  }

  private villagerFacingForUnit(eid: number, moving: boolean): VillagerFacing {
    let dx = 0;
    let dy = 0;
    if (moving) {
      dx = Velocity.x[eid];
      dy = Velocity.y[eid];
    } else if (hasComponent(this.world.ecs, Gatherer, eid)) {
      const gatherTarget = Gatherer.targetEid[eid];
      if (gatherTarget >= 0 && hasComponent(this.world.ecs, Position, gatherTarget)) {
        dx = Position.x[gatherTarget] - Position.x[eid];
        dy = Position.y[gatherTarget] - Position.y[eid];
      }
    }
    if (
      Math.hypot(dx, dy) <= 0.01 &&
      hasComponent(this.world.ecs, BuildOrder, eid) &&
      BuildOrder.targetEid[eid] >= 0 &&
      hasComponent(this.world.ecs, Position, BuildOrder.targetEid[eid])
    ) {
      const target = BuildOrder.targetEid[eid];
      dx = Position.x[target] - Position.x[eid];
      dy = Position.y[target] - Position.y[eid];
    }
    if (Math.hypot(dx, dy) > 0.01) {
      const facing = facingFromVector(dx, dy) as VillagerFacing;
      this.villagerFacing.set(eid, facing);
      return facing;
    }
    return this.villagerFacing.get(eid) ?? 'SE';
  }

  private scoutCavalryTextureKeyForUnit(eid: number, playerId: number): string {
    const moving = this.isUnitMoving(eid);
    const facing = this.scoutCavalryFacingForUnit(eid, moving);
    const attackUntil = this.unitAttackUntilTick.get(eid) ?? -1;
    const anim: ScoutCavalryAnim =
      attackUntil > this.world.tick ? 'attack' : moving ? 'move' : 'idle';
    let frame = 0;
    if (anim === 'move') {
      frame = Math.floor(this.world.tick / 5) % SCOUT_CAVALRY_FRAME_COUNTS.move;
    } else if (anim === 'attack') {
      const age = GameScene.COMBAT_ATTACK_ANIM_TICKS - (attackUntil - this.world.tick);
      frame = age < GameScene.COMBAT_ATTACK_ANIM_TICKS / 2 ? 0 : 1;
    }
    return GameScene.scoutCavalryTextureKey(playerId, facing, anim, frame);
  }

  private archerTextureKeyForUnit(eid: number, playerId: number): string {
    const moving = this.isUnitMoving(eid);
    const facing = this.archerFacingForUnit(eid, moving);
    const attackUntil = this.unitAttackUntilTick.get(eid) ?? -1;
    const anim: ArcherAnim = attackUntil > this.world.tick ? 'attack' : moving ? 'move' : 'idle';
    let frame = 0;
    if (anim === 'move') {
      frame = Math.floor(this.world.tick / 6) % ARCHER_FRAME_COUNTS.move;
    } else if (anim === 'attack') {
      const age = GameScene.COMBAT_ATTACK_ANIM_TICKS - (attackUntil - this.world.tick);
      frame = age < GameScene.COMBAT_ATTACK_ANIM_TICKS / 2 ? 0 : 1;
    }
    return GameScene.archerTextureKey(playerId, facing, anim, frame);
  }

  private spearmanTextureKeyForUnit(eid: number, playerId: number): string {
    const moving = this.isUnitMoving(eid);
    const facing = this.spearmanFacingForUnit(eid, moving);
    const attackUntil = this.unitAttackUntilTick.get(eid) ?? -1;
    const anim: SpearmanAnim = attackUntil > this.world.tick ? 'attack' : moving ? 'move' : 'idle';
    let frame = 0;
    if (anim === 'move') {
      frame = Math.floor(this.world.tick / 6) % SPEARMAN_FRAME_COUNTS.move;
    } else if (anim === 'attack') {
      const age = GameScene.COMBAT_ATTACK_ANIM_TICKS - (attackUntil - this.world.tick);
      frame = age < GameScene.COMBAT_ATTACK_ANIM_TICKS / 2 ? 0 : 1;
    }
    return GameScene.spearmanTextureKey(playerId, facing, anim, frame);
  }

  private gunmanTextureKeyForUnit(eid: number, playerId: number): string {
    const moving = this.isUnitMoving(eid);
    const facing = this.gunmanFacingForUnit(eid, moving);
    const attackUntil = this.unitAttackUntilTick.get(eid) ?? -1;
    const anim: GunmanAnim = attackUntil > this.world.tick ? 'attack' : moving ? 'move' : 'idle';
    let frame = 0;
    if (anim === 'move') {
      frame = Math.floor(this.world.tick / 6) % GUNMAN_FRAME_COUNTS.move;
    } else if (anim === 'attack') {
      const age = GameScene.COMBAT_ATTACK_ANIM_TICKS - (attackUntil - this.world.tick);
      frame = age < GameScene.COMBAT_ATTACK_ANIM_TICKS / 2 ? 0 : 1;
    }
    return GameScene.gunmanTextureKey(playerId, facing, anim, frame);
  }

  private cannonTextureKeyForUnit(eid: number, playerId: number): string {
    const moving = this.isUnitMoving(eid);
    const facing = this.cannonFacingForUnit(eid, moving);
    const attackUntil = this.unitAttackUntilTick.get(eid) ?? -1;
    const anim: CannonAnim = attackUntil > this.world.tick ? 'attack' : moving ? 'move' : 'idle';
    let frame = 0;
    if (anim === 'move') {
      frame = Math.floor(this.world.tick / 8) % CANNON_FRAME_COUNTS.move;
    } else if (anim === 'attack') {
      const age = GameScene.COMBAT_ATTACK_ANIM_TICKS - (attackUntil - this.world.tick);
      frame = age < GameScene.COMBAT_ATTACK_ANIM_TICKS / 2 ? 0 : 1;
    }
    return GameScene.cannonTextureKey(playerId, facing, anim, frame);
  }

  private machineGunTextureKeyForUnit(eid: number, playerId: number): string {
    const moving = this.isUnitMoving(eid);
    const facing = this.machineGunFacingForUnit(eid, moving);
    const attackUntil = this.unitAttackUntilTick.get(eid) ?? -1;
    const anim: MachineGunAnim = attackUntil > this.world.tick ? 'attack' : moving ? 'move' : 'idle';
    let frame = 0;
    if (anim === 'move') {
      frame = Math.floor(this.world.tick / 7) % MACHINE_GUN_FRAME_COUNTS.move;
    } else if (anim === 'attack') {
      const age = GameScene.COMBAT_ATTACK_ANIM_TICKS - (attackUntil - this.world.tick);
      frame = Math.min(
        MACHINE_GUN_FRAME_COUNTS.attack - 1,
        Math.floor(age / Math.max(1, GameScene.COMBAT_ATTACK_ANIM_TICKS / MACHINE_GUN_FRAME_COUNTS.attack))
      );
    }
    return GameScene.machineGunTextureKey(playerId, facing, anim, frame);
  }

  private mortarTextureKeyForUnit(eid: number, playerId: number): string {
    const moving = this.isUnitMoving(eid);
    const facing = this.mortarFacingForUnit(eid, moving);
    const attackUntil = this.unitAttackUntilTick.get(eid) ?? -1;
    const anim: MortarAnim = attackUntil > this.world.tick ? 'attack' : moving ? 'move' : 'idle';
    let frame = 0;
    if (anim === 'move') {
      frame = Math.floor(this.world.tick / 8) % MORTAR_FRAME_COUNTS.move;
    } else if (anim === 'attack') {
      const age = GameScene.COMBAT_ATTACK_ANIM_TICKS - (attackUntil - this.world.tick);
      frame = Math.min(
        MORTAR_FRAME_COUNTS.attack - 1,
        Math.floor(age / Math.max(1, GameScene.COMBAT_ATTACK_ANIM_TICKS / MORTAR_FRAME_COUNTS.attack))
      );
    }
    return GameScene.mortarTextureKey(playerId, facing, anim, frame);
  }

  private isUnitMoving(eid: number): boolean {
    if (!hasComponent(this.world.ecs, Velocity, eid)) return false;
    return Math.hypot(Velocity.x[eid], Velocity.y[eid]) > 0.05;
  }

  private scoutCavalryFacingForUnit(eid: number, moving: boolean): ScoutCavalryFacing {
    const facing = this.combatFacingForUnit(eid, moving, this.scoutFacing);
    return facing as ScoutCavalryFacing;
  }

  private archerFacingForUnit(eid: number, moving: boolean): ArcherFacing {
    const facing = this.combatFacingForUnit(eid, moving, this.archerFacing);
    return facing as ArcherFacing;
  }

  private spearmanFacingForUnit(eid: number, moving: boolean): SpearmanFacing {
    const facing = this.combatFacingForUnit(eid, moving, this.spearmanFacing);
    return facing as SpearmanFacing;
  }

  private gunmanFacingForUnit(eid: number, moving: boolean): GunmanFacing {
    const facing = this.combatFacingForUnit(eid, moving, this.gunmanFacing);
    return facing as GunmanFacing;
  }

  private cannonFacingForUnit(eid: number, moving: boolean): CannonFacing {
    const facing = this.combatFacingForUnit(eid, moving, this.cannonFacing);
    return facing as CannonFacing;
  }

  private machineGunFacingForUnit(eid: number, moving: boolean): MachineGunFacing {
    const facing = this.combatFacingForUnit(eid, moving, this.machineGunFacing);
    return facing as MachineGunFacing;
  }

  private mortarFacingForUnit(eid: number, moving: boolean): MortarFacing {
    const facing = this.combatFacingForUnit(eid, moving, this.mortarFacing);
    return facing as MortarFacing;
  }

  private combatFacingForUnit<TFacing extends ScoutCavalryFacing>(
    eid: number,
    moving: boolean,
    cache: Map<number, TFacing>
  ): TFacing {
    let dx = 0;
    let dy = 0;
    if (moving) {
      dx = Velocity.x[eid];
      dy = Velocity.y[eid];
    } else if (
      hasComponent(this.world.ecs, AttackTarget, eid) &&
      AttackTarget.targetEid[eid] >= 0
    ) {
      const target = AttackTarget.targetEid[eid];
      if (hasComponent(this.world.ecs, Position, target)) {
        dx = Position.x[target] - Position.x[eid];
        dy = Position.y[target] - Position.y[eid];
      }
    }
    if (Math.hypot(dx, dy) > 0.01) {
      const facing = facingFromVector(dx, dy) as TFacing;
      cache.set(eid, facing);
      return facing;
    }
    return cache.get(eid) ?? ('SE' as TFacing);
  }

  private entityKindName(eid: number): string {
    if (hasComponent(this.world.ecs, VillagerTag, eid)) return 'villager';
    if (hasComponent(this.world.ecs, ArcherTag, eid)) return 'archer';
    if (hasComponent(this.world.ecs, SpearmanTag, eid)) return 'spearman';
    if (hasComponent(this.world.ecs, ScoutCavalryTag, eid)) return 'scout cavalry';
    if (hasComponent(this.world.ecs, GunmanTag, eid)) return 'gunman';
    if (hasComponent(this.world.ecs, CannonTag, eid)) return 'field cannon';
    if (hasComponent(this.world.ecs, MachineGunTag, eid)) return 'machine gun';
    if (hasComponent(this.world.ecs, MortarTag, eid)) return 'mortar team';
    if (hasComponent(this.world.ecs, TownCenterTag, eid)) return 'TC';
    if (hasComponent(this.world.ecs, Building, eid)) {
      const def = BUILDING_TABLE[Building.defId[eid]];
      return def?.name.toLowerCase() ?? 'building';
    }
    return 'entity';
  }

  private resourceKindName(kind: number): string {
    switch (kind) {
      case ResourceKindId.FOOD:
        return 'food';
      case ResourceKindId.WOOD:
        return 'wood';
      case ResourceKindId.GOLD:
        return 'gold';
      case ResourceKindId.STONE:
        return 'stone';
      default:
        return 'resource';
    }
  }

  private formatRange(range: number): string {
    return Number.isInteger(range) ? String(range) : range.toFixed(1);
  }

  private hasNearbyResource(x: number, y: number, kind: number, radius: number): boolean {
    for (const eid of resourceQuery(this.world.ecs)) {
      if (Resource.kind[eid] !== kind) continue;
      if (Resource.amount[eid] <= 0) continue;
      if (Math.hypot(Position.x[eid] - x, Position.y[eid] - y) <= radius) return true;
    }
    return false;
  }

  /** Look up the texture key for a resource kind. */
  private resourceTextureKey(eid: number, kind: number): string | null {
    switch (kind) {
      case ResourceKindId.WOOD:
        if (this.world.campaign?.missionId === CampaignMissionId.BATTLE_OF_ZBOROV) {
          return GameScene.DEAD_TREE_KEY;
        }
        return this.isSnowResourceTile(eid)
          ? GameScene.SNOW_TREE_KEY
          : GameScene.TREE_KEY;
      case ResourceKindId.GOLD: return GameScene.GOLD_KEY;
      case ResourceKindId.STONE: return GameScene.STONE_KEY;
      case ResourceKindId.FOOD: return GameScene.BERRY_KEY;
      default: return null;
    }
  }

  private isSnowResourceTile(eid: number): boolean {
    const x = Math.round(Position.x[eid]);
    const y = Math.round(Position.y[eid]);
    if (x < 0 || y < 0 || x >= MAP.WIDTH || y >= MAP.HEIGHT) return false;
    const tile = this.world.map.tiles[y * MAP.WIDTH + x];
    return tile === TileType.SNOW
      || tile === TileType.SNOW_FOREST
      || tile === TileType.PACKED_SNOW
      || tile === TileType.ICE;
  }

  private mapFeatureTextureKey(kind: MapFeatureKindValue): string | null {
    switch (kind) {
      case MapFeatureKind.ROCK_SPIRE: return GameScene.JAGGED_ROCK_KEY;
      case MapFeatureKind.LINDEN_TREE: return GameScene.LINDEN_TREE_KEY;
      default: return null;
    }
  }

  private mapFeatureSize(feature: MapFeature): number {
    return feature.kind === MapFeatureKind.ROCK_SPIRE ? Math.max(2, feature.size ?? 2) : 1;
  }

  private mapFeatureScreenPosition(feature: MapFeature): { x: number; y: number } {
    if (feature.kind !== MapFeatureKind.ROCK_SPIRE) {
      return this.tileToScreenElev(feature.x, feature.y);
    }
    const size = this.mapFeatureSize(feature);
    return this.tileToScreenElev(feature.x + (size - 1) / 2, feature.y + (size - 1) / 2);
  }

  private isMapFeatureExploredByLocal(feature: MapFeature): boolean {
    if (feature.kind !== MapFeatureKind.ROCK_SPIRE) {
      return isTileExploredBy(this.world, this.perspectivePlayerId, feature.x, feature.y);
    }
    const size = this.mapFeatureSize(feature);
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        if (isTileExploredBy(this.world, this.perspectivePlayerId, feature.x + dx, feature.y + dy)) {
          return true;
        }
      }
    }
    return false;
  }
}

function facingFromVector(dx: number, dy: number): ScoutCavalryFacing {
  const angle = Math.atan2(dy, dx);
  const normalized = angle < 0 ? angle + Math.PI * 2 : angle;
  const index = Math.round(normalized / (Math.PI / 4)) % SCOUT_CAVALRY_FACINGS.length;
  return SCOUT_CAVALRY_FACINGS[index];
}

/** Local mirror of findBuildingAt so render doesn't pull a sim helper unnecessarily. */
function findBuildingAtRender(
  world: SimWorld,
  x: number,
  y: number,
  radius: number
): number | null {
  const ents = buildingQuery(world.ecs);
  let best: number | null = null;
  let bestDist = radius;
  for (const eid of ents) {
    const d = distToBuildingFootprintRender(x, y, eid);
    if (d < bestDist) {
      bestDist = d;
      best = eid;
    }
  }
  return best;
}

function distToBuildingFootprintRender(
  x: number,
  y: number,
  eid: number
): number {
  const def = BUILDING_TABLE[Building.defId[eid]];
  if (!def) return Math.hypot(Position.x[eid] - x, Position.y[eid] - y);
  const x0 = Math.round(Position.x[eid]) - Math.floor(def.footprint.w / 2);
  const y0 = Math.round(Position.y[eid]) - Math.floor(def.footprint.h / 2);
  const minX = x0 - 0.5;
  const maxX = x0 + def.footprint.w - 0.5;
  const minY = y0 - 0.5;
  const maxY = y0 + def.footprint.h - 0.5;
  const dx = x < minX ? minX - x : x > maxX ? x - maxX : 0;
  const dy = y < minY ? minY - y : y > maxY ? y - maxY : 0;
  return Math.hypot(dx, dy);
}
