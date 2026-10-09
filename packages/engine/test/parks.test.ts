import { describe, expect, it } from 'vitest';
import { City } from '../src';
import { capRelief } from '../src/sim/demand';

const CALM = { safety: { fires: false }, mayor: { riots: false } } as const;

describe('parks and recreation', () => {
  it('uses the park table: cost, monthly cost, relief, YIMBY and air cleaning', () => {
    const city = new City({ size: 40, water: false, config: CALM });
    city.state.funds = 100_000;
    const funds = city.state.funds;
    expect(city.placeStructure('largeParkGreen', 18, 18).ok).toBe(true);
    expect(city.state.funds).toBe(funds - 320);
    expect(capRelief(city.state, city.cfg, [0, 0, 0, 0])['R$']).toBe(2_500);
    city.step(30);
    expect(city.state.lastBudget!.parkUpkeep).toBe(25);
  });

  it('city beautification funding scales upkeep, relief and YIMBY; it cannot be overfunded', () => {
    const city = new City({ size: 40, water: false, config: CALM });
    city.state.funds = 100_000;
    city.placeStructure('largeFlowerGarden', 18, 18);
    city.refresh();
    const yimby = () => city.fields.nimbyRes[20 * 40 + 24]!;
    const full = yimby();
    expect(full).toBeGreaterThan(0);
    city.setDepartmentFunding('parks', 150);
    expect(city.state.departments.parks).toBe(100);
    city.setDepartmentFunding('parks', 50);
    city.refresh();
    expect(yimby()).toBeCloseTo(full / 2, 3);
    expect(capRelief(city.state, city.cfg, [0, 0, 0, 0])['R$$']).toBe(3_500);
    city.step(30);
    expect(city.state.lastBudget!.parkUpkeep).toBeCloseTo(17.5);
  });

  it('parks with negative air pollution clean the air around them', () => {
    const make = (park: boolean) => {
      const c = new City({ size: 40, water: false, config: CALM });
      c.state.funds = 100_000;
      c.placeStructure('coalPlant', 4, 4);
      if (park) c.placeStructure('largeParkGreen', 12, 4);
      c.refresh();
      return c.fields.air;
    };
    const smog = make(false);
    const cleaned = make(true);
    const at = 5 * 40 + 13;
    expect(smog[at]).toBeGreaterThan(0);
    expect(cleaned[at]).toBeLessThan(smog[at]!);
    for (let i = 0; i < smog.length; i++) expect(cleaned[i]).toBeLessThanOrEqual(smog[i]!);
  });

  it('beaches go on the shore', () => {
    const city = new City({ size: 40, water: false, config: CALM });
    city.state.funds = 100_000;
    expect(city.placeStructure('beach', 5, 5).ok).toBe(false);
    city.terraform(0, 0, 39, 2, 'water');
    expect(city.placeStructure('beach', 5, 2).ok).toBe(true);
  });
});
