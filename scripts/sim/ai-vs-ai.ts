/**
 * AI-vs-AI batch runner (one process, optionally one shard of a batch).
 *
 *   npx vite-node scripts/sim/ai-vs-ai.ts -- --seeds 1-4 --maps riverlands \
 *     --ages 0,1,2 --diffs medium:medium,hard:easy --max-ticks 36000 \
 *     --out .context/sim/batch.json [--shard 0/4] [--timeline]
 *
 * Every combination of seed x map x age x difficulty pairing is one match;
 * with --mirror each pairing also runs with the seats swapped. Prints one
 * line per match and writes the records as JSON (timelines only with
 * --timeline, they are large). scripts/sim/batch.mjs fans shards out over
 * processes and merges them.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { MapIdValue } from '@sim/map-gen';
import type { AgeIdValue } from '@sim/defs';
import type { AiDifficulty } from '@sim/world';
import { PLAYABLE_AGES, SKIRMISH_MAPS, runAiMatch, type AiMatchConfig, type AiMatchResult } from './lib/ai-match';
import { parseArgs, parseList, parseRange } from './lib/args';

const args = parseArgs(process.argv.slice(2));
const seeds = parseRange(args.seeds ?? '1-2');
const maps = (args.maps === undefined || args.maps === 'all' ? SKIRMISH_MAPS : parseList(args.maps)) as MapIdValue[];
const ages = (args.ages === undefined ? PLAYABLE_AGES : parseList(args.ages).map(Number)) as AgeIdValue[];
const pairs = parseList(args.diffs ?? 'medium:medium').map((pair) => pair.split(':') as [AiDifficulty, AiDifficulty]);
const maxTicks = Number(args['max-ticks'] ?? 36000);
const mirror = args.mirror !== undefined;
const keepTimeline = args.timeline !== undefined;
const [shardIndex, shardCount] = (args.shard ?? '0/1').split('/').map(Number);

const configs: AiMatchConfig[] = [];
for (const seed of seeds) {
  for (const mapId of maps) {
    for (const startingAge of ages) {
      for (const [a, b] of pairs) {
        configs.push({ seed, mapId, startingAge, difficulties: [a, b], maxTicks });
        if (mirror && a !== b) configs.push({ seed, mapId, startingAge, difficulties: [b, a], maxTicks });
      }
    }
  }
}

const mine = configs.filter((_, i) => i % shardCount === shardIndex);
const results: AiMatchResult[] = [];
for (const config of mine) {
  const result = runAiMatch(config);
  const summary = [
    `seed=${config.seed}`,
    `map=${config.mapId}`,
    `age=${config.startingAge}`,
    `p1=${config.difficulties[0]}`,
    `p2=${config.difficulties[1]}`,
    `winner=${result.winner}`,
    `ticks=${result.endTick}`,
    `wall=${result.wallMs}ms`,
    result.flags.length > 0 ? `flags=${result.flags.join(',')}` : '',
  ].filter(Boolean).join(' ');
  process.stdout.write(`${summary}\n`);
  results.push(keepTimeline ? result : { ...result, timeline: [] });
  // Rewritten after every game so a long batch that is stopped early still
  // leaves the games it finished.
  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, JSON.stringify(results));
  }
}
