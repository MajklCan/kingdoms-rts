/**
 * Ad-hoc end-to-end relay smoke test (NOT part of the build).
 * Spins up two WebSocket clients against a live relay, walks the full
 * join → start → turn → checksum handshake, and asserts the relay
 * rebroadcasts each frame to the other peer. Exits non-zero on failure.
 *
 * Usage: node test-relay.mjs ws://host[:port]
 */
import { WebSocket } from 'ws';

const URL = process.argv[2] ?? 'ws://localhost:8080';
const ROOM = 'smoke-' + (process.env.ROOM ?? 'r1');
const PROTOCOL_VERSION = 1;
const log = (...a) => console.log(...a);

function client(name) {
  const ws = new WebSocket(URL);
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const msg = JSON.parse(d.toString());
    inbox.push(msg);
    const w = waiters.find((x) => x.pred(msg));
    if (w) {
      waiters.splice(waiters.indexOf(w), 1);
      w.resolve(msg);
    }
  });
  const send = (m) => ws.send(JSON.stringify(m));
  const waitFor = (pred, label) =>
    new Promise((resolve, reject) => {
      const hit = inbox.find(pred);
      if (hit) return resolve(hit);
      const t = setTimeout(() => reject(new Error(`${name}: timeout waiting for ${label}`)), 10000);
      waiters.push({ pred, resolve: (m) => { clearTimeout(t); resolve(m); } });
    });
  const open = new Promise((res, rej) => {
    ws.on('open', res);
    ws.on('error', rej);
  });
  return { ws, send, waitFor, open };
}

async function main() {
  let failed = false;
  const assert = (cond, label) => {
    log(`${cond ? '✅' : '❌'} ${label}`);
    if (!cond) failed = true;
  };

  log(`relay = ${URL}  room = ${ROOM}`);
  const host = client('host');
  const peer = client('peer');
  await Promise.all([host.open, peer.open]);

  // join
  host.send({ t: 'join', v: PROTOCOL_VERSION, room: ROOM, name: 'Host' });
  const hJoined = await host.waitFor((m) => m.t === 'joined', 'host joined');
  assert(hJoined.playerId === 1 && hJoined.isHost === true, 'host got slot 1 + isHost');

  peer.send({ t: 'join', v: PROTOCOL_VERSION, room: ROOM, name: 'Peer' });
  const pJoined = await peer.waitFor((m) => m.t === 'joined', 'peer joined');
  assert(pJoined.playerId === 2 && pJoined.isHost === false, 'peer got slot 2, not host');

  // host sees roster update with 2 players
  const roster = await host.waitFor(
    (m) => m.t === 'roster' && m.players.length === 2,
    'host roster=2'
  );
  assert(roster.players.length === 2, 'roster has both players');

  // start (host only)
  host.send({ t: 'start', seed: 12345 });
  const hStart = await host.waitFor((m) => m.t === 'start', 'host start echo');
  const pStart = await peer.waitFor((m) => m.t === 'start', 'peer start');
  assert(hStart.seed === 12345 && pStart.seed === 12345, 'both got start seed 12345');

  // turn frame: host -> relay -> peer
  host.send({ t: 'turn', forTick: 4, cmds: [{ kind: 'cmdTest', x: 1 }] });
  const pTurn = await peer.waitFor((m) => m.t === 'turn' && m.forTick === 4, 'peer got host turn');
  assert(pTurn.playerId === 1 && pTurn.cmds.length === 1, 'peer received host turn (pid=1)');

  // checksum frame: peer -> relay -> host
  peer.send({ t: 'checksum', tick: 20, hash: 0xdeadbeef });
  const hCk = await host.waitFor((m) => m.t === 'checksum' && m.tick === 20, 'host got peer checksum');
  assert(hCk.playerId === 2 && hCk.hash === 0xdeadbeef, 'host received peer checksum (pid=2)');

  // peer-left: close host, peer should be told
  host.ws.close();
  const pLeft = await peer.waitFor((m) => m.t === 'peer-left', 'peer got peer-left');
  assert(pLeft.playerId === 1, 'peer notified host (pid=1) left');

  peer.ws.close();
  log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('❌ ERROR:', e.message);
  process.exit(1);
});
