import { describe, expect, it } from 'vitest';
import { City, loadCity, saveCity, utilityEmissionShare, type RepairDepartment } from '../src';

const calm = { safety: { fires: false }, disasters: { simulated: false }, mayor: { riots: false } };
function town(): City {
  const city = new City({ size: 32, water: false, config: calm });
  city.state.funds = 1_000_000;
  city.placeStructure('coalPlant', 3, 3);
  city.placeStructure('waterPump', 8, 3);
  city.buildPipe(8, 3, 25, 3);
  city.buildPowerLine(3, 8, 25, 8);
  city.buildNetwork(0, 12, 31, 12, 'road');
  city.buildNetwork(0, 15, 31, 15, 'rail');
  return city;
}

describe('capital maintenance', () => {
  it('overhauls an old plant in place, recovering output and reducing upkeep without losing its identity', () => {
    const city = town();
    const plant = [...city.state.structures.values()].find((st) => st.kind === 'coalPlant')!;
    plant.life = 90;
    city.renameBuilding(plant.x, plant.y, 'North Power');
    city.refresh();
    const outlook = city.assetOutlook(plant.id)!;
    const output = plant.capacity;
    const before = saveCity(city);
    const quote = city.refurbishStructure(plant.id, true);
    expect(quote.ok).toBe(true);
    expect(quote.cost).toBeGreaterThan(0);
    expect(quote.cost).toBeLessThan(city.cfg.structures.coalPlant.cost);
    expect(saveCity(city)).toEqual(before);
    const funds = city.state.funds;
    expect(city.refurbishStructure(plant.id)).toEqual(quote);
    expect(city.state.structures.get(plant.id)).toBe(plant);
    expect(plant.life).toBe(outlook.refurbishment.lifeAfter);
    expect(plant.capacity).toBe(0);
    expect(plant.offlineUntilDay).toBe(city.state.day + outlook.refurbishment.downtimeDays);
    expect(city.assetOutlook(plant.id)!.monthsLeft).toBeNull();
    city.step(outlook.refurbishment.downtimeDays);
    expect(plant.offlineUntilDay).toBeUndefined();
    expect(plant.capacity).toBeGreaterThan(output * 2);
    expect(city.structureUpkeep(plant.id)!.total).toBeLessThan(outlook.upkeep);
    expect(city.state.funds).toBe(funds - quote.cost);
    expect(city.query(plant.x, plant.y)!.name).toBe('North Power');
    expect(city.refurbishStructure(plant.id).ok).toBe(false);
    expect(loadCity(saveCity(city), { config: calm }).assetOutlook(plant.id)).toEqual(city.assetOutlook(plant.id));
  });

  it('recovers a worn-out pump but cannot cure loss of electricity by renewing machinery', () => {
    const city = town();
    const pump = [...city.state.structures.values()].find((st) => st.kind === 'waterPump')!;
    pump.life = 110;
    city.refresh();
    expect(pump.capacity).toBe(0);
    expect(city.refurbishStructure(pump.id).ok).toBe(true);
    city.step(city.cfg.infrastructure.refurbishment.downtimeDays);
    expect(pump.capacity).toBeGreaterThan(0);
    city.bulldoze(3, 3, 3, 3);
    pump.life = 80;
    city.refresh();
    expect(pump.powered).toBe(false);
    expect(city.refurbishStructure(pump.id).ok).toBe(true);
    city.step(city.cfg.infrastructure.refurbishment.downtimeDays);
    expect(pump.capacity).toBe(0);
  });

  it('refuses unaffordable or burning overhauls atomically and ignores facilities without machinery', () => {
    const city = town();
    city.placeStructure('medicalClinic', 20, 20);
    const plant = [...city.state.structures.values()].find((st) => st.kind === 'coalPlant')!;
    const clinic = [...city.state.structures.values()].find((st) => st.kind === 'medicalClinic')!;
    expect(city.assetOutlook(clinic.id)).toBeNull();
    expect(city.refurbishStructure(clinic.id).ok).toBe(false);
    expect(city.refurbishStructure(NaN).ok).toBe(false);
    plant.life = 80;
    city.state.funds = 1;
    city.refresh();
    const before = saveCity(city);
    expect(city.refurbishStructure(plant.id)).toMatchObject({ ok: false, message: 'not enough funds' });
    expect(saveCity(city)).toEqual(before);
    city.state.funds = 1_000_000;
    expect(city.igniteAt(plant.x, plant.y)).toBe(true);
    expect(city.refurbishStructure(plant.id)).toMatchObject({ ok: false, message: 'put out the fire before an overhaul' });
    expect(plant.life).toBe(80);
  });

  it('makes lifetime forecasts respond to load and funding, including zero ageing', () => {
    const city = town();
    const plant = [...city.state.structures.values()].find((st) => st.kind === 'coalPlant')!;
    plant.life = 80;
    city.refresh();
    const idle = city.assetOutlook(plant.id)!;
    // A modded plant with the same output and much higher internal demand must age faster.
    city.cfg.structures.coalPlant.powerUse = 5_500;
    city.refresh();
    const busy = city.assetOutlook(plant.id)!;
    expect(busy.monthsLeft).toBeLessThan(idle.monthsLeft!);
    city.setFunding(plant.id, 120);
    expect(city.assetOutlook(plant.id)!.monthsLeft).toBeGreaterThan(busy.monthsLeft!);
    city.cfg.services.plantDecayByFunding = [[0, 0], [120, 0]];
    expect(city.assetOutlook(plant.id)!.monthsLeft).toBeNull();
  });

  it('ages reserve equipment with elapsed time and permits throughput-only wear as a tuning option', () => {
    const city = new City({ size: 16, water: false, config: calm });
    city.state.funds = 1_000_000;
    city.placeStructure('windPlant', 2, 2);
    const wind = [...city.state.structures.values()][0]!;
    const calendar = city.assetOutlook(wind.id)!;
    expect(calendar.monthsLeft).toBeLessThan(100 * 12 * 2);
    city.cfg.infrastructure.calendarWearShare = 0;
    const throughputOnly = city.assetOutlook(wind.id)!;
    expect(throughputOnly.monthsLeft).toBeGreaterThan(calendar.monthsLeft! * 5);
  });
});

describe('planned utility outages', () => {
  it('keeps service running on a connected backup and resumes exactly at a deadline between weekly refreshes', () => {
    const city = town();
    city.placeStructure('gasPlant', 9, 3);
    city.cfg.structures.coalPlant.powerUse = 1_000;
    city.step(2);
    const plant = [...city.state.structures.values()].find((st) => st.kind === 'coalPlant')!;
    plant.life = 80;
    city.refresh();
    expect(city.refurbishStructure(plant.id).ok).toBe(true);
    expect(city.energyReport()!.supply).toBe(3_000);
    expect(city.infrastructureReport().power[0]!.status).not.toBe('shortage');
    expect(plant.capacity).toBe(0);
    expect(utilityEmissionShare(city.cfg, plant)).toBe(0);
    city.step(6);
    expect(plant.capacity).toBe(0);
    city.step(1);
    expect(city.state.day).toBe(9);
    expect(plant.capacity).toBeGreaterThan(5_000);
    expect(plant.offlineUntilDay).toBeUndefined();
    expect(saveCity(loadCity(saveCity(city), { config: { ...calm, structures: { coalPlant: { powerUse: 1_000 } } } }))).toEqual(saveCity(city));
  });

  it('retains schedules through saving and sliced month boundaries, with staggered plant and pump resumptions', () => {
    const city = town();
    city.step(25);
    const plant = [...city.state.structures.values()].find((st) => st.kind === 'coalPlant')!;
    const pump = [...city.state.structures.values()].find((st) => st.kind === 'waterPump')!;
    plant.life = 80;
    pump.life = 80;
    city.refresh();
    city.refurbishStructure(plant.id);
    city.step(1);
    city.refurbishStructure(pump.id);
    const saved = saveCity(city);
    const sliced = loadCity(saved, { config: calm });
    city.step(6);
    expect(plant.capacity).toBeGreaterThan(0);
    expect(pump.capacity).toBe(0);
    city.step(1);
    expect(pump.capacity).toBeGreaterThan(0);
    sliced.beginSteps(7);
    while (sliced.resume());
    expect(saveCity(sliced)).toEqual(saveCity(city));
  });

  it('suspends waste energy and emissions while preserving the representative waste intake for resumption', () => {
    const city = new City({ size: 48, water: false, config: calm });
    city.state.funds = 1_000_000;
    city.placeStructure('coalPlant', 2, 2);
    city.buildPowerLine(6, 3, 40, 3);
    expect(city.placeStructure('wasteToEnergyPlant', 10, 5).ok).toBe(true);
    expect(city.buildNetwork(10, 4, 13, 4, 'road').ok).toBe(true);
    const waste = [...city.state.structures.values()].find((st) => st.kind === 'wasteToEnergyPlant')!;
    waste.life = 80;
    waste.load = 100;
    city.refresh();
    expect(city.energyReport()!.wasteGeneration).toBe(1_000);
    expect(city.refurbishStructure(waste.id).ok).toBe(true);
    expect(waste.capacity).toBe(0);
    expect(city.energyReport()!.wasteGeneration).toBe(0);
    expect(utilityEmissionShare(city.cfg, waste)).toBe(0);
    city.step(7);
    expect(waste.capacity).toBeGreaterThan(400);
    expect(city.energyReport()!.wasteGeneration).toBe(1_000);
    expect(utilityEmissionShare(city.cfg, waste)).toBeGreaterThan(0);
  });

  it('suspends water treatment during works and restores its cleaning at completion', () => {
    const city = new City({ size: 48, water: false, config: calm });
    city.state.funds = 1_000_000;
    city.placeStructure('coalPlant', 2, 2);
    city.buildPowerLine(6, 3, 40, 3);
    city.placeStructure('waterTreatmentPlant', 10, 5);
    const treatment = [...city.state.structures.values()].find((st) => st.kind === 'waterTreatmentPlant')!;
    treatment.life = 80;
    city.refresh();
    const water = () => city.query(4, 4)!.waterPollution;
    expect(water()).toBe(0);
    city.refurbishStructure(treatment.id);
    expect(water()).toBeGreaterThan(0);
    city.step(7);
    expect(water()).toBe(0);
  });

  it('makes zero-downtime overhauls available as a tuning option and validates saved deadlines', () => {
    const city = town();
    city.cfg.infrastructure.refurbishment = { ...city.cfg.infrastructure.refurbishment, downtimeDays: 0 };
    const plant = [...city.state.structures.values()].find((st) => st.kind === 'coalPlant')!;
    plant.life = 80;
    city.refresh();
    expect(city.refurbishStructure(plant.id).ok).toBe(true);
    expect(plant.capacity).toBeGreaterThan(5_000);
    expect(plant.offlineUntilDay).toBeUndefined();
    const saved = saveCity(city);
    for (const deadline of [-1, NaN, Infinity, 1.5]) {
      const bad = { ...saved, structures: saved.structures.map((st) => ({ ...st, offlineUntilDay: deadline })) };
      expect(() => loadCity(bad)).toThrow('bad overhaul deadline');
    }
  });
});

describe('network repair', () => {
  const cases: [RepairDepartment, number, 'lineWear' | 'pipeWear' | 'potholes' | 'railDamage'][] = [
    ['power', 8, 'lineWear'], ['water', 3, 'pipeWear'], ['roads', 12, 'potholes'], ['transit', 15, 'railDamage'],
  ];
  it.each(cases)('repairs only worn %s tiles at the exact preview price, retaining every network', (dept, y, layer) => {
    const city = town();
    const bad = y * city.size + 10;
    const elsewhere = y * city.size + 24;
    city.state[layer][bad] = dept === 'power' || dept === 'water' ? 80 : 1;
    city.state[layer][elsewhere] = 1;
    const before = saveCity(city);
    const quote = city.previewRepairNetworks(dept, 15, y, 5, y);
    expect(quote).toMatchObject({ ok: true, tiles: 1 });
    expect(quote.cost).toBeGreaterThan(0);
    expect(saveCity(city)).toEqual(before);
    const funds = city.state.funds;
    expect(city.repairNetworks(dept, 5, y, 15, y)).toEqual(quote);
    expect(city.state[layer][bad]).toBe(0);
    expect(city.state[layer][elsewhere]).toBe(1);
    expect(city.state.funds).toBe(funds - quote.cost);
    const after = saveCity(city);
    for (const key of ['net', 'power', 'pipe', 'subway', 'links', 'occupant'] as const) {
      if (key === 'occupant') expect([...city.state.occupant]).toEqual([...loadCity(before, { config: calm }).state.occupant]);
      else expect(after[key]).toEqual(before[key]);
    }
    expect(city.previewRepairNetworks(dept, 5, y, 15, y).tiles).toBe(0);
    expect(loadCity(after, { config: calm }).state[layer][bad]).toBe(0);
  });

  it('refuses an unaffordable repair without partially mending and handles invalid or outside rectangles', () => {
    const city = town();
    city.state.potholes[12 * 32 + 8] = 1;
    city.state.potholes[12 * 32 + 9] = 1;
    city.state.funds = 0;
    const before = saveCity(city);
    expect(city.repairNetworks('roads', 0, 12, 31, 12)).toMatchObject({ ok: false, tiles: 2 });
    expect(saveCity(city)).toEqual(before);
    expect(city.repairNetworks('roads', NaN, 0, 31, 31).ok).toBe(false);
    expect(city.previewRepairNetworks('roads', 32, 0, 50, 31).tiles).toBe(0);
    expect(city.previewRepairNetworks('unknown' as RepairDepartment, 0, 0, 31, 31).ok).toBe(false);
  });

  it('supports free repairs configured by a mod and does not charge for healthy tiles', () => {
    const city = town();
    city.cfg.infrastructure.networkRepair = { ...city.cfg.infrastructure.networkRepair, damageCostShare: 0 };
    city.state.potholes[12 * 32 + 8] = 1;
    const funds = city.state.funds;
    expect(city.repairNetworks('roads', 0, 12, 31, 12)).toEqual({ ok: true, tiles: 1, cost: 0 });
    expect(city.state.funds).toBe(funds);
    expect(city.state.potholes[12 * 32 + 8]).toBe(0);
  });
});
