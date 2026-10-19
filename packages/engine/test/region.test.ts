import { describe, expect, it } from 'vitest';
import { evaluateDeal } from '../src/sim/region';
import { City, loadCity, Region, saveCity } from '../src';
import { drainRegionalGrowth, exportDemand, linkedNeighbours, edgeConnections, neighbourCommute, reliefConnections, type CitySnapshot } from '../src/sim/region';
import { perType } from '../src/types';

const CALM = { safety: { fires: false }, mayor: { riots: false } } as const;

describe('connected-network sale delivery', () => {
  const sale = (id: number, edge: 0 | 1 | 2 | 3, resource: 'power' | 'water', amount: number) => ({
    id, edge, resource, direction: 'sell' as const, amount, price: 1, startDay: 0, status: 'active' as const, monthsLeft: 0,
  });

  it('keeps a healthy sale paid while a disconnected undersized generator enters grace', () => {
    const city = new City({ size: 48, water: false, config: { ...CALM, disasters: { simulated: false } } });
    city.state.funds = 1_000_000;
    city.batch(() => {
      city.placeStructure('coalPlant', 2, 2);
      city.placeStructure('windPlant', 35, 35);
      city.buildPowerLine(0, 3, 1, 3);
      expect(city.buildPowerLine(37, 35, 47, 35).ok).toBe(true);
      city.setNeighbour(0, 'developed', 10);
      city.setNeighbour(1, 'developed', 10);
    });
    city.state.neighbourDeals.push(sale(1, 0, 'power', 1_000), sale(2, 1, 'power', 1_000));
    city.state.nextDealId = 3;
    city.refresh();
    expect(city.power.supply).toBeGreaterThan(city.power.demand); // city totals conceal the eastern shortfall
    expect(city.power.demand).toBe(2_000);
    const before = saveCity(city);
    const forecast = city.budgetForecast(8);
    expect(forecast.points[0]!.neighbourIncome).toBe(1_000);
    expect(forecast.endedDeals).toEqual([2]);
    expect(saveCity(city)).toEqual(before);
    city.step(30);
    expect(city.state.neighbourDeals.map((deal) => deal.status)).toEqual(['active', 'grace']);
    expect(city.state.lastBudget!.neighbourIncome).toBe(1_000);
    city.step(30);
    expect(city.state.neighbourDeals[1]!.status).toBe('grace');
    expect(city.state.neighbourDeals[1]!.monthsLeft).toBe(5);
    expect(city.placeStructure('gasPlant', 35, 38).ok).toBe(true);
    city.step(30);
    expect(city.state.neighbourDeals[1]!.status).toBe('probation');
  });

  it('checks the physical selling pipe rather than overlapping coverage from an unrelated supplied pipe', () => {
    const city = new City({ size: 32, water: false, config: { ...CALM, disasters: { simulated: false } } });
    city.state.funds = 1_000_000;
    city.batch(() => {
      city.placeStructure('gasPlant', 10, 4);
      city.placeStructure('waterPump', 10, 10);
      city.buildPipe(2, 10, 31, 10);
      city.buildPipe(0, 12, 6, 12);
      city.setNeighbour(0, 'developed', 10);
      city.setNeighbour(1, 'developed', 10);
    });
    city.state.neighbourDeals.push(sale(1, 0, 'water', 5_000), sale(2, 1, 'water', 1_000));
    city.state.nextDealId = 3;
    city.refresh();
    const port = 12 * 32;
    expect(city.fields.pipeGrid[port]).not.toBe(city.water.networks.find((network) => network.sources.some((source) => source.kind === 'pump'))!.id);
    expect(city.water.demand).toBeGreaterThanOrEqual(6_000);
    expect(city.water.supply).toBeGreaterThan(city.water.demand);
    expect(city.budgetForecast(1).points[0]!.neighbourIncome).toBe(1_000);
    city.step(30);
    expect(city.state.neighbourDeals.map((deal) => deal.status)).toEqual(['grace', 'active']);
    expect(city.state.lastBudget!.neighbourIncome).toBe(1_000);
    expect(loadCity(saveCity(city)).budgetForecast(1).points[0]!.neighbourIncome).toBe(1_000);
  });

  it('reserves shared spare capacity once when several suspended sales ask to return', () => {
    const city = new City({ size: 32, water: false, config: { ...CALM, disasters: { simulated: false } } });
    city.state.funds = 1_000_000;
    city.batch(() => {
      city.placeStructure('windPlant', 15, 10);
      expect(city.buildPowerLine(0, 9, 31, 9).ok).toBe(true);
      city.setNeighbour(0, 'developed', 10);
      city.setNeighbour(1, 'developed', 10);
    });
    city.state.neighbourDeals.push(sale(1, 0, 'power', 120), sale(2, 1, 'power', 120));
    city.state.nextDealId = 3;
    city.refresh();
    city.step(30);
    expect(city.state.neighbourDeals.map((deal) => deal.status)).toEqual(['grace', 'grace']);
    city.step(30);
    expect(city.state.neighbourDeals.map((deal) => deal.status)).toEqual(['probation', 'grace']);
    expect(city.state.lastBudget!.neighbourIncome).toBe(120);
  });

  it('keeps annual trade repricing identical in synchronous and sliced simulation', () => {
    const config = { ...CALM, disasters: { simulated: false } };
    const city = new City({ size: 32, water: false, config });
    city.state.funds = 1_000_000;
    city.batch(() => {
      city.placeStructure('coalPlant', 2, 2);
      city.buildPowerLine(0, 3, 1, 3);
      city.setNeighbour(0, 'developed', 10);
    });
    city.state.neighbourDeals.push(sale(1, 0, 'power', 1_000));
    city.state.nextDealId = 2;
    const saved = saveCity(city), full = loadCity(saved, { config }), sliced = loadCity(saved, { config });
    full.step(390);
    sliced.beginSteps(390);
    while (sliced.resume());
    expect(saveCity(sliced)).toEqual(saveCity(full));
    expect(full.state.neighbourDeals[0]!.price).not.toBe(1);
  });
});

describe('neighbour connections', () => {
  it('reports contiguous border connections, including elevated networks, consistently with demand relief', () => {
    const city = new City({ size: 32, water: false });
    city.state.funds = 1_000_000;
    city.batch(() => {
      city.buildNetwork(0, 5, 0, 8, 'road');
      city.buildElevated(0, 16, 10, 16, 'highway');
      city.buildElevated(0, 22, 10, 22, 'elrail');
      city.buildElevated(0, 28, 10, 28, 'monorail');
    });
    expect(city.connectionsPerEdge()).toEqual({
      road: [1, 0, 0, 0], highway: [1, 0, 0, 0], rail: [1, 0, 0, 0], subway: [1, 0, 0, 0],
    });
    const counts = city.connectionsPerEdge();
    counts.road[0] = 999;
    expect(city.connectionsPerEdge().road[0]).toBe(1);
    city.buildNetwork(0, 11, 5, 11, 'road');
    expect(city.connectionsPerEdge().road[0]).toBe(2);
    city.bulldoze(0, 11, 0, 11);
    expect(city.connectionsPerEdge().road[0]).toBe(1);
  });

  it('uses current border connections in demand after a demolition and tax edit', () => {
    const city = new City({ size: 32, water: false });
    city.state.funds = 1_000_000;
    city.buildNetwork(0, 10, 10, 10, 'road');
    city.buildNetwork(22, 20, 31, 20, 'road');
    city.refresh();
    city.setNeighbour(0, 'developed');
    city.setNeighbour(1, 'developed');
    city.refresh();
    const cap = city.demand.cap['Co$$'];
    city.bulldoze(0, 10, 0, 10);
    city.setTaxRate('Co$$', 10);
    expect(city.demand.cap['Co$$']).toBeLessThan(cap);
    const immediate = city.demand.cap['Co$$'];
    city.refreshIfDirty();
    expect(city.demand.cap['Co$$']).toBe(immediate);
  });

  it('feeds imported power and water through the shared border section rather than an earlier disconnected stub', () => {
    const peer = new City({ size: 32, water: false, config: { ...CALM, disasters: { simulated: false } } });
    peer.state.funds = 1_000_000;
    peer.placeStructure('coalPlant', 24, 20);
    peer.placeStructure('waterPump', 27, 26);
    peer.buildPowerLine(28, 24, 31, 24);
    peer.buildPipe(27, 26, 31, 26);
    peer.refresh();
    const city = new City({ size: 32, water: false, config: { ...CALM, disasters: { simulated: false } } });
    city.state.funds = 1_000_000;
    city.batch(() => {
      for (const y of [3, 23]) {
        city.buildPowerLine(0, y, 4, y);
        city.buildPipe(0, y, 4, y);
        city.placeStructure('waterPump', 4, y + 1);
        city.placeStructure('medicalClinic', 4, y + 2);
      }
    });
    city.setNeighbourCity(0, peer.snapshot(), [[16, 32, { power: true, water: true, garbage: false }]]);
    expect(city.makeDeal(0, 'power', 'buy', 1_000).ok).toBe(true);
    expect(city.makeDeal(0, 'water', 'buy', 1_000).ok).toBe(true);
    city.refreshIfDirty();
    const north = city.query(4, 4)!.structure!;
    const south = city.query(4, 24)!.structure!;
    expect(north.powered).toBe(false);
    expect(south.powered).toBe(true);
    const infrastructure = city.infrastructureReport();
    expect(infrastructure.power.flatMap((network) => network.sources).filter((source) => source.kind === 'import')).toEqual([
      expect.objectContaining({ capacity: 1_000, x: 0, y: 23 }),
    ]);
    expect(infrastructure.water.flatMap((network) => network.sources).filter((source) => source.kind === 'import')).toEqual([
      expect.objectContaining({ capacity: 1_000, x: 0, y: 23 }),
    ]);
    peer.bulldozePipes(31, 26, 31, 26);
    city.setNeighbourCity(0, peer.snapshot(), [[16, 32, { power: true, water: false, garbage: false }]]);
    expect(city.infrastructureReport().water.every((network) => network.importCapacity === 0)).toBe(true);
  });

  it('counts a run of edge tiles as one connection', () => {
    const city = new City({ size: 32, water: false });
    city.state.funds = 100_000;
    city.buildNetwork(0, 10, 0, 20, 'road'); // along the west edge
    city.buildNetwork(0, 25, 10, 25, 'road'); // a second road out west
    city.buildPowerLine(31, 5, 20, 5);
    expect(edgeConnections(city.state).road[0]).toBe(2);
    expect(edgeConnections(city.state).power[1]).toBe(1);
  });

  it('counts neither a road round a corner twice nor lone stubs on the edge', () => {
    const city = new City({ size: 32, water: false });
    city.state.funds = 100_000;
    city.buildNetwork(0, 0, 6, 0, 'road'); // along the north edge from the corner
    for (let y = 8; y < 30; y += 3) city.buildNetwork(0, y, 0, y, 'road'); // lone tiles on the west edge
    const runs = edgeConnections(city.state).road;
    expect(runs).toEqual([0, 0, 1, 0]);
  });

  it('gives office relief per real neighbour, and once in all for SimNation', () => {
    const city = new City({ size: 32, water: false });
    city.state.funds = 100_000;
    for (const [x0, y0, x1, y1] of [[0, 5, 5, 5], [26, 5, 31, 5], [5, 0, 5, 5], [20, 26, 20, 31]] as const) city.buildNetwork(x0, y0, x1, y1, 'road');
    city.refresh();
    const base = city.cfg.demand.initialCaps['Co$$'];
    expect(city.demand.cap['Co$$'] - base).toBeCloseTo(40_000); // four established neighbours
    for (const e of [0, 1, 2, 3] as const) city.setNeighbour(e, 'simnation');
    city.refresh();
    expect(reliefConnections(city.state).road).toEqual([1]);
    expect(city.demand.cap['Co$$'] - base).toBeCloseTo(10_000);
  });

  it('offers no jobs beyond SimNation in strict mode', () => {
    const city = new City({ size: 32, water: false, config: { region: { simNationJobs: false } } });
    city.buildNetwork(0, 10, 31, 10, 'road');
    for (const e of [0, 1, 2, 3] as const) city.setNeighbour(e, 'simnation');
    city.refresh();
    expect(city.fields.travel!.fastest.hasSources).toBe(false);
    city.setNeighbour(0, 'established');
    city.refresh();
    expect(city.fields.travel!.fastest.hasSources).toBe(true);
  });
});

describe('neighbor deals', () => {
  function powered(): City {
    const city = new City({ size: 32, water: false, config: CALM });
    city.state.funds = 500_000;
    city.buildNetwork(0, 10, 31, 10, 'road');
    city.zone(2, 4, 29, 9, 'R-low');
    city.placeStructure('coalPlant', 2, 12);
    city.step(90);
    return city;
  }

  it('needs a developed neighbour and a power line to the edge', () => {
    const city = powered();
    expect(city.makeDeal(1, 'power', 'buy').ok).toBe(false); // established: nothing to trade
    city.setNeighbour(1, 'developed', 2);
    const res = city.makeDeal(1, 'power', 'buy');
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/power line/);
    city.buildPowerLine(31, 3, 30, 3);
    city.buildPowerLine(30, 3, 30, 4);
    expect(city.makeDeal(1, 'power', 'buy', 999).ok).toBe(false); // below the 1,000 minimum
    expect(city.makeDeal(1, 'power', 'buy', 1_000).ok).toBe(true);
    expect(city.makeDeal(1, 'power', 'buy', 1_000).ok).toBe(false); // one per resource per neighbour
  }, 30_000);

  it('a smaller deal is struck at its own price, as quoted', () => {
    const city = powered();
    city.setNeighbour(1, 'developed', 2);
    city.state.neighbours[1]!.capacity.power = 1_000_000;
    city.buildPowerLine(31, 3, 30, 3);
    city.buildPowerLine(30, 3, 30, 4);
    city.refresh();
    const offer = city.dealOffers().find((o) => o.ok && o.edge === 1 && o.resource === 'power' && o.direction === 'buy')!;
    const amount = Math.max(1_000, Math.round(offer.maxAmount / 4));
    const quoted = city.dealPriceFor(1, 'power', 'buy', amount)!;
    expect(city.makeDeal(1, 'power', 'buy', amount).ok).toBe(true);
    expect(city.state.neighbourDeals[0]!.price).toBeCloseTo(quoted, 9);
    if (amount < offer.maxAmount) expect(quoted).toBeLessThan(offer.price);
    // The month's bill as shown: Power Conservation cuts bought power 10%.
    const d = city.state.neighbourDeals[0]!;
    expect(city.dealMonthly(d)).toBeCloseTo(d.amount * d.price, 6);
    expect(city.enactOrdinance('powerConservation').ok).toBe(true);
    expect(city.dealMonthly(d)).toBeCloseTo(d.amount * d.price * 0.9, 6);
  }, 30_000);

  it('a treasury short of a year at the largest amount is offered a smaller deal it can cover', () => {
    const city = new City({ size: 32, water: false });
    city.buildPowerLine(0, 2, 10, 2);
    city.setNeighbour(0, 'developed', 2);
    const own = { capacity: 0, usage: 20_000, cost: 0.1 };
    const offer = () => evaluateDeal(city.state, city.cfg, own, 0, 'power', 'buy');
    const full = offer();
    expect(full.ok).toBe(true);
    expect(full.maxAmount).toBeGreaterThan(2_000);
    // Funds for a year of a little more than the minimum.
    city.state.funds = full.price * city.cfg.region.deals.cashMonths * (city.cfg.region.deals.minAmount + 100);
    const small = offer();
    expect(small.ok).toBe(true);
    expect(small.maxAmount).toBeLessThan(full.maxAmount);
    expect(small.maxAmount).toBeGreaterThanOrEqual(city.cfg.region.deals.minAmount);
  });

  it('a city with plants of its own may still buy up to its projected need, to spare them', () => {
    const city = new City({ size: 32, water: false });
    city.state.funds = 10_000_000;
    city.buildPowerLine(0, 2, 10, 2);
    city.setNeighbour(0, 'developed', 2);
    city.state.neighbours[0]!.capacity.power = 1_000_000;
    const own = { capacity: 30_000, usage: 20_000, cost: 0.1 }; // already 150% of its use
    const offer = evaluateDeal(city.state, city.cfg, own, 0, 'power', 'buy');
    expect(offer.ok).toBe(true);
    expect(offer.maxAmount).toBeCloseTo(city.cfg.region.deals.projectedNeed * 20_000, -1);
  });

  it('some developed neighbours run short, so a city with spare power has someone to sell to', () => {
    const city = new City({ size: 32, water: false });
    city.buildPowerLine(10, 0, 10, 8); // to the north edge
    city.buildPowerLine(0, 12, 8, 12); // and the west
    city.setNeighbour(2, 'developed', 2);
    city.setNeighbour(0, 'developed', 2);
    const own = { capacity: 100_000, usage: 20_000, cost: 0.1 };
    expect(evaluateDeal(city.state, city.cfg, own, 2, 'power', 'sell').ok).toBe(true);
    expect(evaluateDeal(city.state, city.cfg, own, 0, 'power', 'sell').ok).toBe(false); // plenty there
  });

  it('terms are set again after a year, from conditions at the time', () => {
    const city = powered();
    city.setNeighbour(1, 'developed', 2);
    city.buildPowerLine(31, 3, 30, 3);
    city.buildPowerLine(30, 3, 30, 4);
    expect(city.makeDeal(1, 'power', 'buy', 1_000).ok).toBe(true);
    const deal = city.state.neighbourDeals[0]!;
    const before = deal.price;
    city.state.neighbours[1]!.usage.power = city.state.neighbours[1]!.capacity.power * 0.95; // little to spare now
    city.step(11 * 30);
    expect(city.takeRepricedDeals()).toHaveLength(0);
    city.step(31);
    const changed = city.takeRepricedDeals();
    expect(changed).toHaveLength(1);
    expect(changed[0]!.was).toBe(before);
    expect(deal.price).toBeGreaterThan(before); // scarcer: dearer
  }, 30_000);

  it('a played neighbour must reach the shared border too', () => {
    const city = powered();
    city.buildPowerLine(31, 3, 30, 3);
    city.buildPowerLine(30, 3, 30, 4);
    const other = new City({ size: 32, seed: 2, water: false }); // no power line to its west edge
    city.setNeighbourCity(1, other.snapshot());
    const res = city.makeDeal(1, 'power', 'buy', 1_000);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/neighbour has no power line/);
    other.state.funds = 100_000;
    other.buildPowerLine(0, 3, 5, 3); // now it does (its west faces our east)
    city.setNeighbourCity(1, { ...other.snapshot(), capacity: { power: 50_000, water: 0, garbage: 0 } });
    expect(city.makeDeal(1, 'power', 'buy', 1_000).ok).toBe(true);
  }, 30_000);

  it('bought power is used before our own plants and billed monthly', () => {
    const city = powered();
    city.setNeighbour(1, 'developed', 2);
    city.buildPowerLine(31, 3, 30, 3);
    city.buildPowerLine(30, 3, 30, 4);
    city.refresh();
    const plant = [...city.state.structures.values()].find((s) => s.kind === 'coalPlant')!;
    const before = plant.load;
    expect(before).toBeGreaterThan(0);
    expect(city.makeDeal(1, 'power', 'buy', 1_000).ok).toBe(true);
    city.refresh();
    expect(plant.load).toBeLessThan(before);
    city.step(30);
    const deal = city.state.neighbourDeals[0]!;
    expect(city.state.lastBudget!.neighbourExpense).toBeCloseTo(deal.amount * deal.price);
    expect(deal.price).toBeGreaterThan(city.utility('power').cost); // dearer than our own
  }, 30_000);

  it('a cut connection starts six months of grace; fixing it gives probation', () => {
    const city = powered();
    city.setNeighbour(1, 'developed', 2);
    city.buildPowerLine(31, 3, 30, 3);
    city.buildPowerLine(30, 3, 30, 4);
    city.makeDeal(1, 'power', 'buy', 1_000);
    city.bulldoze(31, 3, 31, 3);
    city.step(30);
    expect(city.state.neighbourDeals[0]!.status).toBe('grace');
    city.buildPowerLine(31, 3, 30, 3);
    city.step(30);
    expect(city.state.neighbourDeals[0]!.status).toBe('probation');
    city.bulldoze(31, 3, 31, 3);
    city.step(30);
    expect(city.state.neighbourDeals).toHaveLength(0); // breach on probation ends it
    expect(city.takeEndedDeals()).toHaveLength(1);
  }, 30_000);

  it('sells surplus to a neighbour that needs it', () => {
    const city = powered();
    city.setNeighbour(1, 'developed', 2);
    const nb = city.state.neighbours[1]!;
    nb.capacity.power = nb.usage.power; // short of power
    city.buildPowerLine(31, 3, 30, 3);
    city.buildPowerLine(30, 3, 30, 4);
    expect(city.makeDeal(1, 'power', 'sell', 1_000).ok).toBe(true);
    city.step(30);
    expect(city.state.lastBudget!.neighbourIncome).toBeGreaterThan(0);
    const copy = loadCity(JSON.parse(JSON.stringify(saveCity(city))));
    expect(copy.state.neighbourDeals).toHaveLength(1);
    expect(copy.state.neighbours[1]!.kind).toBe('developed');
  }, 30_000);

  it('a budget forecast notices a lost power supply without advancing the deal', () => {
    const city = powered();
    city.setNeighbour(1, 'developed', 2);
    const nb = city.state.neighbours[1]!;
    nb.capacity.power = nb.usage.power;
    city.buildPowerLine(31, 3, 30, 3);
    expect(city.makeDeal(1, 'power', 'sell', 1_000).ok).toBe(true);
    city.refreshIfDirty();
    expect(city.previewBudget().neighbourIncome).toBeGreaterThan(0);
    const plant = [...city.state.structures.values()].find((st) => st.kind === 'coalPlant')!;
    expect(city.bulldoze(plant.x, plant.y, plant.x, plant.y).ok).toBe(true);
    const funds = city.state.funds;
    const deal = { ...city.state.neighbourDeals[0]! };
    expect(city.previewBudget().neighbourIncome).toBe(0);
    expect(city.state.neighbourDeals[0]).toEqual(deal);
    expect(city.state.funds).toBe(funds);
    expect(city.previewBudget().neighbourIncome).toBe(0);
  }, 30_000);
});

describe('regional demand', () => {
  it('a developed, connected neighbour pushes growth into the region that fades', () => {
    const city = new City({ size: 32, water: false, config: CALM });
    city.buildNetwork(0, 10, 31, 10, 'road');
    city.refresh();
    const before = city.demand.raw['R$'];
    city.setNeighbour(0, 'developed', 1);
    city.refresh();
    const after = city.demand.raw['R$'];
    expect(after - before).toBeCloseTo(800, 0); // 10% of 8,000 R$
    city.step(30 * 12);
    expect(city.state.neighbours[0]!.growth['R$']).toBeLessThan(800 * 0.4);
  });

  it("what gets built uses the region's growth up (once it runs out, growth stalls)", () => {
    const city = new City({ size: 32, water: false, config: CALM });
    city.buildNetwork(0, 10, 31, 10, 'road');
    city.setNeighbour(0, 'developed', 1);
    city.refresh();
    const pool = city.state.neighbours[0]!.growth['R$'];
    const k = 1 - city.cfg.region.growth.perMonth;
    drainRegionalGrowth(city.state, city.cfg, city.census, { ...perType(() => 0), 'R$': 300 });
    expect(city.state.neighbours[0]!.growth['R$']).toBeCloseTo((pool - 300) * k, 3);
    drainRegionalGrowth(city.state, city.cfg, city.census, { ...perType(() => 0), 'R$': 10_000 });
    expect(city.state.neighbours[0]!.growth['R$']).toBeCloseTo(0, 6);
  });
});

describe('regional demand pool', () => {
  const linked = () => {
    const city = new City({ size: 32, water: false, config: CALM });
    city.state.funds = 1_000_000;
    city.buildNetwork(0, 10, 31, 10, 'road'); // to the west and east edges
    city.refresh();
    return city;
  };
  const snap = (over: Partial<CitySnapshot> = {}): CitySnapshot => ({
    name: 'Bedroom', population: { ...perType(() => 0), 'R$': 20_000 },
    capacity: { power: 0, water: 0, garbage: 0 }, usage: { power: 0, water: 0, garbage: 0 }, funds: 0, ...over,
  });

  it("a played neighbour's unmet demand joins this city's", () => {
    const alone = linked();
    const base = alone.demand.raw['ID'];
    const city = linked();
    city.setNeighbourCity(0, snap({ demand: { ...perType(() => 0), ID: 3000, 'R$': -5000 } }));
    city.refresh();
    // A bedroom town's want of jobs drives industry here; its spare Sims damp
    // homes (more than its extrapolated 10% growth, 2,000 R$, adds).
    expect(city.demand.raw['ID'] - base - city.state.neighbours[0]!.growth['ID']).toBeCloseTo(3000, 0);
    expect(city.demand.raw['R$']).toBeCloseTo(alone.demand.raw['R$'] + 2000 - 5000, 0);
  });

  it('demand left unmet is tossed to inactive neighbours, up to 10% of their population', () => {
    const city = linked();
    city.setNeighbourCity(0, snap({ population: { ...perType(() => 0), 'R$': 20_000, ID: 4000 } }));
    city.step(30 * 12);
    const nb = city.state.neighbours[0]!;
    // Industry (which this city has no room for) grew there instead, up to 10% of its 4,000.
    expect(nb.absorbed!['ID']).toBeGreaterThan(0);
    expect(nb.absorbed!['ID']).toBeLessThanOrEqual(400);
    expect(nb.absorbed!['R$']).toBeLessThanOrEqual(2000);
  }, 30_000);

  it.each([[100, 100, 1, 1, 0], [100, 100, 3, 2, 1], [100, 300, 2, 1, 1], [100, 300, 8, 2, 6]])('exports one total of whole Sims across populations %s and %s (amount %s)', (west, east, amount, westShare, eastShare) => {
    const city = linked();
    city.setNeighbourCity(0, snap({ population: { ...perType(() => 0), 'R$': west } }));
    city.setNeighbourCity(1, snap({ population: { ...perType(() => 0), 'R$': east } }));
    const raw = { ...perType(() => 0), 'R$': amount / city.cfg.region.growth.exportShare };
    const sent = exportDemand(city.state, city.cfg, raw);
    expect(sent['R$']).toBe(amount);
    expect(city.state.neighbours.reduce((sum, nb) => sum + (nb.absorbed?.['R$'] ?? 0), 0)).toBe(amount);
    expect(city.state.neighbours[0]!.absorbed?.['R$'] ?? 0).toBe(westShare);
    expect(city.state.neighbours[1]!.absorbed?.['R$'] ?? 0).toBe(eastShare);
  });

  it('growth taken up there counts as built here, and wants what goes with it', () => {
    const city = linked();
    city.setNeighbourCity(0, snap());
    city.refresh();
    const before = { ...city.demand.raw };
    const wf = city.census.workforceFraction;
    city.state.neighbours[0]!.absorbed = { ...perType(() => 0), ID: 400 };
    city.refresh();
    // 400 dirty-industry jobs stand there: that much less wanted here, and R$ workers wanted for them.
    expect(city.demand.raw['ID']).toBeCloseTo(before['ID'] - 400, 3);
    expect(city.demand.raw['R$']).toBeCloseTo(before['R$'] + 400 / wf, 3);
    city.state.neighbours[0]!.absorbed = { ...perType(() => 0), 'R$': 1000 };
    city.refresh();
    expect(city.demand.raw['R$']).toBeCloseTo(before['R$'] - 1000, 3);
    expect(city.demand.raw['Cs$']).toBeGreaterThan(before['Cs$']); // their workers want jobs
  });

  it("a city's remembered commute is its trips to jobs in town, not those leaving it", () => {
    const city = new City({ size: 48, seed: 3, difficulty: 'easy', water: false, config: CALM });
    city.state.funds = 1_000_000;
    city.buildNetwork(0, 20, 47, 20, 'road'); // jobs out west and east too, 1.5 h away
    city.zone(1, 12, 46, 19, 'R-low');
    city.zone(1, 21, 46, 30, 'I-medium');
    city.placeStructure('gasPlant', 1, 33);
    city.step(360);
    const snap = city.snapshot();
    expect(city.fields.localCommute).toBeGreaterThan(0);
    expect(snap.commute).toBeLessThan(city.cfg.region.commute.established);
    // A city reloaded from the save tells its neighbours the same.
    const loaded = loadCity(JSON.parse(JSON.stringify(saveCity(city))));
    expect(loaded.fields.localCommute).toBe(city.fields.localCommute);
    expect(loaded.snapshot().commute).toBe(snap.commute);
    // All it reports at the month's end, and saved again, the same text.
    expect(loaded.snapshot()).toEqual(snap);
    expect(loaded.stats()).toEqual(city.stats());
    expect(JSON.stringify(saveCity(loaded))).toBe(JSON.stringify(saveCity(city)));
  }, 60_000);

  it('trips into a played neighbour take its remembered commute', () => {
    const city = linked();
    city.setNeighbourCity(0, snap({ commute: 35 }));
    expect(neighbourCommute(city.state, city.cfg)[0]).toBe(35);
    // Played but with no commutes recorded (no one there, or no jobs linked): a deliberately high estimate.
    city.setNeighbourCity(0, snap());
    expect(neighbourCommute(city.state, city.cfg)[0]).toBe(city.cfg.region.commute.established);
  });

  it('growth tossed to a city sprouts when it is played, and is lost if it is left first', async () => {
    const { Region } = await import('../src');
    const region = new Region({ width: 2, height: 1, citySize: 32 });
    const a = region.found(0, 0, { water: false, config: CALM });
    a.state.funds = 500_000;
    a.buildNetwork(0, 10, 31, 10, 'road');
    a.zone(1, 4, 30, 9, 'R-low');
    a.zone(1, 11, 30, 16, 'I-medium');
    a.placeStructure('coalPlant', 1, 18);
    a.step(180);
    region.close(0, 0, a);
    const b = region.found(1, 0, { water: false, config: CALM });
    b.state.funds = 500_000;
    b.buildNetwork(0, 10, 31, 10, 'road'); // reaches A
    b.zone(1, 4, 6, 9, 'R-low'); // a little room for homes, none for anything else
    b.step(120);
    const tossed = b.state.neighbours[0]!.absorbed!;
    const types = (Object.keys(tossed) as (keyof typeof tossed)[]).filter((t) => tossed[t] > 0);
    expect(types.length).toBeGreaterThan(0);
    region.close(1, 0, b);
    region.close(1, 0, b); // an autosave of the same session adds nothing more
    const again = region.open(0, 0);
    const t = types[0]!;
    expect(again.state.growthTarget[t]).toBeCloseTo(again.census.population[t] + tossed[t], -1);
    // Left before it was built: lost.
    region.close(0, 0, again);
    region.open(1, 0);
    const back = region.open(0, 0);
    expect(back.state.growthTarget[t]).toBeUndefined();
  }, 60_000);
});

describe('region of cities', () => {
  it.each([[100, 100, 1], [100, 100, 3], [100, 300, 2], [0, 0, 1]])('preserves pending growth shared by populations %s and %s (amount %s)', (north, south, amount) => {
    let region = new Region({ width: 3, height: 2, citySize: 16 });
    for (const [x, y, span] of [[0, 0, 2], [2, 0, 1], [2, 1, 1]] as const) {
      region.close(x, y, region.found(x, y, { water: false, config: CALM }, span));
    }
    const saved = region.save();
    for (const [j, population, pending] of [[1, north, 4], [2, south, 6]] as const) {
      saved.cities![j]!.snapshot.population['R$'] = population;
      saved.cities![j]!.pending = { ...perType(() => 0), 'R$': pending };
    }
    region = Region.load(saved);
    const city = region.open(0, 0, { config: CALM });
    expect(city.state.neighbours[1]!.absorbed!['R$']).toBe(10);
    city.state.neighbours[1]!.absorbed!['R$'] += amount;
    region.close(0, 0, city);
    const pending = () => region.save().cities!.slice(1).map(c => c.pending!['R$']);
    const split = pending();
    expect(split.reduce((sum, n) => sum + n, 0)).toBe(10 + amount);
    expect(split.every(Number.isInteger)).toBe(true);
    expect(split[0]).toBeGreaterThanOrEqual(4);
    expect(split[1]).toBeGreaterThanOrEqual(6);
    region.close(0, 0, city);
    expect(pending()).toEqual(split);
    const loaded = Region.load(JSON.parse(JSON.stringify(region.save())));
    expect(loaded.save()).toEqual(region.save());
  });

  it('refuses fractional cells, unsupported spans and impossible region sizes', () => {
    for (const width of [0, -1, 1.5, NaN, Infinity, 1e9]) {
      expect(() => new Region({ width })).toThrow(/region/);
    }
    for (const citySize of [0, 4, 8.5, NaN, 2048]) {
      expect(() => new Region({ citySize })).toThrow(/city size/);
    }
    const region = new Region({ width: 4, height: 4, citySize: 16 });
    for (const coordinate of [NaN, Infinity, 0.5, -1]) {
      expect(region.canFound(coordinate, 0)).toBe(false);
      expect(region.has(coordinate, 0)).toBe(false);
      expect(() => region.found(coordinate, 0)).toThrow();
    }
    for (const span of [0, -1, 1.5, 3, NaN]) {
      expect(region.canFound(0, 0, span as 1)).toBe(false);
    }
  });

  it('rejects overlapping saved cities and a replacement city of the wrong size', () => {
    const region = new Region({ width: 4, height: 4, citySize: 16 });
    const city = region.found(0, 0, { water: false }, 2);
    region.close(0, 0, city);
    const saved = region.save();
    const original = saved.cities![0]!;
    expect(() => Region.load({ ...saved, cities: [original, { ...original, x: 1 }] })).toThrow(/overlap/);
    expect(() => region.close(1, 1, new City({ size: 16, water: false }))).toThrow(/size/);
    expect(region.open(1, 1).size).toBe(32);
    expect(region.stats().cities).toBe(1);
  });

  it('region saves and restored regions own their city data and neighbour snapshots', () => {
    const region = new Region({ width: 2, height: 1, citySize: 32 });
    const city = region.found(0, 0, { water: false });
    region.close(0, 0, city);
    const saved = region.save();
    const copy = Region.load(saved);
    saved.cities![0]!.save.funds = 123;
    saved.cities![0]!.snapshot.population['R$'] = 456;
    expect(region.open(0, 0).state.funds).toBe(city.state.funds);
    expect(copy.open(0, 0).state.funds).toBe(city.state.funds);
    expect(region.snapshotAt(0, 0)!.population['R$']).toBe(0);
    expect(copy.snapshotAt(0, 0)!.population['R$']).toBe(0);
    const snapshot = region.snapshotAt(0, 0)!;
    snapshot.population['R$'] = 999;
    expect(region.snapshotAt(0, 0)!.population['R$']).toBe(0);
    const copiedSave = copy.save();
    copiedSave.cities![0]!.save.taxRates['R$'] = 20;
    expect(copy.open(0, 0).state.taxRates['R$']).toBe(city.state.taxRates['R$']);
  });

  it('a city sees its played neighbours as developed cities, empty squares as SimNation', async () => {
    const { Region } = await import('../src');
    const region = new Region({ width: 2, height: 1, citySize: 32 });
    const a = region.found(0, 0, { water: false, config: CALM });
    expect(a.state.neighbours[1]!.kind).toBe('simnation'); // nothing east yet
    a.state.funds = 500_000;
    a.buildNetwork(0, 10, 31, 10, 'road');
    a.zone(1, 4, 30, 9, 'R-low');
    a.zone(1, 11, 30, 16, 'I-medium');
    a.placeStructure('coalPlant', 1, 18);
    a.step(180);
    region.close(0, 0, a);
    const pop = region.snapshotAt(0, 0)!.population['R$'];
    expect(pop).toBeGreaterThan(0);
    const b = region.found(1, 0, { water: false, config: CALM });
    const west = b.state.neighbours[0]!;
    expect(west.kind).toBe('developed');
    expect(west.population['R$']).toBe(pop);
    expect(west.growth['R$']).toBeCloseTo(pop * 0.1);
    expect(b.state.region!.byType!['R$']).toBe(pop); // counts toward b's stage limits
    region.close(1, 0, b);
    const copy = Region.load(JSON.parse(JSON.stringify(region.save())));
    expect(copy.stats().cities).toBe(2);
    const again = copy.open(0, 0);
    expect(again.state.neighbours[1]!.kind).toBe('developed');
  }, 60_000);

  it('Neighbor Deals are mirrored into the partner city', async () => {
    const { Region } = await import('../src');
    const region = new Region({ width: 2, height: 1, citySize: 32 });
    const a = region.found(0, 0, { water: false, config: CALM });
    a.state.funds = 500_000;
    a.placeStructure('coalPlant', 1, 18);
    a.buildPowerLine(5, 19, 31, 19); // to the east edge
    a.step(30);
    region.close(0, 0, a);
    const b = region.found(1, 0, { water: false, config: CALM });
    b.state.funds = 500_000;
    b.buildPowerLine(0, 19, 5, 19); // from the west edge
    b.refresh();
    expect(b.makeDeal(0, 'power', 'buy', 1_000).ok).toBe(true);
    const terms = b.state.neighbourDeals[0]!;
    region.close(1, 0, b);
    // The seller now has the other side of the deal, and is paid for it.
    const seller = region.open(0, 0);
    const deal = seller.state.neighbourDeals[0]!;
    expect(deal).toMatchObject({ edge: 1, direction: 'sell', resource: 'power', amount: 1_000, price: terms.price });
    seller.step(30);
    expect(seller.state.lastBudget!.neighbourIncome).toBeCloseTo(1_000 * terms.price);
    // Cancelling it here ends it for the buyer too.
    seller.cancelDeal(deal.id);
    region.close(0, 0, seller);
    expect(region.open(1, 0).state.neighbourDeals).toHaveLength(0);
  }, 60_000);

  it('only connections on the stretch of border two cities share join them', async () => {
    const { Region } = await import('../src');
    const region = new Region({ width: 3, height: 2, citySize: 32 });
    // A medium city (2×2 squares) beside a small one that borders only its top half.
    const a = region.found(0, 0, { water: false, config: CALM }, 2);
    a.state.funds = 500_000;
    a.placeStructure('coalPlant', 1, 40);
    a.buildPowerLine(5, 50, 63, 50); // reaches the east edge where the empty square is
    a.step(30);
    region.close(0, 0, a);
    const b = region.found(2, 0, { water: false, config: CALM });
    b.state.funds = 500_000;
    b.buildPowerLine(0, 19, 5, 19);
    b.refresh();
    expect(b.makeDeal(0, 'power', 'buy', 1_000).ok).toBe(false);
    expect(b.state.neighbours[0]!.connected!.power).toBe(false);
    region.close(2, 0, b);
    // Seen from the medium city: B's line meets its edge at rows 0–31, A's own line doesn't.
    const a2 = region.open(0, 0);
    expect(a2.state.neighbours[1]!.shared).toEqual([[0, 32, { power: true, water: false, garbage: false }]]);
    expect(a2.dealOffers().find((o) => o.edge === 1 && o.resource === 'power' && o.direction === 'sell')!.ok).toBe(false);
    a2.buildPowerLine(40, 50, 40, 19);
    a2.buildPowerLine(40, 19, 63, 19); // now it reaches the shared stretch
    a2.step(30);
    region.close(0, 0, a2);
    const b2 = region.open(2, 0);
    expect(b2.state.neighbours[0]!.connected!.power).toBe(true);
    expect(b2.makeDeal(0, 'power', 'buy', 1_000).ok).toBe(true);
  }, 60_000);

  it('with several cities on one edge, both connections must meet on the same stretch', async () => {
    const { Region } = await import('../src');
    const { hasDealConnection } = await import('../src/sim/region');
    const region = new Region({ width: 3, height: 2, citySize: 32 });
    const a = region.found(0, 0, { water: false, config: CALM }, 2);
    a.state.funds = 500_000;
    a.placeStructure('coalPlant', 1, 40);
    a.buildPowerLine(5, 45, 5, 10);
    a.buildPowerLine(5, 10, 63, 10); // faces B (rows 0–31)
    a.step(30);
    region.close(0, 0, a);
    const b = region.found(2, 0, { water: false, config: CALM }); // nothing to the border
    region.close(2, 0, b);
    const c = region.found(2, 1, { water: false, config: CALM });
    c.buildPowerLine(0, 5, 10, 5); // faces A's rows 32–63
    c.refresh();
    expect(c.state.neighbours[0]!.connected!.power).toBe(false);
    region.close(2, 1, c);
    const a2 = region.open(0, 0);
    expect(hasDealConnection(a2.state, 1, 'power')).toBe(false); // A meets B, C meets A: no line meets a line
  }, 60_000);

  it('a mirrored deal takes the partner deal counter, and leaves earlier region saves alone', async () => {
    const { Region } = await import('../src');
    const region = new Region({ width: 2, height: 1, citySize: 32 });
    const a = region.found(0, 0, { water: false, config: CALM });
    a.state.funds = 500_000;
    a.placeStructure('coalPlant', 1, 18);
    a.buildPowerLine(5, 19, 31, 19);
    a.step(30);
    region.close(0, 0, a);
    const b = region.found(1, 0, { water: false, config: CALM });
    b.state.funds = 500_000;
    b.buildPowerLine(0, 19, 5, 19);
    b.refresh();
    expect(b.makeDeal(0, 'power', 'buy', 1_000).ok).toBe(true);
    const before = region.save();
    const kept = JSON.stringify(before.cities![0]!.save);
    region.close(1, 0, b);
    expect(JSON.stringify(before.cities![0]!.save)).toBe(kept); // an earlier save is a snapshot
    const seller = region.open(0, 0);
    const mirrored = seller.state.neighbourDeals[0]!;
    // A new deal of the seller's own gets a different id; cancelling one leaves the other.
    expect(seller.state.nextDealId).toBeGreaterThan(mirrored.id);
    seller.state.neighbourDeals.push({ ...mirrored, id: seller.state.nextDealId++, edge: 0 });
    seller.cancelDeal(mirrored.id);
    expect(seller.state.neighbourDeals).toHaveLength(1);
  }, 60_000);

  it('a square can be founded once until its city is closed', async () => {
    const { Region } = await import('../src');
    const region = new Region({ width: 1, height: 1, citySize: 16 });
    region.found(0, 0, { water: false });
    expect(region.canFound(0, 0)).toBe(false);
    expect(() => region.found(0, 0, { water: false })).toThrow();
  });
});

describe('cities of different sizes (config bitmap)', () => {
  it('a medium city covers 2×2 cells and sees the small cities along an edge as one neighbour', async () => {
    const { Region } = await import('../src');
    const region = new Region({ width: 3, height: 2, citySize: 16 });
    // Two small cities stacked in the left column, a medium city to their east.
    for (const y of [0, 1]) {
      const c = region.found(0, y, { water: false, config: CALM });
      c.state.funds = 100_000;
      c.buildNetwork(0, 8, 15, 8, 'road');
      c.zone(1, 2, 14, 7, 'R-low');
      c.placeStructure('coalPlant', 1, 10);
      c.step(120);
      region.close(0, y, c);
    }
    expect(region.canFound(1, 0, 2)).toBe(true);
    expect(region.canFound(2, 0, 2)).toBe(false); // runs off the region
    const big = region.found(1, 0, { water: false, config: CALM }, 2);
    expect(big.size).toBe(32);
    const west = big.state.neighbours[0]!;
    expect(west.kind).toBe('developed');
    const a = region.snapshotAt(0, 0)!.population['R$'];
    const b = region.snapshotAt(0, 1)!.population['R$'];
    expect(west.population['R$']).toBe(a + b);
    expect(big.state.neighbours[1]!.kind).toBe('simnation'); // nothing east
    region.close(1, 0, big);
    expect(region.footprintAt(2, 1)).toEqual({ x: 1, y: 0, span: 2 });
    // Any cell of the medium city opens it; saves keep the layout.
    const copy = Region.load(JSON.parse(JSON.stringify(region.save())));
    expect(copy.open(2, 1).size).toBe(32);
    expect(copy.stats().cities).toBe(3);
    // The small city sees the medium one to its east.
    expect(copy.open(0, 1).state.neighbours[1]!.kind).toBe('developed');
  }, 60_000);

  it('random layouts of mixed sizes keep every cell owned by one city, through saves', async () => {
    const { Region } = await import('../src');
    const { Rng } = await import('../src/rng');
    const rng = new Rng(11);
    const region = new Region({ width: 6, height: 5, citySize: 8 });
    const placed: { x: number; y: number; span: 1 | 2 | 4 }[] = [];
    for (let k = 0; k < 40; k++) {
      const span = ([1, 2, 4] as const)[rng.int(3)]!;
      const x = rng.int(6);
      const y = rng.int(5);
      if (!region.canFound(x, y, span)) continue;
      const c = region.found(x, y, { water: false }, span);
      expect(c.size).toBe(8 * span);
      region.close(x, y, c);
      placed.push({ x, y, span });
    }
    expect(placed.length).toBeGreaterThan(3);
    const check = (r: InstanceType<typeof Region>) => {
      for (let y = 0; y < 5; y++) for (let x = 0; x < 6; x++) {
        const mine = placed.find((p) => x >= p.x && y >= p.y && x < p.x + p.span && y < p.y + p.span);
        expect(r.footprintAt(x, y)).toEqual(mine ? { x: mine.x, y: mine.y, span: mine.span } : null);
      }
      expect(r.stats().cities).toBe(placed.length);
    };
    check(region);
    check(Region.load(JSON.parse(JSON.stringify(region.save()))));
  }, 60_000);

  it('a city founded and given up unsaved frees its cells', () => {
    const region = new Region({ width: 2, height: 1, citySize: 16 });
    region.close(0, 0, region.found(0, 0, { water: false, config: CALM }));
    region.found(1, 0, { water: false, config: CALM }); // never saved
    region.open(0, 0);
    expect(region.canFound(1, 0)).toBe(true);
  }, 60_000);

  it('a big city lined by several small ones holds no deals across that border', async () => {
    const { Region } = await import('../src');
    const region = new Region({ width: 3, height: 2, citySize: 16 });
    for (const y of [0, 1]) region.close(0, y, region.found(0, y, { water: false, config: CALM }));
    const big = region.found(1, 0, { water: false, config: CALM }, 2);
    big.state.neighbourDeals.push(
      { id: 900, edge: 0, resource: 'power', direction: 'sell', amount: 1_000, price: 0.05, startDay: 0, status: 'active', monthsLeft: 0 },
      { id: 901, edge: 0, resource: 'water', direction: 'sell', amount: 1_000, price: 0.02, startDay: 0, status: 'active', monthsLeft: 0 },
    );
    region.close(1, 0, big);
    // A small neighbour on that edge closes: it writes no deals into the big city's save. And deals
    // across that border couldn't be kept on both sides (each small city sees only itself), so the
    // big city's end when it opens, as they do in each small city.
    region.close(0, 0, region.open(0, 0));
    expect(region.open(1, 0).state.neighbourDeals).toEqual([]);
  }, 60_000);

  it('old one-size region saves still load', async () => {
    const { Region, City, saveCity } = await import('../src');
    const c = new City({ size: 16, water: false });
    const legacy = {
      format: 'web-city-region' as const, version: 1 as const, name: 'Old', width: 2, height: 1, citySize: 16,
      squares: [{ save: saveCity(c), snapshot: c.snapshot() }, null],
    };
    const region = Region.load(legacy);
    expect(region.has(0, 0)).toBe(true);
    expect(region.has(1, 0)).toBe(false);
    expect(region.open(0, 0).size).toBe(16);
  });
});

describe('regional rewards', () => {
  it('in a region, the Resort Hotel looks at the whole region', async () => {
    const { unlockMet } = await import('../src/sim/rewards');
    const city = new City({ size: 32, water: false });
    const u = city.cfg.structures.resortHotel.unlock!;
    const ctx = { s: city.state, cfg: city.cfg, census: city.census, powerDemand: 0, hospitals: 0, connections: 0 };
    city.state.mayorRating = 60;
    city.state.region = { cities: 3, population: 120_000, highWealth: 49_000 };
    city.census.population['R$$'] = 500;
    expect(unlockMet(ctx, u)).toBe(false);
    city.census.population['R$$'] = 1_500;
    expect(unlockMet(ctx, u)).toBe(true); // 49,000 + 1,500 in a region of four cities
    city.state.region.cities = 2;
    expect(unlockMet(ctx, u)).toBe(false);
  });
});

describe('regional growth across sessions', () => {
  it('stays used up when a city is reopened, until a neighbour is played again', () => {
    const calm = { safety: { fires: false }, mayor: { riots: false } } as const;
    const region = new Region({ width: 2, height: 1, citySize: 32 });
    const a = region.found(0, 0, { water: false, config: calm });
    a.state.funds = 500_000;
    a.buildNetwork(0, 10, 31, 10, 'road');
    a.zone(1, 4, 30, 9, 'R-low');
    a.zone(1, 11, 30, 16, 'I-medium');
    a.placeStructure('coalPlant', 1, 18);
    a.step(180);
    region.close(0, 0, a);
    let b = region.found(1, 0, { water: false, config: calm });
    b.state.funds = 500_000;
    b.buildNetwork(0, 10, 31, 10, 'road');
    b.refresh();
    const growth = () => Object.values(b.state.neighbours[0]!.growth).reduce((x, y) => x + y, 0);
    const fresh = growth();
    b.step(720);
    const drained = growth();
    expect(drained).toBeLessThan(fresh * 0.5);
    region.close(1, 0, b);
    b = region.open(1, 0); // nothing else played in between
    expect(growth()).toBeCloseTo(drained, 6);
    // Play the neighbour and save it: its growth is extrapolated afresh.
    region.close(1, 0, b);
    region.close(0, 0, region.open(0, 0));
    b = region.open(1, 0);
    expect(growth()).toBeGreaterThan(drained * 2);
  }, 60_000);
});

describe('regional deals', () => {
  it('a road facing an empty square links to no city beside it', () => {
    const region = new Region({ width: 3, height: 2, citySize: 32 });
    const b = region.found(2, 0, { water: false, config: CALM });
    b.state.funds = 500_000;
    b.buildNetwork(0, 10, 31, 10, 'road');
    b.zone(1, 4, 30, 9, 'R-low');
    b.placeStructure('coalPlant', 2, 11);
    b.step(90);
    region.close(2, 0, b);
    const a = region.found(0, 0, { water: false, config: CALM }, 2);
    a.state.funds = 500_000;
    a.buildNetwork(20, 50, 63, 50, 'road'); // leaves east at row 50: the empty square below B
    a.refresh();
    expect(a.state.neighbours[1]!.kind).toBe('developed');
    expect(linkedNeighbours(a.state)).toHaveLength(0);
    a.buildNetwork(40, 20, 63, 20, 'road'); // row 20 faces B
    a.refresh();
    expect(linkedNeighbours(a.state).map((nb) => nb.edge)).toEqual([1]);
  }, 60_000);

  it('offers no deal across a border several cities share (it couldn\'t be kept on both sides)', () => {
    const region = new Region({ width: 3, height: 2, citySize: 32 });
    const a = region.found(0, 0, { water: false, config: CALM }, 2);
    a.state.funds = 500_000;
    a.placeStructure('coalPlant', 1, 18);
    a.buildPowerLine(5, 19, 63, 19);
    a.step(30);
    region.close(0, 0, a);
    region.close(2, 1, region.found(2, 1, { water: false, config: CALM })); // a second small city on A's east edge
    const b = region.found(2, 0, { water: false, config: CALM });
    b.state.funds = 500_000;
    b.buildPowerLine(0, 19, 5, 19);
    b.refresh();
    const r = b.makeDeal(0, 'power', 'buy', 1_000);
    expect(r.ok).toBe(false);
    expect(r.message).toBe('several cities share this border');
  }, 60_000);

  it('a city\'s surplus is not sold twice to two neighbours', () => {
    const region = new Region({ width: 3, height: 1, citySize: 32 });
    const a = region.found(1, 0, { water: false, config: CALM });
    a.state.funds = 500_000;
    a.buildNetwork(0, 10, 31, 10, 'road');
    a.zone(1, 1, 30, 9, 'R-medium');
    a.zone(8, 11, 30, 16, 'I-medium');
    a.placeStructure('gasPlant', 2, 11);
    a.buildPowerLine(0, 21, 31, 21);
    a.buildPowerLine(4, 15, 4, 21);
    a.step(240);
    const own = a.utility('power');
    const surplus = own.capacity - own.usage;
    region.close(1, 0, a);
    let bought = 0;
    for (const [x, edge] of [[0, 1], [2, 0]] as const) {
      const c = region.found(x, 0, { water: false, config: CALM });
      c.state.funds = 5_000_000;
      c.buildNetwork(0, 10, 31, 10, 'road');
      c.zone(1, 1, 30, 9, 'R-medium');
      c.placeStructure('coalPlant', 2, 11);
      c.step(120);
      if (edge === 1) c.buildPowerLine(31, 21, 20, 21);
      else c.buildPowerLine(0, 21, 10, 21);
      c.refresh();
      const offer = c.dealOffers().find((o) => o.edge === edge && o.resource === 'power' && o.direction === 'buy')!;
      if (offer.ok && c.makeDeal(edge, 'power', 'buy', offer.maxAmount).ok) bought += offer.maxAmount;
      region.close(x, 0, c);
    }
    expect(bought).toBeGreaterThan(0);
    expect(bought).toBeLessThanOrEqual(surplus);
  }, 120_000);
});

