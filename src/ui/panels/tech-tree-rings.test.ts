import { describe, expect, it } from 'vitest';
import { fixtureTree } from './tech-tree.fixture';
import { deriveRings, lockReason, nextRingProgress, ringGoalMarks, techGoalMarks } from './tech-tree-rings';

describe('ring rule derived from the tree', () => {
  it('starts with ring I open and nothing complete', () => {
    const { rings } = fixtureTree();
    expect(rings.openRing).toBe(1);
    expect(rings.rings.map((r) => r.open)).toEqual([true, false, false]);
    expect([...rings.rings[0]!.pathsWithContent].sort()).toEqual(['arms', 'land', 'mines', 'timber', 'walls']);
    expect([...rings.rings[2]!.pathsWithContent].sort()).toEqual(['land', 'mines', 'walls']);
    expect(nextRingProgress(rings)).toMatchObject({ ring: 2, done: 0, need: 2 });
  });

  it('counts a path only when all its research in the ring is done', () => {
    const { rings } = fixtureTree(['palisades', 'mining_crews']);
    expect(rings.rings[0]!.maxedPaths).toEqual(['mines']);
    expect(rings.openRing).toBe(1);
  });

  it('opens the next ring at two complete paths, and no ring past a closed one', () => {
    const two = fixtureTree(['mining_crews', 'mills']).rings;
    expect(two.openRing).toBe(2);
    expect(nextRingProgress(two)).toMatchObject({ ring: 3, done: 0, need: 2 });
    const all = deriveRings(fixtureTree(['mining_crews', 'mills', 'gold_mines', 'farms']).nodes);
    expect(all.openRing).toBe(3);
    expect(nextRingProgress(all)).toBeUndefined();
  });
});

describe('goal marks', () => {
  it('marks a research and everything it still needs, across paths', () => {
    const { nodes, rings } = fixtureTree(['barracks_pikemen']);
    const marks = techGoalMarks('knights', nodes, rings);
    expect(marks.goalId).toBe('knights');
    expect([...marks.pathIds].sort()).toEqual(['archers', 'gold_mines', 'mining_crews']);
    expect(marks.note).toBe('Cavalry needs Archers, Mining Crews and Gold Mine, and ring II to open (0 of 2 paths complete in ring I).');
  });

  it('says so when the goal is ready or done', () => {
    const { nodes, rings } = fixtureTree(['barracks_pikemen']);
    expect(techGoalMarks('archers', nodes, rings)).toMatchObject({ note: 'Archers is ready to research.' });
    expect(techGoalMarks('barracks_pikemen', nodes, rings)).toMatchObject({ note: 'Barracks is researched.' });
    expect(techGoalMarks('nope', nodes, rings).goalId).toBeNull();
  });

  it('finds the cheapest two paths for the next ring', () => {
    const { nodes, rings } = fixtureTree();
    const marks = ringGoalMarks(nodes, rings);
    expect(marks.goalRing).toBe(2);
    // Mines (550) and walls (200 + 400) beat timber (250 + 400), arms (250 + 500) and land (750).
    expect([...marks.pathIds].sort()).toEqual(['mining_crews', 'palisades', 'watchtowers']);
    expect(marks.note).toContain('Ring II (Castle Age) opens when 2 paths are complete in ring I: 0 of 2 so far.');
    expect(marks.note).toContain('Cheapest way: Mining Crews, Palisades and Towers (Mines and Walls).');
  });

  it('counts what is already done and only asks for the paths still missing', () => {
    const { nodes, rings } = fixtureTree(['mills', 'barracks_pikemen']);
    const marks = ringGoalMarks(nodes, rings);
    // One path is complete; finishing arms (Archers, 500) is the cheapest second.
    expect([...marks.pathIds]).toEqual(['archers']);
    expect(marks.note).toContain('1 of 2 so far');
  });

  it('counts a shared prerequisite once when opening ring III', () => {
    const { nodes, rings } = fixtureTree(['barracks_pikemen', 'archers', 'mining_crews']);
    expect(rings.openRing).toBe(2);
    const marks = ringGoalMarks(nodes, rings);
    expect(marks.goalRing).toBe(3);
    // Land needs Mills first (750 + 450); mines (700) plus arms (Cavalry 700, Gold Mine shared) is cheaper.
    expect([...marks.pathIds].sort()).toEqual(['gold_mines', 'knights']);
  });

  it('has nothing to mark once every ring is open', () => {
    const { nodes, rings } = fixtureTree(['mining_crews', 'mills', 'gold_mines', 'farms']);
    expect(ringGoalMarks(nodes, rings)).toMatchObject({ goalRing: null, note: 'Every ring is open.' });
  });
});

describe('lock reason', () => {
  it('prefers the words the sim gives', () => {
    const { nodes, rings } = fixtureTree();
    const node = { ...nodes.find((n) => n.id === 'knights')!, lockedReason: 'Needs Gold Mine' };
    expect(lockReason(node, nodes, rings)).toBe('Needs Gold Mine');
  });

  it('names missing parents first, then the closed ring', () => {
    const { nodes, rings } = fixtureTree(['mining_crews']);
    expect(lockReason(nodes.find((n) => n.id === 'archers')!, nodes, rings)).toBe('Needs Barracks');
    expect(lockReason(nodes.find((n) => n.id === 'gold_mines')!, nodes, rings)).toBe('Needs ring II to open (1 of 2 paths complete in ring I)');
  });
});
