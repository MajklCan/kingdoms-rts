/**
 * Game-side audio direction on top of AudioManager: the adaptive in-match
 * music director, world-positioned SFX (stereo pan + falloff from the camera),
 * sim sound cues, combat sounds + "under attack" stinger, and unit voice barks.
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
import { buildingQuery, selectedQuery, unitQuery, type CombatEvent, type SoundCue } from '@sim/world';
import { AudioManager } from './audio/audio-manager';
import {
  ALERT,
  BATTLE_AMBIENCE,
  BATTLE_TRACKS,
  COMMAND_MOVE,
  NATURE_AMBIENCE,
  UNIT_SELECT,
  VILLAGE_MUSIC,
  VOICE_LINE_COUNTS,
  combatSound,
  cueSound,
  isNonSpatialCue,
  type SfxConfig,
  type VoiceBarkType,
  type VoiceCategory,
} from './audio/sound-map';
import { tileToScreen } from './iso';
import type { SceneContext } from './scene-context';

type MusicContext = 'playlist' | 'village' | 'battle';

/** How long battle music/ambience persist after the last local combat event. */
const BATTLE_HOLD_TICKS = SIM.TICK_HZ * 15;
/** Minimum dwell in village/playlist before switching to the other (anti-flap). */
const CONTEXT_MIN_DWELL_TICKS = SIM.TICK_HZ * 10;
/** Minimum gap between "under attack" alert stingers. */
const ALERT_COOLDOWN_TICKS = SIM.TICK_HZ * 10;
/** Max stereo pan for world SFX, so off-screen sounds never hard-pan to one ear. */
const MAX_SPATIAL_PAN = 0.6;
/** Camera dwell on the home base (while safe) before the village theme starts. */
const VILLAGE_LINGER_TICKS = SIM.TICK_HZ * 6;
/** Grace window where the base still counts as "home" after panning away. */
const HOME_LEAVE_GRACE_TICKS = SIM.TICK_HZ * 2;
/** Camera-to-town-centre distance (world px) that counts as "at home". */
const HOME_RADIUS_PX = 260;

export class GameAudio {
  readonly manager: AudioManager;
  /** Tick of the latest combat event involving the local player; -1 = never. */
  private lastLocalCombatTick = -1;
  /** Tick the last "under attack" alert fired. */
  private lastAlertTick = -1;
  /** True once a match is running (drives the music director). */
  private inMatch = false;
  private villageEnteredTick = -1;
  private lastHomeTick = -1;
  /** Battle track for the current combat episode; re-picked each episode. */
  private battleTrack: string | null = null;
  private musicContext: MusicContext = 'playlist';
  private contextSinceTick = -1;
  private readonly cueListeners: Array<(cue: SoundCue) => void> = [];

  constructor(private readonly ctx: SceneContext) {
    this.manager = new AudioManager(ctx.scene);
  }

  /** Hand music from the menu to the in-game director, resetting every
   *  adaptive timer so a new/loaded match never inherits stale state. */
  enterMatch(): void {
    this.inMatch = true;
    this.villageEnteredTick = -1;
    this.lastHomeTick = -1;
    this.lastLocalCombatTick = -1;
    this.lastAlertTick = -1;
    this.musicContext = 'playlist';
    this.contextSinceTick = -1;
    this.battleTrack = null;
    this.manager.playGamePlaylist();
  }

  /** Back to the title screens: stop the in-game director, play menu music. */
  leaveMatch(): void {
    this.inMatch = false;
    this.manager.stopAmbience();
    this.manager.playMenuMusic();
  }

  /** Per-frame music director: combat > lingering at home > playlist. */
  update(): void {
    if (!this.inMatch) return;
    const tick = this.ctx.world.tick;
    const recentCombat =
      this.lastLocalCombatTick >= 0 && tick - this.lastLocalCombatTick < BATTLE_HOLD_TICKS;
    const recentlyAttacked =
      this.lastAlertTick >= 0 && tick - this.lastAlertTick < BATTLE_HOLD_TICKS;
    // Stay in battle only while there's a live reason: an army in the field or
    // the base under recent attack. A wiped army lets the score wind down.
    const danger = recentCombat && (recentlyAttacked || this.localHasLivingMilitary());

    this.manager.playAmbience(danger ? BATTLE_AMBIENCE : NATURE_AMBIENCE);

    let desired: MusicContext;
    if (danger) {
      desired = 'battle';
      this.villageEnteredTick = -1;
    } else {
      const rawHome = this.cameraNearHomeBase();
      if (rawHome) this.lastHomeTick = tick;
      const atHome =
        rawHome || (this.lastHomeTick >= 0 && tick - this.lastHomeTick < HOME_LEAVE_GRACE_TICKS);
      if (atHome) {
        if (this.villageEnteredTick < 0) this.villageEnteredTick = tick;
        desired = tick - this.villageEnteredTick >= VILLAGE_LINGER_TICKS ? 'village' : 'playlist';
      } else {
        this.villageEnteredTick = -1;
        desired = 'playlist';
      }
    }
    this.applyMusicContext(desired);
  }

  /** Fire sound (fog-gated) + adaptive music / alert bookkeeping for one event. */
  onCombatEvent(event: CombatEvent): void {
    this.playCombatSound(event);
    this.noteCombatForAdaptiveAudio(event);
  }

  /** Extra render-side consumer of every drained sound cue (world VFX). */
  onCue(listener: (cue: SoundCue) => void): void {
    this.cueListeners.push(listener);
  }

  /**
   * World-positioned SFX for render-only triggers (construction knocks,
   * collapse rumble), with the same fog gate, pan, falloff and rate limit as
   * sim cues.
   */
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
      if (isNonSpatialCue(cue.kind)) {
        if (cue.player === this.ctx.perspectivePlayerId) {
          this.manager.play(cfg.key, { volume: cfg.volume, minIntervalMs: cfg.minIntervalMs });
        }
        continue;
      }
      if (cue.player !== this.ctx.perspectivePlayerId && !this.ctx.isTileVisible(cue.x, cue.y)) {
        continue;
      }
      this.playSpatial(cfg, cue.x, cue.y);
    }
  }

  /** Non-spatial UI / command sound (centre pan, fixed volume). */
  playUi(cfg: SfxConfig): void {
    this.manager.play(cfg.key, { volume: cfg.volume, minIntervalMs: cfg.minIntervalMs });
  }

  /** Voice bark (or blip fallback) for a single selected unit. */
  barkSelect(eid: number): void {
    if (!this.playUnitBark(eid, 'select')) this.playUi(UNIT_SELECT);
  }

  /** "On our way" from the representative selected unit; blip fallback. */
  barkMove(): void {
    const eid = this.representativeSelectedUnit();
    if (eid === null) return;
    if (!this.playUnitBark(eid, 'move')) this.playUi(COMMAND_MOVE);
  }

  /** Battle cry from the representative selected unit; blip fallback. */
  barkAttack(): void {
    const eid = this.representativeSelectedUnit();
    if (eid === null) return;
    if (!this.playUnitBark(eid, 'attack')) this.playUi(COMMAND_MOVE);
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

  private applyMusicContext(desired: MusicContext): void {
    if (desired !== this.musicContext) {
      const dwell = this.contextSinceTick < 0 ? Infinity : this.ctx.world.tick - this.contextSinceTick;
      const canSwitch =
        desired === 'battle' || this.musicContext === 'battle' || dwell >= CONTEXT_MIN_DWELL_TICKS;
      if (!canSwitch) {
        this.playContext(this.musicContext);
        return;
      }
      this.musicContext = desired;
      this.contextSinceTick = this.ctx.world.tick;
      if (desired !== 'battle') this.battleTrack = null;
    }
    this.playContext(this.musicContext);
  }

  /** Drive the audio layer for the active context (idempotent every frame). */
  private playContext(context: MusicContext): void {
    if (context === 'battle') {
      if (this.battleTrack === null) this.battleTrack = this.pickBattleTrack();
      if (this.battleTrack) {
        this.manager.setMusicDucked(false);
        this.manager.playLooping(this.battleTrack);
      } else {
        // No battle track supplied: keep the playlist but duck it.
        this.manager.playGamePlaylist();
        this.manager.setMusicDucked(true);
      }
      return;
    }
    this.manager.setMusicDucked(false);
    // Village + playlist both breathe (song, ambience-only gap, song).
    if (context === 'village') this.manager.playGappedSingle(VILLAGE_MUSIC);
    else this.manager.playGamePlaylist();
  }

  private pickBattleTrack(): string | null {
    const present = BATTLE_TRACKS.filter((key) => this.manager.hasTrack(key));
    if (present.length === 0) return null;
    return present[Math.floor(Math.random() * present.length)];
  }

  private cameraNearHomeBase(): boolean {
    const tc = this.localTownCenterPos();
    if (!tc) return false;
    const abs = this.ctx.localToWorld(tileToScreen(tc.x, tc.y));
    const view = this.ctx.scene.cameras.main.worldView;
    return Math.hypot(abs.x - view.centerX, abs.y - view.centerY) <= HOME_RADIUS_PX;
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

  private localHasLivingMilitary(): boolean {
    const world = this.ctx.world;
    for (const eid of unitQuery(world.ecs)) {
      if (Owner.player[eid] !== this.ctx.perspectivePlayerId) continue;
      if (hasComponent(world.ecs, VillagerTag, eid)) continue;
      if (hasComponent(world.ecs, Health, eid) && Health.hp[eid] <= 0) continue;
      return true;
    }
    return false;
  }

  private playCombatSound(event: CombatEvent): void {
    const isBuildingAttacker = hasComponent(this.ctx.world.ecs, Building, event.attackerEid);
    const cfg = combatSound(event.attackerKind, event.range, event.phase, isBuildingAttacker);
    if (!cfg) return;
    const fromVisible = this.ctx.isTileVisible(event.fromX, event.fromY);
    const toVisible = this.ctx.isTileVisible(event.toX, event.toY);
    if (!fromVisible && !toVisible) return;
    // Pan around the attacker for fire, the target for melee impact.
    const x = event.range <= 1 ? event.toX : event.fromX;
    const y = event.range <= 1 ? event.toY : event.fromY;
    this.playSpatial(cfg, x, y);
  }

  private noteCombatForAdaptiveAudio(event: CombatEvent): void {
    if (event.phase === 'windup') return;
    const attackerPlayer = this.ctx.ownerOf(event.attackerEid);
    const targetPlayer = this.ctx.ownerOf(event.targetEid);
    const tick = this.ctx.world.tick;
    if (attackerPlayer === this.ctx.perspectivePlayerId || targetPlayer === this.ctx.perspectivePlayerId) {
      this.lastLocalCombatTick = tick;
    }
    if (targetPlayer === this.ctx.perspectivePlayerId) {
      const elapsed = tick - this.lastAlertTick;
      if (this.lastAlertTick < 0 || elapsed >= ALERT_COOLDOWN_TICKS) {
        this.lastAlertTick = tick;
        this.manager.play(ALERT.key, { volume: ALERT.volume, minIntervalMs: ALERT.minIntervalMs });
      }
    }
  }

  /** World-positioned sound: stereo pan + volume falloff from the camera view. */
  private playSpatial(cfg: SfxConfig, tileX: number, tileY: number): void {
    const abs = this.ctx.localToWorld(tileToScreen(tileX, tileY));
    const view = this.ctx.scene.cameras.main.worldView;
    const halfW = Math.max(1, view.width / 2);
    const halfH = Math.max(1, view.height / 2);
    const pan = clamp(((abs.x - view.centerX) / halfW) * MAX_SPATIAL_PAN, -MAX_SPATIAL_PAN, MAX_SPATIAL_PAN);
    const overshootX = Math.max(0, Math.abs(abs.x - view.centerX) - halfW);
    const overshootY = Math.max(0, Math.abs(abs.y - view.centerY) - halfH);
    const overshoot = Math.hypot(overshootX, overshootY);
    const falloff = clamp(1 - overshoot / halfW, 0.2, 1);
    this.manager.play(cfg.key, {
      pan,
      volume: cfg.volume * falloff,
      minIntervalMs: cfg.minIntervalMs,
    });
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

  private playUnitBark(eid: number, type: VoiceBarkType): boolean {
    const category = this.voiceCategoryForUnit(eid);
    if (!category) return false;
    return this.manager.playVoiceBark(category, type, VOICE_LINE_COUNTS[type]);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
