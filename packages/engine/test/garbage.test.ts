import { describe, expect, it } from 'vitest';
import { City, loadCity, saveCity } from '../src';
import { Rng } from '../src/rng';
import { landfillRegions, landfillRegionsSteps, runGarbage } from '../src/sim/garbage';
import { drain } from '../src/sim/steps';

/** Powered town with homes and industry; no garbage service yet. */
function town(): City {
  const n = 48;
  const city = new City({ size: n, seed: 5, difficulty: 'easy', water: false, config: { safety: { fires: false } } });
  city.state.funds = 5_000_000;
  city.buildNetwork(0, 20, n - 1, 20, 'road');
  city.zone(1, 8, n - 2, 19, 'R-medium');
  city.zone(1, 21, n - 2, 30, 'I-medium');
  city.placeStructure('gasPlant', 1, 33);
  return city;
}

describe('garbage', () => {
  it('picks up reachable piles without shrinking piles on lots cut off from roads', () => {
    const city = new City({ size: 32, water: false });
    city.state.funds = 1_000_000;
    expect(city.buildNetwork(0, 10, 31, 10, 'road').ok).toBe(true);
    expect(city.placeStructure('gasPlant', 1, 11).ok).toBe(true);
    expect(city.placeStructure('windPlant', 1, 23).ok).toBe(true);
    expect(city.zone(20, 11, 23, 14, 'landfill').ok).toBe(true);
    const reachable = 11 * 32 + 1;
    const stranded = 23 * 32 + 1;
    city.state.garbage[reachable] = 20;
    city.state.garbage[stranded] = 20;
    const g = runGarbage(city.state, city.fields, city.cfg, new Rng(1), 0);
    expect(city.state.garbage[reachable]).toBeCloseTo(10);
    expect(city.state.garbage[stranded]).toBe(20);
    expect(g.kept).toBe(20);
    expect(g.landfilled).toBeCloseTo(30); // 20 new + 10 collected from reachable piles
    expect(g.piled).toBeCloseTo(30);
    // Reconnecting the lot makes its old pile collectable next month.
    city.buildNetwork(0, 10, 0, 23, 'road');
    const next = runGarbage(city.state, city.fields, city.cfg, new Rng(1), 0);
    expect(city.state.garbage[stranded]).toBeCloseTo(10);
    expect(next.piled).toBeCloseTo(15);
  });

  it('collects old piles even when no lot on that road makes new garbage', () => {
    const city = new City({ size: 32, water: false });
    city.state.funds = 1_000_000;
    city.buildNetwork(0, 10, 31, 10, 'road');
    city.placeStructure('windPlant', 1, 11); // makes no garbage
    city.zone(20, 11, 23, 14, 'landfill');
    const lot = 11 * 32 + 1;
    const vacant = 9 * 32 + 12;
    const remote = 25 * 32 + 25;
    city.state.garbage[lot] = 20;
    city.state.garbage[vacant] = 12;
    city.state.garbage[remote] = 20;
    const g = runGarbage(city.state, city.fields, city.cfg, new Rng(1), 0);
    expect(g.produced).toBe(0);
    expect(g.landfilled).toBeCloseTo(16);
    expect(city.state.garbage[lot]).toBeCloseTo(10);
    expect(city.state.garbage[vacant]).toBeCloseTo(6);
    expect(city.state.garbage[remote]).toBe(20);
    expect(g.piled).toBeCloseTo(36);
  });

  it.each([0, 50, 100, 120])('at %i percent funding, trucks carry only the reachable backlog share, including a whole large lot', (funding) => {
    const city = new City({ size: 32, water: false, config: { structures: { gasPlant: { garbage: 0 } } } });
    city.state.funds = 1_000_000;
    city.buildNetwork(0, 10, 31, 10, 'road');
    city.placeStructure('gasPlant', 1, 11);
    city.zone(20, 11, 23, 14, 'landfill');
    city.setDepartmentFunding('sanitation', funding);
    const lot = 14 * 32 + 1; // back of a 4×4 lot, beyond the 3-tile driveway reach
    const remote = 25 * 32 + 25;
    expect(city.fields.access[lot]).toBe(-1);
    city.state.garbage[lot] = 20;
    city.state.garbage[remote] = 20;
    const g = runGarbage(city.state, city.fields, city.cfg, new Rng(1), 0);
    const pickedUp = 20 * city.cfg.garbage.backlogPickup * funding / 100;
    expect(g.landfilled).toBeCloseTo(pickedUp);
    expect(city.state.garbage[lot]).toBeCloseTo(20 - pickedUp);
    expect(city.state.garbage[remote]).toBe(20);
    expect(g.piled).toBeCloseTo(40 - pickedUp);
  });

  it('collects a deep industrial lot\'s old pile after the building is abandoned', () => {
    const city = new City({ size: 32, water: false });
    city.state.funds = 1_000_000;
    city.buildNetwork(0, 10, 31, 10, 'road');
    city.zone(1, 11, 7, 17, 'I-medium');
    city.zone(20, 11, 23, 14, 'landfill');
    const id = city.state.nextId++;
    const lot = 14 * 32 + 4;
    city.state.buildings.set(id, {
      id, x: 4, y: 14, w: 1, h: 1, stage: 1, origType: 'ID', type: null,
      capacity: 10, occupancy: 0, filled: 0, distressMonths: 0, noRoadMonths: 0,
      noPowerMonths: 0, powered: false, noWaterMonths: 0, watered: false,
      age: 0, eq: 0, hq: 0, abandonReason: 'no-power', builtDay: 0, commute: -1,
      noJobMonths: 0, historical: false,
    });
    city.state.occupant[lot] = id;
    city.refresh();
    expect(city.fields.accessDist[lot]).toBe(4);
    city.state.garbage[lot] = 20;
    const g = runGarbage(city.state, city.fields, city.cfg, new Rng(1), 0);
    expect(g.produced).toBe(0);
    expect(g.landfilled).toBeCloseTo(10);
    expect(city.state.garbage[lot]).toBeCloseTo(10);
  });

  it('fills road-side landfill tiles first, keeping BFS order within both groups', () => {
    const city = new City({ size: 32, water: false });
    city.buildNetwork(1, 9, 3, 9, 'road');
    city.zone(1, 10, 3, 12, 'landfill');
    const component = city.fields.component[9 * 32 + 1]!;
    const regions = landfillRegions(city.state, city.fields, new Set([component]));
    expect(regions).toHaveLength(1);
    expect(regions[0]!.connected).toBe(true);
    expect(regions[0]!.tiles).toEqual([
      10 * 32 + 1, 10 * 32 + 2, 10 * 32 + 3,
      11 * 32 + 1, 11 * 32 + 2, 12 * 32 + 1,
      11 * 32 + 3, 12 * 32 + 2, 12 * 32 + 3,
    ]);
  });

  it('yields part-way through a large landfill and finishes with the same fill order', () => {
    const city = new City({ size: 64, water: false });
    city.state.funds = 1_000_000;
    city.buildNetwork(1, 0, 62, 0, 'road');
    city.zone(1, 1, 62, 62, 'landfill');
    const served = new Set([city.fields.component[1]!]);
    const g = landfillRegionsSteps(city.state, city.fields, served);
    // The first flood fill itself exceeds a chunk; it must pause before
    // finishing the region, rather than only between separate landfills.
    expect(g.next().done).toBe(false);
    expect(drain(g)).toEqual(landfillRegions(city.state, city.fields, served));
  });

  it('without disposal, garbage piles up on lots and hurts desirability', () => {
    const city = town();
    city.step(360);
    const g = city.stats().garbage;
    expect(g.produced).toBeGreaterThan(0);
    expect(g.piled).toBeGreaterThan(0);
    const b = [...city.state.buildings.values()].find((x) => x.type?.startsWith('R'))!;
    const tile = b.y * 48 + b.x;
    city.state.garbage[tile] = 20;
    city.refresh();
    expect(city.query(b.x, b.y)!.desirability['R$$'].factors.garbage!).toBeLessThan(0);
  }, 30_000);

  it('the Sanitation department funds pickup: underfunded, garbage is left on the lots', () => {
    const run = (sanitation: number) => {
      const city = town();
      city.zone(40, 31, 47, 39, 'landfill');
      city.buildNetwork(39, 21, 39, 39, 'road');
      city.setDepartmentFunding('sanitation', sanitation);
      city.step(360);
      return { g: city.stats().garbage, cost: city.state.lastBudget!.garbageUpkeep };
    };
    const full = run(100);
    const half = run(50);
    // Underfunded trucks leave garbage on the lots: a standing pile builds up
    // until its share of the pickup fills the trucks.
    expect(half.g.piled).toBeGreaterThan(full.g.piled + half.g.produced);
    expect(half.cost).toBeLessThan(full.cost);
  }, 30_000);

  it('a road-connected landfill takes the garbage, 300 t per tile', () => {
    const city = town();
    expect(city.zone(40, 31, 47, 39, 'landfill').ok).toBe(true);
    city.buildNetwork(39, 21, 39, 39, 'road');
    city.step(360);
    const g = city.stats().garbage;
    expect(g.landfilled).toBeGreaterThan(0);
    // Only lots without road access (the off-road gas plant) still pile up.
    expect(g.uncollected).toBeLessThan(g.produced * 0.2);
    const tiles = [...city.state.landfill].filter((v) => v > 0);
    expect(tiles.length).toBeGreaterThan(0);
    expect(Math.max(...tiles)).toBeLessThanOrEqual(300);
    expect(city.state.lastBudget!.garbageUpkeep).toBeGreaterThan(72 * 10 - 1);
  }, 30_000);

  it('a landfill no road reaches is no room: the city hears it is full, and why', () => {
    const city = town();
    expect(city.zone(40, 38, 47, 45, 'landfill').ok).toBe(true); // no road to it
    city.step(90);
    const g = city.stats().garbage;
    expect(g.landfillSpace).toBe(0);
    expect(g.landfillCutOff).toBe(64 * 300);
    const codes = city.advisors().map((a) => a.code);
    expect(codes).toContain('landfillNoRoad');
    expect(city.advisors().find((a) => a.code === 'garbagePiling')!.value).toBe(1);
  }, 30_000);

  it('landfills must be at least 2×2 and cannot be rezoned while full', () => {
    const city = town();
    expect(city.zone(40, 31, 40, 39, 'landfill').ok).toBe(false);
    city.zone(40, 31, 47, 39, 'landfill');
    city.state.landfill[31 * 48 + 40] = 100;
    city.zone(40, 31, 40, 31, 'R-low');
    expect(city.query(40, 31)!.zone).toBe('landfill');
  });

  it('landfills are a strong NIMBY for homes', () => {
    const city = town();
    const before = city.query(30, 15)!.desirability['R$$'].factors.resNimby ?? 0;
    city.zone(28, 0, 33, 5, 'landfill');
    expect(city.query(30, 15)!.desirability['R$$'].factors.resNimby!).toBeLessThan(before);
  });

  it('cut off from roads, a landfill slowly decomposes', () => {
    const city = town();
    city.zone(40, 40, 43, 43, 'landfill');
    const i = 40 * 48 + 40;
    city.state.landfill[i] = 300;
    city.step(30);
    expect(city.state.landfill[i]).toBeCloseTo(285, 0); // 7% capped at 15 t a month
  });

  it('a Waste to Energy plant burns garbage and makes power from it', () => {
    const city = town();
    city.placeStructure('wasteToEnergyPlant', 36, 31);
    city.step(240);
    const wte = [...city.state.structures.values()].find((s) => s.kind === 'wasteToEnergyPlant')!;
    expect(wte.load).toBeGreaterThan(0);
    expect(wte.load).toBeLessThanOrEqual(500);
    city.refresh();
    expect(city.power.supply).toBeGreaterThan(3_000 * 0.95 + wte.load * 10 * 0.9);
  }, 30_000);

  it('recycling centers cut garbage by up to 20%', () => {
    const a = town();
    const b = town();
    b.placeStructure('recyclingCenter', 36, 31);
    a.step(120);
    b.step(120);
    const ga = a.stats().garbage;
    const gb = b.stats().garbage;
    expect(gb.recycled / gb.produced).toBeCloseTo(0.2, 2);
    expect(ga.recycled).toBe(0);
  }, 30_000);

  it('saves piles and landfills', () => {
    const city = town();
    city.zone(40, 40, 43, 43, 'landfill');
    city.state.landfill[40 * 48 + 40] = 123.4;
    city.state.garbage[10 * 48 + 10] = 7.5;
    const copy = loadCity(JSON.parse(JSON.stringify(saveCity(city))));
    expect(copy.state.landfill[40 * 48 + 40]).toBeCloseTo(123.4, 1);
    expect(copy.state.garbage[10 * 48 + 10]).toBeCloseTo(7.5, 1);
  });

  it('industry set back from the road (within its 8-tile reach) is reached through the zone', () => {
    // Industrial lots up to 8 tiles from a road may develop, so their
    // trucks, workers and garbage pickup use that road too.
    const n = 40;
    const city = new City({ size: n, seed: 2, difficulty: 'easy', water: false });
    city.state.funds = 5_000_000;
    // A 7×7 block between roads (like the sample city's): its centre is four
    // tiles from every road, too far for a driveway.
    for (const k of [10, 18]) {
      city.buildNetwork(0, k, n - 1, k, 'road');
      city.buildNetwork(k, 0, k, n - 1, 'road');
    }
    city.zone(11, 11, 17, 17, 'I-medium');
    city.refresh();
    const centre = 14 * n + 14;
    expect(city.state.net[centre]).toBe(0);
    expect(city.fields.industrialAccess[centre]).toBe(1);
    expect(city.fields.access[centre]).toBeGreaterThanOrEqual(0);
    expect(city.fields.accessDist[centre]).toBe(4);
  });
});
