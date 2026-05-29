/**
 * Kingdoms lockstep relay — a dumb, low-bandwidth message switch.
 *
 * It assigns player slots, coordinates match start (seed agreement), and
 * rebroadcasts turn/checksum frames within a room. It NEVER runs the sim and
 * never inspects command contents. All gameplay logic lives on the clients.
 *
 * Wire protocol mirrors src/net/protocol.ts. One WebSocket per client.
 *
 * Env:
 *   PORT       listen port (default 8080)
 *   MAX_SLOTS  human players per room (default 2 — 1v1; sim supports ids 1..2)
 */

import http from 'node:http';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT ?? 8080);
const MAX_SLOTS = Number(process.env.MAX_SLOTS ?? 2);
const PROTOCOL_VERSION = 1;

/** room name -> { started, clients: Map<playerId, ws> } */
const rooms = new Map();

function getRoom(name) {
  let room = rooms.get(name);
  if (!room) {
    room = { started: false, clients: new Map() };
    rooms.set(name, room);
  }
  return room;
}

function roster(room) {
  return [...room.clients.entries()]
    .map(([playerId, ws]) => ({ playerId, name: ws.playerName ?? `Player ${playerId}` }))
    .sort((a, b) => a.playerId - b.playerId);
}

/** Lowest free player id starting at 1 (1 = host). */
function nextSlot(room) {
  for (let id = 1; id <= MAX_SLOTS; id++) {
    if (!room.clients.has(id)) return id;
  }
  return null;
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg, exceptPlayerId = null) {
  for (const [pid, ws] of room.clients) {
    if (pid === exceptPlayerId) continue;
    send(ws, msg);
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok\n');
    return;
  }
  res.writeHead(426, { 'content-type': 'text/plain' });
  res.end('upgrade required\n');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.roomName = null;
  ws.playerId = null;
  ws.playerName = null;

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg.t !== 'string') return;

    switch (msg.t) {
      case 'join': {
        if (ws.roomName) return; // already joined
        if (msg.v !== PROTOCOL_VERSION) {
          send(ws, { t: 'error', message: `protocol mismatch (server v${PROTOCOL_VERSION})` });
          ws.close();
          return;
        }
        const room = getRoom(String(msg.room));
        if (room.started) {
          send(ws, { t: 'error', message: 'match already started' });
          ws.close();
          return;
        }
        const slot = nextSlot(room);
        if (slot === null) {
          send(ws, { t: 'error', message: 'room full' });
          ws.close();
          return;
        }
        ws.roomName = String(msg.room);
        ws.playerId = slot;
        ws.playerName = String(msg.name ?? `Player ${slot}`).slice(0, 32);
        room.clients.set(slot, ws);
        send(ws, {
          t: 'joined',
          v: PROTOCOL_VERSION,
          room: ws.roomName,
          playerId: slot,
          isHost: slot === 1,
          players: roster(room),
        });
        broadcast(room, { t: 'roster', players: roster(room) });
        return;
      }
      case 'start': {
        const room = rooms.get(ws.roomName);
        if (!room || ws.playerId !== 1 || room.started) return; // host only
        room.started = true;
        broadcast(room, { t: 'start', seed: msg.seed | 0, players: roster(room) });
        return;
      }
      case 'turn': {
        const room = rooms.get(ws.roomName);
        if (!room) return;
        broadcast(
          room,
          { t: 'turn', playerId: ws.playerId, forTick: msg.forTick, cmds: msg.cmds ?? [] },
          ws.playerId
        );
        return;
      }
      case 'checksum': {
        const room = rooms.get(ws.roomName);
        if (!room) return;
        broadcast(
          room,
          { t: 'checksum', playerId: ws.playerId, tick: msg.tick, hash: msg.hash },
          ws.playerId
        );
        return;
      }
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ws.roomName);
    if (!room) return;
    room.clients.delete(ws.playerId);
    broadcast(room, { t: 'peer-left', playerId: ws.playerId });
    if (room.clients.size === 0) rooms.delete(ws.roomName);
  });
});

server.listen(PORT, () => {
  console.log(`[relay] listening on :${PORT} (max ${MAX_SLOTS} slots/room)`);
});
