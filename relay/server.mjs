/**
 * Kingdoms lockstep relay — a dumb, low-bandwidth message switch.
 *
 * It assigns player slots, coordinates match start (seed agreement), and
 * rebroadcasts turn/checksum frames within a room. It NEVER runs the sim; it
 * only logs bounded command summaries for diagnostics. All gameplay logic
 * lives on the clients.
 *
 * Wire protocol mirrors src/net/protocol.ts. One WebSocket per client.
 *
 * Env:
 *   PORT                 listen port (default 8080)
 *   MAX_SLOTS            human players per room (default 2 — 1v1; sim supports ids 1..2)
 *   LOG_TURN_FRAMES      "1" logs every turn frame; default logs command/checkpoint turns only
 *   TURN_LOG_INTERVAL    checkpoint interval for empty turn frames (default 20)
 *   ROOM_SUMMARY_MS      active-room summary cadence (default 5000)
 *   STALE_ROOM_MS        warn if an active room receives no frames this long (default 10000)
 */

import http from 'node:http';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT ?? 8080);
const MAX_SLOTS = Number(process.env.MAX_SLOTS ?? 2);
const PROTOCOL_VERSION = 1;
const LOG_TURN_FRAMES = process.env.LOG_TURN_FRAMES === '1';
const TURN_LOG_INTERVAL = Math.max(1, Number(process.env.TURN_LOG_INTERVAL ?? 20));
const ROOM_SUMMARY_MS = Math.max(1000, Number(process.env.ROOM_SUMMARY_MS ?? 5000));
const STALE_ROOM_MS = Math.max(1000, Number(process.env.STALE_ROOM_MS ?? 10000));
const RECENT_CHECKSUM_TICKS = 12;

let nextMatchId = 1;
let nextConnectionId = 1;

/**
 * room name -> {
 *   started, createdAt, clients, matchId, startedAt, playerIds,
 *   turns, commandTurns, checksums, messages, bytes,
 *   turnsByPlayer, commandTurnsByPlayer, checksumsByPlayer,
 *   lastTurns, lastTurnAt, lastCommandTurns, lastChecksums, lastChecksumHashes,
 *   checksumTicks, lastMessageAt, lastCommandAt, lastSummaryAt, lastStaleLogAt
 * }
 */
const rooms = new Map();

function getRoom(name) {
  let room = rooms.get(name);
  if (!room) {
    const now = Date.now();
    room = {
      name,
      started: false,
      createdAt: new Date(now).toISOString(),
      clients: new Map(),
      matchId: null,
      startedAt: null,
      playerIds: [],
      turns: 0,
      commandTurns: 0,
      checksums: 0,
      messages: 0,
      bytes: 0,
      turnsByPlayer: new Map(),
      commandTurnsByPlayer: new Map(),
      checksumsByPlayer: new Map(),
      lastTurns: new Map(),
      lastTurnAt: new Map(),
      lastCommandTurns: new Map(),
      lastChecksums: new Map(),
      lastChecksumHashes: new Map(),
      checksumTicks: new Map(),
      lastMessageAt: now,
      lastCommandAt: null,
      lastSummaryAt: 0,
      lastStaleLogAt: 0,
    };
    rooms.set(name, room);
    log('room-create', { room: name, createdAt: room.createdAt });
  }
  return room;
}

function log(event, fields = {}) {
  console.log(`[relay] ${event} ${JSON.stringify({ ts: new Date().toISOString(), ...fields })}`);
}

function playerMap(map) {
  return Object.fromEntries([...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([playerId, value]) => [String(playerId), value]));
}

function expectedPlayerIds(room) {
  return room.playerIds.length > 0
    ? room.playerIds.slice()
    : [...room.clients.keys()].sort((a, b) => a - b);
}

function turnSkew(room) {
  const values = expectedPlayerIds(room)
    .map((playerId) => room.lastTurns.get(playerId))
    .filter((value) => Number.isFinite(value));
  if (values.length <= 1) return 0;
  return Math.max(...values) - Math.min(...values);
}

function roomSummary(room) {
  const now = Date.now();
  return {
    matchId: room.matchId,
    started: room.started,
    startedAt: room.startedAt,
    players: room.clients.size,
    expectedPlayers: expectedPlayerIds(room),
    turns: room.turns,
    commandTurns: room.commandTurns,
    checksums: room.checksums,
    messages: room.messages,
    bytes: room.bytes,
    turnSkew: turnSkew(room),
    lastMessageAgeMs: Math.max(0, now - room.lastMessageAt),
    lastCommandAgeMs: room.lastCommandAt === null ? null : Math.max(0, now - room.lastCommandAt),
    turnsByPlayer: playerMap(room.turnsByPlayer),
    commandTurnsByPlayer: playerMap(room.commandTurnsByPlayer),
    checksumsByPlayer: playerMap(room.checksumsByPlayer),
    lastTurns: playerMap(room.lastTurns),
    lastCommandTurns: playerMap(room.lastCommandTurns),
    lastChecksums: playerMap(room.lastChecksums),
    lastChecksumHashes: playerMap(room.lastChecksumHashes),
  };
}

function bump(map, key, delta = 1) {
  map.set(key, (map.get(key) ?? 0) + delta);
}

function commandTypes(cmds) {
  if (!Array.isArray(cmds) || cmds.length === 0) return [];
  return cmds.map((cmd) => (cmd && typeof cmd.type === 'string' ? cmd.type : typeof cmd));
}

function safeNumber(value) {
  return Number.isFinite(value) ? Number(value) : null;
}

function safePoint(value) {
  if (!value || typeof value !== 'object') return null;
  const x = safeNumber(value.x);
  const y = safeNumber(value.y);
  if (x === null || y === null) return null;
  return { x, y };
}

function summarizeEids(eids) {
  if (!Array.isArray(eids)) return undefined;
  return {
    count: eids.length,
    first: eids.slice(0, 12).map((eid) => safeNumber(eid)).filter((eid) => eid !== null),
  };
}

function summarizeCommand(cmd) {
  if (!cmd || typeof cmd !== 'object') return { type: typeof cmd };
  const summary = {
    type: typeof cmd.type === 'string' ? cmd.type : typeof cmd,
  };
  const numericFields = [
    'playerId',
    'defId',
    'x',
    'y',
    'atEid',
    'targetEid',
    'techId',
    'stance',
    'mode',
    'delta',
    'count',
  ];
  for (const field of numericFields) {
    if (!(field in cmd)) continue;
    const value = safeNumber(cmd[field]);
    if (value !== null) summary[field] = value;
  }
  const to = safePoint(cmd.to);
  if (to) summary.to = to;
  const eids = summarizeEids(cmd.eids);
  if (eids) summary.eids = eids;
  const known = new Set([...numericFields, 'type', 'to', 'eids']);
  const extraKeys = Object.keys(cmd).filter((key) => !known.has(key)).sort();
  if (extraKeys.length > 0) summary.extraKeys = extraKeys.slice(0, 8);
  return summary;
}

function commandSummaries(cmds) {
  if (!Array.isArray(cmds) || cmds.length === 0) return [];
  return cmds.slice(0, 16).map(summarizeCommand);
}

function commandPayloadBytes(cmds) {
  try {
    return Buffer.byteLength(JSON.stringify(cmds));
  } catch {
    return null;
  }
}

function recordRoomMessage(room, ws, data) {
  room.messages += 1;
  room.bytes += typeof data === 'string' ? Buffer.byteLength(data) : data?.length ?? 0;
  room.lastMessageAt = Date.now();
  ws.messages = (ws.messages ?? 0) + 1;
  ws.bytes = (ws.bytes ?? 0) + (typeof data === 'string' ? Buffer.byteLength(data) : data?.length ?? 0);
  ws.lastMessageAt = room.lastMessageAt;
}

function compareChecksum(room, playerId, tick, hash) {
  let tickMap = room.checksumTicks.get(tick);
  if (!tickMap) {
    tickMap = new Map();
    room.checksumTicks.set(tick, tickMap);
  }
  tickMap.set(playerId, hash >>> 0);

  const expected = expectedPlayerIds(room);
  const hashes = Object.fromEntries([...tickMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([pid, h]) => [String(pid), h >>> 0]));
  if (tickMap.size >= Math.max(1, expected.length)) {
    const unique = new Set(tickMap.values());
    log(unique.size === 1 ? 'checksum-match' : 'checksum-mismatch', {
      room: room.name,
      tick,
      matchId: room.matchId,
      expectedPlayers: expected,
      hashes,
      ...roomSummary(room),
    });
  }

  const sortedTicks = [...room.checksumTicks.keys()].sort((a, b) => b - a);
  for (const oldTick of sortedTicks.slice(RECENT_CHECKSUM_TICKS)) {
    room.checksumTicks.delete(oldTick);
  }
}

function logRoomSnapshots() {
  const now = Date.now();
  for (const [roomName, room] of rooms) {
    if (!room.started) continue;
    if (now - room.lastSummaryAt >= ROOM_SUMMARY_MS) {
      room.lastSummaryAt = now;
      log('room-summary', { room: roomName, ...roomSummary(room) });
    }
    if (now - room.lastMessageAt >= STALE_ROOM_MS && now - room.lastStaleLogAt >= STALE_ROOM_MS) {
      room.lastStaleLogAt = now;
      log('room-stale', { room: roomName, staleForMs: now - room.lastMessageAt, ...roomSummary(room) });
    }
  }
}

setInterval(logRoomSnapshots, Math.min(ROOM_SUMMARY_MS, STALE_ROOM_MS)).unref?.();

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
  if (ws.readyState !== ws.OPEN) {
    log('send-skip', {
      connectionId: ws.connectionId,
      room: ws.roomName,
      playerId: ws.playerId,
      readyState: ws.readyState,
      msgType: msg?.t,
    });
    return;
  }
  try {
    ws.send(JSON.stringify(msg));
  } catch (err) {
    log('send-error', {
      connectionId: ws.connectionId,
      room: ws.roomName,
      playerId: ws.playerId,
      msgType: msg?.t,
      error: err?.message ?? String(err),
    });
  }
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

wss.on('connection', (ws, req) => {
  ws.connectionId = nextConnectionId++;
  ws.roomName = null;
  ws.playerId = null;
  ws.playerName = null;
  ws.openedAt = Date.now();
  ws.lastMessageAt = null;
  ws.messages = 0;
  ws.bytes = 0;

  log('connection-open', {
    connectionId: ws.connectionId,
    remoteAddress: req.socket.remoteAddress,
    forwardedFor: req.headers['x-forwarded-for'] ?? null,
    userAgent: req.headers['user-agent'] ?? null,
  });

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      log('bad-json', {
        connectionId: ws.connectionId,
        room: ws.roomName,
        playerId: ws.playerId,
        bytes: data?.length ?? 0,
      });
      return;
    }
    if (!msg || typeof msg.t !== 'string') {
      log('bad-message', {
        connectionId: ws.connectionId,
        room: ws.roomName,
        playerId: ws.playerId,
        rawType: typeof msg,
      });
      return;
    }
    if (ws.roomName) {
      const room = rooms.get(ws.roomName);
      if (room) recordRoomMessage(room, ws, data);
    }

    switch (msg.t) {
      case 'join': {
        if (ws.roomName) {
          log('reject', {
            connectionId: ws.connectionId,
            room: ws.roomName,
            playerId: ws.playerId,
            reason: 'already_joined',
          });
          return;
        }
        if (msg.v !== PROTOCOL_VERSION) {
          log('reject', { connectionId: ws.connectionId, reason: 'protocol_mismatch', got: msg.v });
          send(ws, { t: 'error', message: `protocol mismatch (server v${PROTOCOL_VERSION})` });
          ws.close();
          return;
        }
        const room = getRoom(String(msg.room));
        recordRoomMessage(room, ws, data);
        if (room.started) {
          log('reject', {
            connectionId: ws.connectionId,
            room: String(msg.room),
            reason: 'match_started',
            ...roomSummary(room),
          });
          send(ws, { t: 'error', message: 'match already started' });
          ws.close();
          return;
        }
        const slot = nextSlot(room);
        if (slot === null) {
          log('reject', {
            connectionId: ws.connectionId,
            room: String(msg.room),
            reason: 'room_full',
            ...roomSummary(room),
          });
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
        log('join', {
          connectionId: ws.connectionId,
          room: ws.roomName,
          playerId: slot,
          name: ws.playerName,
          players: room.clients.size,
        });
        return;
      }
      case 'start': {
        const room = rooms.get(ws.roomName);
        if (!room) {
          log('drop', { connectionId: ws.connectionId, msgType: 'start', reason: 'no_room' });
          return;
        }
        if (ws.playerId !== 1 || room.started) {
          log('drop', {
            connectionId: ws.connectionId,
            room: ws.roomName,
            playerId: ws.playerId,
            msgType: 'start',
            reason: ws.playerId !== 1 ? 'not_host' : 'already_started',
            ...roomSummary(room),
          });
          return;
        }
        room.started = true;
        room.matchId = nextMatchId++;
        room.startedAt = new Date().toISOString();
        room.playerIds = roster(room).map((p) => p.playerId);
        room.turns = 0;
        room.checksums = 0;
        room.messages = 0;
        room.bytes = 0;
        room.turnsByPlayer.clear();
        room.commandTurnsByPlayer.clear();
        room.checksumsByPlayer.clear();
        room.lastTurns.clear();
        room.lastTurnAt.clear();
        room.lastCommandTurns.clear();
        room.lastChecksums.clear();
        room.lastChecksumHashes.clear();
        room.checksumTicks.clear();
        room.lastMessageAt = Date.now();
        room.lastCommandAt = null;
        room.lastSummaryAt = 0;
        room.lastStaleLogAt = 0;
        broadcast(room, { t: 'start', seed: msg.seed | 0, players: roster(room) });
        log('start', {
          connectionId: ws.connectionId,
          room: ws.roomName,
          matchId: room.matchId,
          seed: msg.seed | 0,
          players: room.playerIds,
        });
        return;
      }
      case 'turn': {
        const room = rooms.get(ws.roomName);
        if (!room) {
          log('drop', { connectionId: ws.connectionId, msgType: 'turn', reason: 'no_room' });
          return;
        }
        const forTick = Number(msg.forTick);
        const cmds = Array.isArray(msg.cmds) ? msg.cmds : [];
        room.turns += 1;
        bump(room.turnsByPlayer, ws.playerId);
        room.lastTurns.set(ws.playerId, forTick);
        room.lastTurnAt.set(ws.playerId, new Date().toISOString());
        if (cmds.length > 0) {
          room.commandTurns += 1;
          room.lastCommandAt = Date.now();
          bump(room.commandTurnsByPlayer, ws.playerId);
          room.lastCommandTurns.set(ws.playerId, forTick);
        }
        if (LOG_TURN_FRAMES || cmds.length > 0 || forTick % TURN_LOG_INTERVAL === 0) {
          log(cmds.length > 0 ? 'turn-command' : 'turn-checkpoint', {
            connectionId: ws.connectionId,
            room: ws.roomName,
            matchId: room.matchId,
            playerId: ws.playerId,
            forTick,
            cmdCount: cmds.length,
            cmdTypes: commandTypes(cmds),
            cmds: commandSummaries(cmds),
            cmdPayloadBytes: commandPayloadBytes(cmds),
            ...roomSummary(room),
          });
        }
        broadcast(
          room,
          { t: 'turn', playerId: ws.playerId, forTick, cmds },
          ws.playerId
        );
        return;
      }
      case 'checksum': {
        const room = rooms.get(ws.roomName);
        if (!room) {
          log('drop', { connectionId: ws.connectionId, msgType: 'checksum', reason: 'no_room' });
          return;
        }
        const tick = Number(msg.tick);
        const hash = Number(msg.hash) >>> 0;
        room.checksums += 1;
        bump(room.checksumsByPlayer, ws.playerId);
        room.lastChecksums.set(ws.playerId, tick);
        room.lastChecksumHashes.set(ws.playerId, hash);
        log('checksum', {
          connectionId: ws.connectionId,
          room: ws.roomName,
          matchId: room.matchId,
          playerId: ws.playerId,
          tick,
          hash,
          ...roomSummary(room),
        });
        compareChecksum(room, ws.playerId, tick, hash);
        broadcast(
          room,
          { t: 'checksum', playerId: ws.playerId, tick, hash },
          ws.playerId
        );
        return;
      }
      default:
        log('unknown-message', {
          connectionId: ws.connectionId,
          room: ws.roomName,
          playerId: ws.playerId,
          msgType: msg.t,
        });
        return;
    }
  });

  ws.on('error', (err) => {
    log('connection-error', {
      connectionId: ws.connectionId,
      room: ws.roomName,
      playerId: ws.playerId,
      error: err?.message ?? String(err),
    });
  });

  ws.on('close', (code, reason) => {
    const room = rooms.get(ws.roomName);
    const base = {
      connectionId: ws.connectionId,
      room: ws.roomName,
      playerId: ws.playerId,
      code,
      reason: reason?.toString?.() ?? '',
      lifetimeMs: Date.now() - ws.openedAt,
      messages: ws.messages,
      bytes: ws.bytes,
      lastMessageAgeMs: ws.lastMessageAt === null ? null : Date.now() - ws.lastMessageAt,
    };
    if (!room) {
      log('connection-close', base);
      return;
    }
    room.clients.delete(ws.playerId);
    log('leave', {
      ...base,
      remaining: room.clients.size,
      ...roomSummary(room),
    });
    broadcast(room, { t: 'peer-left', playerId: ws.playerId });
    if (room.clients.size === 0) rooms.delete(ws.roomName);
  });
});

server.listen(PORT, () => {
  console.log(`[relay] listening on :${PORT} (max ${MAX_SLOTS} slots/room)`);
});
