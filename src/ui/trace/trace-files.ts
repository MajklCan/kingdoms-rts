/**
 * Player traces on this device: localStorage behind the trace store, and
 * downloads as files. Settings and the game-over screen use it without
 * reaching into the running match.
 */

import { traceBundleFileName, traceFileName, type PlayerTrace } from '../../render/trace/player-trace';
import { readStorage, removeStorage, writeStorage } from '../dom';
import { readRecentTraces, setTraceAutoDownload, traceAutoDownload, type TraceStorage } from './trace-store';

export const localTraceStorage: TraceStorage = {
  read: readStorage,
  write: writeStorage,
  remove: removeStorage,
};

function downloadJson(data: unknown, fileName: string): void {
  try {
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch {
    // Download blocked: the trace stays in the kept traces on this device.
  }
}

export function downloadTrace(trace: PlayerTrace): void {
  downloadJson(trace, traceFileName(trace));
}

/** Number of finished matches kept on this device. */
export function savedTraceCount(): number {
  return readRecentTraces(localTraceStorage).length;
}

/** Every kept trace in one file (a JSON array; the report script reads it). */
export function downloadSavedTraces(): void {
  const traces = readRecentTraces(localTraceStorage);
  if (traces.length > 0) downloadJson(traces, traceBundleFileName(new Date()));
}

export function isTraceAutoDownloadOn(): boolean {
  return traceAutoDownload(localTraceStorage);
}

export function setTraceAutoDownloadOn(on: boolean): void {
  setTraceAutoDownload(localTraceStorage, on);
}
