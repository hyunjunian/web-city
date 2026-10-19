import { describe, expect, it } from 'vitest';
import { City, loadCity, saveCity, type Building } from '../src';
import { capRelief } from '../src/sim/demand';
import { airportReach } from '../src/sim/transport';

function cityWithAirports(firstCapacity = 10, secondCapacity = 90, tripLimit = 250): City {
  const city = new City({ size: 32, water: false, config: {
    safety: { fires: false }, disasters: { simulated: false }, mayor: { riots: false },
    transport: { tripLimit }, structures: {
      smallLandingStrip: { w: 1, h: 1, airport: { capacity: firstCapacity } },
      mediumLandingStrip: { w: 1, h: 1, airport: { capacity: secondCapacity } },
    },
  } });
  city.state.funds = 1_000_000;
  return city;
}

function office(city: City, x: number, y: number, capacity: number, w = 1, h = 1): void {
  const id = city.state.nextId++;
  const b: Building = { id, x, y, w, h, stage: 1, origType: 'Co$$', type: 'Co$$', capacity, occupancy: 1, filled: 0,
    distressMonths: 0, noRoadMonths: 0, noPowerMonths: 0, powered: true, noWaterMonths: 0, watered: true,
    age: 30, eq: 70, hq: 70, abandonReason: null, builtDay: 0, commute: -1, noJobMonths: 0, historical: false };
  city.state.buildings.set(id, b);
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) city.state.occupant[yy * city.size + xx] = id;
}

function relief(city: City): number {
  city.refresh();
  airportReach(city.state, city.fields, city.cfg);
  return capRelief(city.state, city.cfg, [0, 0, 0, 0])['Co$$'];
}

describe('airport service catchments', () => {
  it('uses spare capacity at a larger airport instead of overloading the smaller one', () => {
    const city = cityWithAirports();
    city.buildNetwork(2, 8, 28, 8, 'road');
    expect(city.placeStructure('smallLandingStrip', 6, 7).ok).toBe(true);
    expect(city.placeStructure('mediumLandingStrip', 26, 7).ok).toBe(true);
    office(city, 12, 9, 100);
    expect(relief(city)).toBeCloseTo(100, 8);
    for (const st of city.state.structures.values()) expect(st.load).toBeLessThanOrEqual(st.capacity);
  });

  it('reserves a constrained catchment and sends flexible office demand to the other airport', () => {
    const city = cityWithAirports(50, 50, 45);
    city.buildNetwork(2, 8, 24, 8, 'road');
    expect(city.placeStructure('smallLandingStrip', 7, 7).ok).toBe(true);
    expect(city.placeStructure('mediumLandingStrip', 22, 7).ok).toBe(true);
    office(city, 13, 9, 60); // Can reach both airports.
    office(city, 2, 9, 40); // Can reach only the western airport.
    expect(relief(city)).toBeCloseTo(100, 8);
  });

  it('keeps a zero-funded airport from taking demand away from an operating one', () => {
    const city = cityWithAirports(100, 100);
    city.buildNetwork(2, 8, 28, 8, 'road');
    city.placeStructure('smallLandingStrip', 6, 7);
    city.placeStructure('mediumLandingStrip', 26, 7);
    const first = [...city.state.structures.values()][0]!;
    city.setFunding(first.id, 0);
    office(city, 12, 9, 100);
    expect(relief(city)).toBeCloseTo(100, 8);
    expect(first.load).toBe(0);
  });

  it('uses a connected frontage even when the first frontage is on an isolated street', () => {
    const city = cityWithAirports(100);
    city.buildNetwork(12, 8, 13, 8, 'street');
    city.buildNetwork(12, 11, 25, 11, 'road');
    city.placeStructure('smallLandingStrip', 25, 12);
    office(city, 12, 9, 100, 2, 2);
    expect(relief(city)).toBeCloseTo(100, 8);
  });

  it('respects one-way access to an airport rather than the route away from it', () => {
    const city = cityWithAirports(100);
    city.buildNetwork(2, 8, 28, 8, 'oneway');
    city.placeStructure('smallLandingStrip', 26, 7);
    office(city, 12, 9, 100);
    expect(relief(city)).toBeCloseTo(100, 8);
    city.buildNetwork(28, 8, 2, 8, 'oneway');
    expect(relief(city)).toBe(0);
  });

  it('preserves monthly outcomes through sliced execution and save restoration', () => {
    const source = cityWithAirports(10, 90);
    source.buildNetwork(2, 8, 28, 8, 'road');
    source.placeStructure('smallLandingStrip', 6, 7);
    source.placeStructure('mediumLandingStrip', 26, 7);
    office(source, 12, 9, 100);
    source.refresh();
    const initial = saveCity(source), options = { config: source.cfg };
    const direct = loadCity(initial, options), sliced = loadCity(initial, options);
    direct.step(60);
    sliced.beginSteps(60);
    let pieces = 0;
    while (sliced.resume()) pieces++;
    expect(pieces).toBeGreaterThan(1);
    expect(saveCity(sliced)).toEqual(saveCity(direct));
    expect(saveCity(loadCity(saveCity(sliced), options))).toEqual(saveCity(direct));
  });
});
