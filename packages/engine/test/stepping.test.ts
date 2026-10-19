import { describe, expect, it } from 'vitest';
import { City, loadCity, saveCity, saveCitySteps } from '../src';
describe('stepping in pieces', () => {
  it('operational landfill checks have the same result during sliced and synchronous months', () => {
    const config = { safety: { fires: false }, disasters: { simulated: false } };
    const a = new City({ size: 32, water: false, config });
    a.state.funds = 1_000_000;
    a.placeStructure('gasPlant', 2, 2);
    a.buildNetwork(1, 2, 1, 19, 'road');
    a.buildNetwork(0, 19, 31, 19, 'road');
    a.zone(1, 10, 10, 18, 'R-low');
    a.zone(20, 20, 23, 23, 'landfill');
    expect(a.enactOrdinance('landfillGas').ok).toBe(true);
    const b = loadCity(saveCity(a), { config });
    a.step(65);
    b.beginSteps(65);
    while (b.resume());
    expect(b.state.ordinances).toContain('landfillGas');
    expect(saveCity(b)).toEqual(saveCity(a));
  });

  const edits: [string, (city: City) => unknown][] = [
    ['zoning', (c) => c.zone(20, 20, 25, 25, 'R-low')],
    ['roads', (c) => c.buildNetwork(20, 20, 28, 20, 'road')],
    ['pipes', (c) => c.buildPipe(20, 20, 28, 20)],
    ['power lines', (c) => c.buildPowerLine(20, 20, 28, 20)],
    ['subway', (c) => c.buildSubway(20, 20, 28, 20)],
    ['facilities', (c) => c.placeStructure('smallPoliceStation', 20, 20)],
    ['bulldozing', (c) => c.bulldoze(0, 10, 2, 10)],
    ['trees', (c) => c.plantTrees(20, 20, 25, 25)],
    ['terrain', (c) => c.terraform(20, 20, 25, 25, 'raise')],
    ['taxes', (c) => c.setTaxRate('R$', 12)],
    ['department budgets', (c) => c.setDepartmentFunding('roads', 80)],
    ['facility budgets', (c) => c.setFunding(1, 80)],
    ['loans', (c) => c.takeLoan(50_000)],
    ['ordinances', (c) => c.enactOrdinance('legalizeGambling')],
    ['disasters', (c) => c.disaster('earthquake', 15, 15, 0.5)],
    ['neighbours', (c) => c.setNeighbour(0, 'developed')],
    ['renaming', (c) => c.rename('After the day')],
    ['zone previews', (c) => c.previewZone(20, 20, 25, 25, 'R-low')],
    ['road previews', (c) => c.previewNetwork(20, 20, 28, 20, 'road')],
    ['pipe previews', (c) => c.previewLine('pipe', 20, 20, 28, 20)],
    ['bulldozer previews', (c) => c.previewBulldoze(0, 10, 2, 10)],
    ['facility previews', (c) => c.canPlaceStructure('smallPoliceStation', 20, 20)],
    ['terrain previews', (c) => c.previewTerraform(20, 20, 25, 25, 'raise')],
    ['tree previews', (c) => c.previewTrees(20, 20, 25, 25)],
    ['budget forecasts', (c) => c.previewBudget()],
    ['infrastructure reports', (c) => c.infrastructureReport()],
    ['cash flow forecasts', (c) => c.budgetForecast(12, { capitalSpend: 1_000 })],
  ];

  it.each(edits)('%s waits for the day under way before reading or changing the city', (_name, edit) => {
    const start = new City({ size: 32, water: false });
    start.state.funds = 1_000_000;
    start.buildNetwork(0, 10, 31, 10, 'road');
    start.placeStructure('gasPlant', 2, 12);
    start.zone(2, 5, 15, 9, 'R-low');
    start.step(59);
    const saved = saveCity(start);
    const a = loadCity(saved);
    const b = loadCity(saved);
    a.step(1);
    b.beginSteps(1);
    expect(b.resume()).toBe(true);
    expect(edit(b)).toEqual(edit(a));
    expect(b.stepping).toBe(false);
    expect(saveCity(b)).toEqual(saveCity(a));
  });

  it('beginSteps/resume ends exactly where step does, and settle finishes a day under way', () => {
    const a = new City({ size: 48, seed: 3, water: false });
    a.state.funds = 1_000_000;
    a.buildNetwork(0, 20, 47, 20, 'road');
    a.zone(1, 12, 46, 19, 'R-low');
    a.zone(1, 21, 46, 28, 'I-medium');
    a.placeStructure('coalPlant', 1, 30);
    const b = loadCity(JSON.parse(JSON.stringify(saveCity(a))));
    a.step(95);
    b.beginSteps(95);
    let pieces = 0;
    while (b.resume()) pieces++;
    expect(pieces).toBeGreaterThan(95);
    expect(b.stepping).toBe(false);
    expect(JSON.stringify(saveCity(b))).toBe(JSON.stringify(saveCity(a)));
    // Part-way through a month's end, a save finishes the day first.
    b.beginSteps(30);
    for (let k = 0; k < 40; k++) b.resume();
    a.step(30);
    expect(JSON.stringify(saveCity(b))).toBe(JSON.stringify(saveCity(a)));
    expect(b.stepping).toBe(false);
  }, 60_000);

  it('the growth map and the advisors in pieces match the one-call versions', () => {
    const a = new City({ size: 64, seed: 5, water: false });
    a.state.funds = 1_000_000;
    a.buildNetwork(0, 30, 63, 30, 'road');
    a.zone(1, 20, 62, 29, 'R-low');
    a.zone(1, 31, 62, 40, 'C-low');
    a.placeStructure('coalPlant', 1, 50);
    a.step(60);
    const b = loadCity(JSON.parse(JSON.stringify(saveCity(a))));
    const drainCount = <T>(g: Generator<void, T>): [T, number] => {
      let n = 0;
      for (;;) {
        const r = g.next();
        if (r.done) return [r.value, n];
        n++;
      }
    };
    const [map, pieces] = drainCount(b.growthMapSteps());
    expect(pieces).toBeGreaterThan(1);
    expect([...map]).toEqual([...a.growthMap()]);
    expect(drainCount(b.advisorsSteps())[0]).toEqual(a.advisors());
    // A map a day overtook part-way is handed back but not kept.
    const c = loadCity(JSON.parse(JSON.stringify(saveCity(a))));
    const g = c.growthMapSteps();
    g.next();
    c.step(1);
    const stale = drainCount(g)[0];
    expect(c.growthMap()).not.toBe(stale);
  }, 60_000);

  it('a save in pieces writes the same text as one in one go', () => {
    const a = new City({ size: 48, seed: 9, water: false });
    a.state.funds = 1_000_000;
    a.buildNetwork(0, 20, 47, 20, 'road');
    a.zone(1, 12, 46, 19, 'R-low');
    a.placeStructure('coalPlant', 1, 30);
    a.step(40);
    const g = saveCitySteps(a);
    let pieces = 0;
    let r = g.next();
    while (!r.done) {
      pieces++;
      r = g.next();
    }
    expect(pieces).toBeGreaterThan(10);
    expect(JSON.stringify(r.value)).toBe(JSON.stringify(saveCity(a)));
  });

  it('clearRubble clears every rubble tile and nothing else, at the bulldozer\'s price', () => {
    const a = new City({ size: 32, seed: 2, water: false });
    a.buildNetwork(0, 10, 31, 10, 'road');
    a.state.rubble[5 * 32 + 5] = 1;
    a.state.rubble[20 * 32 + 7] = 1;
    const funds = a.state.funds;
    expect(a.clearRubble(true)).toMatchObject({ ok: true, tiles: 2, cost: 2 * a.cfg.safety.rubbleBulldoze });
    expect(a.state.funds).toBe(funds);
    const res = a.clearRubble();
    expect(res.ok).toBe(true);
    expect(a.state.rubble.some((v) => v > 0)).toBe(false);
    expect(a.state.funds).toBe(funds - res.cost);
    expect(a.state.net[10 * 32 + 3]).not.toBe(0);
    expect(a.clearRubble().ok).toBe(false);
  });
});
