import { describe, expect, it } from 'vitest';
import { City, saveCity } from '../src';

const calm = { safety: { fires: false }, disasters: { simulated: false }, mayor: { riots: false } };
function utilityTown(): City {
  const city = new City({ size: 32, water: false, config: calm });
  city.state.funds = 1_000_000;
  city.cfg.structures.coalPlant.powerUse = 1_000;
  city.batch(() => {
    city.placeStructure('coalPlant', 2, 2);
    city.placeStructure('gasPlant', 8, 2);
    city.placeStructure('waterPump', 8, 8);
    city.buildPipe(8, 8, 20, 8);
    city.buildPowerLine(0, 3, 1, 3);
  });
  return city;
}

describe('utility resilience', () => {
  it('distinguishes capacity headroom from surviving loss of the largest source', () => {
    const city = utilityTown();
    const initial = city.infrastructureReport();
    expect(initial.power).toHaveLength(1);
    expect(initial.power[0]).toMatchObject({ status: 'secure', supply: 9_000, demand: 1_003, contingencySupply: 3_000, contingencyShortfall: 0 });
    expect(initial.water[0]).toMatchObject({ status: 'fragile', supply: 20_000, contingencySupply: 0 });
    expect(initial.water[0]!.contingencyShortfall).toBe(initial.water[0]!.demand);
    const gas = [...city.state.structures.values()].find((st) => st.kind === 'gasPlant')!;
    city.bulldoze(gas.x, gas.y, gas.x, gas.y);
    const single = city.infrastructureReport().power[0]!;
    expect(single.reserve).toBeGreaterThan(single.demand * 4);
    expect(single.status).toBe('fragile');
    expect(single.contingencySupply).toBe(0);
    expect(single.largestSource!.kind).toBe('plant');
    expect(city.placeStructure('waterPump', 12, 8).ok).toBe(true);
    expect(city.infrastructureReport().water[0]!.status).toBe('secure');
  });

  it('does not let disconnected surplus hide a shortage and treats an imported contract as a supply source', () => {
    const city = utilityTown();
    city.cfg.structures.windPlant.powerUse = 1_000;
    expect(city.placeStructure('windPlant', 27, 27).ok).toBe(true);
    const report = city.infrastructureReport();
    const weak = report.power.find((network) => network.status === 'shortage')!;
    expect(weak).toBeDefined();
    expect(weak.supply).toBe(200);
    expect(weak.demand).toBe(1_000);
    expect(weak.reserve).toBe(-800);
    expect(report.power.reduce((total, network) => total + network.reserve, 0)).toBeGreaterThan(0);
    city.state.neighbourDeals.push({ id: 1, edge: 0, resource: 'power', direction: 'buy', amount: 10_000, price: 0.1,
      startDay: 0, status: 'active', monthsLeft: 0 });
    city.refresh();
    const importing = city.infrastructureReport().power.find((network) => network.importCapacity > 0)!;
    expect(importing.sources.filter((source) => source.kind === 'import')).toHaveLength(1);
    expect(importing.largestSource).toMatchObject({ kind: 'import', capacity: 10_000, edge: 0 });
    expect(importing.contingencySupply).toBe(9_000);
  });

  it('keeps consumer assignment on supplied coverage when a nearer sourceless pipe overlaps it', () => {
    const city = utilityTown();
    city.buildNetwork(0, 16, 31, 16, 'road');
    city.zone(10, 11, 18, 15, 'R-low', { autoStreets: false });
    city.zone(10, 17, 18, 20, 'I-medium', { autoStreets: false });
    city.buildPowerLine(16, 8, 16, 10);
    city.step(90);
    const home = [...city.state.buildings.values()].find((b) => b.type?.[0] === 'R' && b.watered)!;
    expect(home).toBeDefined();
    city.buildPipe(home.x, home.y, home.x, home.y);
    const report = city.infrastructureReport();
    expect(home.watered).toBe(true);
    const served = report.water.find((network) => network.sources.some((source) => source.kind === 'pump'))!;
    expect(served.buildings).toBeGreaterThan(0);
    expect(served.residents).toBeGreaterThanOrEqual(home.capacity * home.occupancy);
  });

  it('returns independent snapshots, exact citywide repair quotes and capital needs at the current wear rate', () => {
    const city = utilityTown();
    const plant = [...city.state.structures.values()].find((st) => st.kind === 'coalPlant')!;
    plant.life = 99.999;
    city.state.lineWear[3 * 32] = 80;
    city.state.pipeWear[8 * 32 + 9] = 100;
    city.refresh();
    const before = saveCity(city);
    const report = city.infrastructureReport();
    expect(report.dueAssets).toBe(1);
    expect(report.capitalNeeded).toBe(city.refurbishStructure(plant.id, true).cost);
    for (const dept of ['roads', 'water', 'power', 'transit'] as const) {
      const quote = city.previewRepairNetworks(dept, 0, 0, 31, 31);
      expect(report.repairs[dept]).toEqual({ cost: quote.cost, tiles: quote.tiles });
    }
    report.assets[0]!.life = 0;
    report.assets[0]!.refurbishment.cost = 0;
    report.power[0]!.sources[0]!.capacity = 0;
    report.water[0]!.sources[0]!.capacity = 0;
    report.power[0]!.largestSource!.capacity = 0;
    expect(saveCity(city)).toEqual(before);
    expect(city.infrastructureReport().power[0]!.sources[0]!.capacity).toBeGreaterThan(0);
  });

  it('reports stopped pumps as shortages, rather than spare supply, and omits empty unsourced stubs', () => {
    const city = utilityTown();
    city.buildPipe(27, 25, 29, 25);
    expect(city.infrastructureReport().water).toHaveLength(1);
    city.setDepartmentFunding('water', 0);
    const water = city.infrastructureReport().water[0]!;
    expect(water.status).toBe('shortage');
    expect(water.sources).toHaveLength(0);
    expect(water.largestSource).toBeNull();
    expect(water.contingencyShortfall).toBe(water.demand);
  });
});
