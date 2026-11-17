/**
 * Trace hooks for the command layer: every sim command this client sends and
 * every action the game refuses. Kept apart from active-trace.ts so the DOM
 * HUD can record without pulling in the command feedback (audio, effects).
 */

import type { SimInput } from '@sim/world';
import { describeFailure, type CommandFailure } from '../commands/feedback';
import { activeTrace, currentVia } from './active-trace';
import { commandFeature } from './trace-catalog';

/** A sim command this client sends, as the feature it stands for. */
export function traceCommand(input: SimInput): void {
  const recorder = activeTrace();
  if (!recorder) return;
  const { feature, detail, queued } = commandFeature(input);
  const via = currentVia();
  recorder.record(feature, via, { detail });
  if (queued) recorder.record('order:shift-queue', via);
}

/** An action the game refused (no resources, no builder, blocked tile). */
export function traceFailure(failure: CommandFailure): void {
  activeTrace()?.recordFailure(failure.reason, describeFailure(failure), currentVia());
}
