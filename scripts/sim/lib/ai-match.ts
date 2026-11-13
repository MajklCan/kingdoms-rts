/**
 * Headless AI-vs-AI match runner: both seats are driven by the sim's own AI
 * brain (each with its own difficulty), the world steps at full speed, and a
 * recorder samples a per-player timeline plus the events that matter for
 * balance and stall analysis. No render, no DOM.
 */

import * as bitecs from 'bitecs';
import { MapId, type MapIdValue } from '@sim/map-gen';
import { AgeId, BUILDING_TABLE, UNIT_TABLE, type AgeIdValue } from '@sim/defs';
import {
  createAiPlayerState,
  createSimWorld,
  step,
  type AiDifficulty,
  type AiPlan,
  type SimWorld,
} from '@sim/world';
import { MatchRecorder, type MatchRecord } from './recorder';

/** Skirmish maps (Zborov Lines is campaign only). */
export const SKIRMISH_MAPS: MapIdValue[] = (Object.values(MapId) as MapIdValue[]).filter(
  (id) => id !== MapId.ZBOROV_LINES
);

/** Playable starting ages (Total War is scaffolded but unreachable). */
export const PLAYABLE_AGES: AgeIdValue[] = [AgeId.DARK, AgeId.CASTLE, AgeId.GUNPOWDER];

export interface AiMatchConfig {
  seed: number;
  mapId: MapIdValue;
  startingAge: AgeIdValue;
  /** Difficulty of player 1 and player 2. */
  difficulties: [AiDifficulty, AiDifficulty];
  /** Stop without a winner after this many ticks. */
  maxTicks: number;
  /** Timeline sample cadence in ticks. */
  sampleEvery?: number;
}

/**
 * A skirmish world where both seats are AI. Player 2 is the ordinary skirmish
 * AI; player 1 gets an AI state of its own and loses its human flag.
 */
export function createAiVsAiWorld(config: AiMatchConfig): SimWorld {
  const [d1, d2] = config.difficulties;
  const world = createSimWorld(config.seed, {
    mapId: config.mapId,
    startingAge: config.startingAge,
    aiDifficulty: d2,
  });
  world.humanPlayers = new Set();
  world.aiPlayers[1] = { ...createAiPlayerState(0, d1), difficulty: d1 };
  const p2 = world.aiPlayers[2] ?? createAiPlayerState(0, d2);
  world.aiPlayers[2] = { ...p2, difficulty: d2 };
  world.paused = false;
  return world;
}

export interface AiMatchResult extends MatchRecord {
  config: AiMatchConfig;
  wallMs: number;
}

/** Drain the render-facing buffers the recorder already read. */
export function drainOutputBuffers(world: SimWorld): void {
  world.combatEvents.length = 0;
  world.soundCues.length = 0;
  world.aiEvents.length = 0;
  world.gameEvents.length = 0;
}

/**
 * Play one match to a winner or the tick cap. Resets bitECS globals first, so
 * long batches in one process never run out of entity ids (only safe because
 * no other world is alive across calls).
 */
export function runAiMatch(config: AiMatchConfig): AiMatchResult {
  resetBitecsGlobals();
  const started = Date.now();
  const world = createAiVsAiWorld(config);
  const recorder = new MatchRecorder(world, config.sampleEvery ?? 200);
  while (world.outcome.state === 'playing' && world.tick < config.maxTicks) {
    step(world);
    recorder.afterStep(world);
    drainOutputBuffers(world);
  }
  const record = recorder.finish(world);
  return { ...record, config, wallMs: Date.now() - started };
}

export function unitName(defId: number): string {
  return UNIT_TABLE[defId]?.id ?? `UNIT_${defId}`;
}

export function buildingName(defId: number): string {
  return BUILDING_TABLE[defId]?.id ?? `BUILDING_${defId}`;
}

export type { AiPlan };

/** bitECS keeps its eid cursor and recycle list in module globals; it exports
 *  resetGlobals at runtime but not in its typings. */
export function resetBitecsGlobals(): void {
  (bitecs as unknown as { resetGlobals: () => void }).resetGlobals();
}
