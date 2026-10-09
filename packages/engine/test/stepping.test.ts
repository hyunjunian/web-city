import { describe, expect, it } from 'vitest';
import { City, loadCity, saveCity, saveCitySteps } from '../src';
describe('stepping in pieces', () => {
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
