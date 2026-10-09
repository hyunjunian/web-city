// Flat terrain with a river and a lake (water drives land value).

import { Rng } from '../rng';
import { Terrain } from './state';

export function generateTerrain(size: number, seed: number, water = true): Uint8Array {
  const t = new Uint8Array(size * size);
  if (!water) return t;
  const rng = new Rng(seed ^ 0x9e3779b9);
  const set = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < size && y < size) t[y * size + x] = Terrain.Water;
  };

  // A river meandering from the top edge to the bottom edge, off-centre.
  let x = size * (rng.next() < 0.5 ? 0.15 + rng.next() * 0.15 : 0.7 + rng.next() * 0.15);
  let drift = 0;
  const width = Math.max(2, Math.round(size / 40));
  for (let y = 0; y < size; y++) {
    drift = Math.max(-0.8, Math.min(0.8, drift + (rng.next() - 0.5) * 0.35));
    x = Math.max(width, Math.min(size - 1 - width, x + drift));
    for (let dx = -width; dx <= width; dx++) set(Math.round(x + dx), y);
  }

  // A lake on the opposite side.
  const cx = x < size / 2 ? size * (0.6 + rng.next() * 0.2) : size * (0.2 + rng.next() * 0.2);
  const cy = size * (0.25 + rng.next() * 0.5);
  const r = size * (0.05 + rng.next() * 0.04);
  for (let yy = Math.floor(cy - r * 1.5); yy <= cy + r * 1.5; yy++) {
    for (let xx = Math.floor(cx - r * 1.5); xx <= cx + r * 1.5; xx++) {
      const a = Math.atan2(yy - cy, xx - cx);
      const wobble = 1 + 0.25 * Math.sin(a * 3 + seed) + 0.1 * Math.sin(a * 7);
      if (Math.hypot(xx - cx, (yy - cy) * 1.2) < r * wobble) set(xx, yy);
    }
  }
  return t;
}

/**
 * Rolling hills from smoothed value noise (two octaves), lowered towards
 * the water so river banks and lake shores slope down to it. Flat maps get
 * one height everywhere.
 */
export function generateHeights(
  size: number, seed: number, terrain: Uint8Array, hills: boolean, h: { flat: number; base: number; hills: number; shore: number },
): Uint8Array {
  const out = new Uint8Array(size * size);
  if (!hills) {
    for (let i = 0; i < out.length; i++) out[i] = terrain[i] === Terrain.Water ? 0 : h.flat;
    return out;
  }
  const rng = new Rng(seed ^ 0x2545f491);
  const octave = (cells: number) => {
    const g = cells + 2;
    const grid = Float32Array.from({ length: g * g }, () => rng.next());
    return (x: number, y: number) => {
      const fx = (x / size) * cells;
      const fy = (y / size) * cells;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const v = (a: number, b: number) => grid[(y0 + b) * g + x0 + a]!;
      return (v(0, 0) * (1 - sx) + v(1, 0) * sx) * (1 - sy) + (v(0, 1) * (1 - sx) + v(1, 1) * sx) * sy;
    };
  };
  const big = octave(3);
  const small = octave(9);
  // Distance to water, to bring the land down to the shore.
  const dist = new Int32Array(size * size).fill(1 << 20);
  const queue: number[] = [];
  for (let i = 0; i < out.length; i++) if (terrain[i] === Terrain.Water) {
    dist[i] = 0;
    queue.push(i);
  }
  for (let k = 0; k < queue.length; k++) {
    const i = queue[k]!;
    const x = i % size;
    const y = (i - x) / size;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const j = ny * size + nx;
      if (dist[j]! > dist[i]! + 1) {
        dist[j] = dist[i]! + 1;
        queue.push(j);
      }
    }
  }
  // A few rounded hills stand out of the rolling land (high ground for good views).
  const bumps = Array.from({ length: Math.max(2, Math.round(size / 32)) }, () => ({
    x: rng.next() * size, y: rng.next() * size, r: 5 + rng.next() * size * 0.06, h: 15 + rng.next() * 25,
  }));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (terrain[i] === Terrain.Water) continue;
      const shore = Math.min(1, dist[i]! / h.shore);
      const v = 0.7 * big(x, y) + 0.3 * small(x, y);
      let hill = 0;
      for (const b of bumps) {
        const d = Math.hypot(x - b.x, y - b.y) / b.r;
        if (d < 1) hill += b.h * (1 - d * d) * (1 - d * d);
      }
      out[i] = Math.max(1, Math.min(250, Math.round((h.base + h.hills * v + hill) * shore)));
    }
  }
  return out;
}

/** Natural woods for a fresh map with water: a few clumps of grown trees on dry land. */
export function generateForest(size: number, seed: number, terrain: Uint8Array): Uint8Array {
  const trees = new Uint8Array(size * size);
  const rng = new Rng(seed ^ 0x51ed270b);
  const clumps = Math.max(2, Math.round(size / 24));
  for (let c = 0; c < clumps; c++) {
    const cx = rng.next() * size;
    const cy = rng.next() * size;
    const r = 2 + rng.next() * size * 0.04;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(size - 1, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(size - 1, Math.ceil(cx + r)); x++) {
        const i = y * size + x;
        if (terrain[i] === Terrain.Water || Math.hypot(x - cx, y - cy) > r * (0.7 + 0.3 * rng.next())) continue;
        trees[i] = 60 + Math.floor(rng.next() * 60);
      }
    }
  }
  return trees;
}

/** A grayscale image as raw pixels, one byte (0–255) per pixel, row-major. */
export interface Heightmap {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

/**
 * Terrain and heights from a grayscale topographical map: values
 * below sea level (83) are water, the rest land rising `metresPerStep` a
 * shade. The image is sampled bilinearly onto the city's tiles; `crop` picks
 * the part of a larger (region) image this city covers, in image pixels.
 */
export function terrainFromHeightmap(
  size: number, map: Heightmap, g: { seaLevel: number; metresPerStep: number },
  crop: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: map.width, h: map.height },
): { terrain: Uint8Array; height: Uint8Array } {
  const terrain = new Uint8Array(size * size);
  const height = new Uint8Array(size * size);
  const px = (x: number, y: number) => {
    const cx = Math.max(0, Math.min(map.width - 1, x));
    const cy = Math.max(0, Math.min(map.height - 1, y));
    return map.data[cy * map.width + cx] ?? 0;
  };
  for (let ty = 0; ty < size; ty++) {
    for (let tx = 0; tx < size; tx++) {
      // Centre of the tile in image coordinates.
      const fx = crop.x + ((tx + 0.5) / size) * crop.w - 0.5;
      const fy = crop.y + ((ty + 0.5) / size) * crop.h - 0.5;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const ax = fx - x0;
      const ay = fy - y0;
      const v = (px(x0, y0) * (1 - ax) + px(x0 + 1, y0) * ax) * (1 - ay) + (px(x0, y0 + 1) * (1 - ax) + px(x0 + 1, y0 + 1) * ax) * ay;
      const i = ty * size + tx;
      if (v < g.seaLevel) {
        terrain[i] = Terrain.Water;
        height[i] = 0;
      } else height[i] = Math.max(1, Math.min(250, Math.round(1 + (v - g.seaLevel) * g.metresPerStep)));
    }
  }
  return { terrain, height };
}
