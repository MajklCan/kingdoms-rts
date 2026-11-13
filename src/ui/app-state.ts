/**
 * Mutable UI-wide state shared between screens: which top-level phase the
 * app is in (mirrored to <body data-app-state>, which CSS uses to show the
 * HUD only during a match) and the live multiplayer session.
 */

import type { MultiplayerSession } from '../net/session';

export type AppPhase = 'boot' | 'menu' | 'loading' | 'match';
export type MatchKind = 'skirmish' | 'campaign' | 'multiplayer' | 'loaded';

type PhaseListener = (phase: AppPhase, previous: AppPhase) => void;

export const appState: {
  phase: AppPhase;
  matchKind: MatchKind | null;
  mpSession: MultiplayerSession | null;
} = {
  phase: 'boot',
  matchKind: null,
  mpSession: null,
};

const listeners = new Set<PhaseListener>();

export function setPhase(phase: AppPhase): void {
  const previous = appState.phase;
  appState.phase = phase;
  document.body.dataset.appState = phase;
  if (previous !== phase) for (const fn of listeners) fn(phase, previous);
}

export function onPhaseChange(fn: PhaseListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
