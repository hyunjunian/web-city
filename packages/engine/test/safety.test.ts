import { describe, expect, it } from 'vitest';
import { City, loadCity, saveCity, type CityOptions } from '../src';
import { criminality, ignite } from '../src/sim/safety';
import { sampleCity } from '../src/sample';

describe('public crime statistics', () => {
  it('does not expose mutable crime counts or incident coordinates from the city state', () => {
    const city = new City({ size: 16, water: false });
    city.state.safety.byType = { burglary: 2 };
    city.state.safety.spots = [[17, 'burglary']];
    const stats = city.stats();
    stats.safety.byType!.burglary = 100;
    stats.safety.spots![0]![0] = 99;
    stats.safety.spots!.push([18, 'robbery']);
    expect(city.state.safety.byType).toEqual({ burglary: 2 });
    expect(city.state.safety.spots).toEqual([[17, 'burglary']]);
  });
});

/** Powered town with homes and industry. */
function town(config?: CityOptions['config'], seed = 5): City {
  const n = 48;
  const city = new City({ size: n, seed, difficulty: 'easy', water: false, config });
  city.state.funds = 5_000_000;
  city.buildNetwork(0, 20, n - 1, 20, 'road');
  city.zone(1, 8, n - 2, 19, 'R-medium');
  city.zone(1, 21, n - 2, 30, 'I-medium');
  city.placeStructure('gasPlant', 1, 33);
  return city;
}

const structures = (c: City, kind: string) => [...c.state.structures.values()].filter((s) => s.kind === kind);

describe('crime', () => {
  it('criminality follows the EQ chart (EQ 100 R$$ = 11%) plus unemployment', () => {
    const city = town();
    const census = { ...city.census, avgEq: [0, 100, 200] as [number, number, number], workers: [100, 100, 100] as [number, number, number], unemployed: [5, 5, 5] as [number, number, number] };
    const c = criminality(city.cfg, census);
    expect(c[0]).toBeCloseTo(0.4);
    expect(c[1]).toBeCloseTo(0.11);
    expect(c[2]).toBeCloseTo(0);
    census.unemployed = [15, 15, 15];
    expect(criminality(city.cfg, census)[1]).toBeCloseTo(0.16); // a bad economy: 15% out of work
  });

  it('police stations cover a radius, strongest at the centre, and add up', () => {
    const city = town();
    city.placeStructure('smallPoliceStation', 20, 2);
    const centre = city.query(21, 3)!.policeProtection;
    expect(centre).toBeGreaterThan(180);
    expect(city.query(21, 3 + 20)!.policeProtection).toBeLessThan(centre / 3);
    city.placeStructure('policeKiosk', 25, 3);
    expect(city.query(23, 3)!.policeProtection).toBeGreaterThan(centre);
  });

  it('police prevent crimes and make arrests', () => {
    const run = (police: boolean) => {
      const city = town({ safety: { fires: false } }, 9);
      if (police) {
        city.placeStructure('largePoliceStation', 22, 4);
        city.placeStructure('largePoliceStation', 22, 31);
      }
      let crimes = 0;
      let arrests = 0;
      let prevented = 0;
      let inmates = 0;
      for (let m = 0; m < 48; m++) {
        city.step(30);
        crimes += city.state.safety.crimes;
        arrests += city.state.safety.arrests;
        prevented += city.state.safety.prevented;
        inmates = Math.max(inmates, structures(city, 'largePoliceStation').reduce((a, s) => a + s.load, 0));
      }
      return { crimes, arrests, prevented, city, inmates };
    };
    const none = run(false);
    const covered = run(true);
    expect(none.crimes).toBeGreaterThan(0);
    expect(none.arrests).toBe(0);
    expect(covered.arrests).toBeGreaterThan(0);
    expect(covered.prevented).toBeGreaterThan(0);
    expect(covered.crimes).toBeLessThan(none.crimes);
    expect(covered.inmates).toBeGreaterThan(0); // arrests fill station cells
  }, 60_000);

  it('crime lowers desirability', () => {
    const city = town();
    const before = city.query(10, 12)!.desirability['R$$'].factors.crime!;
    city.state.crime.fill(5);
    city.refresh();
    expect(city.query(10, 12)!.desirability['R$$'].factors.crime!).toBeLessThan(before);
    expect(city.query(10, 12)!.desirability['R$$'].factors.crime!).toBeLessThan(0);
  });

  it('cutting funding leads to strikes that cut coverage to 20%', () => {
    const city = town({ safety: { fires: false } });
    city.placeStructure('smallPoliceStation', 20, 2);
    const st = structures(city, 'smallPoliceStation')[0]!;
    const full = city.query(21, 3)!.policeProtection;
    city.setFunding(st.id, 10);
    for (let m = 0; m < 60 && !st.strike; m++) city.step(30);
    expect(st.strike).toBeGreaterThan(0);
    // The advisor says so (pickets outside the station).
    expect(city.advisors().some((a) => a.code === 'policeStrike')).toBe(true);
    city.setFunding(st.id, 100);
    city.refresh();
    // Radius and strength both shrink to 20% while the strike lasts.
    if (st.strike) {
      const p = city.query(21, 3)!.policeProtection;
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThanOrEqual(full * 0.2);
    }
  }, 60_000);
});

describe('fire', () => {
  it('fires catch on trees, spread through woods, and burn them away', () => {
    const city = new City({ size: 32, seed: 2, water: false, config: { safety: { treeFire: { spread: 0.5, burnDays: 3 } } } });
    for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) city.state.trees[y * 32 + x] = 40;
    city.refresh();
    city.disaster('lightning', 10, 10);
    expect(city.state.treeFires.length).toBe(1);
    expect(city.stats().safety.burning).toBe(1);
    const copy = loadCity(JSON.parse(JSON.stringify(saveCity(city))));
    expect(copy.state.treeFires).toEqual(city.state.treeFires);
    for (let d = 0; d < 20; d++) {
      city.step(1);
      const tiles = city.state.treeFires.map((t) => t.i);
      expect(new Set(tiles).size).toBe(tiles.length); // no tile burns twice over
    }
    let left = 0;
    for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) if (city.state.trees[y * 32 + x]) left++;
    expect(left).toBeLessThan(90); // it spread and burned more than the one tile
    expect(city.state.trees[3 * 32 + 3]).toBe(0); // bare ground never burns
  });

  it('an unprotected fire grows and burns the building down to rubble', () => {
    const city = town({ safety: { fires: false } });
    city.step(120);
    const b = [...city.state.buildings.values()].find((x) => x.type?.startsWith('R'))!;
    expect(city.igniteAt(b.x, b.y)).toBe(true);
    expect(city.query(b.x, b.y)!.burning).toBe(true);
    // A burning building can't be bulldozed.
    expect(city.bulldoze(b.x, b.y, b.x, b.y).ok).toBe(false);
    city.step(25);
    expect(city.state.buildings.has(b.id)).toBe(false);
    expect(city.query(b.x, b.y)!.rubble).toBe(true);
    expect(city.state.fireTally.burned + city.state.safety.burned).toBeGreaterThan(0);
    // Rubble blocks development until bulldozed.
    expect(city.bulldoze(b.x, b.y, b.x + b.w - 1, b.y + b.h - 1).ok).toBe(true);
    expect(city.query(b.x, b.y)!.rubble).toBe(false);
  }, 30_000);

  it('fires inside a fire station radius go out before they show', () => {
    const city = town({ safety: { fires: false } });
    city.placeStructure('largeFireStation', 20, 5);
    city.step(120);
    const near = [...city.state.buildings.values()].find((x) => Math.hypot(x.x - 21, x.y - 6) < 10)!;
    expect(city.query(near.x, near.y)!.fireProtection).toBeGreaterThan(40);
    expect(city.igniteAt(near.x, near.y)).toBe(false);
  }, 30_000);

  it('a fire leaves a short-term desirability scar around it', () => {
    const city = town({ safety: { fires: false } });
    city.step(90);
    const b = [...city.state.buildings.values()].find((x) => x.type?.startsWith('R'))!;
    city.igniteAt(b.x, b.y);
    city.refresh();
    expect(city.query(b.x, b.y + 1)!.desirability['R$'].factors.events!).toBeLessThan(0);
    expect(city.state.events.length).toBe(1);
  }, 30_000);

  it('dry and abandoned buildings are more flammable', () => {
    const city = town({ safety: { fires: false } });
    city.step(90);
    const b = [...city.state.buildings.values()].find((x) => x.type)!;
    const dry = city.query(b.x, b.y)!.flammability;
    b.type = null;
    city.refresh();
    expect(city.query(b.x, b.y)!.flammability).toBeCloseTo(dry * 1.5);
  }, 30_000);

  it('saves rubble, crime and fires', () => {
    const city = town({ safety: { fires: false } });
    city.step(90);
    const b = [...city.state.buildings.values()].find((x) => x.type)!;
    city.igniteAt(b.x, b.y);
    city.state.rubble[0] = 1;
    city.state.crime[5] = 1.25;
    const copy = loadCity(JSON.parse(JSON.stringify(saveCity(city))));
    expect(copy.state.fires.length).toBe(1);
    expect(copy.state.rubble[0]).toBe(1);
    expect(copy.state.crime[5]).toBeCloseTo(1.25);
  }, 30_000);
});

describe('wind', () => {
  it('changes monthly and is saved', async () => {
    const { loadCity, saveCity } = await import('../src');
    const city = new City({ size: 32, water: false });
    city.step(30);
    const w = { ...city.state.wind };
    expect(w.strength).toBeGreaterThanOrEqual(0);
    expect(w.strength).toBeLessThanOrEqual(1);
    const copy = loadCity(JSON.parse(JSON.stringify(saveCity(city))));
    expect(copy.state.wind).toEqual(w);
  });
});

describe('Department of Corrections', () => {
  it('jails are funded together, their cells following the department', () => {
    const city = town();
    expect(city.placeStructure('cityJail', 30, 31).ok).toBe(true);
    const jail = [...city.state.structures.values()].find((st) => st.kind === 'cityJail')!;
    expect(city.setFunding(jail.id, 50)).toBe(false);
    city.step(30);
    const full = jail.capacity;
    city.setDepartmentFunding('corrections', 50);
    city.step(30);
    expect(jail.capacity).toBeLessThan(full);
  }, 30_000);
});

describe('arsonists', () => {
  it('strike after a few days unless police on the scene lock them up first', () => {
    const calm = { mayor: { riots: false } } as const;
    const burns = town(calm);
    burns.step(120);
    const b = [...burns.state.buildings.values()].find((x) => x.type)!;
    burns.state.arsonists.push({ target: b.id, x: b.x, y: b.y, days: 3 });
    expect(loadCity(saveCity(burns)).state.arsonists).toHaveLength(1);
    burns.step(3);
    expect(burns.state.arsonists).toHaveLength(0);
    expect(burns.state.fires.some((f) => f.target === b.id) || !burns.state.buildings.get(b.id)?.type).toBe(true);

    const caught = town(calm);
    expect(caught.placeStructure('smallPoliceStation', 22, 31).ok).toBe(true);
    caught.step(120);
    const c = [...caught.state.buildings.values()].find((x) => x.type && Math.abs(x.x - 22) < 10)!;
    caught.state.arsonists.push({ target: c.id, x: c.x, y: c.y, days: 7 });
    const arrests = caught.state.safety.arrests;
    caught.step(7); // the police are sent (auto-dispatch) and get there in time
    expect(caught.state.arsonists).toHaveLength(0);
    expect(caught.state.fires.some((f) => f.target === c.id)).toBe(false);
    expect(caught.state.safety.arrests).toBe(arrests + 1);
  }, 30_000);
});

describe('dispatch units', () => {
  it('toxic spills get a fire engine, not the Fire Plane (it can\'t foam them)', () => {
    const city = new City({ size: 64, water: false });
    city.state.funds = 1_000_000;
    city.buildNetwork(0, 10, 63, 10, 'road');
    expect(city.placeStructure('smallFireStation', 2, 11).ok).toBe(true);
    city.state.unlocked.push('fireLandingStrip');
    expect(city.placeStructure('fireLandingStrip', 40, 20).ok).toBe(true);
    city.state.spills.push({ i: 12 * 64 + 45, months: 0 });
    city.step(1);
    const sent = city.state.units.filter((u) => u.kind === 'fire');
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((u) => !u.air)).toBe(true);
  });

  it("fire trucks can't reach fires over half a medium map away in time", () => {
    const city = new City({ size: 128, water: false });
    city.state.funds = 100_000;
    city.buildNetwork(0, 10, 127, 10, 'road');
    expect(city.placeStructure('smallFireStation', 2, 11).ok).toBe(true);
    expect(city.dispatch('fire', 100, 12).message).toBe('too far from any fire station');
    expect(city.dispatch('fire', 50, 12).ok).toBe(true);
  });

  it('stations send a fixed number of units, which come back after a few days', () => {
    const city = new City({ size: 64, water: false });
    city.state.funds = 100_000;
    city.buildNetwork(0, 10, 63, 10, 'road');
    city.placeStructure('smallPoliceStation', 5, 11); // two cars
    expect(city.dispatch('police', 30, 12).ok).toBe(true);
    expect(city.dispatch('police', 40, 12).ok).toBe(true);
    expect(city.dispatch('police', 50, 12).message).toBe('no free units');
    city.step(5);
    expect(city.state.units).toHaveLength(0);
    expect(city.dispatch('police', 50, 12).ok).toBe(true);
  });

  it('on site, a unit adds its protection', () => {
    const city = new City({ size: 64, water: false });
    city.state.funds = 100_000;
    city.buildNetwork(0, 10, 63, 10, 'road');
    city.placeStructure('smallPoliceStation', 5, 11);
    city.refresh();
    expect(city.query(50, 12)!.policeProtection).toBe(0);
    city.dispatch('police', 50, 12);
    city.refreshIfDirty();
    expect(city.query(50, 12)!.policeProtection).toBeCloseTo(200);
  });

  it('fire trucks need a road near the fire; planes do not; underfunded crews fumble', () => {
    const city = new City({ size: 64, water: false });
    city.state.funds = 1_000_000;
    city.buildNetwork(0, 10, 63, 10, 'road');
    city.placeStructure('smallFireStation', 5, 11);
    expect(city.dispatch('fire', 40, 40).message).toMatch(/road/);
    city.state.unlocked.push('fireLandingStrip');
    expect(city.placeStructure('fireLandingStrip', 20, 30).ok).toBe(true);
    // The strip's trucks can't reach either, but its plane can.
    expect(city.dispatch('fire', 40, 50).ok).toBe(true);
    expect(city.state.units.at(-1)!.air).toBe(true);
    const station = [...city.state.structures.values()].find((s) => s.kind === 'smallFireStation')!;
    city.setFunding(station.id, 50);
    expect(city.dispatch('fire', 20, 12).ok).toBe(true);
    expect(city.state.units.at(-1)!.competence).toBeLessThan(0.5);
  });

  it('ground units drive the roads: a station on a separate road cannot reach', () => {
    const city = new City({ size: 64, water: false });
    city.state.funds = 100_000;
    city.buildNetwork(0, 10, 63, 10, 'road');
    city.buildNetwork(0, 40, 63, 40, 'road');
    city.placeStructure('smallPoliceStation', 5, 41);
    expect(city.dispatch('police', 30, 12).message).toBe('no road to get there');
    // Joined far out east: the trip is long, by road.
    city.buildNetwork(63, 10, 63, 40, 'road');
    const res = city.dispatch('police', 30, 12);
    expect(res.ok).toBe(true);
    expect(city.state.units.at(-1)!.travel).toBe(2); // ~120 tiles of road at 48 a day
    // Its route follows the roads tile by tile, from the station to the call.
    const path = city.state.units.at(-1)!.path!;
    const n = city.size;
    expect(path.at(-1)).toBe(12 * n + 30);
    for (let k = 1; k < path.length - 1; k++) {
      const a = path[k - 1]!;
      const b = path[k]!;
      expect(Math.abs((a % n) - (b % n)) + Math.abs(Math.floor(a / n) - Math.floor(b / n))).toBe(1);
      expect(city.query(b % n, Math.floor(b / n))!.network).toBe('road');
    }
    expect(path.some((t) => t % n === 63)).toBe(true); // round by the east edge
  });
});

describe('maximum fire stage (Rush Hour tables)', () => {
  it('comes from the structure where one is listed', async () => {
    const { DEFAULT_CONFIG } = await import('../src');
    const s = DEFAULT_CONFIG.structures;
    expect(s.area51.maxFire).toBe(5);
    expect(s.fireLandingStrip.maxFire).toBe(2);
    expect(s.largeWaterPump.maxFire).toBe(3);
    expect(s.lighthouse.maxFire).toBeUndefined(); // 4, the default
  });
});


describe('Federal Prison', () => {
  it('is a super jail that never overflows, charging §10 a month per extra inmate', () => {
    const city = new City({ size: 32, water: false, config: { safety: { fires: false } } });
    city.state.funds = 1_000_000;
    city.state.unlocked.push('federalPrison');
    city.buildNetwork(0, 10, 31, 10, 'road');
    expect(city.placeStructure('federalPrison', 4, 11).ok).toBe(true);
    const prison = [...city.state.structures.values()].find((x) => x.kind === 'federalPrison')!;
    city.step(30);
    expect(prison.capacity).toBe(3_000);
    prison.load = 4_000;
    city.step(30);
    expect(prison.load).toBeGreaterThan(3_000); // nobody paroled
    expect(city.state.lastBudget!.safetyUpkeep).toBeGreaterThanOrEqual(8_000);
    expect(city.enactOrdinance('neighborhoodWatch').ok).toBe(false); // a prison is not a police station
  });
});

describe('crime kinds and places', () => {
  it('bank robberies and stick-ups need shops or offices; the rest strike homes too', () => {
    const city = new City({ size: 48, seed: 4, difficulty: 'easy', water: false, config: { safety: { fires: false }, development: { requirePower: false, requireWater: false } } });
    city.state.funds = 1_000_000;
    city.buildNetwork(0, 20, 47, 20, 'road');
    city.zone(1, 10, 46, 19, 'R-low');
    city.zone(1, 21, 46, 30, 'I-medium');
    const seen: Record<string, number> = {};
    for (let m = 0; m < 60; m++) {
      city.step(30);
      for (const [k, v] of Object.entries(city.state.safety.byType ?? {})) seen[k] = (seen[k] ?? 0) + v;
    }
    const total = Object.values(seen).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(5);
    for (const k of ['bankRobbery', 'stickUp', 'drugs', 'purseSnatching', 'solicitation']) expect(seen[k] ?? 0).toBe(0);
  }, 60_000);

  it('a burning plant that explodes leaves no fire behind on it', () => {
    const city = new City({ size: 64, seed: 1, difficulty: 'medium', water: false });
    city.state.funds = 2_000_000;
    city.buildNetwork(0, 32, 63, 32, 'road');
    city.buildNetwork(32, 0, 32, 63, 'road');
    city.zone(1, 20, 62, 31, 'R-medium');
    city.zone(33, 33, 62, 44, 'I-medium');
    expect(city.placeStructure('coalPlant', 2, 39).ok).toBe(true);
    city.step(25);
    const plant = [...city.state.structures.values()].find((s) => s.kind === 'coalPlant')!;
    plant.life = 100; // worn out: explodes at the month's end
    expect(city.igniteAt(plant.x, plant.y)).toBeTruthy();
    city.step(5); // to the month's end, where it goes up
    const s = city.state;
    expect(s.structures.has(plant.id)).toBe(false);
    // Every fire burns something that still stands, once.
    for (const f of s.fires) expect(f.target > 0 ? s.buildings.has(f.target) : s.structures.has(-f.target)).toBe(true);
    expect(new Set(s.fires.map((f) => f.target)).size).toBe(s.fires.length);
  }, 60_000);
});

describe('automatic dispatch', () => {
  it('sends a crew that can help, past a nearer station too underfunded to', () => {
    const a = sampleCity({ seed: 1 });
    const s = a.state;
    const near = [...s.structures.values()].find((st) => st.id === 2)!;
    expect(a.cfg.structures[near.kind].fire).toBeTruthy();
    a.setFunding(near.id, 0);
    const b = [...s.buildings.values()].filter((x) => Math.hypot(x.x - 60, x.y - 45) < 12)
      .sort((x, y) => a.fields.fireCover[x.y * s.size + x.x]! - a.fields.fireCover[y.y * s.size + y.x]!)[0]!;
    ignite((a as unknown as { fireContext(): Parameters<typeof ignite>[0] }).fireContext(), b.id, 3);
    a.step(2);
    const sent = s.units.filter((u) => u.kind === 'fire');
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((u) => u.station !== near.id && u.competence >= 0.5)).toBe(true);
  }, 60_000);

  it('counts the crews it would send apart from those too underfunded to', () => {
    const a = sampleCity({ seed: 1, days: 0 });
    const all = a.freeUnits('fire');
    const fit = a.freeUnits('fire', true);
    expect(fit).toBe(all);
    const near = [...a.state.structures.values()].find((st) => st.id === 2)!;
    a.setFunding(near.id, 0);
    expect(a.freeUnits('fire')).toBe(all);
    expect(a.freeUnits('fire', true)).toBeLessThan(all);
  }, 60_000);
});

