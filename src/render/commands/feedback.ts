/**
 * Player-facing feedback for commands: typed failures (which resource was
 * short, population cap, blocked placement), short confirmations, and the
 * click marker drawn where a move / attack / rally order lands.
 *
 * The command layer and pointer input report here; the UI API drains the
 * queued notices every frame and turns them into alerts and log lines. Copy
 * is written for players: no entity ids, coordinates or debug wording.
 */

import { ERROR as SFX_ERROR } from '../audio/sound-map';
import type { EffectsLayer } from '../effects/effects-layer';
import { ORDER_MARKER_EFFECT, type OrderMarkerKind } from '../effects/order-marker';
import type { GameAudio } from '../game-audio';

export type ResourceName = 'food' | 'wood' | 'gold' | 'stone';
export const RESOURCE_NAMES: readonly ResourceName[] = ['food', 'wood', 'gold', 'stone'];

export type CommandFailure =
  | { reason: 'resources'; subject: string; missing: ResourceName[] }
  | { reason: 'population'; subject: string }
  | { reason: 'placement'; subject: string; detail: 'blocked' | 'needs-resource' | 'outside-map' }
  | { reason: 'locked'; subject: string }
  | { reason: 'queue-full'; subject: string }
  | { reason: 'unavailable'; text: string };

export type CommandNotice =
  | { kind: 'failure'; failure: CommandFailure; text: string }
  | { kind: 'info'; text: string };

const MAX_PENDING = 32;

export function describeFailure(failure: CommandFailure): string {
  switch (failure.reason) {
    case 'resources':
      return `Not enough ${joinWords(failure.missing)} for ${failure.subject}`;
    case 'population':
      return `Population limit reached. Build a house to train ${failure.subject}`;
    case 'placement':
      return failure.detail === 'needs-resource'
        ? `${failure.subject} must be built near its resource`
        : failure.detail === 'outside-map'
          ? 'Cannot build outside the map'
          : `Cannot build ${failure.subject} here`;
    case 'locked':
      return `${failure.subject} is not available yet`;
    case 'queue-full':
      return `${failure.subject}: queue is full`;
    case 'unavailable':
      return failure.text;
  }
}

function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? 'resources';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

export class CommandFeedback {
  private pending: CommandNotice[] = [];

  constructor(
    private readonly effects: EffectsLayer,
    private readonly audio: GameAudio
  ) {}

  /** A command was refused before it left: error sound plus a notice. */
  fail(failure: CommandFailure): void {
    this.audio.playUi(SFX_ERROR);
    this.push({ kind: 'failure', failure, text: describeFailure(failure) });
  }

  /** A short confirmation for the event log ("Army rally point set"). */
  info(text: string): void {
    this.push({ kind: 'info', text });
  }

  /** Ground marker where an order lands (tile coordinates). */
  orderMarker(kind: OrderMarkerKind, tileX: number, tileY: number): void {
    this.effects.spawn(ORDER_MARKER_EFFECT, { x: tileX, y: tileY }, { params: { kind } });
  }

  drain(): CommandNotice[] {
    if (this.pending.length === 0) return [];
    return this.pending.splice(0);
  }

  clear(): void {
    this.pending = [];
  }

  private push(notice: CommandNotice): void {
    this.pending.push(notice);
    if (this.pending.length > MAX_PENDING) this.pending.splice(0, this.pending.length - MAX_PENDING);
  }
}
