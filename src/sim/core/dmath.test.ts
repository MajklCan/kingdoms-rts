import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dcos, dhypot, dsin } from './dmath';

describe('dmath', () => {
  it('tracks Math.sin and Math.cos closely', () => {
    for (let i = -2000; i <= 2000; i++) {
      const x = i * 0.0137;
      expect(Math.abs(dsin(x) - Math.sin(x))).toBeLessThan(1e-14);
      expect(Math.abs(dcos(x) - Math.cos(x))).toBeLessThan(1e-14);
    }
  });

  it('gives the length of a vector', () => {
    expect(dhypot(3, 4)).toBe(5);
    expect(dhypot(-6, 8)).toBe(10);
    expect(dhypot(0, 0)).toBe(0);
  });

  it('is NaN for non-finite angles', () => {
    expect(dsin(Infinity)).toBeNaN();
    expect(dcos(NaN)).toBeNaN();
  });
});

/** Engine-approximated Math functions give different bits per browser. */
const BANNED = /Math\.(hypot|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|exp|expm1|log|log1p|log2|log10|pow|cbrt)\(/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
  });
}

describe('sim math guard', () => {
  it('uses no engine-approximated Math functions (use core/dmath)', () => {
    const simDir = join(__dirname, '..');
    const offenders = sourceFiles(simDir)
      .filter((path) => !path.endsWith(join('core', 'dmath.ts')))
      .filter((path) => BANNED.test(readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
