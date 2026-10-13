import { describe, expect, it } from 'vitest';
import { City, loadCity, saveCity, type PowerDispatch } from '../src';

const calm = { safety: { fires: false }, disasters: { simulated: false }, mayor: { riots: false } };
function grid(): City {
  const city = new City({ size: 32, water: false, config: calm });
  city.state.funds = 1_000_000;
  city.cfg.structures.coalPlant.powerUse = 1_000;
  city.batch(() => {
    city.buildNetwork(1, 1, 20, 1, 'road');
    city.placeStructure('coalPlant', 2, 2);
    city.placeStructure('gasPlant', 8, 2);
  });
  return city;
}

describe('power operation', () => {
  it('lets the player trade generation cost for lower pollution at the same supplied demand', () => {
    const city = grid();
    const before = saveCity(city);
    const balanced = city.energyReport()!;
    const clean = city.energyReport('clean')!;
    const economical = city.energyReport('economical')!;
    expect(saveCity(city)).toEqual(before);
    for (const report of [balanced, clean, economical]) {
      expect(report.generation).toBeCloseTo(1_000, 8);
      expect(report.supply).toBe(9_000);
      expect(report.plants.every((p) => p.generation >= 0 && p.generation <= p.capacity)).toBe(true);
    }
    const coal = (r: typeof clean) => r.plants.find((p) => p.kind === 'coalPlant')!;
    expect(coal(clean).generation).toBe(0);
    expect(coal(economical).generation).toBe(1_000);
    expect(coal(balanced).generation).toBeCloseTo(2_000 / 3, 8);
    expect(clean.generationCost).toBeGreaterThan(balanced.generationCost);
    expect(economical.generationCost).toBeLessThan(balanced.generationCost);
    expect(coal(clean).air).toBeLessThan(coal(balanced).air);
    const air = () => city.fields.air.reduce((total, value) => total + value, 0);
    const beforeAir = air();
    expect(city.setPowerDispatch('clean')).toEqual({ ok: true, cost: 0 });
    expect(city.energyReport()).toEqual(clean);
    expect(air()).toBeLessThan(beforeAir);
    expect(city.setPowerDispatch('economical').ok).toBe(true);
    expect(city.energyReport()).toEqual(economical);
  });

  it('keeps imports and waste generation ahead of thermal generation without counting energy twice', () => {
    const city = grid();
    expect(city.buildPowerLine(0, 3, 1, 3).ok).toBe(true);
    expect(city.placeStructure('wasteToEnergyPlant', 14, 2).ok).toBe(true);
    const waste = [...city.state.structures.values()].find((st) => st.kind === 'wasteToEnergyPlant')!;
    waste.load = 30; // 300 MWh already produced from waste
    waste.capacity = 500;
    city.state.neighbourDeals.push({ id: 1, edge: 0, resource: 'power', direction: 'buy', amount: 400, price: 0.1,
      startDay: 0, status: 'active', monthsLeft: 0 });
    city.refresh();
    for (const strategy of ['balanced', 'clean', 'economical'] as const) {
      const report = city.energyReport(strategy)!;
      expect(report.imported).toBe(400);
      expect(report.wasteGeneration).toBe(300);
      expect(report.generation + report.imported + report.wasteUsed).toBeCloseTo(report.demand, 8);
      city.setPowerDispatch(strategy);
      const actual = [...city.state.structures.values()].filter((st) => city.cfg.structures[st.kind].plant).reduce((total, st) => total + st.load, 0);
      expect(actual).toBeCloseTo(report.generation, 8);
    }
    waste.load = 200; // waste alone now exceeds the grid's remaining demand
    city.refresh();
    expect(city.energyReport()!.generation).toBe(0);
    expect(city.energyReport()!.wasteGeneration).toBe(2_000);
    expect(city.energyReport()!.wasteUsed).toBe(city.energyReport()!.demand - 400);
    expect(city.energyReport()!.curtailed).toBe(2_000 - city.energyReport()!.wasteUsed);
  });

  it('dispatches independently on disconnected grids, including an overloaded one', () => {
    const city = new City({ size: 48, water: false, config: calm });
    city.state.funds = 1_000_000;
    city.cfg.structures.coalPlant.powerUse = 1_000;
    city.cfg.structures.gasPlant.powerUse = 4_000;
    city.placeStructure('coalPlant', 2, 2);
    city.placeStructure('gasPlant', 35, 35);
    city.setPowerDispatch('economical');
    const report = city.energyReport()!;
    const coal = report.plants.find((p) => p.kind === 'coalPlant')!;
    const gas = report.plants.find((p) => p.kind === 'gasPlant')!;
    expect(coal.grid).not.toBe(gas.grid);
    expect(coal.generation).toBe(1_000);
    expect(gas.generation).toBe(gas.capacity);
    expect(gas.utilisation).toBe(1);
    expect(report.generation).toBeLessThan(report.demand);
  });

  it('charges maintenance by funding and fuel by generation, with no free fuel at zero maintenance funding', () => {
    const city = new City({ size: 24, water: false, config: calm });
    city.state.funds = 1_000_000;
    city.cfg.structures.coalPlant.powerUse = 3_000;
    city.placeStructure('coalPlant', 2, 2);
    const plant = [...city.state.structures.values()][0]!;
    const full = city.energyReport()!;
    expect(full.maintenanceCost).toBe(162.5);
    expect(full.generationCost).toBe(43.75);
    expect(city.structureUpkeep(plant.id)!.running).toBe(206.25);
    city.setFunding(plant.id, 0);
    const unfunded = city.energyReport()!;
    expect(unfunded.maintenanceCost).toBe(0);
    expect(unfunded.generationCost).toBe(43.75);
    expect(city.structureUpkeep(plant.id)!.running).toBe(43.75);
    expect(city.utility('power').cost).toBeCloseTo(43.75 / plant.capacity, 10);
  });

  it('uses actual generation and age-related upkeep when quoting local utility costs', () => {
    const city = grid();
    const cost = () => {
      const energy = city.energyReport()!;
      return (energy.maintenanceCost + energy.generationCost) / city.utility('power').capacity;
    };
    expect(city.utility('power').cost).toBeCloseTo(cost(), 10);
    const balanced = city.utility('power').cost;
    city.setPowerDispatch('clean');
    expect(city.utility('power').cost).toBeCloseTo(cost(), 10);
    expect(city.utility('power').cost).toBeGreaterThan(balanced);
    const coal = [...city.state.structures.values()].find((st) => st.kind === 'coalPlant')!;
    coal.life = 80;
    city.refresh();
    expect(city.utility('power').cost).toBeCloseTo(cost(), 10);
  });

  it('prioritises renewable generation with zero generation cost and deterministic equal-cost ties', () => {
    const city = grid();
    city.placeStructure('windPlant', 14, 2);
    city.placeStructure('windPlant', 17, 2);
    const report = city.energyReport('economical')!;
    const wind = report.plants.filter((p) => p.kind === 'windPlant');
    expect(wind.map((p) => p.generation)).toEqual([200, 200]);
    expect(wind.every((p) => p.generationCost === 0)).toBe(true);
    city.cfg.structures.coalPlant.powerUse = 100;
    city.refresh();
    const partial = city.energyReport('economical')!.plants.filter((p) => p.kind === 'windPlant');
    expect(partial.map((p) => p.generation)).toEqual([100, 0]);
  });

  it('ages heavily dispatched machinery faster than machines held in reserve', () => {
    const city = grid();
    city.setPowerDispatch('clean');
    city.step(360);
    const coal = [...city.state.structures.values()].find((st) => st.kind === 'coalPlant')!;
    const gas = [...city.state.structures.values()].find((st) => st.kind === 'gasPlant')!;
    expect(gas.life).toBeGreaterThan(coal.life);
    expect(coal.life).toBeGreaterThan(0); // standby still ages
  });

  it('bounds waste electricity by funded processing capacity immediately, including a zero-budget shutdown', () => {
    const city = grid();
    city.placeStructure('wasteToEnergyPlant', 14, 2);
    const waste = [...city.state.structures.values()].find((st) => st.kind === 'wasteToEnergyPlant')!;
    waste.load = 500;
    city.refresh();
    expect(city.energyReport()!.wasteGeneration).toBe(5_000);
    city.setDepartmentFunding('sanitation', 50);
    city.refreshIfDirty();
    expect(city.energyReport()!.wasteGeneration).toBe(2_500);
    expect(city.utility('power').capacity).toBe(11_500);
    city.setDepartmentFunding('sanitation', 0);
    city.refreshIfDirty();
    expect(city.energyReport()!.wasteGeneration).toBe(0);
    expect(city.utility('power').capacity).toBe(9_000);
    expect(city.infrastructureReport().power[0]!.sources.some((source) => source.kind === 'incinerator')).toBe(false);
  });

  it('preserves policies and deterministic outcomes across save/load and defaults old saves to balanced', () => {
    const city = grid();
    city.setPowerDispatch('clean');
    city.step(60);
    const saved = saveCity(city);
    const loaded = loadCity(saved, { config: { ...calm, structures: { coalPlant: { powerUse: 1_000 } } } });
    expect(loaded.energyReport()).toEqual(city.energyReport());
    city.step(60);
    loaded.step(60);
    expect(saveCity(loaded)).toEqual(saveCity(city));
    delete saved.powerDispatch;
    expect(loadCity(saved).state.powerDispatch).toBe('balanced');
    expect(() => loadCity({ ...saved, powerDispatch: 'invalid' as PowerDispatch })).toThrow('bad power dispatch');
    const before = saveCity(city);
    expect(city.setPowerDispatch('invalid' as PowerDispatch).ok).toBe(false);
    expect(city.energyReport('invalid' as PowerDispatch)).toBeNull();
    expect(saveCity(city)).toEqual(before);
  });
});
