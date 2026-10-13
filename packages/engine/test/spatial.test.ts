import { describe, expect, it } from 'vitest';
import { Rng } from '../src/rng';
import { cappedChebyshev, cappedChebyshevSteps, DISTANCE_INF } from '../src/sim/spatial';

describe('capped spatial distances', () => {
  it('matches direct geometry for clustered, scattered, repeated and border sources at every tile', () => {
    const random = new Rng(93);
    for (const n of [1, 2, 8, 16, 31, 64]) for (const cap of [0, 1, 3.5, 8, n, Infinity]) {
      const sets = [[], [0], [n * n - 1], [0, n - 1, n * (n - 1)], [0, 0, n * n - 1],
        Array.from({ length: 17 }, () => random.int(n * n)),
        Array.from({ length: 17 }, () => Math.floor(n / 2) * n + random.int(n))];
      for (const sources of sets) {
        const out = new Int32Array(n * n).fill(73);
        cappedChebyshev(n, sources, out, cap);
        for (let i = 0; i < out.length; i++) {
          const expected = sources.reduce((best, source) => Math.min(best, Math.max(Math.abs(i % n - source % n), Math.abs(Math.floor(i / n) - Math.floor(source / n)))), Infinity);
          expect(out[i]).toBe(Number.isFinite(expected) && expected <= cap ? expected : DISTANCE_INF);
        }
      }
    }
  });

  it('reuses an output array without stale distances after sources move or disappear', () => {
    const out = new Int32Array(32 * 32);
    cappedChebyshev(32, [0], out, 3);
    expect(out[0]).toBe(0);
    cappedChebyshev(32, [31 * 32 + 31], out, 3);
    expect(out[0]).toBe(DISTANCE_INF);
    expect(out[31 * 32 + 31]).toBe(0);
    cappedChebyshev(32, [], out, 3);
    expect(out.every((value) => value === DISTANCE_INF)).toBe(true);
  });

  it('pauses a large transform while producing exactly the synchronous result from a single-use source iterator', () => {
    const n = 256;
    const sources = [0, n * n - 1, 100 * n + 130];
    const expected = new Int32Array(n * n);
    cappedChebyshev(n, sources, expected, 32);
    const actual = new Int32Array(n * n);
    const iterator = function* () { yield* sources; };
    const steps = cappedChebyshevSteps(n, iterator(), actual, 32);
    let pieces = 0;
    for (const _ of steps) pieces++;
    expect(pieces).toBeGreaterThan(1);
    expect(actual).toEqual(expected);
  });
});
