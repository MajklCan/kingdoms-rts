/**
 * Replay desync reports (downloaded by each player when a multiplayer match
 * diverges) and say where each client left the canonical run.
 *
 *   npx vite-node scripts/sim/replay-desync.ts -- a.json [b.json ...] [--dump .context/sim/desync-world.txt]
 *
 * A report that matches the replay all the way played the canonical game; one
 * that does not drifted at the printed checkpoint (the second before it is the
 * window to look at, with the commands listed). --dump writes the replayed
 * world at the first mismatch as one line per entity, to diff against a dump
 * from the other report.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { replayDesyncReport, type DesyncReport } from '../../src/net/desync-report';
import { describeWorld } from '../../src/net/testing/world-diff';

const args = process.argv.slice(2).filter((a) => a !== '--');
const dumpIdx = args.indexOf('--dump');
const dumpPath = dumpIdx >= 0 ? args[dumpIdx + 1] : null;
const files = args.filter((a, i) => a !== '--dump' && (dumpIdx < 0 || i !== dumpIdx + 1));
if (files.length === 0) {
  console.error('usage: replay-desync.ts <report.json> [more.json] [--dump out.txt]');
  process.exit(2);
}

for (const file of files) {
  const report = JSON.parse(readFileSync(file, 'utf8')) as DesyncReport;
  const result = replayDesyncReport(report);
  const head = `${file}: player ${report.localPlayerId}, build ${report.build}, seed ${report.seed}`;
  const mismatch = report.mismatch
    ? `peer mismatch at tick ${report.mismatch.tick}`
    : 'no peer mismatch recorded';
  if (!result.firstMismatch) {
    console.log(`${head}\n  matches the replay at all ${result.checked} checkpoints (${mismatch})`);
    continue;
  }
  const at = result.firstMismatch.tick;
  console.log(`${head}\n  DRIFTED at checkpoint ${at} after ${result.checked} good ones (${mismatch})`);
  for (const c of report.commands.filter((c) => c.tick >= at - 40 && c.tick < at)) {
    console.log(`    tick ${c.tick}: ${JSON.stringify(c.inputs)}`);
  }
  if (dumpPath) {
    const lines = [...describeWorld(result.world).entries()].map(([k, v]) => `${k} ${v}`);
    writeFileSync(dumpPath, lines.join('\n'));
    console.log(`  replayed world at ${at} written to ${dumpPath}`);
  }
}
