/**
 * Report over player traces (a file per match from the game-over screen or
 * the automatic download, or a `kingdoms-trace-saved-*.json` bundle from
 * Settings): how often each feature was used, hotkey vs click vs touch, when
 * it first came up and who used it, the features nobody touched and the
 * actions the game refused. A match found in several files counts once.
 *
 *   npx vite-node scripts/sim/trace-report.ts -- ~/Downloads/kingdoms-trace-*.json
 *   npx vite-node scripts/sim/trace-report.ts -- ~/Downloads            (every kingdoms-trace-*.json in it)
 *   npx vite-node scripts/sim/trace-report.ts -- a.json b.json --json   (the summary as JSON)
 *   npx vite-node scripts/sim/trace-report.ts -- dir --player Michal    (one player only)
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { PlayerTrace } from '../../src/render/trace/player-trace';
import { formatTraceSummary, summarizeTraces } from '../../src/render/trace/trace-summary';
import { isPlayerTrace } from '../../src/ui/trace/trace-store';

const args = process.argv.slice(2).filter((a) => a !== '--');
const asJson = args.includes('--json');
const playerIdx = args.indexOf('--player');
const onlyPlayer = playerIdx >= 0 ? args[playerIdx + 1]?.toLowerCase() : undefined;
const paths = args.filter((a, i) => !a.startsWith('--') && (playerIdx < 0 || i !== playerIdx + 1));
if (paths.length === 0) {
  console.error('usage: trace-report.ts <trace.json | folder> [...] [--player NAME] [--json]');
  process.exit(2);
}

const files = paths.flatMap((p) =>
  statSync(p).isDirectory()
    ? readdirSync(p)
        .filter((f) => f.startsWith('kingdoms-trace-') && f.endsWith('.json'))
        .sort()
        .map((f) => join(p, f))
    : [p]
);

const traces: PlayerTrace[] = [];
for (const file of files) {
  try {
    const data: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const found = (Array.isArray(data) ? data : [data]).filter(isPlayerTrace);
    if (found.length === 0) throw new Error('not a player trace');
    traces.push(...found.filter((t) => !onlyPlayer || t.player.toLowerCase() === onlyPlayer));
  } catch (err) {
    console.error(`skipped ${file}: ${(err as Error).message}`);
  }
}
if (traces.length === 0) {
  console.error('no traces to report');
  process.exit(1);
}

const summary = summarizeTraces(traces);
console.log(asJson ? JSON.stringify(summary, null, 2) : formatTraceSummary(summary));
