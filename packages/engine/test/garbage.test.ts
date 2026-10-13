import { describe, expect, it } from 'vitest';
import { City, loadCity, saveCity } from '../src';
import { Rng } from '../src/rng';
import { landfillRegions, landfillRegionsSteps, runGarbage } from '../src/sim/garbage';
import { drain } from '../src/sim/steps';
import { SPAN } from '../src/sim/state';

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
  const islands = () => {
    const city = new City({ size: 48, water: false });
    city.state.funds = 1_000_000;
    city.batch(() => {
      city.buildNetwork(0, 8, 20, 8, 'road');
      city.buildNetwork(25, 30, 47, 30, 'road');
      city.placeStructure('gasPlant', 2, 9);
      city.placeStructure('gasPlant', 28, 31);
    });
    return city;
  };

  it('leaves garbage on a disconnected collection island despite spare incinerator capacity elsewhere', () => {
    const city = islands();
    city.placeStructure('wasteToEnergyPlant', 8, 9);
    city.refresh();
    const report = runGarbage(city.state, city.fields, city.cfg, new Rng(1), 0);
    expect(report.incinerated).toBe(20);
    expect(report.uncollected).toBe(20);
    expect(report.capacity).toBe(500);
    expect(report.routeCutOff).toBe(20);
    city.state.garbageStats = report;
    expect(city.advisors()).toContainEqual(expect.objectContaining({ code: 'garbageNoRoute', value: 20 }));
    expect(loadCity(saveCity(city)).state.garbageStats.routeCutOff).toBe(20);
    expect(city.state.garbage[9 * 48 + 2]).toBe(0);
    expect(city.state.garbage[31 * 48 + 28]).toBeGreaterThan(0);
  });

  it('restricts landfill intake and backlog pickup to its roads, then resumes collection when joined', () => {
    const city = islands();
    city.zone(14, 9, 18, 12, 'landfill');
    city.refresh();
    const first = runGarbage(city.state, city.fields, city.cfg, new Rng(1), 0);
    expect(first.landfilled).toBe(20);
    expect(first.uncollected).toBe(20);
    city.batch(() => {
      city.buildNetwork(0, 8, 0, 30, 'road');
      city.buildNetwork(0, 30, 25, 30, 'road');
    });
    const joined = runGarbage(city.state, city.fields, city.cfg, new Rng(1), 0);
    expect(joined.uncollected).toBe(0);
    expect(joined.routeCutOff).toBe(0);
    expect(joined.landfilled).toBeCloseTo(50);
    expect(joined.piled).toBeCloseTo(10);
  });

  it('cannot receive waste or supply waste electricity when no road reaches the incinerator', () => {
    const city = islands();
    city.placeStructure('wasteToEnergyPlant', 38, 40);
    const burner = [...city.state.structures.values()].find((st) => st.kind === 'wasteToEnergyPlant')!;
    burner.load = 100;
    city.refresh();
    expect(city.energyReport()!.wasteGeneration).toBe(0);
    const report = runGarbage(city.state, city.fields, city.cfg, new Rng(1), 0);
    expect(report.incinerated).toBe(0);
    expect(report.capacity).toBe(0);
    expect(report.uncollected).toBe(40);
  });

  it('exports only from the contracted border road and requires funded collection trucks', () => {
    const city = islands();
    city.state.neighbourDeals.push({ id: 1, edge: 0, resource: 'garbage', direction: 'buy', amount: 100, price: 1,
      startDay: 0, status: 'active', monthsLeft: 0 });
    const report = runGarbage(city.state, city.fields, city.cfg, new Rng(1), 0);
    expect(report.exported).toBe(20);
    expect(report.uncollected).toBe(20);
    city.setDepartmentFunding('sanitation', 0);
    city.refreshIfDirty();
    const unfunded = runGarbage(city.state, city.fields, city.cfg, new Rng(1), 0);
    expect(unfunded.exported).toBe(0);
    expect(unfunded.uncollected).toBe(40);
  });

  it('receives imported garbage at the contracted road instead of a disconnected disposal plant', () => {
    const city = islands();
    city.placeStructure('wasteToEnergyPlant', 36, 31);
    city.state.neighbourDeals.push({ id: 1, edge: 0, resource: 'garbage', direction: 'sell', amount: 100, price: 1,
      startDay: 0, status: 'active', monthsLeft: 0 });
    city.refresh();
    const report = runGarbage(city.state, city.fields, city.cfg, new Rng(1), 0);
    expect(report.imported).toBe(0);
    expect(report.importShort).toBe(100);
    expect(report.incinerated).toBe(20);
    city.batch(() => {
      city.buildNetwork(0, 8, 0, 30, 'road');
      city.buildNetwork(0, 30, 25, 30, 'road');
    });
    const joined = runGarbage(city.state, city.fields, city.cfg, new Rng(1), 0);
    expect(joined.imported).toBe(100);
    expect(joined.importShort).toBe(0);
    expect(joined.incinerated).toBeCloseTo(150);
  });

  it('keeps multi-network collection deterministic through sliced steps and save/load', () => {
    const city = islands();
    city.placeStructure('wasteToEnergyPlant', 8, 9);
    city.zone(36, 31, 39, 34, 'landfill');
    const options = { config: { safety: { fires: false }, disasters: { simulated: false }, mayor: { riots: false } } };
    const saved = saveCity(city);
    const full = loadCity(saved, options), sliced = loadCity(saved, options);
    full.step(120);
    sliced.beginSteps(120);
    while (sliced.resume());
    expect(saveCity(sliced)).toEqual(saveCity(full));
    const reloaded = loadCity(saveCity(full), options);
    expect(reloaded.stats()).toEqual(full.stats());
    expect(reloaded.stats().garbage.routeCutOff).toBe(0);
  });

  it('previews new connections without changing stored piles, machinery, landfill contents or randomness', () => {
    const city = islands();
    city.placeStructure('wasteToEnergyPlant', 8, 9);
    city.state.garbage[31 * 48 + 28] = 20;
    const before = saveCity(city);
    const disconnected = city.previewGarbage();
    expect(disconnected.routeCutOff).toBe(20);
    expect(disconnected.incinerated).toBe(20);
    expect(saveCity(city)).toEqual(before);
    city.batch(() => {
      city.buildNetwork(0, 8, 0, 30, 'road');
      city.buildNetwork(0, 30, 25, 30, 'road');
    });
    const joined = saveCity(city);
    const plan = city.previewGarbage();
    expect(plan.routeCutOff).toBe(0);
    expect(plan.uncollected).toBe(0);
    expect(plan.incinerated).toBe(50);
    plan.incinerated = 0;
    expect(city.previewGarbage().incinerated).toBe(50);
    expect(saveCity(city)).toEqual(joined);
  });

  it('carries garbage over elevated highways through ramps and to an elevated export border', () => {
    const city = new City({ size: 64, water: false });
    city.state.funds = 1_000_000;
    city.batch(() => {
      city.buildNetwork(4, 12, 4, 29, 'road');
      city.buildNetwork(59, 12, 59, 29, 'road');
      city.buildElevated(0, 10, 63, 10, 'highway');
      city.buildNetwork(4, 11, 4, 11, 'onramp');
      city.buildNetwork(59, 11, 59, 11, 'onramp');
      city.placeStructure('gasPlant', 5, 20);
      city.placeStructure('wasteToEnergyPlant', 55, 20);
    });
    const joined = runGarbage(city.state, city.fields, city.cfg, new Rng(1), 0);
    expect(joined.incinerated).toBe(20);
    expect(joined.uncollected).toBe(0);
    city.state.neighbourDeals.push({ id: 1, edge: 1, resource: 'garbage', direction: 'buy', amount: 100, price: 1,
      startDay: 0, status: 'active', monthsLeft: 0 });
    const exporting = runGarbage(city.state, city.fields, city.cfg, new Rng(1), 0);
    expect(exporting.exported).toBe(20);
    expect(exporting.incinerated).toBe(0);
    city.bulldoze(4, 11, 4, 11);
    city.refresh();
    const disconnected = runGarbage(city.state, city.fields, city.cfg, new Rng(1), 0);
    expect(disconnected.exported).toBe(0);
    expect(disconnected.incinerated).toBe(0);
    expect(disconnected.routeCutOff).toBe(20);
  });

  it('crosses a road deck but cannot turn onto the highway underneath without a ramp', () => {
    const city = new City({ size: 40, water: false });
    city.state.funds = 1_000_000;
    city.batch(() => {
      city.buildNetwork(0, 20, 39, 20, 'highway');
      city.buildNetwork(10, 5, 10, 35, 'road');
      city.placeStructure('gasPlant', 11, 6);
      city.placeStructure('wasteToEnergyPlant', 11, 30);
    });
    const crossing = runGarbage(city.state, city.fields, city.cfg, new Rng(1), 0);
    expect(crossing.incinerated).toBe(20);
    city.state.neighbourDeals.push({ id: 1, edge: 0, resource: 'garbage', direction: 'sell', amount: 100, price: 1,
      startDay: 0, status: 'active', monthsLeft: 0 });
    expect(runGarbage(city.state, city.fields, city.cfg, new Rng(1), 0).importShort).toBe(100);
    city.batch(() => {
      city.buildNetwork(11, 21, 13, 21, 'road');
      city.buildNetwork(13, 21, 13, 21, 'onramp');
    });
    const ramped = runGarbage(city.state, city.fields, city.cfg, new Rng(1), 0);
    expect(ramped.imported).toBe(100);
    expect(ramped.importShort).toBe(0);
    expect(ramped.incinerated).toBe(120);
  });

  it('shares one contract capacity across disconnected ports and avoids an unusable earlier port', () => {
    const city = islands();
    city.buildNetwork(0, 30, 25, 30, 'road');
    city.placeStructure('wasteToEnergyPlant', 36, 31);
    city.state.neighbourDeals.push({ id: 1, edge: 0, resource: 'garbage', direction: 'sell', amount: 100, price: 1,
      startDay: 0, status: 'active', monthsLeft: 0 });
    city.refresh();
    const importing = runGarbage(city.state, city.fields, city.cfg, new Rng(1), 0);
    expect(importing.imported).toBe(100);
    expect(importing.importShort).toBe(0);
    city.state.neighbourDeals[0]!.direction = 'buy';
    city.state.neighbourDeals[0]!.amount = 25;
    const exporting = runGarbage(city.state, city.fields, city.cfg, new Rng(1), 0);
    expect(exporting.exported).toBe(25);
    expect(exporting.incinerated).toBe(15);
  });

  it('trucks cannot enter a landfill from a tunnel, but can from a low bridge', () => {
    const city = new City({ size: 32, water: false });
    city.state.funds = 1_000_000;
    city.buildNetwork(0, 10, 31, 10, 'road');
    city.placeStructure('gasPlant', 1, 11);
    city.zone(20, 11, 23, 14, 'landfill');
    for (let x = 20; x <= 23; x++) city.state.tunnel[10 * 32 + x] = SPAN.tunnel;
    city.refresh();
    const blocked = runGarbage(city.state, city.fields, city.cfg, new Rng(1), 0);
    expect(blocked.landfilled).toBe(0);
    expect(blocked.landfillSpace).toBe(0);
    expect(city.ordinanceAvailable('landfillGas')).toBe(false);
    for (let x = 20; x <= 23; x++) city.state.tunnel[10 * 32 + x] = SPAN.lowBridge;
    city.refresh();
    const open = runGarbage(city.state, city.fields, city.cfg, new Rng(1), 0);
    expect(open.landfilled).toBeGreaterThan(0);
    expect(city.ordinanceAvailable('landfillGas')).toBe(true);
  });

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
    city.refresh();
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
