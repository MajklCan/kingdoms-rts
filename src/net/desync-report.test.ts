import { describe, expect, it } from 'vitest';
import { AgeId } from '@sim/defs';
import { MapId } from '@sim/map-gen';
import { createSimWorld } from '@sim/world';
import { replayDesyncReport, type DesyncReport } from './desync-report';
import { runMpMatch, type MpClient } from './testing/mp-match';

const createWorld = (seed: number) => createSimWorld(seed, { mapId: MapId.RIVERLANDS, startingAge: AgeId.CASTLE });

function playAndReport(): DesyncReport[] {
  let clients: MpClient[] = [];
  runMpMatch({
    seed: 5,
    mapId: MapId.RIVERLANDS,
    startingAge: AgeId.CASTLE,
    clients: [{ difficulty: 'hard' }, { difficulty: 'medium' }],
    maxTicks: 700,
    onTick: (ctx) => {
      clients = ctx.clients;
    },
  });
  return clients.map((c) => c.session.desyncReport()!);
}

describe('desync report', () => {
  it('replays a real lockstep match to the same checksum at every checkpoint', () => {
    const reports = playAndReport();
    expect(reports).toHaveLength(2);
    for (const report of reports) {
      expect(report.commands.length).toBeGreaterThan(0);
      expect(report.checksums.length).toBeGreaterThan(20);
      // Survives the download round trip.
      const copy = JSON.parse(JSON.stringify(report)) as DesyncReport;
      const result = replayDesyncReport(copy, createWorld);
      expect(result.firstMismatch).toBeNull();
      expect(result.checked).toBe(report.checksums.length);
    }
  });

  it('names the first checkpoint a client drifted at', () => {
    const [report] = playAndReport();
    const bad = report.checksums.slice();
    const at = bad[12][0];
    bad[12] = [at, (bad[12][1] + 1) >>> 0];
    const result = replayDesyncReport({ ...report, checksums: bad }, createWorld);
    expect(result.firstMismatch?.tick).toBe(at);
    expect(result.checked).toBe(12);
  });
});
