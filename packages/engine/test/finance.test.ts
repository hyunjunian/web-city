import { describe, expect, it } from 'vitest';
import { City, saveCity } from '../src';
import { settleDeals } from '../src/sim/region';

const calm = { safety: { fires: false }, disasters: { simulated: false }, mayor: { riots: false } };

describe('cash flow projections', () => {
  it('pays exactly funded fractional invoices without treating floating-point roundoff as a breach', () => {
    for (const [funds, paid, expense] of [[0.3, 3, 0.3], [0.299999, 2, 0.2]] as const) {
      const city = new City({ size: 16, water: false });
      for (const edge of [0, 1, 2, 3] as const) {
        city.setNeighbour(edge, 'developed');
        city.state.neighbourDeals.push({ id: edge + 1, edge, resource: 'power', direction: 'buy', amount: 1_000, price: 0.0001,
          startDay: 0, status: 'active', monthsLeft: 0 });
      }
      city.state.funds = funds;
      const report = settleDeals(city.state, city.cfg, { power: true, water: true, garbage: true }, () => true);
      expect(report.expense).toBe(expense);
      expect(city.state.neighbourDeals.map((deal) => deal.status)).toEqual(Array.from({ length: 4 }, (_, k) => k < paid ? 'active' : 'grace'));
      expect(city.state.funds).toBe(funds); // The budget applies the reported payment afterwards.
    }
  });

  it('reserves the treasury once when several utility purchases settle in the same month', () => {
    const city = new City({ size: 16, water: false, config: calm });
    city.state.funds = 1_000_000;
    city.buildPowerLine(0, 5, 15, 5);
    for (const edge of [0, 1] as const) {
      city.setNeighbour(edge, 'developed', 10);
      expect(city.makeDeal(edge, 'power', 'buy', 1_000).ok).toBe(true);
    }
    for (const deal of city.state.neighbourDeals) deal.price = 0.6;
    city.state.funds = 1_000; // Either purchase fits, both together do not.
    const before = saveCity(city);
    expect(city.previewBudget().neighbourExpense).toBe(600);
    expect(city.budgetForecast(1).points[0]).toMatchObject({ neighbourExpense: 600, troubledDeals: 1 });
    expect(saveCity(city)).toEqual(before);
    city.step(30);
    expect(city.state.lastBudget!.neighbourExpense).toBe(600);
    expect(city.state.neighbourDeals.map((deal) => deal.status)).toEqual(['active', 'grace']);
    expect(city.state.neighbourDeals[1]!.monthsLeft).toBe(city.cfg.region.deals.graceMonths);
    city.state.funds = 100_000;
    city.step(30);
    expect(city.state.lastBudget!.neighbourExpense).toBe(1_200);
    expect(city.state.neighbourDeals.map((deal) => deal.status)).toEqual(['active', 'probation']);
  });

  it('matches actual loan maturity in a static city, without changing the treasury, loans or random generator', () => {
    const city = new City({ size: 16, water: false, config: { ...calm, economy: { loans: { rate: 0 } } } });
    city.state.funds = 1_000;
    expect(city.takeLoan(5_000).ok).toBe(true);
    city.state.loans[0]!.monthsLeft = 2;
    const before = saveCity(city);
    const preview = city.previewBudget();
    const forecast = city.budgetForecast(4);
    expect(saveCity(city)).toEqual(before);
    expect(forecast.points[0]).toMatchObject({ income: preview.income, expenses: preview.expenses, loanPayments: 41, debt: 42 });
    expect(forecast.points.map((point) => point.loanPayments)).toEqual([41, 41, 0, 0]);
    expect(forecast.points.map((point) => point.debt)).toEqual([42, 0, 0, 0]);
    expect(forecast.firstNegativeMonth).toBeNull();
    city.step(120);
    expect(city.state.funds).toBe(forecast.points[3]!.funds);
    expect(city.state.loans).toHaveLength(0);
  });

  it('compares tax-income shocks, capital spending and monthly costs while retaining mandatory debt payments', () => {
    const city = new City({ size: 32, water: false, seed: 5, difficulty: 'easy', config: calm });
    city.state.funds = 1_000_000;
    city.batch(() => {
      city.buildNetwork(0, 18, 31, 18, 'road');
      city.zone(2, 10, 28, 17, 'R-low');
      city.zone(2, 19, 28, 23, 'I-medium');
      city.placeStructure('gasPlant', 2, 25);
    });
    city.step(90);
    expect(city.stats().population).toBeGreaterThan(0);
    city.takeLoan(5_000);
    const before = saveCity(city);
    const base = city.budgetForecast(3);
    const tax = Object.values(city.previewBudget().taxByType).reduce((sum, value) => sum + value, 0);
    expect(tax).toBeGreaterThan(0);
    const scenario = city.budgetForecast(3, { capitalSpend: 10_000, taxIncomeMultiplier: 0.8, monthlyOperatingChange: 100 });
    expect(scenario.fundsAfterCapital).toBe(city.state.funds - 10_000);
    expect(scenario.points[0]!.income).toBeCloseTo(base.points[0]!.income - tax * 0.2, 8);
    expect(scenario.points[2]!.funds).toBeCloseTo(base.points[2]!.funds - 10_000 - 3 * (tax * 0.2 + 100), 8);
    const saving = city.budgetForecast(1, { monthlyOperatingChange: -1_000_000 });
    expect(saving.points[0]!.expenses).toBe(saving.points[0]!.loanPayments);
    expect(saveCity(city)).toEqual(before);
  });

  it('identifies immediate and future cash shortfalls and the impeachment threshold', () => {
    const city = new City({ size: 16, water: false, config: calm });
    city.state.funds = 250;
    const monthly = city.budgetForecast(4, { monthlyOperatingChange: 100 });
    expect(monthly.firstNegativeMonth).toBe(3);
    expect(monthly.minimumFunds).toBe(-150);
    expect(monthly.firstImpeachmentMonth).toBeNull();
    const capital = city.budgetForecast(1, { capitalSpend: 251 });
    expect(capital.firstNegativeMonth).toBe(0);
    expect(capital.minimumFunds).toBe(-1);
    const severe = city.budgetForecast(2, { monthlyOperatingChange: 100_000 });
    expect(severe.firstImpeachmentMonth).toBe(2);
  });

  it('runs neighbour grace and contract expiry on the forecast copy and records interruptions', () => {
    const city = new City({ size: 24, water: false, config: calm });
    city.state.funds = 1_000_000;
    city.placeStructure('coalPlant', 3, 3);
    city.buildPowerLine(0, 3, 2, 3);
    city.setNeighbour(0, 'developed');
    city.state.neighbourDeals.push({ id: 1, edge: 0, resource: 'power', direction: 'buy', amount: 1_000, price: 1,
      startDay: 0, status: 'active', monthsLeft: 0 });
    city.state.funds = 400;
    city.refresh();
    const before = saveCity(city);
    const forecast = city.budgetForecast(8);
    expect(forecast.points[0]!.neighbourExpense).toBe(0);
    expect(forecast.points[0]!.troubledDeals).toBe(1);
    expect(forecast.endedDeals).toEqual([1]);
    expect(forecast.points[7]!.troubledDeals).toBe(0);
    expect(saveCity(city)).toEqual(before);
  });

  it('returns independent results and refuses invalid horizons and non-finite scenarios', () => {
    const city = new City({ size: 16, water: false });
    const before = saveCity(city);
    expect(city.budgetForecast(120).points).toHaveLength(120);
    for (const months of [0, -1, 121, 1.5, NaN, Infinity]) expect(() => city.budgetForecast(months)).toThrow(RangeError);
    for (const options of [{ capitalSpend: -1 }, { capitalSpend: Infinity }, { taxIncomeMultiplier: -1 },
      { taxIncomeMultiplier: 11 }, { monthlyOperatingChange: NaN }]) expect(() => city.budgetForecast(12, options)).toThrow(RangeError);
    const report = city.budgetForecast(2);
    report.points[0]!.funds = 0;
    expect(city.budgetForecast(2).points[0]!.funds).toBe(city.state.funds);
    expect(saveCity(city)).toEqual(before);
  });
});
