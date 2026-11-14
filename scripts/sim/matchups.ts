/**
 * Equal-cost army fights: for every pair of military units, spend the same
 * resource budget on each side, attack-move them into each other on a cleared
 * arena and record who is left. Sides are swapped and the arena offset varies,
 * so seat and terrain luck cancel out. No techs, no AI, base stats only.
 *
 *   npx vite-node scripts/sim/matchups.ts -- [--budget 1200] [--reps 6] [--units ARCHER,SPEARMAN,...]
 *
 * Prints a win-share matrix and a cost-efficiency matrix (enemy value killed
 * per own value lost), row unit against column unit.
 */

import { MAP } from '../../src/config';
import { UNIT_TABLE, UnitDefId } from '@sim/defs';
import { Health, Owner } from '@sim/components';
import {
  buildingQuery,
  createSimWorld,
  positionQuery,
  removeSimEntity,
  step,
  unitQuery,
  type SimWorld,
} from '@sim/world';
import { spawnMilitaryUnitByDefId } from '../../src/sim/factories/units';
import { parseArgs, parseList } from './lib/args';
import { resetBitecsGlobals } from './lib/ai-match';

const args = parseArgs(process.argv.slice(2));
const budget = Number(args.budget ?? 1200);
const reps = Number(args.reps ?? 6);
const units = parseList(args.units ?? 'ARCHER,SPEARMAN,SCOUT_CAVALRY,GUNMAN,CANNON');
const MAX_TICKS = 20 * 150;

const defIdOf = (id: string): number => UnitDefId[id as keyof typeof UnitDefId];
const valueOf = (id: string): number => {
  const c = UNIT_TABLE[defIdOf(id)].cost;
  return c.food + c.wood + c.gold + c.stone;
};

/** A world whose middle is open, walkable grass with no units or resources;
 *  the town centers stay (far away) so the match never ends by itself. */
function arena(seed: number): SimWorld {
  resetBitecsGlobals();
  const world = createSimWorld(seed);
  world.humanPlayers = new Set([1, 2]);
  world.paused = false;
  const buildings = new Set(buildingQuery(world.ecs));
  for (const eid of [...positionQuery(world.ecs)]) if (!buildings.has(eid)) removeSimEntity(world, eid);
  for (let y = 12; y < MAP.HEIGHT - 12; y++) for (let x = 12; x < MAP.WIDTH - 12; x++) world.grid[y][x] = 0;
  return world;
}

function spawnBlock(world: SimWorld, id: string, count: number, cx: number, cy: number, player: number): number[] {
  const cols = Math.ceil(Math.sqrt(count));
  const eids: number[] = [];
  for (let i = 0; i < count; i++) {
    const x = cx + ((i % cols) - (cols - 1) / 2) * 0.9;
    const y = cy + (Math.floor(i / cols) - (cols - 1) / 2) * 0.9;
    const eid = spawnMilitaryUnitByDefId(world, defIdOf(id), x, y, player);
    if (eid !== null) eids.push(eid);
  }
  return eids;
}

interface Fight {
  winner: 'a' | 'b' | 'draw';
  valueLostA: number;
  valueLostB: number;
}

function fight(a: string, b: string, rep: number): Fight {
  const world = arena(1000 + rep);
  const aSide = rep % 2 === 0 ? 1 : 2;
  const bSide = 3 - aSide;
  const cy = 26 + (rep % 3) * 6;
  const left = { x: 24, y: cy };
  const right = { x: 40, y: cy };
  const countA = Math.max(1, Math.round(budget / valueOf(a)));
  const countB = Math.max(1, Math.round(budget / valueOf(b)));
  const aEids = spawnBlock(world, a, countA, aSide === 1 ? left.x : right.x, cy, aSide);
  const bEids = spawnBlock(world, b, countB, bSide === 1 ? left.x : right.x, cy, bSide);
  world.inputs.push({ type: 'cmdAttackMove', playerId: aSide, eids: aEids, to: aSide === 1 ? right : left });
  world.inputs.push({ type: 'cmdAttackMove', playerId: bSide, eids: bEids, to: bSide === 1 ? right : left });
  const alive = (player: number): number =>
    unitQuery(world.ecs).filter((e) => Owner.player[e] === player && Health.hp[e] > 0).length;
  let quiet = 0;
  let last = [countA, countB];
  for (let t = 0; t < MAX_TICKS; t++) {
    step(world);
    world.combatEvents.length = 0;
    world.gameEvents.length = 0;
    world.soundCues.length = 0;
    world.aiEvents.length = 0;
    if (t % 20 !== 0) continue;
    const now = [alive(aSide), alive(bSide)];
    if (now[0] === 0 || now[1] === 0) break;
    quiet = now[0] === last[0] && now[1] === last[1] ? quiet + 1 : 0;
    last = now;
    // Both sides parked and nobody dying for 20 s: re-issue the push.
    if (quiet === 20) {
      world.inputs.push({ type: 'cmdAttackMove', playerId: aSide, eids: aEids, to: bSide === 1 ? left : right });
      world.inputs.push({ type: 'cmdAttackMove', playerId: bSide, eids: bEids, to: aSide === 1 ? left : right });
    }
  }
  const leftA = alive(aSide);
  const leftB = alive(bSide);
  return {
    winner: leftA > 0 && leftB === 0 ? 'a' : leftB > 0 && leftA === 0 ? 'b' : 'draw',
    valueLostA: (countA - leftA) * valueOf(a),
    valueLostB: (countB - leftB) * valueOf(b),
  };
}

const win: number[][] = units.map(() => units.map(() => 0));
const eff: number[][] = units.map(() => units.map(() => 0));
const draws: number[][] = units.map(() => units.map(() => 0));
for (let i = 0; i < units.length; i++) {
  for (let j = i + 1; j < units.length; j++) {
    let lostA = 0;
    let lostB = 0;
    for (let r = 0; r < reps; r++) {
      const f = fight(units[i], units[j], r);
      if (f.winner === 'a') win[i][j]++;
      else if (f.winner === 'b') win[j][i]++;
      else {
        draws[i][j]++;
        draws[j][i]++;
      }
      lostA += f.valueLostA;
      lostB += f.valueLostB;
    }
    eff[i][j] = lostB / Math.max(1, lostA);
    eff[j][i] = lostA / Math.max(1, lostB);
  }
}

const head = ['row vs col', ...units];
const line = (cells: string[]): string => `| ${cells.join(' | ')} |`;
const sep = `|${head.map(() => '---').join('|')}|`;
process.stdout.write(`Budget ${budget} per side (food+wood+gold+stone), ${reps} fights per pair, counts: ${units.map((u) => `${u} ${Math.max(1, Math.round(budget / valueOf(u)))}`).join(', ')}\n\n`);
process.stdout.write(`Wins of row over column (of ${reps}; draws in brackets)\n${line(head)}\n${sep}\n`);
for (let i = 0; i < units.length; i++) {
  process.stdout.write(line([units[i], ...units.map((_, j) => (i === j ? '-' : `${win[i][j]}${draws[i][j] ? ` (${draws[i][j]})` : ''}`))]) + '\n');
}
process.stdout.write(`\nCost efficiency of row vs column (enemy value killed / own value lost)\n${line(head)}\n${sep}\n`);
for (let i = 0; i < units.length; i++) {
  process.stdout.write(line([units[i], ...units.map((_, j) => (i === j ? '-' : eff[i][j].toFixed(2)))]) + '\n');
}
