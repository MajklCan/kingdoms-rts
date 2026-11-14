// Summarise a V8 .cpuprofile: top functions by self time and by inclusive time.
//   node scripts/sim/prof-top.mjs <file.cpuprofile> [count]
import { readFileSync } from 'node:fs';

const [file, countArg] = process.argv.slice(2);
const prof = JSON.parse(readFileSync(file, 'utf8'));
const count = Number(countArg ?? 30);
const byId = new Map(prof.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = new Map();
for (let i = 0; i < prof.samples.length; i++) {
  const id = prof.samples[i];
  dt.set(id, (dt.get(id) ?? 0) + (prof.timeDeltas[i] ?? 0));
}
const parent = new Map();
for (const n of prof.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const key = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-2).join('/')}:${n.callFrame.lineNumber + 1}`;
const incl = new Map();
for (const [id, t] of dt) {
  const k = key(byId.get(id));
  self.set(k, (self.get(k) ?? 0) + t);
  const seen = new Set();
  let cur = id;
  while (cur !== undefined) {
    const kk = key(byId.get(cur));
    if (!seen.has(kk)) {
      incl.set(kk, (incl.get(kk) ?? 0) + t);
      seen.add(kk);
    }
    cur = parent.get(cur);
  }
}
const total = [...dt.values()].reduce((a, b) => a + b, 0);
const show = (title, m) => {
  console.log(`\n${title} (total ${(total / 1000).toFixed(0)} ms)`);
  for (const [k, t] of [...m].sort((a, b) => b[1] - a[1]).slice(0, count)) {
    console.log(`${((t / total) * 100).toFixed(1).padStart(5)}%  ${k}`);
  }
};
show('self', self);
show('inclusive', incl);
