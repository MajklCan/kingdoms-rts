/**
 * Real-relay smoke: starts relay/server.mjs on a free local port, connects two
 * clients over real WebSockets (the browser's WebSocketTransport, Node has a
 * global WebSocket), lets two AI bots play, and compares both worlds'
 * checksums after every tick. Never touches the deployed relay.
 *
 *   npx vite-node scripts/sim/relay-smoke.ts -- [--ticks 3000] [--seed 5] [--age 1] [--map riverlands]
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SIM } from '../../src/config';
import { checksumWorld } from '@sim/checksum';
import type { AgeIdValue } from '@sim/defs';
import type { MapIdValue } from '@sim/map-gen';
import { createSimWorld, type SimWorld } from '@sim/world';
import { MultiplayerSession } from '../../src/net/session';
import { WebSocketTransport } from '../../src/net/transport';
import { CommandBot } from '../../src/net/testing/ai-bot';
import { polluteEidAllocator, resetBitecsGlobals } from '../../src/net/testing/mp-match';
import { parseArgs } from './lib/args';

const args = parseArgs(process.argv.slice(2));
const ticks = Number(args.ticks ?? 3000);
const seed = Number(args.seed ?? 5);
const startingAge = Number(args.age ?? 1) as AgeIdValue;
const mapId = (args.map ?? 'riverlands') as MapIdValue;
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => done(port));
    });
  });
}

/** relay/ has its own `ws` dependency; a git worktree may not have it
 *  installed, so run a copy next to the nearest installed node_modules. */
function relayEntry(): string {
  const local = join(repo, 'relay');
  if (existsSync(join(local, 'node_modules', 'ws'))) return join(local, 'server.mjs');
  let dir = repo;
  for (let i = 0; i < 6; i++) {
    dir = dirname(dir);
    const modules = join(dir, 'relay', 'node_modules');
    if (!existsSync(join(modules, 'ws'))) continue;
    const scratch = join(repo, '.context', 'relay-smoke');
    rmSync(scratch, { recursive: true, force: true });
    mkdirSync(scratch, { recursive: true });
    copyFileSync(join(local, 'server.mjs'), join(scratch, 'server.mjs'));
    symlinkSync(modules, join(scratch, 'node_modules'));
    return join(scratch, 'server.mjs');
  }
  throw new Error('relay dependency ws not installed (run npm ci in relay/)');
}

async function startRelay(port: number): Promise<ChildProcess> {
  const child = spawn(process.execPath, [relayEntry()], {
    env: { ...process.env, PORT: String(port), ROOM_SUMMARY_MS: '600000', STALE_ROOM_MS: '600000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((done, fail) => {
    const timer = setTimeout(() => fail(new Error('relay did not start')), 10_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('listening')) {
        clearTimeout(timer);
        done();
      }
    });
    child.once('exit', (code) => fail(new Error(`relay exited ${code}`)));
  });
  return child;
}

async function main(): Promise<void> {
  resetBitecsGlobals();
  const port = await freePort();
  const relay = await startRelay(port);
  const url = `ws://127.0.0.1:${port}`;
  const room = `smoke-${seed}-${port}`;
  const hashes = [new Map<number, number>(), new Map<number, number>()];
  let compared = 0;
  let desync: number | null = null;
  let worldsCreated = 0;
  const createWorld = (s: number): SimWorld => {
    if (worldsCreated++ > 0) polluteEidAllocator();
    return createSimWorld(s, { mapId, startingAge });
  };

  const stepped = [0, 0];
  const sessions: MultiplayerSession[] = [];
  const bots: Array<CommandBot | null> = [null, null];
  const silence = { info: console.info, warn: console.warn };
  console.info = () => {};
  for (const index of [0, 1]) {
    const transport = new WebSocketTransport(url);
    const session: MultiplayerSession = new MultiplayerSession(
      transport,
      room,
      `smoke${index + 1}`,
      {
        onMatchStart: (_world, localPlayerId) => {
          bots[index] = new CommandBot(localPlayerId, 'medium', (input) => session.sendCommand(input));
        },
        onTickStepped: (world, tick) => {
          stepped[index] = tick + 1;
          world.combatEvents.length = 0;
          world.soundCues.length = 0;
          world.aiEvents.length = 0;
          world.gameEvents.length = 0;
          const hash = checksumWorld(world);
          const other = hashes[1 - index].get(tick);
          if (other === undefined) hashes[index].set(tick, hash);
          else {
            hashes[1 - index].delete(tick);
            compared++;
            if (other !== hash && desync === null) desync = tick;
          }
          bots[index]?.maybeThink(world);
        },
      },
      { createWorld }
    );
    const send = transport.send.bind(transport);
    transport.send = (msg) => {
      if (msg.t === 'turn' && msg.cmds.length > 0) bots[index]?.onTurnSent(msg.forTick, msg.cmds.length);
      send(msg);
    };
    sessions.push(session);
  }

  const started = Date.now();
  const yieldIo = (): Promise<void> => new Promise((done) => setImmediate(done));
  let startSent = false;
  let lastProgress = Date.now();
  let lastTotal = 0;
  while (Math.min(...stepped) < ticks && desync === null) {
    const [host] = sessions;
    if (!startSent && host.state === 'lobby' && host.isHost && host.players.length === 2) {
      startSent = true;
      host.start(seed);
    }
    for (const session of sessions) session.update(SIM.TICK_MS);
    await yieldIo();
    const total = stepped[0] + stepped[1];
    if (total !== lastTotal) {
      lastTotal = total;
      lastProgress = Date.now();
    }
    if (sessions.some((s) => ['desync', 'peer-left', 'disconnected', 'left'].includes(s.state))) break;
    if (Date.now() - lastProgress > 15_000) {
      console.warn('no progress for 15 s', sessions.map((s) => s.debugSnapshot().lockstep));
      break;
    }
  }
  const states = sessions.map((s) => s.state);
  const commands = bots.map((b) => b?.stats.commands ?? 0);
  for (const s of sessions) s.leave();
  await new Promise((done) => setTimeout(done, 200));
  relay.kill();
  console.info = silence.info;
  const ok = desync === null && Math.min(...stepped) >= ticks && states.every((s) => s === 'playing');
  console.log(
    `${ok ? 'ok' : 'FAIL'} relay ws://127.0.0.1:${port} seed=${seed} map=${mapId} age=${startingAge} ` +
      `ticks=${stepped.join('/')} compared=${compared} desync=${desync ?? '-'} states=${states.join('/')} ` +
      `cmds=${commands.join('/')} wall=${Date.now() - started}ms`
  );
  process.exitCode = ok ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
