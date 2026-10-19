import { describe, expect, it } from 'vitest';
import { City, loadCity, saveCity, type Building } from '../src';
import { mergeSnapshots, neighbourOpenJobs } from '../src/sim/region';

function workplaceTown(health?: number): City {
  const city = new City({ size: 16, water: false, config: {
    structures: { smallPoliceStation: { w: 1, h: 1, jobs: [100, 0, 0] } },
  } });
  city.state.funds = 1_000_000;
  city.buildNetwork(0, 8, 15, 8, 'road');
  expect(city.placeStructure('smallPoliceStation', 5, 9).ok).toBe(true);
  if (health !== undefined) {
    const id = city.state.nextId++;
    const b: Building = { id, x: 2, y: 9, w: 1, h: 1, stage: 1, origType: 'R$', type: 'R$', capacity: 100,
      occupancy: 1, filled: 0, distressMonths: 0, noRoadMonths: 0, noPowerMonths: 0, powered: true,
      noWaterMonths: 0, watered: true, age: 30, eq: 70, hq: health, abandonReason: null, builtDay: 0,
      commute: -1, noJobMonths: 0, historical: false };
    city.state.buildings.set(id, b);
    city.state.occupant[9 * 16 + 2] = id;
    city.refresh();
  }
  return city;
}

describe('played regional employment', () => {
  it('includes road-served civic jobs and household workers in an independent snapshot', () => {
    const city = workplaceTown(200), snap = city.snapshot();
    expect(snap.employment?.jobs).toBe(100);
    expect(snap.employment?.workers).toBeCloseTo(55, 8);
    snap.employment!.jobs = 999;
    expect(city.snapshot().employment?.jobs).toBe(100);
  });

  it('offers civic jobs to neighbours even when there are no business lots in town', () => {
    const employer = workplaceTown(), city = new City({ size: 16, water: false });
    city.setNeighbourCity(0, employer.snapshot());
    expect(neighbourOpenJobs(city.state, city.cfg)[0]).toBe(100);
  });

  it('reserves actual healthy workers rather than estimating them from population alone', () => {
    const city = new City({ size: 16, water: false });
    const snap = workplaceTown(200).snapshot();
    city.setNeighbourCity(0, snap);
    expect(neighbourOpenJobs(city.state, city.cfg)[0]).toBeCloseTo(45, 8);
    snap.employment!.jobs = 0;
    expect(neighbourOpenJobs(city.state, city.cfg)[0]).toBeCloseTo(45, 8);
    city.setNeighbourCity(0, workplaceTown(0).snapshot());
    expect(neighbourOpenJobs(city.state, city.cfg)[0]).toBeCloseTo(56, 8);
  });

  it('merges known employment and retains the legacy estimate when any snapshot is unknown', () => {
    const first = workplaceTown(200).snapshot(), second = workplaceTown(0).snapshot();
    const merged = mergeSnapshots([first, second]);
    expect(merged.employment?.jobs).toBe(200);
    expect(merged.employment?.workers).toBeCloseTo(99, 8);
    delete second.employment;
    expect(mergeSnapshots([first, second]).employment).toBeUndefined();
  });

  it('restores known employment through a city save and rejects invalid imported totals', () => {
    const city = new City({ size: 16, water: false });
    city.setNeighbourCity(0, workplaceTown(200).snapshot());
    const saved = saveCity(city), copy = loadCity(saved);
    expect(neighbourOpenJobs(copy.state, copy.cfg)[0]).toBeCloseTo(45, 8);
    for (const value of [-1, NaN, Infinity, '100', null]) {
      const broken = structuredClone(saved);
      (broken.neighbours![0] as any).employment = { jobs: value, workers: 0 };
      expect(() => loadCity(broken)).toThrow(/employment/);
    }
  });
});
