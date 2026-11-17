/**
 * Walks the shipped unit atlas (public/assets/sprites): every villager role
 * must have every facing of every frame of every anim it declares, on one
 * page with its team mask, and the look resolver must never hand a role's
 * anim to the builder's art.
 */
import { pickVillagerAnim, type VillagerWorkState } from '../entities/villager-anim';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { UnitDefId } from '@sim/defs';
import { VILLAGER_ROLES } from '@sim/core/villager-role';
import { FACINGS } from './facing';
import { UnitAtlasSource } from './unit-atlas-source';
import { parseUnitManifest, unitFrameName } from './unit-manifest';
import { lookForRole, roleWorkAnim, roleWorkAnims } from './villager-look';

const DIR = new URL('../../../public/assets/sprites/', import.meta.url);
const raw = JSON.parse(readFileSync(new URL('units-manifest.json', DIR), 'utf8')) as {
  atlases: Array<{ key: string; json: string }>;
};
const pages = raw.atlases.map((a) => ({
  key: a.key,
  frames: new Set(
    Object.keys((JSON.parse(readFileSync(new URL(a.json, DIR), 'utf8')) as { frames: object }).frames)
  ),
}));
const lookup = (frame: string): string | null => pages.find((p) => p.frames.has(frame))?.key ?? null;
const { manifest, problems } = parseUnitManifest(raw);
const source = new UnitAtlasSource(manifest, lookup, [0x111111, 0x2e86de]);
const roleUnits = manifest.units.filter((u) => u.look !== undefined);

describe('villager role art', () => {
  it('parses cleanly and ships every role look', () => {
    expect(problems).toEqual([]);
    for (const role of VILLAGER_ROLES) {
      const look = lookForRole(role);
      if (look === undefined) continue;
      expect(roleUnits.map((u) => u.look), role).toContain(look);
    }
  });

  for (const unit of roleUnits) {
    describe(unit.name, () => {
      const real = Object.entries(unit.anims).filter(([, a]) => a.frames > 0);

      it('has every facing of every frame of every anim it declares', () => {
        const missing: string[] = [];
        for (const [anim, def] of real) {
          for (let facing = 0; facing < FACINGS.length; facing++) {
            for (let frame = 0; frame < def.frames; frame++) {
              if (!lookup(unitFrameName(unit.name, anim, facing, frame))) {
                missing.push(`${anim}/${facing}/${frame}`);
              }
            }
          }
        }
        expect(missing).toEqual([]);
      });

      it('keeps frame, team mask and shadow on one atlas page', () => {
        const split: string[] = [];
        for (const [anim, def] of real) {
          for (let facing = 0; facing < FACINGS.length; facing++) {
            for (let frame = 0; frame < def.frames; frame++) {
              const base = lookup(unitFrameName(unit.name, anim, facing, frame));
              const mask = lookup(unitFrameName(unit.name, anim, facing, frame, 'm'));
              // a frame with no team colour has no mask frame at all
              if (mask !== null && mask !== base) split.push(`${anim}/${facing}/${frame}`);
            }
          }
        }
        expect(split).toEqual([]);
      });

      it('draws its own frames, never the builder, for every anim and alias it has', () => {
        const names = [...Object.keys(unit.anims), ...Object.keys(unit.aliases)];
        for (const anim of names) {
          for (const facing of FACINGS) {
            const ref = source.unit({
              unitDefId: UnitDefId.VILLAGER,
              playerId: 1,
              facing,
              anim,
              frame: 0,
              look: unit.look,
            });
            expect(ref?.frame?.startsWith(`${unit.name}/`), `${unit.name} ${anim} ${facing}`).toBe(true);
          }
        }
      });
    });
  }

  it('gives every role every work anim the animator can ask for', () => {
    for (const role of VILLAGER_ROLES) {
      const look = lookForRole(role);
      const art = look === undefined ? null : source.unitArt(UnitDefId.VILLAGER, look);
      if (look === undefined) continue;
      expect(art?.hasOwn?.('idle'), `${role} idle`).toBe(true);
      expect(art?.hasOwn?.('move'), `${role} move`).toBe(true);
      expect(art?.hasOwn?.('death'), `${role} death`).toBe(true);
      for (const work of roleWorkAnims(role)) expect(art?.hasOwn?.(work), `${role} ${work}`).toBe(true);
    }
  });

  it('picks a stable work variant per worker and mixes both on a farm', () => {
    expect(roleWorkAnim('farmer', 12)).toBe(roleWorkAnim('farmer', 12));
    const seen = new Set(Array.from({ length: 40 }, (_, id) => roleWorkAnim('farmer', id)));
    expect([...seen].sort()).toEqual(['farm', 'water']);
    expect(roleWorkAnim('lumberjack', 5)).toBe('chop');
    expect(roleWorkAnim('gold-miner', 5)).toBe('mine');
  });

  it('never asks a role look for an anim it does not have, in any worker state', () => {
    const states: VillagerWorkState[] = ['gathering', 'building', 'depositing', 'other', 'none'];
    for (const role of VILLAGER_ROLES) {
      const look = lookForRole(role);
      const art = source.unitArt(UnitDefId.VILLAGER, look);
      for (const state of states) {
        for (const moving of [false, true]) {
          for (const variant of [0, 1, 2, 3, 7, 12]) {
            const anim = pickVillagerAnim({
              role,
              variant,
              moving,
              atBuildSite: false,
              state,
              // the work a role's own site gives it
              gatherWork: { builder: 'build', lumberjack: 'chop', farmer: 'farm', quarryman: 'mine', 'gold-miner': 'mine', miller: 'farm' }[role],
              carry: 'carry',
              owns: (a) => art?.hasOwn?.(a) ?? false,
            });
            expect(art?.hasOwn?.(anim), `${role} ${state} moving=${moving} -> ${anim}`).toBe(true);
          }
        }
      }
    }
  });
});
