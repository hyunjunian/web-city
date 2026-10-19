import { describe, expect, it } from 'vitest';
import { City, Net, Terrain } from '../src';
import { computeNetworkFields, computeNetworkFieldsSteps, createFields } from '../src/sim/fields';
import { linkAll } from '../src/sim/state';
import { Rng } from '../src/rng';

describe('network field preprocessing', () => {
  it('rebuilds geometry when explicitly refreshed after direct state-array edits', () => {
    const city = new City({ size: 32, water: false });
    for (const y of [10, 20]) {
      city.state.net.fill(Net.None);
      for (let x = 0; x < city.size; x++) city.state.net[y * city.size + x] = Net.Road;
      city.state.height[(y - 1) * city.size + 5] = 80;
      city.state.terrain[(y + 1) * city.size + 5] = Terrain.Water;
      linkAll(city.state);
      city.refresh();
      const expected = createFields(city.size);
      computeNetworkFields(city.state, expected, city.cfg);
      for (const key of ['access', 'accessDist', 'component', 'landValue', 'slope', 'industrialAccess', 'connections'] as const) {
        expect(city.fields[key]).toEqual(expected[key]);
      }
      expect(city.fields.access[y * city.size + 5]).toBe(y * city.size + 5);
    }
  });

  it('assigns the nearest road within driveway reach, with stable ties, on varied map sizes', () => {
    const random = new Rng(310);
    for (const n of [16, 31, 64]) {
      const city = new City({ size: n, water: false });
      for (let k = 0; k < n; k++) city.state.net[random.int(n * n)] = Net.Road;
      linkAll(city.state);
      const f = createFields(n);
      computeNetworkFields(city.state, f, city.cfg);
      const roads = Array.from(city.state.net.keys()).filter((i) => city.state.net[i] === Net.Road);
      for (let i = 0; i < n * n; i++) {
        let nearest = -1, distance = 4;
        for (const road of roads) {
          const d = Math.abs(i % n - road % n) + Math.abs(Math.floor(i / n) - Math.floor(road / n));
          if (d < distance) { nearest = road; distance = d; }
        }
        expect(f.access[i]).toBe(nearest);
        expect(f.accessDist[i]).toBe(nearest < 0 ? 255 : distance);
      }
    }
  });

  it('computes shoreline value without counting water as a steep land neighbour', () => {
    const city = new City({ size: 31, water: false });
    const n = city.size;
    city.state.height.fill(20);
    const water = [0, n + 1, 2 * n + 1, n * n - 1];
    for (const i of water) { city.state.terrain[i] = Terrain.Water; city.state.height[i] = 0; }
    const f = createFields(n);
    computeNetworkFields(city.state, f, city.cfg);
    const { max, range } = city.cfg.desirability.waterLandValue;
    for (let i = 0; i < n * n; i++) {
      const distance = Math.min(...water.map((j) => Math.max(Math.abs(i % n - j % n), Math.abs(Math.floor(i / n) - Math.floor(j / n)))));
      const expected = city.state.terrain[i] === Terrain.Water || distance > range ? 0 : max * (1 - (distance - 1) / range);
      expect(f.landValue[i]).toBe(Math.fround(expected));
      expect(f.slope[i]).toBe(0);
    }
  });

  it('reuses work buffers across changed roads and shores without retaining previous access or components', () => {
    const city = new City({ size: 64, water: false });
    city.buildNetwork(0, 20, 63, 20, 'road');
    const reused = createFields(city.size);
    computeNetworkFields(city.state, reused, city.cfg);
    city.state.net.fill(Net.None);
    city.state.terrain.fill(Terrain.Water);
    for (let y = 30; y < 40; y++) for (let x = 30; x < 40; x++) city.state.terrain[y * city.size + x] = Terrain.Land;
    city.state.net[32 * city.size + 32] = Net.Road;
    linkAll(city.state);
    const parts = computeNetworkFieldsSteps(city.state, reused, city.cfg);
    let pieces = 0;
    while (!parts.next().done) pieces++;
    expect(pieces).toBeGreaterThan(0);
    const fresh = createFields(city.size);
    computeNetworkFields(city.state, fresh, city.cfg);
    for (const key of ['access', 'accessDist', 'component', 'componentHasJobs', 'componentHasWork', 'landValue', 'slope'] as const) {
      expect(reused[key]).toEqual(fresh[key]);
    }
    expect(reused.access[20 * city.size]).toBe(-1);
    expect(reused.access[32 * city.size + 32]).toBe(32 * city.size + 32);
  });
});
