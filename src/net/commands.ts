/**
 * Command boundary between the sim and the wire.
 *
 * - sanitizeWireCommand / sanitizeTurnCommands: validate commands against the
 *   slot that sent them. Pure and deterministic: every client runs the same
 *   check on the same packet (the sender on its own commands before queueing
 *   them), so all clients drop the same commands. A buggy or modified peer can
 *   neither steer another player's units, act through the receiver's local
 *   selection, nor crash step() with a malformed payload.
 * - encodeInputForWire / decodeInputFromWire: raw eid <-> NetId mapping, since
 *   raw bitECS eids differ between clients.
 *
 * Selection-relative SimInput types read the local Selected component, so they
 * never go on the wire: MultiplayerSession.sendCommand translates them into
 * cmd* first (toSelfDescribingInput in the sim), and receivers drop them.
 */

import { entityForNetId, netIdForEntity, type SimInput, type SimWorld } from '@sim/world';

type WireCommandType = Exclude<
  SimInput['type'],
  | 'moveSelected'
  | 'gatherSelected'
  | 'stopSelected'
  | 'toggleSelectedUnitStance'
  | 'setSelectedUnitStance'
  | 'setFormationMode'
  | 'adjustFormationMode'
  | 'rotateSelectedFormation'
  | 'reformSelectedFormation'
  | 'attackSelected'
  | 'attackMoveSelected'
  | 'removeSelectedBuildings'
>;

type FieldKind = 'int' | 'optInt' | 'num' | 'string' | 'eids' | 'point';

/** Field schema per wire-safe command (playerId is checked separately). A new
 *  SimInput command type must be added here before it can be sent. */
const WIRE_COMMANDS: Record<WireCommandType, Record<string, FieldKind>> = {
  cmdMove: { eids: 'eids', to: 'point' },
  cmdGather: { eids: 'eids', targetEid: 'int' },
  cmdStop: { eids: 'eids' },
  cmdToggleStance: { eids: 'eids' },
  cmdAttack: { eids: 'eids', targetEid: 'int' },
  cmdAttackMove: { eids: 'eids', to: 'point' },
  cmdRemoveBuildings: { eids: 'eids' },
  cmdSetStance: { eids: 'eids', stance: 'int' },
  cmdSetFormationMode: { eids: 'eids', mode: 'int' },
  cmdAdjustFormationMode: { eids: 'eids', delta: 'num' },
  cmdRotateFormation: { eids: 'eids', delta: 'num' },
  cmdReformFormation: { eids: 'eids' },
  setArmyRallyPoint: { x: 'num', y: 'num' },
  placeBuilding: { defId: 'int', x: 'num', y: 'num' },
  placeWallLine: { x0: 'int', y0: 'int', x1: 'int', y1: 'int' },
  trainUnit: { atEid: 'int', defId: 'int', count: 'optInt' },
  cancelProduction: { atEid: 'int', slot: 'optInt' },
  advanceAge: {},
  researchTech: { techId: 'string' },
};

/** Types whose playerId is optional in SimInput. The sim skips the ownership
 *  check without one, so the sender's slot is always stamped on. */
const OPTIONAL_PLAYER_ID = new Set<string>(['trainUnit', 'cancelProduction']);

export function isWireCommandType(type: unknown): type is WireCommandType {
  return typeof type === 'string' && Object.prototype.hasOwnProperty.call(WIRE_COMMANDS, type);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fieldOk(kind: FieldKind, value: unknown): boolean {
  switch (kind) {
    case 'int':
      return Number.isInteger(value);
    case 'optInt':
      return value === undefined || Number.isInteger(value);
    case 'num':
      return typeof value === 'number' && Number.isFinite(value);
    case 'string':
      return typeof value === 'string';
    case 'eids':
      return Array.isArray(value) && value.every((eid) => Number.isInteger(eid));
    case 'point':
      return isRecord(value) && fieldOk('num', value.x) && fieldOk('num', value.y);
  }
}

/**
 * Validate one command sent by `senderId`. Returns the command to apply, with
 * the sender stamped on where SimInput leaves playerId optional, or null when
 * it must be dropped (unknown or selection-relative type, malformed fields,
 * or a playerId other than the sender's).
 */
export function sanitizeWireCommand(senderId: number, raw: unknown): SimInput | null {
  if (!isRecord(raw) || !isWireCommandType(raw.type)) return null;
  const optionalPlayer = OPTIONAL_PLAYER_ID.has(raw.type);
  const playerOk = optionalPlayer
    ? raw.playerId === undefined || raw.playerId === senderId
    : raw.playerId === senderId;
  if (!playerOk) return null;
  for (const [field, kind] of Object.entries(WIRE_COMMANDS[raw.type])) {
    if (!fieldOk(kind, raw[field])) return null;
  }
  if (optionalPlayer && raw.playerId === undefined) {
    return { ...raw, playerId: senderId } as unknown as SimInput;
  }
  return raw as unknown as SimInput;
}

/** Validate every command of one turn packet sent by `senderId`. */
export function sanitizeTurnCommands(senderId: number, cmds: unknown): SimInput[] {
  if (!Array.isArray(cmds)) return [];
  const out: SimInput[] = [];
  for (const raw of cmds) {
    const cmd = sanitizeWireCommand(senderId, raw);
    if (cmd) out.push(cmd);
  }
  return out;
}

/** Rewrite the entity references of a wire-safe command through `mapEid`.
 *  List entries that do not map are dropped; single targets map to -1. */
function mapEntityRefs(input: SimInput, mapEid: (eid: number) => number | null): SimInput {
  if (!isWireCommandType(input.type)) return input;
  const out: Record<string, unknown> = { ...input };
  if ('eids' in input) out.eids = input.eids.map(mapEid).filter((eid): eid is number => eid !== null);
  if ('targetEid' in input) out.targetEid = mapEid(input.targetEid) ?? -1;
  if ('atEid' in input) out.atEid = mapEid(input.atEid) ?? -1;
  return out as unknown as SimInput;
}

/** Local raw eids -> deterministic NetIds before a command goes on the wire. */
export function encodeInputForWire(world: SimWorld, input: SimInput): SimInput {
  return mapEntityRefs(input, (eid) => netIdForEntity(world, eid));
}

/** NetIds -> local raw eids right before a command is applied. */
export function decodeInputFromWire(world: SimWorld, input: SimInput): SimInput {
  return mapEntityRefs(input, (netId) => entityForNetId(world, netId));
}
