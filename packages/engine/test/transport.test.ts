import { describe, expect, it } from 'vitest';
import { Rng } from '../src/rng';
import { updatePotholes } from '../src/sim/roads';
import { City, loadCity, saveCity } from '../src';
import { frontage } from '../src/sim/fields';
import { interp } from '../src/data/services';
import { carMove, Net, SPAN } from '../src/sim/state';
import type { Building } from '../src/sim/state';
import { assignTraffic, congestionSlowdown, Mode, transfers } from '../src/sim/transport';

const CALM = {
  safety: { fires: false },
  mayor: { riots: false },
  development: { requirePower: false, requireWater: false },
} as const;

/**
 * Homes in the west, industry in the east, joined by one long road. `before`
 * builds on the bare road first (stations in the middle of each end, where
 * riders walk to them along the road).
 */
function corridor(n = 64, before?: (city: City) => void): City {
  const city = new City({ size: n, seed: 3, difficulty: 'easy', water: false, config: CALM });
  city.state.funds = 5_000_000;
  city.buildNetwork(0, 30, n - 1, 30, 'road');
  before?.(city);
  city.zone(1, 24, 10, 29, 'R-low');
  city.zone(n - 12, 31, n - 2, 38, 'I-medium');
  return city;
}

const homes = (c: City) => [...c.state.buildings.values()].filter((b) => b.type?.startsWith('R'));
const tile = (c: City, x: number, y: number) => y * c.size + x;

describe('neighbour jobs by transit', () => {
  it('a developed neighbour gives only the jobs its own Sims leave open', () => {
    const run = (poor: boolean) => {
      const n = 48;
      const city = new City({ size: n, seed: 3, difficulty: 'easy', water: false, config: CALM });
      city.state.funds = 1_000_000;
      city.buildNetwork(0, 20, n - 1, 20, 'road'); // out west and east; no jobs in town
      city.zone(2, 14, n - 3, 19, 'R-low');
      if (poor) {
        for (const e of [0, 1] as const) {
          city.setNeighbour(e, 'developed');
          const nb = city.state.neighbours[e]!;
          for (const t of Object.keys(nb.population) as (keyof typeof nb.population)[]) nb.population[t] = t === 'R$' ? 5000 : t === 'Cs$' ? 1000 : 0;
        }
      }
      city.step(360);
      const out = city.fields.traffic[20 * n]! + city.fields.traffic[20 * n + n - 1]!;
      return { out, jobless: city.fields.jobless.size, pop: city.stats().population };
    };
    const open = run(false);
    expect(open.out).toBeGreaterThan(0);
    expect(open.jobless).toBe(0);
    // 1,000 jobs, 2,500 or so of them taken by its own workers: none left over, so the road out is no
    // way to work and nobody moves in (they did, found nothing, left, and came back in a loop).
    const poor = run(true);
    expect(poor.out).toBe(0);
    expect(poor.pop).toBe(0);
  }, 60_000);

  it('commuters can take the train out of town to jobs in a neighbouring city', () => {
    const n = 48;
    const city = new City({ size: n, seed: 3, water: false, config: CALM });
    city.state.funds = 1_000_000;
    city.buildNetwork(2, 20, 40, 20, 'road'); // no road off the map, no jobs in town
    city.refresh();
    expect(city.query(20, 20)!.commute).toBeNull();
    expect(city.placeStructure('trainStation', 10, 21).ok).toBe(true);
    expect(city.buildNetwork(13, 22, n - 1, 22, 'rail').ok).toBe(true); // rail to the map edge
    city.refresh();
    expect(city.query(20, 20)!.commute).not.toBeNull();
  });
});

describe('travel times', () => {
  it('follows the crossing times: roads beat streets, highways beat roads', () => {
    const city = new City({ size: 64, water: false, config: CALM });
    city.state.funds = 1_000_000;
    city.buildNetwork(0, 10, 63, 10, 'street');
    city.buildNetwork(0, 20, 63, 20, 'road');
    city.buildNetwork(0, 40, 63, 40, 'highway');
    city.refresh();
    const cross = city.fields.travel!.cross;
    expect(cross[Mode.Car]![tile(city, 30, 10)]).toBe(5);
    expect(cross[Mode.Car]![tile(city, 30, 20)]).toBe(3);
    expect(cross[Mode.Car]![tile(city, 30, 40)]).toBe(1);
    expect(cross[Mode.Walk]![tile(city, 30, 20)]).toBe(27);
    expect(cross[Mode.Walk]![tile(city, 30, 40)]).toBe(0); // no pedestrians on highways
  });

  it('congestion slows traffic past capacity, up to −70%', () => {
    const c = { slope: 0.35, max: 0.7 };
    expect(congestionSlowdown(1, c)).toBe(0);
    expect(congestionSlowdown(2, c)).toBeCloseTo(0.35);
    expect(congestionSlowdown(5, c)).toBe(0.7);
    const city = new City({ size: 32, water: false, config: CALM });
    city.buildNetwork(0, 10, 31, 10, 'road');
    city.refresh();
    const i = tile(city, 15, 10);
    const free = city.fields.travel!.cross[Mode.Car]![i]!;
    city.fields.traffic[i] = 2_000; // 200% of a road's 1,000
    city.refresh();
    expect(city.fields.travel!.cross[Mode.Car]![i]! / free).toBeCloseTo(1 / 0.65, 3);
  });

  it('intersections slow the tiles around them', () => {
    const city = new City({ size: 32, water: false, config: CALM });
    city.buildNetwork(0, 10, 31, 10, 'road');
    city.buildNetwork(15, 0, 15, 31, 'road');
    city.refresh();
    const cross = city.fields.travel!.cross[Mode.Car]!;
    expect(cross[tile(city, 15, 10)]).toBeCloseTo(3 / 0.7);
    expect(cross[tile(city, 16, 10)]).toBeCloseTo(3 / 0.8);
    expect(cross[tile(city, 17, 10)]).toBeCloseTo(3 / 0.9);
    expect(cross[tile(city, 18, 10)]).toBe(3);
  });
});

describe('networks', () => {
  it('upgrades streets to roads and avenues, and makes level crossings with rail', () => {
    const city = new City({ size: 32, water: false });
    city.buildNetwork(0, 5, 20, 5, 'street');
    city.buildNetwork(0, 5, 20, 5, 'road');
    expect(city.state.net[tile(city, 3, 5)]).toBe(Net.Road);
    expect(city.buildNetwork(0, 5, 20, 5, 'street').ok).toBe(false); // never downgrades
    city.buildNetwork(0, 5, 10, 5, 'avenue');
    expect(city.state.net[tile(city, 3, 5)]).toBe(Net.Avenue);
    city.buildNetwork(15, 0, 15, 20, 'rail');
    expect(city.state.net[tile(city, 15, 5)]).toBe(Net.RailCrossing);
    expect(city.query(15, 5)!.network).toBe('crossing');
  });

  it('highways cannot cross other networks and connect through onramps', () => {
    const city = new City({ size: 32, water: false, config: CALM });
    city.buildNetwork(0, 10, 31, 10, 'road');
    expect(city.buildNetwork(5, 0, 5, 31, 'highway').ok).toBe(false);
    city.buildNetwork(0, 12, 31, 12, 'highway');
    city.refresh();
    const f = city.fields;
    expect(f.component[tile(city, 5, 10)]).not.toBe(f.component[tile(city, 5, 12)]);
    city.buildNetwork(5, 11, 5, 11, 'onramp');
    city.refresh();
    expect(f.component[tile(city, 5, 10)]).toBe(f.component[tile(city, 5, 12)]);
  });

  it('charges upkeep for each network and saves subway track', () => {
    const city = new City({ size: 32, water: false });
    city.state.funds = 1_000_000;
    city.buildNetwork(0, 5, 9, 5, 'avenue');
    city.buildNetwork(0, 8, 9, 8, 'rail');
    city.buildSubway(0, 12, 9, 12);
    city.step(30);
    const b = city.state.lastBudget!;
    expect(b.roadUpkeep).toBeCloseTo(10 * 0.5);
    expect(b.transitUpkeep).toBeCloseTo(10 * 0.03 + 10 * 0.3);
    const copy = loadCity(JSON.parse(JSON.stringify(saveCity(city))));
    expect(copy.query(4, 12)!.subway).toBe(true);
  });
});

describe('commuting', () => {
  it("sends commuters along the road and records each home's trip time", () => {
    const city = corridor();
    city.step(360);
    expect(homes(city).length).toBeGreaterThan(0);
    for (const b of homes(city)) expect(b.commute).toBeGreaterThan(0);
    expect(city.fields.traffic[tile(city, 30, 30)]).toBeGreaterThan(0);
  }, 60_000);

  it('homes with no job within 2.5 hours are abandoned after six months', () => {
    // Streets only (5 per tile): 60 tiles of street is 3 hours.
    const n = 80;
    const city = new City({ size: n, seed: 3, difficulty: 'easy', water: false, config: CALM });
    city.state.funds = 5_000_000;
    city.buildNetwork(0, 30, n - 1, 30, 'street');
    city.zone(1, 24, 6, 29, 'R-low');
    city.zone(n - 8, 31, n - 2, 38, 'I-medium');
    city.zone(1, 31, 6, 34, 'I-medium'); // nearby jobs so homes develop at all
    city.step(240);
    const near = homes(city);
    expect(near.length).toBeGreaterThan(0);
    // Remove the nearby jobs: the far ones are out of reach.
    city.bulldoze(1, 31, 6, 38);
    city.zone(1, 31, 6, 38, 'none');
    let sawCommute = false;
    for (let m = 0; m < 8; m++) {
      city.step(30);
      if ([...city.state.buildings.values()].some((b) => b.abandonReason === 'commute')) sawCommute = true;
    }
    expect(sawCommute).toBe(true);
  }, 60_000);

  it('homes are not built where no job can be reached in 2.5 hours (the developer skips the tract)', () => {
    const n = 80;
    const city = new City({ size: n, seed: 3, difficulty: 'easy', water: false, config: CALM });
    city.state.funds = 5_000_000;
    city.buildNetwork(0, 30, n - 1, 30, 'street'); // 5 a tile: 60 tiles is 3 hours
    city.zone(8, 24, 13, 29, 'R-low');
    city.zone(1, 31, 6, 34, 'I-medium');
    city.step(150);
    city.zone(70, 24, 77, 29, 'R-low');
    city.step(360);
    expect([...city.state.buildings.values()].filter((b) => b.x >= 70)).toHaveLength(0); // they used to move in and leave every six months
    expect(homes(city).length).toBeGreaterThan(0);
  }, 60_000);

  it('transit riders take the bus between stops', () => {
    // A workplace (police station) at the far end of a long road, stops at both ends.
    const city = new City({ size: 64, water: false, config: CALM });
    city.state.funds = 1_000_000;
    city.buildNetwork(0, 30, 63, 30, 'road');
    city.placeStructure('smallPoliceStation', 56, 31);
    city.placeStructure('busStop', 6, 31);
    city.placeStructure('busStop', 55, 29);
    city.refresh();
    const N = city.size * city.size;
    const modesOn = (search: 'transit' | 'car', start: number) => {
      const tr = city.fields.travel![search];
      const out = new Set<number>();
      for (let v = start; v >= 0; v = tr.next[v]!) out.add(Math.floor(v / N));
      return out;
    };
    expect(modesOn('transit', Mode.Walk * N + tile(city, 6, 30)).has(Mode.Bus)).toBe(true);
    expect(modesOn('car', Mode.Car * N + tile(city, 6, 30)).has(Mode.Bus)).toBe(false);
  });

  it('bus riders pay fares', () => {
    const city = corridor();
    city.placeStructure('busStop', 6, 31);
    city.placeStructure('busStop', 51, 31);
    city.step(360);
    const stops = [...city.state.structures.values()].filter((s) => s.kind === 'busStop');
    if (stops.some((s) => s.load > 0)) expect(city.state.lastBudget!.fares).toBeGreaterThan(0);
    // The Route Query on a stop lists the riders who board or alight there.
    const used = stops.find((x) => x.load > 0)!;
    expect(used).toBeDefined();
    const q = city.routeQuery(used.x, used.y);
    expect(q.trips.length).toBeGreaterThan(0);
    expect(q.byMeans.bus).toBeGreaterThan(0);
    // Over its capacity, the transportation advisor points at it.
    used.load = 1_500;
    const full = city.advisors().find((a) => a.code === 'stationFull');
    expect(full?.value).toBe(150);
    expect(full?.at).toEqual([used.x, used.y]);
  }, 60_000);

  it('trains carry commuters between passenger stations', () => {
    const city = corridor(64, (c) => {
      c.placeStructure('trainStation', 4, 31);
      c.placeStructure('trainStation', 56, 31);
      c.buildNetwork(4, 34, 58, 34, 'rail');
    });
    city.step(360);
    expect(city.fields.railTraffic[tile(city, 30, 34)]).toBeGreaterThan(0);
  }, 60_000);

  it('subways carry walkers between stations', () => {
    const city = corridor(64, (c) => {
      c.buildSubway(5, 31, 57, 31);
      c.placeStructure('subwayStation', 5, 31);
      c.placeStructure('subwayStation', 57, 31);
    });
    city.step(360);
    expect(city.fields.subwayTraffic[tile(city, 30, 31)]).toBeGreaterThan(0);
  }, 60_000);
});

describe('freight', () => {
  it('ships over freight rail to a rail connection when there is no road out', () => {
    const n = 48;
    const city = new City({ size: n, seed: 3, difficulty: 'easy', water: false, config: CALM });
    city.state.funds = 5_000_000;
    city.buildNetwork(2, 20, 40, 20, 'road'); // does not reach the edge
    city.zone(3, 14, 20, 19, 'R-low');
    city.zone(3, 21, 20, 28, 'I-medium');
    city.step(180);
    expect(city.state.freightTrips).toBe(0);
    city.buildNetwork(31, 21, 31, 23, 'road');
    city.placeStructure('freightStation', 30, 24);
    city.buildNetwork(30, 27, 47, 27, 'rail');
    city.step(60);
    expect(city.state.freightTrips).toBeGreaterThan(0);
    expect(city.fields.railTraffic[tile(city, 40, 27)]).toBeGreaterThan(0);
  }, 60_000);
});

describe('road maintenance and transit funding', () => {
  it('underfunded roads crack, slowing traffic; full funding repairs them', () => {
    const city = new City({ size: 32, water: false, config: CALM });
    city.state.funds = 1_000_000;
    city.buildNetwork(0, 10, 31, 10, 'road');
    city.setDepartmentFunding('roads', 0);
    city.step(30 * 12);
    const cracked = () => city.state.potholes.reduce((a, b) => a + b, 0);
    expect(cracked()).toBeGreaterThan(5);
    city.refresh();
    const i = city.state.potholes.findIndex((p) => p === 1);
    expect(city.fields.travel!.cross[Mode.Car]![i]).toBeGreaterThan(10);
    expect(city.state.lastBudget!.roadUpkeep).toBe(0);
    city.setDepartmentFunding('roads', 100);
    // A quarter of cracked tiles are mended each month: three years mends all.
    city.step(30 * 36);
    expect(cracked()).toBe(0);
  });

  it('partly funded roads settle at some damage, more the lower the funding', () => {
    const cracked = (funding: number) => {
      const city = new City({ size: 32, water: false, config: CALM });
      city.state.funds = 1_000_000;
      for (let y = 4; y < 28; y += 4) city.buildNetwork(0, y, 31, y, 'road');
      city.setDepartmentFunding('roads', funding);
      city.step(30 * 60);
      const asphalt = city.state.net.filter((v) => v !== 0).length;
      return city.state.potholes.reduce((a, b) => a + b, 0) / asphalt;
    };
    const at90 = cracked(90);
    const at50 = cracked(50);
    expect(at90).toBeLessThan(0.08);
    expect(at50).toBeGreaterThan(at90);
    expect(at50).toBeLessThan(0.4); // settles: not every tile in the end
  });

  it('underfunded mass transit makes boarding slower', () => {
    const city = corridor();
    city.placeStructure('busStop', 6, 31);
    const N = city.size * city.size;
    const board = () => transfers(city.state, city.cfg, false).get(Mode.Bus * N + tile(city, 6, 30))![0]![1];
    expect(board()).toBe(20); // 0.2 hours at full funding
    city.setDepartmentFunding('transit', 0);
    expect(board()).toBe(40); // 200% at no funding
  });
});

describe('airports and seaports', () => {
  it('seaports go on the shore and take freight, giving industrial relief', () => {
    const n = 48;
    const city = new City({ size: n, seed: 3, difficulty: 'easy', water: false, config: CALM });
    city.state.funds = 5_000_000;
    for (let y = 0; y < n; y++) for (let x = 40; x < n; x++) city.state.terrain[y * n + x] = 1; // sea to the east
    expect(city.placeStructure('internationalPort', 10, 10).ok).toBe(false); // not on the shore
    city.buildNetwork(2, 20, 37, 20, 'road'); // no connection off the map
    city.zone(3, 14, 20, 19, 'R-low');
    city.zone(3, 21, 20, 28, 'I-medium');
    expect(city.placeStructure('internationalPort', 36, 21).ok).toBe(true);
    city.step(240);
    const port = [...city.state.structures.values()].find((s) => s.kind === 'internationalPort')!;
    expect(port.load).toBeGreaterThan(0);
    expect(city.state.freightTrips).toBe(0); // everything went to the port
  }, 60_000);

  it('airports shorten industry\'s freight time, with a penalty (they count for less than a seaport)', () => {
    const n = 48;
    const city = new City({ size: n, seed: 3, difficulty: 'easy', water: false, config: CALM });
    city.state.funds = 5_000_000;
    city.buildNetwork(2, 20, 45, 20, 'road'); // no connection off the map
    city.zone(3, 21, 20, 28, 'I-medium');
    city.refresh();
    expect(city.query(10, 21)!.freight).toBeNull(); // nowhere to ship to
    expect(city.placeStructure('smallLandingStrip', 30, 21).ok).toBe(true);
    city.refresh();
    expect(city.query(10, 21)!.freight).not.toBeNull();
  });

  it('trucks still reach a connection past a nearby airport (air freight has no trucks)', () => {
    const trips = (airport: boolean): number => {
      const city = new City({ size: 64, seed: 1, difficulty: 'easy', water: false, config: CALM });
      const s = city.state;
      s.funds = 5_000_000;
      city.buildNetwork(0, 32, 50, 32, 'road'); // the west end is a connection
      if (airport) expect(city.placeStructure('smallLandingStrip', 51, 28).ok).toBe(true);
      for (let x = 30; x <= 48; x += 2) {
        const id = s.nextId++;
        s.buildings.set(id, {
          id, x, y: 33, w: 1, h: 1, stage: 1, origType: 'IM', type: 'IM', capacity: 40, occupancy: 1, filled: 30,
          distressMonths: 0, noRoadMonths: 0, noPowerMonths: 0, powered: true, noWaterMonths: 0, watered: true, age: 30, eq: 50, hq: 50,
          abandonReason: null, builtDay: 0, commute: -1, noJobMonths: 0, historical: false,
        } satisfies Building);
        s.occupant[33 * 64 + x] = id;
      }
      city.refresh();
      // Route Query follows the trucks too: west to the connection, not to the strip.
      const freight = city.routeQuery(48, 33).trips.filter((t) => t.means === 'freight');
      expect(freight.length).toBeGreaterThan(0);
      for (const t of freight) expect(t.tiles.at(-1)! % 64).toBe(0);
      return assignTraffic(s, city.fields, city.cfg).freightTrips;
    };
    const without = trips(false);
    expect(without).toBeGreaterThan(0);
    expect(trips(true)).toBe(without);
  }, 60_000);

  it('airports relieve office caps by the offices they can reach', () => {
    const city = corridor();
    city.zone(20, 31, 40, 34, 'C-high');
    city.placeStructure('smallLandingStrip', 30, 20);
    city.buildNetwork(30, 24, 30, 29, 'road');
    city.step(360);
    const strip = [...city.state.structures.values()].find((s) => s.kind === 'smallLandingStrip')!;
    expect(strip.capacity).toBe(102_000);
    const offices = [...city.state.buildings.values()].filter((b) => b.type === 'Co$$' || b.type === 'Co$$$');
    if (offices.length) expect(strip.load).toBeGreaterThan(0);
  }, 60_000);
});

describe('Rush Hour transit', () => {
  it('elevated rail runs over roads and carries walkers between its stations', () => {
    const city = corridor(64, (c) => {
      c.buildElevated(4, 30, 58, 30, 'elrail'); // right above the road
      c.placeStructure('elRailStation', 5, 31);
      c.placeStructure('elRailStation', 57, 31);
    });
    expect(city.query(20, 30)!.elevated).toBe('elrail');
    expect(city.query(20, 30)!.network).toBe('road'); // the road is still there
    city.step(360);
    expect(city.fields.subwayTraffic[tile(city, 30, 30)]).toBeGreaterThan(0);
  }, 60_000);

  it('monorails carry commuters too', () => {
    const city = corridor(64, (c) => {
      c.buildElevated(3, 33, 59, 33, 'monorail');
      c.placeStructure('monorailStation', 5, 31);
      c.placeStructure('monorailStation', 57, 31);
    });
    city.step(360);
    expect(city.fields.monorailTraffic[tile(city, 30, 33)]).toBeGreaterThan(0);
  }, 60_000);

  it('toll booths slow cars and collect §0.10 a car each way', () => {
    const city = corridor();
    expect(city.placeToll(30, 30).ok).toBe(true);
    expect(city.placeToll(30, 31).ok).toBe(false); // not on a road
    city.refresh();
    expect(city.fields.travel!.cross[Mode.Car]![tile(city, 30, 30)]).toBeGreaterThan(20);
    city.step(360);
    const cars = city.fields.traffic[tile(city, 30, 30)]!;
    expect(cars).toBeGreaterThan(0);
    expect(city.state.lastBudget!.fares).toBeCloseTo(cars * 0.2, 0);
    const saved = saveCity(city);
    const copy = loadCity(JSON.parse(JSON.stringify(saved)), { config: CALM });
    expect(copy.previewBudget().fares).toBe(city.previewBudget().fares);
    expect(copy.volume).toEqual(city.volume);
    const legacy = loadCity({ ...saved, volume: undefined }, { config: CALM });
    expect(legacy.volume).toEqual(city.state.history.at(-1)!.trips);
    saved.volume!.car = 123;
    expect(city.volume.car).not.toBe(123);
    expect(copy.volume.car).not.toBe(123);
  }, 60_000);

  it('toll booths need straight road around them, slow two tiles each side, and go on elevated highways', () => {
    const city = new City({ size: 48, seed: 1, water: false, config: CALM });
    city.state.funds = 1_000_000;
    city.buildNetwork(2, 20, 45, 20, 'road');
    city.buildNetwork(20, 21, 20, 30, 'road'); // a junction at (20, 20)
    expect(city.placeToll(21, 20).ok).toBe(false); // next to the junction
    expect(city.placeToll(30, 20).ok).toBe(true);
    city.refresh();
    const car = city.fields.travel!.cross[Mode.Car]!;
    const n = city.size;
    expect(car[20 * n + 32]!).toBeGreaterThan(car[20 * n + 40]!); // two tiles on: still slowed
    expect(car[20 * n + 33]!).toBeCloseTo(car[20 * n + 40]!); // three: not
    city.buildElevated(2, 10, 45, 10, 'highway');
    expect(city.placeToll(25, 10).ok).toBe(true);
    expect(city.state.tolls[10 * n + 25]).toBe(2);
    city.refresh();
    const high = city.fields.travel!.cross[Mode.HighCar]!;
    expect(high[10 * n + 25]!).toBeGreaterThan(high[10 * n + 40]! + 15);
    const restored = loadCity(JSON.parse(JSON.stringify(saveCity(city))), { config: CALM });
    expect(restored.state.tolls[20 * n + 30]).toBe(1);
    expect(restored.state.tolls[10 * n + 25]).toBe(2);
    expect([...restored.fields.travel!.cross[Mode.HighCar]!]).toEqual([...high]);
  });

  it('parking garages let drivers walk on to transit', () => {
    const city = corridor();
    city.placeStructure('parkingGarage', 12, 31);
    const N = city.size * city.size;
    const into = transfers(city.state, city.cfg, false).get(Mode.Walk * N + tile(city, 12, 30))!;
    expect(into.some(([from, cost]) => from === Mode.Car * N + tile(city, 12, 30) && cost === 20)).toBe(true);
  });
});

describe('ferries', () => {
  it('walk-on boats need two terminals of the same kind', () => {
    const n = 48;
    const city = new City({ size: n, water: false, config: CALM });
    city.state.funds = 1_000_000;
    // A lake off the map edges (water reaching an edge leads to the neighbour there).
    for (let y = 1; y < n - 1; y++) for (let x = 20; x < 28; x++) city.state.terrain[y * n + x] = 1;
    city.buildNetwork(0, 10, 19, 10, 'road');
    city.buildNetwork(28, 10, 47, 10, 'road');
    city.placeStructure('smallPoliceStation', 31, 11);
    expect(city.placeStructure('passengerFerry', 19, 11).ok).toBe(true);
    expect(city.placeStructure('carFerry', 26, 5).ok).toBe(true);
    city.buildNetwork(28, 9, 28, 9, 'road');
    const N = n * n;
    const walkOn = () => {
      city.refresh();
      return [...transfers(city.state, city.cfg, false).values()].flat().some(([from, , st]) =>
        Math.floor(from / N) === Mode.Walk && city.state.structures.get(st)?.kind.endsWith('Ferry') === true);
    };
    expect(walkOn()).toBe(false); // one of each kind: nowhere for either boat to go
    expect(city.placeStructure('passengerFerry', 27, 11).ok).toBe(true);
    expect(walkOn()).toBe(true);
    for (let k = 0; k < 15; k++) city.state.structures.set(9000 + k, { ...[...city.state.structures.values()].find((x) => x.kind === 'passengerFerry')!, id: 9000 + k });
    expect(city.placementsLeft('passengerFerry')).toBe(0); // 16 per city
    expect(city.placementsLeft('carFerry')).toBe(15);
  });

  it('sail off the map to a neighbouring city on the same water, even from a lone terminal', () => {
    const n = 48;
    const city = new City({ size: n, water: false, config: CALM });
    city.state.funds = 1_000_000;
    for (let y = 0; y < n; y++) for (let x = 20; x < 28; x++) city.state.terrain[y * n + x] = 1; // a channel off the map
    city.buildNetwork(2, 10, 19, 10, 'road'); // no road out of town
    expect(city.placeStructure('passengerFerry', 19, 11).ok).toBe(true);
    city.refresh();
    const N = n * n;
    const pier = 10 * n + 19;
    const tr = city.fields.travel!;
    expect(tr.fastest.time[Mode.Walk * N + pier]).toBeLessThan(250); // to the neighbour's jobs by boat
    // SimNation's open sea is no city to sail to.
    for (const nb of city.state.neighbours) if (nb) nb.kind = 'simnation';
    city.refresh();
    expect(city.fields.travel!.fastest.time[Mode.Walk * N + pier]).toBeGreaterThan(250);
  });

  it('carry walkers and drivers across water between terminals', () => {
    const n = 48;
    const city = new City({ size: n, water: false, config: CALM });
    city.state.funds = 1_000_000;
    for (let y = 1; y < n - 1; y++) for (let x = 20; x < 28; x++) city.state.terrain[y * n + x] = 1; // a lake
    city.buildNetwork(0, 10, 19, 10, 'road');
    city.buildNetwork(28, 10, 47, 10, 'road');
    city.placeStructure('smallPoliceStation', 31, 11); // a workplace across the water
    expect(city.placeStructure('passengerFerry', 17, 11).ok).toBe(false); // all on land
    expect(city.placeStructure('passengerFerry', 19, 11).ok).toBe(true); // part land, part water
    expect(city.placeStructure('passengerFerry', 27, 11).ok).toBe(true);
    expect(city.placeStructure('carFerry', 18, 5).ok).toBe(true);
    city.buildNetwork(18, 9, 19, 10, 'road'); // drawn into the road below to join it
    expect(city.placeStructure('carFerry', 26, 5).ok).toBe(true);
    city.buildNetwork(28, 9, 28, 9, 'road');
    city.refresh();
    const tr = city.fields.travel!;
    const N = n * n;
    const start = 10 * n + 5;
    const modes = (search: typeof tr.fastest, v: number) => {
      const out = new Set<number>();
      for (; v >= 0; v = search.next[v]!) out.add(Math.floor(v / N));
      return out;
    };
    const pier = 10 * n + 19;
    expect(modes(tr.fastest, Mode.Walk * N + pier).has(Mode.Ferry)).toBe(true); // walkers take the boat
    expect(tr.fastest.time[Mode.Walk * N + pier]).toBeLessThan(250);
    expect(modes(tr.car, Mode.Car * N + start).has(Mode.CarFerry)).toBe(true); // drivers use the car ferry
    expect(tr.car.time[Mode.Car * N + start]).toBeLessThan(250);

    // A tall bridge along the channel leaves the ferries alone; a low one (cheaper) cuts them off.
    const funds = city.state.funds;
    const preview = city.previewNetwork(23, 0, 23, n - 1, 'road');
    expect(city.state.funds).toBe(funds); // a preview changes nothing
    expect(preview.ok).toBe(true);
    expect(preview.bridges).toBeGreaterThan(0);
    expect(city.buildNetwork(23, 0, 23, n - 1, 'road').ok).toBe(true);
    const tall = funds - city.state.funds;
    expect(tall).toBeCloseTo(preview.cost, 6);
    expect(city.previewNetwork(23, 0, 23, n - 1, 'road').tiles).toBe(0); // already built
    city.refresh();
    expect(modes(city.fields.travel!.fastest, Mode.Walk * N + pier).has(Mode.Ferry)).toBe(true);
    city.bulldoze(23, 0, 23, n - 1);
    const before = city.state.funds;
    expect(city.buildNetwork(23, 0, 23, n - 1, 'road', { lowBridge: true }).ok).toBe(true);
    const land = 2 * city.cfg.economy.networkCost.road.build; // a tile of land at each end
    expect(before - city.state.funds).toBeCloseTo((tall - land) * 0.6 + land, 0);
    expect(city.query(23, 10)!.lowBridge).toBe(true);
    city.refresh();
    expect(modes(city.fields.travel!.fastest, Mode.Walk * N + pier).has(Mode.Ferry)).toBe(false);
  });

  it('lots front onto a low bridge as onto any road, but not onto a tunnel', () => {
    const city = new City({ size: 16, water: false });
    city.state.funds = 100_000;
    city.buildNetwork(0, 5, 15, 5, 'road');
    const lot = { x: 4, y: 6, w: 1, h: 1 };
    const i = 5 * 16 + 4;
    city.state.tunnel[i] = SPAN.lowBridge;
    expect(frontage(city.state, lot)).toEqual([i]);
    city.state.tunnel[i] = SPAN.tunnel;
    expect(frontage(city.state, lot)).toEqual([]);
  });
});

describe('one-way roads', () => {
  it('cars only drive the way the road was drawn; walkers go both ways', () => {
    const city = new City({ size: 32, water: false, config: CALM });
    city.state.funds = 100_000;
    city.buildNetwork(0, 10, 25, 10, 'oneway'); // eastbound
    expect(city.query(5, 10)!.network).toBe('oneway');
    city.placeStructure('smallPoliceStation', 20, 11); // a workplace at the east end
    city.refresh();
    const N = 32 * 32;
    const tr = city.fields.travel!;
    expect(tr.car.time[Mode.Car * N + 10 * 32 + 3]).toBeLessThan(250); // west of the job: drive east
    city.placeStructure('smallPoliceStation', 26, 3); // nothing; now test the reverse direction
    const back = new City({ size: 32, water: false, config: CALM });
    back.state.funds = 100_000;
    back.buildNetwork(0, 10, 25, 10, 'oneway');
    back.placeStructure('smallPoliceStation', 2, 11); // job at the west end
    back.refresh();
    const tb = back.fields.travel!;
    expect(tb.car.time[Mode.Car * N + 10 * 32 + 20]).toBeGreaterThan(250); // can't drive west
    back.buildNetwork(25, 10, 0, 10, 'oneway'); // redraw westbound
    back.refresh();
    expect(back.fields.travel!.car.time[Mode.Car * N + 10 * 32 + 20]).toBeLessThan(250);
    expect(back.buildNetwork(0, 20, 31, 20, 'oneway').ok).toBe(true);
    expect(back.placeToll(5, 20).ok).toBe(false); // no tolls on one-way roads
  });
});

describe('stations join only the lines they serve', () => {
  it('a station on a rail stub does not link the road networks at its sides', () => {
    const n = 48;
    const city = new City({ size: n, water: false });
    city.state.funds = 1_000_000;
    expect(city.placeStructure('trainStation', 20, 20).ok).toBe(true);
    expect(city.buildNetwork(23, 20, 23, 22, 'rail').ok).toBe(true); // goes nowhere
    expect(city.buildNetwork(2, 21, 19, 21, 'road').ok).toBe(true); // west side
    expect(city.buildNetwork(21, 2, 21, 19, 'road').ok).toBe(true); // north side, not joined
    expect(city.placeStructure('smallPoliceStation', 22, 15).ok).toBe(true); // a job up north
    city.refresh();
    const N = n * n;
    // On and off at the same station is no ride: the west road can't reach the job.
    expect(city.fields.travel!.fastest.time[Mode.Car * N + 21 * n + 3]).toBeGreaterThan(city.cfg.transport.tripLimit);
  });
});

describe('route query', () => {
  it('shows where a home\'s commuters go, who arrives at a workplace, and what crosses a road', () => {
    const city = corridor();
    city.step(360);
    // Some homes work the factories; others (the map edge is close) a neighbour's jobs.
    const east = (b: { x: number; y: number }) => city.routeQuery(b.x, b.y).trips.some((t) => t.tiles.at(-1)! % city.size > 40);
    const home = homes(city).find((b) => b.occupancy > 0 && east(b))!;
    const out = city.routeQuery(home.x, home.y);
    expect(out.trips.length).toBeGreaterThan(0);
    for (const t of out.trips) expect(t.from).toBe(home.id);
    const total = Object.values(out.byMeans).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(out.trips.reduce((a, t) => a + t.amount, 0), 3);
    // The route runs east along the road to the industry.
    const trip = out.trips.find((t) => t.tiles.at(-1)! % city.size > 40)!;
    expect(trip.tiles[0]! % city.size).toBeLessThan(12);
    // A factory sees commuters arriving (and its own freight leaving).
    const factories = [...city.state.buildings.values()].filter((b) => b.type?.[0] === 'I' && b.occupancy > 0);
    const arrivals = factories.map((f) => city.routeQuery(f.x, f.y).trips.filter((t) => t.from !== f.id && t.means !== 'freight'));
    expect(arrivals.some((a) => a.length > 0)).toBe(true);
    // Each lists only those who work there: never more than its jobs.
    factories.forEach((f, k) => expect(arrivals[k]!.reduce((a, t) => a + t.amount, 0)).toBeLessThanOrEqual(f.capacity * f.occupancy + 1e-6));
    const own = city.routeQuery(factories[0]!.x, factories[0]!.y).trips.filter((t) => t.from === factories[0]!.id);
    expect(own.every((t) => t.means === 'freight')).toBe(true);
    // The road between them carries trips.
    const road = city.routeQuery(30, 30);
    expect(road.trips.length).toBeGreaterThan(0);
    expect(road.trips.every((t) => t.tiles.includes(30 * city.size + 30))).toBe(true);
    // A city loaded from a save replays the month for its log, and only the log.
    const saved = JSON.stringify(saveCity(city));
    const loaded = loadCity(JSON.parse(saved));
    const sum = (q: { trips: { amount: number }[] }) => q.trips.reduce((a, t) => a + t.amount, 0);
    expect(sum(loaded.routeQuery(30, 30))).toBeCloseTo(sum(road), 0);
    expect(sum(loaded.routeQuery(home.x, home.y))).toBeCloseTo(sum(out), 1);
    expect(JSON.stringify(saveCity(loaded))).toBe(saved);
  }, 60_000);
});

describe('traffic volume graph', () => {
  it('records each month\'s trips by kind', () => {
    const city = corridor();
    city.placeStructure('busStop', 6, 31);
    city.placeStructure('busStop', 51, 31);
    city.step(360);
    const last = city.state.history.at(-1)!;
    expect(last.trips!.car).toBeGreaterThan(0);
    expect(last.trips!.freightTruck).toBeGreaterThan(0);
    // Trucks add to traffic about like commuters: a truck a day per four industrial jobs.
    const jobs = [...city.state.buildings.values()].filter((b) => b.type?.[0] === 'I').reduce((a, b) => a + b.filled, 0);
    expect(city.volume.freightTruck!).toBeGreaterThan(jobs * 0.15);
    expect(city.volume.freightTruck!).toBeLessThan(jobs * 0.35);
    const sum = Object.values(city.volume).reduce((a: number, b) => a + (b ?? 0), 0);
    expect(Object.values(last.trips!).reduce((a: number, b) => a + (b ?? 0), 0)).toBeCloseTo(sum, -1);
  }, 60_000);
});

describe('tunnels', () => {
  /** A flat map with a ridge 24 m high across x = 20..22. */
  function ridge(): City {
    const city = new City({ size: 40, water: false, config: CALM });
    city.state.funds = 1_000_000;
    for (let k = 0; k < 6; k++) city.terraform(20, 0, 22, 39, 'raise');
    return city;
  }

  it('roads, rail and highways tunnel through steep hills from either side; walkers cannot', () => {
    const city = ridge();
    expect(city.query(21, 10)!.height - city.query(10, 10)!.height).toBe(24);
    const funds = city.state.funds;
    const res = city.buildNetwork(0, 10, 39, 10, 'road');
    expect(res.ok).toBe(true);
    expect(funds - city.state.funds).toBe(40 * 10 + 3 * 10 * 3); // three tunnel tiles at 4×
    for (const x of [20, 21, 22]) expect(city.query(x, 10)!.tunnel).toBe(true);
    expect(city.query(19, 10)!.tunnel).toBe(false);
    city.refresh();
    const cross = city.fields.travel!.cross;
    expect(cross[Mode.Walk]![tile(city, 21, 10)]).toBe(0);
    expect(cross[Mode.Car]![tile(city, 21, 10)]).toBeGreaterThan(0);
    // Dragged the other way, the rail line tunnels too.
    expect(city.buildNetwork(39, 20, 0, 20, 'rail').ok).toBe(true);
    expect(city.query(21, 20)!.tunnel).toBe(true);
  });

  it('streets and avenues cannot climb it; a tunnel or bridge must reach the other side', () => {
    const city = ridge();
    expect(city.buildNetwork(0, 10, 39, 10, 'street').message).toMatch(/too steep/);
    expect(city.buildNetwork(21, 12, 39, 12, 'road').message).toMatch(/too steep/);
    expect(city.buildNetwork(0, 14, 21, 14, 'road').message).toMatch(/other side/);
  });

  it('a gorge is bridged from either side, and walkers may cross bridges', () => {
    const city = new City({ size: 40, water: false, config: CALM });
    city.state.funds = 1_000_000;
    for (let k = 0; k < 6; k++) city.terraform(0, 0, 39, 39, 'raise'); // high plateau
    for (let k = 0; k < 6; k++) city.terraform(20, 0, 22, 39, 'lower'); // a gorge 24 m deep
    expect(city.buildNetwork(0, 10, 39, 10, 'road').ok).toBe(true);
    for (const x of [20, 21, 22]) expect(city.query(x, 10)!.bridge).toBe(true);
    expect(city.buildNetwork(39, 20, 0, 20, 'rail').ok).toBe(true);
    expect(city.query(21, 20)!.bridge).toBe(true);
    city.refresh();
    expect(city.fields.travel!.cross[Mode.Walk]![tile(city, 21, 10)]).toBeGreaterThan(0);
  });
});

describe('evening commute', () => {
  it('drives home the other way round a pair of one-way roads, the busier rush hour counting', () => {
    const n = 48;
    const city = new City({ size: n, seed: 3, difficulty: 'easy', water: false, config: CALM });
    city.state.funds = 1_000_000;
    city.buildNetwork(4, 10, 4, 30, 'road'); // the homes' street
    city.buildNetwork(42, 10, 42, 30, 'road'); // the factories'
    city.buildNetwork(4, 15, 42, 15, 'oneway'); // eastbound, to work
    city.buildNetwork(42, 25, 4, 25, 'oneway'); // westbound, home
    city.zone(5, 10, 10, 30, 'R-medium', { autoStreets: false });
    city.zone(36, 10, 41, 30, 'I-medium', { autoStreets: false });
    city.step(360);
    const at = (x: number, y: number) => city.fields.traffic[y * n + x]!;
    expect(at(23, 15)).toBeGreaterThan(20);
    // Home the other way: the same commuters, without the freight trucks that only go out in the morning.
    expect(at(23, 25)).toBeGreaterThan(at(23, 15) * 0.7);
    expect(at(23, 25)).toBeLessThanOrEqual(at(23, 15) + 1);
  }, 60_000);
});

describe('road links (neighbouring roads stay apart)', () => {
  it('side-by-side roads stay apart until joined by hand; streets join anything beside them', () => {
    const n = 32;
    const city = new City({ size: n, water: false, config: CALM });
    city.state.funds = 1_000_000;
    city.buildNetwork(2, 10, 28, 10, 'road');
    city.buildNetwork(2, 11, 28, 11, 'road'); // right beside it
    city.refresh();
    const f = city.fields;
    expect(f.component[tile(city, 5, 10)]).not.toBe(f.component[tile(city, 5, 11)]);
    // No junction slowdown along the pair either.
    expect(f.travel!.cross[Mode.Car]![tile(city, 15, 10)]).toBeCloseTo(city.cfg.transport.speed.road.car!, 3);
    // A road drawn up to another joins it at the end of the drag.
    city.buildNetwork(15, 20, 15, 12, 'road');
    city.refresh();
    expect(f.component[tile(city, 15, 20)]).toBe(f.component[tile(city, 15, 11)]);
    expect(f.component[tile(city, 15, 20)]).not.toBe(f.component[tile(city, 15, 10)]);
    // A road dragged across both joins them.
    city.buildNetwork(20, 9, 20, 12, 'road');
    city.refresh();
    expect(f.component[tile(city, 5, 10)]).toBe(f.component[tile(city, 5, 11)]);
    // Streets join whatever they touch.
    city.buildNetwork(2, 13, 28, 13, 'road');
    city.buildNetwork(2, 14, 28, 14, 'street');
    city.refresh();
    expect(f.component[tile(city, 5, 13)]).toBe(f.component[tile(city, 5, 14)]);
    // Saved with the city; a save from before links were kept joins every road to its neighbours.
    city.buildNetwork(2, 24, 28, 24, 'road');
    city.buildNetwork(2, 25, 28, 25, 'road');
    const saved = saveCity(city);
    expect(loadCity(saved).state.links).toEqual(city.state.links);
    const old = loadCity({ ...saved, links: undefined });
    old.refresh();
    expect(old.fields.component[tile(city, 5, 24)]).toBe(old.fields.component[tile(city, 5, 25)]);
  });
});

describe('highway interchanges', () => {
  it('a road crossing a ground highway passes over it, joined only by onramps', () => {
    const n = 40;
    const N = n * n;
    const city = new City({ size: n, water: false, config: CALM });
    city.state.funds = 1_000_000;
    city.buildNetwork(2, 20, n - 3, 20, 'highway'); // off the map edges: no neighbour jobs
    const before = city.state.funds;
    const res = city.buildNetwork(10, 5, 10, 35, 'road');
    expect(res.ok).toBe(true);
    // The overpass costs a good deal extra.
    expect(res.cost).toBeGreaterThan(31 * city.cfg.economy.networkCost.road.build);
    expect(city.state.funds).toBe(before - res.cost);
    expect(city.query(10, 20)!.over).toBe('road');
    expect(city.state.net[tile(city, 10, 20)]).toBe(4); // still highway below
    city.placeStructure('smallPoliceStation', 11, 30); // a workplace south of the highway
    city.refresh();
    const car = (x: number, y: number) => city.fields.travel!.car.time[Mode.Car * N + y * n + x]!;
    // Cars from the north drive straight over; the highway below still runs east–west.
    expect(car(10, 6)).toBeLessThan(250);
    expect(city.fields.travel!.cross[Mode.Walk]![tile(city, 10, 20)]).toBeGreaterThan(0);
    // Without ramps, highway drivers can't get off at the road.
    expect(car(4, 20)).toBeGreaterThan(250);
    // An onramp off a side road beside the overpass joins them.
    expect(city.buildNetwork(11, 21, 13, 21, 'road').ok).toBe(true);
    expect(city.buildNetwork(13, 21, 13, 21, 'onramp').ok).toBe(true);
    city.refresh();
    expect(car(4, 20)).toBeLessThan(250);
    expect(city.placeCloverleaf(10, 20).ok).toBe(false);
    // Saved with the city; bulldozing the crossing clears it.
    expect(loadCity(saveCity(city)).query(10, 20)!.over).toBe('road');
    city.bulldoze(10, 20, 10, 20);
    expect(city.query(10, 20)!.over).toBeNull();
  });

  it('a one-way road passes over a ground highway too, its deck one way and the highway below both', () => {
    const n = 40;
    const N = n * n;
    const city = new City({ size: n, water: false, config: CALM });
    city.state.funds = 1_000_000;
    city.buildNetwork(2, 20, n - 3, 20, 'highway');
    expect(city.buildNetwork(20, 5, 20, 35, 'oneway').ok).toBe(true); // southbound
    expect(city.query(20, 20)!.over).toBe('oneway');
    expect(city.state.oneway[tile(city, 20, 20)]).toBe(2); // south, on the deck
    // The highway below still runs both ways.
    expect(carMove(city.state, tile(city, 19, 20), tile(city, 20, 20))).toBe(true);
    expect(carMove(city.state, tile(city, 21, 20), tile(city, 20, 20))).toBe(true);
    // Southbound drivers cross over to a workplace south of the highway.
    city.placeStructure('smallPoliceStation', 21, 30);
    city.refresh();
    expect(city.fields.travel!.car.time[Mode.Car * N + 10 * n + 20]!).toBeLessThan(250);
    expect(loadCity(saveCity(city)).state.oneway[tile(city, 20, 20)]).toBe(2);
    // Redrawn the other way, the deck turns with it; as a road, it carries both ways.
    expect(city.buildNetwork(20, 35, 20, 5, 'oneway').ok).toBe(true);
    expect(city.state.oneway[tile(city, 20, 20)]).toBe(4);
    expect(city.buildNetwork(20, 5, 20, 35, 'road').ok).toBe(true);
    expect(city.query(20, 20)!.over).toBe('road');
    expect(city.state.oneway[tile(city, 20, 20)]).toBe(0);
  });

  it('crossing highways pass over each other until a Cloverleaf joins them', () => {
    const n = 40;
    const N = n * n;
    const city = new City({ size: n, water: false, config: CALM });
    city.state.funds = 1_000_000;
    city.buildNetwork(0, 20, n - 1, 20, 'highway');
    city.buildNetwork(30, 22, n - 1, 22, 'road');
    city.buildNetwork(35, 21, 35, 21, 'onramp');
    city.placeStructure('smallPoliceStation', 33, 23); // a workplace off the east–west highway
    const res = city.buildNetwork(10, 0, 10, n - 1, 'highway');
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/Cloverleaf/);
    expect(city.query(10, 20)!.interchange).toBe('overpass');
    city.refresh();
    const from = (x: number, y: number) => city.fields.travel!.car.time[Mode.Car * N + y * n + x]!;
    // Traffic still flows straight through both ways.
    expect(from(2, 20)).toBeLessThan(60);
    const over = from(10, 5);
    expect(city.fields.travel!.cross[Mode.HighCar]![tile(city, 10, 20)]).toBeGreaterThan(0);
    const funds = city.state.funds;
    expect(city.placeCloverleaf(10, 20).ok).toBe(true);
    expect(city.state.funds).toBe(funds - 3_000);
    expect(city.query(10, 20)!.interchange).toBe('cloverleaf');
    city.refresh();
    const joined = from(10, 5);
    expect(joined).toBeLessThan(60);
    expect(over).toBeGreaterThan(joined + 50);
    // The Cloverleaf is kept in saves and costs §26 a month.
    expect(loadCity(saveCity(city)).state.interchange[tile(city, 10, 20)]).toBe(2);
    expect(city.placeCloverleaf(3, 3).ok).toBe(false);
  });
});

describe('elevated highways', () => {
  it('join a ground highway only end to end, not where they cross or touch it', () => {
    const n = 48;
    const N = n * n;
    const highTime = (build: (c: City) => void, x: number, y: number) => {
      const city = new City({ size: n, water: false, config: CALM });
      city.state.funds = 1_000_000;
      build(city);
      city.refresh();
      return city.fields.travel!.car.time[Mode.HighCar * N + y * n + x]!;
    };
    // Ground highway from the west edge, elevated carrying on in line from its end: joined.
    expect(highTime((c) => { c.buildNetwork(0, 10, 20, 10, 'highway'); c.buildElevated(21, 10, 40, 10, 'highway'); }, 35, 10)).toBeLessThan(1e6);
    // Elevated crossing over it, ending short of the map edges: no way down.
    expect(highTime((c) => { c.buildNetwork(0, 10, 40, 10, 'highway'); c.buildElevated(20, 3, 20, 30, 'highway'); }, 20, 25)).toBeGreaterThan(1e6);
  });

  it('run over roads and are reached by onramps, speeding up long trips', () => {
    const n = 64;
    const city = new City({ size: n, water: false, config: CALM });
    city.state.funds = 1_000_000;
    city.buildNetwork(0, 10, 63, 10, 'road');
    for (let x = 6; x < 60; x += 6) city.buildNetwork(x, 5, x, 15, 'road'); // cross streets: intersections
    city.placeStructure('smallPoliceStation', 60, 11);
    city.refresh();
    const N = n * n;
    const start = Mode.Car * N + 10 * n + 2;
    const slow = city.fields.travel!.car.time[start]!;
    expect(city.buildElevated(4, 10, 59, 10, 'highway').ok).toBe(true); // right over the road
    expect(city.query(20, 10)!.network).toBe('road');
    expect(city.query(20, 10)!.elevated).toBe('highway');
    city.buildNetwork(4, 11, 4, 11, 'onramp');
    city.buildNetwork(59, 11, 59, 11, 'onramp');
    city.refresh();
    const fast = city.fields.travel!.car.time[start]!;
    expect(fast).toBeLessThan(slow * 0.7);
  });

  it('buses ride elevated highways too', () => {
    const n = 64;
    const N = n * n;
    const city = new City({ size: n, water: false, config: CALM });
    city.state.funds = 1_000_000;
    city.buildNetwork(0, 10, 63, 10, 'road');
    for (let x = 6; x < 60; x += 6) city.buildNetwork(x, 5, x, 15, 'road');
    city.placeStructure('smallPoliceStation', 61, 11);
    city.placeStructure('busStop', 1, 11);
    city.placeStructure('busStop', 60, 9);
    city.buildElevated(4, 10, 59, 10, 'highway');
    city.buildNetwork(4, 11, 4, 11, 'onramp');
    city.buildNetwork(59, 11, 59, 11, 'onramp');
    city.refresh();
    const tr = city.fields.travel!.transit;
    const modes = new Set<number>();
    for (let v = Mode.Walk * N + tile(city, 1, 10); v >= 0; v = tr.next[v]!) modes.add(Math.floor(v / N));
    expect(modes.has(Mode.Bus)).toBe(true);
    expect(modes.has(Mode.HighBus)).toBe(true);
  });
});

describe('job capacity', () => {
  it('transit riders take the bus to their job, boarding counted at the stop', () => {
    const n = 48;
    const city = new City({ size: n, water: false, config: CALM });
    city.state.funds = 100_000;
    city.buildNetwork(2, 10, 45, 10, 'road'); // no neighbour connection
    const home: Building = {
      id: 999, x: 3, y: 11, w: 2, h: 2, stage: 3, origType: 'R$', type: 'R$', capacity: 40, occupancy: 1, filled: 0,
      distressMonths: 0, noRoadMonths: 0, noPowerMonths: 0, powered: true, noWaterMonths: 0, watered: true, age: 30, eq: 50, hq: 50,
      abandonReason: null, builtDay: 0, commute: -1, noJobMonths: 0, historical: false,
    };
    city.state.buildings.set(home.id, home);
    for (let y = 11; y < 13; y++) for (let x = 3; x < 5; x++) city.state.occupant[y * n + x] = home.id;
    city.placeStructure('smallPoliceStation', 30, 11); // 10 R$ jobs
    expect(city.placeStructure('busStop', 5, 11).ok).toBe(true);
    expect(city.placeStructure('busStop', 29, 11).ok).toBe(true);
    city.refresh();
    const r = assignTraffic(city.state, city.fields, city.cfg);
    // R$ ride transit by preference (80%): the bus takes most of them.
    expect(r.volume.bus).toBeGreaterThan(5);
    expect(r.volume.bus).toBeGreaterThan(r.volume.car);
    const stop = [...city.state.structures.values()].find((st) => st.kind === 'busStop' && st.x === 5)!;
    expect(stop.load).toBeCloseTo(r.volume.bus, 3);
    // Every worker gets there (the R$$ jobs once the R$ ones are gone).
    expect(r.volume.bus + r.volume.car).toBeCloseTo(40 * interp(city.cfg.services.workforceByHq, 50), 1);
  });

  it('Sims keep their jobs month to month, at the review too, until the job is gone (Rush Hour)', () => {
    const n = 48;
    const city = new City({ size: n, water: false, config: CALM });
    city.state.funds = 100_000;
    city.buildNetwork(2, 10, 45, 10, 'road'); // no neighbour connection
    const home: Building = {
      id: 999, x: 3, y: 11, w: 2, h: 2, stage: 3, origType: 'R$', type: 'R$', capacity: 20, occupancy: 1, filled: 0,
      distressMonths: 0, noRoadMonths: 0, noPowerMonths: 0, powered: true, noWaterMonths: 0, watered: true, age: 30, eq: 50, hq: 50,
      abandonReason: null, builtDay: 0, commute: -1, noJobMonths: 0, historical: false,
    };
    city.state.buildings.set(home.id, home);
    for (let y = 11; y < 13; y++) for (let x = 3; x < 5; x++) city.state.occupant[y * n + x] = home.id;
    city.placeStructure('smallPoliceStation', 38, 11); // the only jobs, far away
    const far = [...city.state.structures.values()][0]!;
    const at = (x: number) => city.fields.traffic[10 * n + x]!;
    const workers = 20 * interp(city.cfg.services.workforceByHq, 50); // fewer than the 10 R$ jobs at either
    const month = (m: number) => {
      city.state.day = m * 30;
      city.refresh();
      assignTraffic(city.state, city.fields, city.cfg);
    };
    month(2);
    expect(home.jobs).toEqual([-far.id, Math.round(workers * 1000) / 1000]);
    // A nearer workplace opens: they keep the job they have…
    city.placeStructure('smallPoliceStation', 12, 11);
    month(3);
    expect(at(25)).toBeCloseTo(workers, 1);
    // The Route Query shows the trip they make, not the nearest workplace's.
    expect(city.routeQuery(3, 11).trips.every((tr) => tr.tiles.at(-1)! % n > 30)).toBe(true);
    const farTrip = home.commute;
    // (Its commute is the trip they make, to the far job, not to the nearest workplace.)
    expect(farTrip).toBeGreaterThan(city.fields.travel!.fastest.time[Mode.Car * n * n + 10 * n + 3]! + 20);
    // …at the route's review too (same job, by a faster route if one opens).
    month(5);
    month(6);
    expect(at(25)).toBeCloseTo(workers, 1);
    expect(home.jobs![0]).toBe(-far.id);
    // A job gone sends them looking at once: the nearer one.
    city.state.structures.delete(far.id);
    month(7);
    expect(at(25)).toBe(0);
    expect(home.jobs![0]).not.toBe(-far.id);
    // Kept in saves.
    expect(loadCity(saveCity(city)).state.buildings.get(999)!.jobs).toEqual(home.jobs);
  });

  it('Sims drive past jobs of another wealth to the closest of their own', () => {
    const n = 48;
    const city = new City({ size: n, water: false, config: CALM });
    city.state.funds = 100_000;
    city.buildNetwork(2, 10, 45, 10, 'road'); // no neighbour connection
    const add = (id: number, x: number, type: Building['type'], capacity: number) => {
      const b = {
        id, x, y: 11, w: 2, h: 2, stage: 3, origType: type!, type, capacity, occupancy: 1, filled: 0,
        distressMonths: 0, noRoadMonths: 0, noPowerMonths: 0, powered: true, noWaterMonths: 0, watered: true, age: 30, eq: 50, hq: 50,
        abandonReason: null, builtDay: 0, commute: -1, noJobMonths: 0, historical: false,
      } satisfies Building;
      city.state.buildings.set(id, b);
      for (let y = 11; y < 13; y++) for (let xx = x; xx < x + 2; xx++) city.state.occupant[y * n + xx] = id;
    };
    add(999, 3, 'R$$', 20);
    add(1000, 12, 'ID', 40); // dirty industry hires only R$
    add(1001, 38, 'IHT', 40); // high tech: 32 R$$ jobs
    city.refresh();
    assignTraffic(city.state, city.fields, city.cfg);
    const at = (x: number) => city.fields.traffic[10 * n + x]!;
    const workers = 20 * interp(city.cfg.services.workforceByHq, 50);
    expect(at(25)).toBeCloseTo(workers, 0); // all of them, past the factory
    expect(city.fields.jobless.has(999)).toBe(false);
  });

  it('commuters fill the nearest workplace, then go on to the next one with openings', () => {
    const n = 48;
    const city = new City({ size: n, water: false, config: CALM });
    city.state.funds = 100_000;
    city.buildNetwork(2, 10, 45, 10, 'road'); // no neighbour connection
    city.placeStructure('smallPoliceStation', 12, 11); // 22 jobs nearby (10 R$, 12 R$$)
    city.placeStructure('smallPoliceStation', 38, 11); // 22 more far away
    const home = {
      id: 999, x: 3, y: 11, w: 2, h: 2, stage: 3, origType: 'R$', type: 'R$', capacity: 100, occupancy: 1, filled: 0,
      distressMonths: 0, noRoadMonths: 0, noPowerMonths: 0, powered: true, noWaterMonths: 0, watered: true, age: 30, eq: 50, hq: 50,
      abandonReason: null, builtDay: 0, commute: -1, noJobMonths: 0, historical: false,
    } satisfies Building;
    city.state.buildings.set(home.id, home);
    for (let y = 11; y < 13; y++) for (let x = 3; x < 5; x++) city.state.occupant[y * n + x] = home.id;
    city.refresh();
    assignTraffic(city.state, city.fields, city.cfg);
    const workers = 100 * interp(city.cfg.services.workforceByHq, home.hq);
    expect(workers).toBeGreaterThan(44);
    const at = (x: number) => city.fields.traffic[10 * n + x]!;
    // R$ Sims take R$ jobs first (the nearest vacancy at their wealth): 10 at
    // the first station, 10 at the second; with none of theirs
    // left they take the R$$ jobs (12 at each) near where they looked once every
    // wealth has looked (along the month's first planned trip, to the first
    // station), and the rest stay home.
    expect(at(8)).toBeCloseTo(44, 0);
    expect(at(25)).toBeCloseTo(10, 0);
    expect(at(44)).toBe(0);
    // Every job on the road is taken: the home's unplaced commuters count against it.
    expect(city.fields.jobless.get(999)).toBeCloseTo(1 - 44 / workers, 2);
    // A workplace gone since the routes were planned: its commuters find nothing else open.
    const far = [...city.state.structures.values()].find((x) => x.x === 38)!;
    city.state.structures.delete(far.id);
    assignTraffic(city.state, city.fields, city.cfg);
    expect(at(8)).toBeCloseTo(22, 0);
    expect(at(25)).toBe(0);
  });
});

describe('highway costs (Rush Hour)', () => {
  it('a ground highway costs a third of an elevated one', () => {
    const city = new City({ size: 32, water: false, config: CALM });
    city.state.funds = 100_000;
    const ground = city.buildNetwork(0, 5, 9, 5, 'highway');
    const elevated = city.buildElevated(0, 20, 9, 20, 'highway');
    expect(ground.cost).toBe(10 * 100); // §200 a 2-tile segment
    expect(elevated.cost).toBe(10 * 300); // §600 a segment
  });

  it('an Avenue run straight into a ground highway joins it through an in-line ramp', () => {
    const city = new City({ size: 32, water: false, config: CALM });
    city.state.funds = 100_000;
    city.buildNetwork(0, 5, 9, 5, 'highway');
    const before = city.state.funds;
    const r = city.buildNetwork(10, 5, 20, 5, 'avenue');
    expect(r.cost).toBe(11 * 30 + 200);
    expect(before - city.state.funds).toBe(r.cost);
    expect(city.query(10, 5)!.network).toBe('onramp');
    expect(city.query(11, 5)!.network).toBe('avenue');
    city.buildNetwork(0, 6, 9, 6, 'avenue'); // alongside: no ramp
    expect(city.query(0, 6)!.network).toBe('avenue');
    expect(city.query(9, 6)!.network).toBe('avenue');
    // Drawn from the far end towards the highway works too.
    city.buildNetwork(0, 12, 9, 12, 'highway');
    city.buildNetwork(20, 12, 10, 12, 'avenue');
    expect(city.query(10, 12)!.network).toBe('onramp');
    // Elevated highways join Avenues the same way, for §600.
    city.buildElevated(0, 28, 9, 28, 'highway');
    const r2 = city.buildNetwork(10, 28, 15, 28, 'avenue');
    expect(r2.cost).toBe(6 * 30 + 600);
    expect(city.query(10, 28)!.network).toBe('onramp');
    city.buildNetwork(20, 3, 25, 3, 'avenue');
    const r3 = city.buildElevated(26, 3, 31, 3, 'highway');
    expect(r3.cost).toBe(6 * 300 + 600);
    expect(city.query(25, 3)!.network).toBe('onramp');
    // A street ending on an existing Avenue end, or redrawing the Avenue, adds no ramp.
    city.buildNetwork(0, 20, 9, 20, 'highway');
    city.buildNetwork(10, 20, 10, 25, 'avenue'); // runs across, not into, the highway's end
    const funds = city.state.funds;
    expect(city.buildNetwork(10, 20, 10, 25, 'avenue').cost).toBe(0);
    expect(city.state.funds).toBe(funds);
  });
});

describe('Subway-to-Elevated Transition (Rush Hour)', () => {
  it('subway and elevated rail only meet at a transition', () => {
    const n = 64;
    const city = new City({ size: n, water: false, config: CALM });
    city.state.funds = 1_000_000;
    city.buildNetwork(2, 30, 61, 30, 'road');
    city.buildSubway(6, 31, 30, 31);
    city.buildElevated(30, 30, 51, 30, 'elrail'); // above the road, starting beside the subway's end
    expect(city.placeStructure('subwayStation', 6, 31).ok).toBe(true);
    expect(city.placeStructure('elRailStation', 51, 31).ok).toBe(true);
    city.placeStructure('smallPoliceStation', 53, 31); // the only workplace, by the elevated station
    const N = n * n;
    const usesTrain = () => {
      city.refresh();
      const tr = city.fields.travel!;
      const seen = new Set<number>();
      for (let v = Mode.Walk * N + 30 * n + 5; v >= 0; v = tr.fastest.next[v]!) seen.add(Math.floor(v / N));
      return seen.has(Mode.Subway);
    };
    expect(usesTrain()).toBe(false);
    expect(city.placeSubwayTransition(10, 31).ok).toBe(false); // no elevated rail beside it
    expect(city.placeSubwayTransition(30, 31).ok).toBe(true);
    expect(city.query(30, 31)!.subwayTransition).toBe(true);
    expect(usesTrain()).toBe(true);
    const back = loadCity(JSON.parse(JSON.stringify(saveCity(city))));
    expect(back.state.transitions).toEqual([31 * n + 30]);
  });
});


describe('level crossings and decks', () => {
  it('a level crossing runs at the crossing road’s speed (a street’s, an avenue’s), not a Road’s', () => {
    for (const kind of ['street', 'avenue'] as const) {
      const n = 32;
      const c = new City({ size: n, water: false, config: CALM });
      c.state.funds = 1e7;
      expect(c.buildNetwork(0, 10, n - 1, 10, kind).ok).toBe(true);
      expect(c.buildNetwork(15, 0, 15, n - 1, 'rail').ok).toBe(true);
      c.refresh();
      const i = 10 * n + 15;
      expect(c.state.net[i]).toBe(Net.RailCrossing);
      const car = c.fields.travel!.cross[Mode.Car]!;
      expect(car[i]).toBeCloseTo(car[i - 3]!, 5);
    }
  });

  it('an elevated highway and a road deck over a ground highway cannot share a tile', () => {
    const n = 40;
    const c = new City({ size: n, water: false, config: CALM });
    c.state.funds = 1e7;
    expect(c.buildNetwork(20, 0, 20, n - 1, 'highway').ok).toBe(true);
    expect(c.buildNetwork(0, 10, 30, 10, 'road').ok).toBe(true); // over the highway on a deck
    expect(c.buildElevated(0, 10, 30, 10, 'highway').ok).toBe(false);
    expect(c.buildElevated(0, 14, 30, 14, 'highway').ok).toBe(true);
    expect(c.buildNetwork(0, 14, 30, 14, 'road').ok).toBe(false); // a deck under it would cut it
  });

  it('an underfunded road department lets elevated highways crack too', () => {
    const city = new City({ size: 32, water: false, config: CALM });
    city.state.funds = 1e6;
    expect(city.buildElevated(0, 10, 31, 10, 'highway').ok).toBe(true);
    city.state.departments.roads = 0;
    const rng = new Rng(1);
    for (let m = 0; m < 24; m++) updatePotholes(city.state, city.cfg, rng);
    const row = Array.from({ length: 32 }, (_, x) => city.state.potholes[10 * 32 + x]!);
    expect(row.some((p) => p > 0)).toBe(true);
  });

  it('the drag preview prices the in-line ramps an avenue or elevated highway adds', () => {
    const city = new City({ size: 64, seed: 3, water: false });
    city.state.funds = 1_000_000;
    const check = (preview: { cost: number }, build: () => { cost: number }) => {
      const before = city.state.funds;
      const r = build();
      expect(r.cost).toBe(before - city.state.funds);
      expect(preview.cost).toBe(r.cost);
      return r.cost;
    };
    city.buildNetwork(0, 30, 63, 30, 'highway');
    const tiles = 20 * city.cfg.economy.networkCost.avenue.build;
    expect(check(city.previewNetwork(20, 10, 20, 29, 'avenue'), () => city.buildNetwork(20, 10, 20, 29, 'avenue'))).toBe(tiles + city.cfg.economy.avenueRampCost);
    city.buildElevated(0, 50, 63, 50, 'highway');
    check(city.previewNetwork(40, 40, 40, 49, 'avenue'), () => city.buildNetwork(40, 40, 40, 49, 'avenue'));
    // An elevated highway drawn to an avenue's end.
    city.buildNetwork(5, 55, 5, 60, 'avenue');
    const line = city.previewLine('highway', 5, 45, 5, 54);
    expect(check(line, () => city.buildElevated(5, 45, 5, 54, 'highway'))).toBeGreaterThan(10 * city.cfg.economy.networkCost.elevatedHighway.build);
  });

  it('a level crossing keeps the one-way road’s direction, whichever was built first', () => {
    for (const order of ['rail first', 'road first'] as const) {
      const n = 32;
      const c = new City({ size: n, water: false, config: CALM });
      c.state.funds = 1e7;
      if (order === 'rail first') expect(c.buildNetwork(15, 0, 15, n - 1, 'rail').ok).toBe(true);
      expect(c.buildNetwork(0, 10, n - 1, 10, 'oneway').ok).toBe(true); // eastbound
      if (order === 'road first') expect(c.buildNetwork(15, 0, 15, n - 1, 'rail').ok).toBe(true);
      const i = 10 * n + 15;
      expect(c.state.net[i]).toBe(Net.RailCrossing);
      expect(c.state.oneway[i]).toBe(c.state.oneway[i - 1]);
      expect(carMove(c.state, i + 1, i)).toBe(false); // no driving west through it
      expect(carMove(c.state, i - 1, i)).toBe(true);
    }
  });
});
