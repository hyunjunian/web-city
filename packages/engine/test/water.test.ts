import { describe, expect, it } from 'vitest';
import { City, loadCity, saveCity, type CityOptions } from '../src';
import { createFields } from '../src/sim/fields';
import { computeWater, computeWaterSteps } from '../src/sim/services';

/**
 * A small town rarely outgrows the well-water caps (stage 3), so
 * some tests lower every cap to stage 1 to see the rule bite quickly.
 */
const LOW_CAPS = {
  services: {
    waterStageCap: {
      'R$': 1, 'R$$': 1, 'R$$$': 0, 'Cs$': 1, 'Cs$$': 1, 'Cs$$$': 0, 'Co$$': 1, 'Co$$$': 0, IA: 1, ID: 1, IM: 1, IHT: 0,
    },
  },
};

/** Powered town: homes north of a road, industry south, gas plant beyond. */
function town(n = 48, config?: CityOptions['config']): City {
  const city = new City({ size: n, seed: 5, difficulty: 'easy', water: false, config });
  city.state.funds = 5_000_000;
  city.buildNetwork(0, 20, n - 1, 20, 'road');
  city.zone(1, 12, n - 2, 19, 'R-high');
  city.zone(1, 21, n - 2, 30, 'I-high');
  city.placeStructure('gasPlant', 1, 33);
  return city;
}

const all = (c: City) => [...c.state.buildings.values()];
const pumps = (c: City) => [...c.state.structures.values()].filter((s) => s.kind === 'waterPump');

describe('water', () => {
  it.each([false, true])('rations water by distance to imported sources as well as local pumps (local pump: %s)', (localPump) => {
    const city = new City({ size: 32, water: false, config: {
      services: { waterPerCapita: { 'R$': 1 } },
      structures: { waterTower: { pump: { output: 500 } } },
    } });
    city.state.funds = 1_000_000;
    city.buildPipe(0, 10, 31, 10);
    city.setNeighbour(1, 'developed', 100);
    if (localPump) {
      city.placeStructure('windPlant', 0, 6);
      city.placeStructure('waterTower', 0, 10);
    }
    // Insertion order deliberately starts at the eastern import, not the far end.
    const homes = [26, 16, 6].map((x) => {
      const id = city.state.nextId++;
      const home = {
        id, x, y: 11, w: 1, h: 1, stage: 1, origType: 'R$' as const, type: 'R$' as const,
        capacity: 1_000, occupancy: 1, filled: 0, distressMonths: 0, noRoadMonths: 0, noPowerMonths: 0,
        powered: false, noWaterMonths: 0, watered: false, age: 30, eq: 20, hq: 20, abandonReason: null,
        builtDay: 0, commute: -1, noJobMonths: 0, historical: false,
      };
      city.state.buildings.set(id, home);
      city.state.occupant[11 * city.size + x] = id;
      return home;
    });
    city.refresh();
    expect(city.makeDeal(1, 'water', 'buy', 2_000).ok).toBe(true);
    city.refreshIfDirty();
    expect(city.water.supply).toBe(localPump ? 2_500 : 2_000);
    expect(city.water.shortages).toBe(1);
    expect(homes.map((home) => home.watered)).toEqual(localPump ? [true, false, true] : [true, true, false]);
  });

  it('reuses tile work across changed pipe layouts and supplied coverage without retaining old queue entries', () => {
    const city = new City({ size: 64, water: false });
    city.state.funds = 1_000_000;
    city.placeStructure('gasPlant', 2, 2);
    city.placeStructure('waterPump', 8, 2);
    const reused = createFields(city.size);
    for (let turn = 0; turn < 4; turn++) {
      city.state.pipe.fill(0);
      const y = 2 + turn;
      for (let x = 8; x < 40 - turn * 4; x++) city.state.pipe[y * city.size + x] = 1;
      for (let x = 4; x < 16; x++) city.state.pipe[(y + 3) * city.size + x] = 1;
      city.state.departments.water = turn % 2 ? 0 : 100;
      const steps = computeWaterSteps(city.state, reused, city.cfg);
      let result = steps.next();
      while (!result.done) result = steps.next();
      const fresh = createFields(city.size);
      expect(result.value).toEqual(computeWater(city.state, fresh, city.cfg));
      expect(reused.pipeGrid).toEqual(fresh.pipeGrid);
      expect(reused.waterNet).toEqual(fresh.waterNet);
      expect(reused.watered).toEqual(fresh.watered);
    }
  });

  it('honours a configured service radius larger than a byte', () => {
    const city = new City({ size: 264, water: false, config: { services: { waterRadius: 260 } } });
    city.placeStructure('windPlant', 0, 0);
    city.placeStructure('waterTower', 2, 0);
    expect(city.query(262, 0)!.watered).toBe(true);
    expect(city.query(263, 0)!.watered).toBe(false);
  });

  it('an unconnected pipe does not take water away from an overlapping supplied network', () => {
    const city = new City({ size: 32, water: false });
    city.placeStructure('windPlant', 2, 10);
    city.placeStructure('waterTower', 5, 10);
    city.buildPipe(6, 10, 10, 10);
    expect(city.query(15, 10)!.watered).toBe(true);
    city.buildPipe(15, 10, 15, 10);
    expect(city.query(15, 10)!.watered).toBe(true);
    expect(city.query(20, 10)!.watered).toBe(false);
  });

  it('without water, buildings stay at or below their well-water stage cap', () => {
    const city = town();
    city.step(360 * 2);
    expect(all(city).length).toBeGreaterThan(0);
    for (const b of all(city)) {
      if (!b.type) continue;
      expect(b.stage).toBeLessThanOrEqual(city.cfg.services.waterStageCap[b.type]);
    }
    // ID/IM: stage 1 only; R$$$ and IHT never develop.
    expect(all(city).some((b) => b.type === 'R$$$' || b.type === 'IHT')).toBe(false);
  }, 60_000);

  it('pipes water tiles within six tiles, and a pump needs power', () => {
    const city = town();
    city.buildPipe(5, 10, 40, 10);
    expect(city.query(20, 16)!.watered).toBe(false); // no source yet
    city.placeStructure('waterPump', 41, 10);
    expect(city.query(20, 16)!.watered).toBe(true);
    expect(city.query(20, 17)!.watered).toBe(false);
    expect(city.stats().water.supply).toBeCloseTo(20_000, -2);
    // Off the power grid, the pump supplies nothing.
    const remote = new City({ size: 48, water: false });
    remote.placeStructure('waterPump', 40, 40);
    remote.refresh();
    expect(remote.water.supply).toBe(0);
  });

  it('with water, larger buildings develop', () => {
    // No fires: a burned-down plant would empty the town for want of power.
    const city = town(48, { ...LOW_CAPS, safety: { fires: false } } as CityOptions['config']);
    city.buildPipe(1, 16, 46, 16);
    city.buildPipe(1, 25, 46, 25);
    city.buildPipe(10, 16, 10, 25);
    city.placeStructure('waterPump', 45, 10);
    city.step(360 * 3);
    const caps = city.cfg.services.waterStageCap;
    expect(all(city).some((b) => b.type && b.stage > caps[b.type])).toBe(true);
  }, 60_000);

  it('removing the pipes abandons buildings above their cap after six months', () => {
    // No fires: a burned-down plant would abandon them for want of power first.
    const city = town(48, { ...LOW_CAPS, safety: { fires: false } } as CityOptions['config']);
    city.buildPipe(1, 16, 46, 16);
    city.buildPipe(1, 25, 46, 25);
    city.buildPipe(10, 16, 10, 25);
    city.placeStructure('waterPump', 45, 10);
    city.step(360 * 3);
    const caps = city.cfg.services.waterStageCap;
    const big = all(city).filter((b) => b.type && b.stage > caps[b.type]);
    expect(big.length).toBeGreaterThan(0);
    // The pump itself also waters six tiles around it, so remove it too.
    city.bulldozePipes(0, 0, 47, 47);
    city.bulldoze(45, 10, 45, 10);
    // Abandoned buildings may later be reoccupied by a lower type that can
    // live on well water, so watch month by month.
    let sawNoWater = false;
    for (let m = 0; m < 7; m++) {
      city.step(30);
      if (all(city).some((b) => b.abandonReason === 'no-water')) sawNoWater = true;
      if (m === 3) expect(big.some((b) => city.state.buildings.get(b.id)?.type)).toBe(true); // still holding on
    }
    expect(sawNoWater).toBe(true);
    // Nothing dry stays above its cap.
    for (const b of all(city)) {
      if (b.type && !b.watered) expect(b.stage).toBeLessThanOrEqual(LOW_CAPS.services.waterStageCap[b.type]);
    }
  }, 60_000);

  it('shortages cut off the buildings farthest from the source first', () => {
    // No fires: a burning gas plant would black the town out and blur the test.
    const city = town(48, { safety: { fires: false } });
    city.buildPipe(1, 16, 46, 16);
    city.buildPipe(1, 25, 46, 25);
    city.buildPipe(10, 16, 10, 25);
    city.placeStructure('waterTower', 46, 10); // 2,400 m³: too little
    city.step(360);
    const s = city.stats();
    expect(s.water.demand).toBeGreaterThan(s.water.supply);
    const dry = all(city).filter((b) => b.type && !b.watered);
    const wet = all(city).filter((b) => b.type && b.watered);
    expect(dry.length).toBeGreaterThan(0);
    expect(wet.length).toBeGreaterThan(0);
    const meanX = (l: typeof dry) => l.reduce((a, b) => a + b.x, 0) / l.length;
    expect(meanX(dry)).toBeLessThan(meanX(wet)); // the tower is at the east end
  }, 60_000);

  it('a piped network with no working source counts as short once the city has water', () => {
    // Plenty of supply: this test isolates a missing source from capacity shortages in overlapping service areas.
    const city = town(48, { safety: { fires: false }, structures: { waterTower: { pump: { output: 100_000 } } } });
    city.buildPipe(1, 25, 46, 25); // under the industry: pumps none
    city.step(120);
    expect(city.stats().water.shortages).toBe(0); // no water anywhere yet: that's 'no water', not a shortage
    city.buildPipe(1, 16, 20, 16); // homes' own network, with a tower
    city.placeStructure('waterTower', 2, 10);
    city.step(60);
    expect(city.stats().water.shortages).toBeGreaterThan(0); // the industry's pipes still have no source
    // The advisor says to join them up, not to build more pumps (there may be plenty).
    const codes = city.advisors().map((a) => a.code);
    expect(codes).toContain('pipesNoSource');
    // It points at one of those buildings: on the pipes under the industry, where to join them up.
    const at = city.advisors().find((a) => a.code === 'pipesNoSource')!.at!;
    expect(city.query(at[0], at[1])!.building?.watered).toBe(false);
    expect(city.stats().water.sourceless).toBe(city.stats().water.shortages);
    expect(codes).not.toContain('waterShort');
    // With a tower of their own that is switched off, it's the tower to fix, not the pipes.
    city.buildPipe(40, 25, 40, 32);
    expect(city.placeStructure('waterTower', 41, 32).ok).toBe(true);
    const tower = [...city.state.structures.values()].find((st) => st.kind === 'waterTower' && st.x === 41)!;
    tower.life = 110; // worn out: pumps and towers stop at 110% of their life
    city.step(30);
    const w = city.stats().water;
    expect(w.pumpsOff).toBeGreaterThan(0);
    expect(w.pumpsOffAt).toEqual({ x: 41, y: 32 }); // the tip points at that tower
    expect(city.advisors().map((x) => x.code)).toContain('pumpsOff');
  }, 60_000);

  it('heavy water pollution shuts a pump down; a treatment plant cleans it', () => {
    const city = town();
    city.placeStructure('waterPump', 40, 8); // within reach of the zones' power
    const pump = pumps(city)[0]!;
    city.fields.waterPollution[8 * 48 + 40] = 600;
    city.refresh();
    expect(pump.capacity).toBeGreaterThan(0); // refresh recomputed pollution: clean again
    const dirty = new City({ size: 48, water: false, config: { services: { pumpPollutionLimit: -1 } } });
    dirty.zone(1, 1, 5, 5, 'R-low', { autoStreets: false });
    dirty.placeStructure('windPlant', 7, 1);
    dirty.placeStructure('waterPump', 9, 1);
    dirty.refresh();
    expect(pumps(dirty)[0]!.capacity).toBe(0);
  });

  it('farms pollute the water from every tile (WP 4, radius 6)', () => {
    const city = new City({ size: 48, seed: 1, water: false });
    const s = city.state;
    // A 15×15 farm made of 3×3 lots.
    for (let y = 2; y < 17; y += 3) for (let x = 2; x < 17; x += 3) {
      const id = s.nextId++;
      s.buildings.set(id, {
        id, x, y, w: 3, h: 3, stage: 1, origType: 'IA', type: 'IA', capacity: 10, occupancy: 1, filled: 0,
        distressMonths: 0, noRoadMonths: 0, noPowerMonths: 0, powered: true, noWaterMonths: 0, watered: false,
        age: 30, eq: 20, hq: 20, abandonReason: null, builtDay: 0, commute: 10, noJobMonths: 0, historical: false,
      });
      for (let yy = y; yy < y + 3; yy++) for (let xx = x; xx < x + 3; xx++) s.occupant[yy * 48 + xx] = id;
    }
    city.refresh();
    expect(city.query(9, 9)!.waterPollution).toBeGreaterThan(150); // ~4 × the tiles within 6, fading
    expect(city.query(9, 9)!.waterPollution).toBeGreaterThan(city.query(2, 2)!.waterPollution);
    expect(city.query(30, 30)!.waterPollution).toBe(0);
  });

  it('treatment plants lower water pollution around them', () => {
    const city = town();
    // Keep source emissions constant: placing the treatment facility itself adds power demand.
    city.cfg.energy.idleEmissionShare = 1;
    city.refresh();
    const before = city.query(10, 38)!.waterPollution;
    expect(before).toBeGreaterThan(0);
    city.placeStructure('waterTreatmentPlant', 8, 37); // next to the gas plant, so powered
    expect(city.query(10, 38)!.waterPollution).toBe(before); // it takes a couple of months
    city.step(70);
    expect(city.query(10, 38)!.waterPollution).toBeLessThan(before);
  });

  it('pumps age and charge water department upkeep', () => {
    const city = town();
    city.placeStructure('waterPump', 40, 8);
    city.buildPipe(1, 5, 39, 5);
    city.step(30);
    expect(pumps(city)[0]!.life).toBeGreaterThan(0);
    expect(city.state.lastBudget!.waterUpkeep).toBeCloseTo(350 + 39 * 0.1, 1);
    // Water buildings are funded by the department slider together, output with it.
    const full = pumps(city)[0]!.capacity;
    city.setDepartmentFunding('water', 50);
    city.refresh();
    expect(pumps(city)[0]!.capacity).toBeCloseTo(full / 2, 0);
  });

  it('saves pipes', () => {
    const city = town();
    city.buildPipe(1, 5, 39, 5);
    const copy = loadCity(JSON.parse(JSON.stringify(saveCity(city))));
    expect(copy.query(20, 5)!.pipe).toBe(true);
  });
});

describe('pumps off the network', () => {
  it("don't count toward the city's supply, and the advisor says so", () => {
    const city = town();
    city.buildPipe(1, 16, 46, 16);
    city.placeStructure('waterPump', 10, 17); // on the town's pipe
    city.placeStructure('waterPump', 40, 42); // out on its own, powered by a line but watering nobody
    city.buildPowerLine(40, 31, 40, 41);
    city.step(120);
    const pumpsNow = pumps(city);
    const lone = pumpsNow.find((p) => p.x === 40)!;
    const used = pumpsNow.find((p) => p.x === 10)!;
    expect(lone.load).toBe(0);
    expect(city.stats().water.supply).toBeCloseTo(used.capacity, 0);
    expect(city.advisors()).toContainEqual(expect.objectContaining({ code: 'idlePump', value: 1 }));
  }, 60_000);
});

describe('plants off the grid', () => {
  it("don't count toward the city's power supply, and the advisor says so", () => {
    const city = town();
    city.placeStructure('coalPlant', 40, 40); // far from any zone, no line
    city.step(60);
    const gas = [...city.state.structures.values()].find((s) => s.kind === 'gasPlant')!;
    expect(city.stats().power.supply).toBeCloseTo(gas.capacity, 0);
    expect(city.advisors()).toContainEqual(expect.objectContaining({ code: 'idlePlant', value: 1 }));
    // The advice points at the idle plant, so a client can show it.
    const coal = [...city.state.structures.values()].find((s) => s.kind === 'coalPlant')!;
    expect(city.advisors().find((a) => a.code === 'idlePlant')!.at).toEqual([coal.x, coal.y]);
  }, 60_000);
});

describe('sample city', () => {
  it('lays out every building and grows into a working town', async () => {
    const { sampleCity } = await import('../src');
    const { sampleFailures } = await import('../src/sample');
    const city = sampleCity({ days: 150 });
    expect(sampleFailures).toEqual([]);
    const s = city.stats();
    expect(s.population).toBeGreaterThan(10_000);
    expect(s.abandoned).toBeLessThan(s.buildings * 0.05); // a few shops empty when demand dips
    expect(s.garbage.uncollected).toBe(0);
    expect(s.water.shortages).toBe(0);
    expect(s.power.demand).toBeLessThan(s.power.supply);
  }, 60_000);

  it('opens (at its default nine months) filled in, with hardly an empty shop, paying its way', async () => {
    const { sampleCity } = await import('../src');
    const city = sampleCity();
    const s = city.stats();
    expect(s.population).toBeGreaterThan(20_000);
    // A stray rich shop beside the factories may stand empty.
    expect(s.abandoned).toBeLessThanOrEqual(2);
    const b = city.state.lastBudget!;
    expect(b.income).toBeGreaterThanOrEqual(b.expenses);
  }, 60_000);
});

