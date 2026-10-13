import { describe, expect, it } from 'vitest';
import { allocateDisposal, allocateDisposalSteps } from '../src/sim/disposal';
import { drain } from '../src/sim/steps';

describe('road-connected disposal allocation', () => {
  it('keeps a connected town on the outlet order and leaves inaccessible capacity unused', () => {
    const result = allocateDisposal(new Map([[1, 25]]), [
      { components: [2], capacity: 100 }, { components: [1], capacity: 10 }, { components: [1], capacity: 20 },
    ]);
    expect(result.used).toEqual([0, 10, 15]);
    expect(result.collected.get(1)).toBe(25);
  });

  it('reassigns a flexible island so another island can use its only disposal outlet', () => {
    const demand = new Map([[1, 10], [2, 10], [3, 10]]);
    const outlets = [{ components: [1, 2], capacity: 10 }, { components: [1], capacity: 10 }, { components: [4], capacity: 100 }];
    const result = allocateDisposal(demand, outlets);
    expect(result.used).toEqual([10, 10, 0]);
    expect(result.collected).toEqual(new Map([[1, 10], [2, 10], [3, 0]]));
    expect(demand).toEqual(new Map([[1, 10], [2, 10], [3, 10]]));
    expect(outlets[0]!.capacity).toBe(10);
  });

  it('handles fractional tons, repeated access components and zero capacity without duplication', () => {
    const result = allocateDisposal(new Map([[1, 0.4], [2, 0.6]]), [
      { components: [1, 1, 2], capacity: 0.3 }, { components: [1, 2], capacity: 0.5 }, { components: [1, 2], capacity: 0 },
    ]);
    expect(result.used[0]).toBeCloseTo(0.3);
    expect(result.used[1]).toBeCloseTo(0.5);
    expect([...result.collected.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(0.8);
  });

  it('pauses on large interlocking service graphs and agrees with synchronous allocation', () => {
    const demand = new Map(Array.from({ length: 500 }, (_, i) => [i, 1] as const));
    const outlets = Array.from({ length: 500 }, (_, i) => ({ components: [i, (i + 1) % 500], capacity: 1 }));
    const steps = allocateDisposalSteps(demand, outlets);
    expect(steps.next().done).toBe(false);
    const result = drain(steps);
    expect(result).toEqual(allocateDisposal(demand, outlets));
    expect(result.used.reduce((a, b) => a + b, 0)).toBe(500);
  });

  it('matches exhaustive minimum cuts on varied small service graphs', () => {
    let random = 12345;
    const draw = (max: number) => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random % max; };
    for (let trial = 0; trial < 100; trial++) {
      const count = 2 + draw(5);
      const demand = new Map(Array.from({ length: count }, (_, i) => [i, draw(21) / 2]));
      const outlets = Array.from({ length: 1 + draw(6) }, () => ({
        capacity: draw(31) / 2, components: [...demand.keys()].filter(() => draw(3) !== 0),
      }));
      // Every finite cut selects road components and all outlets reachable from them.
      let cut = Infinity;
      for (let subset = 0; subset < 1 << count; subset++) {
        let amount = 0;
        for (const [component, tons] of demand) if (!(subset & 1 << component)) amount += tons;
        for (const outlet of outlets) if (outlet.components.some((component) => subset & 1 << component)) amount += outlet.capacity;
        cut = Math.min(cut, amount);
      }
      const result = allocateDisposal(demand, outlets);
      expect(result.used.reduce((a, b) => a + b, 0)).toBeCloseTo(cut, 8);
      expect([...result.collected.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(cut, 8);
      for (const [component, tons] of result.collected) expect(tons).toBeLessThanOrEqual(demand.get(component)! + 1e-8);
      result.used.forEach((tons, i) => { expect(tons).toBeGreaterThanOrEqual(0); expect(tons).toBeLessThanOrEqual(outlets[i]!.capacity + 1e-8); });
    }
  });
});
