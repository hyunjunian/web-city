import { describe, expect, it } from 'vitest';
import { City, loadCity, saveCity } from '../src';

/** Homes north of a road, industry south, a gas plant for power. (Fewer homes than jobs could take
 * every worker, so a factory or two always hires: the tests that find a My Sim a job need one.) */
function town(): City {
  const n = 48;
  const city = new City({ size: n, seed: 5, difficulty: 'easy', water: false, config: { safety: { fires: false }, mayor: { riots: false } } });
  city.state.funds = 5_000_000;
  city.buildNetwork(0, 20, n - 1, 20, 'road');
  city.zone(1, 15, n - 2, 19, 'R-low');
  city.zone(1, 21, n - 2, 30, 'I-medium');
  city.placeStructure('gasPlant', 1, 33);
  city.step(360);
  return city;
}

const homes = (c: City) => [...c.state.buildings.values()].filter((b) => b.type === 'R$' && b.occupancy > 0);

describe('My Sims', () => {
  it('repeated commute queries preserve the monthly route plan, prior results and future simulation', () => {
    const start = town();
    homes(start).slice(0, 5).forEach((home, i) => expect(start.addMySim(`Commuter ${i}`, home.x, home.y).ok).toBe(true));
    const saved = saveCity(start);
    const a = loadCity(saved), b = loadCity(saved);
    const plan = structuredClone(a.fields.travel);
    const first = a.mySimCommute(a.state.mySims[0]!.id);
    expect(first).not.toBeNull();
    const original = structuredClone(first);
    for (let k = 0; k < 3; k++) for (const sim of a.state.mySims) expect(a.mySimCommute(sim.id)).not.toBeNull();
    expect(first).toEqual(original);
    expect(a.fields.travel).toEqual(plan);
    expect(saveCity(a)).toEqual(saveCity(b));
    a.step(60);
    b.step(60);
    expect(saveCity(a)).toEqual(saveCity(b));
  }, 30_000);

  it('move into a home and think about local conditions and the commute', () => {
    const city = town();
    const home = homes(city)[0]!;
    const res = city.addMySim('Ana', home.x, home.y);
    expect(res.ok).toBe(true);
    expect(res.sim!.wealth).toBe(0);
    const subjects = city.mySimThoughts(res.sim!.id).map((t) => t.subject);
    expect(subjects).toEqual(expect.arrayContaining(['health', 'education', 'crime', 'pollution', 'commute']));
    expect(city.addMySim('Nobody', 5, 40).ok).toBe(false); // not a home
  }, 30_000);

  it('a bus stop by the house pleases R$ Sims; a nuclear plant nearby does not', () => {
    const city = town();
    // A home between the stop's row (11) and the plant (rows 31–34): near enough to both.
    const home = homes(city).find((b) => b.x > 10 && b.x < 36 && b.y + b.h / 2 >= 14 && b.y + b.h / 2 <= 17)!;
    const sim = city.addMySim('Bo', home.x, home.y).sim!;
    expect(city.placeStructure('busStop', home.x, 11).ok).toBe(true);
    expect(city.mySimThoughts(sim.id)).toContainEqual({ subject: 'bus', approve: true });
    city.state.unlocked.push('nuclearPlant');
    expect(city.placeStructure('nuclearPlant', home.x, 31).ok).toBe(true);
    expect(city.mySimThoughts(sim.id)).toContainEqual({ subject: 'rat', approve: false });
  }, 30_000);

  it('takes a job of their wealth level, and the commute to it is timed', () => {
    const city = town();
    const home = homes(city)[0]!;
    const sim = city.addMySim('Cy', home.x, home.y).sim!;
    const factory = [...city.state.buildings.values()].find((b) => b.type === 'ID' && b.occupancy > 0)!;
    const office = [...city.state.buildings.values()].find((b) => b.type === 'IM' && b.occupancy > 0);
    if (office) expect(city.setMySimJob(sim.id, office.x, office.y).ok).toBe(true); // manufacturing also hires R$ workers
    expect(city.setMySimJob(sim.id, factory.x, factory.y).ok).toBe(true);
    const trip = city.mySimCommute(sim.id)!;
    expect(trip.time).toBeGreaterThan(0);
    expect(trip.time).toBeLessThan(250);
    // The workplace is abandoned: at month end the Sim loses the job, says so, and takes the closest
    // other job of their wealth.
    Object.assign(factory, { type: null, occupancy: 0, filled: 0, abandonReason: 'demand' });
    (city as unknown as { checkMySims(): void }).checkMySims(); // the month-end check (before anyone moves back in)
    expect(city.state.mySims[0]!.job).not.toBe(factory.id);
    const kinds = city.takeMySimNews().map((n) => n.kind);
    expect(kinds).toContain('jobGone');
    expect(kinds).toContain('newJob');
  }, 30_000);

  it.each([
    [0, 'IM', true], [0, 'IHT', true], [1, 'IHT', true], [2, 'IM', true], [2, 'Co$$', true], [1, 'ID', false], [2, 'Cs$', false],
  ] as const)('matches wealth %i to the workforce mix of %s (%s)', (wealth, type, allowed) => {
    const city = town();
    const home = homes(city)[0]!;
    home.type = (['R$', 'R$$', 'R$$$'] as const)[wealth];
    const sim = city.addMySim('Workforce', home.x, home.y).sim!;
    const factory = [...city.state.buildings.values()].find((b) => b.type === 'ID')!;
    factory.type = type;
    factory.occupancy = 1;
    expect(city.setMySimJob(sim.id, factory.x, factory.y).ok).toBe(allowed);
    if (allowed) {
      expect(sim.job).toBe(factory.id);
      (city as unknown as { checkMySims(): void }).checkMySims();
      expect(city.state.mySims.find((m) => m.id === sim.id)?.job).toBe(factory.id);
    }
  });

  it('automatically finds manufacturing work for a low-wealth newcomer', () => {
    const city = town();
    const home = homes(city)[0]!;
    const factory = [...city.state.buildings.values()].find((b) => b.type === 'ID')!;
    for (const b of city.state.buildings.values()) {
      if (b.id === factory.id) Object.assign(b, { type: 'IM', filled: 0, occupancy: 1 });
      else if (b.type?.[0] !== 'R') Object.assign(b, { type: null, filled: 0, occupancy: 0 });
    }
    for (const st of city.state.structures.values()) city.cfg.structures[st.kind].jobs = [0, 0, 0];
    const sim = city.addMySim('Manufacturing', home.x, home.y).sim!;
    expect(sim.job).toBe(factory.id);
  });

  it('finds a job on moving in; with none of their wealth for two months, moves out', () => {
    const city = town();
    const home = homes(city)[0]!;
    const sim = city.addMySim('Ed', home.x, home.y).sim!;
    expect(sim.job).not.toBe(0); // a newcomer looks for work first
    // Every R$ job gone: none to be found.
    for (const b of city.state.buildings.values()) if (b.type && b.type[0] !== 'R') Object.assign(b, { type: null, occupancy: 0, filled: 0 });
    for (const st of [...city.state.structures.values()]) if (city.cfg.structures[st.kind].jobs[0]! > 0) city.state.structures.delete(st.id);
    const check = () => (city as unknown as { checkMySims(): void }).checkMySims();
    check();
    expect(city.state.mySims).toHaveLength(1);
    city.state.day += 61;
    check();
    expect(city.state.mySims).toHaveLength(0);
    expect(city.takeMySimNews().map((n) => n.kind)).toContain('noJob');
  }, 30_000);

  it('with no home of their wealth left, a bulldozed-out Sim searches two months before leaving', () => {
    const city = town();
    const home = homes(city)[0]!;
    const sim = city.addMySim('Gu', home.x, home.y).sim!;
    // Every other R$ home empty: nowhere to go at once.
    for (const b of city.state.buildings.values()) if (b.type === 'R$' && b.id !== home.id) Object.assign(b, { type: null, occupancy: 0 });
    city.bulldoze(home.x, home.y, home.x + home.w - 1, home.y + home.h - 1);
    expect(city.state.mySims).toHaveLength(1);
    expect(sim.homelessSince).toBe(city.state.day);
    expect(city.takeMySimNews().map((n) => n.kind)).toContain('searching');
    const check = () => (city as unknown as { checkMySims(): void }).checkMySims();
    city.state.day += 30;
    check();
    expect(city.state.mySims).toHaveLength(1);
    city.state.day += 31;
    check();
    expect(city.state.mySims).toHaveLength(0);
    expect(city.takeMySimNews().map((n) => n.kind)).toContain('homeGone');
  }, 30_000);

  it('at the end of a long life an heir takes over the house', () => {
    const city = town();
    const home = homes(city)[0]!;
    const sim = city.addMySim('Hy', home.x, home.y).sim!;
    sim.since = city.state.day - 100 * 360; // older than any life expectancy
    (city as unknown as { checkMySims(): void }).checkMySims();
    expect(city.state.mySims).toHaveLength(1);
    expect(sim.generation).toBe(2);
    expect(sim.since).toBe(city.state.day);
    expect(city.takeMySimNews().map((n) => n.kind)).toContain('heir');
  }, 30_000);

  it('a job found again resets the jobless clock', () => {
    const city = town();
    const home = homes(city)[0]!;
    const sim = city.addMySim('Fi', home.x, home.y).sim!;
    const job = sim.job;
    const work = city.state.buildings.get(job)!;
    // Every R$ job gone: the Sim looks for work…
    const gone = [...city.state.buildings.values()].filter((b) => b.type && b.type[0] !== 'R');
    const saved = gone.map((b) => ({ b, type: b.type, occupancy: b.occupancy, filled: b.filled }));
    for (const b of gone) Object.assign(b, { type: null, occupancy: 0, filled: 0 });
    for (const st of [...city.state.structures.values()]) if (city.cfg.structures[st.kind].jobs[0]! > 0) city.state.structures.delete(st.id);
    const check = () => (city as unknown as { checkMySims(): void }).checkMySims();
    check();
    expect(sim.joblessSince).toBe(city.state.day);
    // …then takes one by hand; a later loss starts the clock again rather than counting from before.
    for (const s of saved) Object.assign(s.b, { type: s.type, occupancy: s.occupancy, filled: s.filled });
    expect(city.setMySimJob(sim.id, work.x, work.y).ok).toBe(true);
    expect(sim.joblessSince).toBeUndefined();
    Object.assign(work, { type: null, occupancy: 0, filled: 0 });
    for (const b of gone) Object.assign(b, { type: null, occupancy: 0, filled: 0 });
    city.state.day += 61;
    check();
    expect(city.state.mySims).toHaveLength(1); // jobless from today, not 61 days ago
  }, 30_000);

  it('dispatched somewhere, gives an opinion of it', () => {
    const city = town();
    const home = homes(city)[0]!;
    const sim = city.addMySim('Di', home.x, home.y).sim!;
    city.placeStructure('smallParkGreen', 40, 40);
    expect(city.dispatchMySim(sim.id, 40, 40)).toEqual([{ subject: 'park', approve: true }]);
    city.state.unlocked.push('nuclearPlant');
    expect(city.placeStructure('nuclearPlant', 20, 36).ok).toBe(true);
    expect(city.dispatchMySim(sim.id, 21, 37)).toEqual([{ subject: 'rat', approve: false }]);
    // A plain spot: local conditions.
    expect(city.dispatchMySim(sim.id, 44, 44).map((t) => t.subject)).toEqual(['health', 'education', 'crime', 'pollution']);
  }, 30_000);

  it('at most five; saved with the city; when their home goes they move, or leave with nowhere to go', () => {
    const city = town();
    const hs = homes(city);
    for (let k = 0; k < 5; k++) expect(city.addMySim(`S${k}`, hs[k]!.x, hs[k]!.y).ok).toBe(true);
    expect(city.addMySim('Sixth', hs[5]!.x, hs[5]!.y).ok).toBe(false);
    expect(loadCity(saveCity(city)).state.mySims).toHaveLength(5);
    const first = city.state.mySims[0]!;
    const home = city.state.buildings.get(first.home)!;
    // Their home bulldozed, a Sim moves to the closest home of their wealth…
    city.bulldoze(home.x, home.y, home.x + home.w - 1, home.y + home.h - 1);
    expect(city.state.mySims).toHaveLength(5);
    expect(first.home).not.toBe(home.id);
    expect(city.takeMySimNews()).toContainEqual(expect.objectContaining({ kind: 'moved', sim: expect.objectContaining({ name: 'S0' }) }));
    // …and with none left, moves out.
    for (const b of [...city.state.buildings.values()]) if (b.type === 'R$') { Object.assign(b, { type: null, occupancy: 0 }); }
    (city as unknown as { checkMySims(): void }).checkMySims();
    expect(city.state.mySims).toHaveLength(0);
  }, 30_000);
});

describe('Microphone tool (Rush Hour)', () => {
  it('a passer-by from the nearest home says what they think; nobody far from homes', async () => {
    const { sampleCity } = await import('../src');
    const city = sampleCity({ days: 90 });
    const home = [...city.state.buildings.values()].find((b) => b.type?.[0] === 'R' && b.occupancy > 0)!;
    const r = city.interview(home.x, home.y)!;
    expect(r).not.toBeNull();
    expect(r.home).toEqual({ x: home.x, y: home.y, w: home.w, h: home.h });
    expect(r.thoughts.length).toBeGreaterThan(0);
    expect(city.interview(2, 2)).toBeNull(); // open country
  }, 60_000);
});
