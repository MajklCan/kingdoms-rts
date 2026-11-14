/**
 * Test-only lockstep match: two MultiplayerSessions, each driven by a
 * CommandBot, talking through the in-memory relay on a virtual clock. Every
 * command goes the real way (toSelfDescribingInput, NetId encode, sanitize,
 * lockstep, JSON wire, decode). The harness compares both worlds' checksums
 * after every tick and, on the first mismatch, can replay the run to that
 * tick and diff the two worlds field by field.
 *
 * Deterministic: bitECS globals are reset first, the net has its own seeded
 * Rng, and nothing reads wall time, so the same config replays exactly.
 */

import * as bitecs from 'bitecs';
import { checksumWorld } from '@sim/checksum';
import type { AgeIdValue } from '@sim/defs';
import type { MapIdValue } from '@sim/map-gen';
import { loadSimWorldSnapshot, serializeSimWorld } from '@sim/save-load';
import { createSimWorld, entityForNetId, netIdForEntity, type AiDifficulty, type SimInput, type SimWorld } from '@sim/world';
import { MultiplayerSession, type SessionState } from '../session';
import { CommandBot, type CommandBotStats } from './ai-bot';
import { PERFECT_LINK, MemoryRelay, VirtualNet, type LinkConditions, type MemoryTransport } from './virtual-net';
import { describeWorld, diffDescriptions, type WorldDiffLine } from './world-diff';

export interface MpClientSpec {
  difficulty: AiDifficulty;
  link?: LinkConditions;
  /** Client update cadence in ms (a 60 fps rAF pump by default). */
  frameMs?: number;
  /** Extra uniform frame delay in [0, frameJitterMs). */
  frameJitterMs?: number;
}

export interface MpMatchContext {
  net: VirtualNet;
  relay: MemoryRelay;
  clients: MpClient[];
}

export interface MpClient {
  index: number;
  spec: MpClientSpec;
  transport: MemoryTransport;
  session: MultiplayerSession;
  bot: CommandBot | null;
  /** Lockstep ticks this client has stepped. */
  stepped: number;
  states: SessionState[];
  sessionDesync: { tick: number; local: number; peer: number } | null;
  nextUpdateAt: number;
  lastUpdateAt: number;
}

export interface MpMatchConfig {
  seed: number;
  mapId: MapIdValue;
  startingAge: AgeIdValue;
  clients: [MpClientSpec, MpClientSpec];
  /** Stop once both clients stepped this many lockstep ticks. */
  maxTicks: number;
  inputDelay?: number;
  /** Compare full checksums after every tick (default true). */
  checksumEveryTick?: boolean;
  /** Shift bitECS eid allocation between the two worlds, the way two
   *  browsers with different histories differ (default true). */
  pollute?: boolean;
  /** Stop when no client steps for this long (virtual ms, default 20 s). */
  hangMs?: number;
  /** Ticks to keep running after both worlds reached an outcome. */
  tailTicks?: number;
  /** Replace a client's world with a reload of its own save at that tick. */
  reloadAt?: { client: 0 | 1; tick: number };
  /** Called after a client stepped lockstep tick `tick`. */
  onTick?: (ctx: MpMatchContext, client: MpClient, tick: number) => void;
  /** Capture a field diff of both worlds right after this lockstep tick. */
  diffAtTick?: number;
  /** Adjust each freshly built match world (the same way on both clients). */
  prepareWorld?: (world: SimWorld) => void;
}

export interface MpMatchResult {
  ticks: [number, number];
  worldTicks: [number, number];
  outcomes: [string, string];
  winners: [number, number];
  states: [SessionState, SessionState];
  /** First lockstep tick whose checksums differed. */
  desyncTick: number | null;
  sessionDesync: boolean;
  hang: boolean;
  ticksCompared: number;
  commands: [CommandBotStats | null, CommandBotStats | null];
  diff: WorldDiffLine[] | null;
  /** checksumWorld of each client's world when the run stopped. */
  finalChecksums: [number, number];
  virtualMs: number;
  wallMs: number;
}

/** bitECS exports resetGlobals at runtime but not in its typings. */
export function resetBitecsGlobals(): void {
  (bitecs as unknown as { resetGlobals: () => void }).resetGlobals();
}

/** Leave 1200 recycled eids in bitECS's global FIFO, newest first, so the
 *  next world gets descending raw eids (the opposite of NetId order). */
export function polluteEidAllocator(count = 1200): void {
  const scratch = bitecs.createWorld();
  const eids: number[] = [];
  for (let i = 0; i < count; i++) eids.push(bitecs.addEntity(scratch));
  for (let i = eids.length - 1; i >= 0; i--) bitecs.removeEntity(scratch, eids[i]);
  bitecs.deleteWorld(scratch);
}

const TERMINAL: SessionState[] = ['desync', 'peer-left', 'disconnected', 'left'];

export function runMpMatch(config: MpMatchConfig): MpMatchResult {
  const started = Date.now();
  resetBitecsGlobals();
  const net = new VirtualNet(config.seed);
  const relay = new MemoryRelay(net);
  const checksumEveryTick = config.checksumEveryTick ?? true;
  const pollute = config.pollute ?? true;
  const hangMs = config.hangMs ?? 20_000;
  const tailTicks = config.tailTicks ?? 40;
  let worldsCreated = 0;
  const createWorld = (seed: number): SimWorld => {
    if (pollute && worldsCreated > 0) polluteEidAllocator();
    worldsCreated++;
    const world = createSimWorld(seed, { mapId: config.mapId, startingAge: config.startingAge });
    config.prepareWorld?.(world);
    return world;
  };

  const hashes: Array<Map<number, number>> = [new Map(), new Map()];
  let desyncTick: number | null = null;
  let ticksCompared = 0;
  let diff: WorldDiffLine[] | null = null;
  const diffSnapshots: Array<Map<string, string> | null> = [null, null];

  const ctx: MpMatchContext = { net, relay, clients: [] };
  config.clients.forEach((spec, index) => {
    const transport = relay.connect(spec.link ?? PERFECT_LINK);
    const client: MpClient = {
      index,
      spec,
      transport,
      session: null as unknown as MultiplayerSession,
      bot: null,
      stepped: 0,
      states: [],
      sessionDesync: null,
      nextUpdateAt: 0,
      lastUpdateAt: 0,
    };
    client.session = new MultiplayerSession(
      transport,
      'room',
      `bot${index + 1}`,
      {
        onStateChange: (state) => client.states.push(state),
        onMatchStart: (_world, localPlayerId) => {
          client.bot = new CommandBot(localPlayerId, spec.difficulty, (input) => client.session.sendCommand(input));
        },
        onDesync: (tick, local, peer) => {
          client.sessionDesync ??= { tick, local, peer };
        },
        onTickStepped: (world, tick) => {
          client.stepped = tick + 1;
          drainOutputBuffers(world);
          if (config.reloadAt && config.reloadAt.client === index && config.reloadAt.tick === tick) {
            reloadClientWorld(client, config);
          }
          const live = client.session.world ?? world;
          if (checksumEveryTick || tick % 20 === 19) {
            const mine = hashes[index];
            const theirs = hashes[1 - index];
            const hash = checksumWorld(live);
            const other = theirs.get(tick);
            if (other === undefined) {
              mine.set(tick, hash);
            } else {
              theirs.delete(tick);
              ticksCompared++;
              if (other !== hash && desyncTick === null) desyncTick = tick;
            }
          }
          if (config.diffAtTick === tick) diffSnapshots[index] = describeWorld(live);
          config.onTick?.(ctx, client, tick);
          client.bot?.maybeThink(client.session.world ?? live);
        },
      },
      { createWorld, inputDelay: config.inputDelay }
    );
    transport.onSent = (msg) => {
      if (msg.t === 'turn' && msg.cmds.length > 0) client.bot?.onTurnSent(msg.forTick, msg.cmds.length);
    };
    ctx.clients.push(client);
  });

  let startSent = false;
  let lastProgressAt = 0;
  let lastProgress = 0;
  let doneAt: number | null = null;
  let endedAt: number | null = null;

  for (;;) {
    const nextFrame = Math.min(...ctx.clients.map((c) => c.nextUpdateAt));
    const nextEvent = net.nextEventAt();
    if (nextEvent < nextFrame) {
      net.runUntil(nextEvent);
    } else {
      net.runUntil(nextFrame);
      for (const client of ctx.clients) {
        if (client.nextUpdateAt > net.now) continue;
        client.session.update(net.now - client.lastUpdateAt);
        client.lastUpdateAt = net.now;
        const frame = client.spec.frameMs ?? 1000 / 60;
        const jitter = client.spec.frameJitterMs ?? 0;
        client.nextUpdateAt = net.now + frame + (jitter > 0 ? net.rng.next() * jitter : 0);
      }
    }

    // Jittered links can let either client join first, so whoever the relay
    // made host starts the match.
    const host = ctx.clients.find((c) => c.session.isHost);
    if (!startSent && host && host.session.state === 'lobby' && host.session.players.length === 2) {
      startSent = true;
      host.session.start(config.seed);
    }

    const progress = ctx.clients.reduce((sum, c) => sum + c.stepped, 0);
    if (progress !== lastProgress) {
      lastProgress = progress;
      lastProgressAt = net.now;
    }

    if (desyncTick !== null && (config.diffAtTick === undefined || diffSnapshots.every(Boolean))) break;
    if (diffSnapshots.every(Boolean) && config.diffAtTick !== undefined) break;
    if (ctx.clients.some((c) => TERMINAL.includes(c.session.state))) {
      // Let the peer observe the terminal event (peer-left, desync) too.
      doneAt ??= net.now + 2000;
    }
    const worlds = ctx.clients.map((c) => c.session.world);
    const allEnded = worlds.every((w) => w && w.outcome.state !== 'playing');
    const minStepped = Math.min(...ctx.clients.map((c) => c.stepped));
    if (allEnded && endedAt === null) endedAt = Math.max(...ctx.clients.map((c) => c.stepped));
    if (endedAt !== null && minStepped >= endedAt + tailTicks) doneAt ??= net.now;
    if (minStepped >= config.maxTicks) doneAt ??= net.now;
    if (doneAt !== null && net.now >= doneAt) break;
    if (net.now - lastProgressAt > hangMs) break;
  }

  if (config.diffAtTick !== undefined && diffSnapshots[0] && diffSnapshots[1]) {
    diff = diffDescriptions(diffSnapshots[0], diffSnapshots[1]);
  }

  const worlds = ctx.clients.map((c) => c.session.world);
  return {
    ticks: [ctx.clients[0].stepped, ctx.clients[1].stepped],
    worldTicks: [worlds[0]?.tick ?? 0, worlds[1]?.tick ?? 0],
    outcomes: [worlds[0]?.outcome.state ?? 'none', worlds[1]?.outcome.state ?? 'none'],
    winners: [winnerOf(worlds[0]), winnerOf(worlds[1])],
    states: [ctx.clients[0].session.state, ctx.clients[1].session.state],
    desyncTick,
    sessionDesync: ctx.clients.some((c) => c.sessionDesync !== null),
    hang: net.now - lastProgressAt > hangMs,
    ticksCompared,
    commands: [ctx.clients[0].bot?.stats ?? null, ctx.clients[1].bot?.stats ?? null],
    diff,
    finalChecksums: [worlds[0] ? checksumWorld(worlds[0]) : 0, worlds[1] ? checksumWorld(worlds[1]) : 0],
    virtualMs: Math.round(net.now),
    wallMs: Date.now() - started,
  };
}

/** Run once; on a desync, replay the same config and diff both worlds at the
 *  first diverging tick. */
export function runMpMatchWithForensics(config: MpMatchConfig): MpMatchResult {
  const result = runMpMatch(config);
  if (result.desyncTick === null) return result;
  const replay = runMpMatch({ ...config, diffAtTick: result.desyncTick });
  return { ...result, diff: replay.diff };
}

/** Send a command on `client` as if its player issued it (not the bot).
 *  Returns false when the session refused it before it reached the wire. */
export function injectCommand(client: MpClient, input: SimInput): boolean {
  const before = client.session.debugSnapshot().lockstep?.pendingLocalCmds ?? 0;
  client.session.sendCommand(input);
  const after = client.session.debugSnapshot().lockstep?.pendingLocalCmds ?? 0;
  if (after === before) return false;
  client.bot?.noteExternalCommand(input);
  return true;
}

function winnerOf(world: SimWorld | null): number {
  return world && world.outcome.state === 'victory' ? world.outcome.winnerPlayerId : 0;
}

/** The render layer drains these every frame; headless clients must too. */
function drainOutputBuffers(world: SimWorld): void {
  world.combatEvents.length = 0;
  world.soundCues.length = 0;
  world.aiEvents.length = 0;
  world.gameEvents.length = 0;
}

function cloneWorld(world: SimWorld, config: MpMatchConfig): SimWorld {
  const saved = JSON.parse(JSON.stringify(serializeSimWorld(world)));
  const fresh = createSimWorld(config.seed, { mapId: config.mapId, startingAge: config.startingAge });
  loadSimWorldSnapshot(fresh, saved);
  return fresh;
}

/** Swap a client's world for a reload of its own save (save, JSON, load into a
 *  fresh world), keeping the bot's eid references valid through NetIds. */
function reloadClientWorld(client: MpClient, config: MpMatchConfig): void {
  const old = client.session.world;
  if (!old) return;
  const fresh = cloneWorld(old, config);
  client.bot?.remapEids((eid) => {
    const netId = netIdForEntity(old, eid);
    return netId === null ? -1 : entityForNetId(fresh, netId) ?? -1;
  });
  client.session.world = fresh;
}
