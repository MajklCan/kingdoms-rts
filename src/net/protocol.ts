/**
 * Wire protocol shared between the game client and the lockstep relay.
 *
 * The relay is a DUMB low-bandwidth message switch: it assigns player slots,
 * coordinates match start (seed agreement), and rebroadcasts turn/checksum
 * frames to the room. It never runs the simulation and never inspects command
 * contents. All gameplay logic stays on the clients (lockstep model).
 */

import type { SimInput } from '@sim/world';

/** Protocol version — bump on any breaking wire-format change. */
export const PROTOCOL_VERSION = 1;

/** Ticks of input delay: a command issued now executes this many ticks later
 *  on every client, absorbing network latency. 4 ticks @ 20 Hz = 200 ms. */
export const DEFAULT_INPUT_DELAY = 4;

/** How often (in ticks) clients exchange a state checksum for desync detection. */
export const CHECKSUM_INTERVAL_TICKS = 20;

export interface PlayerSlot {
  playerId: number;
  name: string;
}

/** Client → relay messages. */
export type ClientMessage =
  | { t: 'join'; v: number; room: string; name: string }
  | { t: 'start'; seed: number }
  | { t: 'turn'; forTick: number; cmds: SimInput[] }
  | { t: 'checksum'; tick: number; hash: number };

/** Relay → client messages. */
export type ServerMessage =
  // Sent to the joiner: their assigned slot + current room roster.
  | { t: 'joined'; v: number; room: string; playerId: number; isHost: boolean; players: PlayerSlot[] }
  // Broadcast when the roster changes.
  | { t: 'roster'; players: PlayerSlot[] }
  // Broadcast when the host starts the match. Carries the agreed seed + the
  // frozen player list (turn order is derived from playerId ascending).
  | { t: 'start'; seed: number; players: PlayerSlot[] }
  // Relayed turn from a peer (relay stamps the originating playerId).
  | { t: 'turn'; playerId: number; forTick: number; cmds: SimInput[] }
  // Relayed checksum from a peer (for cross-client desync detection).
  | { t: 'checksum'; playerId: number; tick: number; hash: number }
  // A peer disconnected mid-match.
  | { t: 'peer-left'; playerId: number }
  | { t: 'error'; message: string };

export function encode(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}

export function decodeClient(raw: string): ClientMessage | null {
  try {
    const m = JSON.parse(raw) as ClientMessage;
    return m && typeof m.t === 'string' ? m : null;
  } catch {
    return null;
  }
}

export function decodeServer(raw: string): ServerMessage | null {
  try {
    const m = JSON.parse(raw) as ServerMessage;
    return m && typeof m.t === 'string' ? m : null;
  } catch {
    return null;
  }
}
