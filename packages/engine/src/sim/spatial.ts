import { drain } from './steps';

/** Unreached distance, with room for one-step additions in an Int32. */
export const DISTANCE_INF = 0x3fffffff;

/** Exact eight-direction distance to any source, leaving distances above cap unreached. */
export function cappedChebyshev(n: number, sources: Iterable<number>, out: Int32Array, cap: number): void {
  drain(cappedChebyshevSteps(n, sources, out, cap));
}

/** Raster distance transform restricted to the sources' bounding box plus their reach, with pauses on large maps. */
export function* cappedChebyshevSteps(n: number, sources: Iterable<number>, out: Int32Array, cap: number): Generator<void, void> {
  out.fill(DISTANCE_INF);
  let minX = n, minY = n, maxX = -1, maxY = -1;
  let seeded = 0;
  for (const i of sources) {
    out[i] = 0;
    const x = i % n;
    const y = (i - x) / n;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if ((++seeded & 0x3fff) === 0) yield;
  }
  if (maxX < 0 || cap < 1) return;
  // Every shortest chessboard path stays in the rectangle between its
  // source and destination. Outside this expanded box nothing is in reach.
  const margin = Number.isFinite(cap) ? Math.floor(cap) : n;
  const x0 = Math.max(0, minX - margin), x1 = Math.min(n - 1, maxX + margin);
  const y0 = Math.max(0, minY - margin), y1 = Math.min(n - 1, maxY + margin);
  for (let y = y0; y <= y1; y++) {
    const row = y * n;
    for (let x = x0; x <= x1; x++) {
      const i = row + x;
      let d = out[i]!;
      if (d === 0) continue;
      if (x > x0 && out[i - 1]! + 1 < d) d = out[i - 1]! + 1;
      if (y > y0) {
        const up = i - n;
        if (out[up]! + 1 < d) d = out[up]! + 1;
        if (x > x0 && out[up - 1]! + 1 < d) d = out[up - 1]! + 1;
        if (x < x1 && out[up + 1]! + 1 < d) d = out[up + 1]! + 1;
      }
      out[i] = d;
    }
    if (((y - y0) & 31) === 31) yield;
  }
  for (let y = y1; y >= y0; y--) {
    const row = y * n;
    for (let x = x1; x >= x0; x--) {
      const i = row + x;
      let d = out[i]!;
      if (d === 0) continue;
      if (x < x1 && out[i + 1]! + 1 < d) d = out[i + 1]! + 1;
      if (y < y1) {
        const down = i + n;
        if (out[down]! + 1 < d) d = out[down]! + 1;
        if (x > x0 && out[down - 1]! + 1 < d) d = out[down - 1]! + 1;
        if (x < x1 && out[down + 1]! + 1 < d) d = out[down + 1]! + 1;
      }
      out[i] = d > cap ? DISTANCE_INF : d;
    }
    if (((y1 - y) & 31) === 31) yield;
  }
}
