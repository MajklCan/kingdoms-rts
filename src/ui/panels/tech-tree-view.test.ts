import { describe, expect, it } from 'vitest';
import { layoutTechTree } from './tech-tree-layout';
import { fixtureTree, FIXTURE_IDS } from './tech-tree.fixture';
import { NO_GOAL, ringGoalMarks, techGoalMarks } from './tech-tree-rings';
import { boardHtml, counterText, labelWidth, layoutInput, type Bank } from './tech-tree-view';
import { TECH_ICON } from '../icons/catalog';
import { RASTER_ICONS } from '../icons/raster-icons';

const RICH: Bank = { food: 9999, wood: 9999, gold: 9999, stone: 9999 };
const START: Bank = { food: 0, wood: 300, gold: 0, stone: 0 };

function render(done: string[], bank: Bank, goal: 'none' | 'ring' | string = 'none'): string {
  const { nodes, rings } = fixtureTree(done, (node) => /stone|gold/.test(node.cost) === false || bank.stone > 0);
  const marks = goal === 'none' ? NO_GOAL : goal === 'ring' ? ringGoalMarks(nodes, rings) : techGoalMarks(goal, nodes, rings);
  return boardHtml(layoutTechTree(layoutInput(nodes)), nodes, rings, bank, marks);
}

/** The opening tag of a seal. */
function seal(html: string, id: string): string {
  return html.match(new RegExp(`<button[^>]*data-tech-id="${id}"[^>]*>`))?.[0] ?? '';
}

describe('research icons', () => {
  it('has a sheet icon for every research and the settlement crest', () => {
    for (const id of FIXTURE_IDS) expect(TECH_ICON[id]! in RASTER_ICONS).toBe(true);
    expect(new Set(FIXTURE_IDS.map((id) => TECH_ICON[id])).size).toBe(FIXTURE_IDS.length);
    expect('tech-settlement' in RASTER_ICONS).toBe(true);
  });
});

describe('ring chart markup', () => {
  it('draws a seal per research, a band per ring and the counter', () => {
    const html = render([], START);
    for (const id of FIXTURE_IDS) expect(seal(html, id)).not.toBe('');
    expect(html.match(/class="tech-band /g)).toHaveLength(3);
    expect(html).toContain('tech-band ring-1 is-open');
    expect(html).toContain('tech-band ring-2 is-closed is-next');
    expect(html).toContain('tech-band ring-3 is-closed"');
    expect(html).toContain('<b>0 of 2</b></span><span class="tech-count-text">paths complete</span>');
    expect(html).toContain('Ring I is open: Dark Age. Ring II: 0 of 2 paths complete.');
    expect(html.match(/class="tech-banner /g)).toHaveLength(5);
    expect(html.match(/class="tech-ring-label /g)).toHaveLength(3);
    expect(html).not.toContain('<ellipse');
    expect(html).not.toContain('box-shadow');
  });

  it('shows ready, short, locked and researched seals with their reasons', () => {
    const html = render(['barracks_pikemen'], START);
    expect(seal(html, 'barracks_pikemen')).toContain('is-researched');
    expect(seal(html, 'barracks_pikemen')).toContain('aria-label="Levy. Arms path, ring I. Researched."');
    expect(seal(html, 'lumber_crews')).toContain('is-available is-ready');
    expect(seal(html, 'lumber_crews')).toContain('aria-disabled="false"');
    expect(seal(html, 'lumber_crews')).toContain('Ready to research for 250 wood.');
    expect(seal(html, 'archers')).toContain('is-available is-short');
    expect(seal(html, 'archers')).toContain('Not enough stone: costs 300 wood, 200 stone.');
    expect(seal(html, 'archers')).toContain('aria-disabled="true"');
    expect(seal(html, 'housing_i')).toContain('Locked. Needs Lumber Crews.');
    expect(seal(html, 'gold_mines')).toContain('Locked. Needs Mining Crews.');
    expect(html).toContain('tech-res is-short');
  });

  it('fills the gate of a complete path and opens the ring at two', () => {
    const one = render(['mining_crews'], RICH);
    expect(one.match(/tech-gate \w+ is-full/g)).toEqual(['tech-gate mines is-full']);
    expect(one).toContain('<b>1 of 2</b>');
    const two = render(['mining_crews', 'mills'], RICH);
    expect(two).toContain('tech-band ring-2 is-open');
    expect(two).toContain('tech-band ring-3 is-closed is-next');
    expect(two).toContain('Ring II is open: Castle Age. Ring III: 0 of 2 paths complete.');
    expect(seal(two, 'gold_mines')).toContain('is-ready');
    const all = render(['mining_crews', 'mills', 'gold_mines', 'farms'], RICH);
    expect(all).toContain('All rings open');
    expect(counterText(fixtureTree(['mining_crews', 'mills', 'gold_mines', 'farms']).rings)).toBe('All rings open');
  });

  it('draws the Riders to Gold Mining cross link and lights it once Gold Mining is done', () => {
    expect(render([], RICH)).toContain('class="tech-link mines is-cross"');
    expect(render(['mining_crews', 'mills', 'gold_mines'], RICH)).toContain('class="tech-link mines is-cross is-done"');
  });

  it('marks a research goal and the research on the way to it', () => {
    const html = render(['barracks_pikemen'], RICH, 'knights');
    expect(seal(html, 'knights')).toContain('is-goal');
    expect(seal(html, 'knights')).toContain('Your goal.');
    for (const id of ['archers', 'mining_crews', 'gold_mines']) expect(seal(html, id)).toContain('is-path');
    expect(seal(html, 'lumber_crews')).not.toContain('is-path');
  });

  it('marks the next ring and the cheapest research toward it', () => {
    const html = render([], RICH, 'ring');
    expect(html).toContain('tech-band ring-2 is-closed is-next is-goal');
    for (const id of ['palisades', 'watchtowers', 'mining_crews']) {
      expect(seal(html, id)).toContain('is-path');
      expect(seal(html, id)).toContain('Opens ring II.');
    }
    expect(seal(html, 'mills')).not.toContain('is-path');
  });

  it('sizes labels by the longer of name and cost', () => {
    const { nodes } = fixtureTree();
    const width = (id: string): number => labelWidth(nodes.find((n) => n.id === id)!);
    expect(width('foundry')).toBeGreaterThan(width('barracks_pikemen'));
    expect(width('housing_ii')).toBeGreaterThan(width('mills'));
  });
});
