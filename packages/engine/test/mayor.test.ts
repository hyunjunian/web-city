import { describe, expect, it } from 'vitest';
import { City, loadCity, saveCity } from '../src';
import { mayorAt, ordinanceEffects, riotCheck, stepMobs } from '../src/sim/mayor';
import { Rng } from '../src/rng';
import { advise } from '../src/sim/advisors';

function town(): City {
  const n = 48;
  const city = new City({ size: n, seed: 5, difficulty: 'easy', water: false, config: { safety: { fires: false } } });
  city.state.funds = 5_000_000;
  city.buildNetwork(0, 20, n - 1, 20, 'road');
  city.zone(1, 8, n - 2, 19, 'R-medium');
  city.zone(1, 21, n - 2, 30, 'I-medium');
  city.placeStructure('gasPlant', 1, 33);
  return city;
}

const home = (c: City) => [...c.state.buildings.values()].find((b) => b.type?.startsWith('R'))!;

describe('mayor rating', () => {
  it('sums the rating factors for a residential lot', () => {
    const city = town();
    city.step(120);
    const b = home(city);
    const m = city.mayorAt(b.x, b.y)!;
    expect(m.school).toBe(-7); // no schools
    expect(m.hospital).toBe(-7); // no hospitals
    expect(m.garbage).toBeLessThanOrEqual(10);
    const sum = m.crime + m.air + m.water + m.garbage + m.nimby + m.school + m.hospital + m.commute + m.noise
      + m.valueWealth + m.ordinances + m.taxes + m.events;
    expect(m.total).toBeCloseTo(Math.max(-100, Math.min(100, sum)));
  }, 30_000);

  it('a busy highway beside a home is noise, though the home fronts a quiet road', () => {
    const city = town();
    city.step(120);
    const b = home(city);
    const quiet = city.mayorAt(b.x, b.y)!.noise;
    // Elevated highway traffic along the lot's row, as a month's assignment would leave it.
    for (let x = 0; x < city.size; x++) city.fields.highTraffic[(b.y - 1 >= 0 ? b.y - 1 : b.y + b.h) * city.size + x] = 5_000;
    city.refresh({ travel: false });
    expect(city.fields.highwayNoise[b.y * city.size + b.x]).toBeGreaterThan(0);
    expect(city.mayorAt(b.x, b.y)!.noise).toBeLessThan(quiet);
  }, 30_000);

  it('schools and hospitals raise it (+7 each instead of −7)', () => {
    const city = town();
    city.step(120);
    const b = home(city);
    const before = city.mayorAt(b.x, b.y)!;
    city.placeStructure('medicalClinic', 1, 1);
    city.placeStructure('elementarySchool', 3, 0);
    city.placeStructure('highSchool', 8, 0);
    const after = city.mayorAt(b.x, b.y)!;
    expect(after.hospital).toBe(7);
    expect(after.school).toBe(7);
    expect(city.state.events.length).toBe(3); // each civic building cheers its area
    expect(after.total).toBeGreaterThan(before.total);
  }, 30_000);

  it('raising residential taxes makes those residents unhappy (tax change table)', () => {
    const city = town();
    city.step(60);
    city.setTaxRate('R$$', 14); // +5 points
    city.step(30);
    const mood = city.state.taxMood.find((m) => m.wealth === 1)!;
    expect(mood.amount).toBe(-10);
    expect(city.stats().mayorRating).toBeLessThan(50);
  }, 30_000);

  it('a sudden tax rise costs more than the same rise a point a month', () => {
    const peak = (steps: number[]) => {
      const city = town();
      city.step(60);
      let worst = 0;
      let rate = city.state.taxRates['R$'];
      for (const d of [...steps, 0, 0]) {
        rate += d;
        city.setTaxRate('R$', rate);
        city.step(30);
        worst = Math.min(worst, city.taxMoodOf(0));
      }
      return worst;
    };
    expect(peak([5])).toBeLessThan(peak([1, 1, 1, 1, 1]));
  }, 60_000);

  it('computes a citywide rating each month', () => {
    const city = town();
    city.step(90);
    expect(Number.isFinite(city.stats().mayorRating)).toBe(true);
  }, 30_000);
});

describe('land value vs. wealth', () => {
  it('poor Sims on dear land blame the mayor; rich Sims on cheap land thank them', () => {
    const city = new City({ size: 32, seed: 1, water: false });
    const f = city.fields;
    const max = city.cfg.desirability.waterLandValue.max;
    f.landValue[0] = max; // high
    f.landValue[1] = 0; // low
    const at = (i: number, w: 0 | 1 | 2) => mayorAt(city.state, f, city.cfg, i, w, 30, 0, 0).valueWealth;
    expect(at(0, 0)).toBe(-5);
    expect(at(1, 2)).toBe(5);
    expect(at(0, 2)).toBe(0);
  });
});

describe('ordinances', () => {
  it('landfill gas needs a landfill joined to the city, and lapses if the road is cut', () => {
    const city = new City({ size: 32, water: false, config: { safety: { fires: false }, disasters: { simulated: false } } });
    city.state.funds = 1_000_000;
    city.placeStructure('gasPlant', 2, 2);
    city.zone(20, 20, 23, 23, 'landfill');
    expect(city.ordinanceAvailable('landfillGas')).toBe(false);
    city.buildNetwork(19, 19, 19, 24, 'road'); // a road stub beside the landfill
    expect(city.ordinanceAvailable('landfillGas')).toBe(false);
    city.buildNetwork(1, 2, 1, 19, 'road');
    city.buildNetwork(1, 19, 19, 19, 'road');
    expect(city.ordinanceAvailable('landfillGas')).toBe(true);
    expect(city.enactOrdinance('landfillGas').ok).toBe(true);
    city.bulldoze(10, 19, 10, 19);
    expect(city.ordinanceAvailable('landfillGas')).toBe(false);
    city.step(30);
    expect(city.state.ordinances).not.toContain('landfillGas');
    expect(city.takeRepealedOrdinances()).toContain('landfillGas');
  });

  it('gambling pays §100 a month and raises crime', () => {
    const city = town();
    expect(city.enactOrdinance('legalizeGambling').ok).toBe(true);
    expect(city.ordinanceCost('legalizeGambling')).toBe(-100);
    city.step(30);
    expect(city.state.lastBudget!.ordinanceIncome).toBe(100);
    expect(ordinanceEffects(city.state).crime).toBeCloseTo(1.2);
  });

  it('bills an ordinance by the days it was in effect, kept across a save', () => {
    const city = new City({ size: 32, seed: 1, water: false });
    city.step(20);
    expect(city.enactOrdinance('legalizeGambling').ok).toBe(true);
    const copy = loadCity(saveCity(city));
    for (const c of [city, copy]) {
      c.step(10);
      expect(c.state.lastBudget!.ordinanceIncome).toBeCloseTo(100 / 3, 5); // 10 days of 30
    }
    // Repealed a day before the month ends: still charged for the 29 days.
    expect(city.enactOrdinance('carpool').ok).toBe(true);
    const cost = city.ordinanceCost('carpool');
    city.step(29);
    city.repealOrdinance('carpool');
    city.step(1);
    expect(city.state.lastBudget!.ordinanceCost).toBeCloseTo((cost * 29) / 30, 0);
  });

  it('costs follow their formulas and effects stack', () => {
    const city = town();
    city.step(60);
    const r = city.stats().population;
    expect(city.ordinanceCost('youthCurfew')).toBeCloseTo(40 + 0.002 * city.census.residents.reduce((a, b) => a + b, 0), 5);
    expect(r).toBeGreaterThan(0);
    city.enactOrdinance('youthCurfew');
    city.enactOrdinance('legalizeGambling');
    const e = ordinanceEffects(city.state);
    expect(e.crime).toBeCloseTo(0.95 * 1.2);
    expect(e.mayorRating).toBe(-10);
  }, 30_000);

  it('some ordinances need a building first', () => {
    const city = town();
    expect(city.ordinanceAvailable('neighborhoodWatch')).toBe(false);
    expect(city.enactOrdinance('neighborhoodWatch').ok).toBe(false);
    city.placeStructure('policeKiosk', 5, 5);
    expect(city.enactOrdinance('neighborhoodWatch').ok).toBe(true);
    expect(city.repealOrdinance('neighborhoodWatch').ok).toBe(true);
  });

  it('Nuclear Free Zone removes nuclear plants and blocks new ones', () => {
    const city = town();
    city.state.unlocked.push('nuclearPlant');
    city.placeStructure('nuclearPlant', 40, 33);
    city.enactOrdinance('nuclearFreeZone');
    expect([...city.state.structures.values()].some((s) => s.kind === 'nuclearPlant')).toBe(false);
    expect(city.placeStructure('nuclearPlant', 40, 33).ok).toBe(false);
  });

  it.each(['nuclearPlant', 'casino'] as const)('closes a burning %s without leaving a fire on an empty lot', (kind) => {
    const city = new City({ size: 32, water: false, config: { safety: { fires: false }, disasters: { simulated: false } } });
    city.state.funds = 1_000_000;
    city.state.unlocked.push(kind);
    if (kind === 'casino') city.enactOrdinance('legalizeGambling');
    expect(city.placeStructure(kind, 3, 3).ok).toBe(true);
    expect(city.placeStructure('smallPoliceStation', 20, 3).ok).toBe(true);
    expect(city.igniteAt(3, 3)).toBe(true);
    expect(city.igniteAt(20, 3)).toBe(true);
    const unrelated = city.state.fires.find((fire) => fire.target !== -1)!;
    const result = kind === 'casino' ? city.repealOrdinance('legalizeGambling') : city.enactOrdinance('nuclearFreeZone');
    expect(result.ok).toBe(true);
    expect(city.state.fires).toEqual([unrelated]);
    expect(city.stats().safety.burning).toBe(1);
    expect(city.state.occupant[3 * 32 + 3]).toBe(0);
    expect(loadCity(saveCity(city)).state.fires).toEqual([unrelated]);
  });

  it('water conservation cuts water use 10%', () => {
    const city = town();
    city.placeStructure('waterPump', 20, 6);
    city.step(60);
    city.refresh();
    const before = city.water.demand;
    city.enactOrdinance('waterConservation');
    city.refresh();
    expect(city.water.demand).toBeCloseTo(before * 0.9, 0);
  }, 30_000);

  it('lapse when the facility they need is gone', () => {
    const city = town();
    const rc = city.placeStructure('recyclingCenter', 20, 33);
    expect(rc.ok).toBe(true);
    expect(city.enactOrdinance('trashPresort').ok).toBe(true);
    const st = [...city.state.structures.values()].find((t) => t.kind === 'recyclingCenter')!;
    city.bulldoze(st.x, st.y, st.x + st.w - 1, st.y + st.h - 1);
    city.step(31);
    expect(city.state.ordinances).not.toContain('trashPresort');
    expect(ordinanceEffects(city.state).garbage).toBe(1);
    expect(city.takeRepealedOrdinances()).toEqual(['trashPresort']);
    expect(city.takeRepealedOrdinances()).toEqual([]);
  }, 30_000);

  it('are saved', () => {
    const city = town();
    city.enactOrdinance('legalizeGambling');
    const copy = loadCity(JSON.parse(JSON.stringify(saveCity(city))));
    expect(copy.state.ordinances).toEqual(['legalizeGambling']);
  });
});

describe("Mayor's Limo", () => {
  it('throwing money needs the Mayor’s House and cheers the area for a while', () => {
    const city = town();
    city.step(60);
    const b = home(city);
    expect(city.throwMoney(b.x, b.y).ok).toBe(false);
    city.state.unlocked.push('mayorsHouse');
    expect(city.placeStructure('mayorsHouse', 1, 1).ok).toBe(true);
    const before = city.mayorAt(b.x, b.y)!.events;
    const res = city.throwMoney(b.x, b.y);
    expect(res.cost).toBe(50);
    city.refreshIfDirty();
    expect(city.mayorAt(b.x, b.y)!.events).toBeGreaterThan(before);
  }, 30_000);
});

describe('riots', () => {
  const mobTown = (autoDispatch: boolean) => {
    const city = town();
    city.state.funds = 1_000_000;
    (city.cfg.safety as { autoDispatch: boolean }).autoDispatch = autoDispatch;
    city.step(60);
    const b = home(city);
    city.state.mobs.push({ id: 999, x: b.x, y: b.y, stage: 1, energy: 60, days: 0 });
    return { city, b };
  };

  it('an unchecked mob climbs to the fifth stage and starts throwing Molotovs', () => {
    const { city } = mobTown(false);
    city.step(5);
    expect(city.state.mobs[0]!.stage).toBe(5);
    // Molotovs fly on about one day in four (from this mob alone: it has split already).
    city.state.mobs[0]!.split = true;
    city.state.mobs.length = 1;
    const rng = new Rng(1);
    let thrown = 0;
    for (let d = 0; d < 40; d++) thrown += stepMobs(city.state, city.fields, city.cfg, rng).length;
    expect(thrown).toBeGreaterThan(3);
    expect(thrown).toBeLessThan(20);
  }, 30_000);

  it('police that reach it calm it down; fumbling crews do not', () => {
    const { city, b } = mobTown(false);
    city.buildNetwork(0, 32, 47, 32, 'road');
    city.buildNetwork(47, 20, 47, 32, 'road'); // the station's road joins the town's
    expect(city.placeStructure('largePoliceStation', 10, 33).ok).toBe(true);
    // Send several police units as soon as it starts.
    for (let k = 0; k < 3; k++) expect(city.dispatch('police', b.x, b.y).ok).toBe(true);
    city.step(8);
    expect(city.state.mobs).toHaveLength(0);
    const weak = mobTown(false);
    weak.city.buildNetwork(0, 32, 47, 32, 'road');
    weak.city.buildNetwork(47, 20, 47, 32, 'road');
    weak.city.placeStructure('largePoliceStation', 10, 33);
    const st = [...weak.city.state.structures.values()].find((s) => s.kind === 'largePoliceStation')!;
    weak.city.setFunding(st.id, 40);
    for (let k = 0; k < 3; k++) weak.city.dispatch('police', weak.b.x, weak.b.y);
    weak.city.step(3);
    expect(weak.city.state.mobs).toHaveLength(1);
  }, 30_000);

  it('station cover does not stop a riot; it takes three units, unless on a dead-end street', () => {
    const { city } = mobTown(false);
    const mob = city.state.mobs[0]!;
    city.fields.policeCover[mob.y * city.size + mob.x] = 255;
    stepMobs(city.state, city.fields, city.cfg, new Rng(0));
    expect(mob.stage).toBe(2);
    const car = (id: number) => ({ id, kind: 'police' as const, air: false, station: 0, x: mob.x, y: mob.y, travel: 0, onSite: 30, competence: 1, path: [], days: 0 });
    // One car on a mob in its frenzy: it keeps going.
    Object.assign(mob, { stage: 5, energy: 60, split: true });
    city.state.units = [car(1)];
    for (let d = 0; d < 10; d++) stepMobs(city.state, city.fields, city.cfg, new Rng(d));
    expect(city.state.mobs).toHaveLength(1);
    // Three: broken up.
    mob.energy = 110;
    city.state.units = [car(1), car(2), car(3)];
    for (let d = 0; d < 10; d++) stepMobs(city.state, city.fields, city.cfg, new Rng(d));
    expect(city.state.mobs).toHaveLength(0);
    // On a dead-end street one car corners a new mob.
    const n = city.size;
    for (let i = 0; i < n * n; i++) city.state.net[i] = 0;
    city.state.net[5 * n + 5] = 2;
    city.state.net[5 * n + 6] = 2;
    // (Mobs gather on lots: this one beside the end of the street.)
    city.state.mobs = [{ id: 1000, x: 5, y: 6, stage: 1, energy: 60, days: 0, split: true }];
    city.state.units = [{ ...car(1), x: 5, y: 6 }];
    for (let d = 0; d < 10; d++) stepMobs(city.state, city.fields, city.cfg, new Rng(d));
    expect(city.state.mobs).toHaveLength(0);
  });

  it('auto-dispatch sends enough cars for a mob in its frenzy', () => {
    const { city, b } = mobTown(true);
    city.buildNetwork(0, 32, 47, 32, 'road');
    city.buildNetwork(47, 20, 47, 32, 'road');
    expect(city.placeStructure('largePoliceStation', 10, 33).ok).toBe(true);
    Object.assign(city.state.mobs[0]!, { stage: 5, energy: 110, split: true });
    city.step(1);
    const cars = city.state.units.filter((u) => u.kind === 'police' && Math.hypot(u.x - b.x, u.y - b.y) <= 3);
    expect(cars.length).toBeGreaterThanOrEqual(3);
  }, 30_000);

  it('an unquelled mob at critical mass spawns a second one nearby', () => {
    const { city, b } = mobTown(false);
    city.state.mobs[0]!.stage = 5;
    city.state.mobs[0]!.energy = 100;
    stepMobs(city.state, city.fields, city.cfg, new Rng(1));
    expect(city.state.mobs).toHaveLength(2);
    const [, second] = city.state.mobs;
    expect(second!.stage).toBe(1);
    expect(Math.hypot(second!.x - b.x, second!.y - b.y)).toBeGreaterThan(3);
    // Each mob spawns once; the new one carries the chain on.
    stepMobs(city.state, city.fields, city.cfg, new Rng(1));
    expect(city.state.mobs).toHaveLength(2);
  }, 30_000);

  it('one tile at −50 alone can start a riot, rarely; a cluster far more often', () => {
    const { city } = mobTown(false);
    const f = city.fields;
    const n = city.size;
    const rate = (tiles: number[], mark = 1) => {
      f.mayorSet.fill(0);
      for (const i of tiles) {
        f.mayorSet[i] = mark;
        f.mayor[i] = -60;
      }
      let riots = 0;
      const rng = new Rng(7);
      for (let k = 0; k < 2000; k++) {
        city.state.mobs = [];
        if (riotCheck(city.state, f, city.cfg, rng).length) riots++;
      }
      return riots / 2000;
    };
    const lone = rate([10 * n + 10]);
    expect(lone).toBeGreaterThan(0);
    expect(lone).toBeLessThan(0.03);
    const cluster = rate([10 * n + 10, 10 * n + 11, 11 * n + 10, 11 * n + 11, 12 * n + 10]);
    expect(cluster).toBeGreaterThan(0.07);
    // Empty homes (rated for the map, marked 2) have nobody to riot.
    expect(rate([10 * n + 10, 10 * n + 11, 11 * n + 10, 11 * n + 11, 12 * n + 10], 2)).toBe(0);
  }, 30_000);
});

describe('city opinion polls', () => {
  it('report the share of residents happy with each topic', () => {
    const city = town();
    city.step(120);
    const before = city.opinionPolls();
    for (const v of Object.values(before)) {
      expect(v.approve).toBeGreaterThanOrEqual(0);
      expect(v.approve).toBeLessThanOrEqual(1);
    }
    expect(before.health.approve).toBe(0); // no hospital yet
    city.placeStructure('largeMedicalCenter', 20, 3);
    const after = city.opinionPolls();
    expect(after.health.approve).toBeGreaterThan(0.5);
    expect(after.health.score).toBeGreaterThan(before.health.score);
  }, 30_000);
});

describe('advisors', () => {
  it('flag problems by department and stop once they are fixed', () => {
    const city = new City({ size: 48, seed: 5, difficulty: 'easy', water: false, config: { safety: { fires: false } } });
    city.state.funds = 5_000_000;
    city.buildNetwork(0, 20, 47, 20, 'road');
    city.zone(1, 8, 46, 19, 'R-medium');
    city.zone(1, 21, 46, 30, 'I-medium');
    expect(city.advisors()).toContainEqual(expect.objectContaining({ advisor: 'utilities', level: 'bad', code: 'noPower' }));
    city.placeStructure('gasPlant', 1, 33);
    city.step(180);
    const codes = city.advisors().map((a) => a.code);
    expect(codes).not.toContain('noPower');
    expect(codes).toContain('noHospital');
    expect(codes).toContain('plantUnprotected');
    expect(city.placeStructure('smallFireStation', 0, 21).ok).toBe(true);
    city.refresh();
    expect(city.advisors().map((a) => a.code)).not.toContain('plantUnprotected');
    for (const a of city.advisors()) expect(['planner', 'finance', 'utilities', 'safety', 'healthEducation', 'transportation', 'environment']).toContain(a.advisor);
  }, 30_000);

  it('warn before a power plant reaches the end of its life', () => {
    const city = new City({ size: 32, seed: 5, water: false });
    city.placeStructure('coalPlant', 2, 2);
    const plant = [...city.state.structures.values()].find((x) => x.kind === 'coalPlant')!;
    expect(city.advisors().map((a) => a.code)).not.toContain('plantOld');
    plant.life = 90;
    const a = city.advisors().find((x) => x.code === 'plantOld')!;
    expect(a.level).toBe('bad');
    expect(a.value).toBeGreaterThan(0);
  });

  it('warn when more than a tenth of the workforce has no job', () => {
    const city = new City({ size: 32, seed: 5, water: false });
    Object.assign(city.census, { workers: [600, 0, 0], unemployed: [200, 0, 0] });
    expect(city.advisors()).toContainEqual(expect.objectContaining({ advisor: 'planner', level: 'bad', code: 'unemployment', value: 33 }));
    Object.assign(city.census, { unemployed: [30, 0, 0] });
    expect(city.advisors().map((a) => a.code)).not.toContain('unemployment');
  });

  it('count only landfilled garbage when warning that the landfill is filling', () => {
    const city = new City({ size: 32, seed: 5, water: false });
    const g = city.state.garbageStats;
    Object.assign(g, { produced: 1000, recycled: 0, incinerated: 990, landfilled: 10, uncollected: 0, landfillSpace: 2000 });
    expect(city.advisors().map((a) => a.code)).not.toContain('landfillFull'); // 200 months left
    Object.assign(g, { incinerated: 0, landfilled: 1000 });
    expect(city.advisors()).toContainEqual(expect.objectContaining({ code: 'landfillFull', value: 2 }));
    // A year out: a heads-up, not yet an alarm.
    Object.assign(g, { landfilled: 160 });
    expect(city.advisors()).toContainEqual(expect.objectContaining({ code: 'landfillSoon', level: 'neutral', value: 12 }));
    expect(city.advisors().map((a) => a.code)).not.toContain('landfillFull');
  });

  it('tell a shortage from a gap in the lines, and a far station from none', () => {
    const city = town();
    city.step(120);
    const st = city.stats();
    const codes = (over: Partial<Omit<typeof st, 'unemployed'>>) => advise(city.state, city.cfg, city.fields, { ...st, unemployed: 0, workers: 0, ...over }, city.demand).map((a) => a.code);
    // More demand than supply counts a block no plant reaches: short only where blackouts fall.
    expect(codes({ power: { supply: 100, demand: 200, blackedOut: 0 } })).not.toContain('powerShort');
    expect(codes({ power: { supply: 100, demand: 200, blackedOut: 3 } })).toContain('powerShort');
    const b = [...city.state.buildings.values()].find((x) => x.type)!;
    city.fields.powered[b.y * city.size + b.x] = 0;
    expect(codes({})).toContain('powerCutOff');
    // Crime with no arrests: no station, or one that reaches nobody.
    const crime = { safety: { ...st.safety, crimes: 9, arrests: 0 }, population: 5000 };
    expect(codes(crime)).toContain('noPolice');
    expect(city.placeStructure('smallPoliceStation', 2, 40).ok).toBe(true);
    expect(codes(crime)).toContain('policeReach');
    expect(codes(crime)).not.toContain('noPolice');
    // A Farmer's Market nudges health but is no hospital.
    const big = { population: 5000 };
    expect(codes(big)).toContain('noHospital');
    city.state.unlocked.push('farmersMarket');
    expect(city.placeStructure('farmersMarket', 6, 40).ok).toBe(true);
    expect(codes(big)).toContain('noHospital');
  }, 60_000);

  it('note low EQ only while there is something to do about it', () => {
    const city = town();
    city.step(120);
    const codes = () => advise(city.state, city.cfg, city.fields, { ...city.stats(), unemployed: 0, workers: 0, population: 6000 }, city.demand).map((a) => a.code);
    for (const b of city.state.buildings.values()) if (b.type?.[0] === 'R') b.eq = city.cfg.services.baseQuotient[0];
    // Schools out of reach of most homes: build more.
    expect(city.placeStructure('elementarySchool', 2, 40).ok).toBe(true);
    city.refresh();
    expect(codes()).toContain('eqLow');
    // Every home in reach and higher education built: nothing left to do but wait.
    city.state.unlocked.push('cityCollege');
    expect(city.placeStructure('cityCollege', 30, 40).ok).toBe(true);
    const cover = city.fields.eduEff.elementary;
    for (const b of city.state.buildings.values()) cover[b.y * city.size + b.x] = 1;
    for (const st of city.state.structures.values()) Object.assign(st, { load: 0 });
    expect(codes()).not.toContain('eqLow');
  }, 60_000);

  it('say when taxes above neutral are what holds demand down', () => {
    const city = town();
    city.step(60);
    expect(city.advisors().map((a) => a.code)).not.toContain('taxHigh');
    for (const t of ['R$', 'R$$', 'R$$$'] as const) city.setTaxRate(t, 15);
    city.refresh();
    const advice = city.advisors().find((a) => a.code === 'taxHigh');
    expect(advice?.advisor).toBe('finance');
    expect(advice!.type![0]).toBe('R');
    expect(advice!.value).toBeGreaterThanOrEqual(30);
  }, 60_000);

  it('point at a school well past its capacity, unless one is already on strike', () => {
    const city = new City({ size: 32, seed: 5, water: false });
    city.state.funds = 1_000_000;
    expect(city.placeStructure('highSchool', 10, 10).ok).toBe(true);
    city.advisors(); // catches the fields up with the new school
    const school = [...city.state.structures.values()][0]!;
    Object.assign(school, { load: 1.2 * school.capacity });
    expect(city.advisors().map((a) => a.code)).not.toContain('schoolFull'); // a little over is tolerable
    Object.assign(school, { load: 1.3 * school.capacity }); // a strike here would last
    expect(city.advisors()).toContainEqual(expect.objectContaining({ code: 'schoolFull', value: 130 }));
    Object.assign(school, { load: 3 * school.capacity });
    expect(city.advisors()).toContainEqual(expect.objectContaining({ code: 'schoolFull', level: 'neutral', value: 300, at: [10, 10] }));
    Object.assign(school, { strike: 2 });
    expect(city.advisors().map((a) => a.code)).toEqual(expect.arrayContaining(['schoolStrike']));
    expect(city.advisors().map((a) => a.code)).not.toContain('schoolFull');
  });
});
