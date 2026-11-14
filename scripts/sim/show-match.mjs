// Print one recorded match (from ai-vs-ai.ts --timeline --out) as a compact table.
//   node scripts/sim/show-match.mjs <file.json> [matchIndex] [everyNthSample]
import { readFileSync } from 'node:fs';

const [file, indexArg, everyArg] = process.argv.slice(2);
const matches = JSON.parse(readFileSync(file, 'utf8'));
const m = matches[Number(indexArg ?? 0)];
const every = Number(everyArg ?? 3);
console.log(JSON.stringify(m.config), 'winner', m.winner, 'end', m.endTick, 'flags', m.flags.join(','));
for (const p of [1, 2]) {
  const pr = m.players[p];
  console.log(`\nP${p} ${pr.difficulty} ageUps=${JSON.stringify(pr.ageUps)}`);
  console.log(`  trained=${JSON.stringify(pr.trained)}`);
  console.log(`  built=${JSON.stringify(pr.built)}`);
  console.log(`  lostUnits=${JSON.stringify(pr.lostUnits)} lostBuildings=${JSON.stringify(pr.lostBuildings)}`);
  console.log(`  techs=${pr.techs.map((t) => `${t.techId}@${t.tick}`).join(' ')}`);
  console.log(`  plans=${pr.planTransitions.map((t) => `${t.to}@${t.tick}`).join(' ')}`);
  console.log(`  final=${JSON.stringify(pr.final)}`);
  const rows = (m.timeline[p] ?? []).filter((_, i, a) => i % every === 0 || i === a.length - 1);
  for (const s of rows) {
    const mil = Object.entries(s.military).map(([k, v]) => `${k.slice(0, 4)}${v}`).join(' ');
    const bld = Object.entries(s.buildings).map(([k, v]) => `${k.slice(0, 5)}${v}`).join(' ');
    console.log(
      `  t=${String(s.tick).padStart(5)} age${s.age} pop ${s.pop}/${s.popCap} vil${s.villagers} wrk${s.workers} idle${s.idleVillagers} ` +
      `bank ${s.bank.join('/')} gath ${s.gathered.join('/')} ${s.plan} stuck${s.stuckUnits} | ${mil} | ${bld} f${s.foundations} | kill${s.unitsKilled} lost${s.unitsLost} raze${s.buildingsRazed}`
    );
  }
}
