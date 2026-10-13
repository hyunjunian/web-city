import { describe, expect, it } from 'vitest';
import { MinHeap } from '../src/sim/heap';

describe('routing priority queue', () => {
  it('returns ascending keys and matching ids across growth and repeated empty/refill cycles', () => {
    const heap = new MinHeap();
    for (let cycle = 0; cycle < 3; cycle++) {
      const entries = Array.from({ length: 2_000 }, (_, i) => ({ key: ((i * 7919) % 2003) + cycle / 4, id: i }));
      for (const entry of entries) heap.push(entry.key, entry.id);
      const sorted = [...entries].sort((a, b) => a.key - b.key);
      for (const entry of sorted) {
        expect(heap.pop()).toBe(entry.id);
        expect(heap.lastKey).toBe(entry.key);
      }
      expect(heap.size).toBe(0);
    }
  });

  it('preserves the established equal-key route order and duplicate states', () => {
    const heap = new MinHeap();
    for (let id = 0; id < 5; id++) heap.push(1, id);
    expect(Array.from({ length: 5 }, () => heap.pop())).toEqual([0, 4, 3, 2, 1]);
    heap.push(10, 7); heap.push(1, 7); heap.push(5, 8);
    expect([heap.pop(), heap.lastKey]).toEqual([7, 1]);
    expect([heap.pop(), heap.lastKey]).toEqual([8, 5]);
    expect([heap.pop(), heap.lastKey]).toEqual([7, 10]);
  });

  it('keeps double-precision costs and signed map ids, and rejects an empty pop', () => {
    const heap = new MinHeap();
    heap.push(1 + 2 ** -40, 0x7fffffff);
    heap.push(-(2 ** -40), -1);
    heap.push(1, 1);
    expect(heap.pop()).toBe(-1);
    expect(heap.pop()).toBe(1);
    expect(heap.pop()).toBe(0x7fffffff);
    expect(heap.lastKey).toBe(1 + 2 ** -40);
    expect(() => heap.pop()).toThrow(RangeError);
  });
});
