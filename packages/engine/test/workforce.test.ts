import { describe, expect, it } from 'vitest';
import { City, type Building } from '../src';
import { allocateJobs, computeDemand, eqLevelOf, takeCensus } from '../src/sim/demand';
import { perType } from '../src/types';

function population(rich = false): City {
  const city = new City({ size: 16, water: false });
  for (const [x, hq, eq] of [[2, 0, 20], [5, 200, 180]]) {
    const id = city.state.nextId++, type = rich && x === 5 ? 'R$$$' : 'R$';
    const b: Building = { id, x: x!, y: 3, w: 1, h: 1, stage: 1, origType: type, type, capacity: 100,
      occupancy: 1, filled: 0, distressMonths: 0, noRoadMonths: 0, noPowerMonths: 0, powered: true,
      noWaterMonths: 0, watered: true, age: 30, eq: eq!, hq: hq!, abandonReason: null, builtDay: 0,
      commute: -1, noJobMonths: 0, historical: false };
    city.state.buildings.set(id, b);
    city.state.occupant[3 * 16 + x!] = id;
  }
  return city;
}

describe('household labour participation', () => {
  it('keeps demand finite when a custom participation curve supplies no workers', () => {
    const city = population();
    city.cfg.services.workforceByHq = [[0, 0], [200, 0]];
    const census = takeCensus(city.state, city.cfg);
    expect(census.workers).toEqual([0, 0, 0]);
    const demand = computeDemand(city.state, city.cfg, census, [0, 0, 0, 0]);
    expect(Object.values(demand.raw).every(Number.isFinite)).toBe(true);
    expect(Object.values(demand.demand).every(Number.isFinite)).toBe(true);
  });

  it('counts workers within education cohorts using their own health rather than a city average', () => {
    const city = population(), census = takeCensus(city.state, city.cfg);
    expect(census.workers[0]).toBeCloseTo(99, 8);
    expect(census.workersByEq[0][eqLevelOf(city.cfg, 20)]).toBeCloseTo(44, 8);
    expect(census.workersByEq[0][eqLevelOf(city.cfg, 180)]).toBeCloseTo(55, 8);
    expect(census.workforceFraction).toBeCloseTo(99 / 200, 8);
  });

  it('does not transfer working residents between wealth groups when their health differs', () => {
    const city = population(true), census = takeCensus(city.state, city.cfg);
    expect(census.workers[0]).toBeCloseTo(44, 8);
    expect(census.workers[1]).toBe(0);
    expect(census.workers[2]).toBeCloseTo(55, 8);
    expect(census.unemployed[0]).toBeCloseTo(44, 8);
    expect(census.unemployed[2]).toBeCloseTo(55, 8);
  });

  it('uses each wealth group participation rate for residential job demand', () => {
    const city = population(true), census = takeCensus(city.state, city.cfg);
    const demand = computeDemand(city.state, city.cfg, census, [0, 0, 0, 0]);
    expect(demand.raw['R$']).toBeCloseTo(city.cfg.demand.baseJobs[0] / 0.44 - 100, 8);
    expect(demand.raw['R$$$']).toBeCloseTo(city.cfg.demand.baseJobs[2] / 0.55 - 100, 8);
  });

  it('keeps regional residents in the labour profile of their own wealth group', () => {
    const city = population(true), census = takeCensus(city.state, city.cfg);
    const base = computeDemand(city.state, city.cfg, census, [0, 0, 0, 0]);
    const regional = { pooled: perType(t => t === 'R$' ? 100 : 0), extra: perType(() => 0) };
    const grown = computeDemand(city.state, city.cfg, census, [0, 0, 0, 0], regional);
    const expected = 44 * city.cfg.demand.businessProfile.ID[0][eqLevelOf(city.cfg, 20)]!;
    expect(grown.raw.ID - base.raw.ID).toBeCloseTo(expected, 8);
  });

  it('fills business jobs from the same workforce counted by commuting', () => {
    const city = population(true), b = { ...city.state.buildings.values().next().value!, id: city.state.nextId++, x: 8,
      type: 'ID' as const, origType: 'ID' as const, capacity: 1_000 };
    city.state.buildings.set(b.id, b);
    city.state.occupant[3 * 16 + 8] = b.id;
    city.cfg.demand.workforceProfile.ID = [1, 0, 0];
    const census = takeCensus(city.state, city.cfg);
    allocateJobs(city.state, city.cfg, census);
    expect(b.filled).toBeCloseTo(44, 8);
  });
});
