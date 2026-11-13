import { describe, expect, it } from 'vitest';
import { decodeServer } from './protocol';

describe('decodeServer', () => {
  it('accepts well-formed relay frames', () => {
    expect(decodeServer('{"t":"turn","playerId":2,"forTick":7,"cmds":[]}')).toEqual({
      t: 'turn',
      playerId: 2,
      forTick: 7,
      cmds: [],
    });
    expect(decodeServer('{"t":"checksum","playerId":2,"tick":20,"hash":123}')).not.toBeNull();
    expect(decodeServer('{"t":"start","seed":5,"players":[{"playerId":1,"name":"A"}]}')).not.toBeNull();
    expect(decodeServer('{"t":"peer-left","playerId":2}')).not.toBeNull();
    expect(decodeServer('{"t":"error","message":"room full"}')).not.toBeNull();
  });

  it('rejects frames whose shape would crash or stall the session', () => {
    for (const raw of [
      'not json',
      'null',
      '[]',
      '{"t":"unknown"}',
      '{"t":"turn","playerId":2,"forTick":7}',
      '{"t":"turn","playerId":2,"forTick":-1,"cmds":[]}',
      '{"t":"turn","playerId":2,"forTick":"7","cmds":[]}',
      '{"t":"checksum","playerId":2,"tick":20}',
      '{"t":"start","seed":5}',
      '{"t":"roster","players":[{"name":"A"}]}',
    ]) {
      expect(decodeServer(raw), raw).toBeNull();
    }
  });
});
