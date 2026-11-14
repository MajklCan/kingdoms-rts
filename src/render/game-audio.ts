/**
 * Game-side audio direction on top of AudioManager: match lifecycle (menu,
 * match, paused, match over), the adaptive music mood, camera-relative world
 * SFX (pan + distance + fog), the off-screen "under attack" alarm, and unit
 * voice barks.
 */

import { hasComponent } from 'bitecs';
import { SIM } from '../config';
import {
  ArcherTag,
  Building,
  CannonTag,
  GunmanTag,
  Health,
  MachineGunTag,
  MortarTag,
  Owner,
  Position,
  ResourceKindId,
  ResourceWorksite,
  ScoutCavalryTag,
  SpearmanTag,
  TownCenterTag,
  UnitKind,
  VillagerTag,
  WorksiteWorker,
} from '@sim/components';
import { buildingQuery, selectedQuery, type CombatEvent, type GameEvent, type SoundCue } from '@sim/world';
import { AudioManager, type BarkResult } from './audio/audio-manager';
import { installAudioDebug } from './audio/audio-debug';
import { MusicDirector } from './audio/music-director';
import {
  ALERT,
  BATTLE_AMBIENCE,
  COMMAND_MOVE,
  NATURE_AMBIENCE,
  UNIT_SELECT,
  VOICE_LINE_COUNTS,
  combatSound,
  cueSound,
  isNonSpatialCue,
  isNotificationCue,
  type SfxConfig,
  type VoiceBarkType,
  type VoiceCategory,
} from './audio/sound-map';
import { SPATIAL_CULL_GAIN, isInView, spatialMix, type ViewRect } from './audio/spatial';
import { tileToScreen } from './iso';
import type { SceneContext } from './scene-context';

type Phase = 'menu' | 'match' | 'over';

/** Minimum gap between "under attack" alarms. */
const ALERT_COOLDOWN_TICKS = SIM.TICK_HZ * 15;
/** Camera-to-town-centre distance (world px) that counts as "at home". */
const HOME_RADIUS_PX = 260;
/** Off-screen notifications (building done, unit ready) keep this level. */
const NOTIFICATION_FLOOR = 0.45;
/** Research done: the build-complete chime, a little softer. */
const RESEARCH_CHIME = { key: 'build_complete', volume: 0.45, minIntervalMs: 250 } as const;

export class GameAudio {
  readonly manager: AudioManager;
  private readonly director = new MusicDirector({ tickHz: SIM.TICK_HZ });
  private phase: Phase = 'menu';
  /** Tick the last "under attack" alarm fired; -1 = never. */
  private lastAlertTick = -1;
  private readonly cueListeners: Array<(cue: SoundCue) => void> = [];
  /** Game events already heard (the HUD feed drains them after this peek). */
  private readonly heardEvents = new WeakSet<GameEvent>();

  constructor(private readonly ctx: SceneContext) {
    this.manager = new AudioManager(ctx.scene);
    if (import.meta.env.DEV) installAudioDebug(this.manager, () => this.debugState());
  }

  /** A match (new, loaded or multiplayer) starts: menu music hands over. */
  enterMatch(): void {
    this.phase = 'match';
    this.director.reset(this.ctx.world.tick);
    this.lastAlertTick = -1;
    this.manager.setWorldSilenced(false);
    this.manager.setGamePaused(false);
    this.manager.setAmbience(NATURE_AMBIENCE, 3);
    this.manager.playPeaceMusic({ fadeOut: 2.5, delay: 1 });
  }

  /** Back to the title screens: world audio off, menu music. */
  leaveMatch(): void {
    this.phase = 'menu';
    this.manager.setGamePaused(false);
    this.manager.setWorldSilenced(true);
    this.manager.setAmbience(null, 1.5);
    this.manager.playMenuMusic({ fadeOut: 1.5, delay: 0.5 });
  }

  /** Per frame: lifecycle + music mood. */
  update(): void {
    this.manager.update();
    if (this.phase !== 'match') return;
    const world = this.ctx.world;
    if (world.outcome.state === 'victory') {
      this.matchOver(world.outcome.winnerPlayerId === this.ctx.perspectivePlayerId);
      return;
    }
    this.manager.setGamePaused(world.paused);
    this.peekGameEvents();
    if (world.paused) return;
    const state = this.director.update(world.tick, this.cameraNearHomeBase());
    this.manager.setPeaceFlavor(state.flavor);
    if (state.mood === 'battle') {
      this.manager.playBattleMusic({ fadeOut: 2.5, delay: 0 });
      this.manager.setAmbience(BATTLE_AMBIENCE, 3);
    } else {
      // Leaving a battle: the score fades, a breath of ambience, then a song.
      this.manager.playPeaceMusic(state.changed ? { fadeOut: 4, delay: 6 } : { fadeOut: 2.5, delay: 1 });
      this.manager.setAmbience(NATURE_AMBIENCE, 4);
    }
  }

  /** Fire sound (fog-gated) + music intensity / alarm bookkeeping. */
  onCombatEvent(event: CombatEvent): void {
    if (this.phase !== 'match') return;
    this.playCombatSound(event);
    this.noteCombat(event);
  }

  /** Extra render-side consumer of every drained sound cue (world VFX). */
  onCue(listener: (cue: SoundCue) => void): void {
    this.cueListeners.push(listener);
  }

  /** World-positioned SFX for render-only triggers (construction knocks). */
  playWorld(cfg: SfxConfig, tileX: number, tileY: number): void {
    if (!this.ctx.isTileVisible(tileX, tileY)) return;
    this.playSpatial(cfg, tileX, tileY);
  }

  /** Drain sim sound cues. Fog-gated; non-spatial cues only for the local player. */
  consumeSoundCues(): void {
    const world = this.ctx.world;
    if (world.soundCues.length === 0) return;
    const cues = world.soundCues.splice(0);
    for (const cue of cues) {
      for (const listener of this.cueListeners) listener(cue);
      const cfg = cueSound(cue.kind);
      const own = cue.player === this.ctx.perspectivePlayerId;
      if (isNonSpatialCue(cue.kind)) {
        if (own) this.manager.play(cfg.key, { volume: cfg.volume, minIntervalMs: cfg.minIntervalMs });
        continue;
      }
      if (!own && !this.ctx.isTileVisible(cue.x, cue.y)) continue;
      this.playSpatial(cfg, cue.x, cue.y, own && isNotificationCue(cue.kind) ? NOTIFICATION_FLOOR : 0);
    }
  }

  /** Non-spatial UI / command sound. */
  playUi(cfg: SfxConfig): void {
    this.manager.play(cfg.key, { volume: cfg.volume, minIntervalMs: cfg.minIntervalMs });
  }

  /** Voice line for a selected unit; a blip only when it has no voice. */
  barkSelect(eid: number): void {
    if (this.playUnitBark(eid, 'select') === 'none') this.playUi(UNIT_SELECT);
  }

  /** "On our way"; the order blip when no line plays, so every order is heard. */
  barkMove(): void {
    const eid = this.representativeSelectedUnit();
    if (eid === null) return;
    if (this.playUnitBark(eid, 'move') !== 'played') this.playUi(COMMAND_MOVE);
  }

  /** Battle cry; the order blip when no line plays. */
  barkAttack(): void {
    const eid = this.representativeSelectedUnit();
    if (eid === null) return;
    if (this.playUnitBark(eid, 'attack') !== 'played') this.playUi(COMMAND_MOVE);
  }

  /** First perspective-owned unit in the selection (the one that "speaks"). */
  representativeSelectedUnit(): number | null {
    const world = this.ctx.world;
    for (const eid of selectedQuery(world.ecs)) {
      if (Owner.player[eid] === this.ctx.perspectivePlayerId && hasComponent(world.ecs, UnitKind, eid)) {
        return eid;
      }
    }
    return null;
  }

  /** Sounds for HUD events that have no sim sound cue (research done). Reads
   *  world.gameEvents without draining: the HUD feed owns that queue. */
  private peekGameEvents(): void {
    const me = this.ctx.perspectivePlayerId;
    for (const event of this.ctx.world.gameEvents) {
      if (this.heardEvents.has(event)) continue;
      this.heardEvents.add(event);
      if (event.kind === 'researchCompleted' && event.playerId === me) {
        this.manager.play(RESEARCH_CHIME.key, { volume: RESEARCH_CHIME.volume, minIntervalMs: RESEARCH_CHIME.minIntervalMs });
      }
    }
  }

  private matchOver(won: boolean): void {
    this.phase = 'over';
    this.manager.setGamePaused(false);
    this.manager.setWorldSilenced(true);
    this.manager.setAmbience(null, 4);
    // Score fades over 3 s, the fanfare (victory) lands, then the menu theme.
    this.manager.playMenuMusic({ fadeOut: 3, delay: won ? 5 : 4 });
    if (won) this.manager.play('age_up', { volume: 0.8, ui: true });
  }

  private debugState(): Record<string, unknown> {
    const tick = this.ctx.world.tick;
    return {
      phase: this.phase,
      tick,
      mood: this.director.currentMood,
      intensity: Math.round(this.director.intensityAt(tick) * 10) / 10,
      moodChanges: [...this.director.transitions],
      lastAlertTick: this.lastAlertTick,
    };
  }

  private view(): ViewRect {
    const v = this.ctx.scene.cameras.main.worldView;
    return { centerX: v.centerX, centerY: v.centerY, width: v.width, height: v.height };
  }

  private worldPoint(tileX: number, tileY: number): { x: number; y: number } {
    return this.ctx.localToWorld(tileToScreen(tileX, tileY));
  }

  private cameraNearHomeBase(): boolean {
    const tc = this.localTownCenterPos();
    if (!tc) return false;
    const p = this.worldPoint(tc.x, tc.y);
    const v = this.view();
    return Math.hypot(p.x - v.centerX, p.y - v.centerY) <= HOME_RADIUS_PX;
  }

  private localTownCenterPos(): { x: number; y: number } | null {
    const world = this.ctx.world;
    for (const eid of buildingQuery(world.ecs)) {
      if (Owner.player[eid] !== this.ctx.perspectivePlayerId) continue;
      if (!hasComponent(world.ecs, TownCenterTag, eid)) continue;
      if (hasComponent(world.ecs, Health, eid) && Health.hp[eid] <= 0) continue;
      return { x: Position.x[eid], y: Position.y[eid] };
    }
    return null;
  }

  private playCombatSound(event: CombatEvent): void {
    const isBuildingAttacker = hasComponent(this.ctx.world.ecs, Building, event.attackerEid);
    const cfg = combatSound(event.attackerKind, event.range, event.phase, isBuildingAttacker);
    if (!cfg) return;
    const fromVisible = this.ctx.isTileVisible(event.fromX, event.fromY);
    const toVisible = this.ctx.isTileVisible(event.toX, event.toY);
    if (!fromVisible && !toVisible) return;
    // Melee sounds at the target; a shot at the shooter, unless the shooter is
    // hidden in fog (then at the target, so the sound gives nothing away).
    const atTarget = event.range <= 1 || !fromVisible;
    this.playSpatial(cfg, atTarget ? event.toX : event.fromX, atTarget ? event.toY : event.fromY);
  }

  private noteCombat(event: CombatEvent): void {
    if (event.phase === 'windup') return;
    const me = this.ctx.perspectivePlayerId;
    const attacker = this.ctx.ownerOf(event.attackerEid);
    const target = this.ctx.ownerOf(event.targetEid);
    const tick = this.ctx.world.tick;
    if (attacker === me || target === me) this.director.noteCombat(tick);
    if (target !== me) return;
    // The alarm is for fights the player cannot see.
    const p = this.worldPoint(event.toX, event.toY);
    if (isInView(p.x, p.y, this.view(), 48)) return;
    if (this.lastAlertTick >= 0 && tick - this.lastAlertTick < ALERT_COOLDOWN_TICKS) return;
    this.lastAlertTick = tick;
    this.manager.play(ALERT.key, { volume: ALERT.volume, minIntervalMs: ALERT.minIntervalMs });
  }

  /** World-positioned sound: stereo pan + distance falloff from the camera. */
  private playSpatial(cfg: SfxConfig, tileX: number, tileY: number, floor = 0): void {
    const p = this.worldPoint(tileX, tileY);
    const mix = spatialMix(p.x, p.y, this.view(), { floor });
    if (mix.gain < SPATIAL_CULL_GAIN) return;
    this.manager.play(cfg.key, { pan: mix.pan, volume: cfg.volume * mix.gain, minIntervalMs: cfg.minIntervalMs });
  }

  /** Voice persona: villagers by gender (farm -> female), soldiers by kind. */
  private voiceCategoryForUnit(eid: number): VoiceCategory | null {
    const ecs = this.ctx.world.ecs;
    if (hasComponent(ecs, VillagerTag, eid)) {
      return this.isFarmWorker(eid) ? 'villager_female' : 'villager_male';
    }
    if (hasComponent(ecs, SpearmanTag, eid)) return 'soldier_1';
    if (hasComponent(ecs, ArcherTag, eid)) return 'soldier_2';
    if (hasComponent(ecs, ScoutCavalryTag, eid)) return 'soldier_3';
    if (hasComponent(ecs, GunmanTag, eid)) return 'soldier_1';
    if (hasComponent(ecs, CannonTag, eid)) return 'soldier_2';
    if (hasComponent(ecs, MachineGunTag, eid)) return 'soldier_3';
    // Mortar teams are siege crews: no callouts.
    if (hasComponent(ecs, MortarTag, eid)) return null;
    return null;
  }

  private isFarmWorker(eid: number): boolean {
    const ecs = this.ctx.world.ecs;
    if (!hasComponent(ecs, WorksiteWorker, eid)) return false;
    const site = WorksiteWorker.siteEid[eid];
    return site >= 0 &&
      hasComponent(ecs, ResourceWorksite, site) &&
      ResourceWorksite.kind[site] === ResourceKindId.FOOD;
  }

  private playUnitBark(eid: number, type: VoiceBarkType): BarkResult {
    const category = this.voiceCategoryForUnit(eid);
    if (!category) return 'none';
    return this.manager.playVoiceBark(category, type, VOICE_LINE_COUNTS[type]);
  }
}
