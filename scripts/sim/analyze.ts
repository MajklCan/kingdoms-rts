/**
 * Summarise an AI-vs-AI batch (the merged JSON from batch.mjs + ai-vs-ai.ts)
 * as markdown tables: side bias, match length, stalemates, age-up timing,
 * army composition, never-used content, floating banks and stall flags.
 *
 *   npx vite-node scripts/sim/analyze.ts -- --in .context/sim/base.json [--json out.json]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { AgeId, BUILDING_TABLE, UNIT_TABLE } from '@sim/defs';
import { STARTING_TECHS, TECH_TREE, TechId } from '@sim/tech-tree';
import type { AiMatchResult } from './lib/ai-match';
import { parseArgs } from './lib/args';

const args = parseArgs(process.argv.slice(2));
if (!args.in) throw new Error('--in <merged.json> required');
const games = JSON.parse(readFileSync(args.in, 'utf8')) as AiMatchResult[];
const TICKS_PER_MIN = 20 * 60;
const AGE_NAMES = ['Dark', 'Castle', 'Gunpowder', 'TotalWar'];

const minutes = (ticks: number): string => (ticks / TICKS_PER_MIN).toFixed(1);
const pct = (n: number, d: number): string => (d === 0 ? '-' : `${Math.round((100 * n) / d)}%`);
function quantile(values: number[], q: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}
function table(head: string[], rows: Array<Array<string | number>>): string {
  const lines = [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
  for (const row of rows) lines.push(`| ${row.join(' | ')} |`);
  return lines.join('\n');
}
function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    out.set(k, [...(out.get(k) ?? []), item]);
  }
  return out;
}

const out: string[] = [];
const summary: Record<string, unknown> = {};

// Results by pairing, plus side bias over mirror (same difficulty) games.
const decided = games.filter((g) => g.winner !== 0);
const mirror = games.filter((g) => g.config.difficulties[0] === g.config.difficulties[1]);
const mirrorDecided = mirror.filter((g) => g.winner !== 0);
const p1Mirror = mirrorDecided.filter((g) => g.winner === 1).length;
summary.games = games.length;
summary.timeouts = games.length - decided.length;
summary.mirrorP1Share = mirrorDecided.length ? p1Mirror / mirrorDecided.length : null;
out.push(`## ${games.length} games, ${decided.length} decided, ${games.length - decided.length} timeouts`);
out.push(`Side bias (same difficulty both seats): P1 won ${p1Mirror}/${mirrorDecided.length} decided (${pct(p1Mirror, mirrorDecided.length)}).`);

const lengthRow = (label: string, list: AiMatchResult[]): Array<string | number> => {
  const done = list.filter((g) => g.winner !== 0);
  const lens = done.map((g) => g.endTick);
  return [
    label,
    list.length,
    done.filter((g) => g.winner === 1).length,
    done.filter((g) => g.winner === 2).length,
    list.length - done.length,
    lens.length ? minutes(quantile(lens, 0.1)) : '-',
    lens.length ? minutes(quantile(lens, 0.5)) : '-',
    lens.length ? minutes(quantile(lens, 0.9)) : '-',
  ];
};
const lengthHead = ['group', 'games', 'P1 won', 'P2 won', 'timeout', 'p10 min', 'median min', 'p90 min'];
out.push('\n### By difficulty pairing (P1:P2)');
out.push(table(lengthHead, [...groupBy(games, (g) => g.config.difficulties.join(':'))].map(([k, v]) => lengthRow(k, v))));
out.push('\n### By starting age');
out.push(table(lengthHead, [...groupBy(games, (g) => AGE_NAMES[g.config.startingAge])].map(([k, v]) => lengthRow(k, v))));
out.push('\n### By map');
out.push(table(lengthHead, [...groupBy(games, (g) => g.config.mapId)].map(([k, v]) => lengthRow(k, v))));

// Difficulty strength: win share of each difficulty against each other one.
const diffWins = new Map<string, { won: number; played: number }>();
for (const g of games) {
  const [a, b] = g.config.difficulties;
  if (a === b) continue;
  for (const [seat, me, them] of [[1, a, b], [2, b, a]] as const) {
    const key = `${me} vs ${them}`;
    const row = diffWins.get(key) ?? { won: 0, played: 0 };
    row.played++;
    if (g.winner === seat) row.won++;
    diffWins.set(key, row);
  }
}
if (diffWins.size > 0) {
  out.push('\n### Cross-difficulty win share');
  out.push(table(['matchup', 'won', 'played', 'share'], [...diffWins].map(([k, v]) => [k, v.won, v.played, pct(v.won, v.played)])));
}

// Age-up timings per starting age.
out.push('\n### Age-ups (per player, by starting age)');
const ageRows: Array<Array<string | number>> = [];
for (const [start, list] of groupBy(games, (g) => String(g.config.startingAge))) {
  const startAge = Number(start);
  for (let age = startAge + 1; age <= AgeId.GUNPOWDER; age++) {
    const ticks: number[] = [];
    let players = 0;
    for (const g of list) {
      for (const p of [1, 2]) {
        players++;
        const up = g.players[p].ageUps.find((u) => u.age === age);
        if (up) ticks.push(up.tick);
      }
    }
    ageRows.push([
      AGE_NAMES[startAge],
      AGE_NAMES[age],
      `${ticks.length}/${players}`,
      ticks.length ? minutes(quantile(ticks, 0.1)) : '-',
      ticks.length ? minutes(quantile(ticks, 0.5)) : '-',
      ticks.length ? minutes(quantile(ticks, 0.9)) : '-',
    ]);
  }
}
out.push(table(['start', 'reached', 'players', 'p10 min', 'median min', 'p90 min'], ageRows));

// Army composition and losses.
out.push('\n### Units trained / lost (all players, by starting age)');
const unitIds = UNIT_TABLE.map((u) => u.id);
const compRows: Array<Array<string | number>> = [];
for (const [start, list] of groupBy(games, (g) => AGE_NAMES[g.config.startingAge])) {
  const trained: Record<string, number> = {};
  const lost: Record<string, number> = {};
  const winnerTrained: Record<string, number> = {};
  for (const g of list) {
    for (const p of [1, 2]) {
      for (const [k, v] of Object.entries(g.players[p].trained)) {
        trained[k] = (trained[k] ?? 0) + v;
        if (g.winner === p) winnerTrained[k] = (winnerTrained[k] ?? 0) + v;
      }
      for (const [k, v] of Object.entries(g.players[p].lostUnits)) lost[k] = (lost[k] ?? 0) + v;
    }
  }
  const military = unitIds.filter((id) => id !== 'VILLAGER').reduce((s, id) => s + (trained[id] ?? 0), 0);
  for (const id of unitIds) {
    if (!trained[id] && !lost[id]) continue;
    compRows.push([
      start,
      id,
      trained[id] ?? 0,
      id === 'VILLAGER' ? '-' : pct(trained[id] ?? 0, military),
      winnerTrained[id] ?? 0,
      lost[id] ?? 0,
      ((trained[id] ?? 0) / list.length / 2).toFixed(1),
    ]);
  }
}
out.push(table(['start', 'unit', 'trained', 'military share', 'by winners', 'lost', 'per player'], compRows));

// Never-used content.
const trainedAny = new Set<string>();
const builtAny = new Set<string>();
const techAny = new Set<string>();
const buildCounts: Record<string, number> = {};
const techCounts: Record<string, number> = {};
for (const g of games) {
  for (const p of [1, 2]) {
    for (const [k, v] of Object.entries(g.players[p].trained)) if (v > 0) trainedAny.add(k);
    for (const [k, v] of Object.entries(g.players[p].built)) {
      if (v > 0) builtAny.add(k);
      buildCounts[k] = (buildCounts[k] ?? 0) + v;
    }
    for (const t of g.players[p].techs) {
      techAny.add(t.techId);
      techCounts[t.techId] = (techCounts[t.techId] ?? 0) + 1;
    }
  }
}
const scaffolded = new Set(['MILITIA', 'MACHINE_GUN', 'MORTAR']);
out.push('\n### Never used');
out.push(`Units: ${unitIds.filter((id) => !trainedAny.has(id) && !scaffolded.has(id)).join(', ') || 'none'}`);
out.push(`Buildings: ${BUILDING_TABLE.map((b) => b.id).filter((id) => !builtAny.has(id) && id !== 'TOWN_CENTER').join(', ') || 'none'}`);
// Starting techs are granted; age techs are reported as age-ups above.
const notResearchable = new Set<string>([...STARTING_TECHS, TechId.CASTLE_AGE, TechId.GUNPOWDER_AGE]);
out.push(`Techs: ${TECH_TREE.map((t) => t.id as string).filter((id) => !techAny.has(id) && !notResearchable.has(id)).join(', ') || 'none'}`);
out.push('\n### Buildings built per player (mean)');
out.push(table(['building', 'per player'], Object.entries(buildCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, (v / games.length / 2).toFixed(1)])));
out.push('\n### Techs researched (share of players)');
out.push(table(['tech', 'players'], Object.entries(techCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, pct(v, games.length * 2)])));

// Flags.
const flagCounts: Record<string, number> = {};
for (const g of games) {
  for (const f of g.flags) {
    const key = f.startsWith('plan-stuck') ? f.split(':').slice(0, 3).join(':').replace(/:p\d/, '') : f.replace(/:p\d/, '').replace(/:\d+$/, '');
    flagCounts[key] = (flagCounts[key] ?? 0) + 1;
  }
}
out.push('\n### Flags (games with flag)');
out.push(table(['flag', 'games'], Object.entries(flagCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v])));

// Peak banks and gathered income.
const peaks = [0, 1, 2, 3].map((k) => quantile(games.flatMap((g) => [g.players[1].peakBank[k], g.players[2].peakBank[k]]), 0.5));
out.push(`\nMedian peak bank food/wood/gold/stone: ${peaks.map((v) => Math.round(v)).join(' / ')}`);
const losers = decided.map((g) => g.players[g.winner === 1 ? 2 : 1]);
const winners = decided.map((g) => g.players[g.winner]);
const mean = (xs: number[]): string => (xs.length ? (xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(1) : '-');
out.push(
  `Winners: kills ${mean(winners.map((p) => p.final.unitsKilled))}, losses ${mean(winners.map((p) => p.final.unitsLost))}, razed ${mean(winners.map((p) => p.final.buildingsRazed))}; ` +
    `losers: kills ${mean(losers.map((p) => p.final.unitsKilled))}, losses ${mean(losers.map((p) => p.final.unitsLost))}.`
);

process.stdout.write(`${out.join('\n')}\n`);
if (args.json) writeFileSync(args.json, JSON.stringify({ ...summary, flagCounts }, null, 2));
