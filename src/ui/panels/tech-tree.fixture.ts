/**
 * The 17 researches of the ring tree as plain data, for the panel's tests
 * and for checking the panel without a running match. Mirrors the shared
 * design table; the game itself reads the tree from the sim.
 */

import { deriveRings, type TechNode, type TechRings } from './tech-tree-rings';

type Row = [id: string, name: string, path: string, ring: number, parents: string[], cost: string, unlocks: string[]];

const ROWS: Row[] = [
  ['barracks_pikemen', 'Barracks', 'arms', 1, [], '250 wood', ['Barracks', 'Pikeman']],
  ['archers', 'Archers', 'arms', 1, ['barracks_pikemen'], '300 wood 200 stone', ['Archer']],
  ['knights', 'Cavalry', 'arms', 1, ['barracks_pikemen'], '300 wood 200 stone', ['Stable', 'Scout Cavalry']],
  ['lumber_crews', 'Lumber Crews', 'timber', 1, [], '250 wood', ['Lumber huts take three workers']],
  ['housing_i', 'Housing I', 'timber', 1, ['lumber_crews'], '250 wood 150 stone', ['Houses hold 5', 'No limit on houses']],
  ['housing_ii', 'Housing II', 'timber', 2, ['housing_i'], '600 wood 400 stone', ['Houses hold 8']],
  ['mining_crews', 'Mining Crews', 'mines', 1, [], '300 wood 250 stone', ['Stone and gold worksites take three workers']],
  ['gold_mines', 'Gold Mine', 'mines', 2, ['mining_crews'], '400 wood 300 stone', ['Gold Mine']],
  ['foundry', 'Foundry', 'mines', 3, ['gold_mines'], '800 wood 800 gold 700 stone', ['Foundry', 'Gunman']],
  ['houfnice', 'Cannons', 'mines', 3, ['foundry'], '500 wood 600 gold 400 stone', ['Field Cannon']],
  ['palisades', 'Palisades', 'walls', 1, [], '200 wood', ['Palisade Wall']],
  ['watchtowers', 'Towers', 'walls', 1, ['palisades'], '200 wood 200 stone', ['Defensive Tower']],
  ['stone_walls', 'Stone Walls', 'walls', 2, ['watchtowers'], '300 wood 600 stone', ['Stone Wall']],
  ['brick_walls', 'Brick Walls', 'walls', 3, ['stone_walls'], '400 wood 300 gold 800 stone', ['Brick Wall']],
  ['mills', 'Mills', 'land', 1, [], '450 wood 300 stone', ['Mill', 'Food dropped at a mill counts half again']],
  ['farms', 'Farming I', 'land', 2, ['mills'], '300 wood 150 stone', ['Farms give 3 food per work cycle']],
  ['farms_ii', 'Farming II', 'land', 3, ['farms'], '600 wood 350 stone', ['Farms give 4 food per work cycle']],
];

export const FIXTURE_IDS: readonly string[] = ROWS.map((row) => row[0]);

/**
 * The tree with `done` researched. Status follows the ring rule: research
 * is available when its parents are done and its ring is open.
 */
export function fixtureTree(done: readonly string[] = [], affordable: (node: TechNode) => boolean = () => true): { nodes: TechNode[]; rings: TechRings } {
  const researched = new Set(done);
  const draft: TechNode[] = ROWS.map(([id, name, path, ring, parents, cost, unlocks]) => ({
    id,
    name,
    description: `${name}.`,
    icon: id,
    path,
    ring,
    parents,
    cost,
    unlocks,
    status: researched.has(id) ? 'researched' : 'locked',
    affordable: false,
  }));
  const rings = deriveRings(draft);
  const nodes = draft.map((node) => {
    if (node.status === 'researched') return node;
    const ringOpen = rings.rings.find((r) => r.ring === node.ring)?.open ?? false;
    const ready = ringOpen && node.parents.every((id) => researched.has(id));
    return { ...node, status: ready ? 'available' : 'locked', affordable: ready && affordable(node) };
  });
  return { nodes, rings };
}
