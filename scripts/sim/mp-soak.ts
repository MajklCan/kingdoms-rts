/**
 * Lockstep soak: AI-bot vs AI-bot matches through the real multiplayer path
 * (in-memory relay, virtual clock), checksums compared after every tick.
 *
 *   npx vite-node scripts/sim/mp-soak.ts -- --seeds 1-8 --maps all --ages 0,1,2 \
 *     --max-ticks 30000 --net chaos [--shard 0/8] [--no-pollute] [--every 20] \
 *     [--reload 4000] [--out .context/sim/mp.json]
 *
 * --net: perfect | lan | wan | chaos (latency, jitter, reorder, duplicates).
 * A desync prints the first diverging tick and a field diff of both worlds.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgeIdValue } from '@sim/defs';
import type { MapIdValue } from '@sim/map-gen';
import type { AiDifficulty } from '@sim/world';
import { runMpMatchWithForensics, type MpClientSpec, type MpMatchResult } from '../../src/net/testing/mp-match';
import { PERFECT_LINK, type LinkConditions } from '../../src/net/testing/virtual-net';
import { PLAYABLE_AGES, SKIRMISH_MAPS } from './lib/ai-match';
import { parseArgs, parseList, parseRange } from './lib/args';

const NETS: Record<string, [LinkConditions, LinkConditions]> = {
  perfect: [PERFECT_LINK, PERFECT_LINK],
  lan: [
    { latencyMs: 5, jitterMs: 5, reorderChance: 0, duplicateChance: 0 },
    { latencyMs: 8, jitterMs: 5, reorderChance: 0, duplicateChance: 0 },
  ],
  wan: [
    { latencyMs: 40, jitterMs: 60, reorderChance: 0, duplicateChance: 0 },
    { latencyMs: 90, jitterMs: 120, reorderChance: 0, duplicateChance: 0 },
  ],
  chaos: [
    { latencyMs: 30, jitterMs: 150, reorderChance: 0.2, duplicateChance: 0.05 },
    { latencyMs: 120, jitterMs: 250, reorderChance: 0.3, duplicateChance: 0.05 },
  ],
};

const args = parseArgs(process.argv.slice(2));
const seeds = parseRange(args.seeds ?? '1-2');
const maps = (args.maps === undefined || args.maps === 'all' ? SKIRMISH_MAPS : parseList(args.maps)) as MapIdValue[];
const ages = (args.ages === undefined ? PLAYABLE_AGES : parseList(args.ages).map(Number)) as AgeIdValue[];
const pairs = parseList(args.diffs ?? 'medium:medium').map((pair) => pair.split(':') as [AiDifficulty, AiDifficulty]);
const nets = parseList(args.net ?? 'chaos');
const maxTicks = Number(args['max-ticks'] ?? 30000);
const every = Number(args.every ?? 1);
const reload = args.reload !== undefined ? Number(args.reload) : undefined;
const [shardIndex, shardCount] = (args.shard ?? '0/1').split('/').map(Number);

interface Row {
  seed: number;
  mapId: MapIdValue;
  startingAge: AgeIdValue;
  diffs: [AiDifficulty, AiDifficulty];
  net: string;
  result: MpMatchResult;
}

const configs: Array<Omit<Row, 'result'>> = [];
for (const seed of seeds) {
  for (const mapId of maps) {
    for (const startingAge of ages) {
      for (const diffs of pairs) {
        for (const net of nets) configs.push({ seed, mapId, startingAge, diffs, net });
      }
    }
  }
}

const rows: Row[] = [];
let failures = 0;
configs.forEach((cfg, i) => {
  if (i % shardCount !== shardIndex) return;
  const links = NETS[cfg.net] ?? NETS.chaos;
  const clients: [MpClientSpec, MpClientSpec] = [
    { difficulty: cfg.diffs[0], link: links[0], frameJitterMs: cfg.net === 'perfect' ? 0 : 12 },
    { difficulty: cfg.diffs[1], link: links[1], frameMs: cfg.net === 'chaos' ? 33 : 1000 / 60, frameJitterMs: cfg.net === 'perfect' ? 0 : 20 },
  ];
  const result = runMpMatchWithForensics({
    seed: cfg.seed,
    mapId: cfg.mapId,
    startingAge: cfg.startingAge,
    clients,
    maxTicks,
    checksumEveryTick: every === 1,
    pollute: args['no-pollute'] === undefined,
    reloadAt: reload !== undefined ? { client: (cfg.seed % 2) as 0 | 1, tick: reload } : undefined,
  });
  const bad = result.desyncTick !== null || result.sessionDesync || result.hang || result.winners[0] !== result.winners[1];
  if (bad) failures++;
  const cmds = result.commands.map((c) => c?.commands ?? 0).join('/');
  process.stdout.write(
    `${bad ? 'FAIL' : 'ok  '} seed=${cfg.seed} map=${cfg.mapId} age=${cfg.startingAge} net=${cfg.net} ` +
      `ticks=${result.ticks.join('/')} world=${result.worldTicks.join('/')} winner=${result.winners.join('/')} ` +
      `states=${result.states.join('/')} compared=${result.ticksCompared} cmds=${cmds} ` +
      `desync=${result.desyncTick ?? '-'} hang=${result.hang} wall=${result.wallMs}ms\n`
  );
  if (result.diff) {
    for (const line of result.diff.slice(0, 25)) process.stdout.write(`    ${line.path}: ${line.a} | ${line.b}\n`);
  }
  rows.push({ ...cfg, result });
});

if (args.out) {
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(rows));
}
process.stdout.write(`done: ${rows.length} matches, ${failures} failed\n`);
process.exitCode = failures > 0 ? 1 : 0;
