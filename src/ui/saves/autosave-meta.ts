/**
 * Autosave metadata: the small record stored next to the save blob so the
 * main menu can offer "Continue" without parsing the whole save. Pure (no
 * DOM, no storage); unit tested.
 */

import { formatClock } from '../format';

/** Bump when the metadata shape changes; older or newer records are dropped. */
export const AUTOSAVE_FORMAT = 1;

export type AutosaveMode = 'skirmish' | 'campaign';

export interface AutosaveMeta {
  format: typeof AUTOSAVE_FORMAT;
  mode: AutosaveMode;
  /** Campaign mission, null for a skirmish. */
  missionId: string | null;
  missionName: string | null;
  /** Skirmish map name; null when unknown (a match loaded from a manual save). */
  mapName: string | null;
  /** AI difficulty ('easy' | 'medium' | 'hard'); null when the save has none. */
  difficulty: string | null;
  /** Game time in sim ticks. */
  tick: number;
  /** Wall clock, epoch milliseconds. */
  savedAt: number;
  appVersion: string;
  /** `version` of the save blob this record describes. */
  saveVersion: number;
  /** Non-sim scene state needed to resume the match as it was. */
  gameSpeed: number;
}

/** What the match flow knows about the running match and the sim does not. */
export interface AutosaveSetup {
  mapName: string | null;
}

export interface AutosaveMetaInput {
  setup: AutosaveSetup;
  mission: { id: string; name: string } | null;
  difficulty: string | null;
  tick: number;
  saveVersion: number;
  gameSpeed: number;
  savedAt: number;
  appVersion: string;
}

export function buildAutosaveMeta(input: AutosaveMetaInput): AutosaveMeta {
  const mission = input.mission;
  return {
    format: AUTOSAVE_FORMAT,
    mode: mission ? 'campaign' : 'skirmish',
    missionId: mission ? mission.id : null,
    missionName: mission ? mission.name : null,
    mapName: mission ? null : input.setup.mapName,
    difficulty: input.difficulty,
    tick: Math.max(0, Math.floor(input.tick)),
    savedAt: input.savedAt,
    appVersion: input.appVersion,
    saveVersion: input.saveVersion,
    gameSpeed: input.gameSpeed >= 2 ? 2 : 1,
  };
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/**
 * Validate a record read back from storage. Returns null for anything this
 * build cannot resume: wrong shape, another metadata format, or a save blob
 * written by a newer build (`saveVersion` above `maxSaveVersion`).
 */
export function parseAutosaveMeta(value: unknown, maxSaveVersion: number): AutosaveMeta | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.format !== AUTOSAVE_FORMAT) return null;
  if (v.mode !== 'skirmish' && v.mode !== 'campaign') return null;
  if (!isNonNegativeInt(v.tick)) return null;
  if (typeof v.savedAt !== 'number' || !Number.isFinite(v.savedAt)) return null;
  if (typeof v.appVersion !== 'string') return null;
  if (!isNonNegativeInt(v.saveVersion) || v.saveVersion < 1 || v.saveVersion > maxSaveVersion) return null;
  if (!isStringOrNull(v.missionName) || !isStringOrNull(v.mapName) || !isStringOrNull(v.difficulty)) return null;
  if (!isStringOrNull(v.missionId)) return null;
  if (v.mode === 'campaign' && v.missionId === null) return null;
  return {
    format: AUTOSAVE_FORMAT,
    mode: v.mode,
    missionId: v.missionId,
    missionName: v.missionName,
    mapName: v.mapName,
    difficulty: v.difficulty,
    tick: v.tick,
    savedAt: v.savedAt,
    appVersion: v.appVersion,
    saveVersion: v.saveVersion,
    gameSpeed: v.gameSpeed === 2 ? 2 : 1,
  };
}

/** Match name for titles: the mission, the map, or the bare mode. */
export function autosaveTitle(meta: AutosaveMeta): string {
  if (meta.mode === 'campaign') return meta.missionName ?? 'Campaign';
  return meta.mapName ?? 'Skirmish';
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function formatSavedAgo(savedAt: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - savedAt) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** One-line menu summary: mode, map or mission, game time, when saved. */
export function describeAutosave(meta: AutosaveMeta, now: number, tickHz: number): string {
  const mode = meta.mode === 'campaign' ? 'Campaign' : 'Skirmish';
  const where = meta.mode === 'campaign' ? meta.missionName : meta.mapName;
  return [mode, where, formatClock(meta.tick / tickHz), `saved ${formatSavedAgo(meta.savedAt, now)}`]
    .filter((part): part is string => !!part)
    .join(' · ');
}
