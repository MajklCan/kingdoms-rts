// Fan a sim script out over processes (one shard each) and merge the JSON.
//   node scripts/sim/batch.mjs <name> <procs> <script.ts> [script args...]
// Each shard runs `vite-node <script> -- <args> --shard i/procs --out .context/sim/<name>-i.json`;
// the merged array lands in .context/sim/<name>.json. Shard stdout goes to
// .context/sim/<name>-i.log; failing lines (FAIL, flags=) are echoed.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [name, procsArg, script, ...rest] = process.argv.slice(2);
if (!name || !procsArg || !script) {
  console.error('usage: node scripts/sim/batch.mjs <name> <procs> <script.ts> [args...]');
  process.exit(2);
}
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = join(repo, '.context', 'sim');
mkdirSync(outDir, { recursive: true });

function findBin(bin) {
  let dir = repo;
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'node_modules', '.bin', bin);
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error(`${bin} not found`);
}

const viteNode = findBin('vite-node');
const procs = Number(procsArg);
const started = Date.now();
const runs = Array.from({ length: procs }, (_, i) => new Promise((done) => {
  const out = join(outDir, `${name}-${i}.json`);
  // Shard logs stream to disk so a long batch can be watched (wc -l *.log).
  const logPath = join(outDir, `${name}-${i}.log`);
  writeFileSync(logPath, '');
  const child = spawn(viteNode, [script, '--', ...rest, '--shard', `${i}/${procs}`, '--out', out], { cwd: repo });
  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    appendFileSync(logPath, text);
    for (const line of text.split('\n')) if (/FAIL|desync=\d/.test(line)) process.stdout.write(`[${i}] ${line}\n`);
  });
  child.stderr.on('data', (chunk) => appendFileSync(logPath, chunk.toString()));
  child.on('exit', (code) => done({ i, code, out }));
}));

const results = await Promise.all(runs);
const merged = [];
for (const { i, code, out } of results) {
  if (!existsSync(out)) {
    console.error(`shard ${i} wrote no output (exit ${code}); see ${name}-${i}.log`);
    continue;
  }
  merged.push(...JSON.parse(readFileSync(out, 'utf8')));
}
writeFileSync(join(outDir, `${name}.json`), JSON.stringify(merged));
console.log(`${name}: ${merged.length} records from ${procs} shards in ${Math.round((Date.now() - started) / 1000)} s -> .context/sim/${name}.json`);
