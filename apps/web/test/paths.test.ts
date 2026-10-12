import { describe, expect, it } from 'vitest';
import { straightRuns } from '../src/util';

describe('a path laid as straight runs', () => {
  it('lays one tile, or a straight line, as one run end to end', () => {
    expect(straightRuns([[3, 4]])).toEqual([[3, 4, 3, 4]]);
    expect(straightRuns([[1, 1], [2, 1], [3, 1]])).toEqual([[1, 1, 3, 1]]);
  });
  it('turns at each corner, the corner ending one run and starting the next', () => {
    expect(straightRuns([[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]])).toEqual([[0, 0, 2, 0], [2, 0, 2, 2]]);
    expect(straightRuns([[0, 0], [0, 1], [1, 1], [1, 2]])).toEqual([[0, 0, 0, 1], [0, 1, 1, 1], [1, 1, 1, 2]]);
  });
  it('covers every tile of the path and no other', () => {
    const path: [number, number][] = [[5, 5], [5, 6], [5, 7], [6, 7], [7, 7], [7, 6]];
    const tiles = straightRuns(path).flatMap(([x0, y0, x1, y1]) => {
      const out: string[] = [];
      for (let k = 0; k <= Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); k++) out.push(`${x0 + Math.sign(x1 - x0) * k},${y0 + Math.sign(y1 - y0) * k}`);
      return out;
    });
    expect([...new Set(tiles)].sort()).toEqual(path.map((p) => p.join(',')).sort());
  });
});
