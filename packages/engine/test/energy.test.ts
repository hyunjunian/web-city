import { describe, expect, it } from 'vitest';
import { City, loadCity, saveCity, utilityEmissionShare } from '../src';
import { createFields } from '../src/sim/fields';
import { computePower, computeWater } from '../src/sim/services';

const calm = { safety: { fires: false }, disasters: { simulated: false }, mayor: { riots: false } };
const config = { ...calm, structures: { coalPlant: { powerUse: 1_000 } } };
function grid(): City {
  const city = new City({ size: 32, water: false, config });
  city.state.funds = 1_000_000;
  city.batch(() => {
    city.buildNetwork(1, 1, 20, 1, 'road');
    city.placeStructure('coalPlant', 2, 2);
    city.placeStructure('gasPlant', 8, 2);
  });
  return city;
}

describe('power generation', () => {
  it('rebuilds changed grids after water-network work without retaining old traversal entries', () => {
    const city = new City({ size: 64, water: false, config });
    city.state.funds = 1_000_000;
    city.placeStructure('coalPlant', 2, 2);
    city.placeStructure('coalPlant', 48, 48);
    const reused = createFields(64);
    for (let turn = 0; turn < 4; turn++) {
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        city.state.power[y * 64 + x] = turn === 0 || (turn === 1 ? x % 5 === 0 : turn === 2 && (x < 8 || x > 48)) ? 1 : 0;
      }
      city.state.pipe.fill(turn % 2);
      computeWater(city.state, reused, city.cfg);
      const actual = computePower(city.state, reused, city.cfg);
      const fresh = createFields(64);
      expect(actual).toEqual(computePower(city.state, fresh, city.cfg));
      expect(reused.powerGrid).toEqual(fresh.powerGrid);
      expect(reused.powered).toEqual(fresh.powered);
    }
  });

  it('shares a connected grid load in proportion to available capacity', () => {
    const city = grid();
    const plants = [...city.state.structures.values()];
    const coal = plants.find((st) => st.kind === 'coalPlant')!;
    const gas = plants.find((st) => st.kind === 'gasPlant')!;
    expect(coal.load).toBeCloseTo(2_000 / 3, 8);
    expect(gas.load).toBeCloseTo(1_000 / 3, 8);
    expect(coal.effectiveness).toBeCloseTo(gas.effectiveness, 10);
  });

  it('uses imports and waste energy before ordinary generation without counting them twice', () => {
    const city = grid();
    city.buildPowerLine(0, 3, 1, 3);
    city.placeStructure('wasteToEnergyPlant', 14, 2);
    const waste = [...city.state.structures.values()].find((st) => st.kind === 'wasteToEnergyPlant')!;
    waste.load = 30;
    city.state.neighbourDeals.push({ id: 1, edge: 0, resource: 'power', direction: 'buy', amount: 400, price: 0.1,
      startDay: 0, status: 'active', monthsLeft: 0 });
    city.refresh();
    const generation = () => [...city.state.structures.values()].filter((st) => city.cfg.structures[st.kind].plant)
      .reduce((sum, st) => sum + st.load, 0);
    expect(generation()).toBeCloseTo(city.power.demand - 400 - 300, 8);
    waste.load = 200;
    city.refresh();
    expect(generation()).toBe(0);
    expect(city.power.grids[0]!.wastePower).toBe(2_000);
  });

  it('limits loads independently on disconnected and overloaded grids', () => {
    const city = new City({ size: 48, water: false, config: { ...calm, structures: {
      coalPlant: { powerUse: 1_000 }, gasPlant: { powerUse: 4_000 },
    } } });
    city.state.funds = 1_000_000;
    city.placeStructure('coalPlant', 2, 2);
    city.placeStructure('gasPlant', 35, 35);
    const plants = [...city.state.structures.values()];
    expect(plants.find((st) => st.kind === 'coalPlant')!.load).toBe(1_000);
    const gas = plants.find((st) => st.kind === 'gasPlant')!;
    expect(gas.load).toBe(gas.capacity);
    expect(gas.effectiveness).toBe(1);
  });

  it('charges fuel even at zero maintenance funding and quotes actual age-related upkeep', () => {
    const city = new City({ size: 24, water: false, config: { ...calm, structures: { coalPlant: { powerUse: 3_000 } } } });
    city.state.funds = 1_000_000;
    city.placeStructure('coalPlant', 2, 2);
    const plant = [...city.state.structures.values()][0]!;
    expect(city.structureUpkeep(plant.id)!.running).toBe(206.25);
    city.setFunding(plant.id, 0);
    expect(city.structureUpkeep(plant.id)!.running).toBe(43.75);
    expect(city.utility('power').cost).toBeCloseTo(43.75 / plant.capacity, 10);
    plant.life = 80;
    city.refresh();
    expect(city.utility('power').cost).toBeCloseTo(city.structureUpkeep(plant.id)!.total / plant.capacity, 10);
  });

  it('bounds waste electricity by current funding and connected processing capacity', () => {
    const city = grid();
    city.placeStructure('wasteToEnergyPlant', 14, 2);
    const waste = [...city.state.structures.values()].find((st) => st.kind === 'wasteToEnergyPlant')!;
    waste.load = 500;
    city.refresh();
    expect(city.power.grids[0]!.wastePower).toBe(5_000);
    city.setDepartmentFunding('sanitation', 50);
    city.refreshIfDirty();
    expect(city.power.grids[0]!.wastePower).toBe(2_500);
    city.setDepartmentFunding('sanitation', 0);
    city.refreshIfDirty();
    expect(city.power.grids[0]!.wastePower).toBe(0);
    expect(city.utility('power').capacity).toBe(9_000);
    expect(city.infrastructureReport().power[0]!.sources.some((source) => source.kind === 'incinerator')).toBe(false);
  });

  it('loads former operating settings without retaining a policy or suspending equipment', () => {
    const city = grid();
    city.step(60);
    const saved = saveCity(city);
    const legacy = { ...saved, powerDispatch: 'clean', structures: saved.structures.map((st) => ({ ...st, offlineUntilDay: saved.day + 7 })) };
    const loaded = loadCity(legacy, { config });
    expect(saveCity(loaded)).toEqual(saved);
    for (const st of loaded.state.structures.values()) {
      expect(st.capacity).toBeGreaterThan(0);
      expect(utilityEmissionShare(loaded.cfg, st)).toBeGreaterThan(0);
    }
    city.step(60);
    loaded.beginSteps(60);
    while (loaded.resume()) { /* finish in pieces */ }
    expect(saveCity(loaded)).toEqual(saveCity(city));
  });
});
