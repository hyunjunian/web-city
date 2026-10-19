import { describe, expect, it } from 'vitest';
import { City, Net, Terrain, type Building } from '../src';
import { computeNetworkFields, computeNetworkFieldsSteps, createFields } from '../src/sim/fields';
import { linkAll } from '../src/sim/state';
import { Rng } from '../src/rng';
import { assignTraffic } from '../src/sim/transport';

describe('network field preprocessing', () => {
  it.each(['civic', 'business'] as const)('reaches a shared %s workplace through every frontage without multiplying its actual jobs', kind => {
    const city = new City({ size: 32, water: false, config: { structures: { smallPoliceStation: { w: 4, h: 2, jobs: [100, 0, 0] } } } });
    city.state.funds = 1_000_000;
    for (const y of [4, 7]) city.buildNetwork(2, y, 26, y, 'road');
    const add = (x: number, y: number, capacity: number, type: 'R$' | 'ID', w = 1, h = 1) => {
      const id = city.state.nextId++;
      const b: Building = { id, x, y, w, h, stage: 1, origType: type, type, capacity, occupancy: 1, filled: 0,
        distressMonths: 0, noRoadMonths: 0, noPowerMonths: 0, powered: true, noWaterMonths: 0, watered: true,
        age: 30, eq: 50, hq: 50, abandonReason: null, builtDay: 0, commute: -1, noJobMonths: 0, historical: false };
      city.state.buildings.set(id, b);
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) city.state.occupant[yy * 32 + xx] = id;
    };
    if (kind === 'civic') expect(city.placeStructure('smallPoliceStation', 10, 5).ok).toBe(true);
    else {
      add(10, 5, 100, 'ID', 4, 2);
      city.cfg.demand.workforceProfile.ID = [1, 0, 0];
    }
    add(3, 3, 200, 'R$');
    add(3, 8, 200, 'R$');
    city.refresh();
    const upper = city.fields.component[4 * 32 + 3]!, lower = city.fields.component[7 * 32 + 3]!;
    expect(upper).not.toBe(lower);
    for (const component of [upper, lower]) {
      expect(city.fields.componentHasWork[component]).toBe(1);
      expect(city.fields.componentHasJobs[component]).toBe(1);
    }
    const traffic = assignTraffic(city.state, city.fields, city.cfg);
    expect(Object.entries(traffic.volume).filter(([k]) => !k.startsWith('freight')).reduce((sum, [, v]) => sum + v, 0)).toBeCloseTo(100, 5);
    // Joining the streets gives one workforce of 188 competing for the same
    // 100 jobs: several front tiles must not count the workplace repeatedly.
    expect(city.buildNetwork(2, 4, 2, 7, 'road').ok).toBe(true);
    city.refreshIfDirty();
    const joined = city.fields.component[4 * 32 + 3]!;
    expect(city.fields.componentHasWork[joined]).toBe(1);
    expect(city.fields.componentHasJobs[joined]).toBe(0);
  });

  it('makes potential business jobs reachable from both sides of a zoned tile', () => {
    const city = new City({ size: 32, water: false });
    city.state.funds = 1_000_000;
    for (const y of [4, 6]) city.buildNetwork(2, y, 26, y, 'road');
    city.zone(10, 5, 10, 5, 'C-low', { autoStreets: false });
    city.refresh();
    for (const y of [4, 6]) {
      const component = city.fields.component[y * 32 + 10]!;
      expect(city.fields.componentHasJobs[component]).toBe(1);
    }
  });

  it.each(['roads', 'transit'] as const)('reuses layout geometry for %s funding while refreshing routes and retaining edit invalidation', (department) => {
    const city = new City({ size: 32, water: false });
    city.state.funds = 1_000_000;
    city.buildNetwork(0, 10, 31, 10, 'road');
    city.refreshIfDirty();
    const route = city.fields.travel, n = city.size ** 2;
    let heightReads = 0;
    city.state.height = new Proxy(city.state.height, {
      get(array, key) {
        if (typeof key === 'string' && /^\d+$/.test(key)) heightReads++;
        return Reflect.get(array, key, array);
      },
    });
    city.setDepartmentFunding(department, 80);
    city.refreshIfDirty();
    expect(city.fields.travel).not.toBe(route);
    expect(heightReads).toBeLessThan(3 * n);
    const expected = createFields(city.size);
    computeNetworkFields(city.state, expected, city.cfg);
    for (const key of ['access', 'accessDist', 'component', 'componentHasJobs', 'componentHasWork', 'landValue', 'slope', 'industrialAccess'] as const) {
      expect(city.fields[key]).toEqual(expected[key]);
    }
    city.buildNetwork(2, 24, 28, 24, 'road');
    city.refreshIfDirty();
    expect(city.fields.access[24 * city.size + 12]).toBe(24 * city.size + 12);
  });

  it('splits industrial access output and the final job scan across preprocessing pieces', () => {
    const city = new City({ size: 256, water: false }), n = city.size ** 2;
    const fields = createFields(city.size);
    let reads = 0, writes = 0, totalWrites = 0, maxReads = 0, maxWrites = 0;
    const indexed = (key: PropertyKey) => typeof key === 'string' && /^\d+$/.test(key);
    const state = { ...city.state, zone: new Proxy(city.state.zone, {
      get(array, key) { if (indexed(key)) reads++; return Reflect.get(array, key, array); },
    }) };
    fields.industrialAccess = new Proxy(fields.industrialAccess, {
      set(array, key, value) {
        if (indexed(key)) { writes++; totalWrites++; }
        return Reflect.set(array, key, value, array);
      },
    });
    const steps = computeNetworkFieldsSteps(state, fields, city.cfg);
    let done = false;
    while (!done) {
      reads = writes = 0;
      done = !!steps.next().done;
      maxReads = Math.max(maxReads, reads);
      maxWrites = Math.max(maxWrites, writes);
    }
    expect(totalWrites).toBe(n);
    expect(maxReads).toBeLessThan(n);
    expect(maxWrites).toBeLessThan(n);
  });

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
