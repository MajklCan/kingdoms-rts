/**
 * Hands the player a desync report as a file the moment the match diverges,
 * so both players can send theirs without opening the console. The last
 * report also stays on `window.__MP__.report()`.
 */

import type { DesyncReport } from '../../net/desync-report';

let last: DesyncReport | null = null;

export function lastDesyncReport(): DesyncReport | null {
  return last;
}

export function saveDesyncReport(report: DesyncReport): void {
  last = report;
  try {
    const blob = new Blob([JSON.stringify(report)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `kingdoms-desync-${report.room}-p${report.localPlayerId}-t${report.mismatch?.tick ?? 'x'}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch {
    // Download blocked: the report is still on __MP__.report().
  }
}
