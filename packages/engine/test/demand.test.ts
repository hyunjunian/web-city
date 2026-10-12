import { describe, expect, it } from 'vitest';
import { City, DEFAULT_CONFIG, makeConfig } from '../src';
import { BUSINESS_PROFILE, WORKFORCE_PROFILE } from '../src/data/demand';
import { capRelief, neutralTaxRate, takeCensus, taxImpact } from '../src/sim/demand';
import { BUSINESS_TYPES, DEV_TYPES, WEALTHS } from '../src/types';

const cfg = DEFAULT_CONFIG;

describe('demand tables', () => {
  it('workforce profiles sum to 100%', () => {
    for (const t of BUSINESS_TYPES) {
      expect(WORKFORCE_PROFILE[t].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    }
  });

  it('business demand columns sum to 100% without agriculture', () => {
    for (const w of WEALTHS) {
      for (let eq = 0; eq < 4; eq++) {
        let sum = 0;
        for (const t of BUSINESS_TYPES) if (t !== 'IA') sum += BUSINESS_PROFILE[t][w][eq]!;
        expect(sum).toBeCloseTo(1, 6);
      }
    }
  });

  it('reproduces the neutral tax table', () => {
    expect(neutralTaxRate(cfg, 0)).toBe(9);
    expect(neutralTaxRate(cfg, 149_999)).toBe(9);
    expect(neutralTaxRate(cfg, 150_000)).toBe(8.9);
    expect(neutralTaxRate(cfg, 1_620_000)).toBe(8.3);
    expect(neutralTaxRate(cfg, 3_000_000)).toBe(8);
  });
});

describe('tax impact', () => {
  it('is neutral at the neutral rate and saturates at +35% / -350%', () => {
    expect(taxImpact(cfg, 1)).toBe(0);
    expect(taxImpact(cfg, 0.2)).toBeCloseTo(0.35);
    expect(taxImpact(cfg, 0.05)).toBeCloseTo(0.35);
    expect(taxImpact(cfg, 5)).toBeCloseTo(-3.5);
    expect(taxImpact(cfg, 10)).toBeCloseTo(-3.5);
    expect(taxImpact(cfg, 1.2)).toBeLessThan(0);
    expect(taxImpact(cfg, 0.8)).toBeGreaterThan(0);
  });

  it('remembers the highest rate for 90 days', () => {
    const city = new City({ size: 32, water: false });
    const before = city.demand.taxEffect['R$'];
    city.setTaxRate('R$', 15);
    city.setTaxRate('R$', 9);
    expect(city.demand.taxEffect['R$']).toBeLessThan(before);
    city.step(92);
    city.refresh(); // demand is recomputed at refreshes
    expect(city.demand.taxEffect['R$']).toBeCloseTo(0);
  });
});

describe('taxes chase Sims away', () => {
  it('demand pushed far below zero by taxes empties buildings (Sims already in town leave)', () => {
    const run = (rate: number) => {
      const city = new City({ size: 48, seed: 5, difficulty: 'easy', water: false, config: { safety: { fires: false }, mayor: { riots: false } } });
      city.state.funds = 5_000_000;
      city.buildNetwork(0, 20, 47, 20, 'road');
      city.zone(1, 12, 46, 19, 'R-low');
      city.zone(1, 21, 46, 30, 'I-medium');
      city.placeStructure('gasPlant', 1, 33);
      city.step(360);
      for (const t of DEV_TYPES) city.setTaxRate(t, rate);
      city.step(360);
      return city.stats().population;
    };
    expect(run(20)).toBeLessThan(run(9) * 0.85);
  }, 60_000);
});

describe('demand caps', () => {
  it('road connections relieve Commercial Office caps on a log scale', () => {
    const city = new City({ size: 32, water: false });
    const relief = (n: number) => capRelief(city.state, cfg, [n, 0, 0, 0])['Co$$'];
    expect(relief(1)).toBe(10_000);
    expect(Math.round(relief(2) - relief(1))).toBe(5_850);
    expect(Math.round(relief(3) - relief(2))).toBe(4_150);
  });

  it('an underfunded structure gives that share of its cap relief', () => {
    const city = new City({ size: 64, water: false });
    city.state.funds = 1_000_000;
    const base = capRelief(city.state, cfg, [0, 0, 0, 0])['IHT'];
    city.state.unlocked.push('university');
    expect(city.placeStructure('university', 10, 10).ok).toBe(true);
    const full = capRelief(city.state, cfg, [0, 0, 0, 0])['IHT'] - base;
    expect(full).toBe(100_000);
    const uni = [...city.state.structures.values()].find((x) => x.kind === 'university')!;
    uni.funding = 60;
    expect(capRelief(city.state, cfg, [0, 0, 0, 0])['IHT'] - base).toBeCloseTo(60_000, 0);
  });

  it('seaports relieve offices by a tenth of their industrial relief', () => {
    const n = 48;
    const city = new City({ size: n, water: false });
    city.state.funds = 1_000_000;
    for (let y = 0; y < n; y++) for (let x = 40; x < n; x++) city.state.terrain[y * n + x] = 1;
    expect(city.placeStructure('internationalPort', 36, 21).ok).toBe(true);
    const port = [...city.state.structures.values()].find((x) => x.kind === 'internationalPort')!;
    const before = capRelief(city.state, cfg, [0, 0, 0, 0]);
    port.load = 10; // 200 industrial relief
    const after = capRelief(city.state, cfg, [0, 0, 0, 0]);
    expect(after['ID'] - before['ID']).toBe(200);
    expect(after['Co$$'] - before['Co$$']).toBeCloseTo(20, 6);
    port.load = 1_000;
    city.setFunding(port.id, 120);
    expect(port.funding).toBe(120); // seaports take overfunding, like airports
    port.funding = 50; // underfunded: half the capacity
    expect(capRelief(city.state, cfg, [0, 0, 0, 0])['ID'] - before['ID']).toBe(325);
  });

  it('maximum demand falls linearly with population / cap', () => {
    // Force raw R$ demand to be huge and check the cap ceiling.
    const city = new City({ size: 32, water: false, config: { demand: { baseJobs: [1e9, 0, 0] } } });
    expect(city.demand.demand['R$']).toBeLessThanOrEqual(1000);
    expect(city.demand.cap['R$']).toBe(20_000);
  });

  it('parks add residential cap relief', () => {
    const city = new City({ size: 32, water: false });
    city.placeStructure('largePlaza', 2, 2);
    expect(city.demand.cap['R$']).toBe(20_000 + 9_000);
    expect(city.demand.cap['R$$$']).toBe(1_000 + 9_000);
  });
});

describe('difficulty', () => {
  it('sets starting funds', () => {
    expect(new City({ size: 16, difficulty: 'easy' }).state.funds).toBe(500_000);
    expect(new City({ size: 16, difficulty: 'hard' }).state.funds).toBe(100_000);
  });

  it('config overrides deep-merge', () => {
    const c = makeConfig({ demand: { exodusSlack: 60 } });
    expect(c.demand.exodusSlack).toBe(60);
    expect(c.demand.initialCaps['R$']).toBe(20_000);
  });
});

describe('loans', () => {
  it.each([0, 1e-12])('supports an overridden interest rate of %s without corrupting funds', (rate) => {
    const city = new City({ size: 16, water: false, config: { economy: { loans: { rate } } } });
    expect(city.loanPayment(50_000)).toBe(416);
    expect(city.takeLoan(50_000).ok).toBe(true);
    expect(city.loanBalance(city.state.loans[0]!)).toBe(50_000);
    city.step(30);
    expect(city.state.lastBudget!.loanPayments).toBe(416);
    expect(Number.isFinite(city.state.funds)).toBe(true);
    expect(city.loanBalance(city.state.loans[0]!)).toBe(49_583);
    expect(city.repayLoan(0).ok).toBe(true);
    expect(city.state.loans).toHaveLength(0);
  });

  it('match the payment table and limits', () => {
    const city = new City({ size: 16 });
    expect(city.loanPayment(5_000)).toBe(61);
    expect(city.loanPayment(100_000)).toBe(1_239);
    expect(city.loanPayment(200_000)).toBe(2_479);
    const funds = city.state.funds;
    expect(city.takeLoan(50_000).ok).toBe(true);
    expect(city.state.funds).toBe(funds + 50_000);
    expect(city.takeLoan(250_000).ok).toBe(false);
    city.step(30);
    expect(city.state.lastBudget!.loanPayments).toBe(619);
    expect(city.state.loans[0]!.monthsLeft).toBe(119);
    expect(city.repayLoan(0).ok).toBe(true);
    expect(city.state.loans.length).toBe(0);
  });
});

describe('budget preview', () => {
  it('settles next month on a copy: today\'s rates show at once, nothing is paid', () => {
    const city = new City({ size: 48, seed: 3, water: false });
    city.state.funds = 1_000_000;
    city.buildNetwork(0, 20, 47, 20, 'road');
    city.zone(1, 12, 46, 19, 'R-low');
    city.zone(1, 21, 46, 28, 'I-medium');
    city.placeStructure('coalPlant', 1, 30);
    city.step(180);
    const funds = city.state.funds;
    const before = city.previewBudget();
    city.setTaxRate('R$', city.state.taxRates['R$'] + 3);
    const after = city.previewBudget();
    expect(after.taxByType['R$']).toBeGreaterThan(before.taxByType['R$']);
    expect(city.state.funds).toBe(funds);
    expect(city.state.lastBudget!.taxByType['R$']).toBeLessThan(after.taxByType['R$']);
  }, 60_000);
});

describe('demand cap advice', () => {
  it('says when homes are wanted but the residential cap holds them back', () => {
    const city = new City({ size: 32, seed: 5, water: false });
    const d = city.demand;
    Object.assign(d.raw, { 'R$': 500 });
    Object.assign(d.cap, { 'R$': 20_000 });
    Object.assign(d.capPopulation, { 'R$': 19_900 });
    Object.assign(d.demand, { 'R$': 200 });
    expect(city.advisors()).toContainEqual(expect.objectContaining({ code: 'capRes', level: 'neutral', value: 20_000 }));
    Object.assign(d.demand, { 'R$': 0 }); // held right down: what stops the city
    expect(city.advisors()).toContainEqual(expect.objectContaining({ code: 'capRes', level: 'bad', value: 20_000 }));
    Object.assign(d.capPopulation, { 'R$': 10_000 }); // far from the cap: not the cap's fault
    expect(city.advisors().map((a) => a.code)).not.toContain('capRes');
    Object.assign(d.raw, { 'R$': -10 }); // nobody wants in
    Object.assign(d.capPopulation, { 'R$': 19_900 });
    expect(city.advisors().map((a) => a.code)).not.toContain('capRes');
  });

  it('an empty residential zone names the cap that holds it back', () => {
    const city = new City({ size: 32, seed: 5, water: false });
    city.state.funds = 1_000_000;
    city.buildNetwork(0, 10, 31, 10, 'road');
    city.zone(2, 11, 6, 12, 'R-low');
    expect(city.growthBlockers(3, 11)).not.toBeNull(); // catches the fields up with the zoning
    const d = city.demand;
    Object.assign(d.demand, { 'R$': 0, 'R$$': 0, 'R$$$': 0 }); // the cap holds demand at 0
    Object.assign(d.raw, { 'R$': 500 });
    Object.assign(d.cap, { 'R$': 20_000 });
    Object.assign(d.capPopulation, { 'R$': 19_900 });
    const codes = () => city.growthBlockers(3, 11)!.map((b) => b.code);
    expect(city.growthBlockers(3, 11)).toContainEqual({ code: 'capped', type: 'R$', value: 20_000 });
    expect(codes()).not.toContain('noDemand');
    Object.assign(d.capPopulation, { 'R$': 10_000 }); // far from the cap: plainly no demand
    expect(codes()).toContain('noDemand');
    expect(codes()).not.toContain('capped');
  });
});

describe('census of empty buildings', () => {
  it('an abandoned Historical building is a move-in option only for its own kind', () => {
    const city = new City({ size: 32, water: false });
    const s = city.state;
    const base = { x: 2, y: 2, w: 1, h: 1, stage: 1, capacity: 10, occupancy: 0, filled: 0, origType: 'R$$$' as const, type: null };
    s.buildings.set(1, { ...base, id: 1, historical: true } as never);
    let c = takeCensus(s, city.cfg);
    expect([c.abandonedFor['R$$$'], c.abandonedFor['R$$'], c.abandonedFor['R$']]).toEqual([1, 0, 0]);
    s.buildings.set(1, { ...base, id: 1, historical: false } as never);
    c = takeCensus(s, city.cfg);
    expect(c.abandonedFor['R$']).toBe(1); // poorer Sims may take over an ordinary one
  });
});

