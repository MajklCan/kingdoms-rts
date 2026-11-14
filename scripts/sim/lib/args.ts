/** Tiny `--key value` / `--flag` parser for the sim scripts. */

export function parseArgs(argv: string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = '';
    }
  }
  return out;
}

export function parseList(value: string): string[] {
  return value.split(',').map((v) => v.trim()).filter((v) => v.length > 0);
}

/** "1-4,9" -> [1, 2, 3, 4, 9]. */
export function parseRange(value: string): number[] {
  const out: number[] = [];
  for (const part of parseList(value)) {
    const [a, b] = part.split('-').map(Number);
    if (b === undefined || Number.isNaN(b)) out.push(a);
    else for (let n = a; n <= b; n++) out.push(n);
  }
  return out;
}
