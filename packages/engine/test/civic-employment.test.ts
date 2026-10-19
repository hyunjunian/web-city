import { expect, it } from 'vitest';
import { City, loadCity, saveCity, type Building } from '../src';

it.each(['smallLandingStrip', 'internationalPort'] as const)('withdraws jobs at a closed %s from census, routes and followed residents', kind => {
  const city = new City({ size: 32, water: false, config: {
    safety: { fires: false }, disasters: { simulated: false }, mayor: { riots: false },
    structures: {
      smallLandingStrip: { w: 1, h: 1, jobs: [100, 0, 0] },
      internationalPort: { w: 2, h: 1, jobs: [100, 0, 0] },
    },
  } });
  city.state.funds = 1_000_000;
  city.terraform(27, 0, 31, 31, 'water');
  city.buildNetwork(2, 8, 26, 8, 'road');
  expect(city.placeStructure(kind, 26, 7).ok).toBe(true);
  const cargo = [...city.state.structures.values()][0]!;
  const id = city.state.nextId++;
  const home: Building = { id, x: 12, y: 9, w: 1, h: 1, stage: 1, origType: 'R$', type: 'R$', capacity: 10,
    occupancy: 1, filled: 0, distressMonths: 0, noRoadMonths: 0, noPowerMonths: 0, powered: true,
    noWaterMonths: 0, watered: true, age: 30, eq: 20, hq: 50, abandonReason: null, builtDay: 0,
    commute: -1, noJobMonths: 0, historical: false };
  city.state.buildings.set(id, home);
  city.state.occupant[9 * 32 + 12] = id;
  city.refresh();
  expect(city.census.civicJobs[0]).toBe(100);
  expect(city.query(12, 9)!.commute).not.toBeNull();
  const sim = city.addMySim('Commuter', 12, 9).sim!;
  expect(sim.job).toBe(-cargo.id);
  city.setFunding(cargo.id, 0);
  city.refreshIfDirty();
  expect(city.census.civicJobs).toEqual([0, 0, 0]);
  expect(city.snapshot().employment!.jobs).toBe(0);
  expect(city.query(12, 9)!.commute).toBeNull();
  expect(city.mySimCommute(sim.id)!.time).toBe(-1);
  expect(city.setMySimJob(sim.id, 26, 7).ok).toBe(false);
  expect(city.addMySim('No vacancy', 12, 9).sim!.job).toBe(0);
  city.setFunding(cargo.id, 100);
  city.refreshIfDirty();
  expect(city.census.civicJobs[0]).toBe(100);
  expect(city.setMySimJob(sim.id, 26, 7).ok).toBe(true);
  expect(city.mySimCommute(sim.id)!.time).toBeGreaterThan(0);
});

it.each(['busStop', 'subwayStation'] as const)('does not advertise %s as a separate workplace when routes exclude station jobs', kind => {
  const city = new City({ size: 32, water: false });
  city.state.funds = 1_000_000;
  city.buildNetwork(2, 8, 26, 8, 'road');
  expect(city.placeStructure(kind, 26, 7).ok).toBe(true);
  const station = [...city.state.structures.values()][0]!;
  const id = city.state.nextId++;
  const home: Building = { id, x: 12, y: 9, w: 1, h: 1, stage: 1, origType: 'R$', type: 'R$', capacity: 10,
    occupancy: 1, filled: 0, distressMonths: 0, noRoadMonths: 0, noPowerMonths: 0, powered: true,
    noWaterMonths: 0, watered: true, age: 30, eq: 20, hq: 50, abandonReason: null, builtDay: 0,
    commute: -1, noJobMonths: 0, historical: false };
  city.state.buildings.set(id, home);
  city.state.occupant[9 * 32 + 12] = id;
  city.refresh();
  expect(city.query(12, 9)!.commute).toBeNull();
  expect(city.census.civicJobs).toEqual([0, 0, 0]);
  expect(city.stats().jobs).toBe(0);
  expect(city.snapshot().employment!.jobs).toBe(0);
  const sim = city.addMySim('Consistent employment', 12, 9).sim!;
  expect(sim.job).toBe(0);
  expect(city.setMySimJob(sim.id, 26, 7).ok).toBe(false);
  // Older saves could have assigned a followed resident to a station.
  sim.job = -station.id;
  expect(city.mySimCommute(sim.id)!.time).toBe(-1);
  const loaded = loadCity(saveCity(city));
  expect(loaded.mySimCommute(sim.id)!.time).toBe(-1);
  expect(loaded.snapshot().employment!.jobs).toBe(0);
});
