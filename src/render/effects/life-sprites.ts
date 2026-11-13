/**
 * Tiny pixel-art sprites for the ambient life (style A, drawn at 1x like the
 * voxel art): birds, deer, rabbits, ducks, chickens, a dog, frogs,
 * dragonflies, fish rings, voxel smoke puffs, brazier flames, flakes and
 * leaves. Drawn once from character grids into one canvas texture with
 * nearest sampling, so everything stays crisp and batches.
 */

/** Texture key of the life sheet. */
export const LIFE_SHEET = 'life-sheet';

const PALETTE: Readonly<Record<string, string>> = {
  k: '#231c16', // outline / dark
  K: '#3a2e24',
  b: '#7a5232', // brown body
  B: '#94673e',
  h: '#6a4426',
  w: '#efe6d2', // white
  W: '#ffffff',
  g: '#8d8170', // rabbit grey-brown
  G: '#a89c88',
  y: '#d8a03a', // yellow / legs
  o: '#e07a2a', // orange beak
  r: '#c8322a', // red comb
  m: '#2f6a3a', // mallard green
  d: '#6d6a60', // duck body
  D: '#8c887c',
  f: '#5a9a3a', // frog
  F: '#3e7a2a',
  c: '#3a8ad8', // dragonfly
  C: '#bfe4ff',
  a: '#c4ab80', // antler
  l: '#4a3220', // legs
  s: '#d9dde2', // smoke light
  S: '#b4bac2', // smoke mid
  t: '#8d939c', // smoke dark
  e: '#ffd75a', // flame
  E: '#ff9a2a',
  q: '#d84a1a',
  i: '#4a4a52', // iron
  I: '#2e2e34',
  n: '#a4b8d4', // flake blue
  N: '#7890b4',
  z: '#dfe9f4', // ring light
};

const SPRITES: Readonly<Record<string, readonly string[]>> = {
  bird_perch: ['.kk..', 'kbbBK', '.bbb.', '..y..'],
  bird_fly0: ['k.....k', '.k...k.', '..kbk..', '...k...'],
  bird_fly1: ['.......', '..kbk..', '.k.k.k.', 'k.....k'],
  bird_flock0: ['k...k', '.kkk.'],
  bird_flock1: ['.....', 'kkkkk'],
  deer_stand: [
    '.........a.a',
    '..........aa',
    '.........hhk',
    '........hhh.',
    '..bbbbbbbh..',
    '.bBBBBBBbb..',
    'wbbbbbbbbb..',
    '..l.l..l.l..',
    '..l.l..l.l..',
    '..k.k..k.k..',
  ],
  deer_graze: [
    '............',
    '............',
    '............',
    '............',
    '..bbbbbbb...',
    '.bBBBBBBbba.',
    'wbbbbbbbbhha',
    '..l.l..l.lhk',
    '..l.l..l.l..',
    '..k.k..k.k..',
  ],
  deer_run0: [
    '..........a.',
    '.........aa.',
    '.........hhk',
    '........hhh.',
    '.wbbbbbbbh..',
    '.bBBBBBBbb..',
    '..bbbbbbbb..',
    '.l......l...',
    'l........l..',
    'k.........k.',
  ],
  deer_run1: [
    '............',
    '..........a.',
    '.........aa.',
    '.........hhk',
    '.wbbbbbbhhh.',
    '.bBBBBBBbh..',
    '..bbbbbbbb..',
    '...l..l.....',
    '...ll.ll....',
    '....k..k....',
  ],
  rabbit_sit: ['.g...', '.gg..', 'gGgg.', 'gggGw'],
  rabbit_hop0: ['..g...', '..gg..', 'wgGgg.', '.g..g.'],
  rabbit_hop1: ['...g..', 'wgGgg.', '.gggg.', '......'],
  duck0: ['...mm.', '...mko', 'dDDdd.', '.ddd..'],
  duck1: ['...mm.', '...mko', '.DDdd.', 'dddd..'],
  chicken0: ['..r..', '.wwy.', 'wwww.', '.ww..', '..y..'],
  chicken1: ['.....', '.r...', 'wwwy.', '.www.', '..y..'],
  dog0: ['......hk', '.....hhh', 'h.bbbbh.', '.bBBBbb.', '.l.l.l.l', '.k.k.k.k'],
  dog1: ['......hk', '.....hhh', 'h.bbbbh.', '.bBBBbb.', 'l..ll..l', 'k..kk..k'],
  frog0: ['.f.f', 'fFff', 'FfFf'],
  frog1: ['....', 'f.f.', 'fFff'],
  fly_drag0: ['C.C..', 'ccccc', 'C.C..'],
  fly_drag1: ['.C.C.', 'ccccc', '.C.C.'],
  ring0: ['.zz.', 'z..z', '.zz.'],
  ring1: ['..zzzz..', 'zz....zz', '..zzzz..'],
  ring2: ['...zzzzzz...', '.zz......zz.', 'z..........z', '.zz......zz.', '...zzzzzz...'],
  puff0: ['ss.', 'sSS', '.SS'],
  puff1: ['.ss..', 'sssS.', 'sSSSt', '.SStt'],
  puff2: ['..sss..', '.sssss.', 'ssSSSSt', 'sSSSStt', '.SSttt.'],
  flame0: ['..e..', '.eEe.', '.EqE.', 'EqqqE'],
  flame1: ['.e...', '.ee..', '.Eee.', 'EqqE.'],
  flame2: ['...e.', '..ee.', '.eeE.', '.EqqE'],
  brazier: ['IiiiI', '.iIi.', '..i..', '..i..', '.iii.'],
  flake: ['nN', 'Nn'],
  flake_shadow: ['NN'],
  leaf: ['bB'],
  speck: ['W'],
};

export type LifeFrame = keyof typeof SPRITES;

/** Build the sheet once per game (no-op when it exists). */
export function ensureLifeSheet(scene: Phaser.Scene): void {
  if (scene.textures.exists(LIFE_SHEET)) return;
  const names = Object.keys(SPRITES);
  const pad = 1;
  const width = 128;
  const places: Array<{ name: string; x: number; y: number; w: number; h: number }> = [];
  let x = pad;
  let y = pad;
  let rowH = 0;
  for (const name of names) {
    const grid = SPRITES[name];
    const w = Math.max(...grid.map((r) => r.length));
    const h = grid.length;
    if (x + w + pad > width) {
      x = pad;
      y += rowH + pad;
      rowH = 0;
    }
    places.push({ name, x, y, w, h });
    x += w + pad;
    rowH = Math.max(rowH, h);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = y + rowH + pad;
  const g = canvas.getContext('2d');
  if (!g) return;
  for (const p of places) {
    const grid = SPRITES[p.name];
    for (let row = 0; row < grid.length; row++) {
      for (let col = 0; col < grid[row].length; col++) {
        const colour = PALETTE[grid[row][col]];
        if (!colour) continue;
        g.fillStyle = colour;
        g.fillRect(p.x + col, p.y + row, 1, 1);
      }
    }
  }
  const texture = scene.textures.addCanvas(LIFE_SHEET, canvas);
  if (!texture) return;
  for (const p of places) texture.add(p.name, 0, p.x, p.y, p.w, p.h);
  texture.setFilter(1 as Phaser.Textures.FilterMode); // NEAREST
}

/** Size of a life frame in px (for anchoring at the feet). */
export function lifeFrameSize(name: LifeFrame): { w: number; h: number } {
  const grid = SPRITES[name];
  return { w: Math.max(...grid.map((r) => r.length)), h: grid.length };
}
