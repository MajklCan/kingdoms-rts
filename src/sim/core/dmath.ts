/**
 * Engine-independent math for the lockstep sim.
 *
 * ECMAScript leaves Math.hypot, Math.sin, Math.cos, Math.pow and friends
 * "implementation-approximated": V8 (Chrome, Edge) and JavaScriptCore (Safari,
 * every iOS browser) return different last bits for about a third of hypot
 * calls and a few percent of sin/cos calls. Two peers on different browsers
 * then drift apart until the checksum catches it. Everything here uses only
 * +, -, *, /, Math.round and Math.sqrt, which IEEE-754 makes exact (correctly
 * rounded) on every engine, so every client gets the same bits.
 *
 * Use these in src/sim instead of the Math versions.
 */

const PI = 3.141592653589793;
const TWO_PI = 6.283185307179586;
const HALF_PI = 1.5707963267948966;

// Taylor coefficients of sin, 1/(2k+1)! with alternating sign.
const S3 = -1 / 6;
const S5 = 1 / 120;
const S7 = -1 / 5040;
const S9 = 1 / 362880;
const S11 = -1 / 39916800;
const S13 = 1 / 6227020800;
const S15 = -1 / 1307674368000;
const S17 = 1 / 355687428096000;
const S19 = -1 / 121645100408832000;
const S21 = 1 / 51090942171709440000;

/** Length of (x, y). Same as Math.hypot for game-sized values, but exact on every engine. */
export function dhypot(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

/** sin(x), deterministic across engines (abs error under 1e-15 near zero turns). */
export function dsin(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  let r = x - TWO_PI * Math.round(x / TWO_PI);
  if (r > HALF_PI) r = PI - r;
  else if (r < -HALF_PI) r = -PI - r;
  const r2 = r * r;
  return (
    r *
    (1 +
      r2 *
        (S3 +
          r2 *
            (S5 +
              r2 *
                (S7 +
                  r2 * (S9 + r2 * (S11 + r2 * (S13 + r2 * (S15 + r2 * (S17 + r2 * (S19 + r2 * S21))))))))))
  );
}

/** cos(x), deterministic across engines. */
export function dcos(x: number): number {
  return dsin(x + HALF_PI);
}
